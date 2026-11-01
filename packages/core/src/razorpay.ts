// Razorpay, pure (M6.2; ADM-PAY-01, -02, -07, -11, -12, JOB-HOOK-01..03; run file docs/runs/m6.2-razorpay.md B). No `fetch` here: the admin finance Worker's client
// (`apps/admin/worker/gateway/razorpay.ts`, stage B2) calls Razorpay's API and the jobs Worker's hook receives its webhooks; both use these helpers, so the rules are in
// one place and tested without a network. Subpath export only (`@techaust/core/razorpay`), no zod, so the jobs hook stays small.
//
// What Razorpay's documentation says, as read for this file (2026-11-01):
//   - the webhook signature is HMAC-SHA256 of the RAW request body with the webhook secret, hex, in the `X-Razorpay-Signature` header (Razorpay Node SDK,
//     `validateWebhookSignature`, documents/paymentVerfication.md: https://github.com/razorpay/razorpay-node/blob/master/documents/paymentVerfication.md);
//   - a payment link is cancelled with `POST /v1/payment_links/{id}/cancel` (razorpay-node documents/paymentLink.md, "Cancel a payment link":
//     https://github.com/razorpay/razorpay-node/blob/master/documents/paymentLink.md; https://razorpay.com/docs/api/payment-links/#cancel-payment-link);
//   - a payment's `fee` and `tax` are integers in paise. The documented examples (payment `fee` 24 with `tax` 4; a settlement's `fees` 590 with `tax` 90 = 500 + 18 %)
//     read as: `fee` is Razorpay's whole charge INCLUDING the GST on it, and `tax` is that GST. NOT confirmed by a field definition (the SDK docs say only "Fee" and
//     "Tax"); so both are stored exactly as reported (`charges_minor` = `fee`, `fee_tax_minor` = `tax`) and nothing adds or subtracts them. The fee is absorbed, never
//     billed to the client (Researched 2026-10-28, NPCI FAQ of 15 Sep 2026 (08-C RA-29): merchants may not pass the MDR on). OPEN (08-C RA-29): is GST charged on
//     the MDR and invoiced to our GSTIN?

import { GATEWAY_LINK_HOSTS, GATEWAY_LINK_URL_MAX, isGatewayLinkUrl } from "./gateway-rpc.ts";
import type {
  CheckoutState,
  CheckoutStatusReport,
  PaymentStatusReport,
  ProviderEvent,
  ProviderEventType,
} from "./payments.ts";
import { liveModeAllowed, type ProviderMode } from "./payments.ts";

/** The only host the client calls (the live guard runs before any call). */
export const RAZORPAY_API_ORIGIN = "https://api.razorpay.com";
/**
 * The hosts a payment link's `short_url` may be on (the portal refuses any other: 502). One list (M6.2 review finding 12): `GATEWAY_LINK_HOSTS` in
 * `@techaust/core/gateway-rpc`, which the portal's Worker and screens read too.
 */
export const RAZORPAY_LINK_HOSTS = GATEWAY_LINK_HOSTS.razorpay;

const enc = new TextEncoder();
const HEX64 = /^[0-9a-fA-F]{64}$/;
/** The longest event id or provider reference a row holds (`webhook_events.event_id`, `PROVIDER_REF_MAX` in the db schema: generic, 255). */
export const PROVIDER_REF_MAX = 255;
/** The longest link URL a checkout row holds (`CHECKOUT_SHORT_URL_MAX` in the db schema). */
export const SHORT_URL_MAX = GATEWAY_LINK_URL_MAX;

/**
 * The imported HMAC keys, per isolate, by secret (CPU diagnosis, lead decision 5: a key is imported once, not per webhook). At most a handful of entries (the current
 * and the previous webhook secret, plus the warm-up's made-up one); the map is cleared if it ever grows past 8, so a rotated secret never pins memory.
 */
