// PayPal in sandbox mode, pure (M6.4; ADM-PAY-01, -03, -04, -07, -11, -12, JOB-HOOK-01..03, POR-06; run file docs/runs/m6.4-paypal.md B, "Step 0 results" and
// "Lead decisions at build start"). No `fetch` and no zod here: the admin finance Worker's client (`apps/admin/worker/gateway/paypal.ts`, stage B2) calls PayPal's
// Orders v2 API with plain `fetch`, and the jobs Worker's hook verifies PayPal's webhooks OFFLINE (L1: PayPal's RSA signature over a CRC32 of the raw body, with
// the public key of PayPal's own certificate; no postback, so jobs holds no API key). Both use these helpers, so every rule sits in one place and is tested
// without a network. Subpath export only (`@techaust/core/paypal`), kept small because the jobs hook imports the verifier. Money in integer minor units only
// (`test/no-floats.test.ts` lists this file).
//
// What PayPal's own pages say, as read for this file (run file "Step 0 results" 0.4, read 2026-11-02 on developer.paypal.com):
//   - the token (row 1): `POST /v1/oauth2/token` on `api-m.sandbox.paypal.com`, Basic auth, `grant_type=client_credentials`;
//   - capture errors (row 10): `name` and `details[0].issue`; RESOURCE_CONFLICT `PREVIOUS_REQUEST_IN_PROGRESS`, RESOURCE_NOT_FOUND `INVALID_RESOURCE_ID`,
//     UNPROCESSABLE_ENTITY `ORDER_ALREADY_CAPTURED`, `INSTRUMENT_DECLINED`, `ORDER_NOT_APPROVED`, `DUPLICATE_INVOICE_ID`, `ORDER_COMPLETION_IN_PROGRESS`,
//     `PAYER_ACTION_REQUIRED`, `REDIRECT_PAYER_FOR_ALTERNATE_FUNDING`, `TRANSACTION_REFUSED`, `PAYMENT_DENIED`, `MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED`;
//     no `ORDER_EXPIRED` on capture;
//   - offline verification (row 17): the signed text is `${transmissionId}|${timeStamp}|${webhookId}|${crc}` with no spaces, the CRC32 of the RAW body in
//     unsigned decimal, SHA256withRSA, the public key of the certificate at `PAYPAL-CERT-URL`; simulator ("Send test") events are signed with the literal
//     webhook id `WEBHOOK_ID` (row 21), so they never verify against ours and that literal is never accepted as our id;
//   - event names (row 19): `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.PAYMENT-APPROVAL.REVERSED`, `PAYMENT.CAPTURE.COMPLETED`/`.PENDING`/`.DECLINED`/`.REFUNDED`/
//     `.REVERSED` (`.DENIED` is v1 and marketplaces only: mapped, not subscribed);
//   - order expiry (row 23): 3 hours from creation to capture; our local lifetime is 2 h 30 min and a capture is allowed until 30 minutes after it (L5 changed).
// Still UNCONFIRMED (Phase 7 or the sandbox): the live certificate host, the return URL's `token`/`PayerID`, which field carries the payer's or card's country.
// Personal data (ADM-PAY-12, L7; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)): the readers below are whitelists: never the payer's name,
// email, address (other than its two-letter country code, 08-C RA-38), phone, `payer_id`, `account_id` or `PayerID`. Card credentials are never seen, sent or
// stored (Researched 2026-10-28, RBI PA Directions 2025, Annex 1 2.1 (08-C RB-07)).

import { istDate, toIsoDate } from "./dates.ts";
import { sha256Hex } from "./hash.ts";
import { isUuidV7 } from "./ids.ts";
import { isEnvMark, liveModeAllowed, type ProviderEventType, type ProviderMode } from "./payments.ts";

type RsaKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, re: RegExp): string | null => (typeof v === "string" && re.test(v) ? v : null);
const enc = new TextEncoder();

// ---- origins and the live guard ----------------------------------------------------------------------------------------------------------------------

