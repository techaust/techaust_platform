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
});
