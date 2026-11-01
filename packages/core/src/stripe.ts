// Stripe in test mode, pure (M6.3; ADM-PAY-01, -03, -07, -11, -12, JOB-HOOK-01..03, POR-06; run file docs/runs/m6.3-stripe.md B). No `fetch` and no zod here: the
// admin finance Worker's client (`apps/admin/worker/gateway/stripe.ts`, stage B2) calls Stripe's API with plain `fetch` (no `stripe` package, L2), and the jobs
// Worker's hook verifies Stripe's webhooks; both use these helpers, so the rules sit in one place and are tested without a network. Subpath export only
// (`@techaust/core/stripe`), kept small because the jobs hook imports the verifier. Money in integer minor units only (`test/no-floats.test.ts` lists this file).
//
// What Stripe's own sources say, as read for this file (run file "Vendor facts", fetched 2026-11-01; B2 re-reads the pages marked UNCONFIRMED there):
//   - the webhook signature (V6, CONFIRMED from stripe-node `src/Webhooks.ts`): the `Stripe-Signature` header is split on "," and each item at "="; `t` is the
//     timestamp and every `v1` a candidate; the signed text is `${t}.${rawBody}`; HMAC-SHA256 in hex, keyed with the UTF-8 bytes of the whole secret string
//     (`whsec_` included, never base64-decoded); any candidate matching passes; tolerance 300 s, checked after the signature;
//   - Checkout Session create (V1, CONFIRMED in Stripe's OpenAPI spec 2026-09-30.endive): `expires_at` 30 minutes to 24 hours ahead; `client_reference_id` ≤ 200;
//     `payment_intent_data.description` ≤ 1000; `statement_descriptor_suffix` ≤ 22 (a card charge refuses `statement_descriptor`, V4);
//   - the session (V2): `status` open | complete | expired, `payment_status` paid | unpaid | no_payment_required; a balance transaction's `fee_details[].type`
//     includes `tax` (V14).
// Personal data (ADM-PAY-12; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)): nothing here reads `customer_details` (the payer's name, email,
// address) or any card field; only ids, amounts, currencies and states leave these readers. Card credentials are never seen, sent or stored (Researched 2026-10-28,
// RBI PA Directions 2025, Annex 1 2.1 (08-C RB-07)).

import { istDate, toIsoDate } from "./dates.ts";
import { sha256Hex } from "./hash.ts";
import { hex32, hmacSignKey, hmacVerifyKey, toHex } from "./hmac.ts";
import { UUID } from "./ids.ts";
import { liveModeAllowed, type ProviderEventType, type ProviderMode } from "./payments.ts";

/** The only host the client calls (the key guard runs before any call). */
export const STRIPE_API_ORIGIN = "https://api.stripe.com";

/**
 * The API version every request sends as `Stripe-Version`, and the version the webhook endpoint is created with (L15, H3): the newest in Stripe's official
 * OpenAPI spec read for the brief (`info.version` of spec3.json, V8). Pinned, so a change of Stripe's account default never changes what we read.
 */
export const STRIPE_API_VERSION = "2026-09-30.endive";

/** Stripe's smallest USD charge, 50 cents (V19, CONFIRMED by B2's re-read of docs.stripe.com/currencies, 2026-11-02; the portal's floor of USD 100 is far above it). */
export const STRIPE_MIN_AMOUNT_MINOR = 50;

/**
 * The most `v1` values a header may carry (early check 1, F2): Stripe sends one per active signing secret (two while a secret is rolled); more than this is
 * `signature_malformed` before any HMAC is computed, so a padded header never costs secrets × candidates verifications. A repeated value is tried once.
 */
export const STRIPE_MAX_V1 = 4;

/** The signature tolerance either way (stripe-node's default for the past; we refuse the future too: L2). */
export const STRIPE_TOLERANCE_SEC = 300;

const enc = new TextEncoder();
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** A safe integer ≥ 0, else null. */
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const str = (v: unknown, re: RegExp): string | null => (typeof v === "string" && re.test(v) ? v : null);

// Stripe object ids: a prefix, an underscore and up to 255 characters in all (V12: ids are up to 255; length may grow).
const EVENT_ID = /^evt_[A-Za-z0-9_]{1,251}$/;
const SESSION_ID = /^cs_[A-Za-z0-9_]{1,252}$/;
const PI_ID = /^pi_[A-Za-z0-9_]{1,252}$/;
// Lower case, digits (a future event name may carry one: early check 1, F3), underscores and dots; an unknown name maps to `other` and is ignored with 200.
const EVENT_TYPE = /^[a-z0-9_.]{1,64}$/;
const ENV = /^[a-z]{1,16}$/;
const DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CURRENCY = /^[a-z]{3}$/;
/** Seconds since 1970 up to the year 3000, as UTC ms; else null. */
const secondsToMs = (v: unknown): number | null => {
  const s = count(v);
  return s === null || s > 32_503_680_000 ? null : s * 1000;
};
const isUuidV7 = (v: unknown): v is string => typeof v === "string" && UUID.test(v) && v[14] === "7";