/** The two API origins the finance Worker may call (Step 0.4 rows 1 and 2: sandbox CONFIRMED; the live origin is read again at Phase 7). */
export const PAYPAL_API_ORIGINS = {
  test: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

/**
 * The origin for Settings › Gateways' PayPal mode (CLAUDE.md rule 7, ADM-PAY-11): PayPal's credentials carry no test or live prefix, so the MODE picks the host;
 * a live mode gives null while `liveModeAllowed("live", flag)` is false (the client then makes zero fetches); anything but `test` or `live` is null too.
 */
export function paypalOriginFor(settingsMode: unknown, liveAllowedFlag: unknown): string | null {
  if (settingsMode === "test") return PAYPAL_API_ORIGINS.test;
  if (settingsMode === "live" && liveModeAllowed("live", liveAllowedFlag)) return PAYPAL_API_ORIGINS.live;
  return null;
}

/** The provider mode of an origin this module names, else null (the client's own check before a request leaves). */
export const payPalModeOfOrigin = (origin: unknown): ProviderMode | null =>
  origin === PAYPAL_API_ORIGINS.test ? "test" : origin === PAYPAL_API_ORIGINS.live ? "live" : null;

// ---- money -------------------------------------------------------------------------------------------------------------------------------------------

/** PayPal's `money.value` (Vendor facts row 4: a string of at most 32 characters); USD and INR both have two decimals. */
const VALUE = /^(0|[1-9]\d{0,12})(\.\d{1,2})?$/;

/**
 * Minor units (cents or paise) to PayPal's `value` text ("12.34"), built from integers only (`Math.trunc` and `%`): null unless a positive safe integer. No
 * float ever touches an amount.
 */
export function usdMinorToValue(minor: number): string | null {
  if (!Number.isSafeInteger(minor) || minor <= 0) return null;
  const units = Math.trunc(minor / 100);
  const cents = minor % 100;
  return `${units}.${cents < 10 ? "0" : ""}${cents}`;
}

/**
 * PayPal's `value` text of a two-decimal currency (USD, INR) to minor units, padded to two decimals ("10" → 1000, "10.5" → 1050): null for a sign, an exponent,
 * a space, three or more decimals, an empty text, a leading zero, or more than 32 characters.
 */
export function valueToUsdMinor(s: unknown): number | null {
  if (typeof s !== "string" || s.length > 32) return null;
  const m = VALUE.exec(s);
  if (!m) return null;
  const units = Number.parseInt(m[1] as string, 10);
  const frac = m[2] ? `${m[2].slice(1)}0`.slice(0, 2) : "00";
  return units * 100 + Number.parseInt(frac, 10);
}

/** A money object `{currency_code, value}`: the currency (three capitals) and, for USD or INR only, the minor units; null when malformed. */
function moneyOf(v: unknown): { readonly currency: string; readonly minor: number | null } | null {
  if (!isObj(v)) return null;
  const currency = str(v.currency_code, /^[A-Z]{3}$/);
  if (!currency || typeof v.value !== "string") return null;
  if (currency !== "USD" && currency !== "INR") return { currency, minor: null };
  const minor = valueToUsdMinor(v.value);
  return minor === null ? null : { currency, minor };
}

// ---- constants (L3, L5, L19) -------------------------------------------------------------------------------------------------------------------------

/** Our local lifetime of a PayPal checkout (L5 changed, 2026-11-02): 2 h 30 min, inside PayPal's 3 hours from creation to capture (Step 0.4 row 23). */
export const PAYPAL_ORDER_LIFETIME_MS = 150 * 60_000;
/** A claimed capture may run until 30 minutes after `expires_at` (≤ 3 h from the row, before PayPal's 3 h from the order). */
export const PAYPAL_CAPTURE_GRACE_MS = 30 * 60_000;
/** A capture claim older than this (no answer came back) may be taken again, and the sweep refreshes the row. */
export const PAYPAL_CLAIM_STALE_MS = 120_000;
/** An open checkout of the same amount is reused only with at least this long left (L4). */
export const PAYPAL_REUSE_MIN_LEFT_MS = 30 * 60_000;
/** PayPal's own smallest charge, 1 cent (Vendor facts row 4: two decimals). Our USD rule's minimum is `ONLINE_RULES.paypal.minMinor` (L21: Stripe's 50). */
export const PAYPAL_MIN_AMOUNT_MINOR = 1;
/** The brand name on PayPal's page (07-ZN line 15, owner-approved 2026-11-02); the finance Worker sends Settings › Company's trade name, which is this. */
export const PAYPAL_BRAND_NAME = "TecHaust Technologies";

/** PayPal's bounds (Vendor facts row 3, CONFIRMED in the spec): beyond 127 the description is cut by PayPal, so we refuse it instead. */
export const PAYPAL_DESCRIPTION_MAX = 127;
export const PAYPAL_BRAND_MAX = 127;
export const PAYPAL_INVOICE_ID_MAX = 127;
/** `PayPal-Request-Id` ≤ 108 (Vendor facts row 6); keys are kept 6 hours, longer than our 3 h 30 min window. */
export const PAYPAL_REQUEST_ID_MAX = 108;
/** The `payer-action` URL we store in `short_url` (L17). */
export const PAYPAL_APPROVE_URL_MAX = 200;

/** PayPal's order id (Vendor facts row 8: `^[A-Z0-9]+$`, at most 36). */
export const PAYPAL_ORDER_ID = /^[A-Z0-9]{1,36}$/;
/** A capture or refund id: capitals and digits, at most 64 (what `provider_payment_id` of a PayPal row holds; the 0068 shape). */
export const PAYPAL_CAPTURE_ID = /^[A-Z0-9]{1,64}$/;
/** Our document numbers (≤ 16 characters, CLAUDE.md conventions). */
const DOC_NUMBER = /^[A-Za-z0-9/-]{1,16}$/;

/** The request id of an order create (L3): `ord-` and our checkout id, so a retried create is the same order. */
export const payPalOrderRequestId = (checkoutId: string): string => `ord-${checkoutId}`;

/**
 * The request id of a capture (run file C step 3): `cap-`, our checkout id and the claim's instant, so retries inside one claim are idempotent and a new claim
 * after `INSTRUMENT_DECLINED` gets a new id (PayPal would replay the stored decline otherwise).
 */
export const payPalCaptureRequestId = (checkoutId: string, claimAt: number): string =>
  `cap-${checkoutId}-${claimAt}`;

// ---- the order we ask for ----------------------------------------------------------------------------------------------------------------------------

/** The document types a PayPal order is made for (`ONLINE_RULES.paypal.types`) and the words of PayPal's page (07-ZN line 15, owner-approved 2026-11-02). */
export const PAYPAL_DESCRIPTION_WORDS = {
  export_invoice: "Invoice",
  proforma: "Proforma invoice",
  debit_note: "Debit note",
} as const;
export type PayPalDocumentType = keyof typeof PAYPAL_DESCRIPTION_WORDS;

/** The description PayPal's page shows (07-ZN line 15): "Invoice {number}", "Proforma invoice {number}", "Debit note {number}". */
export const payPalDescriptionOf = (type: PayPalDocumentType, documentNumber: string): string =>
  `${PAYPAL_DESCRIPTION_WORDS[type]} ${documentNumber}`;

export type OrderRequestInput = {
  /** Our `checkout_sessions` row (a UUIDv7): `reference_id`, `custom_id`, the end of `invoice_id` and the request id. */
  readonly checkoutId: string;
  /** USD cents. */
  readonly amountMinor: number;
  /** The document's number (`number_display`). */
  readonly documentNumber: string;
  readonly documentType: PayPalDocumentType;
  readonly returnUrl: string;
  readonly cancelUrl: string;
  /** Settings › Company's trade name (07-ZN line 15: "TecHaust Technologies"). */
  readonly brandName: string;
  /** P7: this Worker's `ENVIRONMENT`, carried in `custom_id` after the checkout id (`payPalCustomIdOf`). */
  readonly env: string;
};

export const ORDER_REQUEST_REFUSALS = [
  "amount_invalid",
  "reference_invalid",
  "description_too_long",
  "brand_invalid",
  "url_invalid",
] as const;
export type OrderRequestRefusal = (typeof ORDER_REQUEST_REFUSALS)[number];

/** The order body we send (only these fields: no payer, shipping, customer or vault field). */
export type PayPalOrderBody = {
  readonly intent: "CAPTURE";
  readonly purchase_units: readonly [
    {
      readonly reference_id: string;
      readonly custom_id: string;
      readonly invoice_id: string;
      readonly description: string;
      readonly amount: { readonly currency_code: "USD"; readonly value: string };
    },
  ];
  readonly payment_source: {
    readonly paypal: {
      readonly experience_context: {
        readonly brand_name: string;
        readonly shipping_preference: "NO_SHIPPING";
        readonly user_action: "PAY_NOW";
        readonly landing_page: "NO_PREFERENCE";
        readonly payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED";
        readonly return_url: string;
        readonly cancel_url: string;
      };
    };
  };
};

/**
 * Where PayPal may send the browser (L19, 2026-11-02: the return carries OUR checkout id, `c`): https (http only on localhost), no credentials, no fragment, and a
 * query that is exactly one of `markers`. Reaching the page proves nothing (ADR 0008): only our server's capture or a verified, re-fetched event moves money.
 */
function returnUrlOk(v: string, markers: readonly string[]): boolean {
  if (v.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "localhost")) return false;
  if (u.username || u.password || u.hash) return false;
  return markers.includes(u.search);
}

/** The return URL's query markers for checkout `id` (L19): the signed-in page (`pay=`) or the emailed link's return page (`via=`). */
export const payPalReturnMarkers = (id: string) =>
  ({
    return: [`?pay=paypal&c=${id}`, `?via=paypal&c=${id}`],
    cancel: [`?pay=paypal-cancel&c=${id}`, `?via=paypal&c=${id}&cancelled=1`],
  }) as const;

/**
 * The body of `POST /v2/checkout/orders` (run file B; L3, L10) and its `PayPal-Request-Id`, or a refusal: intent CAPTURE; one purchase unit in USD whose
 * `reference_id` is our checkout id, whose `custom_id` is our checkout id with this Worker's environment after it (P7, `payPalCustomIdOf`), and whose `invoice_id` is `<number>-<last 12 of the checkout id>` (unique per merchant account, and it
 * survives a staging database reset); the description of 07-ZN line 15; PayPal's hosted page only (`payment_source.paypal.experience_context`: no shipping, Pay
 * now, no preferred landing page, immediate payment required so an eCheck is not offered, our brand name, the two return URLs). No payer, shipping, customer or
 * vault field is ever sent. The amount is at least PayPal's 1 cent; our floor and the online maximum (`overseasOnlineMaxUsdMinor`, L11) are `payAmountVerdict`'s.
 */
export function orderRequestOf(
  i: OrderRequestInput,
):
  | { readonly ok: true; readonly body: PayPalOrderBody; readonly requestId: string }
  | { readonly ok: false; readonly code: OrderRequestRefusal } {
  const no = (code: OrderRequestRefusal) => ({ ok: false, code }) as const;
  const value = usdMinorToValue(i.amountMinor);
  if (value === null || i.amountMinor < PAYPAL_MIN_AMOUNT_MINOR) return no("amount_invalid");
  if (!isUuidV7(i.checkoutId) || !DOC_NUMBER.test(i.documentNumber) || !isEnvMark(i.env))
    return no("reference_invalid");
  if (!Object.hasOwn(PAYPAL_DESCRIPTION_WORDS, i.documentType)) return no("reference_invalid");
  const description = payPalDescriptionOf(i.documentType, i.documentNumber);
  if (description.length > PAYPAL_DESCRIPTION_MAX) return no("description_too_long");
  if (i.brandName.trim() === "" || i.brandName.length > PAYPAL_BRAND_MAX) return no("brand_invalid");
  const m = payPalReturnMarkers(i.checkoutId);
  if (!returnUrlOk(i.returnUrl, m.return) || !returnUrlOk(i.cancelUrl, m.cancel)) return no("url_invalid");
  return {
    ok: true,
    requestId: payPalOrderRequestId(i.checkoutId),
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: i.checkoutId,
          custom_id: payPalCustomIdOf(i.checkoutId, i.env),
          invoice_id: `${i.documentNumber}-${i.checkoutId.slice(-12)}`,
          description,
          amount: { currency_code: "USD", value },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: i.brandName,
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            landing_page: "NO_PREFERENCE",
            payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
            return_url: i.returnUrl,
            cancel_url: i.cancelUrl,
          },
        },
      },
    },
  };
}

