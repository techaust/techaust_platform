import { describe, expect, it } from "vitest";
import { FINANCE_AUDIT_ACTIONS } from "../src/audit.ts";
import {
  TERMS_BLOCK_IDS,
  TERMS_BLOCKS,
  termsBody,
  termsDueDays,
  termsDueDaysMismatch,
  termsTarget,
} from "../src/terms.ts";

describe("document terms blocks [ADM-SET-08]", () => {
  it("maps the five PRD blocks to a table and kind, and refuses website and unknown names", () => {
    expect([...TERMS_BLOCK_IDS].sort()).toEqual(
      ["export_declaration", "invoice_footer", "proposal_terms", "refund_link", "standard_terms"].sort(),
    );
    expect(termsTarget("proposal_terms")).toMatchObject({ table: "terms_versions", kind: "proposal" });
    expect(termsTarget("invoice_footer")).toMatchObject({ table: "terms_versions", kind: "invoice" });
    expect(termsTarget("standard_terms")).toMatchObject({ table: "terms_blocks" });
    expect(termsTarget("website")).toBeUndefined();
    expect(termsTarget("toString")).toBeUndefined();
    expect(termsTarget("")).toBeUndefined();
    // No block maps to the website kind.
    expect(Object.values(TERMS_BLOCKS).some((b) => (b.kind as string) === "website")).toBe(false);
  });

  it("the refund-policy link must be https; the other blocks are non-empty text", () => {
    expect(termsBody("refund_link").safeParse("https://techaust.com/refund-policy").success).toBe(true);
    expect(termsBody("refund_link").safeParse("http://techaust.com/refund-policy").success).toBe(false);
    expect(termsBody("refund_link").safeParse("javascript:alert(1)").success).toBe(false);
    expect(termsBody("standard_terms").safeParse("   ").success).toBe(false);
    expect(termsBody("standard_terms").safeParse("Some terms").success).toBe(true);
  });
});

describe("the accountant's audit list [ADM-AUD-02]", () => {
  it("is one list of distinct dotted actions", () => {
    expect(new Set(FINANCE_AUDIT_ACTIONS).size).toBe(FINANCE_AUDIT_ACTIONS.length);
    for (const a of FINANCE_AUDIT_ACTIONS) expect(a).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    expect(FINANCE_AUDIT_ACTIONS).toContain("settings.tax.update");
    expect(FINANCE_AUDIT_ACTIONS).not.toContain("settings.company.update");
  });
});

describe("the due days the proposal terms state [FX-5 C4, ADM-SET-05, 08-C RB-39]", () => {
  it("reads every 'due within N days', once each, in order; none is empty", () => {
    expect(termsDueDays("2. **Payment.** Invoices are due within 7 days. GST at 18 % is added.")).toEqual([
      7,
    ]);
    expect(termsDueDays("Due within 7 days. Then due within 30 days, and again due within 7 days.")).toEqual([
      7, 30,
    ]);
    expect(termsDueDays("Invoices are DUE WITHIN 1 day of issue.")).toEqual([1]);
    expect(termsDueDays("Payable on receipt.")).toEqual([]);
    expect(termsDueDays("overdue within 7 days")).toEqual([]);
  });
  it("names only the days that differ from the setting", () => {
    expect(termsDueDaysMismatch("Invoices are due within 7 days.", 7)).toEqual([]);
    expect(termsDueDaysMismatch("Invoices are due within 7 days.", 14)).toEqual([7]);
    expect(termsDueDaysMismatch("No number here.", 14)).toEqual([]);
  });
});
