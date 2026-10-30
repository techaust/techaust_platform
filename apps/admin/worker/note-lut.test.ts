// rt1 F5 [ADM-INV-18; Researched 2026-10-30, Rule 96A(1) CGST Rules, Notification 37/2017-CT (08-C RA-19, Q39); lead D7]: `noteLutOf` judges the LUT route on the
// parent's frozen COLUMNS (`export_mode` 'lut' or `supply_type` 'export_lut'), the very ones the freeze WHERE, the trigger 0054 and `explainNote` read, never on the
// parsed `computed` JSON. Pure: no database.
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import type { InvoiceSettings } from "./invoice-model.ts";
import { noteLutOf, type ParentCtx } from "./note-model.ts";

// 2027-04-02 12:00 IST: FY 2027-28
const NOW = Date.UTC(2027, 3, 2, 6, 30);
const LUT_2728 = { fy: "2728", arn: "AD1903270000002" };

const settings = (luts: { fy: string; arn: string }[]): InvoiceSettings =>
  ({ tax: { ...SETTINGS_DEFAULTS.tax, luts } }) as unknown as InvoiceSettings;

/** Only the fields `noteLutOf` may read; `computed` deliberately disagrees with the columns, so a read of it shows. */
const parent = (exportMode: string | null, supplyType: string | null, computedType: string): ParentCtx =>
  ({
    row: { export_mode: exportMode, supply_type: supplyType },
    computed: { supply: { type: computedType } },
  }) as unknown as ParentCtx;

describe("noteLutOf reads the parent's frozen columns (rt1 F5)", () => {
  it("the settings' LUT route (export_mode empty, supply_type export_lut) is judged, whatever computed says", () => {
    expect(noteLutOf("debit", parent(null, "export_lut", "inter"), settings([]), NOW)).toEqual({
      fy: "2728",
      lut: null,
    });
    expect(noteLutOf("debit", parent(null, "export_lut", "inter"), settings([LUT_2728]), NOW)).toEqual({
      fy: "2728",
      lut: LUT_2728,
    });
  });

  it("a typed LUT route is judged; an IGST-paid or domestic parent is not, even when computed says export_lut", () => {
    expect(noteLutOf("debit", parent("lut", "export_lut", "export_lut"), settings([]), NOW)?.fy).toBe("2728");
    expect(
      noteLutOf("debit", parent("igst_paid", "export_igst", "export_lut"), settings([]), NOW),
    ).toBeNull();
    expect(noteLutOf("debit", parent(null, "intra", "export_lut"), settings([]), NOW)).toBeNull();
  });

  it("rt1 review 6: the legacy `tax.lut` of M3 counts as LUT_FOR_FY_SQL counts it, even where the list would refuse it", () => {
    const legacy = (lut: { arn: string | null; fy: string | null }): InvoiceSettings =>
      ({ tax: { ...SETTINGS_DEFAULTS.tax, luts: [], lut } }) as unknown as InvoiceSettings;
    // an ARN with a hyphen (`legacyLutFate`: invalid, so `lutsOf` dropped it; the freeze WHERE and trigger 0054 accept it)
    expect(
      noteLutOf(
        "debit",
        parent("lut", "export_lut", "export_lut"),
        legacy({ arn: "AD-1903", fy: "2728" }),
        NOW,
      ),
    ).toEqual({
      fy: "2728",
      lut: { fy: "2728", arn: "AD-1903" },
    });
    // another FY's legacy letter, or a blank one, is still none
    expect(
      noteLutOf("debit", parent("lut", "export_lut", "export_lut"), legacy({ arn: "OLD1", fy: "2627" }), NOW)
        ?.lut,
    ).toBeNull();
    expect(
      noteLutOf("debit", parent("lut", "export_lut", "export_lut"), legacy({ arn: "  ", fy: "2728" }), NOW)
        ?.lut,
    ).toBeNull();
  });

  it("a credit note needs no LUT of its own", () => {
    expect(noteLutOf("credit", parent("lut", "export_lut", "export_lut"), settings([]), NOW)).toBeNull();
  });
});