/**
 * Whether `v` is PayPal's hosted approval page (L17, Vendor facts row 7: the `payer-action` link `…/checkoutnow?token=<order id>`): https, host exactly
 * `www.sandbox.paypal.com` or `www.paypal.com` (never a bare or look-alike host), path `/checkoutnow`, no credentials, port or fragment, at most 200 characters;
 * with `orderId`, its `token` must be that order; with `mode` (P7 A2.1), only that mode's host (`PAYPAL_CHECKOUT_HOSTS`). The portal and the finance Worker
 * refuse anything else (502), so a wrong answer never sends a browser elsewhere.
 */
export function isPayPalApproveUrl(v: unknown, orderId?: string, mode?: ProviderMode): boolean {
  if (typeof v !== "string" || v.length > PAYPAL_APPROVE_URL_MAX) return false;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash) return false;
    if (u.hostname !== "www.sandbox.paypal.com" && u.hostname !== "www.paypal.com") return false;
    // P7 A2.1: with a mode, only that mode's page (sandbox in test, live in live).
    if (mode !== undefined && u.hostname !== PAYPAL_CHECKOUT_HOSTS[mode]) return false;
    if (u.pathname !== "/checkoutnow") return false;
    return orderId === undefined || u.searchParams.get("token") === orderId;
  } catch {
    return false;
  }
}

/** P7 A2.1: PayPal's hosted page per mode (sandbox only in test mode, live only in live mode). */
export const PAYPAL_CHECKOUT_HOSTS = { test: "www.sandbox.paypal.com", live: "www.paypal.com" } as const;

// ---- the environment mark (P7, the analyst's Phase 7 finding 5) --------------------------------------------------------------------------------------------
// PayPal copies a purchase unit's `custom_id` to its captures (and so to the capture events), so the mark rides there: `<checkout id>-<environment>`, at most
// 36 + 1 + 16 characters (PayPal allows 127). The readers below split it again, so every `customId` downstream is still the bare checkout id (every existing
// comparison with our row's id is unchanged) and the environment is its own field, `envMark`. A `custom_id` without the suffix (an order made before P7, or a
// refund's own `custom_id`, our refund id) reads with `envMark` null: today's path.

/** `custom_id` of an order we make: our checkout id (a UUIDv7) and this Worker's environment. */
export const payPalCustomIdOf = (checkoutId: string, env: string): string => `${checkoutId}-${env}`;

const MARKED_CUSTOM_ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([a-z]{1,16})$/;

/** A `custom_id` as PayPal sends it, split: the checkout id and the environment mark when it is `<UUIDv7>-<env>`, else the text as it is with no mark. */
export function readPayPalMark(raw: string | null): {
  readonly customId: string | null;
  readonly envMark: string | null;
} {
  if (raw === null) return { customId: null, envMark: null };
  const m = MARKED_CUSTOM_ID.exec(raw);
  return m && isUuidV7(m[1])
    ? { customId: m[1] as string, envMark: m[2] as string }
    : { customId: raw, envMark: null };
}

// ---- reading what PayPal answers ---------------------------------------------------------------------------------------------------------------------

export const PAYPAL_ORDER_STATUSES = [
  "CREATED",
  "SAVED",
  "APPROVED",
  "VOIDED",
  "COMPLETED",
  "PAYER_ACTION_REQUIRED",
] as const;
export type PayPalOrderStatus = (typeof PAYPAL_ORDER_STATUSES)[number];
/** Capture statuses (Vendor facts row 11, CONFIRMED in the spec). An unknown status makes the read fail (a `refetch_failed` review, never a guess). */
export const PAYPAL_CAPTURE_STATUSES = [
  "COMPLETED",
  "DECLINED",
  "PARTIALLY_REFUNDED",
  "PENDING",
  "REFUNDED",
  "FAILED",
] as const;
export type PayPalCaptureStatus = (typeof PAYPAL_CAPTURE_STATUSES)[number];

/** How the payer paid on PayPal's page (L22): their PayPal account, a guest card, or something else. */
export type PayPalFundingSource = "paypal" | "card" | "other";

export type PayPalMoney = { readonly currency: string; readonly minor: number | null };

export type PayPalCapture = {
  readonly id: string;
  readonly status: PayPalCaptureStatus;
  /** `status_details.reason` (ECHECK, PENDING_REVIEW, RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION, …), or null. */
  readonly reason: string | null;
  readonly currency: string;
  /** Null when the currency is not USD or INR (the judge then answers `currency_mismatch`). */
  readonly amountMinor: number | null;
  /** `final_capture`, or null when absent. */
  readonly finalCapture: boolean | null;
  /** `create_time` as UTC ms. */
  readonly createdAt: number;
  /** Our checkout id from `custom_id` (the environment suffix split off: `readPayPalMark`). */
  readonly customId: string | null;
  /** P7: the environment `custom_id` names, or null (made before P7). */
  readonly envMark: string | null;
  readonly invoiceId: string | null;
  /** `supplementary_data.related_ids.order_id`, or null. */
  readonly orderId: string | null;
  /** `seller_receivable_breakdown.paypal_fee`, `.net_amount`, `.receivable_amount` (absent while pending: Vendor facts row 12). `exchange_rate` is never read (L8). */
  readonly fee: PayPalMoney | null;
  readonly net: PayPalMoney | null;
  readonly receivable: PayPalMoney | null;
};

