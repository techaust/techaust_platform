// 07-ZM (POR-06, M6.3): the portal's client lines 1 to 8 word for word with docs/07-content-appendix/ZM-m6.3-stripe.md (read here, so a change to the page that
// isn't made in the code fails), and lines 11 and 12 as the finance Worker sends them to Stripe. Lines 4 and 6 as the portal Worker answers them are held to
// the same literal words by worker/pay.test.ts.
import { DISPLAY_NAME, STATEMENT_SUFFIX } from "@techaust/core/stripe";
import { describe, expect, it } from "vitest";
import zmPage from "../../../docs/07-content-appendix/ZM-m6.3-stripe.md?raw";
import { PAY_ZI } from "./copy-zi.ts";
import { APPROVED_07ZM, PAY_ZM } from "./copy-zm.ts";
import {
  capturePayReturn,
  isGatewayUrl,
  partAmount,
  payReturnPageKind,
  takePayReturn,
  upperOf,
} from "./lib/pay.ts";

/** The quoted texts of 07-ZM's numbered client line `n` (before the staff section). */
function quoted(n: number): string[] {
  const client = zmPage.split("## Staff lines")[0] as string;
  const line = client.split("\n").find((l) => l.startsWith(`${n}. `));
  if (!line) throw new Error(`07-ZM has no line ${n}`);
  return [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

describe("07-ZM client lines [POR-06, M6.3]", () => {
  it("are approved by the owner, and the switch says so", () => {
    expect(zmPage).toContain("client lines C1–C12 APPROVED by the owner, 2026-11-01");
    expect(APPROVED_07ZM).toBe(true);
  });

  it("1 to 8, word for word", () => {
    expect([PAY_ZM.payByCard]).toEqual(quoted(1));
    expect([PAY_ZM.continue]).toEqual(quoted(2));
    expect([PAY_ZM.howItWorks]).toEqual(quoted(3));
    expect([PAY_ZM.notYet]).toEqual(quoted(4));
    expect([PAY_ZM.cancelled]).toEqual(quoted(5));
    expect([PAY_ZM.maximum("{maximum}")]).toEqual(quoted(6));
    expect([PAY_ZM.receivedProforma("{amount}")]).toEqual(quoted(7));
    expect([PAY_ZM.proformaPaid("{date}")]).toEqual(quoted(8));
  });

  it("lines 11 and 12 are the constants sent to Stripe", () => {
    expect(quoted(11)).toEqual([STATEMENT_SUFFIX]);
    expect(quoted(12)).toEqual([DISPLAY_NAME]);
  });
});

describe("Pay by card's amount and return [POR-06, M6.3]", () => {
  const a = {
    minimumMinor: 100_00,
    balanceMinor: 30_000_00,
    wholeRupees: false,
    currency: "USD" as const,
    maximumMinor: 25_000_00,
  };
  it("reads dollars the en-US way, cents allowed", () => {
    expect(partAmount("1,250.50", a)).toEqual({ ok: true, minor: 1_250_50 });
    expect(partAmount("$100", a)).toEqual({ ok: true, minor: 100_00 });
    expect(partAmount("25000", a)).toEqual({ ok: true, minor: 25_000_00 });
  });
  it("says 07-ZI's lines 5 and 6 in dollars; above the maximum line 5 up to it (07-ZM line 6 stands over the field)", () => {
    expect(partAmount("", a)).toEqual({ ok: false, error: PAY_ZI.between("$100.00", "$25,000.00") });
    expect(partAmount("99.99", a)).toEqual({ ok: false, error: PAY_ZI.atLeast("$100.00") });
    expect(partAmount("25,000.01", a)).toEqual({
      ok: false,
      error: PAY_ZI.between("$100.00", "$25,000.00"),
    });
    expect(partAmount("30,000.01", a)).toEqual({ ok: false, error: PAY_ZI.tooMuch("$30,000.00") });
    // Below the maximum, the balance is the top, and the maximum says nothing.
    expect(partAmount("2,000.01", { ...a, balanceMinor: 2_000_00 })).toEqual({
      ok: false,
      error: PAY_ZI.tooMuch("$2,000.00"),
    });
  });
  it("the most to pay now is the balance or the maximum, whichever is lower", () => {
    expect(upperOf(30_000_00, 25_000_00)).toBe(25_000_00);
    expect(upperOf(2_000_00, 25_000_00)).toBe(2_000_00);
    expect(upperOf(2_000_00, null)).toBe(2_000_00);
  });
  it("leaves only for checkout.stripe.com over https", () => {
    expect(isGatewayUrl("stripe", "https://checkout.stripe.com/c/pay/cs_test_x")).toBe(true);
    expect(isGatewayUrl("stripe", "https://rzp.io/i/abc")).toBe(false);
    expect(isGatewayUrl("razorpay", "https://checkout.stripe.com/c/pay/cs_test_x")).toBe(false);
    expect(isGatewayUrl("stripe", "http://checkout.stripe.com/c/pay/x")).toBe(false);
  });
  it("a cancel-return is read once, query stripped; the signed-out page keeps only which it was", () => {
    const g = globalThis as { history?: unknown };
    const had = g.history;
    const replaced: string[] = [];
    g.history = { state: null, replaceState: (_s: unknown, _t: string, u: string) => replaced.push(u) };
    try {
      capturePayReturn({ pathname: "/invoices/doc-9", search: "?pay=cancel", hash: "" });
      expect(replaced).toEqual(["/invoices/doc-9"]);
      expect(takePayReturn("doc-9")).toBe("cancel");
      expect(takePayReturn("doc-9")).toBeNull();
      capturePayReturn({ pathname: "/invoices/doc-9", search: "?pay=return", hash: "" });
      expect(takePayReturn("doc-9")).toBe("return");
      // Another word, or none, on an invoice is not a return and the address is left alone.
      capturePayReturn({ pathname: "/invoices/doc-9", search: "?tab=x", hash: "" });
      expect(takePayReturn("doc-9")).toBeNull();
      expect(replaced).toHaveLength(2);
      capturePayReturn({ pathname: "/pay/return", search: "?pay=cancel", hash: "" });
      expect(payReturnPageKind()).toBe("cancel");
      capturePayReturn({ pathname: "/pay/return", search: "?razorpay_payment_id=pay_x", hash: "" });
      expect(payReturnPageKind()).toBe("return");
      expect(replaced).toEqual(["/invoices/doc-9", "/invoices/doc-9", "/pay/return", "/pay/return"]);
    } finally {
      g.history = had;
    }
  });
});