// ---- the webhook signature ------------------------------------------------------------------------------------------------------------------------------

export const SIGNATURE_VERDICTS = [
  "ok",
  "signature_missing",
  "signature_malformed",
  "signature_invalid",
  "timestamp_out_of_tolerance",
] as const;
export type SignatureVerdict = (typeof SIGNATURE_VERDICTS)[number];

/**
 * Whether `header` (`Stripe-Signature`) signs `rawBody` (the RAW request text or bytes, never re-serialised JSON) under one of `secrets` (the current webhook secret,
 * then the previous one while it is rotated: `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_PREVIOUS`), as stripe-node's `constructEventAsync` reads it (V6):
 *   - the header is split on "," and each item at its FIRST "=", with no trimming (a space after a comma makes the key " t", which is not `t`, as in stripe-node);
 *   - `t` must be 1 to 12 digits, else `signature_malformed`; every `v1` is a candidate and other schemes are ignored; none, or more than `STRIPE_MAX_V1` (4):
 *     `signature_malformed`; a repeated candidate is tried once;
 *   - the signed text is `${t}.` and the raw body; HMAC-SHA256 keyed with the UTF-8 bytes of the whole secret (`whsec_` included);
 *   - each candidate is hex-decoded first (anything but 64 hex characters is skipped) and compared with `crypto.subtle.verify`, never as text;
 *   - every secret is tried against every candidate; no match: `signature_invalid`;
 *   - only then the timestamp: more than `toleranceSec` (300) away from `nowMs` in EITHER direction is `timestamp_out_of_tolerance` (a replay). stripe-node accepts
 *     any future timestamp; we do not (L2).
 * Empty secrets are skipped; no secret at all never verifies.
 */
export async function verifyStripeSignature(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  secrets: readonly (string | null | undefined)[],
  nowMs: number,
  toleranceSec: number = STRIPE_TOLERANCE_SEC,
): Promise<SignatureVerdict> {
  if (typeof header !== "string" || header === "") return "signature_missing";
  let t: string | null = null;
  const candidates: string[] = [];
  let v1Count = 0;
  for (const item of header.split(",")) {
    const at = item.indexOf("=");
    if (at < 0) continue;
    const key = item.slice(0, at);
    const value = item.slice(at + 1);
    if (key === "t") t = value;
    else if (key === "v1") {
      v1Count += 1;
      if (!candidates.includes(value)) candidates.push(value);
    }
  }
  if (t === null || !/^\d{1,12}$/.test(t) || candidates.length === 0 || v1Count > STRIPE_MAX_V1)
    return "signature_malformed";
  let body: Uint8Array;
  if (typeof rawBody === "string") body = enc.encode(rawBody);
  else if (rawBody instanceof Uint8Array) body = rawBody;
  else return "signature_malformed";
  const prefix = enc.encode(`${t}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix, 0);
  signed.set(body, prefix.length);
  const sigs = candidates.map(hex32).filter((s): s is Uint8Array<ArrayBuffer> => s !== null);
  let matched = false;
  for (const secret of secrets) {
    if (matched) break;
    if (typeof secret !== "string" || secret === "") continue;
    const key = await hmacVerifyKey(secret);
    for (const sig of sigs)
      if (await crypto.subtle.verify("HMAC", key, sig, signed)) {
        matched = true;
        break;
      }
  }
  if (!matched) return "signature_invalid";
  const ageSec = Math.trunc(nowMs / 1000) - Number(t);
  if (ageSec > toleranceSec || ageSec < -toleranceSec) return "timestamp_out_of_tolerance";
  return "ok";
}

/**
 * A `Stripe-Signature` header for `rawBody` signed with `secret` at Unix second `t` (stripe-node's `generateTestHeaderString`: `t=<t>,v1=<hex>`). FOR TESTS AND THE
 * LOCAL SIMULATOR ONLY (`scripts/pay-simulate.mjs --gateway stripe`): nothing in a Worker signs a webhook.
 */
export async function stripeTestHeader(rawBody: string, secret: string, t: number): Promise<string> {
  const key = await hmacSignKey(secret);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`)));
  return `t=${t},v1=${toHex(mac)}`;
}

// ---- reading a verified event ----------------------------------------------------------------------------------------------------------------------------

/** Stripe's event names to ours (the four the webhook endpoint subscribes to, H3). Anything else is `other`. */
export const STRIPE_EVENT_TYPES: Readonly<Record<string, ProviderEventType>> = {
  "checkout.session.completed": "checkout.paid",
  "checkout.session.async_payment_succeeded": "checkout.paid",
  "checkout.session.async_payment_failed": "checkout.failed",
  "checkout.session.expired": "checkout.expired",
};