type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const hmacKeys = new Map<string, Promise<HmacKey>>();
function hmacKey(secret: string): Promise<HmacKey> {
  let k = hmacKeys.get(secret);
  if (!k) {
    if (hmacKeys.size >= 8) hmacKeys.clear();
    k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "verify",
    ]);
    // A failed import is not kept (the next call tries again).
    k.catch(() => hmacKeys.delete(secret));
    hmacKeys.set(secret, k);
  }
  return k;
}

/** A hex string of exactly 64 characters to its 32 bytes, else null (decoded first, so a malformed header never reaches the comparison). */
function hex32(sig: string): Uint8Array<ArrayBuffer> | null {
  if (!HEX64.test(sig)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(sig.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Whether `sigHex` (the `X-Razorpay-Signature` header) is HMAC-SHA256 of `rawBody` under one of `secrets` (the current secret, then the previous one while it is
 * rotated: `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_SECRET_PREVIOUS`). The check is `crypto.subtle.verify`, which compares in constant time: never a string
 * comparison of two hex texts. Anything but 64 hex characters fails before any key is made; upper-case hex decodes to the same bytes, so it is accepted. Empty
 * secrets are skipped; no secret at all never verifies.
 */
export async function verifyRazorpaySignature(
  rawBody: Uint8Array | string,
  sigHex: string,
  secrets: readonly (string | null | undefined)[],
): Promise<boolean> {
  const sig = typeof sigHex === "string" ? hex32(sigHex) : null;
  if (!sig) return false;
  // Early check 1, finding 14: the hook passes the raw BYTES it received (never a decoded and re-encoded text, which could change a malformed sequence); a string
  // is accepted for callers that already hold the exact text.
  let body: Uint8Array<ArrayBuffer>;
  if (rawBody instanceof Uint8Array) body = new Uint8Array(rawBody);
  else if (typeof rawBody === "string") body = new Uint8Array(enc.encode(rawBody));
  else return false;
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret === "") continue;
    const key = await hmacKey(secret);
    if (await crypto.subtle.verify("HMAC", key, sig, body)) return true;
  }
  return false;
}

/** Razorpay's `x-razorpay-event-id` header as a `webhook_events.event_id`: 1 to 64 of `A-Z a-z 0-9 _`, else null (the hook then uses `fallbackEventId`). */
export const razorpayEventIdOf = (header: string | null | undefined): string | null =>
  typeof header === "string" && /^[A-Za-z0-9_]{1,64}$/.test(header) ? header : null;

/**
 * The event id when the header is missing or malformed: `sha256:` and the body's SHA-256 in base64url (50 characters, inside the column's 64). The header is not
 * signed, so neither form is the real idempotency key: the payment row's `rzp_<payment id>` and the unique `provider_payment_id` are.
 */
export async function fallbackEventId(rawBody: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(rawBody)));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return `sha256:${btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

// ---- reading what Razorpay sends ----------------------------------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, re: RegExp): string | null => (typeof v === "string" && re.test(v) ? v : null);
const LINK_ID = /^plink_[A-Za-z0-9]{1,58}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{1,60}$/;
const ORDER_ID = /^order_[A-Za-z0-9]{1,58}$/;
const ACCOUNT_ID = /^acc_[A-Za-z0-9]{1,60}$/;
const METHOD = /^[a-z_]{1,32}$/;
const REFERENCE = /^[A-Za-z0-9_.-]{1,40}$/;
/** A positive safe integer (an amount in paise), else null. */
const amount = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
/** A safe integer ≥ 0, else null. */
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const currencyOf = (v: unknown): "INR" | "USD" | null => (v === "INR" || v === "USD" ? v : null);
/** Razorpay's Unix seconds to UTC ms (a safe, non-negative integer), else null. */
const secondsToMs = (v: unknown): number | null => {
  const s = count(v);
  return s === null || s > 32_503_680_000 ? null : s * 1000;
};

/** Razorpay's webhook event names to ours (the four the hook subscribes to, run file F, H3). */
export const RAZORPAY_EVENT_TYPES: Readonly<Record<string, ProviderEventType>> = {
  "payment_link.paid": "checkout.paid",
  "payment_link.partially_paid": "checkout.partially_paid",
  "payment_link.expired": "checkout.expired",
  "payment_link.cancelled": "checkout.cancelled",
};

/** A verified, parsed Razorpay event: the provider event, plus the whitelisted facts the hook may store (L8; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)). */
export type RazorpayEvent = ProviderEvent & {
  /** Razorpay's event name as sent (≤ 64). */
  readonly name: string;
  readonly accountId: string | null;
  readonly method: string | null;
};

export type ParsedEvent =
  | { readonly ok: true; readonly value: RazorpayEvent }
  | { readonly ok: false; readonly code: "invalid_event" };

const INVALID: ParsedEvent = Object.freeze({ ok: false, code: "invalid_event" } as const);

/**
 * A VERIFIED webhook body (already `JSON.parse`d) to an event, else `invalid_event`. `eventId` is the hook's (the header or `fallbackEventId`). The four link events
 * need the link's id and a positive safe amount in INR or USD, and the two paid events the payment's id and amount too; any other event name is `other` (the hook
 * stores it as `ignored`). Reads only the whitelisted fields: never an email, phone, UPI address or card detail (L8; ADM-PAY-12; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)).
 */
export function parseRazorpayEvent(obj: unknown, eventId: string): ParsedEvent {
  if (!isObj(obj) || typeof eventId !== "string" || eventId === "" || eventId.length > PROVIDER_REF_MAX)
    return INVALID;
  const name = obj.event;
  if (typeof name !== "string" || name === "" || name.length > 64) return INVALID;
  const occurredAt = secondsToMs(obj.created_at);
  if (occurredAt === null) return INVALID;
  const accountId = str(obj.account_id, ACCOUNT_ID);
  const type = RAZORPAY_EVENT_TYPES[name] ?? "other";
  if (type === "other")
    return {
      ok: true,
      value: {
        id: eventId,
        type,
        name,
        providerRef: "",
        checkoutRef: null,
        paymentRef: null,
        currency: "INR",
        amountMinor: 0,
        occurredAt,
        accountId,
        method: null,
      },
    };
  const payload = obj.payload;
  if (!isObj(payload)) return INVALID;
  const link = isObj(payload.payment_link) ? payload.payment_link.entity : undefined;
  if (!isObj(link)) return INVALID;
  const linkId = str(link.id, LINK_ID);
  const linkAmount = amount(link.amount);
  const linkCurrency = currencyOf(link.currency);
  if (!linkId || linkAmount === null || !linkCurrency) return INVALID;
  if (type === "checkout.expired" || type === "checkout.cancelled")
    return {
      ok: true,
      value: {
        id: eventId,
        type,
        name,
        providerRef: linkId,
        checkoutRef: linkId,
        paymentRef: null,
        currency: linkCurrency,
        amountMinor: linkAmount,
        occurredAt,
        accountId,
        method: null,
      },
    };
  const payment = isObj(payload.payment) ? payload.payment.entity : undefined;
  if (!isObj(payment)) return INVALID;
  const paymentId = str(payment.id, PAYMENT_ID);
  const paid = amount(payment.amount);
  const currency = currencyOf(payment.currency);
  if (!paymentId || paid === null || !currency) return INVALID;
  return {
    ok: true,
    value: {
      id: eventId,
      type,
      name,
      providerRef: paymentId,
      checkoutRef: linkId,
      paymentRef: paymentId,
      currency,
      amountMinor: paid,
      occurredAt,
      accountId,
      method: str(payment.method, METHOD),
    },
  };
}

/**
 * A verified body of a HANDLED event name that `parseRazorpayEvent` refused (a field missing or malformed): the event name and, when it can be read, the link's id,
 * else null (an unhandled name, or not an object). The hook stores it `received` so nothing verified is dropped (early check 2, finding 3); `processEvent`
 * re-fetches the link, or writes an `unreadable_event` review item when no link id could be read. Whitelisted (L8; 08-C RB-40): the name and the link id only.
 */
export function lenientRazorpayFacts(obj: unknown): { event: string; linkId?: string } | null {
  if (!isObj(obj) || typeof obj.event !== "string" || !Object.hasOwn(RAZORPAY_EVENT_TYPES, obj.event))
    return null;
  const payload = isObj(obj.payload) ? obj.payload : null;
  const link = payload && isObj(payload.payment_link) ? payload.payment_link.entity : undefined;
  const linkId = isObj(link) ? str(link.id, LINK_ID) : null;
  return linkId ? { event: obj.event, linkId } : { event: obj.event };
}

/** The whitelisted facts of an event, as `webhook_events.facts` stores them (L8; 08-C RB-40): ids, amount, currency, method and account. Nothing personal. */
export function eventFacts(e: RazorpayEvent): Record<string, string | number> {
  const f: Record<string, string | number> = { event: e.name };
  if (e.checkoutRef) f.linkId = e.checkoutRef;
  if (e.paymentRef) f.paymentId = e.paymentRef;
  if (e.amountMinor > 0) {
    f.amountMinor = e.amountMinor;
    f.currency = e.currency;
  }
  if (e.method) f.method = e.method;
  if (e.accountId) f.accountId = e.accountId;
  return f;
}

const LINK_STATES: readonly CheckoutState[] = ["created", "partially_paid", "paid", "expired", "cancelled"];

/** A payment link as Razorpay's `GET /v1/payment_links/{id}` answers it, reduced to what the judge needs; anything malformed is null. */
export type RazorpayLink = CheckoutStatusReport & {
  readonly shortUrl: string | null;
  /** `expire_by` in UTC ms, or null when Razorpay sent 0 or none. */
  readonly expiresAt: number | null;
};

export function readRazorpayLink(obj: unknown): RazorpayLink | null {
  if (!isObj(obj)) return null;
  const id = str(obj.id, LINK_ID);
  const state = LINK_STATES.find((s) => s === obj.status);
  const currency = currencyOf(obj.currency);
  const total = amount(obj.amount);
  const paidSoFar = count(obj.amount_paid) ?? 0;
  if (!id || !state || !currency || total === null) return null;
  const list = obj.payments;
  const payments: { paymentRef: string; amountMinor: number; status: string }[] = [];
  if (Array.isArray(list)) {
    for (const p of list) {
      if (!isObj(p)) return null;
      const ref = str(p.payment_id, PAYMENT_ID);
      const amt = amount(p.amount);
      if (!ref || amt === null) return null;
      payments.push({
        paymentRef: ref,
        amountMinor: amt,
        status: typeof p.status === "string" ? p.status : "",
      });
    }
  } else if (list !== null && list !== undefined) return null;
  const shortUrl =
    typeof obj.short_url === "string" && obj.short_url.length <= SHORT_URL_MAX ? obj.short_url : null;
  const expire = secondsToMs(obj.expire_by);
  return {
    providerRef: id,
    referenceId: str(obj.reference_id, REFERENCE),
    state,
    currency,
    amountMinor: total,
    amountPaidMinor: paidSoFar,
    orderRef: str(obj.order_id, ORDER_ID),
    payments,
    shortUrl,
    expiresAt: expire === 0 ? null : expire,
  };
}

/** A payment as Razorpay's `GET /v1/payments/{id}` answers it (whitelisted fields only; L8; 08-C RB-40), else null. */
export function readRazorpayPayment(obj: unknown): PaymentStatusReport | null {
  if (!isObj(obj)) return null;
  const id = str(obj.id, PAYMENT_ID);
  const total = amount(obj.amount);
  const currency = currencyOf(obj.currency);
  const createdAt = secondsToMs(obj.created_at);
  if (!id || total === null || !currency || createdAt === null) return null;
  const s = obj.status;
  const state =
    s === "captured" && obj.captured !== false
      ? "captured"
      : s === "refunded"
        ? "refunded"
        : s === "failed"
          ? "failed"
          : "pending";
  return {
    providerRef: id,
    state,
    currency,
    amountMinor: total,
    method: str(obj.method, METHOD),
    feeMinor: count(obj.fee),
    feeTaxMinor: count(obj.tax),
    createdAt,
    orderRef: str(obj.order_id, ORDER_ID),
  };
}

// ---- the judge: does the re-fetched payment settle this checkout? -----------------------------------------------------------------------------------

export const JUDGE_VERDICTS = [
  // Early check 1, finding 6: Razorpay has not settled the payment yet (`created` or `authorized`): try again later. A failed or refunded payment is `not_captured`
  // and goes to the Owner at once.
  "payment_pending",
  "not_captured",
  "amount_mismatch",
  "currency_mismatch",
  "reference_mismatch",
  "order_mismatch",
  "payment_not_on_link",
  "partial_payment",
] as const;
export type JudgeVerdict = (typeof JUDGE_VERDICTS)[number];

/** Our checkout row, as the judge needs it. */
export type CheckoutFacts = {
  readonly id: string;
  readonly providerLinkId: string;
  readonly currency: "INR" | "USD";
  readonly amountMinor: number;
};

/**
 * Whether the payment and link re-fetched from Razorpay's API (never the webhook's copy: ADR 0008) settle `checkout` exactly, in this order: the payment is
 * captured (M6.2 review finding 7: its state comes first, so a failed, refunded or unsettled payment is never a confirmable row, whatever else differs); the link is
 * ours (its id and our reference); it is one of the link's payments; it belongs to the link's order (when the link names one); the currency; the amount.
 * A link only partly paid, or a payment for less than the link while the link says partly paid, is `partial_payment` (links are made with `accept_partial: false`, L2,
 * so this should not happen; it goes to the Owner). Anything else that differs is a mismatch the Owner reviews; nothing here moves money.
 */
export function judgeRazorpayPayment(
  checkout: CheckoutFacts,
  link: CheckoutStatusReport,
  payment: PaymentStatusReport,
): { readonly ok: true } | { readonly ok: false; readonly verdict: JudgeVerdict } {
  const no = (verdict: JudgeVerdict) => ({ ok: false, verdict }) as const;
  if (payment.state === "pending") return no("payment_pending");
  if (payment.state !== "captured") return no("not_captured");
  if (link.providerRef !== checkout.providerLinkId || link.referenceId !== checkout.id)
    return no("reference_mismatch");
  if (!link.payments.some((p) => p.paymentRef === payment.providerRef)) return no("payment_not_on_link");
  if (link.orderRef !== null && payment.orderRef !== link.orderRef) return no("order_mismatch");
  if (payment.currency !== checkout.currency || link.currency !== checkout.currency)
    return no("currency_mismatch");
  if (link.state === "partially_paid") return no("partial_payment");
  if (payment.amountMinor !== checkout.amountMinor || link.amountMinor !== checkout.amountMinor)
    return no("amount_mismatch");
  return { ok: true };
}

// ---- the link we ask for ------------------------------------------------------------------------------------------------------------------------------

/** How long a link lives (L2): 7 days. Razorpay's own bounds: at least 15 minutes ahead, and a link lives at most 6 months (its default validity). */
export const LINK_LIFETIME_MS = 7 * 86_400_000;
export const LINK_MIN_AHEAD_MS = 15 * 60_000;
export const LINK_MAX_AHEAD_MS = 180 * 86_400_000;
/** Razorpay's smallest amount: ₹1 (100 paise). */
export const RAZORPAY_MIN_AMOUNT_MINOR = 100;
const NOTE_MAX = 255;

/** The document types a link may be for, and the words Razorpay's page shows for each (owner, 2026-11-01, early check 1 Q4; 07-ZI lines 17 to 19). */
export const LINK_DESCRIPTION_WORDS = {
  tax_invoice: "Invoice",
  proforma: "Proforma",
  debit_note: "Debit note",
} as const;
export type LinkDocumentType = keyof typeof LINK_DESCRIPTION_WORDS;

/** What Razorpay's payment page shows: "Invoice {number}", "Proforma {number}" or "Debit note {number}" (07-ZI lines 17 to 19, word for word). */
export const linkDescriptionOf = (type: LinkDocumentType, documentNumber: string): string =>
  `${LINK_DESCRIPTION_WORDS[type]} ${documentNumber}`;

export type LinkRequestInput = {
  readonly checkoutId: string;
  /** The document's type: the page's description by type (07-ZI 17 to 19). */
  readonly documentType: LinkDocumentType;
  readonly amountMinor: number;
  readonly documentNumber: string;
  readonly documentId: string;
  readonly expiresAt: number;
  readonly callbackUrl: string;
  /** The instant the request is made (UTC ms), for the expiry bounds. */
  readonly now: number;
};

/** The body of `POST /v1/payment_links` (INR only, L12). */
export type RazorpayLinkRequest = {
  readonly amount: number;
  readonly currency: "INR";
  readonly accept_partial: false;
  readonly description: string;
  readonly reference_id: string;
  readonly expire_by: number;
  readonly notify: { readonly sms: false; readonly email: false };
  readonly reminder_enable: false;
  readonly notes: { readonly document_id: string; readonly checkout_id: string };
  readonly callback_url: string;
  readonly callback_method: "get";
};

export const LINK_REQUEST_REFUSALS = [
  "amount_too_small",
  "amount_invalid",
  "expiry_out_of_bounds",
  "reference_invalid",
  "note_too_long",
  "callback_invalid",
  "type_invalid",
] as const;
export type LinkRequestRefusal = (typeof LINK_REQUEST_REFUSALS)[number];

/**
 * The payment link we ask Razorpay for (L2, L3, L10): a fixed amount (`accept_partial: false`: the client picks a part in the portal), no Razorpay customer, no SMS
 * or email from Razorpay, no reminders, our checkout id as `reference_id` (Razorpay wants it unique per link and at most 40 characters) and in `notes` with the
 * document id (each note at most 255 characters, at most 15 notes), the description by document type (07-ZI 17 to 19), `expire_by` in Unix seconds 15 minutes to 6 months ahead,
 * at least 100 paise, and the callback (an https URL with no query: the portal's return page, which never carries a token). `callback_method` "get" goes with
 * `callback_url` (Razorpay's create-link parameters; not checked against a live call: tests never call Razorpay).
 */
export function linkRequestOf(
  i: LinkRequestInput,
):
  | { readonly ok: true; readonly body: RazorpayLinkRequest }
  | { readonly ok: false; readonly code: LinkRequestRefusal } {
  const no = (code: LinkRequestRefusal) => ({ ok: false, code }) as const;
  if (!Number.isSafeInteger(i.amountMinor)) return no("amount_invalid");
  if (i.amountMinor < RAZORPAY_MIN_AMOUNT_MINOR) return no("amount_too_small");
  if (!Number.isSafeInteger(i.expiresAt) || !Number.isSafeInteger(i.now)) return no("expiry_out_of_bounds");
  const ahead = i.expiresAt - i.now;
  if (ahead < LINK_MIN_AHEAD_MS || ahead > LINK_MAX_AHEAD_MS) return no("expiry_out_of_bounds");
  if (!REFERENCE.test(i.checkoutId)) return no("reference_invalid");
  if (!Object.hasOwn(LINK_DESCRIPTION_WORDS, i.documentType)) return no("type_invalid");
  if (
    i.documentId.length < 1 ||
    i.documentId.length > NOTE_MAX ||
    i.documentNumber.length < 1 ||
    i.documentNumber.length > 64
  )
    return no("note_too_long");
  let url: URL;
  try {
    url = new URL(i.callbackUrl);
  } catch {
    return no("callback_invalid");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))
    return no("callback_invalid");
  if (url.username || url.password || url.hash || i.callbackUrl.length > 2000) return no("callback_invalid");
  // The return page never carries a token: a query is allowed only as the portal's own `?pay=return` marker.
  if (url.search !== "" && url.search !== "?pay=return") return no("callback_invalid");
  return {
    ok: true,
    body: {
      amount: i.amountMinor,
      currency: "INR",
      accept_partial: false,
      description: linkDescriptionOf(i.documentType, i.documentNumber),
      reference_id: i.checkoutId,
      // Whole seconds, rounded down (expiresAt is a positive safe integer, so truncation is the floor).
      expire_by: Math.trunc(i.expiresAt / 1000),
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: { document_id: i.documentId, checkout_id: i.checkoutId },
      callback_url: i.callbackUrl,
      callback_method: "get",
    },
  };
}

/** Whether a link's `short_url` is on Razorpay's own hosts over https (the portal answers 502 otherwise): the one check, `isGatewayLinkUrl` (review finding 12). */
export const isRazorpayShortUrl = (v: unknown): boolean => isGatewayLinkUrl("razorpay", v);

// ---- methods, references, keys ------------------------------------------------------------------------------------------------------------------------

/** Razorpay's payment `method` to our `payments.mode` (the 0064 list); anything we do not name is `other` (`options.checkout.method` is undocumented, so any method is accepted and recorded). */
export function methodToMode(method: string | null | undefined): string {
  switch (method) {
    case "upi":
    case "card":
    case "netbanking":
    case "wallet":
    case "emi":
    case "paylater":
      return method;
    case "cardless_emi":
      return "emi";
    default:
      return "other";
  }
}

/** `payments.id` of a Razorpay payment: `rzp_` and Razorpay's payment id (≤ 64). */
export const razorpayPaymentRowId = (paymentId: string): string => `rzp_${paymentId}`;

/**
 * `payments.reference_norm` of a Razorpay payment: its id in the one stored reference form of `normaliseReference` (core `export-invoice.ts`: upper case, 1 to 60 of
 * `A-Z 0-9 / -`), with the underscore as a hyphen (`pay_Abc` → `PAY-ABC`). Null when it cannot be one. The exact id stays in `provider_payment_id`.
 */
export function razorpayReferenceNorm(paymentId: string): string | null {
  if (!PAYMENT_ID.test(paymentId)) return null;
  const n = paymentId.replaceAll("_", "-").toUpperCase();
  return /^[A-Z0-9/-]{1,60}$/.test(n) ? n : null;
}

/** The mode of a Razorpay key id: `rzp_test_...` is test, `rzp_live_...` is live, anything else none. */
export function keyModeOf(keyId: unknown): ProviderMode | null {
  if (typeof keyId !== "string") return null;
  if (/^rzp_test_[A-Za-z0-9]{1,40}$/.test(keyId)) return "test";
  if (/^rzp_live_[A-Za-z0-9]{1,40}$/.test(keyId)) return "live";
  return null;
}

/**
 * Whether the Razorpay client may call the API with `keyId` (CLAUDE.md rule 7, ADM-PAY-11 for Razorpay): a test key only while Settings › Gateways says test; a live key
 * only while Settings says live AND the go-live flag is exactly true (`liveModeAllowed`). Checked before any fetch, so a `rzp_live_` key with the flag false makes no
 * call at all (503 `live_not_allowed`).
 */
export function razorpayAllowed(keyId: unknown, settingsMode: unknown, liveAllowedFlag: unknown): boolean {
  const mode = keyModeOf(keyId);
  if (mode === "test") return settingsMode === "test";
  if (mode === "live") return settingsMode === "live" && liveModeAllowed("live", liveAllowedFlag);
  return false;
}
