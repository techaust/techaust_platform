// M6–M7 audit, the pure parts of AF1 (run file docs/runs/full-audit-m6-m7.md, lead's triage AU1, AU6) [ADM-PAY-08]: Stripe's `requires_action` read, the
// reversal rule (`reversalOf`), the `refund.reversed` message, the RPC result's `refundReversed`, and 07-ZT's gate (off, every client line marked). Invented data.
import { describe, expect, it } from "vitest";
import { APPROVED_07ZT, REFUND_REVERSED_COPY } from "../src/copy-zt.ts";
import { EMAIL_TEMPLATES } from "../src/email-templates.ts";
import { isProcessEventResult } from "../src/gateway-rpc.ts";
import {
  isRefundNotifyKind,
  isRefundReversedKind,
  parseRefundReversed,
  refundReversed,
} from "../src/notifications.ts";
import {
  readPayPalRefund,
  readRazorpayRefund,
  readStripeRefund,
  reversalOf,
} from "../src/refund-gateways.ts";

const OUR = "01900000-0000-7000-8000-00000000000a";
const stripe = (status: string, extra: Record<string, unknown> = {}) =>
  readStripeRefund({
    id: "re_AU1",
    object: "refund",
    amount: 2_000,
    currency: "usd",
    payment_intent: "pi_AU1",
    status,
    metadata: { techaust_refund: OUR },
    ...extra,
  });

describe("AU1: a refund that succeeded and came back", () => {
  it("Stripe `requires_action` reads pending, marked; every other answer carries no mark", () => {
    expect(stripe("requires_action")).toMatchObject({ state: "pending", requiresAction: true });
    for (const s of ["succeeded", "pending", "failed", "canceled"])
      expect(stripe(s)).not.toHaveProperty("requiresAction");
  });

  it("reversalOf: failed (the gateway's code) or Stripe's requires_action reverse; processed or pending stand", () => {
    expect(reversalOf(stripe("failed", { failure_reason: "lost_or_stolen_card" }) as never)).toBe(
      "lost_or_stolen_card",
    );
    expect(reversalOf(stripe("failed") as never)).toBe("stripe_failed");
    expect(reversalOf(stripe("requires_action") as never)).toBe("stripe_requires_action");
    expect(reversalOf(stripe("succeeded") as never)).toBeNull();
    expect(reversalOf(stripe("pending") as never)).toBeNull();
    const rzp = readRazorpayRefund({
      id: "rfnd_AU1",
      entity: "refund",
      amount: 100,
      currency: "INR",
      payment_id: "pay_AU1",
      receipt: OUR,
      status: "failed",
    });
    expect(reversalOf(rzp as never)).toBe("razorpay_failed");
    const pp = readPayPalRefund({
      id: "AU1REF",
      status: "FAILED",
      amount: { value: "1.00", currency_code: "USD" },
    });
    expect(reversalOf(pp as never)).toBe("paypal_failed");
    // a gateway that answered nothing it reads as failed has no code of its own: the generic one
    expect(
      reversalOf({
        refundRef: "x",
        paymentRef: null,
        amountMinor: 1,
        currency: "INR",
        state: "failed",
        ourId: null,
        failureCode: null,
      }),
    ).toBe("gateway_failed");
  });

  it("the `refund.reversed` message: ids only, exact keys, never read as a `refund.notify`", () => {
    expect(refundReversed(OUR)).toEqual({ kind: "refund.reversed", refundId: OUR });
    expect(parseRefundReversed(refundReversed(OUR))).toEqual(refundReversed(OUR));
    expect(parseRefundReversed({ kind: "refund.reversed", refundId: OUR, extra: 1 })).toBeNull();
    expect(parseRefundReversed({ kind: "refund.reversed", refundId: "" })).toBeNull();
    expect(parseRefundReversed({ kind: "refund.notify", refundId: OUR })).toBeNull();
    expect(isRefundReversedKind(refundReversed(OUR))).toBe(true);
    expect(isRefundNotifyKind(refundReversed(OUR))).toBe(false);
  });

  it("the RPC answer may name the refund it reversed; a malformed one is refused", () => {
    expect(isProcessEventResult({ result: "needs_review", refundReversed: OUR })).toBe(true);
    expect(isProcessEventResult({ result: "needs_review", refundReversed: 5 })).toBe(false);
  });

  it("07-ZT's client lines are held: the gate is off and every line is marked; the template is registered", () => {
    expect(APPROVED_07ZT).toBe(false);
    for (const line of [
      REFUND_REVERSED_COPY.subject("₹1.00", "TH/INV/2627/0001"),
      REFUND_REVERSED_COPY.body("Asha", "₹1.00", "TH/INV/2627/0001"),
      REFUND_REVERSED_COPY.next,
    ])
      expect(line.startsWith("[Placeholder] ")).toBe(true);
    expect(EMAIL_TEMPLATES).toContain("refund.reversed");
  });
});