/** Our marks on a session we made (`metadata`, repeated on the payment intent): the app, our checkout row, the document and the environment. */
export type TechaustMarks = {
  readonly checkoutId: string;
  readonly documentId: string;
  readonly env: string;
};

export type SessionStatus = "open" | "complete" | "expired";
export type SessionPaymentStatus = "paid" | "unpaid" | "no_payment_required";
const SESSION_STATUSES: readonly string[] = ["open", "complete", "expired"];
const PAYMENT_STATUSES: readonly string[] = ["paid", "unpaid", "no_payment_required"];

export type StripeEvent = {
  /** Stripe's event id (`evt_…`), inside the signed body: the hook's idempotency key (`webhook_events.event_id`). */
  readonly id: string;
  readonly type: ProviderEventType;
  /** Stripe's event name as sent (≤ 64). */
  readonly name: string;
  readonly livemode: boolean;
  /** When Stripe made the event (UTC ms). */
  readonly created: number;
  /** The checkout session the event is about (`cs_…`), or null (another object, an event we do not handle). */
  readonly sessionId: string | null;
  /** The session's payment intent (`pi_…`) when the event names one. */
  readonly paymentIntentId: string | null;
  /** The session's `amount_total` and currency (lower case) as the event carries them, or null. */
  readonly amountTotal: number | null;
  readonly currency: string | null;
  /** Ours (L5): the session carries `metadata.app = "techaust"` and a UUIDv7 `techaust_checkout_id`; else null (the other domain's session on the shared account). */
  readonly techaust: TechaustMarks | null;
  readonly paymentStatus: SessionPaymentStatus | null;
  readonly status: SessionStatus | null;
};

export type ParsedStripeEvent =
  | { readonly ok: true; readonly value: StripeEvent }
  | { readonly ok: false; readonly code: "invalid_event" };

const INVALID: ParsedStripeEvent = Object.freeze({ ok: false, code: "invalid_event" } as const);

/** Our marks in a `metadata` object, or null when they are not all there and well formed. */
function marksOf(metadata: unknown): TechaustMarks | null {
  if (!isObj(metadata) || metadata.app !== "techaust") return null;
  const checkoutId = metadata.techaust_checkout_id;
  const documentId = str(metadata.techaust_document_id, DOC_ID);
  const env = str(metadata.techaust_env, ENV);
  if (!isUuidV7(checkoutId) || !documentId || !env) return null;
  return { checkoutId, documentId, env };
}

/**
 * A VERIFIED webhook body (already `JSON.parse`d) to an event, else `invalid_event`: it needs an `evt_` id, a type, a boolean `livemode` and a `created` second.
 * The four `checkout.session.*` names map to ours (`completed` and `async_payment_succeeded` → `checkout.paid`, `async_payment_failed` → `checkout.failed`,
 * `expired` → `checkout.expired`); any other name is `other`. For a session event, `data.object` must be a `checkout.session` with a `cs_` id, and its
 * `amount_total` a safe integer when present (else `invalid_event`). `techaust` is set only when that object carries our marks (`metadata.app = "techaust"`, a
 * UUIDv7 checkout id, the document and the environment): the shared account also sends the other domain's sessions (V8: an endpoint filters by type only), and
 * metadata alone never moves money (L5: only our `checkout_sessions` row does). Never reads `customer_details` or a card field.
 */
export function parseStripeEvent(obj: unknown): ParsedStripeEvent {
  if (!isObj(obj)) return INVALID;
  const id = str(obj.id, EVENT_ID);
  const name = str(obj.type, EVENT_TYPE);
  const created = secondsToMs(obj.created);
  if (!id || !name || typeof obj.livemode !== "boolean" || created === null) return INVALID;
  const type = STRIPE_EVENT_TYPES[name] ?? "other";
  const base = {
    id,
    type,
    name,
    livemode: obj.livemode,
    created,
    sessionId: null,
    paymentIntentId: null,
    amountTotal: null,
    currency: null,
    techaust: null,
    paymentStatus: null,
    status: null,
  } as const;
  if (type === "other") return { ok: true, value: base };
  const data = obj.data;
  const s = isObj(data) ? data.object : undefined;
  if (!isObj(s) || s.object !== "checkout.session") return INVALID;
  const sessionId = str(s.id, SESSION_ID);
  if (!sessionId) return INVALID;
  const amountTotal = s.amount_total === null || s.amount_total === undefined ? null : count(s.amount_total);
  if (amountTotal === null && s.amount_total !== null && s.amount_total !== undefined) return INVALID;
  return {
    ok: true,
    value: {
      ...base,
      sessionId,
      paymentIntentId: str(s.payment_intent, PI_ID),
      amountTotal,
      currency: str(s.currency, CURRENCY),
      techaust: marksOf(s.metadata),
      paymentStatus: PAYMENT_STATUSES.includes(s.payment_status as string)
        ? (s.payment_status as SessionPaymentStatus)
        : null,
      status: SESSION_STATUSES.includes(s.status as string) ? (s.status as SessionStatus) : null,
    },
  };
}

