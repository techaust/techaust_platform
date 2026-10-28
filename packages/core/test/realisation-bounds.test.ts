// The tax settings schema's realisation bounds equal the Workers' reader's (M5.5b review round, finding 4 [ADM-INV-17; Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-01)]):
// a value the Settings page can save must never make every report route answer 409 settings_invalid.
import { describe, expect, it } from "vitest";
import { realisationParamsFromStoredTax } from "../src/export-invoice.ts";
import { SETTINGS_DEFAULTS, taxSettings } from "../src/schemas/settings.ts";

const stored = () => structuredClone(SETTINGS_DEFAULTS.tax) as Record<string, unknown>;
const base = { warnMonths: 9, inrMonths: 12, escalateMonths: 12, escalateExtraDays: 15 };
const fields = ["warnMonths", "escalateMonths", "escalateExtraDays"] as const;
const values = [-1, 0, 1, 2, 119, 120, 121, 1199, 1200, 1201, 36_499, 36_500, 36_501, 9.5];

const schemaOk = (realisation: object) => taxSettings.safeParse({ ...stored(), realisation }).success;

describe("the schema's bounds equal the reader's", () => {
  it("the schema accepts a value exactly when the reader does (the edges: 1 and 1,200 months, 0 and 36,500 days)", () => {
    for (const field of fields) {
      for (const v of values) {
        const realisation = { ...base, [field]: v };
        const read = realisationParamsFromStoredTax({ realisation });
        expect(read.ok, `${field}=${v}`).toBe(schemaOk(realisation));
        if (read.ok) {
          // an accepted value is read as the same number
          const key = {
            warnMonths: "femaMonthsForeign",
            escalateMonths: "gstMonths",
            escalateExtraDays: "gstExtraDays",
          }[field] as "femaMonthsForeign" | "gstMonths" | "gstExtraDays";
          expect(read[key]).toBe(v);
        }
      }
    }
    expect([1200, 1201, 0, 1].map((v) => schemaOk({ ...base, warnMonths: v }))).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect([1200, 1201].map((v) => schemaOk({ ...base, escalateMonths: v }))).toEqual([true, false]);
    expect([36_500, 36_501, 0, -1].map((v) => schemaOk({ ...base, escalateExtraDays: v }))).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it("inrMonths: whatever the schema accepts (1 to 120) the reader accepts", () => {
    for (const v of [1, 12, 120]) {
      const realisation = { ...base, inrMonths: v };
      expect(schemaOk(realisation)).toBe(true);
      expect(realisationParamsFromStoredTax({ realisation })).toMatchObject({ ok: true, femaMonthsInr: v });
    }
    expect(schemaOk({ ...base, inrMonths: 121 })).toBe(false);
  });
});
