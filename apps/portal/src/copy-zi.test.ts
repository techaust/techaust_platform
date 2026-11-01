// 07-ZI (POR-06, ADM-PAY-02, ADM-PAY-12): the portal's client lines 1 to 16, word for word with docs/07-content-appendix/ZI-m6.2-razorpay.md (read here, so a
// change to the page that isn't made in the code fails), and the pure rules of the amount dialog and the return from Razorpay.
import { describe, expect, it } from "vitest";
import ziPage from "../../../docs/07-content-appendix/ZI-m6.2-razorpay.md?raw";
import { PAY_ZI } from "./copy-zi.ts";
import { isRazorpayUrl, partAmount, receivedSince } from "./lib/pay.ts";

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
    expect(partAmount("12,500.50", { ...a, wholeRupees: true })).toEqual({ ok: false, error: PAY_ZI.wholeRupees });
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
  });
  it("counts only a payment received since the press", () => {
    expect(receivedSince(null, 100)).toBeNull();
    expect(receivedSince({ amountMinor: 5, at: 99 }, 100)).toBeNull();
    expect(receivedSince({ amountMinor: 5, at: 100 }, 100)).toEqual({ amountMinor: 5, at: 100 });
  });
});