/**
 * The whitelisted facts of an event, as `webhook_events.facts` stores them (ADM-PAY-12; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)): the
 * event name, the session id (`linkId`, the generic key the dead-letter and review readers join on), the payment intent (`paymentId`, the key `itemPaymentSql`
 * matches `provider_payment_id` with), the amount and currency (upper case, only USD or INR), the session's payment status, livemode (1 or 0) and our checkout id.
 * Never `customer_details`, a card field or the raw payload.
 */
export function stripeEventFacts(e: StripeEvent): Record<string, string | number> {
  const f: Record<string, string | number> = { event: e.name, livemode: e.livemode ? 1 : 0 };
  if (e.sessionId) f.linkId = e.sessionId;
  if (e.paymentIntentId) f.paymentId = e.paymentIntentId;
  if (e.amountTotal !== null && e.amountTotal > 0 && (e.currency === "usd" || e.currency === "inr")) {
    f.amountMinor = e.amountTotal;
    f.currency = e.currency.toUpperCase();
  }
  if (e.paymentStatus) f.paymentStatus = e.paymentStatus;
  if (e.techaust) f.checkoutId = e.techaust.checkoutId;
  return f;
}

// ---- the session we ask for --------------------------------------------------------------------------------------------------------------------------------

/** How long a session lives (L4): 60 minutes; Stripe's own bounds are 30 minutes to 24 hours ahead (V1). */
export const SESSION_LIFETIME_MS = 60 * 60_000;
export const SESSION_MIN_AHEAD_MS = 30 * 60_000;
export const SESSION_MAX_AHEAD_MS = 24 * 3_600_000;
/** The card-statement suffix (C11) and the name on Stripe's page (C12), both approved by the owner on 2026-11-01 (Q4 A; 07-ZM). */
export const STATEMENT_SUFFIX = "TECHAUST";
export const DISPLAY_NAME = "TecHaust Technologies";
/** Stripe's bounds (V1): the payment description ≤ 1000, the suffix ≤ 22. The line-item name is held to 250 here (a document label is short). */
export const DESCRIPTION_MAX = 1000;
export const SUFFIX_MAX = 22;
export const LABEL_MAX = 250;

export type SessionRequestInput = {
  /** Our `checkout_sessions` row (a UUIDv7): `client_reference_id`, the metadata and the `Idempotency-Key`. */
  readonly checkoutId: string;
  readonly documentId: string;
  /** `ENVIRONMENT` of the Worker (local, staging, production): `metadata.techaust_env`, so another environment's events are ignored. */
  readonly env: string;
  /** USD cents. */
  readonly amountMinor: number;
  /** The line item's name (C9: "Invoice {number}", "Proforma invoice {number}", "Debit note {number}"; the caller's words). */
  readonly documentLabel: string;
  /** The payment's description (C10; the caller's words). */
  readonly description: string;
  /** When the session stops (UTC ms): now + `SESSION_LIFETIME_MS` at create; the stored value when a `creating` row is adopted (L4). */
  readonly expiresAt: number;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** The instant the request is made (UTC ms), for the expiry bounds. */
  readonly now: number;
};

export const SESSION_REQUEST_REFUSALS = [
  "amount_invalid",
  "amount_below_gateway_minimum",
  "expiry_out_of_range",
  "reference_invalid",
  "label_too_long",
  "description_too_long",
  "url_invalid",
] as const;
export type SessionRequestRefusal = (typeof SESSION_REQUEST_REFUSALS)[number];
export type FormPairs = readonly (readonly [string, string])[];

/** A return URL Stripe may send the browser to: https (http only on localhost), no credentials, no fragment, no `{…}` template, and no query but our marker. */
function returnUrlOk(v: string, markers: readonly string[]): boolean {
  if (v.length > 2000 || v.includes("{") || v.includes("}")) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "localhost")) return false;
  if (u.username || u.password || u.hash) return false;
  return u.search === "" || markers.includes(u.search);
}

/**
 * The form body of `POST /v1/checkout/sessions` (run file B.3), in a fixed order, or a refusal. One USD line of the amount (`price_data`, quantity 1), our checkout
 * id as `client_reference_id`, our marks in `metadata` and again in `payment_intent_data[metadata]`, the description (C10) and the statement suffix (C11) on the
 * payment intent (never `statement_descriptor`, which Stripe refuses on card charges: V4), card only, the billing address required (Stripe's India export rule,
 * V15), adaptive pricing off (the client pays the invoice's USD), our display name (C12), `submit_type=pay`, `locale=auto`, `expires_at` in whole seconds 30 minutes
 * to 24 hours ahead, and the two return URLs, which never carry a token, a session id or `{CHECKOUT_SESSION_ID}` (reaching them proves nothing: ADR 0008). No
 * `customer`, `customer_email` or `invoice_creation`: no Stripe customer is made (L, "Never").
 */
