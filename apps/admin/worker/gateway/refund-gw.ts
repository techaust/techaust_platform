// One refund client over the three gateways (M6.5; ADM-PAY-08, ADM-PAY-11; run file C steps 3 and 4, L36, L37). The finance Worker's refund route, `checkRefund`
// (the sweep and "Try again") and the refund events all go through it, so every gateway is called the same way:
//   - `blocked` is known BEFORE anything is written (review fix 3): a live key or live settings mode while `PAYMENTS_LIVE_ALLOWED` is not "true" makes no call at
//     all (`live_not_allowed`), and neither does a gateway with no key (`unconfigured`);
//   - `create` sends our refund id as the gateway's idempotency key (Razorpay `receipt`, Stripe `Idempotency-Key` and `metadata.techaust_refund`, PayPal
//     `PayPal-Request-Id` and `custom_id`);
//   - `find` looks a refund up by the gateway's id, else by OURS (L37): Razorpay lists the payment's refunds and matches `receipt` (a second create with the same
//     receipt is refused as a duplicate, R2), Stripe lists the PaymentIntent's refunds and matches `metadata.techaust_refund` (its idempotency keys are pruned
//     after 24 hours, S3, so nothing is re-posted blind); PayPal has no such list, so `find` answers `unknown` and the caller re-posts with the same request id
//     (the same refund comes back; P2's retention UNCONFIRMED).
// Every call has its own `AbortSignal.timeout` inside the client (never at global scope). Answers never throw.
import type { GatewayRefund } from "@techaust/core/refund-gateways";
import {
  gatewayModeOf,
  payPalModeOfSettings,
  payPalOf,
  razorpayOf,
  stripeModeOfSettings,
  stripeOf,
} from "./config.ts";

export type RefundGwFailure =
  | "network"
  | "refused"
  | "not_found"
  | "bad_answer"
  | "live_not_allowed"
  | "unconfigured";
export type RefundGwResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: RefundGwFailure; status?: number };

export type RefundGw = {
  readonly provider: "razorpay" | "stripe" | "paypal";
  readonly blocked: "live_not_allowed" | "unconfigured" | null;
  create(a: {
    paymentRef: string;
    amountMinor: number;
    refundId: string;
    paymentId: string;
  }): Promise<RefundGwResult<GatewayRefund>>;
  /** The refund by the gateway's id, or by ours on the payment; `null`: the gateway shows none; `unknown`: it can't be listed (PayPal without an id). */
  find(a: {
    paymentRef: string;
    refundId: string;
    refundRef: string | null;
  }): Promise<RefundGwResult<GatewayRefund | null | "unknown">>;
};

const as = <T>(
  r: { ok: true; value: T } | { ok: false; code: string; status?: number },
): RefundGwResult<T> =>
  r.ok
    ? r
    : {
        ok: false,
        code: (["network", "refused", "not_found", "bad_answer", "live_not_allowed", "unconfigured"].includes(
          r.code,
        )
          ? r.code
          : r.code === "forbidden"
            ? "refused"
            : "network") as RefundGwFailure,
        ...(r.status === undefined ? {} : { status: r.status }),
      };

/** The refund client for `provider`, or null when this Worker has no transport for it (503 `gateway_unavailable`). */
export async function refundGwOf(env: { DB: D1Database }, provider: string): Promise<RefundGw | null> {
  if (provider === "razorpay") {
    const api = razorpayOf(env, await gatewayModeOf(env.DB));
    if (!api) return null;
    return {
      provider,
      blocked: api.blocked,
      async create(a) {
        return as(
          await api.createRefund(a.paymentRef, {
            amount: a.amountMinor,
            receipt: a.refundId,
            notes: { techaust_refund: a.refundId, techaust_payment: a.paymentId },
          }),
        );
      },
      async find(a) {
        if (a.refundRef) {
          const r = as(await api.fetchRefund(a.refundRef));
          return r.ok ? r : r.code === "not_found" ? { ok: true, value: null } : r;
        }
        const r = as(await api.listRefunds(a.paymentRef));
        if (!r.ok) return r.code === "not_found" ? { ok: true, value: null } : r;
        return { ok: true, value: r.value.find((x) => x.ourId === a.refundId) ?? null };
      },
    };
  }
  if (provider === "stripe") {
    const api = stripeOf(env, await stripeModeOfSettings(env.DB));
    if (!api) return null;
    return {
      provider,
      blocked: api.blocked,
      async create(a) {
        return as(await api.createRefund(a.paymentRef, a.amountMinor, a.refundId));
      },
      async find(a) {
        if (a.refundRef) {
          const r = as(await api.fetchRefund(a.refundRef));
          return r.ok ? r : r.code === "not_found" ? { ok: true, value: null } : r;
        }
        const r = as(await api.listRefunds(a.paymentRef));
        if (!r.ok) return r.code === "not_found" ? { ok: true, value: null } : r;
        return { ok: true, value: r.value.find((x) => x.ourId === a.refundId) ?? null };
      },
    };
  }
  if (provider === "paypal") {
    const api = payPalOf(env, await payPalModeOfSettings(env.DB));
    if (!api) return null;
    return {
      provider,
      blocked: api.blocked,
      async create(a) {
        return as(await api.refundCapture(a.paymentRef, a.amountMinor, a.refundId));
      },
      async find(a) {
        if (!a.refundRef) return { ok: true, value: "unknown" };
        const r = as(await api.getRefund(a.refundRef));
        return r.ok ? r : r.code === "not_found" ? { ok: true, value: null } : r;
      },
    };
  }
  return null;
}
