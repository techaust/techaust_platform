import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { financialYear } from "../src/dates.ts";
import {
  canSetNextNumber,
  defaultFormat,
  formatDocumentNumber,
  MAX_NUMBER_LENGTH,
  maxNumber,
  type NumberingFormat,
  parseDocumentNumber,
  SERIES,
  type Series,
  sqlPrintfPattern,
  validateFormat,
} from "../src/numbering.ts";

const fy2627 = financialYear(2026);

// A tiny model of SQLite printf for the two conversions we emit (%s and %0Nd).
const printf = (pattern: string, args: (string | number)[]) => {
  let i = 0;
  return pattern.replace(/%(?:s|0(\d)d)/g, (_, width?: string) => {
    const v = args[i++];
    return width ? String(v).padStart(Number(width), "0") : String(v);
  });
};

describe("default formats [ADM-SET-04]", () => {
  it.each(Object.keys(SERIES) as Series[])("%s fits 16 characters", (series) => {
    const f = defaultFormat(series);
    expect(validateFormat(f)).toMatchObject({ ok: true });
    expect(formatDocumentNumber(f, fy2627, maxNumber(f)).length).toBeLessThanOrEqual(MAX_NUMBER_LENGTH);
  });

  it("matches the PRD examples", () => {
    expect(formatDocumentNumber(defaultFormat("invoice"), fy2627, 1)).toBe("TH/INV/2627/0001");
    expect(formatDocumentNumber(defaultFormat("creditNote"), fy2627, 12)).toBe("TH/CN/2627/0012");
    expect(formatDocumentNumber(defaultFormat("proposal"), financialYear(2027), 9_999)).toBe(
      "TH/PRP/2728/9999",
    );
  });
});

describe("format validation", () => {
  const check = (template: string, padding = 4) => validateFormat({ template, padding });

  it("rejects formats that can exceed 16 characters", () => {
    expect(check("TH/INV/{FY}/{N}", 5)).toEqual({
      ok: false,
      error: "Numbers could reach 17 characters; the limit is 16",
    });
    expect(check("TECHAUST/{FY}/{N}")).toMatchObject({ ok: false });
    expect(check("INV/{FY}/{N}", 5)).toEqual({ ok: true, maxLength: 14 });
  });

  it("allows only A–Z, 0–9, / and -", () => {
    expect(check("th/inv/{FY}/{N}")).toMatchObject({ ok: false, error: expect.stringContaining("capital") });
    expect(check("TH_INV/{FY}/{N}")).toMatchObject({ ok: false });
    expect(check("TH/%/{FY}/{N}")).toMatchObject({ ok: false });
    expect(check("TH-INV-{FY}-{N}")).toMatchObject({ ok: true });
  });

  it("needs {FY} and {N} exactly once, with a separator between them", () => {
    expect(check("TH/INV/{N}")).toMatchObject({ ok: false, error: expect.stringContaining("{FY}") });
    expect(check("{FY}/{N}/{N}")).toMatchObject({ ok: false });
    expect(check("TH/{FY}{N}")).toMatchObject({ ok: false, error: expect.stringContaining("separator") });
    expect(check("{N}/{FY}")).toMatchObject({ ok: true });
  });

  it("checks padding", () => {
    expect(check("TH/{FY}/{N}", 0)).toMatchObject({ ok: false });
    expect(check("TH/{FY}/{N}", 9)).toMatchObject({ ok: false });
    expect(check("TH/{FY}/{N}", 2.5)).toMatchObject({ ok: false });
  });

  it("refuses to format with an invalid format or out-of-range counter", () => {
    expect(() => formatDocumentNumber({ template: "bad", padding: 4 }, fy2627, 1)).toThrow(RangeError);
    expect(() => formatDocumentNumber(defaultFormat("invoice"), fy2627, 0)).toThrow(RangeError);
    expect(() => formatDocumentNumber(defaultFormat("invoice"), fy2627, 10_000)).toThrow(RangeError);
    expect(() => parseDocumentNumber({ template: "bad", padding: 4 }, "x")).toThrow(RangeError);
    expect(() => sqlPrintfPattern({ template: "bad", padding: 4 })).toThrow(RangeError);
  });
});

// Random valid formats: a prefix, the two tokens in either order, a separator and an optional suffix.
const seg = fc.stringMatching(/^[A-Z0-9]{0,4}$/);
const sep = fc.constantFrom("/", "-");
const formatArb: fc.Arbitrary<NumberingFormat> = fc
  .record({
    pre: seg,
    s1: sep,
    s2: sep,
    post: seg,
    fyFirst: fc.boolean(),
    padding: fc.integer({ min: 1, max: 6 }),
  })
  .map(({ pre, s1, s2, post, fyFirst, padding }) => ({
    template: `${pre}${pre ? s1 : ""}${fyFirst ? "{FY}" : "{N}"}${s2}${fyFirst ? "{N}" : "{FY}"}${post ? s1 + post : ""}`,
    padding,
  }))
  .filter((f) => validateFormat(f).ok);

describe("properties", () => {
  it("every number of a valid format fits, uses allowed characters and reads back", () => {
    fc.assert(
      fc.property(
        formatArb,
        fc.integer({ min: 2000, max: 2098 }),
        fc.integer({ min: 1, max: 999_999 }),
        (f, y, raw) => {
          const n = (raw % maxNumber(f)) + 1;
          const fy = financialYear(y);
          const value = formatDocumentNumber(f, fy, n);
          expect(value.length).toBeLessThanOrEqual(MAX_NUMBER_LENGTH);
          expect(value).toMatch(/^[A-Z0-9/-]+$/);
          const back = parseDocumentNumber(f, value);
          expect(back?.n).toBe(n);
          expect(back?.fy.startYear).toBe(y);
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it("the SQL printf pattern produces the same string as the app", () => {
    fc.assert(
      fc.property(formatArb, fc.integer({ min: 1, max: 9 }), (f, n) => {
        const { pattern, argOrder } = sqlPrintfPattern(f);
        const args = argOrder.map((a) => (a === "fy" ? fy2627.token : n));
        expect(printf(pattern, args)).toBe(formatDocumentNumber(f, fy2627, n));
      }),
    );
    expect(sqlPrintfPattern(defaultFormat("invoice"))).toEqual({
      pattern: "TH/INV/%s/%04d",
      argOrder: ["fy", "n"],
    });
  });
});

describe("parsing and counters", () => {
  const f = defaultFormat("invoice");
  it("rejects numbers from another format or an impossible year token", () => {
    expect(parseDocumentNumber(f, "TH/CN/2627/0001")).toBeNull();
    expect(parseDocumentNumber(f, "TH/INV/2628/0001")).toBeNull();
    expect(parseDocumentNumber(f, "TH/INV/2627/0000")).toBeNull();
    expect(parseDocumentNumber(f, "TH/INV/2627/001")).toBeNull();
    expect(parseDocumentNumber(f, "TH/INV/9900/0001")?.fy.label).toBe("2099-00");
  });

  it("the next number can go up, never down", () => {
    expect(canSetNextNumber(5, 5)).toBe(true);
    expect(canSetNextNumber(5, 9)).toBe(true);
    expect(canSetNextNumber(5, 4)).toBe(false);
    expect(canSetNextNumber(5, 6.5)).toBe(false);
  });
});
