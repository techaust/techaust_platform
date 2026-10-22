import { describe, expect, it } from "vitest";
import {
  ANY_TIME,
  BAND_BOUNDS,
  budgetBandLabel,
  budgetBandOptions,
  CALL_WINDOWS,
  callWindowText,
  countryName,
  labelOf,
  TIMELINE_LABELS,
  TOOL_LABELS,
} from "../src/form-labels.ts";
import { BUDGET_BANDS, TIMELINES, TOOLS } from "../src/schemas/forms.ts";

describe("form labels (shared by the quote page and the lead alert)", () => {
  it("labels every budget band of the schema, Not sure last, amounts from formatMoney", () => {
    for (const cur of ["INR", "USD"] as const) {
      const opts = budgetBandOptions(cur);
      expect(opts.map((o) => o.value)).toEqual([...BUDGET_BANDS[cur]]);
      expect(opts.at(-1)?.label).toBe("Not sure");
    }
    expect(budgetBandLabel("INR", "lt-1l")).toBe("Under ₹1,00,000");
    expect(budgetBandLabel("INR", "1l-3l")).toBe("₹1,00,000 to ₹3,00,000");
    expect(budgetBandLabel("INR", "15l-plus")).toBe("₹15,00,000 or more");
    expect(budgetBandLabel("USD", "2k-5k")).toBe("$2,000 to $5,000");
  });

  it("falls back to the code for an unknown band, and bands touch end to end", () => {
    expect(budgetBandLabel("INR", "2k-5k")).toBe("2k-5k");
    for (const cur of ["INR", "USD"] as const) {
      const bounds = Object.values(BAND_BOUNDS[cur]);
      for (let i = 1; i < bounds.length; i++) expect(bounds[i]?.[0]).toBe(bounds[i - 1]?.[1]);
    }
  });

  it("has a label for every timeline and tool", () => {
    for (const t of TIMELINES) expect(TIMELINE_LABELS[t]).toBeTruthy();
    for (const t of TOOLS) expect(TOOL_LABELS[t]).toBeTruthy();
    expect(labelOf(TIMELINE_LABELS, "asap")).toBe("As soon as possible");
    expect(labelOf(TOOL_LABELS, "nope")).toBe("nope");
  });

  it("writes call windows as IST text and country names without '&'", () => {
    expect(CALL_WINDOWS.map(callWindowText)).toEqual([
      "10:00–13:00 IST",
      "13:00–16:00 IST",
      "16:00–19:00 IST",
    ]);
    expect(ANY_TIME).toBe("Any time");
    expect(countryName("IN")).toBe("India");
    expect(countryName("AG")).toBe("Antigua and Barbuda");
    expect(countryName("zz-bad")).toBe("zz-bad");
  });
});