export type PayPalOrder = {
  readonly id: string;
  readonly status: PayPalOrderStatus;
  /** The first purchase unit's marks and amount; null when the answer has no purchase unit (`Prefer: return=minimal`). */
  readonly referenceId: string | null;
  /** Our checkout id from `custom_id` (the environment suffix split off: `readPayPalMark`). */
  readonly customId: string | null;
  /** P7: the environment `custom_id` names, or null (made before P7). */
  readonly envMark: string | null;
  readonly invoiceId: string | null;
  readonly currency: string | null;
  readonly amountMinor: number | null;
  /** The `payer-action` (or `approve`) link when it passes `isPayPalApproveUrl` for this order, else null. */
  readonly payerActionUrl: string | null;
  readonly fundingSource: PayPalFundingSource | null;
  /**
   * The two-letter country codes PayPal reported for the payer or the card (`payer.address.country_code`, `payment_source.paypal.address.country_code`,
   * `payment_source.card.billing_address.country_code`, and the card's issuing country `payment_source.card.bin_details.bin_country_code`, RA-38 fact (1); which
   * of these PayPal fills is checked in the sandbox, Step 0, 08-C RA-38). Only the codes are read.
   */
  readonly countries: readonly string[];
  readonly captures: readonly PayPalCapture[];
};

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
/** An RFC 3339 time to UTC ms, else null. */
function timeOf(v: unknown): number | null {
  if (typeof v !== "string" || v.length > 64 || !RFC3339.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isSafeInteger(ms) ? ms : null;
}
const WORD = /^[A-Z][A-Z0-9_]{0,63}$/;
const COUNTRY = /^[A-Z]{2}$/;
const MARK = /^[\x20-\x7e]{1,255}$/;

/** An optional money field: absent is null, malformed is `undefined` (the read fails). */
function optMoney(v: unknown): PayPalMoney | null | undefined {
  if (v === undefined || v === null) return null;
  return moneyOf(v) ?? undefined;
}

/**
 * One capture (`GET /v2/payments/captures/{id}`, or an element of an order's `purchase_units[0].payments.captures`), else null when anything we rely on is
 * missing or malformed: an id, a known status, the amount, `create_time`. Reads no personal field.
 */
export function readPayPalCapture(obj: unknown): PayPalCapture | null {
  if (!isObj(obj)) return null;
  const id = str(obj.id, PAYPAL_CAPTURE_ID);
  const status = (PAYPAL_CAPTURE_STATUSES as readonly unknown[]).includes(obj.status)
    ? (obj.status as PayPalCaptureStatus)
    : null;
  const amount = moneyOf(obj.amount);
  const createdAt = timeOf(obj.create_time);
  if (!id || !status || !amount || createdAt === null) return null;
  if (obj.final_capture !== undefined && typeof obj.final_capture !== "boolean") return null;
  const sd = obj.status_details;
  const reason = isObj(sd) ? str(sd.reason, WORD) : null;
  const srb = obj.seller_receivable_breakdown;
  let fee: PayPalMoney | null = null;
  let net: PayPalMoney | null = null;
  let receivable: PayPalMoney | null = null;
  if (srb !== undefined && srb !== null) {
    if (!isObj(srb)) return null;
    const f = optMoney(srb.paypal_fee);
    const n = optMoney(srb.net_amount);
    const r = optMoney(srb.receivable_amount);
    if (f === undefined || n === undefined || r === undefined) return null;
    fee = f;
    net = n;
    receivable = r;
  }
  const supp = obj.supplementary_data;
  const related = isObj(supp) && isObj(supp.related_ids) ? supp.related_ids : null;
  return {
    id,
    status,
    reason,
    currency: amount.currency,
    amountMinor: amount.minor,
    finalCapture: typeof obj.final_capture === "boolean" ? obj.final_capture : null,
    createdAt,
    ...readPayPalMark(str(obj.custom_id, MARK)),
    invoiceId: str(obj.invoice_id, MARK),
    orderId: related ? str(related.order_id, PAYPAL_ORDER_ID) : null,
    fee,
    net,
    receivable,
  };
}

/** The country code at `path` inside `o`, if any. */
function countryAt(o: unknown, path: readonly string[]): string | null {
  let at: unknown = o;
  for (const k of path) {
    if (!isObj(at)) return null;
    at = at[k];
  }
  return str(at, COUNTRY);
}

/**
 * An order (`GET /v2/checkout/orders/{id}`, the capture's `return=representation` answer, or the create's `return=minimal` answer), else null when its id or
 * status is missing or unknown, or a field we read is malformed (a purchase unit's amount, a capture). A missing purchase unit is not an error (the minimal
 * answer has none): its fields are null and there are no captures. With `mode` (P7 A2.1), an approval link on the other mode's host is not read. Whitelist: the id, status, our marks, the amount, the approval link, how the payer paid, the
 * reported country codes and the captures; never the payer's name, email, address, phone or ids.
 */
export function readPayPalOrder(obj: unknown, mode?: ProviderMode): PayPalOrder | null {
  if (!isObj(obj)) return null;
  const id = str(obj.id, PAYPAL_ORDER_ID);
  const status = (PAYPAL_ORDER_STATUSES as readonly unknown[]).includes(obj.status)
    ? (obj.status as PayPalOrderStatus)
    : null;
  if (!id || !status) return null;
  let referenceId: string | null = null;
  let rawCustomId: string | null = null;
  let invoiceId: string | null = null;
  let currency: string | null = null;
  let amountMinor: number | null = null;
  const captures: PayPalCapture[] = [];
  const units = obj.purchase_units;
  if (units !== undefined) {
    if (!Array.isArray(units) || units.length !== 1 || !isObj(units[0])) return null;
    const u = units[0];
    referenceId = str(u.reference_id, MARK);
    rawCustomId = str(u.custom_id, MARK);
    invoiceId = str(u.invoice_id, MARK);
    if (u.amount !== undefined) {
      const m = moneyOf(u.amount);
      if (!m) return null;
      currency = m.currency;
      amountMinor = m.minor;
    }
    const pays = u.payments;
    if (pays !== undefined && pays !== null) {
      if (!isObj(pays)) return null;
      const list = pays.captures ?? [];
      if (!Array.isArray(list) || list.length > 10) return null;
      for (const c of list) {
        const read = readPayPalCapture(c);
        if (!read) return null;
        captures.push(read);
      }
    }
  }
  let payerActionUrl: string | null = null;
  if (Array.isArray(obj.links))
    for (const l of obj.links)
      if (
        isObj(l) &&
        (l.rel === "payer-action" || l.rel === "approve") &&
        isPayPalApproveUrl(l.href, id, mode)
      ) {
        payerActionUrl = l.href as string;
        break;
      }
  const ps = obj.payment_source;
  const fundingSource: PayPalFundingSource | null = isObj(ps)
    ? isObj(ps.paypal)
      ? "paypal"
      : isObj(ps.card)
        ? "card"
        : Object.keys(ps).length > 0
          ? "other"
          : null
    : null;
  const countries = [
    countryAt(obj, ["payer", "address", "country_code"]),
    countryAt(obj, ["payment_source", "paypal", "address", "country_code"]),
    countryAt(obj, ["payment_source", "card", "billing_address", "country_code"]),
    countryAt(obj, ["payment_source", "card", "bin_details", "bin_country_code"]),
  ].filter((c): c is string => c !== null);
  return {
    id,
    status,
    referenceId,
    ...readPayPalMark(rawCustomId),
    invoiceId,
    currency,
    amountMinor,
    payerActionUrl,
    fundingSource,
    countries,
    captures,
  };
}

// ---- the judge ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * Whether a PayPal payment is an export receipt for the LUT (RA-38's fact (1)): only when PayPal reported at least one payer or card country and none of them is
 * India. A country of IN, or none at all, is held pending as `not_export_receipt` in Needs review, never confirmed by the system (Settled by the lead on the safest
 * reading, 2026-11-02 (08-C RA-38): a payment with an India-issued card, or a PayPal payment of country IN or none, is not an inflow of foreign exchange).
 */
export const payPalExportReceipt = (countries: readonly string[]): boolean =>
  countries.length > 0 && countries.every((c) => c !== "IN");

export const PAYPAL_JUDGE_VERDICTS = [
  "reference_mismatch",
  "order_mismatch",
  "capture_pending",
  "capture_denied",
  "capture_refunded",
  // M6–M7 audit AU6 (B1 M1): PARTIALLY_REFUNDED before we first settled it: the money kept is recorded pending with a `refunded_outside` item (PayPal's capture
  // carries no refunded total, so the item says "part of it"); REFUNDED in full stays `capture_refunded` (the item only).
  "partly_refunded",
  "not_final",
  "not_export_receipt",
  "currency_mismatch",
  "amount_mismatch",
] as const;
export type PayPalJudgeVerdict = (typeof PAYPAL_JUDGE_VERDICTS)[number];
/**
 * The verdicts the finance Worker stores as a review kind of the same name (every verdict but `capture_refunded` and `partly_refunded`, both written as
 * `refunded_outside`). Each is in `REVIEW_KINDS` (`@techaust/core/online-pay`) and the 0068 triggers' list; `packages/core/test/paypal.test.ts` pins it (review
 * part 1, finding 1).
 */
export type PayPalReviewVerdict = Exclude<PayPalJudgeVerdict, "capture_refunded" | "partly_refunded">;
/** The judge's answer; `capture_refunded` and `partly_refunded` are their own branches so a caller that has handled them holds a `PayPalReviewVerdict`. */
export type PayPalJudgement =
  | { readonly ok: true }
  | { readonly ok: false; readonly verdict: "capture_refunded" }
  | { readonly ok: false; readonly verdict: "partly_refunded" }
  | { readonly ok: false; readonly verdict: PayPalReviewVerdict };

/** Our checkout row, as the judge needs it. */
export type PayPalCheckoutRow = {
  readonly id: string;
  /** PayPal's order id, stored when the row went live. */
  readonly providerLinkId: string | null;
  readonly currency: string;
  readonly amountMinor: number;
};

/**
 * Whether a capture PayPal answered (the capture call's own answer, which counts as the server-to-server proof, ADM-PAY-04; or, on the event path, the
 * re-fetched `GET`) settles `row` exactly, in this order:
 *   1. `reference_mismatch`: the capture's `custom_id` is not our checkout id (a missing one is accepted only when the order is given, is the row's, carries our
 *      checkout id as its `custom_id` and lists this capture), or its order is not the row's; the order, when given, is not the row's order or carries another
 *      `custom_id`;
 *   2. `order_mismatch`: the order, when given, does not list this capture;
 *   3. the money's state (before any amount, as M6.2 review finding 7): PENDING → `capture_pending`; DECLINED or FAILED → `capture_denied`; REFUNDED →
 *      `capture_refunded` (PARTIALLY_REFUNDED → `partly_refunded`, M6–M7 audit AU6, after step 5);
 *   4. `not_final`: `final_capture` false on our CAPTURE-intent order (more money may follow; nothing is confirmed on a part);
 *   5. `not_export_receipt`: no country reported, or India (RA-38; the countries come from the ORDER, so a judge without the order holds the payment: the event
 *      path re-fetches the order, never only the capture);
 *   6. `currency_mismatch`: the capture, the order or the row not in USD;
 *   7. `amount_mismatch`: the capture's (or the order's) amount is not the row's.
 * Nothing here moves money; the finance Worker records a mismatch pending with a review item (run file C step 8).
 */
export function judgePayPalCapture(
  row: PayPalCheckoutRow,
  order: PayPalOrder | null,
  capture: PayPalCapture,
): PayPalJudgement {
  const no = <V extends PayPalJudgeVerdict>(verdict: V) => ({ ok: false, verdict }) as const;
  // A capture inside the capture call's answer may carry no `custom_id` of its own (early check 1 finding 1; UNCONFIRMED, a sandbox check): it is ours only
  // through an order that is the row's, carries our mark and lists this capture. Both marks missing is a mismatch.
  const markedByOrder =
    order !== null &&
    order.id === row.providerLinkId &&
    order.customId === row.id &&
    order.captures.some((c) => c.id === capture.id);
  if (
    (capture.customId === null ? !markedByOrder : capture.customId !== row.id) ||
    row.providerLinkId === null ||
    (capture.orderId !== null && capture.orderId !== row.providerLinkId) ||
    (order !== null &&
      (order.id !== row.providerLinkId || (order.customId !== null && order.customId !== row.id)))
  )
    return no("reference_mismatch");
  if (order !== null && !order.captures.some((c) => c.id === capture.id)) return no("order_mismatch");
  if (capture.status === "PENDING") return no("capture_pending");
  if (capture.status === "DECLINED" || capture.status === "FAILED") return no("capture_denied");
  if (capture.status !== "COMPLETED" && capture.status !== "PARTIALLY_REFUNDED")
    return no("capture_refunded");
  if (capture.finalCapture === false) return no("not_final");
  if (!payPalExportReceipt(order?.countries ?? [])) return no("not_export_receipt");
  // AU6: after RA-38's test, whose tax consequence comes first.
  if (capture.status === "PARTIALLY_REFUNDED") return no("partly_refunded");
  if (
    capture.currency !== "USD" ||
    row.currency !== "USD" ||
    (order !== null && order.currency !== null && order.currency !== "USD")
  )
    return no("currency_mismatch");
  if (
    capture.amountMinor !== row.amountMinor ||
    (order !== null && order.amountMinor !== null && order.amountMinor !== row.amountMinor)
  )
    return no("amount_mismatch");
  return { ok: true };
}

// ---- capture errors (Step 0.4 row 10) ----------------------------------------------------------------------------------------------------------------

export const CAPTURE_ERRORS = [
  "already_captured",
  "instrument_declined",
  "not_approved",
  "not_found",
  "in_progress",
  "retry",
  "refused",
] as const;
export type CaptureErrorKind = (typeof CAPTURE_ERRORS)[number];
export type CaptureError = { readonly kind: CaptureErrorKind; readonly issue: string | null };

const DECLINED_ISSUES: readonly string[] = [
  "INSTRUMENT_DECLINED",
  "PAYER_ACTION_REQUIRED",
  "REDIRECT_PAYER_FOR_ALTERNATE_FUNDING",
];

/**
 * What a capture call's answer means (Step 0.4 row 10; reads `name` and `details[0].issue` only), or null for a capture made (200 or 201):
 *   - `already_captured`: 422 `ORDER_ALREADY_CAPTURED` (the caller GETs the order and reads its capture);
 *   - `instrument_declined`: 422 `INSTRUMENT_DECLINED`, `PAYER_ACTION_REQUIRED` or `REDIRECT_PAYER_FOR_ALTERNATE_FUNDING` (the payer picks another way on
 *     PayPal's page: the claim is released and `retryUrl` is the stored approval link);
 *   - `not_approved`: 422 `ORDER_NOT_APPROVED`;
 *   - `not_found`: 404 (`INVALID_RESOURCE_ID`, RESOURCE_NOT_FOUND). Never `expired` by itself: the order counts as expired only when a `GET` of it also answers
 *     404 (Step 0.4 row 10), which the caller does;
 *   - `in_progress`: 202, 409 (`PREVIOUS_REQUEST_IN_PROGRESS`) or 422 `ORDER_COMPLETION_IN_PROGRESS` (the claim is kept; it goes stale and the sweep re-fetches);
 *   - `retry`: no answer (status 0, a network error or a timeout), 429 or any 5xx;
 *   - `refused`: any other 4xx, `DUPLICATE_INVOICE_ID`, `TRANSACTION_REFUSED`, `PAYMENT_DENIED`, `MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED` and every issue we do
 *     not know (a review item `capture_refused`, never a guess).
 * `issue` is PayPal's issue (or name) code when it is a plain code, for the review item's facts.
 */
export function captureErrorOf(httpStatus: number, body: unknown): CaptureError | null {
  if (httpStatus === 200 || httpStatus === 201) return null;
  const b = isObj(body) ? body : {};
  const details = Array.isArray(b.details) ? b.details : [];
  const first = details.length > 0 && isObj(details[0]) ? details[0] : {};
  const issue = str(first.issue, WORD);
  const name = str(b.name, WORD);
  const code = issue ?? name;
  const out = (kind: CaptureErrorKind): CaptureError => ({ kind, issue: code });
  if (!Number.isSafeInteger(httpStatus) || httpStatus <= 0 || httpStatus === 429 || httpStatus >= 500)
    return out("retry");
  if (httpStatus === 202 || httpStatus === 409 || issue === "PREVIOUS_REQUEST_IN_PROGRESS")
    return out("in_progress");
  if (httpStatus === 404) return out("not_found");
  if (httpStatus === 422) {
    if (issue === "ORDER_ALREADY_CAPTURED") return out("already_captured");
    if (issue !== null && DECLINED_ISSUES.includes(issue)) return out("instrument_declined");
    if (issue === "ORDER_NOT_APPROVED") return out("not_approved");
    if (issue === "ORDER_COMPLETION_IN_PROGRESS") return out("in_progress");
  }
  return out("refused");
}

// ---- mapping a capture to a payment row ---------------------------------------------------------------------------------------------------------------

/** `payments.id` of a PayPal payment: `ppl_` and the capture id. */
export const payPalPaymentRowId = (captureId: string): string => `ppl_${captureId}`;

/** The longest `payments.reference_norm` (the applied CHECK of 0059, core `normaliseReference`). */
const REFERENCE_NORM_MAX = 60;

/**
 * `payments.reference_norm` of a PayPal payment: `PPL-` and the capture id (core `normaliseReference` form: upper case, `A-Z 0-9 / -`, at most 60). A longer form
 * becomes its first 44 characters, "-", and the first 12 hex characters of the exact id's SHA-256 in upper case (M6.3's rule for long ids). Null when it is not
 * a capture id.
 */
export async function payPalReferenceNorm(captureId: string): Promise<string | null> {
  if (!PAYPAL_CAPTURE_ID.test(captureId)) return null;
  const n = `PPL-${captureId}`;
  if (n.length <= REFERENCE_NORM_MAX) return n;
  const h = await sha256Hex(captureId);
  return `${n.slice(0, 44)}-${h.slice(0, 12).toUpperCase()}`;
}

/** `payments.mode` of a PayPal payment (L22: no new mode): a PayPal balance or account is `wallet`, a guest card `card`, anything else `other`. */
export const payPalModeOf = (source: PayPalFundingSource | null): "wallet" | "card" | "other" =>
  source === "paypal" ? "wallet" : source === "card" ? "card" : "other";

/**
 * `payments.received_on` of a PayPal payment (L9): the IST day of the capture's `create_time`, the earlier of the book entry and the bank credit (M6.2 L11).
 * Settled by the lead on the safest reading, 2026-11-01 (08-C RA-37).
 */
export const payPalReceivedOn = (captureCreatedMs: number): string => toIsoDate(istDate(captureCreatedMs));

/**
 * The fee and INR facts of a PayPal capture (Step 0 item 5; L8): the fee goes in the column of its own currency, `paypal_fee` in USD in `charges_minor`, in INR
 * in `gateway_fee_inr_minor` (the 0068 shape allows exactly one); `inr_received_minor` takes `receivable_amount` only when it is in INR and positive: the column
 * means "INR credited as advised" (L29: PayPal's is net of its fee, Stripe's gross). The fee is absorbed, never billed (M6.1 L9: absorbing the fee is a
 * commercial choice). OPEN (08-C RA-29): is GST charged on the MDR and invoiced to our GSTIN?
 * `exchange_rate` is never stored and never used for GST (Rule 34 values stay the invoice's).
 */
export function payPalFeeFactsOf(c: Pick<PayPalCapture, "fee" | "receivable">): {
  readonly chargesMinor: number;
  readonly gatewayFeeInrMinor: number | null;
  readonly inrReceivedMinor: number | null;
} {
  const fee = c.fee?.minor ?? null;
  const usdFee = c.fee?.currency === "USD" && fee !== null && fee >= 0 ? fee : 0;
  const inrFee = c.fee?.currency === "INR" && fee !== null && fee >= 0 ? fee : null;
  const r = c.receivable;
  return {
    chargesMinor: usdFee,
    gatewayFeeInrMinor: inrFee,
    inrReceivedMinor: r && r.currency === "INR" && r.minor !== null && r.minor > 0 ? r.minor : null,
  };
}

// ---- webhooks: the offline signature (L1, L20) --------------------------------------------------------------------------------------------------------

/** PayPal's event names to ours (Step 0.4 row 19). `PAYMENT.CAPTURE.DENIED` is v1 and marketplaces only: mapped, never subscribed (H3). Anything else is `other`. */
export const PAYPAL_EVENT_TYPES: Readonly<Record<string, ProviderEventType>> = {
  "CHECKOUT.ORDER.APPROVED": "checkout.approved",
  "CHECKOUT.PAYMENT-APPROVAL.REVERSED": "checkout.approval_reversed",
  "PAYMENT.CAPTURE.COMPLETED": "payment.captured",
  "PAYMENT.CAPTURE.PENDING": "payment.pending",
  "PAYMENT.CAPTURE.DECLINED": "payment.failed",
  "PAYMENT.CAPTURE.DENIED": "payment.failed",
  "PAYMENT.CAPTURE.REFUNDED": "refund.processed",
  "PAYMENT.CAPTURE.REVERSED": "payment.reversed",
};

/** The IEEE CRC-32 table, built once per isolate at module load. */
const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** The IEEE CRC-32 of `bytes` as an unsigned integer (PayPal's signed text carries it in decimal: "123456789" → 3421780262). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The text PayPal signs (Step 0.4 row 17, as PayPal's sample writes it: no spaces). */
export const payPalSignedMessage = (
  transmissionId: string,
  transmissionTime: string,
  webhookId: string,
  crc: number,
): string => `${transmissionId}|${transmissionTime}|${webhookId}|${crc}`;

/** The literal id PayPal's webhook simulator signs with (Step 0.4 row 21): never accepted as our webhook id. */
export const SIMULATOR_WEBHOOK_ID = "WEBHOOK_ID";

/** Our webhook id as `set-gateway-keys.ps1` stores it: letters and digits, at most 50 (the spec's `webhook_id`), never the simulator's literal. */
export const isPayPalWebhookId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9]{1,50}$/.test(v) && v !== SIMULATOR_WEBHOOK_ID;

