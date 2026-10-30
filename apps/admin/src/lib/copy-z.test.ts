// 07-Z (FX-5): the lines pending the owner carry the "[Placeholder] " mark until APPROVED_07Z, word for word with docs/07-content-appendix/Z-fx5-pending.md.
import { describe, expect, it } from "vitest";
import { APPROVED_07Z, PLACEHOLDER_MARK, TERMS_DUE_DAYS_COPY, VOID_VIEWED_COPY, Z } from "./copy-z.ts";

const mark = APPROVED_07Z ? "" : `${PLACEHOLDER_MARK} `;

describe("07-Z lines [FX-5]", () => {
  it("are approved (owner, 2026-10-30): no mark", () => {
    expect(APPROVED_07Z).toBe(true);
    expect(Z("Line.")).toBe(`${mark}Line.`);
  });

  it("§1: void after a portal view", () => {
    expect(VOID_VIEWED_COPY.invoice).toBe(
      `${mark}The client has opened this invoice in the portal, so it can't be voided. Use a credit note instead.`,
    );
    expect(VOID_VIEWED_COPY.proforma).toBe(
      `${mark}The client has opened this proforma in the portal, so it can't be voided.`,
    );
  });

  it("§2: the terms' due days against Settings › Payment terms (1 day, more days, two numbers)", () => {
    expect(TERMS_DUE_DAYS_COPY.refused([14], 7)).toBe(
      `${mark}These terms say invoices are due within 14 days, but Settings › Payment terms says 7 days. Change the number here, or change Payment terms first.`,
    );
    expect(TERMS_DUE_DAYS_COPY.refused([1, 30], 7)).toContain("due within 1 day and 30 days, but");
    expect(TERMS_DUE_DAYS_COPY.warning([7])).toBe(
      `${mark}Your proposal terms say invoices are due within 7 days. Save a new version in Settings › Terms so they match.`,
    );
  });
});
