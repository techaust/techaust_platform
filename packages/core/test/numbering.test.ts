import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { financialYear } from "../src/dates.ts";
import {
  canSetNextNumber,
  defaultFormat,
  formatDocumentNumber,
  formatsCanClash,
  MAX_NUMBER_LENGTH,
  maxNumber,
  type NumberingFormat,
  numberingClashes,
  parseDocumentNumber,
  SERIES,
  type Series,
  sqlPrintfPattern,
  validateFormat,
  validateStoredFormat,
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
    // M5.1 (LD18): a number that starts with the counter starts with a padding zero, so this needs a one-digit padding now.
    expect(check("{N}/{FY}", 1)).toMatchObject({ ok: true });
  });

  it("the number must not start with 0, / or - (LD18, 08-A §4: the e-invoice number starts with a letter or 1-9)", () => {
    for (const bad of ["/{FY}/{N}", "-{FY}-{N}", "0TH/{FY}/{N}", "0/{FY}/{N}"])
      expect(check(bad), bad).toMatchObject({ ok: false, error: expect.stringContaining("must not start") });
    expect(check("{N}/{FY}", 4)).toMatchObject({
      ok: false,
      error: expect.stringContaining("must not start"),
    });
    expect(check("{N}-{FY}", 2)).toMatchObject({ ok: false });
    for (const good of ["TH/{FY}/{N}", "{FY}/{N}", "1A/{FY}/{N}", "A0/{FY}/{N}"])
      expect(check(good), good).toMatchObject({ ok: true });
    expect(check("{N}/{FY}", 1)).toMatchObject({ ok: true });
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

  it("no valid format ever gives a number that starts with 0, / or - (LD18)", () => {
    fc.assert(
      fc.property(
        formatArb,
        fc.integer({ min: 2010, max: 2098 }),
        fc.integer({ min: 1, max: 999_999 }),
        (f, y, raw) => {
          const value = formatDocumentNumber(f, financialYear(y), (raw % maxNumber(f)) + 1);
          expect(value).toMatch(/^[A-Z1-9]/);
        },
      ),
      { numRuns: 2_000 },
    );
    // and a format that could is refused whatever its other parts (the first character is the point, not the rest)
    fc.assert(
      fc.property(
        fc.constantFrom("/", "-", "0"),
        seg,
        fc.integer({ min: 1, max: 6 }),
        (lead, rest, padding) => {
          expect(validateFormat({ template: `${lead}${rest}/{FY}/{N}`, padding }).ok).toBe(false);
        },
      ),
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

describe("a stored format reads under the pre-M5.1 rules; the first-character rule is for saving [LD18; review 4]", () => {
  const older = [
    { template: "{N}/{FY}", padding: 4 },
    { template: "-{FY}-{N}", padding: 4 },
    { template: "0TH/{FY}/{N}", padding: 3 },
  ];

  it("validateStoredFormat accepts what LD18 refuses on save, and still refuses what was never valid", () => {
    for (const f of older) {
      expect(validateFormat(f).ok, f.template).toBe(false);
      expect(validateStoredFormat(f).ok, f.template).toBe(true);
    }
    for (const never of [
      { template: "TH/INVOICE/{FY}/{N}", padding: 4 },
      { template: "{FY}{N}", padding: 4 },
      { template: "th/{FY}/{N}", padding: 4 },
      { template: "TH/{FY}/{N}", padding: 9 },
    ])
      expect(validateStoredFormat(never).ok, never.template).toBe(false);
  });

  it("formatting, parsing and the SQL pattern work for a stored format and never throw", () => {
    for (const f of older) {
      const text = formatDocumentNumber(f, fy2627, 7);
      expect(parseDocumentNumber(f, text)).toMatchObject({ n: 7 });
      expect(() => sqlPrintfPattern(f)).not.toThrow();
    }
    expect(formatDocumentNumber({ template: "{N}/{FY}", padding: 4 }, fy2627, 7)).toBe("0007/2627");
  });
});

describe("no two series can print the same number [ADM-SET-04, A0 2]", () => {
  const f = (template: string, padding = 4): NumberingFormat => ({ template, padding });

  it("the default formats never clash", () => {
    const all = Object.fromEntries((Object.keys(SERIES) as Series[]).map((s) => [s, defaultFormat(s)]));
    expect(numberingClashes(all)).toEqual([]);
  });

  it("the same literal text clashes (the brief's rule), and so does the same shape", () => {
    expect(formatsCanClash(f("TH/INV/{FY}/{N}"), f("TH/INV/{FY}/{N}"))).toBe(true);
    expect(formatsCanClash(f("TH/INV/{FY}/{N}"), f("TH/INV{FY}//{N}"))).toBe(true);
    // Different literal text, same printed number: "TH/2627/00001" both ways.
    expect(formatDocumentNumber(f("TH/{FY}/{N}", 5), fy2627, 1)).toBe(
      formatDocumentNumber(f("TH/{FY}/0{N}", 4), fy2627, 1),
    );
    expect(formatsCanClash(f("TH/{FY}/{N}", 5), f("TH/{FY}/0{N}", 4))).toBe(true);
    // Different letters, lengths or separators never clash.
    expect(formatsCanClash(f("TH/INV/{FY}/{N}"), f("TH/EXP/{FY}/{N}"))).toBe(false);
    // The brief's rule refuses the same text with another padding too (the numbers differ in length, but a reader could not tell the series apart).
    expect(formatsCanClash(f("TH/{FY}/{N}", 4), f("TH/{FY}/{N}", 5))).toBe(true);
    expect(formatsCanClash(f("TH/A/{FY}/{N}", 4), f("TH/{FY}/A/{N}", 4))).toBe(false);
    expect(formatsCanClash(f("TH/{FY}/{N}"), f("TH-{FY}/{N}"))).toBe(false);
    expect(formatsCanClash(f("TH/1/{FY}/{N}"), f("TH/2/{FY}/{N}"))).toBe(false);
    // A format that cannot be read never clashes here (validateStoredFormat refuses it).
    expect(formatsCanClash(f("TH/{N}"), f("TH/{N}"))).toBe(false);
  });

  it("lists every clashing pair once, in SERIES order", () => {
    expect(
      numberingClashes({
        invoice: f("TH/A/{FY}/{N}"),
        export: f("TH/B/{FY}/{N}"),
        proforma: f("TH/A/{FY}/{N}"),
        proposal: f("TH/A/{FY}/{N}"),
      }),
    ).toEqual([
      ["invoice", "proforma"],
      ["invoice", "proposal"],
      ["proforma", "proposal"],
    ]);
  });

  it("is sound: whenever one format's number reads as another's, the pair is a clash (property)", () => {
    const part = fc.string({ unit: fc.constantFrom("A", "0", "1", "/"), maxLength: 3 });
    const format = fc
      .record({
        before: part,
        middle: part,
        after: part,
        fyFirst: fc.boolean(),
        padding: fc.integer({ min: 1, max: 4 }),
      })
      .map(
        (p): NumberingFormat => ({
          template: `${p.before}${p.fyFirst ? "{FY}" : "{N}"}${p.middle || "/"}${p.fyFirst ? "{N}" : "{FY}"}${p.after}`,
          padding: p.padding,
        }),
      )
      .filter((x) => validateStoredFormat(x).ok);
    fc.assert(
      fc.property(
        format,
        format,
        fc.integer({ min: 2000, max: 2098 }),
        fc.integer({ min: 1, max: 9999 }),
        (a, b, year, raw) => {
          const text = formatDocumentNumber(a, financialYear(year), (raw % maxNumber(a)) + 1);
          if (parseDocumentNumber(b, text) !== null) expect(formatsCanClash(a, b)).toBe(true);
          expect(formatsCanClash(a, b)).toBe(formatsCanClash(b, a));
        },
      ),
      { numRuns: 3000 },
    );
  });
});