/** The certificate's path (Step 0.4 row 17's sandbox example `/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d`). */
const CERT_PATH = /^\/v1\/notifications\/certs\/CERT-[A-Za-z0-9-]{1,64}$/;
/** P7 A2.1: the certificate host per mode (the sandbox's from Step 0.4 row 17; the live one re-read before go-live). */
export const PAYPAL_CERT_HOSTS = { test: "api.sandbox.paypal.com", live: "api.paypal.com" } as const;
/** The local simulator's certificate (`scripts/pay-simulate.mjs --paypal`), accepted only with `local` (the hook passes `ENVIRONMENT === "local"`). */
const LOCAL_CERT = /^http:\/\/localhost:\d{2,5}\/__paypal-test-cert$/;

/**
 * Whether `PAYPAL-CERT-URL` may be fetched (L20: the host allow-list and TLS authenticate the source; PayPal documents no chain check): https, host exactly
 * `api.sandbox.paypal.com` (Step 0.4 row 17) or `api.paypal.com` (the live host, re-read at Phase 7), path `/v1/notifications/certs/CERT-…`, no credentials,
 * port, query or fragment, at most 500 characters. With `local`, also the local simulator's `http://localhost:<port>/__paypal-test-cert`. With `mode` (P7 A2.1:
 * the hook passes the mode it runs in), only that mode's host: `api.sandbox.paypal.com` in test, `api.paypal.com` in live (`PAYPAL_CERT_HOSTS`).
 */
