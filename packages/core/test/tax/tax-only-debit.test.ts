// The tax-only debit note, "Tax charged too low" [ADM-INV-11, Q35 owner 2026-10-28; s.34(3) CGST Act; Researched 2026-10-28, 08-C RA-22].
import { describe, expect, it } from "vitest";
import { computeDocument, taxOnlyDebitNote } from "../../src/tax/index.ts";
import {
  DATE,
  DEFAULTS,
  EXPORT_IGST,
  errorsOf,
  good,
  inrDoc,
  line,
  OVERSEAS_US,
  REG_MH,
  REG_WB,
  WITH_LUT,
} from "./fixtures.ts";

// Intra-state (West Bengal to West Bengal): 1,000,000 at 18 %: CGST 90,000 and SGST 90,000.
const intra = () => good(inrDoc(REG_WB, [line(1_000_000)]));
// Inter-state: IGST 180,000 on 1,000,000 and 25,000 on 500,000 at 5 %.
const inter = () => good(inrDoc(REG_MH, [line(1_000_000), line(500_000, { sac: "998313", gstRateBp: 500 })]));

describe("taxOnlyDebitNote", () => {
  it("intra-state: CGST and SGST in equal halves, a taxable value of zero, the invoice's line, SAC and rate", () => {
    const d = good(taxOnlyDebitNote(intra(), 18_000, DEFAULTS));
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({
      index: 0,
      sac: "998314",
      grossMinor: 0,
      taxableMinor: 0,
      gstRateBp: 1800,
      effectiveRateBp: 1800,
      cgstMinor: 9_000,
      sgstMinor: 9_000,
      igstMinor: 0,
      lineTotalMinor: 18_000,
    });
    expect(d).toMatchObject({
      taxableMinor: 0,
      subtotalMinor: 0,
      cgstMinor: 9_000,
      sgstMinor: 9_000,
      igstMinor: 0,
      roundOffMinor: 0,
      totalMinor: 18_000,
      inr: null,
      fxRateMicros: null,
    });
    expect(d.supply).toEqual(intra().supply);
    expect(d.summary).toEqual([
      {
        sac: "998314",
        gstRateBp: 1800,
        effectiveRateBp: 1800,
        taxableMinor: 0,
        cgstMinor: 9_000,
        sgstMinor: 9_000,
        igstMinor: 0,
      },
    ]);
  });

  it("inter-state with two rates: the tax is split by the tax each line carries, and the parts add up to the amount exactly", () => {
    const d = good(taxOnlyDebitNote(inter(), 20_501, DEFAULTS));
    expect(d.lines.map((l) => l.igstMinor).reduce((a, b) => a + b, 0)).toBe(20_501);
    // 180,000 : 25,000 -> 18,000 -> 17,9xx / 2,5xx; both lines keep their own rate and SAC
    expect(d.lines.map((l) => [l.index, l.sac, l.gstRateBp])).toEqual([
      [0, "998314", 1800],
      [1, "998313", 500],
    ]);
    expect(d.lines.every((l) => l.taxableMinor === 0 && l.cgstMinor === 0 && l.sgstMinor === 0)).toBe(true);
    expect(d.igstMinor).toBe(20_501);
    // FX-4 (full audit A5 11; Settled by the lead on the safest reading, 2026-10-30 (08-C RA-33)): never rounded, so the total is the tax itself (it used to round down to 20,500, below the tax it declares)
    expect(d.totalMinor).toBe(20_501);
    expect(d.roundOffMinor).toBe(0);
  });

  it("FX-4 (A5 11): Rs 10.01 of IGST totals Rs 10.01 with no round-off, and the words say the exact amount", () => {
    const d = good(taxOnlyDebitNote(good(inrDoc(REG_MH, [line(500_000)])), 1_001, DEFAULTS));
    expect(d).toMatchObject({ taxableMinor: 0, igstMinor: 1_001, roundOffMinor: 0, totalMinor: 1_001 });
    expect(d.words).toContain("One Paisa");
  });

  it("FX-4 (A5 11): for any amount the total is exactly the tax and never below it, intra or inter, with no round-off", () => {
    const intraParent = good(
      inrDoc(REG_WB, [line(1_000_000), line(250_000, { sac: "998313", gstRateBp: 500 })]),
    );
    for (const tax of [1, 2, 49, 50, 51, 99, 100, 101, 149, 150, 151, 1_001, 20_501, 99_999]) {
      const i = good(taxOnlyDebitNote(inter(), tax, DEFAULTS));
      expect([i.totalMinor, i.roundOffMinor]).toEqual([tax, 0]);
      if (tax % 2 === 0) {
        const a = good(taxOnlyDebitNote(intraParent, tax, DEFAULTS));
        expect([a.totalMinor, a.roundOffMinor, a.cgstMinor + a.sgstMinor]).toEqual([tax, 0, tax]);
      }
    }
  });

  it("intra-state with two rates: each head takes half of the amount, and CGST equals SGST on every line", () => {
    const doc = good(inrDoc(REG_WB, [line(1_000_000), line(500_000, { sac: "998313", gstRateBp: 500 })]));
    const d = good(taxOnlyDebitNote(doc, 20_000, DEFAULTS));
    expect(d.lines.every((l) => l.cgstMinor === l.sgstMinor && l.cgstMinor > 0)).toBe(true);
    expect(d.cgstMinor).toBe(10_000);
    expect(d.sgstMinor).toBe(10_000);
    expect(d.totalMinor).toBe(20_000);
  });

  it("a line with no tax (a zero rate) is left out; the rest takes the tax", () => {
    const doc = good(inrDoc(REG_MH, [line(1_000_000), line(500_000, { sac: "998313", gstRateBp: 0 })]));
    const d = good(taxOnlyDebitNote(doc, 18_000, DEFAULTS));
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]?.index).toBe(0);
  });

  it("an odd amount on an intra-state invoice is refused (CGST and SGST would differ), at request.taxMinor", () => {
    expect(errorsOf(taxOnlyDebitNote(intra(), 18_001, DEFAULTS))).toEqual([
      "credit_line_invalid@request.taxMinor",
    ]);
  });

  it("a tax of zero, below zero, fractional or not a number is refused", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(errorsOf(taxOnlyDebitNote(inter(), bad, DEFAULTS))).toEqual([
        "credit_line_invalid@request.taxMinor",
      ]);
    }
  });

  it("an export under LUT has no tax to correct: refused as an empty request", () => {
    const lut = good(
      computeDocument(
        { currency: "INR", documentDate: DATE, recipient: OVERSEAS_US, lines: [line(1_000_000)] },
        WITH_LUT,
      ),
    );
    expect(lut.supply.type).toBe("export_lut");
    expect(errorsOf(taxOnlyDebitNote(lut, 100, WITH_LUT))).toEqual(["credit_empty@request"]);
  });

  it("a USD export with IGST: the INR view converts each head at the invoice's rate", () => {
    const usd = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          recipient: OVERSEAS_US,
          exportMode: "igst_paid",
          fx: { rateMicros: 83_000_000 },
          lines: [line(100_000)],
        },
        EXPORT_IGST,
      ),
    );
    expect(usd.igstMinor).toBe(18_000);
    const d = good(taxOnlyDebitNote(usd, 1_800, EXPORT_IGST));
    expect(d).toMatchObject({ currency: "USD", taxableMinor: 0, igstMinor: 1_800, totalMinor: 1_800 });
    expect(d.fxRateMicros).toBe(83_000_000);
    expect(d.inr).toEqual({
      taxableMinor: 0,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 149_400,
      roundOffMinor: 0,
      totalMinor: 149_400,
    });
    expect(d.lines[0]?.inr).toEqual({
      taxableMinor: 0,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 149_400,
      lineTotalMinor: 149_400,
    });
  });

  it("a damaged invoice is a mismatch, never a crash; an amount too large to word is refused", () => {
    expect(errorsOf(taxOnlyDebitNote({ ...inter(), totalMinor: -1 }, 1_800, DEFAULTS))).toContain(
      "credit_shape_mismatch@original.totalMinor",
    );
    expect(taxOnlyDebitNote(inter(), 99_999_999_999 + 1, DEFAULTS).ok).toBe(false);
    expect(taxOnlyDebitNote(inter(), Number.MAX_SAFE_INTEGER, DEFAULTS).ok).toBe(false);
  });
});
