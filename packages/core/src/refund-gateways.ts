// The gateways' refund objects and refund or dispute events, read pure (M6.5; ADM-PAY-08, JOB-HOOK-01..03; run file C, D, Step 0 vendor facts R1 to R5, S1 to S5,
// P1 to P4, L36, L37). No I/O, no floats. Only whitelisted facts are kept (L8; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)): the refund's
// and the payment's ids, the amount, the currency, the status, our own refund id (a UUIDv7 we sent as Razorpay's `receipt`, Stripe's `metadata.techaust_refund`
// or PayPal's `custom_id`) and the gateway's failure code; never a payer, card, account, note or address field.
//
// Vendor facts (read 2026-11-03, run file Step 0): Razorpay's refund entity `{id: "rfnd_…", entity: "refund", amount, currency, payment_id, receipt, status:
// pending | processed | failed}` (R1, R3, R4); Stripe's Refund `{id: "re_…", object: "refund", amount, currency (lower case), payment_intent, status: pending |
// requires_action | succeeded | failed | canceled, metadata, failure_reason}` (S1, S2; S4: metadata is not copied from the PaymentIntent, so ours is set on the
// refund itself); a Stripe Dispute `{id: "du_…" or "dp_…", object: "dispute", amount, currency, payment_intent, status}` (S5); PayPal's refund `{id, status:
// COMPLETED | PENDING | FAILED | CANCELLED, amount: {value, currency_code}, custom_id}` (P1; P3's full status list UNCONFIRMED: an unknown status reads pending).
import { isUuidV7 } from "./ids.ts";
import type { RefundState } from "./payments.ts";
import { valueToUsdMinor } from "./paypal.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, re: RegExp): string | null => (typeof v === "string" && re.test(v) ? v : null);
const amountOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const code = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(v) ? v : null;
const ourId = (v: unknown): string | null => (isUuidV7(v) ? (v as string) : null);

const RZP_REFUND_ID = /^rfnd_[A-Za-z0-9]{1,60}$/;
const RZP_PAYMENT_ID = /^pay_[A-Za-z0-9]{1,60}$/;
const STRIPE_REFUND_ID = /^(?:re|pyr)_[A-Za-z0-9_]{1,250}$/;
const STRIPE_PI_ID = /^pi_[A-Za-z0-9_]{1,252}$/;
const STRIPE_DISPUTE_ID = /^(?:du|dp)_[A-Za-z0-9_]{1,250}$/;
const PAYPAL_REFUND_ID = /^[A-Z0-9]{1,64}$/;

/** A refund as a gateway holds it. `paymentRef` is the gateway's payment (Razorpay `pay_…`, Stripe PaymentIntent, PayPal capture; PayPal's own object lacks it). */
export type GatewayRefund = {
  readonly refundRef: string;
  readonly paymentRef: string | null;
  readonly amountMinor: number;
  readonly currency: "INR" | "USD";
  readonly state: RefundState;
  /** Our `payment_refunds.id` as we sent it, when the gateway echoes it. */
  readonly ourId: string | null;
  readonly failureCode: string | null;
  /**
   * M6–M7 audit AU1: Stripe's `requires_action` (read as `pending`). AU36 (Settled by the lead on the safest reading, 2026-11-07): on a refund that had already
   * succeeded the money can still reach the customer once they act, so it never reverses our refund (`reversalOf`); the caller opens a `refund_reversed` item at
   * stage `requires_action` for the Owner instead (`awaitsAction`). Absent on every other answer.
   */
  readonly requiresAction?: true;
};

/**
 * M6–M7 audit AU1 (B0 1; Researched 2026-11-07, docs.stripe.com/refunds "Failed refunds": a refund can fail after `succeeded`, up to 30 days later, when the
 * bank returns the funds): a refund we hold as `succeeded` that the gateway now shows failed (Stripe `failed` or `canceled`) is reversed with this failure code;
 * null: it still stands. Razorpay and PayPal take the same path if their answer ever says failed after success. AU36 (Settled by the lead on the safest reading,
 * 2026-11-07): Stripe's `requires_action` after success never reverses it.
 */
export function reversalOf(g: GatewayRefund): string | null {
  if (g.state === "failed") return g.failureCode ?? "gateway_failed";
  return null;
}

/** AU36: a refund we hold as `succeeded` that Stripe now shows `requires_action`: no reversal, one item for the Owner (once per refund). */
export const awaitsAction = (g: GatewayRefund): boolean => g.requiresAction === true && g.state !== "failed";

/** Razorpay's refund entity (`POST /v1/payments/{id}/refund`, `GET /v1/refunds/{id}`, an item of `GET /v1/payments/{id}/refunds`), else null. */
export function readRazorpayRefund(v: unknown): GatewayRefund | null {
  if (!isObj(v)) return null;
  const refundRef = str(v.id, RZP_REFUND_ID);
  const amountMinor = amountOf(v.amount);
  const currency = v.currency === "INR" ? "INR" : v.currency === "USD" ? "USD" : null;
  if (!refundRef || amountMinor === null || !currency) return null;
  const state: RefundState =
    v.status === "processed" ? "processed" : v.status === "failed" ? "failed" : "pending";
  return {
    refundRef,
    paymentRef: str(v.payment_id, RZP_PAYMENT_ID),
    amountMinor,
    currency,
    state,
    ourId: ourId(v.receipt),
    failureCode: state === "failed" ? "razorpay_failed" : null,
  };
}

