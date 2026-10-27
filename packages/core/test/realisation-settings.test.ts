// The two M5.5b settings (`tax.b2clThresholdInrMinor`, `tax.realisation.inrMonths`) and their no-zod readers [ADM-INV-17, ADM-REP-07; LD77, Q15, Q18;
// VERIFY WITH CA/LEGAL]: a stored row without the new keys still parses, the zod schema and the Worker reader agree, and the reader is a twin of
// the gst core's `realisationRulesOf`.
import { describe, expect, it } from "vitest";
import { b2clThresholdFromStoredTax, realisationParamsFromStoredTax } from "../src/export-invoice.ts";
import { realisationRulesOf } from "../src/gst/index.ts";
import { SETTINGS_DEFAULTS, taxSettings } from "../src/schemas/settings.ts";

const stored = () => structuredClone(SETTINGS_DEFAULTS.tax) as Record<string, unknown>;

describe("the new settings", () => {
  it("are in the defaults: 12 months for INR, a Rs 1,00,000.00 threshold", () => {
    expect(SETTINGS_DEFAULTS.tax.realisation).toEqual({
      warnMonths: 9,
      inrMonths: 12,
      escalateMonths: 12,
      escalateExtraDays: 15,
    });
    expect(SETTINGS_DEFAULTS.tax.b2clThresholdInrMinor).toBe(1_00_000_00);
    expect(taxSettings.safeParse(SETTINGS_DEFAULTS.tax).success).toBe(true);
  });

  it("a stored tax row without them parses, with the defaults", () => {
    const old = stored();
    delete old.b2clThresholdInrMinor;
    old.realisation = { warnMonths: 9, escalateMonths: 12, escalateExtraDays: 15 };
    const r = taxSettings.safeParse(old);
    expect(r.success && r.data.b2clThresholdInrMinor).toBe(1_00_000_00);
    expect(r.success && r.data.realisation.inrMonths).toBe(12);
  });

  it("a save round-trips", () => {
    const next = {
      ...stored(),
      b2clThresholdInrMinor: 2_00_000_00,
      realisation: { warnMonths: 6, inrMonths: 18, escalateMonths: 12, escalateExtraDays: 15 },
    };
    const r = taxSettings.safeParse(next);
    expect(r.success && taxSettings.safeParse(r.data).success).toBe(true);
    expect(r.success && r.data.b2clThresholdInrMinor).toBe(2_00_000_00);
    expect(r.success && r.data.realisation.inrMonths).toBe(18);
  });

  it("refuses a zero or negative threshold and an INR period outside 1 to 120 months or not whole", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, "1"]) {
      expect(taxSettings.safeParse({ ...stored(), b2clThresholdInrMinor: bad }).success, String(bad)).toBe(
        false,
      );
    }
    for (const bad of [0, -3, 121, 12.5, "12"]) {
      const realisation = { warnMonths: 9, inrMonths: bad, escalateMonths: 12, escalateExtraDays: 15 };
      expect(taxSettings.safeParse({ ...stored(), realisation }).success, String(bad)).toBe(false);
    }
    for (const ok of [1, 120]) {
      const realisation = { warnMonths: 9, inrMonths: ok, escalateMonths: 12, escalateExtraDays: 15 };
      expect(taxSettings.safeParse({ ...stored(), realisation }).success, String(ok)).toBe(true);
    }
  });
});