export function isPayPalCertUrl(
  v: unknown,
  opts: { readonly local?: boolean; readonly mode?: ProviderMode } = {},
): v is string {
  if (typeof v !== "string" || v.length > 500) return false;
  if (opts.local === true && LOCAL_CERT.test(v)) return true;
  try {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      (opts.mode === undefined
        ? u.hostname === PAYPAL_CERT_HOSTS.test || u.hostname === PAYPAL_CERT_HOSTS.live
        : u.hostname === PAYPAL_CERT_HOSTS[opts.mode]) &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.search &&
      !u.hash &&
      !v.includes("?") &&
      !v.includes("#") &&
      CERT_PATH.test(u.pathname)
    );
  } catch {
    return false;
  }
}

export const PAYPAL_SIGNATURE_VERDICTS = [
  "ok",
  "signature_missing",
  "webhook_id_invalid",
  "cert_unavailable",
  "signature_invalid",
  /** Review part 1, finding 12: the five headers present and well formed, the certificate URL refused (the hook answers 400 `signature_missing`, counted). */
  "cert_url_refused",
  /** P7 early check (M1): the gateway's mode could not be read (the hook answers 503 `mode_unavailable`, nothing written, not counted). */
  "mode_unavailable",
] as const;
export type PayPalSignatureVerdict = (typeof PAYPAL_SIGNATURE_VERDICTS)[number];

/** Base64 of at most 500 characters (the spec's `transmission_sig`), decoded; else null. */
function base64Bytes(v: string): Uint8Array<ArrayBuffer> | null {
  if (v.length === 0 || v.length > 500 || v.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v))
    return null;
  try {
    const bin = atob(v);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The five headers PayPal signs with (Vendor facts row 16), lower-cased as the hook reads them. */
export const PAYPAL_SIGNATURE_HEADERS = [
  "paypal-transmission-id",
  "paypal-transmission-time",
  "paypal-transmission-sig",
  "paypal-cert-url",
  "paypal-auth-algo",
] as const;

export type PayPalSignatureInput = {
  /** The RAW request body (never re-serialised JSON). */
  readonly bytes: Uint8Array;
  /** The request's headers, names lower-cased. */
  readonly headers: Readonly<Record<string, string | null | undefined>>;
  /** `PAYPAL_WEBHOOK_ID` of the jobs Worker. */
  readonly webhookId: string | null | undefined;
  /** The verifying key of an allow-listed certificate URL (fetched and cached by the hook), or null when it can't be had. Core never fetches. */
  readonly keyFor: (certUrl: string) => Promise<RsaKey | null>;
  /** Accept the local simulator's certificate URL (`ENVIRONMENT === "local"` only). */
  readonly local?: boolean;
  /** P7 A2.1: the mode the hook runs in; only that mode's certificate host is accepted (absent: either host, the M6.4 rule). */
  readonly mode?: ProviderMode;
  /**
   * P7 early check (M1, L2): the mode, asked for lazily, only after the transmission id, time and signature are well formed (the hook reads Settings ›
   * Gateways then, and only while the go-live flag is "true"); null: it couldn't be read → `mode_unavailable` (the hook answers 503, PayPal retries). Wins over `mode`.
   */
  readonly modeOf?: () => Promise<ProviderMode | null>;
};

/**
 * PayPal's offline webhook check (L1; Step 0.4 row 17), in this order:
 *   1. our webhook id unset, malformed, or the simulator's literal `WEBHOOK_ID` → `webhook_id_invalid` (the hook answers 503, nothing written);
 *   2. a header missing or malformed → `signature_missing` (not counted): the transmission id 1 to 50 of letters, digits and "-", the time RFC 3339 of at most
 *      100 characters, the signature base64 of at most 500, the certificate URL allow-listed (`isPayPalCertUrl`), and `PAYPAL-AUTH-ALGO`, when sent, exactly
 *      `SHA256withRSA` (we fix the algorithm ourselves and never follow the header); but all five present and well formed with only the certificate URL
 *      refused → `cert_url_refused` (counted, review part 1 finding 12);
 *   3. no key for the certificate → `cert_unavailable` (503: PayPal retries);
 *   4. RSASSA-PKCS1-v1_5 with SHA-256 over `${id}|${time}|${webhookId}|${crc32(raw bytes)}` → `ok`, else `signature_invalid` (counted).
 * The separator "|" can't appear in any field, so the signed text has one reading. No transmission-time tolerance (L16: a replay is idempotent).
 */
export async function verifyPayPalSignature(i: PayPalSignatureInput): Promise<PayPalSignatureVerdict> {
  if (!isPayPalWebhookId(i.webhookId)) return "webhook_id_invalid";
  const h = (k: string) => {
    const v = i.headers[k];
    return typeof v === "string" ? v : null;
  };
  const id = h("paypal-transmission-id");
  const time = h("paypal-transmission-time");
  const sigText = h("paypal-transmission-sig");
  const certUrl = h("paypal-cert-url");
  const algo = h("paypal-auth-algo");
  if (
    id === null ||
    !/^[A-Za-z0-9-]{1,50}$/.test(id) ||
    time === null ||
    time.length > 100 ||
    !RFC3339.test(time) ||
    sigText === null ||
    (algo !== null && algo !== "SHA256withRSA")
  )
    return "signature_missing";
  const sig = base64Bytes(sigText);
  if (!sig) return "signature_missing";
  // P7 early check (L2): the mode is asked for only now, once the cheap header checks passed, so an anonymous post costs no D1 read; it can't be read → 503.
  let mode = i.mode;
  if (i.modeOf) {
    const m = await i.modeOf();
    if (m === null) return "mode_unavailable";
    mode = m;
  }
  // Review part 1, finding 12: every other header present and well formed, only the certificate URL refused: counted (a misrouted or forged signed post, or
  // PayPal moving its certificates to a host we don't allow), never fetched.
  if (!isPayPalCertUrl(certUrl, { local: i.local === true, ...(mode ? { mode } : {}) }))
    return certUrl !== null && algo !== null ? "cert_url_refused" : "signature_missing";
  let key: RsaKey | null;
  try {
    key = await i.keyFor(certUrl);
  } catch {
    key = null;
  }
  if (!key) return "cert_unavailable";
  const message = enc.encode(payPalSignedMessage(id, time, i.webhookId, crc32(i.bytes)));
  try {
    return (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, message)) ? "ok" : "signature_invalid";
  } catch {
    return "signature_invalid";
  }
}