export function sessionRequestOf(
  i: SessionRequestInput,
):
  | { readonly ok: true; readonly pairs: FormPairs }
  | { readonly ok: false; readonly code: SessionRequestRefusal } {
  const no = (code: SessionRequestRefusal) => ({ ok: false, code }) as const;
  if (!Number.isSafeInteger(i.amountMinor) || i.amountMinor <= 0) return no("amount_invalid");
  if (i.amountMinor < STRIPE_MIN_AMOUNT_MINOR) return no("amount_below_gateway_minimum");
  if (!Number.isSafeInteger(i.expiresAt) || !Number.isSafeInteger(i.now)) return no("expiry_out_of_range");
  const ahead = i.expiresAt - i.now;
  if (ahead < SESSION_MIN_AHEAD_MS || ahead > SESSION_MAX_AHEAD_MS) return no("expiry_out_of_range");
  if (!isUuidV7(i.checkoutId) || !DOC_ID.test(i.documentId) || !ENV.test(i.env))
    return no("reference_invalid");
  if (i.documentLabel.trim() === "" || i.documentLabel.length > LABEL_MAX) return no("label_too_long");
  if (i.description.trim() === "" || i.description.length > DESCRIPTION_MAX)
    return no("description_too_long");
  if (!returnUrlOk(i.successUrl, ["?pay=return"]) || !returnUrlOk(i.cancelUrl, ["?pay=cancel"]))
    return no("url_invalid");
  const marks: [string, string][] = [
    ["app", "techaust"],
    ["techaust_checkout_id", i.checkoutId],
    ["techaust_document_id", i.documentId],
    ["techaust_env", i.env],
  ];
  return {
    ok: true,
    pairs: [
      ["mode", "payment"],
      ["line_items[0][price_data][currency]", "usd"],
      ["line_items[0][price_data][unit_amount]", String(i.amountMinor)],
      ["line_items[0][price_data][product_data][name]", i.documentLabel],
      ["line_items[0][quantity]", "1"],
      ["client_reference_id", i.checkoutId],
      ...marks.map(([k, v]) => [`metadata[${k}]`, v] as const),
      ...marks.map(([k, v]) => [`payment_intent_data[metadata][${k}]`, v] as const),
      ["payment_intent_data[description]", i.description],
      ["payment_intent_data[statement_descriptor_suffix]", STATEMENT_SUFFIX],
      ["allowed_payment_method_types[0]", "card"],
      ["billing_address_collection", "required"],
      ["adaptive_pricing[enabled]", "false"],
      ["branding_settings[display_name]", DISPLAY_NAME],
      ["submit_type", "pay"],
      ["locale", "auto"],
      // Whole seconds, rounded down (a positive safe integer, so truncation is the floor).
      ["expires_at", String(Math.trunc(i.expiresAt / 1000))],
      ["success_url", i.successUrl],
      ["cancel_url", i.cancelUrl],
    ],
  };
}

/** Form pairs as an `application/x-www-form-urlencoded` body. */
export const formBody = (pairs: FormPairs): string =>
  new URLSearchParams(pairs as [string, string][]).toString();

// ---- reading a re-fetched session --------------------------------------------------------------------------------------------------------------------------

/** What `GET /v1/checkout/sessions/{id}?expand[]=payment_intent.latest_charge.balance_transaction` answers, as the judge needs it (no personal field). */
export type StripeSession = {
  readonly id: string;
  readonly status: SessionStatus;
  readonly paymentStatus: SessionPaymentStatus;
  readonly livemode: boolean;
  readonly clientReferenceId: string | null;
  /** Our marks, or null when the session does not carry them all. */
  readonly metadata: TechaustMarks | null;
  readonly currency: string;
  readonly amountTotal: number;
  readonly pi: {
    readonly id: string;
    readonly status: string;
    readonly amountReceived: number;
    readonly currency: string;
    readonly metadata: TechaustMarks | null;
  } | null;
  readonly charge: {
    /** UTC ms. */
    readonly created: number;
    readonly status: string;
    readonly captured: boolean;
    /** `payment_method_details.type` (card, …), or null. */
    readonly methodType: string | null;
    /**
     * Money returned or contested after the charge succeeded (early check 1, F1): `refunded` (true only when fully refunded), `amount_refunded` (> 0 after any
     * refund, partial included) and `disputed`. A refund or a dispute leaves `status` succeeded and `captured` true, so these are read on their own.
     */
    readonly refunded: boolean;
    readonly amountRefunded: number;
    readonly disputed: boolean;
    /** `payment_method_details.card.country`: the two-letter ISO code of the country that issued the card, or null (not a card, or Stripe did not say). */
    readonly cardCountry: string | null;
  } | null;
  readonly bt: {
    readonly currency: string;
    /** Gross, fee and the tax in the fee (Σ `fee_details` of type `tax`), in the settlement currency's minor units. */
    readonly amount: number;
    readonly fee: number;
    readonly feeTax: number;
  } | null;
};

