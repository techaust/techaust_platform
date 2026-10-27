// The small shared helpers of the GST core [ADM-REP-04].
import { describe, expect, it } from "vitest";
import { compareDates, compareText, signOf, uniqueIssues } from "../../src/gst/types.ts";
import { d } from "./fixtures.ts";

describe("helpers", () => {
  it("uniqueIssues drops a repeated code and path, keeping the first, in order", () => {
    expect(
      uniqueIssues([
        { code: "amount_invalid", path: ["a"] },
        { code: "amount_invalid", path: ["a"] },
        { code: "amount_invalid", path: ["b"] },
        { code: "date_invalid", path: ["a"] },
        { code: "date_invalid", path: ["a"] },
      ]),
    ).toEqual([
      { code: "amount_invalid", path: ["a"] },
      { code: "amount_invalid", path: ["b"] },
      { code: "date_invalid", path: ["a"] },
    ]);
  });
  it("compares dates and text without a locale", () => {
    expect(compareDates(d(2026, 1, 2), d(2026, 1, 3))).toBe(-1);
    expect(compareDates(d(2026, 2, 1), d(2026, 1, 31))).toBe(1);
    expect(compareDates(d(2026, 1, 1), d(2026, 1, 1))).toBe(0);
    expect(compareText("a", "b")).toBe(-1);
    expect(compareText("b", "a")).toBe(1);
    expect(compareText("a", "a")).toBe(0);
    expect(compareText("Z", "a")).toBe(-1); // code-unit order, not dictionary order
  });
  it("only a credit note reduces the sums", () => {
    expect(signOf("credit_note")).toBe(-1n);
    for (const k of ["tax_invoice", "export_invoice", "debit_note"] as const) expect(signOf(k)).toBe(1n);
  });
});
