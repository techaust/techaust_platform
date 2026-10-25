// Line and discount validation, tax heads and document limits [ADM-INV-05, ADM-INV-09; docs/08 G-10].
import { describe, expect, it } from "vitest";
import {
  computeDocument,
  effectiveRateBp,
  headsFor,
  type LineInput,
  MAX_LINES,
} from "../../src/tax/index.ts";
import { DATE, DEFAULTS, errorsOf, good, inrDoc, line, REG_MH, REG_WB } from "./fixtures.ts";

const BAD_NUMBERS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, 2 ** 53, -1];

describe("line validation: every error is collected before any maths", () => {
  it("needs 1 to 100 lines", () => {
    expect(errorsOf(inrDoc(REG_MH, []))).toEqual(["no_lines@lines"]);
    expect(
      errorsOf(
        inrDoc(
          REG_MH,
          Array.from({ length: MAX_LINES + 1 }, () => line(100)),
        ),
      ),
    ).toEqual(["too_many_lines@lines"]);
    expect(
      good(
        inrDoc(
          REG_MH,
          Array.from({ length: MAX_LINES }, () => line(100)),
        ),
      ).lines,
    ).toHaveLength(MAX_LINES);
  });

  it("rejects a quantity below 1 milli-unit or not a whole number", () => {
    for (const qtyMilli of [0, ...BAD_NUMBERS]) {
      expect(errorsOf(inrDoc(REG_MH, [line(100, { qtyMilli })]))).toEqual(["qty_invalid@lines.0.qtyMilli"]);
    }
  });

  it("rejects a negative or non-integer rate, and allows a rate of 0", () => {
    for (const rateMinor of BAD_NUMBERS) {
      expect(errorsOf(inrDoc(REG_MH, [line(rateMinor)]))).toEqual(["rate_invalid@lines.0.rateMinor"]);
    }
    expect(good(inrDoc(REG_MH, [line(0)])).totalMinor).toBe(0);
  });

  it("rejects a GST rate outside 0 to 10,000 bp, and allows 100 %", () => {
    for (const gstRateBp of [-1, 10_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(errorsOf(inrDoc(REG_MH, [line(100, { gstRateBp })]))).toEqual([
        "gst_rate_invalid@lines.0.gstRateBp",
      ]);
    }
    const d = good(inrDoc(REG_MH, [line(100_000, { gstRateBp: 10_000 })]));
    expect(d.igstMinor).toBe(100_000);
    expect(d.totalMinor).toBe(200_000);
  });

  it("a SAC is six digits or null", () => {
    for (const sac of ["", "12345", "1234567", "99831a", " 998314"]) {
      expect(errorsOf(inrDoc(REG_MH, [line(100, { sac })]))).toEqual(["sac_invalid@lines.0.sac"]);
    }
    expect(good(inrDoc(REG_MH, [line(100, { sac: "998313" })])).lines[0]?.sac).toBe("998313");
  });

  it("rejects discounts that are not a non-negative amount or 0 to 100 %", () => {
    const bad: LineInput["discount"][] = [
      { kind: "fixed", minor: -1 },
      { kind: "fixed", minor: 1.5 },
      { kind: "fixed", minor: Number.NaN },
      { kind: "percent", bp: -1 },
      { kind: "percent", bp: 10_001 },
      { kind: "percent", bp: 0.5 },
      { kind: "weird" } as unknown as LineInput["discount"],
    ];
    for (const discount of bad) {
      expect(errorsOf(inrDoc(REG_MH, [line(100, { discount })]))).toEqual([
        "discount_invalid@lines.0.discount",
      ]);
    }
    for (const documentDiscount of bad) {
      if (documentDiscount) {
        expect(errorsOf(inrDoc(REG_MH, [line(100)], { documentDiscount }))).toEqual([
          "discount_invalid@documentDiscount",
        ]);
      }
    }
  });

  it("a null or missing discount is none", () => {
    expect(
      good(inrDoc(REG_MH, [line(100, { discount: null })], { documentDiscount: null })).discountMinor,
    ).toBe(0);
  });

  it("reports the errors of several lines and fields together", () => {
    const errors = errorsOf(
      inrDoc(REG_MH, [
        line(-5, { qtyMilli: 0 }),
        line(100, { sac: "x", gstRateBp: -3 }),
        line(7, { discount: { kind: "fixed", minor: 8 } }),
      ]),
    );
    expect(errors).toEqual([
      "qty_invalid@lines.0.qtyMilli",
      "rate_invalid@lines.0.rateMinor",
      "gst_rate_invalid@lines.1.gstRateBp",
      "sac_invalid@lines.1.sac",
    ]);
  });

  it("reports a line discount over its line, and the document discount only once the lines are right", () => {
    expect(
      errorsOf(
        inrDoc(REG_MH, [line(7, { discount: { kind: "fixed", minor: 8 } })], {
          documentDiscount: { kind: "fixed", minor: 1 },
        }),
      ),
    ).toEqual(["discount_exceeds_line@lines.0.discount"]);
  });

  it("a percent line discount is rounded half up: 12.5 % of 3 paise is 0.375 -> 0, of 4 paise is 0.5 -> 1", () => {
    expect(
      good(inrDoc(REG_MH, [line(3, { discount: { kind: "percent", bp: 1250 } })])).lines[0]
        ?.lineDiscountMinor,
    ).toBe(0);
    expect(
      good(inrDoc(REG_MH, [line(4, { discount: { kind: "percent", bp: 1250 } })])).lines[0]
        ?.lineDiscountMinor,
    ).toBe(1);
  });
});

describe("headsFor and effectiveRateBp", () => {
  it("intra splits the rate in two heads, each rounded on its own; inter and IGST-paid exports charge IGST", () => {
    expect(headsFor(100_050n, 1800, "intra")).toEqual({ cgst: 9005n, sgst: 9005n, igst: 0n });
    expect(headsFor(100_050n, 1800, "inter")).toEqual({ cgst: 0n, sgst: 0n, igst: 18_009n });
    expect(headsFor(100_050n, 1800, "export_igst")).toEqual({ cgst: 0n, sgst: 0n, igst: 18_009n });
  });
  it("LUT exports charge nothing: the effective rate is 0", () => {
    expect(effectiveRateBp(1800, "export_lut")).toBe(0);
    expect(effectiveRateBp(1800, "intra")).toBe(1800);
    expect(headsFor(100_050n, effectiveRateBp(1800, "export_lut"), "export_lut")).toEqual({
      cgst: 0n,
      sgst: 0n,
      igst: 0n,
    });
  });
});

describe("limits", () => {
  it("a document of 100 lines computes", () => {
    const lines = Array.from({ length: MAX_LINES }, (_, i) => line(1000 + i, { qtyMilli: 1000 + i }));
    const d = good(inrDoc(REG_WB, lines, { documentDiscount: { kind: "percent", bp: 333 } }));
    expect(d.lines).toHaveLength(100);
    expect(d.lines.reduce((a, l) => a + l.taxableMinor, 0)).toBe(d.taxableMinor);
  });

  it("an invalid currency is an error, whatever else is right", () => {
    const r = computeDocument(
      { currency: "EUR" as unknown as "INR", documentDate: DATE, recipient: REG_WB, lines: [line(100)] },
      DEFAULTS,
    );
    expect(errorsOf(r)).toEqual(["currency_invalid@currency"]);
  });

  it("an invalid date is an error even with a fixed supply", () => {
    const r = computeDocument(
      {
        currency: "INR",
        documentDate: { year: 2026, month: 13, day: 1 },
        supply: { type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" },
        lines: [line(100)],
      },
      DEFAULTS,
    );
    expect(errorsOf(r)).toEqual(["date_invalid@documentDate"]);
  });
});