// ---- the certificate: a pure DER reader (Step 0.3: no `node:crypto` in the jobs bundle) ---------------------------------------------------------------

/** The largest certificate the hook keeps (the hook's fetch reads at most 16 KiB). */
export const PAYPAL_CERT_MAX_BYTES = 16_384;

type Tlv = { readonly tag: number; readonly at: number; readonly start: number; readonly end: number };

/** One DER element at `at` inside `[at, limit)`: its tag, header start, content start and end; null when malformed or past the limit. */
function tlv(b: Uint8Array, at: number, limit: number): Tlv | null {
  if (at + 2 > limit) return null;
  const tag = b[at] as number;
  if ((tag & 0x1f) === 0x1f) return null;
  let len = b[at + 1] as number;
  let p = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 3 || p + n > limit) return null;
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + (b[p++] as number);
  }
  const end = p + len;
  return end > limit ? null : { tag, at, start: p, end };
}

/** The first `-----BEGIN CERTIFICATE-----` block of `pem` as DER bytes, else null (at most `PAYPAL_CERT_MAX_BYTES`). */
export function pemToDer(pem: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof pem !== "string" || pem.length > PAYPAL_CERT_MAX_BYTES) return null;
  const m = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/.exec(pem);
  if (!m) return null;
  const b64 = (m[1] as string).replace(/\s+/g, "");
  if (b64.length === 0 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The parts of a certificate the hook needs: the validity window (UTC ms) and the SubjectPublicKeyInfo (DER), RSA only. */
export type CertParts = {
  readonly notBefore: number;
  readonly notAfter: number;
  readonly spki: Uint8Array<ArrayBuffer>;
};

/** UTCTime (YYMMDDHHMMSSZ; 50–99 → 19YY) or GeneralizedTime (YYYYMMDDHHMMSSZ) to UTC ms, else null. */
function derTime(b: Uint8Array, t: Tlv): number | null {
  let s = "";
  for (let i = t.start; i < t.end; i++) s += String.fromCharCode(b[i] as number);
  const m =
    t.tag === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s)
      : t.tag === 0x18
        ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s)
        : null;
  if (!m) return null;
  const y = Number.parseInt(m[1] as string, 10);
  const year = t.tag === 0x18 ? y : y >= 50 ? 1900 + y : 2000 + y;
  const [mo, d, hh, mi, ss] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number.parseInt(x as string, 10)) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) return null;
  return Date.UTC(year, mo - 1, d, hh, mi, ss);
}

/** rsaEncryption, 1.2.840.113549.1.1.1, as its DER OID bytes. */
const RSA_OID = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01] as const;

/**
 * The validity and RSA public key of an X.509 certificate in DER (Certificate → tbsCertificate → [version], serial, signature algorithm, issuer, validity,
 * subject, subjectPublicKeyInfo), else null when the structure is not that, a length runs past its parent, or the key is not RSA. Nothing else is read: no chain,
 * no extension (L20).
 */
export function certParts(der: Uint8Array): CertParts | null {
  if (der.length > PAYPAL_CERT_MAX_BYTES) return null;
  const cert = tlv(der, 0, der.length);
  if (cert?.tag !== 0x30 || cert.end !== der.length) return null;
  const tbs = tlv(der, cert.start, cert.end);
  if (tbs?.tag !== 0x30) return null;
  const items: Tlv[] = [];
  for (let p = tbs.start; p < tbs.end && items.length < 8; ) {
    const e = tlv(der, p, tbs.end);
    if (!e) return null;
    items.push(e);
    p = e.end;
  }
  const off = items[0]?.tag === 0xa0 ? 1 : 0;
  const [serial, sigAlg, issuer, validity, subject, spki] = items.slice(off, off + 6);
  if (
    serial?.tag !== 0x02 ||
    sigAlg?.tag !== 0x30 ||
    issuer?.tag !== 0x30 ||
    validity?.tag !== 0x30 ||
    subject?.tag !== 0x30 ||
    spki?.tag !== 0x30
  )
    return null;
  const nb = tlv(der, validity.start, validity.end);
  const na = nb ? tlv(der, nb.end, validity.end) : null;
  if (!nb || !na || na.end !== validity.end) return null;
  const notBefore = derTime(der, nb);
  const notAfter = derTime(der, na);
  if (notBefore === null || notAfter === null || notAfter < notBefore) return null;
  const alg = tlv(der, spki.start, spki.end);
  const oid = alg && alg.tag === 0x30 ? tlv(der, alg.start, alg.end) : null;
  if (oid?.tag !== 0x06 || oid.end - oid.start !== RSA_OID.length) return null;
  for (let i = 0; i < RSA_OID.length; i++) if (der[oid.start + i] !== RSA_OID[i]) return null;
  return { notBefore, notAfter, spki: der.slice(spki.at, spki.end) };
}

/** Whether `now` (UTC ms) is inside the certificate's validity window (notBefore ≤ now ≤ notAfter). */
export const certValidAt = (parts: Pick<CertParts, "notBefore" | "notAfter">, now: number): boolean =>
  parts.notBefore <= now && now <= parts.notAfter;

/** A certificate's verifying key and the end of its validity (UTC ms): a cache entry must not outlive `notAfter` (early check 1 finding 3). */
export type PayPalCertKey = { readonly key: RsaKey; readonly notAfter: number };

/**
 * The verifying key of a PEM certificate valid at `now` (WebCrypto `importKey("spki", …, RSASSA-PKCS1-v1_5, SHA-256)`) with its `notAfter`, else null: not a
 * certificate, not RSA, outside its validity window, or a key WebCrypto refuses. The hook fetches the PEM from an allow-listed URL and caches the entry per
 * isolate until `min(notAfter, fetched + TTL)`, re-checking `notAfter` on every hit.
 */
export async function importPayPalCertKey(pem: unknown, now: number): Promise<PayPalCertKey | null> {
  const der = pemToDer(pem);
  const parts = der ? certParts(der) : null;
  if (!parts || !certValidAt(parts, now)) return null;
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      parts.spki,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return { key, notAfter: parts.notAfter };
  } catch {
    return null;
  }
}

// ---- reading a verified event -----------------------------------------------------------------------------------------------------------------------

/** PayPal's event id (`WH-…`, L15) as `webhook_events.event_id`, else null (the hook then uses M6.2's `fallbackEventId` of the body). */
export const payPalEventIdOf = (id: unknown): string | null =>
  typeof id === "string" && /^WH-[A-Za-z0-9-]{1,61}$/.test(id) ? id : null;