const WORD = /^[a-z_]{1,64}$/;

/** An expanded object, or null when absent; `undefined` when it is there but not expanded (a bare id) or malformed: the read fails. */
function expanded(v: unknown): Obj | null | undefined {
  if (v === null || v === undefined) return null;
  return isObj(v) ? v : undefined;
}

function readBalanceTransaction(v: unknown): StripeSession["bt"] | undefined {
  const bt = expanded(v);
  if (bt === null || bt === undefined) return bt === null ? null : undefined;
  const currency = str(bt.currency, CURRENCY);
  const amount = typeof bt.amount === "number" && Number.isSafeInteger(bt.amount) ? bt.amount : null;
  const fee = count(bt.fee);
  if (!currency || amount === null || fee === null) return undefined;
  let feeTax = 0;
  const details = bt.fee_details ?? [];
  if (!Array.isArray(details)) return undefined;
  for (const d of details) {
    if (!isObj(d)) return undefined;
    const a = count(d.amount);
    if (a === null) return undefined;
    if (d.type === "tax") feeTax += a;
  }
  if (!Number.isSafeInteger(feeTax)) return undefined;
  return { currency, amount, fee, feeTax };
}

/**
 * A re-fetched session (run file B.4), else null when anything we rely on is missing or malformed (every amount a safe integer; the payment intent, its latest
 * charge and the charge's balance transaction either absent or EXPANDED objects: a bare id means the expansion was not asked for, and the read fails). `feeTax` is
 * the sum of the balance transaction's `fee_details` of type `tax`. Reads no personal field.
 */
export function readStripeSession(obj: unknown): StripeSession | null {
  if (!isObj(obj) || obj.object !== "checkout.session") return null;
  const id = str(obj.id, SESSION_ID);
  const status = SESSION_STATUSES.includes(obj.status as string) ? (obj.status as SessionStatus) : null;
  const paymentStatus = PAYMENT_STATUSES.includes(obj.payment_status as string)
    ? (obj.payment_status as SessionPaymentStatus)
    : null;
  const currency = str(obj.currency, CURRENCY);
  const amountTotal = count(obj.amount_total);
  if (
    !id ||
    !status ||
    !paymentStatus ||
    typeof obj.livemode !== "boolean" ||
    !currency ||
    amountTotal === null
  )
    return null;
  const ref = obj.client_reference_id;
  if (ref !== null && ref !== undefined && typeof ref !== "string") return null;
  const piObj = expanded(obj.payment_intent);
  if (piObj === undefined) return null;
  let pi: StripeSession["pi"] = null;
  let charge: StripeSession["charge"] = null;
  let bt: StripeSession["bt"] = null;
  if (piObj) {
    const piId = str(piObj.id, PI_ID);
    const piStatus = str(piObj.status, WORD);
    const received = count(piObj.amount_received);
    const piCurrency = str(piObj.currency, CURRENCY);
    if (!piId || !piStatus || received === null || !piCurrency) return null;
    pi = {
      id: piId,
      status: piStatus,
      amountReceived: received,
      currency: piCurrency,
      metadata: marksOf(piObj.metadata),
    };
    const ch = expanded(piObj.latest_charge);
    if (ch === undefined) return null;
    if (ch) {
      const created = secondsToMs(ch.created);
      const chStatus = str(ch.status, WORD);
      const amountRefunded = count(ch.amount_refunded);
      if (
        created === null ||
        !chStatus ||
        typeof ch.captured !== "boolean" ||
        typeof ch.refunded !== "boolean" ||
        typeof ch.disputed !== "boolean" ||
        amountRefunded === null
      )
        return null;
      const pmd = ch.payment_method_details;
      const methodType = isObj(pmd) ? str(pmd.type, WORD) : null;
      const card = methodType === "card" && isObj(pmd) ? pmd.card : undefined;
      charge = {
        created,
        status: chStatus,
        captured: ch.captured,
        methodType,
        refunded: ch.refunded,
        amountRefunded,
        disputed: ch.disputed,
        cardCountry: isObj(card) ? str(card.country, /^[A-Z]{2}$/) : null,
      };
      const b = readBalanceTransaction(ch.balance_transaction);
      if (b === undefined) return null;
      bt = b;
    }
  }
  return {
    id,
    status,
    paymentStatus,
    livemode: obj.livemode,
    clientReferenceId: typeof ref === "string" ? ref : null,
    metadata: marksOf(obj.metadata),
    currency,
    amountTotal,
    pi,
    charge,
    bt,
  };
}

// ---- the judge: does the re-fetched session settle this checkout? ----------------------------------------------------------------------------------------

export const STRIPE_JUDGE_VERDICTS = [
  "livemode_mismatch",
  "reference_mismatch",
  "checkout_expired",
  "checkout_open",
  "not_paid",
  "not_captured",
  "not_export_receipt",
  "currency_mismatch",
  "amount_mismatch",
] as const;
export type StripeJudgeVerdict = (typeof STRIPE_JUDGE_VERDICTS)[number];

