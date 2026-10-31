// T10 (rt2; ADM-SET-01): the Udyam fields of Settings › Company. 07-ZC lines 4 and 5 word for word (approved 2026-10-31), the category words the same as the
// PDF prints, and the rule the form follows: trimmed and in capitals, empty is null (the line is left off, L8: the key is always sent), the canonical shape only.
import { companySettings } from "@techaust/core/settings";
import { UDYAM_COPY } from "@techaust/pdf/copy";
import { describe, expect, it } from "vitest";
import { normaliseUdyam, UDYAM_FORM_COPY, UDYAM_OPTIONS, udyamCategoryOf, udyamOf } from "./udyam.ts";

describe("07-ZC lines 4 and 5", () => {
  it("the label, hint, error and category label, word for word", () => {
    expect(UDYAM_FORM_COPY).toEqual({
      label: "Udyam registration number",
      hint: "Printed on tax invoices. Leave it empty to leave it off.",
      error: "Enter the number as UDYAM-XX-00-0000000.",
      categoryLabel: "Enterprise category",
    });
  });

  it("the options are line 5's, in order, and the same words the PDF prints (L3)", () => {
    expect(UDYAM_OPTIONS).toEqual([
      { value: "micro", label: "Micro enterprise" },
      { value: "small", label: "Small enterprise" },
      { value: "medium", label: "Medium enterprise" },
    ]);
    for (const o of UDYAM_OPTIONS) expect(o.label).toBe(UDYAM_COPY.categories[o.value]);
  });

  it("the form's error is the schema's own sentence", () => {
    const r = companySettings.safeParse({
      tradeName: "T",
      legalName: null,
      gstin: null,
      stateCode: "19",
      address: null,
      documentsEmail: null,
      documentsPhone: null,
      principalPlace: null,
      logoLight: "logo-primary-color.svg",
      logoDark: "logo-primary-dark.svg",
      udyam: { number: "UDYAM-WB-1-0012345", category: "micro" },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(UDYAM_FORM_COPY.error);
  });
});

describe("udyamOf [L5, L8]", () => {
  it("empty, or only spaces, is null: no line on the invoice", () => {
    expect(udyamOf("", "micro")).toEqual({ ok: true, value: null });
    expect(udyamOf("   ", "small")).toEqual({ ok: true, value: null });
  });

  it("trims and upper-cases before the check, and keeps the category", () => {
    expect(normaliseUdyam("  udyam-wb-01-0012345 ")).toBe("UDYAM-WB-01-0012345");
    expect(udyamOf(" udyam-wb-01-0012345 ", "medium")).toEqual({
      ok: true,
      value: { number: "UDYAM-WB-01-0012345", category: "medium" },
    });
  });

  it("refuses any other shape with 07-ZC's error", () => {
    for (const bad of [
      "UDYAM-WB-01-001234",
      "UDYAM-WB-01-00123456",
      "UDYAM-W1-01-0012345",
      "WB-01-0012345",
      "UDYAM WB 01 0012345",
      "UDYAM-WB-01-0012345X",
    ])
      expect(udyamOf(bad, "micro"), bad).toEqual({ ok: false, error: UDYAM_FORM_COPY.error });
  });

  it("starts from the saved category, else micro", () => {
    expect(udyamCategoryOf(null)).toBe("micro");
    expect(udyamCategoryOf(undefined)).toBe("micro");
    expect(udyamCategoryOf({ number: "UDYAM-WB-01-0012345", category: "small" })).toBe("small");
  });
});