/** Stripe's Refund object, else null. `pending`/`requires_action` → pending, `succeeded` → processed, `failed`/`canceled` → failed (Step 0, brief C). */
export function readStripeRefund(v: unknown): GatewayRefund | null {
  if (!isObj(v) || v.object !== "refund") return null;
  const refundRef = str(v.id, STRIPE_REFUND_ID);
  const amountMinor = amountOf(v.amount);
  const currency = v.currency === "usd" ? "USD" : v.currency === "inr" ? "INR" : null;
  if (!refundRef || amountMinor === null || !currency) return null;
  const state: RefundState =
    v.status === "succeeded"
      ? "processed"
      : v.status === "failed" || v.status === "canceled"
        ? "failed"
        : "pending";
  const md = isObj(v.metadata) ? v.metadata : {};
  return {
    refundRef,
    paymentRef: str(v.payment_intent, STRIPE_PI_ID),
    amountMinor,
    currency,
    state,
    ourId: ourId(md.techaust_refund),
    failureCode:
      state === "failed" ? (code(v.failure_reason) ?? `stripe_${String(v.status)}`.slice(0, 64)) : null,
    ...(v.status === "requires_action" ? { requiresAction: true as const } : {}),
  };
}

/** PayPal's refund (`POST /v2/payments/captures/{id}/refund` with `Prefer: return=representation`, `GET /v2/payments/refunds/{id}`), else null. USD only (M6.4). */
export function readPayPalRefund(v: unknown): GatewayRefund | null {
  if (!isObj(v)) return null;
  const refundRef = str(v.id, PAYPAL_REFUND_ID);
  if (!refundRef) return null;
  const amt = isObj(v.amount) ? v.amount : null;
  const amountMinor = amt && amt.currency_code === "USD" ? valueToUsdMinor(amt.value) : null;
  if (amountMinor === null) return null;
  const state: RefundState =
    v.status === "COMPLETED"
      ? "processed"
      : v.status === "FAILED" || v.status === "CANCELLED"
        ? "failed"
        : "pending";
  return {
    refundRef,
    paymentRef: null,
    amountMinor,
    currency: "USD",
    state,
    ourId: ourId(v.custom_id),
    failureCode: state === "failed" ? `paypal_${String(v.status).toLowerCase()}`.slice(0, 64) : null,
  };
}

// ---- events (the hooks keep these facts only) ----------------------------------------------------------------------------------------------------------------

/** The facts a refund or dispute event leaves on `webhook_events.facts` (L8, RB-40). */
export type RefundEventFacts = {
  readonly event: string;
  /** "refund" or "dispute". */
  readonly object: "refund" | "dispute";
  /** The gateway's refund or dispute id (Stripe's `charge.refunded` names none: null). */
  readonly refundId: string | null;
  /** The gateway's payment (Razorpay `pay_…`, Stripe PaymentIntent). */
  readonly paymentId: string | null;
  readonly amountMinor: number | null;
  readonly currency: "INR" | "USD" | null;
  readonly status: string | null;
  readonly ourRefundId: string | null;
};

/** Razorpay's refund events (R5, CONFIRMED) as they map to ours. */
export const RAZORPAY_REFUND_EVENTS: Readonly<
  Record<string, "refund.created" | "refund.processed" | "refund.failed">
> = {
  "refund.created": "refund.created",
  "refund.processed": "refund.processed",
  "refund.failed": "refund.failed",
};

/** A verified Razorpay refund event's facts (`payload.refund.entity`), else null. */
export function razorpayRefundEventFacts(obj: unknown): RefundEventFacts | null {
  if (!isObj(obj) || typeof obj.event !== "string" || !Object.hasOwn(RAZORPAY_REFUND_EVENTS, obj.event))
    return null;
  const payload = isObj(obj.payload) ? obj.payload : null;
  const entity = payload && isObj(payload.refund) ? payload.refund.entity : null;
  const r = readRazorpayRefund(entity);
  if (!r) return null;
  return {
    event: obj.event,
    object: "refund",
    refundId: r.refundRef,
    paymentId: r.paymentRef,
    amountMinor: r.amountMinor,
    currency: r.currency,
    status: r.state,
    ourRefundId: r.ourId,
  };
}

/** Stripe's refund and dispute events (S5, CONFIRMED) as they map to ours; `refund.created` is optional at the endpoint (H3). */
export const STRIPE_REFUND_EVENTS: Readonly<
  Record<
    string,
    "refund.created" | "refund.processed" | "refund.failed" | "dispute.opened" | "dispute.closed"
  >
> = {
  "refund.created": "refund.created",
  "refund.updated": "refund.processed",
  "refund.failed": "refund.failed",
  "charge.refunded": "refund.processed",
  "charge.dispute.created": "dispute.opened",
  "charge.dispute.closed": "dispute.closed",
};