describe("realisationParamsFromStoredTax (the Workers' reader)", () => {
  it("reads the defaults from an empty or missing value", () => {
    const expected = {
      ok: true,
      femaMonthsForeign: 9,
      femaMonthsInr: 12,
      gstMonths: 12,
      gstExtraDays: 15,
      approachingDays: 30,
    };
    for (const json of [undefined, null, {}, [], "x", 5, { realisation: {} }]) {
      expect(realisationParamsFromStoredTax(json), JSON.stringify(json)).toEqual(expected);
    }
  });

  it("maps warnMonths, inrMonths, escalateMonths and escalateExtraDays", () => {
    expect(
      realisationParamsFromStoredTax({
        realisation: { warnMonths: 6, inrMonths: 18, escalateMonths: 10, escalateExtraDays: 20 },
      }),
    ).toEqual({
      ok: true,
      femaMonthsForeign: 6,
      femaMonthsInr: 18,
      gstMonths: 10,
      gstExtraDays: 20,
      approachingDays: 30,
    });
  });

  it("anything of the wrong type or out of range is { ok: false }, never a guess", () => {
    const bad: unknown[] = [
      { realisation: "x" },
      { realisation: [] },
      { realisation: null },
      { realisation: { warnMonths: "9" } },
      { realisation: { warnMonths: 0 } },
      { realisation: { warnMonths: 1201 } },
      { realisation: { warnMonths: 9.5 } },
      { realisation: { warnMonths: Number.NaN } },
      { realisation: { inrMonths: -1 } },
      { realisation: { escalateMonths: 0 } },
      { realisation: { escalateExtraDays: -1 } },
      { realisation: { escalateExtraDays: 36_501 } },
    ];
    for (const json of bad)
      expect(realisationParamsFromStoredTax(json), JSON.stringify(json)).toEqual({ ok: false });
  });

  it("agrees with the zod schema: whatever the schema accepts, the reader reads the same numbers", () => {
    for (const r of [
      { warnMonths: 9, inrMonths: 12, escalateMonths: 12, escalateExtraDays: 15 },
      { warnMonths: 1, inrMonths: 1, escalateMonths: 1, escalateExtraDays: 0 },
      { warnMonths: 24, inrMonths: 120, escalateMonths: 36, escalateExtraDays: 90 },
    ]) {
      const parsed = taxSettings.safeParse({ ...stored(), realisation: r });
      expect(parsed.success).toBe(true);
      expect(realisationParamsFromStoredTax({ realisation: r })).toEqual({
        ok: true,
        femaMonthsForeign: r.warnMonths,
        femaMonthsInr: r.inrMonths,
        gstMonths: r.escalateMonths,
        gstExtraDays: r.escalateExtraDays,
        approachingDays: 30,
      });
    }
  });

  it("is a twin of the gst core's realisationRulesOf (a table)", () => {
    const table = [
      { warnMonths: 9, escalateMonths: 12, escalateExtraDays: 15 },
      { warnMonths: 6, escalateMonths: 18, escalateExtraDays: 0 },
      { warnMonths: 1200, escalateMonths: 1200, escalateExtraDays: 36_500 },
      { warnMonths: 0, escalateMonths: 12, escalateExtraDays: 15 },
      { warnMonths: 9, escalateMonths: 0, escalateExtraDays: 15 },
      { warnMonths: 9, escalateMonths: 12, escalateExtraDays: -1 },
      { warnMonths: 1201, escalateMonths: 12, escalateExtraDays: 15 },
      { warnMonths: 9, escalateMonths: 12, escalateExtraDays: 36_501 },
      { warnMonths: 9.5, escalateMonths: 12, escalateExtraDays: 15 },
      // H1: the INR period is part of the twin
      { warnMonths: 9, inrMonths: 18, escalateMonths: 12, escalateExtraDays: 15 },
      { warnMonths: 9, inrMonths: 1200, escalateMonths: 12, escalateExtraDays: 15 },
      { warnMonths: 9, inrMonths: 0, escalateMonths: 12, escalateExtraDays: 15 },
      { warnMonths: 9, inrMonths: 1201, escalateMonths: 12, escalateExtraDays: 15 },
      { warnMonths: 9, inrMonths: 9.5, escalateMonths: 12, escalateExtraDays: 15 },
    ];
    for (const realisation of table) {
      const core = realisationRulesOf(realisation);
      const reader = realisationParamsFromStoredTax({ realisation });
      expect(reader.ok, JSON.stringify(realisation)).toBe(core.ok);
      if (core.ok && reader.ok) {
        expect(reader).toMatchObject({
          femaMonthsForeign: core.value.femaMonthsForeign,
          femaMonthsInr: core.value.femaMonthsInr,
          gstMonths: core.value.gstMonths,
          gstExtraDays: core.value.gstExtraDays,
          approachingDays: core.value.approachingDays,
        });
      }
    }
  });
});

describe("b2clThresholdFromStoredTax", () => {
  it("missing is the default; a positive safe integer is read; anything else is null", () => {
    for (const json of [undefined, {}, null, [], { b2clThresholdInrMinor: undefined }]) {
      expect(b2clThresholdFromStoredTax(json)).toBe(1_00_000_00);
    }
    expect(b2clThresholdFromStoredTax({ b2clThresholdInrMinor: 2_00_000_00 })).toBe(2_00_000_00);
    expect(b2clThresholdFromStoredTax({ b2clThresholdInrMinor: 1 })).toBe(1);
    for (const bad of [0, -1, 1.5, "100", Number.NaN, 2 ** 53, null]) {
      expect(b2clThresholdFromStoredTax({ b2clThresholdInrMinor: bad }), String(bad)).toBeNull();
    }
  });
});
