// M6–M7 audit, AF1's small SPA logic (run file docs/runs/full-audit-m6-m7.md, lead's triage AU4, AU6, AU16) [ADM-PAY-01, ADM-PAY-08, ADM-PAY-09]: why Withdraw is
// hidden, the gateway's refusal code reaching the refund dialog, the receipt send's refused contacts at the top level, and the `refunded_outside` line of a
// payment first seen partly refunded.
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, RequestError } from "../api.ts";
import { itemReason } from "./gateway.ts";
import { PAY_ERRORS, payErrorText, withdrawBlockedLine } from "./payments.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The error the API client makes of one server answer (any request path reads errors the same way: `answerError`). */
const reject = async (status: number, body: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
      ),
  );
  return api.deactivate("u1").catch((x: unknown) => x);
};

describe("AU4 and AU16: Withdraw hidden, with the reason", () => {
  it("a live refund, a bank tick or an advice link each block it; nothing: null", () => {
    expect(withdrawBlockedLine({ hasLiveRefund: true })).toBe(PAY_ERRORS.refunds_exist);
    expect(withdrawBlockedLine({ bankTicked: true })).toBe(PAY_ERRORS.payment_linked);
    expect(withdrawBlockedLine({ advice: { id: "a" } })).toBe(PAY_ERRORS.payment_linked);
    expect(withdrawBlockedLine({ hasLiveRefund: false, bankTicked: false, advice: null })).toBeNull();
    expect(withdrawBlockedLine({})).toBeNull();
  });

  it("the server's 409 payment_linked reads as the worded line", async () => {
    const e = await reject(409, { error: { code: "payment_linked", message: "server words" } });
    expect(payErrorText(e)).toBe(PAY_ERRORS.payment_linked);
  });
});

describe("AU16 (B2 2, 3): the error details the screens read", () => {
  it("a gateway's refusal code reaches `details.code`", async () => {
    const e = (await reject(409, {
      error: { code: "gateway_refused", message: "x", details: { code: "refused_400" } },
    })) as RequestError;
    expect(e).toBeInstanceOf(RequestError);
    expect(e.extra.details).toMatchObject({ code: "refused_400" });
  });

  it("the receipt send's refused contacts arrive at the top level as `contactIds`", async () => {
    const e = (await reject(409, {
      error: { code: "recipient_invalid", message: "x" },
      contactIds: ["c1", "c2"],
    })) as RequestError;
    expect(e.extra.contactIds).toEqual(["c1", "c2"]);
  });
});

describe("AU6: the refunded_outside line of a payment first seen partly refunded", () => {
  it("names the refunded amount when the gateway gave it, else says part of it", () => {
    expect(
      itemReason({
        kind: "refunded_outside",
        facts: { refundedMinor: 10_000 },
        amount_minor: 118_000,
        provider: "razorpay",
        currency: "INR",
      }),
    ).toMatch(/already refunded ₹100\.00 of this payment of ₹1,180\.00/);
    expect(
      itemReason({
        kind: "refunded_outside",
        facts: { reason: "partly_refunded" },
        amount_minor: 5_000,
        provider: "paypal",
        currency: "USD",
      }),
    ).toMatch(/PayPal had already refunded part of this payment/);
    expect(
      itemReason({
        kind: "refunded_outside",
        facts: {},
        amount_minor: 5_000,
        provider: "stripe",
        currency: "USD",
      }),
    ).toMatch(/refunded in Stripe, outside the admin/);
  });

  it("AU34: line 2 gives the order the database accepts (confirm with only what was kept on the invoice, then the refund from credit)", () => {
    expect(
      itemReason({
        kind: "refunded_outside",
        facts: { refundedMinor: 10_000 },
        amount_minor: 118_000,
        provider: "razorpay",
        currency: "INR",
      }),
    ).toBe(
      "Razorpay had already refunded ₹100.00 of this payment of ₹1,180.00 when it reached us, so it waits here. Confirm it, putting only what was kept on the invoice, then record the ₹100.00 refund from credit with Razorpay's refund id.",
    );
    expect(
      itemReason({
        kind: "refunded_outside",
        facts: { reason: "partly_refunded" },
        amount_minor: 5_000,
        provider: "paypal",
        currency: "USD",
      }),
    ).toBe(
      "PayPal had already refunded part of this payment of $50.00 when it reached us, so it waits here. Confirm it, putting only what was kept on the invoice, then record the refund from credit with PayPal's refund id.",
    );
  });
});

describe("AU33 and AU36: the refund_reversed lines", () => {
  const item = (facts: Record<string, unknown>) =>
    itemReason({ kind: "refund_reversed", facts, amount_minor: 5_000, provider: "stripe", currency: "USD" });
  it("credit again (default); a rejected payment's money isn't counted; requires_action reverses nothing", () => {
    expect(item({ refundId: "r1" })).toMatch(/the money is the client's credit again/);
    expect(item({ refundId: "r1", reason: "payment_rejected" })).toBe(
      "Stripe's refund of $50.00 came back after it was made. The payment was rejected when this refund was made, so the money isn't counted here. Record it as a payment.",
    );
    expect(item({ refundId: "r1", stage: "requires_action" })).toMatch(
      /^Stripe needs the client to act before the refund of \$50\.00 can reach them.*It still counts as made here/,
    );
  });
});
