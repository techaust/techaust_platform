// Totals, round-off, target totals and the INR view [ADM-INV-05, ADM-INV-08; docs/08 G-9, G-10].
import { describe, expect, it } from "vitest";
import { computeCore } from "../../src/tax/document.ts";
import { computeDocument, ROUND_OFF_BAND, roundingUnit } from "../../src/tax/index.ts";
import {
  DATE,
  DEFAULTS,
  EXPORT_IGST_SUPPLY,
  EXPORT_LUT_SUPPLY,
  errorsOf,
  good,
  INTER_27_SUPPLY,
  INTRA_SUPPLY,
  line,
  makeCtx,
} from "./fixtures.ts";

const core = (over: Partial<Parameters<typeof computeCore>[0]> & { ctx?: typeof DEFAULTS } = {}) => {
  const { ctx, ...args } = over;
  return computeCore(
    {
      currency: "INR",
      supply: INTER_27_SUPPLY,
      lines: [line(100_000)],
      unregisteredRecipient: false,
      priorErrors: [],
      priorWarnings: [],
      ...args,
    },
    ctx ?? DEFAULTS,
  );
};

describe("the rounding unit", () => {
  it("is 100 for INR with the setting on, and 1 for USD", () => {
    expect(roundingUnit("INR", DEFAULTS)).toBe(100n);
    expect(roundingUnit("USD", DEFAULTS)).toBe(1n);
  });
  it("is 1 for INR if the setting were off (a future 'none')", () => {
    const off = makeCtx({
      tax: { rounding: { lineTax: "half_up", totalInr: "none" as "nearest_rupee", totalUsd: "none" } },
    });
    expect(roundingUnit("INR", off)).toBe(1n);
    const d = good(core({ lines: [line(100_025)], ctx: off }));
    // 100,025 x 0.18 = 18,004.5 -> 18,005; 118,030 is kept as it is
    expect(d.totalMinor).toBe(118_030);
    expect(d.roundOffMinor).toBe(0);
  });
});