/** A verified Stripe refund or dispute event's facts (`data.object`: a refund, a charge or a dispute), else null. */
export function stripeRefundEventFacts(obj: unknown): RefundEventFacts | null {
  if (!isObj(obj) || typeof obj.type !== "string" || !Object.hasOwn(STRIPE_REFUND_EVENTS, obj.type))
    return null;
  const data = isObj(obj.data) ? obj.data : null;
  const o = data && isObj(data.object) ? data.object : null;
  if (!o) return null;
  const event = obj.type;
  if (o.object === "refund") {
    const r = readStripeRefund(o);
    if (!r) return null;
    return {
      event,
      object: "refund",
      refundId: r.refundRef,
      paymentId: r.paymentRef,
      amountMinor: r.amountMinor,
      currency: r.currency,
      status: r.state,
      ourRefundId: r.ourId,
    };
  }
  if (o.object === "charge") {
    const paymentId = str(o.payment_intent, STRIPE_PI_ID);
    if (!paymentId) return null;
    return {
      event,
      object: "refund",
      refundId: null,
      paymentId,
      amountMinor: amountOf(o.amount_refunded),
      currency: o.currency === "usd" ? "USD" : o.currency === "inr" ? "INR" : null,
      status: null,
      ourRefundId: null,
    };
  }
  if (o.object === "dispute") {
    const refundId = str(o.id, STRIPE_DISPUTE_ID);
    if (!refundId) return null;
    return {
      event,
      object: "dispute",
      refundId,
      paymentId: str(o.payment_intent, STRIPE_PI_ID),
      amountMinor: amountOf(o.amount),
      currency: o.currency === "usd" ? "USD" : o.currency === "inr" ? "INR" : null,
      status: code(o.status),
      ourRefundId: null,
    };
  }
  return null;
}

/** The facts as `webhook_events.facts` stores them (strings and numbers only; `linkId` empty: no checkout). */
export function refundFactsRecord(f: RefundEventFacts): Record<string, string | number> {
  const out: Record<string, string | number> = { event: f.event, object: f.object };
  if (f.refundId) out.refundId = f.refundId;
  if (f.paymentId) out.paymentId = f.paymentId;
  if (f.amountMinor !== null) out.amountMinor = f.amountMinor;
  if (f.currency) out.currency = f.currency;
  if (f.status) out.status = f.status;
  if (f.ourRefundId) out.ourRefundId = f.ourRefundId;
  return out;
}

/** Whether a stored event type is one of the refund or dispute events (the finance Worker's refund branch). */
export const isRefundEventName = (provider: string, name: string): boolean =>
  provider === "razorpay"
    ? Object.hasOwn(RAZORPAY_REFUND_EVENTS, name)
    : provider === "stripe"
      ? Object.hasOwn(STRIPE_REFUND_EVENTS, name)
      : provider === "paypal"
        ? name === "PAYMENT.CAPTURE.REFUNDED"
        : false;

/**
 * M6–M7 audit AU61 (review L1): the stored refund events that can say a refund we hold as `succeeded` came back, so only these re-fetch it (AU1, AU36): Stripe's
 * `refund.failed` and `refund.updated` (a later `failed`, `canceled` or `requires_action`), Razorpay's `refund.failed`. Every other event of a succeeded refund
 * (Razorpay's `refund.created`/`refund.processed`, Stripe's `refund.created` and `charge.refunded`, PayPal's `PAYMENT.CAPTURE.REFUNDED`, the only PayPal refund
 * event this branch reads: PayPal names no refund-failed event) is routine and closes quietly with no gateway call, so an unreachable gateway never retries and
 * dead-letters a refund that is fine.
 */
export const mayReverseRefund = (provider: string, name: string): boolean =>
  provider === "stripe"
    ? name === "refund.failed" || name === "refund.updated"
    : provider === "razorpay"
      ? name === "refund.failed"
      : false;

/** For the warm-up (J): one made-up refund read per gateway and one event each; returns how many read (5). */
export function warmRefundReaders(): number {
  try {
    const id = "01900000-0000-7000-8000-00000000000a";
    const rzp = {
      id: "rfnd_WARM0000000001",
      entity: "refund",
      amount: 100,
      currency: "INR",
      payment_id: "pay_WARM0000000001",
      receipt: id,
      status: "processed",
    };
    const stp = {
      id: "re_WARM0000000001",
      object: "refund",
      amount: 100,
      currency: "usd",
      payment_intent: "pi_WARM0000000001",
      status: "succeeded",
      metadata: { techaust_refund: id },
    };
    const ppl = {
      id: "WARM0000000001",
      status: "COMPLETED",
      amount: { value: "1.00", currency_code: "USD" },
      custom_id: id,
    };
    return [
      readRazorpayRefund(rzp),
      readStripeRefund(stp),
      readPayPalRefund(ppl),
      razorpayRefundEventFacts({ event: "refund.processed", payload: { refund: { entity: rzp } } }),
      stripeRefundEventFacts({ type: "refund.updated", data: { object: stp } }),
    ].filter((x) => x !== null).length;
  } catch {
    return 0;
  }
}