/** Our checkout row, as the judge needs it. */
export type StripeCheckoutRow = {
  readonly id: string;
  readonly documentId: string;
  /** The session id stored when the row went live. */
  readonly providerLinkId: string | null;
  readonly currency: string;
  readonly amountMinor: number;
  /** This Worker's `ENVIRONMENT`. */
  readonly env: string;
};

/**
 * Whether the session, its payment intent and our row are all in US dollars (the judge's `currency_mismatch` test). The finance Worker also asks it of a
 * `not_export_receipt` session, since a payment row is only ever written for USD money (the 0066 shape).
 */
export const stripeSessionInUsd = (row: Pick<StripeCheckoutRow, "currency">, s: StripeSession): boolean =>
  s.currency === "usd" && s.pi?.currency === "usd" && row.currency === "USD";

const marksMatch = (m: TechaustMarks | null, row: StripeCheckoutRow): boolean =>
  m !== null && m.checkoutId === row.id && m.documentId === row.documentId && m.env === row.env;

/**
 * Whether the session re-fetched from Stripe's API (never the webhook's copy: ADR 0008) settles `row` exactly, in this order:
 *   1. `livemode_mismatch`: the session's mode is not the one this Worker runs in (test while `PAYMENTS_LIVE_ALLOWED` is not true);
 *   2. `reference_mismatch`: the session id, `client_reference_id`, or either set of our marks (the session's, the payment intent's when there is one) differs
 *      from the row: a session that is not exactly ours drives no move at all, not even an expiry;
 *   3. `checkout_expired`, `checkout_open`: Stripe's word on the session's state (L6: only Stripe's word ends a row);
 *   4. `not_paid`: complete but `unpaid` (an asynchronous payment still on its way; nothing is recorded);
 *   5. `not_captured`: no payment intent, the intent not `succeeded`, or its latest charge not succeeded and captured (or `no_payment_required`), or the charge
 *      refunded in full or in part, or disputed (early check 1, F1: a refund or a dispute keeps `succeeded` and `captured`, and a re-fetch after one, through a
 *      retried webhook, the dead-letter retry or the sweep, must never record returned money as confirmed). The money's state comes before any amount (M6.2 review
 *      finding 7: an unsettled payment is never a confirmable row, whatever else differs);
 *   6. `not_export_receipt`: a card issued in India, or a card whose country Stripe did not give (the safe side), or no card at all (lead, 2026-11-02, early check 1
 *      decision 1): such a payment is not an inflow of foreign exchange, so it is never confirmed or allocated by the system and never gets LUT treatment (Settled by
 *      the lead on the safest reading, 2026-11-02 (08-C RA-38)). Named before any currency or amount difference (early check 2, finding 4): the tax consequence is
 *      what the Owner must see first, whatever else differs (the finance Worker still records no row for money that isn't in USD);
 *   7. `currency_mismatch`: the session or the intent not in `usd`, or the row not USD;
 *   8. `amount_mismatch`: `amount_total` ≠ the row's amount, or the intent's `amount_received` ≠ `amount_total`.
 * Nothing here moves money; the finance Worker records a mismatch pending with a review item (run file C.9).
 */
export function judgeStripeSession(
  row: StripeCheckoutRow,
  s: StripeSession,
  expectedLivemode: boolean,
): { readonly ok: true } | { readonly ok: false; readonly verdict: StripeJudgeVerdict } {
  const no = (verdict: StripeJudgeVerdict) => ({ ok: false, verdict }) as const;
  if (s.livemode !== expectedLivemode) return no("livemode_mismatch");
  if (
    s.id !== row.providerLinkId ||
    s.clientReferenceId !== row.id ||
    !marksMatch(s.metadata, row) ||
    (s.pi !== null && !marksMatch(s.pi.metadata, row))
  )
    return no("reference_mismatch");
  if (s.status === "expired") return no("checkout_expired");
  if (s.status === "open") return no("checkout_open");
  if (s.paymentStatus === "unpaid") return no("not_paid");
  if (
    s.paymentStatus !== "paid" ||
    s.pi === null ||
    s.pi.status !== "succeeded" ||
    s.charge === null ||
    s.charge.status !== "succeeded" ||
    !s.charge.captured ||
    s.charge.refunded ||
    s.charge.amountRefunded > 0 ||
    s.charge.disputed
  )
    return no("not_captured");
  if (s.charge.methodType !== "card" || s.charge.cardCountry === null || s.charge.cardCountry === "IN")
    return no("not_export_receipt");
  if (!stripeSessionInUsd(row, s)) return no("currency_mismatch");
  if (s.amountTotal !== row.amountMinor || s.pi.amountReceived !== s.amountTotal)
    return no("amount_mismatch");
  return { ok: true };
}

