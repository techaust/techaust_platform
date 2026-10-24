import { describe, expect, it } from "vitest";
import { FINANCE_AUDIT_ACTIONS } from "../src/audit.ts";
import { TERMS_BLOCK_IDS, TERMS_BLOCKS, termsBody, termsTarget } from "../src/terms.ts";

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
