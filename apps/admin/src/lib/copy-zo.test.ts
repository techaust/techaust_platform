// M6.5 staff lines (lib/copy-zo.ts): every line, and every line a function makes from sample values, passes 07 §1.3 (core `findBannedPhrases`) and says
// "and", never "&"; the receipt and refund words never call anything a tax invoice or a voucher (RA-39); the period words; every refund state has its chip.
import { findBannedPhrases } from "@techaust/core/public-text";
import { REFUND_ORIGINS, REFUND_STATUSES } from "@techaust/core/refunds";
import { describe, expect, it } from "vitest";
import { periodText, REFUND_PILLS, ZO_UI } from "./copy-zo.ts";

/** Every string the module can show, with sample values for its functions. */
function allLines(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") {
      const f = v as (...a: unknown[]) => unknown;
      const r = f.length >= 2 ? f("₹1,000.00", "3 Nov 26", "SAMPLE-REF") : f("SAMPLE");
      if (typeof r === "string") out.push(r);
    } else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  walk(ZO_UI);
  for (const o of REFUND_ORIGINS)
    for (const p of ["manual", "razorpay", "stripe", "paypal"]) out.push(ZO_UI.origin(o, p));
  for (const r of ["stored", "empty", "unconfigured", "live_not_allowed", "retry"])
    out.push(ZO_UI.fetched(r));
  out.push(ZO_UI.matchedOf(3, 4));
  return out;
}

describe("M6.5 staff lines [ADM-PAY-08][ADM-PAY-10]", () => {
  it("pass the banned-phrase list and never use an ampersand", () => {
    for (const line of allLines()) {
      expect(findBannedPhrases(line), line).toEqual([]);
      expect(line, line).not.toContain("&");
    }
  });

  it("never call a receipt a tax invoice or a voucher, and make no stamp or signature claim (RA-39, RB-21 (b))", () => {
    for (const line of allLines()) expect(line, line).not.toMatch(/voucher|tax invoice|stamp|signature/i);
  });

  it("name every gateway and every way", () => {
    expect(ZO_UI.origin("owner", "stripe")).toBe("Through Stripe");
    expect(ZO_UI.origin("owner", "manual")).toBe("By bank transfer");
    expect(ZO_UI.origin("outside", "paypal")).toBe("Made in PayPal");
    expect(ZO_UI.origin("chargeback", "razorpay")).toBe("Lost dispute");
    expect(ZO_UI.wayGateway("razorpay")).toContain("Razorpay");
  });

  it("give every refund state a chip with an icon and words", () => {
    for (const s of REFUND_STATUSES) {
      expect(REFUND_PILLS[s].icon).toBeTruthy();
      expect(ZO_UI.status[s]).toBeTruthy();
    }
  });

  it("say a GSTR-3B period as people do", () => {
    expect(periodText("2026-11")).toBe("November 2026");
    expect(periodText("2026-Q4")).toBe("October to December 2026");
    expect(periodText("2026-Q1")).toBe("January to March 2026");
    expect(periodText("odd")).toBe("odd");
  });
});