// ---- mapping a settled session to a payment row ---------------------------------------------------------------------------------------------------------------

/** `payments.id` of a Stripe payment: `stp_` and the payment intent's id. */
export const stripePaymentRowId = (paymentIntentId: string): string => `stp_${paymentIntentId}`;

/** The longest `payments.reference_norm` (the applied CHECK `payments_reference_length` of 0059, and core `normaliseReference`). */
export const REFERENCE_NORM_MAX = 60;

/**
 * `payments.reference_norm` of a Stripe payment: the payment intent's id in the one stored reference form (core `normaliseReference`: upper case, 1 to 60 of
 * `A-Z 0-9 / -`), the underscore as a hyphen (`pi_3Abc` → `PI-3ABC`). An id whose form is longer than 60 (Stripe's ids may grow to 255, V12) becomes its first 44
 * characters, "-", and the first 12 hex characters of the exact id's SHA-256 in upper case (57 characters): still one key per id, and the exact id stays in
 * `provider_payment_id` (≤ 255), which holds uniqueness. Null when it is not a payment intent's id.
 */
export async function stripeReferenceNorm(paymentIntentId: string): Promise<string | null> {
  if (!PI_ID.test(paymentIntentId)) return null;
  const n = paymentIntentId.replaceAll("_", "-").toUpperCase();
  if (n.length <= REFERENCE_NORM_MAX) return n;
  const h = await sha256Hex(paymentIntentId);
  return `${n.slice(0, 44)}-${h.slice(0, 12).toUpperCase()}`;
}

/** `payments.mode` of a Stripe charge: `card` for a card, `other` for anything else (the 0066 shape allows only these two). */
export const stripeModeOf = (methodType: string | null | undefined): "card" | "other" =>
  methodType === "card" ? "card" : "other";

/**
 * `payments.received_on` of a Stripe payment: the IST day of the charge's `created` (M6.2 L11): the earlier of the book entry and the bank credit, so the charge's own
 * day, never the later payout day. Settled by the lead on the safest reading, 2026-11-01 (08-C RA-37).
 */
export const receivedOnOf = (chargeCreatedMs: number): string => toIsoDate(istDate(chargeCreatedMs));

/**
 * The INR facts of a Stripe payment (L10): only when the balance transaction is in INR (the account's settlement currency), its gross `amount` (`inr_received_minor`,
 * > 0 by the applied CHECK), its `fee` and the tax in the fee (`gateway_fee_inr_minor`, `gateway_fee_tax_inr_minor`), all INR paise; else all null. A fee tax
 * above the fee (which the 0066 shape refuses) is dropped, never stored, so the payment's own record is never refused for an informational column. The fee is
 * absorbed, never billed (Researched 2026-10-28, NPCI FAQ of 15 Sep 2026 (08-C RA-29); OPEN (08-C RA-29): is GST charged on the MDR and invoiced to our GSTIN?).
 * No exchange rate is stored (L10: the screen works one out in bigint).
 */
export function inrFactsOf(bt: StripeSession["bt"]): {
  readonly inrReceivedMinor: number | null;
  readonly gatewayFeeInrMinor: number | null;
  readonly gatewayFeeTaxInrMinor: number | null;
} {
  if (bt === null || bt.currency !== "inr")
    return { inrReceivedMinor: null, gatewayFeeInrMinor: null, gatewayFeeTaxInrMinor: null };
  return {
    inrReceivedMinor: bt.amount > 0 ? bt.amount : null,
    gatewayFeeInrMinor: bt.fee,
    gatewayFeeTaxInrMinor: bt.feeTax <= bt.fee ? bt.feeTax : null,
  };
}

// ---- keys ------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The mode of a Stripe key: a RESTRICTED key only (L3): `rk_test_…` is test, `rk_live_…` is live; anything else, a secret `sk_` key included, is none (refused: a
 * secret key can do everything on the shared account, a restricted key only what H2 grants).
 */
export function stripeKeyModeOf(key: unknown): ProviderMode | null {
  if (typeof key !== "string" || key.length > 255) return null;
  if (/^rk_test_[A-Za-z0-9]+$/.test(key)) return "test";
  if (/^rk_live_[A-Za-z0-9]+$/.test(key)) return "live";
  return null;
}

/**
 * Whether the Stripe client may call the API with `key` (CLAUDE.md rule 7, ADM-PAY-11): a test key only while Settings › Gateways says test; a live key only while
 * Settings says live AND the go-live flag is exactly true (`liveModeAllowed`). Checked before any fetch, so a live or `sk_` key makes no call at all.
 */
export function stripeAllowed(key: unknown, settingsMode: unknown, liveAllowedFlag: unknown): boolean {
  const mode = stripeKeyModeOf(key);
  if (mode === "test") return settingsMode === "test";
  if (mode === "live") return settingsMode === "live" && liveModeAllowed("live", liveAllowedFlag);
  return false;
}
