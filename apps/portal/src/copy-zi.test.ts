// 07-ZI (POR-06, ADM-PAY-02, ADM-PAY-12): the portal's client lines 1 to 16, word for word with docs/07-content-appendix/ZI-m6.2-razorpay.md (read here, so a
// change to the page that isn't made in the code fails), and the pure rules of the amount dialog and the return from Razorpay.

import { isGatewayLinkUrl } from "@techaust/core/gateway-rpc";
import { describe, expect, it } from "vitest";
import ziPage from "../../../docs/07-content-appendix/ZI-m6.2-razorpay.md?raw";
import { PAY_ZI } from "./copy-zi.ts";
import { forgetPay, isRazorpayUrl, partAmount, recalledPay, receivedAfter, rememberPay } from "./lib/pay.ts";
import paySource from "./lib/pay.ts?raw";

/** The quoted lines of 07-ZI's numbered client line `n` (before the staff section). */
function quoted(n: number): string[] {
  const client = ziPage.split("## Staff lines")[0] as string;
  const line = client.split("\n").find((l) => l.startsWith(`${n}. `));
  if (!line) throw new Error(`07-ZI has no line ${n}`);
  return [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

describe("07-ZI client lines [POR-06]", () => {
  it("are approved by the owner (2026-11-01)", () => {
    expect(ziPage).toContain("client lines C1–C16 APPROVED by the owner, 2026-11-01");
  });

  it("1 to 16, word for word", () => {
    expect([PAY_ZI.payNow]).toEqual(quoted(1));
    expect([PAY_ZI.howMuch]).toEqual(quoted(2));
    expect([PAY_ZI.full("{amount}")]).toEqual(quoted(3));
    expect([PAY_ZI.part("{minimum}")]).toEqual(quoted(4));
    expect([PAY_ZI.between("{minimum}", "{balance}")]).toEqual(quoted(5));
    expect([PAY_ZI.atLeast("{minimum}"), PAY_ZI.tooMuch("{balance}")]).toEqual(quoted(6));
    expect([PAY_ZI.wholeRupees]).toEqual(quoted(7));
    expect([PAY_ZI.continue]).toEqual(quoted(8));
    expect([PAY_ZI.howItWorks]).toEqual(quoted(9));
    expect([PAY_ZI.checking, PAY_ZI.checkingBody]).toEqual(quoted(10));
    expect([PAY_ZI.received("{amount}")]).toEqual(quoted(11));
    expect([PAY_ZI.receivedProforma("{amount}")]).toEqual(quoted(12));
    expect([PAY_ZI.notYet]).toEqual(quoted(13));
    expect([PAY_ZI.unavailable]).toEqual(quoted(14));
    expect([PAY_ZI.returned]).toEqual(quoted(15));
    expect([PAY_ZI.proformaPaid("{date}")]).toEqual(quoted(16));
  });
});

describe("the part amount [POR-06]", () => {
  const a = { minimumMinor: 10_000_00, balanceMinor: 59_000_00, wholeRupees: false };
  it("reads the Indian way, with or without the rupee sign", () => {
    expect(partAmount("12,500", a)).toEqual({ ok: true, minor: 12_500_00 });
    expect(partAmount("₹12,500.50", a)).toEqual({ ok: true, minor: 12_500_50 });
    expect(partAmount("59000", a)).toEqual({ ok: true, minor: 59_000_00 });
  });
  it("says line 5 when it can't be read, line 6 outside the range, line 7 on a proforma's paise", () => {
    expect(partAmount("", a)).toEqual({ ok: false, error: PAY_ZI.between("₹10,000.00", "₹59,000.00") });
    expect(partAmount("abc", a)).toEqual({ ok: false, error: PAY_ZI.between("₹10,000.00", "₹59,000.00") });
    expect(partAmount("0", a)).toEqual({ ok: false, error: PAY_ZI.between("₹10,000.00", "₹59,000.00") });
    expect(partAmount("9,999.99", a)).toEqual({ ok: false, error: PAY_ZI.atLeast("₹10,000.00") });
    expect(partAmount("59,000.01", a)).toEqual({ ok: false, error: PAY_ZI.tooMuch("₹59,000.00") });
    expect(partAmount("12,500.50", { ...a, wholeRupees: true })).toEqual({
      ok: false,
      error: PAY_ZI.wholeRupees,
    });
    expect(partAmount("12,500", { ...a, wholeRupees: true })).toEqual({ ok: true, minor: 12_500_00 });
  });
});

describe("leaving for Razorpay and coming back [ADM-PAY-02]", () => {
  it("leaves only for Razorpay's own hosts over https", () => {
    expect(isRazorpayUrl("https://rzp.io/i/abc123")).toBe(true);
    expect(isRazorpayUrl("https://pages.razorpay.com/pl_x")).toBe(true);
    expect(isRazorpayUrl("http://rzp.io/i/abc")).toBe(false);
    expect(isRazorpayUrl("https://rzp.io.example.test/i/abc")).toBe(false);
    expect(isRazorpayUrl("https://user:pw@rzp.io/i/abc")).toBe(false);
    expect(isRazorpayUrl("javascript:alert(1)")).toBe(false);
    // Review finding 12: one check and one host list, shared with the portal's Worker and the finance Worker.
    for (const v of [
      "https://rzp.io/i/abc123",
      "https://pages.razorpay.com/pl_x",
      "https://razorpay.com.evil.test/x",
      "http://rzp.io/i/abc",
      `https://rzp.io/${"a".repeat(5000)}`,
    ])
      expect(isRazorpayUrl(v), v.slice(0, 40)).toBe(isGatewayLinkUrl("razorpay", v));
    expect(paySource).not.toMatch(/rzp\.io|razorpay\.com/);
  });
  it("review finding 5: counts only a payment newer than the newest one the page showed at the press", () => {
    const earlier = { amountMinor: 2_000_000, at: 1_000 };
    // The page showed an earlier payment at the press: that one is never "the one just made"; a newer one is.
    expect(receivedAfter(earlier, { seenAt: 1_000 })).toBeNull();
    expect(receivedAfter({ amountMinor: 50_000, at: 1_001 }, { seenAt: 1_000 })).toEqual({
      amountMinor: 50_000,
      at: 1_001,
    });
    // It showed none: any payment now shown is new.
    expect(receivedAfter(earlier, { seenAt: null })).toEqual(earlier);
    expect(receivedAfter(null, { seenAt: null })).toBeNull();
  });
  it("review finding 5: with no press remembered in this tab, nothing counts (the page ends on line 13, never received)", () => {
    expect(receivedAfter({ amountMinor: 2_000_000, at: Date.now() }, null)).toBeNull();
    expect(receivedAfter(undefined, null)).toBeNull();
  });
  it("the press is remembered with what the page showed, for its own document only; an older entry without it is no press", () => {
    const store = new Map<string, string>();
    const g = globalThis as { sessionStorage?: unknown };
    const had = g.sessionStorage;
    g.sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    try {
      rememberPay("doc-1", 50_000, 1_000, 2_000);
      expect(recalledPay("doc-1")).toEqual({ amountMinor: 50_000, at: 2_000, seenAt: 1_000 });
      expect(recalledPay("doc-2")).toBeNull();
      rememberPay("doc-1", 50_000, null, 2_000);
      expect(recalledPay("doc-1")).toEqual({ amountMinor: 50_000, at: 2_000, seenAt: null });
      store.set("ta.pay", JSON.stringify({ documentId: "doc-1", amountMinor: 50_000, at: 2_000 }));
      expect(recalledPay("doc-1")).toBeNull();
      forgetPay();
      expect(recalledPay("doc-1")).toBeNull();
    } finally {
      g.sessionStorage = had;
    }
  });
});