describe("target totals (inclusive splits and final credit notes only)", () => {
  // 100,000 at 18 % inter: preRound 118,000
  it("sets the round-off to the difference", () => {
    const d = good(core({ targetTotalMinor: 118_100 }));
    expect(d.roundOffMinor).toBe(100);
    expect(d.totalMinor).toBe(118_100);
    expect(d.words).toBe("Rupees One Thousand One Hundred Eighty-One Only");
  });

  it("accepts the edges of the band: +-99.99 (9,999 minor units)", () => {
    expect(Number(ROUND_OFF_BAND)).toBe(9_999);
    // INR needs a multiple of 100, so use USD for the exact edge: preRound 118,000 cents
    expect(good(core({ currency: "USD", targetTotalMinor: 118_000 + 9_999 })).roundOffMinor).toBe(9_999);
    expect(good(core({ currency: "USD", targetTotalMinor: 118_000 - 9_999 })).roundOffMinor).toBe(-9_999);
    expect(errorsOf(core({ currency: "USD", targetTotalMinor: 118_000 + 10_000 }))).toEqual([
      "target_out_of_band@targetTotalMinor",
    ]);
    expect(errorsOf(core({ currency: "USD", targetTotalMinor: 118_000 - 10_000 }))).toEqual([
      "target_out_of_band@targetTotalMinor",
    ]);
  });

  it("an INR target must be a whole rupee when totals are rounded", () => {
    expect(errorsOf(core({ targetTotalMinor: 118_050 }))).toEqual(["target_not_whole_unit@targetTotalMinor"]);
    // both problems are reported together
    expect(errorsOf(core({ targetTotalMinor: 140_050 }))).toEqual([
      "target_out_of_band@targetTotalMinor",
      "target_not_whole_unit@targetTotalMinor",
    ]);
  });

  it("rejects a target that is negative, fractional or not finite", () => {
    for (const targetTotalMinor of [-100, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(errorsOf(core({ targetTotalMinor }))).toEqual(["target_out_of_band@targetTotalMinor"]);
    }
  });

  it("a target of exactly the pre-round amount gives round-off 0", () => {
    expect(good(core({ targetTotalMinor: 118_000 })).roundOffMinor).toBe(0);
  });
});

describe("the INR view of a USD document (Rule 34(2))", () => {
  it("converts at document level and allocates to lines; tax on INR at each line's rate", () => {
    // Two lines, IGST paid: $100.00 at 18 % and $50.00 at 5 %, 83,000,000 micros.
    // INR taxable 15,000 x 83 = 1,245,000 split 830,000 / 415,000 (exact thirds of 15,000 cents: 10,000 / 5,000).
    // INR IGST: 830,000 x 0.18 = 149,400; 415,000 x 0.05 = 20,750.
    const d = good(
      core({
        currency: "USD",
        supply: EXPORT_IGST_SUPPLY,
        lines: [line(10_000), line(5_000, { gstRateBp: 500 })],
        fx: { rateMicros: 83_000_000 },
      }),
    );
    expect(d.lines.map((l) => l.inr?.taxableMinor)).toEqual([830_000, 415_000]);
    expect(d.lines.map((l) => l.inr?.igstMinor)).toEqual([149_400, 20_750]);
    expect(d.lines.map((l) => l.inr?.lineTotalMinor)).toEqual([979_400, 435_750]);
    expect(d.inr).toEqual({
      taxableMinor: 1_245_000,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 170_150,
      roundOffMinor: 0,
      totalMinor: 1_415_150,
    });
    expect(d.fxRateMicros).toBe(83_000_000);
  });

  it("a target on a USD document carries its round-off into INR at the same rate", () => {
    // preRound 11,800 cents (10,000 + 1,800 IGST), target 11,801: round-off +1 cent = 1 x 83 = 83 paise.
    // INR: taxable 830,000, IGST 149,400, round-off 83, total 979,483
    const d = good(
      core({
        currency: "USD",
        supply: EXPORT_IGST_SUPPLY,
        lines: [line(10_000)],
        fx: { rateMicros: 83_000_000 },
        targetTotalMinor: 11_801,
      }),
    );
    expect(d.roundOffMinor).toBe(1);
    expect(d.inr).toMatchObject({ roundOffMinor: 83, totalMinor: 979_483 });
  });

  it("a rate so small that the INR taxable rounds to nothing gives zeros and no allocation", () => {
    // 100 cents x 1 micro = 0.0001 paise -> 0
    const d = good(
      core({
        currency: "USD",
        supply: EXPORT_LUT_SUPPLY,
        lines: [line(100), line(100)],
        fx: { rateMicros: 1 },
      }),
    );
    expect(d.inr).toMatchObject({ taxableMinor: 0, totalMinor: 0 });
    expect(d.lines.map((l) => l.inr?.taxableMinor)).toEqual([0, 0]);
  });

  it("intra INR heads on a USD document are halves of the rate (a domestic USD invoice)", () => {
    // $100.00, intra: CGST = SGST = 10,000 x 0.09 = 900 cents; INR at 83: taxable 830,000; each head 830,000 x 0.09 = 74,700
    const d = good(
      core({ currency: "USD", supply: INTRA_SUPPLY, lines: [line(10_000)], fx: { rateMicros: 83_000_000 } }),
    );
    expect(d.inr).toMatchObject({
      taxableMinor: 830_000,
      cgstMinor: 74_700,
      sgstMinor: 74_700,
      totalMinor: 979_400,
    });
  });

  it("an overflowing INR conversion is amount_out_of_range, not a throw", () => {
    const r = computeDocument(
      {
        currency: "USD",
        documentDate: DATE,
        supply: EXPORT_LUT_SUPPLY,
        lines: [line(99_999_999_999)],
        fx: { rateMicros: Number.MAX_SAFE_INTEGER },
      },
      DEFAULTS,
    );
    expect(errorsOf(r)).toEqual(["amount_out_of_range@"]);
  });
});