export type PayPalEvent = {
  /** `payPalEventIdOf` of the event's id, or null. */
  readonly id: string | null;
  readonly type: ProviderEventType;
  /** PayPal's event name as sent (≤ 64). */
  readonly name: string;
  /** The event's `create_time` (UTC ms), or null. */
  readonly occurredAt: number | null;
  /** The order the event is about: `resource.id` of a CHECKOUT.ORDER.* event, `related_ids.order_id` of a capture event. */
  readonly orderRef: string | null;
  /** The capture the event is about (a capture event's `resource.id`; a refund's `up` link). */
  readonly captureRef: string | null;
  /** A refund's own id (a refund event whose resource is the refund). */
  readonly refundRef: string | null;
  /** Our mark: the capture's `custom_id`, or the order's first purchase unit's (the environment suffix split off: `readPayPalMark`). */
  readonly customId: string | null;
  /** P7: the environment `custom_id` names, or null (made before P7, or a refund's own `custom_id`). */
  readonly envMark: string | null;
  readonly invoiceId: string | null;
  /** `resource.status` (a plain code), or null. */
  readonly status: string | null;
  readonly currency: string | null;
  readonly amountMinor: number | null;
};

export type ParsedPayPalEvent =
  | { readonly ok: true; readonly value: PayPalEvent }
  | { readonly ok: false; readonly code: "invalid_event" };

const INVALID: ParsedPayPalEvent = Object.freeze({ ok: false, code: "invalid_event" } as const);

/** The capture id of a refund's `up` link (`…/v2/payments/captures/{id}`), else null. */
function upCaptureOf(links: unknown): string | null {
  if (!Array.isArray(links)) return null;
  for (const l of links) {
    if (!isObj(l) || l.rel !== "up" || typeof l.href !== "string" || l.href.length > 500) continue;
    const m = /\/v2\/payments\/captures\/([A-Z0-9]{1,64})$/.exec(l.href);
    if (m) return m[1] as string;
  }
  return null;
}

/**
 * A VERIFIED webhook body (already `JSON.parse`d) to an event, else `invalid_event`: it needs an `event_type` (1 to 64 of capitals, digits, `.`, `_`, `-`) and a
 * `resource` object. By type:
 *   - `checkout.approved`, `checkout.approval_reversed`: the order id is `resource.id` (required); our mark and the amount come from its first purchase unit;
 *   - `payment.captured`, `payment.pending`, `payment.failed`: the capture id is `resource.id` and the order id `supplementary_data.related_ids.order_id` (both
 *     required); the mark and amount are the capture's own;
 *   - `refund.processed`, `payment.reversed`: the capture is the resource's `up` link (a refund) or the resource itself when it names its order (required: re-check
 *     N3, Step 0.4 "Refund custom_id"); the refund's id and `invoice_id` are kept for the finance Worker's match;
 *   - `other`: nothing is required; the mark is still read, so the hook can tell ours from not ours.
 * Never reads payer data.
 */
export function parsePayPalEvent(obj: unknown): ParsedPayPalEvent {
  if (!isObj(obj)) return INVALID;
  const name = str(obj.event_type, /^[A-Z0-9_.-]{1,64}$/);
  const r = obj.resource;
  if (!name || !isObj(r)) return INVALID;
  const type = PAYPAL_EVENT_TYPES[name] ?? "other";
  const unit = Array.isArray(r.purchase_units) && isObj(r.purchase_units[0]) ? r.purchase_units[0] : null;
  const supp = r.supplementary_data;
  const related = isObj(supp) && isObj(supp.related_ids) ? supp.related_ids : null;
  const orderOfCapture = related ? str(related.order_id, PAYPAL_ORDER_ID) : null;
  const money = moneyOf(unit ? unit.amount : r.amount);
  let orderRef: string | null = null;
  let captureRef: string | null = null;
  let refundRef: string | null = null;
  if (type === "checkout.approved" || type === "checkout.approval_reversed") {
    orderRef = str(r.id, PAYPAL_ORDER_ID);
    if (!orderRef) return INVALID;
  } else if (type === "payment.captured" || type === "payment.pending" || type === "payment.failed") {
    captureRef = str(r.id, PAYPAL_CAPTURE_ID);
    orderRef = orderOfCapture;
    if (!captureRef || !orderRef) return INVALID;
  } else if (type === "refund.processed" || type === "payment.reversed") {
    const up = upCaptureOf(r.links);
    if (up) {
      captureRef = up;
      refundRef = str(r.id, PAYPAL_CAPTURE_ID);
    } else if (orderOfCapture) captureRef = str(r.id, PAYPAL_CAPTURE_ID);
    orderRef = orderOfCapture;
    if (!captureRef) return INVALID;
  }
  return {
    ok: true,
    value: {
      id: payPalEventIdOf(obj.id),
      type,
      name,
      occurredAt: timeOf(obj.create_time),
      orderRef,
      captureRef,
      refundRef,
      ...readPayPalMark(str(unit ? unit.custom_id : r.custom_id, MARK)),
      invoiceId: str(unit ? unit.invoice_id : r.invoice_id, MARK),
      status: str(r.status, WORD),
      currency: money?.currency ?? null,
      amountMinor: money?.minor ?? null,
    },
  };
}

/**
 * Whether an event is ours (reviewer X3, L13; the hook's step 9): `ours` when its `custom_id` is a UUIDv7 (our checkout ids); `by_capture` for a refund or
 * reversal without a mark but with its capture (re-check N3: kept as received, and the finance Worker finds the payment by the capture, or ignores it);
 * `not_ours` otherwise (200 with nothing written: another use of the same PayPal account). P7 (finding 5): with `env` (this Worker's `ENVIRONMENT`), an event
 * whose mark names another environment is `other_env` first (the hook stores it `ignored`, nothing else); an unmarked one keeps the rules above.
 */
export function payPalEventOwnership(
  e: PayPalEvent,
  env?: string,
): "ours" | "by_capture" | "not_ours" | "other_env" {
  if (env !== undefined && e.envMark !== null && e.envMark !== env) return "other_env";
  if (isUuidV7(e.customId)) return "ours";
  if ((e.type === "refund.processed" || e.type === "payment.reversed") && e.captureRef !== null)
    return "by_capture";
  return "not_ours";
}

/** The `invoice_id` a stored event keeps (review part 1, finding 4): at most 127 of letters, digits, "/", "_" and "-" (PayPal's limit is 127). */
export const PAYPAL_INVOICE_ID_FACT = /^[A-Za-z0-9/_-]{1,127}$/;

/** The last 12 characters of the checkout id at the end of an `invoice_id` we made (L3, `<number>-<12>`), else null (the refund match's fallback). */
export const invoiceIdCheckoutTail = (invoiceId: string | null): string | null => {
  const m = invoiceId === null ? null : /-([0-9a-f]{12})$/.exec(invoiceId);
  return m ? (m[1] as string) : null;
};

/**
 * The whitelisted facts of an event, as `webhook_events.facts` stores them (ADM-PAY-12, L7; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)): the
 * event name, the order (`linkId`: the generic key the dead-letter and review readers join on, `provider_link_id`), the capture (`paymentId`: what
 * `provider_payment_id` holds), a refund's id, the amount and currency (only USD or INR, positive), the resource's status and our checkout id. Never payer data
 * or the raw payload.
 */
export function payPalEventFacts(e: PayPalEvent): Record<string, string | number> {
  const f: Record<string, string | number> = { event: e.name };
  if (e.orderRef) f.linkId = e.orderRef;
  if (e.captureRef) f.paymentId = e.captureRef;
  if (e.refundRef) f.refundId = e.refundRef;
  if (e.amountMinor !== null && e.amountMinor > 0 && (e.currency === "USD" || e.currency === "INR")) {
    f.amountMinor = e.amountMinor;
    f.currency = e.currency;
  }
  if (e.status) f.status = e.status;
  if (isUuidV7(e.customId)) f.checkoutId = e.customId;
  // P7: the environment mark, so the finance Worker can refuse another environment's event too (defence in depth; the hook already does).
  if (e.envMark !== null) f.env = e.envMark;
  // Review part 1, finding 4: a refund's `invoice_id` (ours is `<number>-<last 12 of the checkout id>`, L3), kept only in a safe shape so the finance Worker can
  // match its tail; not personal data (Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)).
  if (e.invoiceId !== null && PAYPAL_INVOICE_ID_FACT.test(e.invoiceId)) f.invoiceId = e.invoiceId;
  return f;
}
