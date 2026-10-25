// The golden table of the tax engine (M4.2; ADM-INV-05, docs/05 §10). Every expected value below was worked out BY HAND
// (the arithmetic is in the comment of each case) and typed in: none is taken from the engine's own output, and nothing is a
// snapshot. If the engine disagrees with a value here, the engine is wrong until the arithmetic is shown to be.
// All amounts are minor units (paise or cents). Defaults unless a case says otherwise: supplier West Bengal (19), 18 %,
// quantity 1 (1,000 milli-units), SAC 998314, document date 25 October 2026 (FY 2026-27).
import { expect } from "vitest";
import {
  type ComputedDocument,
  type CreditedSoFar,
  computeDocument,
  computeSchedule,
  creditNote,
  type DocumentInput,
  type LineInput,
  type ScheduleStep,
  splitInclusive,
  type TaxContext,
} from "../../src/tax/index.ts";
import {
  DATE,
  DATE_OLD_FY,
  DEFAULTS,
  EXPORT_IGST,
  EXPORT_IGST_SUPPLY,
  EXPORT_LUT_SUPPLY,
  errorsOf,
  GSTIN_27,
  GSTIN_29,
  good,
  INTER_27_SUPPLY,
  INTRA_SUPPLY,
  inrDoc,
  line,
  NO_OVERRIDE,
  OVERSEAS_US,
  RATE_500,
  REG_MH,
  REG_WB,
  registered,
  SUPPLIER_27,
  unregistered,
  WITH_LUT,
  WITH_OLD_LUT,
  warningCodes,
} from "./fixtures.ts";

export type GoldenCase = { readonly name: string; readonly check: () => void };

/** The document totals as one object, to compare in a single assertion. */
const totals = (d: ComputedDocument) => ({
  subtotal: d.subtotalMinor,
  discount: d.discountMinor,
  taxable: d.taxableMinor,
  cgst: d.cgstMinor,
  sgst: d.sgstMinor,
  igst: d.igstMinor,
  roundOff: d.roundOffMinor,
  total: d.totalMinor,
});

const usdDoc = (
  lines: (number | LineInput)[],
  options: { fx?: number; ctx?: TaxContext; extra?: Partial<DocumentInput> } = {},
) =>
  computeDocument(
    {
      currency: "USD",
      documentDate: DATE,
      recipient: OVERSEAS_US,
      lines: lines.map((l) => (typeof l === "number" ? line(l) : l)),
      ...(options.fx === undefined ? {} : { fx: { rateMicros: options.fx } }),
      ...options.extra,
    },
    options.ctx ?? DEFAULTS,
  );

const noCredit = (d: ComputedDocument): CreditedSoFar => ({
  lines: d.lines.map(() => ({ taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 })),
  creditedTotalMinor: 0,
});

const STEPS_403030: ScheduleStep[] = [
  { label: "On acceptance", trigger: "on_accept", pctBp: 4000 },
  { label: "Midpoint milestone", trigger: "milestone", pctBp: 3000 },
  { label: "On delivery", trigger: "delivery", pctBp: 3000 },
];

const GROUP_1800 = { sac: "998314", gstRateBp: 1800, weightMinor: 1_180_000 } as const;

/** G09's invoice: the discount case used again by the credit-note cases. */
const g09 = () =>
  good(
    inrDoc(
      REG_WB,
      [
        line(1_000_000, { discount: { kind: "percent", bp: 1000 } }),
        line(99_999, { qtyMilli: 2500, discount: { kind: "fixed", minor: 10_000 } }),
        line(33_333, { qtyMilli: 3000 }),
      ],
      { documentDiscount: { kind: "fixed", minor: 100_000 } },
    ),
  );
const g01 = () => good(inrDoc(REG_WB, [line(10_000_000)]));

export const GOLDEN: readonly GoldenCase[] = [
  // ------------------------------------------------------------------------------------------------ G01 to G25
  {
    name: "G01 intra-registered-wb",
    check: () => {
      // 10,000,000 x 1,800 / 20,000 = 900,000 each; 10,000,000 + 1,800,000 = 11,800,000 (a whole rupee, no round-off)
      const d = good(inrDoc(REG_WB, [line(10_000_000)]));
      expect(d.supply).toEqual({ type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" });
      expect(totals(d)).toEqual({
        subtotal: 10_000_000,
        discount: 0,
        taxable: 10_000_000,
        cgst: 900_000,
        sgst: 900_000,
        igst: 0,
        roundOff: 0,
        total: 11_800_000,
      });
      expect(d.words).toBe("Rupees One Lakh Eighteen Thousand Only");
    },
  },
  {
    name: "G02 inter-registered-mh",
    check: () => {
      // 10,000,000 x 1,800 / 10,000 = 1,800,000 IGST; total 11,800,000; place of supply 27
      const d = good(inrDoc(REG_MH, [line(10_000_000)]));
      expect(d.supply).toEqual({ type: "inter", placeOfSupplyCode: "27", supplierStateCode: "19" });
      expect(totals(d)).toMatchObject({ cgst: 0, sgst: 0, igst: 1_800_000, roundOff: 0, total: 11_800_000 });
    },
  },
  {
    name: "G03 export-lut-usd",
    check: () => {
      // $2,000 = 200,000 cents under LUT: tax 0, total 200,000. INR: 200,000 x 88,420,000 / 1,000,000 = 17,684,000
      const r = usdDoc([200_000], { fx: 88_420_000 });
      const d = good(r);
      expect(d.supply.type).toBe("export_lut");
      expect(d.supply.placeOfSupplyCode).toBe("96");
      expect(totals(d)).toMatchObject({ cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: 200_000 });
      expect(d.lines[0]?.effectiveRateBp).toBe(0);
      expect(d.inr).toEqual({
        taxableMinor: 17_684_000,
        cgstMinor: 0,
        sgstMinor: 0,
        igstMinor: 0,
        roundOffMinor: 0,
        totalMinor: 17_684_000,
      });
      expect(d.words).toBe("US Dollars Two Thousand Only");
      // No saved LUT for the FY: a warning (the hard block is M5.2's); with a LUT for FY 2026-27: none
      expect(warningCodes(r)).toEqual(["lut_missing_for_fy"]);
      expect(warningCodes(usdDoc([200_000], { fx: 88_420_000, ctx: WITH_LUT }))).toEqual([]);
    },
  },
  {
    name: "G04 export-igst-usd",
    check: () => {
      // IGST paid: 200,000 x 1,800 / 10,000 = 36,000 cents; total 236,000. INR taxable 17,684,000;
      // INR IGST 17,684,000 x 1,800 / 10,000 = 3,183,120; INR total 17,684,000 + 3,183,120 = 20,867,120
      const d = good(usdDoc([200_000], { fx: 88_420_000, ctx: EXPORT_IGST }));
      expect(d.supply.type).toBe("export_igst");
      expect(totals(d)).toMatchObject({ igst: 36_000, roundOff: 0, total: 236_000 });
      expect(d.inr).toEqual({
        taxableMinor: 17_684_000,
        cgstMinor: 0,
        sgstMinor: 0,
        igstMinor: 3_183_120,
        roundOffMinor: 0,
        totalMinor: 20_867_120,
      });
      expect(d.words).toBe("US Dollars Two Thousand Three Hundred Sixty Only");
    },
  },
  {
    name: "G05 inter-half-paisa",
    check: () => {
      // 100,025 x 1,800 / 10,000 = 18,004.5 -> 18,005; preRound 118,030 -> 118,000 (1,180.30 rounds down); RO -30
      const d = good(inrDoc(REG_MH, [line(100_025)]));
      expect(totals(d)).toMatchObject({ igst: 18_005, roundOff: -30, total: 118_000 });
    },
  },
  {
    name: "G06 intra-heads-separate",
    check: () => {
      // 100,050 x 1,800 / 20,000 = 9,004.5 -> 9,005 for CGST and for SGST (not 18,009 split in two);
      // preRound 100,050 + 18,010 = 118,060 -> 118,100 (1,180.60 rounds up); RO +40
      const d = good(inrDoc(REG_WB, [line(100_050)]));
      expect(totals(d)).toMatchObject({ cgst: 9_005, sgst: 9_005, roundOff: 40, total: 118_100 });
    },
  },
  {
    name: "G07 round-off-plus-50",
    check: () => {
      // 4,280 x 0.18 = 770.4 -> 770; preRound 5,050 -> 51 rupees (50 paise rounds up) = 5,100; RO +50
      const d = good(inrDoc(REG_MH, [line(4_280)]));
      expect(totals(d)).toMatchObject({ igst: 770, roundOff: 50, total: 5_100 });
    },
  },
  {
    name: "G08 round-off-minus-49",
    check: () => {
      // 4,279 x 0.18 = 770.22 -> 770; preRound 5,049 -> 5,000 (49 paise rounds down); RO -49
      const d = good(inrDoc(REG_MH, [line(4_279)]));
      expect(totals(d)).toMatchObject({ igst: 770, roundOff: -49, total: 5_000 });
    },
  },
  {
    name: "G09 discounts-allocated",
    check: () => {
      // L1 gross 1,000,000, 10 % off = 100,000, net 900,000.
      // L2 2.5 x 99,999 = 249,997.5 -> 249,998, minus 10,000 = net 239,998.   L3 3 x 33,333 = 99,999.
      // Sum of nets 1,239,997; document discount 100,000 split 100,000 x net / 1,239,997:
      //   72,580.6 / 19,354.6 / 8,064.8 -> floors 72,580 / 19,354 / 8,064 (sum 99,998), the two spare paise go to the largest
      //   remainders (L1, L2) -> 72,581 / 19,355 / 8,064.
      // Taxable 827,419 / 220,643 / 91,935. CGST (x 0.09): 74,467.71 / 19,857.87 / 8,274.15 -> 74,468 / 19,858 / 8,274.
      const d = g09();
      expect(d.lines.map((l) => l.grossMinor)).toEqual([1_000_000, 249_998, 99_999]);
      expect(d.lines.map((l) => l.lineDiscountMinor)).toEqual([100_000, 10_000, 0]);
      expect(d.lines.map((l) => l.documentDiscountMinor)).toEqual([72_581, 19_355, 8_064]);
      expect(d.lines.map((l) => l.discountMinor)).toEqual([172_581, 29_355, 8_064]);
      expect(d.lines.map((l) => l.taxableMinor)).toEqual([827_419, 220_643, 91_935]);
      expect(d.lines.map((l) => l.cgstMinor)).toEqual([74_468, 19_858, 8_274]);
      expect(d.lines.map((l) => l.sgstMinor)).toEqual([74_468, 19_858, 8_274]);
      // Line totals: 827,419 + 148,936 = 976,355; 220,643 + 39,716 = 260,359; 91,935 + 16,548 = 108,483
      expect(d.lines.map((l) => l.lineTotalMinor)).toEqual([976_355, 260_359, 108_483]);
      // Subtotal 1,349,997; discount 100,000 + 10,000 + 100,000 = 210,000; taxable 1,139,997; CGST = SGST = 102,600;
      // preRound 1,139,997 + 205,200 = 1,345,197 -> 1,345,200; RO +3
      expect(totals(d)).toEqual({
        subtotal: 1_349_997,
        discount: 210_000,
        taxable: 1_139_997,
        cgst: 102_600,
        sgst: 102_600,
        igst: 0,
        roundOff: 3,
        total: 1_345_200,
      });
      expect(d.words).toBe("Rupees Thirteen Thousand Four Hundred Fifty-Two Only");
    },
  },
  {
    name: "G10 doc-discount-tie",
    check: () => {
      // Three lines of 100, document discount 1: equal remainders, the tie goes to the earliest line -> shares 1 / 0 / 0.
      // Taxable 99 / 100 / 100; IGST 17.82 -> 18, 18, 18; preRound 299 + 54 = 353 -> 400; RO +47
      const d = good(
        inrDoc(REG_MH, [line(100), line(100), line(100)], { documentDiscount: { kind: "fixed", minor: 1 } }),
      );
      expect(d.lines.map((l) => l.documentDiscountMinor)).toEqual([1, 0, 0]);
      expect(d.lines.map((l) => l.taxableMinor)).toEqual([99, 100, 100]);
      expect(d.lines.map((l) => l.igstMinor)).toEqual([18, 18, 18]);
      expect(totals(d)).toMatchObject({ taxable: 299, igst: 54, roundOff: 47, total: 400 });
    },
  },
  {
    name: "G11 mixed-rates",
    check: () => {
      // L1 1,000,000 at 18 %: IGST 180,000.  L2 500,000 at 5 %: IGST 25,000.  preRound 1,500,000 + 205,000 = 1,705,000
      const d = good(
        inrDoc(REG_MH, [
          line(1_000_000, { sac: "998314", gstRateBp: 1800 }),
          line(500_000, { sac: "998313", gstRateBp: 500 }),
        ]),
      );
      expect(d.lines.map((l) => l.igstMinor)).toEqual([180_000, 25_000]);
      expect(totals(d)).toMatchObject({ taxable: 1_500_000, igst: 205_000, roundOff: 0, total: 1_705_000 });
      expect(d.summary).toEqual([
        {
          sac: "998314",
          gstRateBp: 1800,
          taxableMinor: 1_000_000,
          cgstMinor: 0,
          sgstMinor: 0,
          igstMinor: 180_000,
        },
        {
          sac: "998313",
          gstRateBp: 500,
          taxableMinor: 500_000,
          cgstMinor: 0,
          sgstMinor: 0,
          igstMinor: 25_000,
        },
      ]);
    },
  },
  {
    name: "G12 odd-bp-intra",
    check: () => {
      // 400 at 25 bp intra: 400 x 25 / 20,000 = 0.5 -> 1 each; preRound 402 -> 400 (4.02 rounds down); RO -2
      const d = good(inrDoc(REG_WB, [line(400, { gstRateBp: 25 })]));
      expect(totals(d)).toMatchObject({ cgst: 1, sgst: 1, roundOff: -2, total: 400 });
    },
  },
  {
    name: "G13 inclusive-inter-10000",
    check: () => {
      // Gross 1,000,000. T = 847,458: IGST 847,458 x 0.18 = 152,542.44 -> 152,542; sum 1,000,000 (fits).
      // T = 847,459: IGST 152,542.62 -> 152,543; sum 1,000,002 (over). So T = 847,458.
      const r = splitInclusive(1_000_000, [GROUP_1800], INTER_27_SUPPLY, "INR", null, DEFAULTS);
      const { lines, document: d } = good(r);
      expect(lines).toEqual([
        { sac: "998314", qtyMilli: 1000, rateMinor: 847_458, gstRateBp: 1800, discount: null },
      ]);
      expect(totals(d)).toMatchObject({ taxable: 847_458, igst: 152_542, roundOff: 0, total: 1_000_000 });
      // The returned lines compute to the same total
      const again = good(
        computeDocument({ currency: "INR", documentDate: DATE, supply: INTER_27_SUPPLY, lines }, DEFAULTS),
      );
      expect(again.totalMinor).toBe(1_000_000);
      expect(warningCodes(r)).toEqual([]);
    },
  },
  {
    name: "G14 inclusive-intra-10000",
    check: () => {
      // Same gross, intra: 847,458 x 0.09 = 76,271.22 -> 76,271 each; 847,458 + 152,542 = 1,000,000
      const { document: d } = good(
        splitInclusive(1_000_000, [GROUP_1800], INTRA_SUPPLY, "INR", null, DEFAULTS),
      );
      expect(totals(d)).toMatchObject({
        taxable: 847_458,
        cgst: 76_271,
        sgst: 76_271,
        roundOff: 0,
        total: 1_000_000,
      });
    },
  },
  {
    name: "G15 inclusive-47200",
    check: () => {
      // 4,720,000 = 4,000,000 + 18 % (720,000); 4,000,001 would give 360,000.09 -> 360,000 each = 4,720,001 (over)
      const { document: d } = good(
        splitInclusive(4_720_000, [GROUP_1800], INTRA_SUPPLY, "INR", null, DEFAULTS),
      );
      expect(totals(d)).toMatchObject({
        taxable: 4_000_000,
        cgst: 360_000,
        sgst: 360_000,
        roundOff: 0,
        total: 4_720_000,
      });
    },
  },
  {
    name: "G16 inclusive-usd-residual",
    check: () => {
      // $1,000.02 = 100,002 cents, IGST paid. T = 84,747: IGST 84,747 x 0.18 = 15,254.46 -> 15,254; sum 100,001 (fits).
      // T = 84,748: IGST 15,254.64 -> 15,255; sum 100,003 (over). One cent is left over: round-off +1, total 100,002.
      const r = splitInclusive(100_002, [GROUP_1800], EXPORT_IGST_SUPPLY, "USD", null, DEFAULTS);
      const { document: d } = good(r);
      expect(totals(d)).toMatchObject({ taxable: 84_747, igst: 15_254, roundOff: 1, total: 100_002 });
      expect(d.words).toBe("US Dollars One Thousand and Two Cents Only");
      expect(warningCodes(r)).toEqual(["inclusive_residual"]);
    },
  },
  {
    name: "G17 schedule-floor-last",
    check: () => {
      // 10,000,400: 40 % = 4,000,160 -> whole rupees 4,000,100; 30 % = 3,000,120 -> 3,000,100; the last 10,000,400 - 7,000,200
      const s = good(computeSchedule(10_000_400, "INR", STEPS_403030, DEFAULTS));
      expect(s.map((i) => i.amountMinor)).toEqual([4_000_100, 3_000_100, 3_000_200]);
      expect(s.map((i) => i.pctBp)).toEqual([4000, 3000, 3000]);
      expect(s.map((i) => i.trigger)).toEqual(["on_accept", "milestone", "delivery"]);
    },
  },
  {
    name: "G18 schedule-118000",
    check: () => {
      // 11,800,000: 40 % = 4,720,000; 30 % = 3,540,000; the last 3,540,000
      const s = good(computeSchedule(11_800_000, "INR", STEPS_403030, DEFAULTS));
      expect(s.map((i) => i.amountMinor)).toEqual([4_720_000, 3_540_000, 3_540_000]);
    },
  },
  {
    name: "G19 schedule-usd-cents",
    check: () => {
      // USD is not rounded to dollars: 100,001 x 0.4 = 40,000.4 -> 40,000; x 0.3 = 30,000.3 -> 30,000; the last 30,001
      const s = good(computeSchedule(100_001, "USD", STEPS_403030, DEFAULTS));
      expect(s.map((i) => i.amountMinor)).toEqual([40_000, 30_000, 30_001]);
    },
  },
  {
    name: "G20 schedule-amount-mode",
    check: () => {
      // 11,800,000: 5,000,000 first, the remainder 6,800,000 last. Shown: 5,000,000 / 11,800,000 = 42.37 % -> 4,237 bp;
      // the last 10,000 - 4,237 = 5,763
      const s = good(
        computeSchedule(
          11_800_000,
          "INR",
          [
            { label: "On acceptance", trigger: "on_accept", amountMinor: 5_000_000 },
            { label: "On delivery", trigger: "delivery" },
          ],
          DEFAULTS,
        ),
      );
      expect(s.map((i) => i.amountMinor)).toEqual([5_000_000, 6_800_000]);
      expect(s.map((i) => i.pctBp)).toEqual([4_237, 5_763]);
    },
  },
  {
    name: "G21 cn-partial-amount",
    check: () => {
      // G01's invoice, credit a taxable 2,500,025: CGST 2,500,025 x 0.09 = 225,002.25 -> 225,002 each;
      // preRound 2,500,025 + 450,004 = 2,950,029 -> 2,950,000 (29,500.29 rounds down); RO -29
      const original = g01();
      const cn = good(
        creditNote(original, noCredit(original), { kind: "amount", taxableMinor: 2_500_025 }, DEFAULTS),
      );
      expect(totals(cn)).toMatchObject({
        taxable: 2_500_025,
        cgst: 225_002,
        sgst: 225_002,
        roundOff: -29,
        total: 2_950_000,
      });
    },
  },
  {
    name: "G22 cn-final-absorbs",
    check: () => {
      // After G21 the rest: taxable 10,000,000 - 2,500,025 = 7,499,975; CGST 900,000 - 225,002 = 674,998 each (exactly what is
      // left); preRound 7,499,975 + 1,349,996 = 8,849,971; the final credit note takes the total that is left,
      // 11,800,000 - 2,950,000 = 8,850,000: RO +29. The two credit notes add up to 11,800,000.
      const original = g01();
      const credited: CreditedSoFar = {
        lines: [{ taxableMinor: 2_500_025, cgstMinor: 225_002, sgstMinor: 225_002, igstMinor: 0 }],
        creditedTotalMinor: 2_950_000,
      };
      const cn = good(creditNote(original, credited, { kind: "full" }, DEFAULTS));
      expect(totals(cn)).toMatchObject({
        taxable: 7_499_975,
        cgst: 674_998,
        sgst: 674_998,
        roundOff: 29,
        total: 8_850_000,
      });
      expect(2_950_000 + cn.totalMinor).toBe(11_800_000);
    },
  },
  {
    name: "G23 fx-two-lines",
    check: () => {
      // LUT, USD 100,001 + 99,999 = 200,000 cents at 83,333,333 micros: 200,000 x 83.333333 = 16,666,666.6 -> 16,666,667.
      // Split by taxable: 16,666,667 x 100,001 / 200,000 = 8,333,416.83; x 99,999 / 200,000 = 8,333,250.17;
      // floors 8,333,416 + 8,333,250 = 16,666,666, the spare paisa goes to the larger remainder (line 1)
      const d = good(usdDoc([100_001, 99_999], { fx: 83_333_333 }));
      expect(d.inr?.taxableMinor).toBe(16_666_667);
      expect(d.lines.map((l) => l.inr?.taxableMinor)).toEqual([8_333_417, 8_333_250]);
    },
  },
  {
    name: "G24 cn-clamp",
    check: () => {
      // An invoice of 8 paise at 18 % inter: IGST 1.44 -> 1 (total rounds to 0). A credit note of 3 paise: 0.54 -> 1 (fits the 1
      // left). The second of 3 paise: 0.54 -> 1, but nothing is left on the head, so it is clamped to 0.
      const original = good(inrDoc(REG_MH, [line(8)]));
      expect(totals(original)).toMatchObject({ taxable: 8, igst: 1, total: 0 });
      const first = good(
        creditNote(original, noCredit(original), { kind: "amount", taxableMinor: 3 }, DEFAULTS),
      );
      expect(first.igstMinor).toBe(1);
      const credited: CreditedSoFar = {
        lines: [{ taxableMinor: 3, cgstMinor: 0, sgstMinor: 0, igstMinor: 1 }],
        creditedTotalMinor: 0,
      };
      const second = good(creditNote(original, credited, { kind: "amount", taxableMinor: 3 }, DEFAULTS));
      expect(second.igstMinor).toBe(0);
      expect(second.taxableMinor).toBe(3);
    },
  },
  {
    name: "G25 b2c-threshold",
    check: () => {
      // Unregistered, Maharashtra: 4,237,300 x 0.18 = 762,714 exactly; preRound 5,000,014 -> 5,000,000; RO -14; that is the
      // threshold (INR 50,000), so the warning applies. 4,237,200 x 0.18 = 762,696; preRound 4,999,896 -> 4,999,900: below.
      const on = inrDoc(unregistered("27"), [line(4_237_300)]);
      expect(totals(good(on))).toMatchObject({ igst: 762_714, roundOff: -14, total: 5_000_000 });
      expect(warningCodes(on)).toEqual(["b2c_details_required"]);
      const below = inrDoc(unregistered("27"), [line(4_237_200)]);
      expect(totals(good(below))).toMatchObject({ igst: 762_696, total: 4_999_900 });
      expect(warningCodes(below)).toEqual([]);
    },
  },

  // ------------------------------------------------------------------------------------------------ supply
  {
    name: "intra-unregistered-wb",
    check: () => {
      // Unregistered in West Bengal: the state on the record is the place of supply. 1,000,000 x 0.09 = 90,000 each; total 1,180,000
      const d = good(inrDoc(unregistered("19"), [line(1_000_000)]));
      expect(d.supply.type).toBe("intra");
      expect(totals(d)).toMatchObject({ cgst: 90_000, sgst: 90_000, total: 1_180_000 });
    },
  },
  {
    name: "inter-unregistered-ka",
    check: () => {
      // Unregistered in Karnataka (29): IGST 1,000,000 x 0.18 = 180,000; total 1,180,000
      const d = good(inrDoc(unregistered("29"), [line(1_000_000)]));
      expect(d.supply).toEqual({ type: "inter", placeOfSupplyCode: "29", supplierStateCode: "19" });
      expect(totals(d)).toMatchObject({ igst: 180_000, total: 1_180_000 });
    },
  },
  {
    name: "registered-gstin-state-wins",
    check: () => {
      // A Maharashtra GSTIN (27) with West Bengal on the record: the GSTIN's state is the place of supply (inter, IGST 180,000)
      // and the mismatch is a warning
      const r = inrDoc(registered(GSTIN_27, "19"), [line(1_000_000)]);
      const d = good(r);
      expect(d.supply).toEqual({ type: "inter", placeOfSupplyCode: "27", supplierStateCode: "19" });
      expect(totals(d)).toMatchObject({ cgst: 0, igst: 180_000, total: 1_180_000 });
      expect(warningCodes(r)).toEqual(["gstin_state_mismatch"]);
    },
  },
  {
    name: "pos-override",
    check: () => {
      // An unregistered recipient in Karnataka with an override to West Bengal: intra, 100,000 x 0.09 = 9,000 each, total 118,000
      const r = inrDoc(unregistered("29"), [line(100_000)], {
        placeOfSupplyOverride: { code: "19", reason: "  Service used at the recipient's Kolkata office  " },
      });
      const d = good(r);
      expect(d.supply).toEqual({ type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" });
      expect(totals(d)).toMatchObject({ cgst: 9_000, sgst: 9_000, total: 118_000 });
      expect(warningCodes(r)).toEqual(["pos_overridden"]);
    },
  },
  {
    name: "pos-override-no-reason",
    check: () => {
      expect(
        errorsOf(
          inrDoc(unregistered("29"), [line(100)], { placeOfSupplyOverride: { code: "27", reason: "   " } }),
        ),
      ).toEqual(["pos_override_reason_required@placeOfSupplyOverride.reason"]);
      expect(
        errorsOf(
          inrDoc(unregistered("29"), [line(100)], {
            placeOfSupplyOverride: { code: "27", reason: "x".repeat(501) },
          }),
        ),
      ).toEqual(["pos_override_reason_required@placeOfSupplyOverride.reason"]);
      expect(
        errorsOf(
          inrDoc(unregistered("29"), [line(100)], {
            placeOfSupplyOverride: { code: "96", reason: "Export" },
          }),
        ),
      ).toEqual(["pos_override_invalid_state@placeOfSupplyOverride.code"]);
    },
  },
  {
    name: "pos-override-export",
    check: () => {
      expect(
        errorsOf(
          computeDocument(
            {
              currency: "USD",
              documentDate: DATE,
              recipient: OVERSEAS_US,
              lines: [line(100_000)],
              placeOfSupplyOverride: { code: "27", reason: "Not allowed for an export" },
            },
            DEFAULTS,
          ),
        ),
      ).toEqual(["pos_override_not_domestic@placeOfSupplyOverride"]);
    },
  },
  {
    name: "export-lut-arn-other-fy",
    check: () => {
      // A LUT saved for FY 2025-26 does not cover a document dated 25 Oct 2026 (FY 2026-27): warning. Dated 31 Mar 2026 it does.
      const inNew = usdDoc([100_000], { ctx: WITH_OLD_LUT });
      expect(warningCodes(inNew)).toEqual(["lut_missing_for_fy"]);
      const inOld = computeDocument(
        { currency: "USD", documentDate: DATE_OLD_FY, recipient: OVERSEAS_US, lines: [line(100_000)] },
        WITH_OLD_LUT,
      );
      expect(warningCodes(inOld)).toEqual([]);
      // IGST paid needs no LUT
      expect(warningCodes(usdDoc([100_000], { ctx: EXPORT_IGST }))).toEqual([]);
    },
  },
  {
    name: "export-in-inr",
    check: () => {
      // An export invoiced in rupees: allowed with a warning (RBI permits INR exports only in some cases). Under LUT: tax 0.
      const r = inrDoc(OVERSEAS_US, [line(10_000_000)]);
      const d = good(r);
      expect(d.supply).toEqual({ type: "export_lut", placeOfSupplyCode: "96", supplierStateCode: "19" });
      expect(totals(d)).toMatchObject({ igst: 0, total: 10_000_000 });
      expect(warningCodes(r)).toEqual(["export_in_inr", "lut_missing_for_fy"]);
    },
  },
  {
    name: "supplier-state-from-settings",
    check: () => {
      // The supplier's state is a setting. Supplier Maharashtra (27): a Maharashtra GSTIN is intra (100,000 x 0.09 = 9,000
      // each), a West Bengal GSTIN is inter (IGST 18,000).
      const mh = good(inrDoc(REG_MH, [line(100_000)], {}, SUPPLIER_27));
      expect(mh.supply).toEqual({ type: "intra", placeOfSupplyCode: "27", supplierStateCode: "27" });
      expect(totals(mh)).toMatchObject({ cgst: 9_000, sgst: 9_000, igst: 0, total: 118_000 });
      const wb = good(inrDoc(REG_WB, [line(100_000)], {}, SUPPLIER_27));
      expect(wb.supply.type).toBe("inter");
      expect(totals(wb)).toMatchObject({ igst: 18_000, total: 118_000 });
    },
  },
  {
    name: "overseas-with-in-country",
    check: () => {
      // The client rule's codes pass through unchanged
      expect(errorsOf(inrDoc({ gstStatus: "overseas", country: "IN" }, [line(100)]))).toEqual([
        "country_mismatch@recipient",
      ]);
      expect(
        errorsOf(inrDoc({ gstStatus: "registered", country: "US", gstin: GSTIN_29 }, [line(100)])),
      ).toEqual(["country_mismatch@recipient"]);
    },
  },
  {
    name: "unregistered-no-state",
    check: () => {
      // The owner's rule of 2026-10-25: an unregistered client with no state is an error, never a silent West Bengal
      expect(errorsOf(inrDoc(unregistered(null), [line(100)]))).toEqual(["state_required@recipient"]);
    },
  },
  {
    name: "export-mode-per-document",
    check: () => {
      // The settings say LUT: this document says IGST paid -> 100,000 x 0.18 = 18,000, total 118,000.
      // The settings say IGST paid: this document says LUT -> no tax.
      const paid = good(usdDoc([100_000], { extra: { exportMode: "igst_paid" } }));
      expect(paid.supply.type).toBe("export_igst");
      expect(totals(paid)).toMatchObject({ igst: 18_000, total: 118_000 });
      const lut = good(usdDoc([100_000], { ctx: EXPORT_IGST, extra: { exportMode: "lut" } }));
      expect(lut.supply.type).toBe("export_lut");
      expect(totals(lut)).toMatchObject({ igst: 0, total: 100_000 });
    },
  },
  {
    name: "recipient-and-supply-both",
    check: () => {
      const both = computeDocument(
        { currency: "INR", documentDate: DATE, recipient: REG_WB, supply: INTRA_SUPPLY, lines: [line(100)] },
        DEFAULTS,
      );
      expect(errorsOf(both)).toEqual(["recipient_or_supply_required@"]);
      const neither = computeDocument({ currency: "INR", documentDate: DATE, lines: [line(100)] }, DEFAULTS);
      expect(errorsOf(neither)).toEqual(["recipient_or_supply_required@"]);
    },
  },

  // ------------------------------------------------------------------------------------------------ lines
  {
    name: "qty-milli-half-up",
    check: () => {
      // 1.5 x 1,001 = 1,501.5 -> 1,502. IGST 1,502 x 0.18 = 270.36 -> 270; preRound 1,772 -> 1,800 (17.72 rounds up); RO +28
      const d = good(inrDoc(REG_MH, [line(1_001, { qtyMilli: 1500 })]));
      expect(d.lines[0]?.grossMinor).toBe(1_502);
      expect(totals(d)).toMatchObject({ taxable: 1_502, igst: 270, roundOff: 28, total: 1_800 });
    },
  },
  {
    name: "line-percent-discount",
    check: () => {
      // 12.5 % (1,250 bp) of 1,000,000 = 125,000; net 875,000; IGST 157,500; preRound 1,032,500 (whole rupee)
      const d = good(inrDoc(REG_MH, [line(1_000_000, { discount: { kind: "percent", bp: 1250 } })]));
      expect(d.lines[0]).toMatchObject({
        grossMinor: 1_000_000,
        lineDiscountMinor: 125_000,
        taxableMinor: 875_000,
        igstMinor: 157_500,
      });
      expect(totals(d)).toMatchObject({
        subtotal: 1_000_000,
        discount: 125_000,
        taxable: 875_000,
        total: 1_032_500,
      });
    },
  },
  {
    name: "line-fixed-discount",
    check: () => {
      // 500,000 less 50,000 = 450,000; IGST 81,000; total 531,000
      const d = good(inrDoc(REG_MH, [line(500_000, { discount: { kind: "fixed", minor: 50_000 } })]));
      expect(totals(d)).toMatchObject({
        subtotal: 500_000,
        discount: 50_000,
        taxable: 450_000,
        igst: 81_000,
        total: 531_000,
      });
    },
  },
  {
    name: "discount-exceeds-line",
    check: () => {
      // A fixed discount of 10,001 on a line of 10,000 is an error; 10,000 (everything) is not
      expect(
        errorsOf(inrDoc(REG_MH, [line(10_000, { discount: { kind: "fixed", minor: 10_001 } })])),
      ).toEqual(["discount_exceeds_line@lines.0.discount"]);
      expect(
        good(inrDoc(REG_MH, [line(10_000, { discount: { kind: "fixed", minor: 10_000 } })])).totalMinor,
      ).toBe(0);
    },
  },
  {
    name: "doc-percent-discount",
    check: () => {
      // Nets 1,000,000 and 500,000 (sum 1,500,000); 10 % = 150,000 split exactly 100,000 / 50,000; taxable 900,000 / 450,000;
      // IGST 162,000 / 81,000; preRound 1,350,000 + 243,000 = 1,593,000
      const d = good(
        inrDoc(REG_MH, [line(1_000_000), line(500_000)], { documentDiscount: { kind: "percent", bp: 1000 } }),
      );
      expect(d.lines.map((l) => l.documentDiscountMinor)).toEqual([100_000, 50_000]);
      expect(d.lines.map((l) => l.igstMinor)).toEqual([162_000, 81_000]);
      expect(totals(d)).toMatchObject({
        subtotal: 1_500_000,
        discount: 150_000,
        taxable: 1_350_000,
        igst: 243_000,
        total: 1_593_000,
      });
    },
  },
  {
    name: "doc-discount-exceeds",
    check: () => {
      expect(
        errorsOf(
          inrDoc(REG_MH, [line(1_000_000)], { documentDiscount: { kind: "fixed", minor: 1_000_001 } }),
        ),
      ).toEqual(["document_discount_exceeds_subtotal@documentDiscount"]);
      // exactly the subtotal is allowed: everything is discounted, total 0
      expect(
        good(inrDoc(REG_MH, [line(1_000_000)], { documentDiscount: { kind: "fixed", minor: 1_000_000 } }))
          .totalMinor,
      ).toBe(0);
    },
  },
  {
    name: "doc-discount-zero-weights",
    check: () => {
      // Lines that net to nothing carry no weight: a 5 % discount of 0 is 0, nothing is allocated, and the total is 0.
      // A fixed 1 is more than the subtotal.
      const zero = [line(0), line(500, { discount: { kind: "percent", bp: 10_000 } })];
      const d = good(inrDoc(REG_MH, zero, { documentDiscount: { kind: "percent", bp: 500 } }));
      expect(d.lines.map((l) => l.documentDiscountMinor)).toEqual([0, 0]);
      expect(totals(d)).toMatchObject({ subtotal: 500, discount: 500, taxable: 0, total: 0 });
      expect(errorsOf(inrDoc(REG_MH, zero, { documentDiscount: { kind: "fixed", minor: 1 } }))).toEqual([
        "document_discount_exceeds_subtotal@documentDiscount",
      ]);
    },
  },
  {
    name: "hundred-percent-discount",
    check: () => {
      // 100 % off: taxable 0, tax 0, total 0 (issuing such a document is M5's rule, not the engine's)
      const d = good(inrDoc(REG_MH, [line(1_000_000, { discount: { kind: "percent", bp: 10_000 } })]));
      expect(totals(d)).toMatchObject({
        subtotal: 1_000_000,
        discount: 1_000_000,
        taxable: 0,
        igst: 0,
        roundOff: 0,
        total: 0,
      });
      expect(d.words).toBe("Rupees Zero Only");
    },
  },
  {
    name: "zero-rate-line",
    check: () => {
      // A 0 % line carries no tax: total = taxable
      const d = good(inrDoc(REG_MH, [line(1_000_000, { sac: "998313", gstRateBp: 0 })]));
      expect(totals(d)).toMatchObject({ taxable: 1_000_000, igst: 0, total: 1_000_000 });
      expect(d.summary).toEqual([
        { sac: "998313", gstRateBp: 0, taxableMinor: 1_000_000, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 },
      ]);
    },
  },

  // ------------------------------------------------------------------------------------------------ rounding, words
  {
    name: "round-off-zero",
    check: () => {
      // 100,000 x 0.09 = 9,000 each; preRound 118,000 is already a whole rupee: RO 0 (and never -0)
      const d = good(inrDoc(REG_WB, [line(100_000)]));
      expect(totals(d)).toMatchObject({ roundOff: 0, total: 118_000 });
      expect(Object.is(d.roundOffMinor, 0)).toBe(true);
    },
  },
  {
    name: "usd-no-round-off",
    check: () => {
      // $1,000.01 = 100,001 cents, IGST paid: 100,001 x 0.18 = 18,000.18 -> 18,000; total 118,001 (never rounded to dollars)
      const d = good(usdDoc([100_001], { ctx: EXPORT_IGST }));
      expect(totals(d)).toMatchObject({ igst: 18_000, roundOff: 0, total: 118_001 });
    },
  },
  {
    name: "rate-override-disallowed",
    check: () => {
      // allowLineOverride false: a rate other than the default is an error, the default itself is fine
      expect(errorsOf(inrDoc(REG_MH, [line(100, { gstRateBp: 500 })], {}, NO_OVERRIDE))).toEqual([
        "rate_override_not_allowed@lines.0.gstRateBp",
      ]);
      expect(good(inrDoc(REG_MH, [line(100_000, { gstRateBp: 1800 })], {}, NO_OVERRIDE)).igstMinor).toBe(
        18_000,
      );
    },
  },
  {
    name: "default-rate-from-settings",
    check: () => {
      // The default rate is a setting: at 5 %, 100,000 gives IGST 5,000 and total 105,000
      const d = good(inrDoc(REG_MH, [line(100_000)], {}, RATE_500));
      expect(d.lines[0]).toMatchObject({ gstRateBp: 500, effectiveRateBp: 500, igstMinor: 5_000 });
      expect(d.totalMinor).toBe(105_000);
    },
  },
  {
    name: "total-at-words-limit",
    check: () => {
      // The largest total the words can write: 99,99,99,999.99 (USD 999,999,999.99 = 99,999,999,999 cents)
      const usd = good(usdDoc([99_999_999_999]));
      expect(usd.totalMinor).toBe(99_999_999_999);
      expect(usd.words).toBe(
        "US Dollars Nine Hundred Ninety-Nine Million Nine Hundred Ninety-Nine Thousand Nine Hundred Ninety-Nine and Ninety-Nine Cents Only",
      );
      // In rupees the largest whole-rupee total is 99,999,999,900 paise
      const inr = good(
        computeDocument(
          { currency: "INR", documentDate: DATE, supply: EXPORT_LUT_SUPPLY, lines: [line(99_999_999_900)] },
          DEFAULTS,
        ),
      );
      expect(inr.words).toBe(
        "Rupees Ninety-Nine Crore Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine Only",
      );
    },
  },
  {
    name: "total-too-large",
    check: () => {
      // One cent more than the words can write
      expect(errorsOf(usdDoc([100_000_000_000]))).toEqual(["total_too_large@totalMinor"]);
      expect(
        errorsOf(
          computeDocument(
            {
              currency: "INR",
              documentDate: DATE,
              supply: EXPORT_LUT_SUPPLY,
              lines: [line(100_000_000_000)],
            },
            DEFAULTS,
          ),
        ),
      ).toEqual(["total_too_large@totalMinor"]);
    },
  },
  {
    name: "amount-out-of-range",
    check: () => {
      // A gross of 2 x (2^53 - 1) discounted 100 % to nothing: the total is 0 but the subtotal cannot be a safe integer
      const r = inrDoc(REG_MH, [
        line(Number.MAX_SAFE_INTEGER, { qtyMilli: 2000, discount: { kind: "percent", bp: 10_000 } }),
      ]);
      expect(errorsOf(r)).toEqual(["amount_out_of_range@"]);
    },
  },
  {
    name: "summary-grouping",
    check: () => {
      // Grouped by (SAC, rate) in order of first appearance.
      // 998314 at 18 %: 100,000 + 50,000 = 150,000, IGST 27,000.   998313 at 18 %: 200,000, IGST 36,000.
      // 998314 at 5 %: 10,000, IGST 500.   Taxable 360,000, IGST 63,500, total 423,500
      const d = good(
        inrDoc(REG_MH, [
          line(100_000, { sac: "998314" }),
          line(200_000, { sac: "998313" }),
          line(50_000, { sac: "998314" }),
          line(10_000, { sac: "998314", gstRateBp: 500 }),
        ]),
      );
      expect(d.summary).toEqual([
        {
          sac: "998314",
          gstRateBp: 1800,
          taxableMinor: 150_000,
          cgstMinor: 0,
          sgstMinor: 0,
          igstMinor: 27_000,
        },
        {
          sac: "998313",
          gstRateBp: 1800,
          taxableMinor: 200_000,
          cgstMinor: 0,
          sgstMinor: 0,
          igstMinor: 36_000,
        },
        { sac: "998314", gstRateBp: 500, taxableMinor: 10_000, cgstMinor: 0, sgstMinor: 0, igstMinor: 500 },
      ]);
      expect(totals(d)).toMatchObject({ taxable: 360_000, igst: 63_500, total: 423_500 });
    },
  },
  {
    name: "sac-missing-warning",
    check: () => {
      // No SAC: allowed with a warning on the line; a SAC that is not six digits is an error
      const r = inrDoc(REG_MH, [line(100_000, { sac: null })]);
      expect(good(r).lines[0]?.sac).toBeNull();
      expect(r.ok && r.warnings).toEqual([{ code: "sac_missing", path: ["lines", 0, "sac"] }]);
      expect(errorsOf(inrDoc(REG_MH, [line(100_000, { sac: "99831" })]))).toEqual([
        "sac_invalid@lines.0.sac",
      ]);
    },
  },
  {
    name: "words-crore",
    check: () => {
      // Rs 1,23,45,678 = 1,234,567,800 paise, no tax (export under LUT, fixed supply)
      const d = good(
        computeDocument(
          { currency: "INR", documentDate: DATE, supply: EXPORT_LUT_SUPPLY, lines: [line(1_234_567_800)] },
          DEFAULTS,
        ),
      );
      expect(d.totalMinor).toBe(1_234_567_800);
      expect(d.words).toBe(
        "Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only",
      );
    },
  },
  {
    name: "words-usd-million",
    check: () => {
      // $1,234,567.01 = 123,456,701 cents
      const d = good(usdDoc([123_456_701]));
      expect(d.words).toBe(
        "US Dollars One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven and One Cent Only",
      );
    },
  },

  // ------------------------------------------------------------------------------------------------ fx
  {
    name: "usd-without-fx",
    check: () => {
      // A USD document before the rate is captured: no INR view (M5.2 requires the rate at issue)
      const d = good(usdDoc([200_000]));
      expect(d.inr).toBeNull();
      expect(d.fxRateMicros).toBeNull();
      expect(d.lines[0]?.inr).toBeNull();
    },
  },
  {
    name: "inr-with-fx",
    check: () => {
      expect(errorsOf(inrDoc(REG_WB, [line(100)], { fx: { rateMicros: 88_000_000 } }))).toEqual([
        "fx_not_applicable@fx",
      ]);
    },
  },
  {
    name: "fx-invalid",
    check: () => {
      for (const rateMicros of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(errorsOf(usdDoc([100], { fx: rateMicros }))).toEqual(["fx_invalid@fx.rateMicros"]);
      }
    },
  },

  // ------------------------------------------------------------------------------------------------ schedules
  {
    name: "schedule-pct-sum",
    check: () => {
      // 40 + 30 + 20 = 90 %
      const steps = STEPS_403030.map((s, i) => ({ ...s, pctBp: [4000, 3000, 2000][i] as number }));
      expect(errorsOf(computeSchedule(11_800_000, "INR", steps, DEFAULTS))).toEqual([
        "schedule_pct_sum@steps",
      ]);
    },
  },
  {
    name: "schedule-amount-exceeds",
    check: () => {
      // The typed 12,000,000 is more than the total 11,800,000
      expect(
        errorsOf(
          computeSchedule(
            11_800_000,
            "INR",
            [
              { label: "On acceptance", trigger: "on_accept", amountMinor: 12_000_000 },
              { label: "On delivery", trigger: "delivery" },
            ],
            DEFAULTS,
          ),
        ),
      ).toEqual(["schedule_exceeds_total@steps"]);
    },
  },
  {
    name: "schedule-amount-not-whole-rupee",
    check: () => {
      // 5,000,050 paise is Rs 50,000.50: instalments are whole rupees for INR
      expect(
        errorsOf(
          computeSchedule(
            11_800_000,
            "INR",
            [
              { label: "On acceptance", trigger: "on_accept", amountMinor: 5_000_050 },
              { label: "On delivery", trigger: "delivery" },
            ],
            DEFAULTS,
          ),
        ),
      ).toEqual(["schedule_amount_not_whole_unit@steps.0.amountMinor"]);
    },
  },
  {
    name: "schedule-zero-instalment",
    check: () => {
      // 100 % then 0 %: the second instalment is 0, a warning on step 1
      const r = computeSchedule(
        11_800_000,
        "INR",
        [
          { label: "On acceptance", trigger: "on_accept", pctBp: 10_000 },
          { label: "On delivery", trigger: "delivery", pctBp: 0 },
        ],
        DEFAULTS,
      );
      expect(good(r).map((i) => i.amountMinor)).toEqual([11_800_000, 0]);
      expect(r.ok && r.warnings).toEqual([{ code: "schedule_zero_instalment", path: ["steps", 1] }]);
    },
  },
  {
    name: "schedule-mixed-kinds",
    check: () => {
      expect(
        errorsOf(
          computeSchedule(
            11_800_000,
            "INR",
            [
              { label: "On acceptance", trigger: "on_accept", pctBp: 5000 },
              { label: "On delivery", trigger: "delivery", amountMinor: 5_900_000 },
            ],
            DEFAULTS,
          ),
        ),
      ).toEqual(["schedule_mixed_kinds@steps"]);
    },
  },

  // ------------------------------------------------------------------------------------------------ inclusive
  {
    name: "inclusive-lut",
    check: () => {
      // Under LUT there is no tax to take out: taxable = gross
      const { document: d } = good(
        splitInclusive(5_000_000, [GROUP_1800], EXPORT_LUT_SUPPLY, "INR", null, DEFAULTS),
      );
      expect(totals(d)).toMatchObject({ taxable: 5_000_000, igst: 0, roundOff: 0, total: 5_000_000 });
    },
  },
  {
    name: "inclusive-not-whole-rupee",
    check: () => {
      // Rs 10,000.50 cannot be a tax invoice for the exact amount when totals are whole rupees; USD has no such rule
      expect(errorsOf(splitInclusive(1_000_050, [GROUP_1800], INTRA_SUPPLY, "INR", null, DEFAULTS))).toEqual([
        "gross_not_whole_unit@grossMinor",
      ]);
      expect(splitInclusive(1_000_050, [GROUP_1800], EXPORT_IGST_SUPPLY, "USD", null, DEFAULTS).ok).toBe(
        true,
      );
    },
  },
  {
    name: "inclusive-two-groups",
    check: () => {
      // Gross 2,230,000 over weights 1,180,000 and 1,050,000 (they add up to the gross, so the shares are exact).
      // Group 1 at 18 %: T = 1,000,000, IGST 180,000, sum 1,180,000.  Group 2 at 5 %: T = 1,000,000, IGST 50,000, sum 1,050,000.
      const { lines, document: d } = good(
        splitInclusive(
          2_230_000,
          [
            { sac: "998314", gstRateBp: 1800, weightMinor: 1_180_000 },
            { sac: "998313", gstRateBp: 500, weightMinor: 1_050_000 },
          ],
          INTER_27_SUPPLY,
          "INR",
          null,
          DEFAULTS,
        ),
      );
      expect(lines.map((l) => l.rateMinor)).toEqual([1_000_000, 1_000_000]);
      expect(totals(d)).toMatchObject({ taxable: 2_000_000, igst: 230_000, roundOff: 0, total: 2_230_000 });
      expect(d.summary.map((s) => s.igstMinor)).toEqual([180_000, 50_000]);
    },
  },

  // ------------------------------------------------------------------------------------------------ credit and debit notes
  {
    name: "cn-full-equals-original",
    check: () => {
      // G09's invoice credited in full with nothing before it: taxable 1,139,997; CGST = SGST = 102,600; the final credit note's
      // total is the original's, 1,345,200 (RO +3)
      const original = g09();
      const cn = good(creditNote(original, noCredit(original), { kind: "full" }, DEFAULTS));
      expect(cn.lines.map((l) => l.taxableMinor)).toEqual([827_419, 220_643, 91_935]);
      expect(cn.lines.map((l) => l.cgstMinor)).toEqual([74_468, 19_858, 8_274]);
      expect(totals(cn)).toMatchObject({
        taxable: 1_139_997,
        cgst: 102_600,
        sgst: 102_600,
        roundOff: 3,
        total: 1_345_200,
      });
      expect(cn.supply).toEqual(original.supply);
    },
  },
  {
    name: "cn-by-lines",
    check: () => {
      // G09's invoice. First credit note: 400,000 of line 0 (827,419 taxable): CGST 400,000 x 0.09 = 36,000 each;
      // preRound 472,000, a whole rupee, RO 0.
      const original = g09();
      const first = good(
        creditNote(
          original,
          noCredit(original),
          { kind: "lines", lines: [{ line: 0, taxableMinor: 400_000 }] },
          DEFAULTS,
        ),
      );
      expect(first.lines.map((l) => l.index)).toEqual([0]);
      expect(totals(first)).toMatchObject({
        taxable: 400_000,
        cgst: 36_000,
        sgst: 36_000,
        roundOff: 0,
        total: 472_000,
      });
      // Second: all of line 1 (220,643): a line credited in full takes exactly its own tax, CGST = SGST = 19,858;
      // preRound 220,643 + 39,716 = 260,359 -> 260,400 (2,603.59 rounds up); RO +41. It is not the final note (lines 0 and 2 remain).
      const credited: CreditedSoFar = {
        lines: [
          { taxableMinor: 400_000, cgstMinor: 36_000, sgstMinor: 36_000, igstMinor: 0 },
          { taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 },
          { taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 },
        ],
        creditedTotalMinor: 472_000,
      };
      const second = good(
        creditNote(
          original,
          credited,
          { kind: "lines", lines: [{ line: 1, taxableMinor: 220_643 }] },
          DEFAULTS,
        ),
      );
      expect(totals(second)).toMatchObject({
        taxable: 220_643,
        cgst: 19_858,
        sgst: 19_858,
        roundOff: 41,
        total: 260_400,
      });
    },
  },
  {
    name: "cn-exceeds",
    check: () => {
      const original = g01();
      expect(
        errorsOf(
          creditNote(
            original,
            noCredit(original),
            { kind: "lines", lines: [{ line: 0, taxableMinor: 10_000_001 }] },
            DEFAULTS,
          ),
        ),
      ).toEqual(["exceeds_creditable@request.lines.0"]);
      expect(
        errorsOf(
          creditNote(original, noCredit(original), { kind: "amount", taxableMinor: 10_000_001 }, DEFAULTS),
        ),
      ).toEqual(["exceeds_creditable@request.taxableMinor"]);
    },
  },
  {
    name: "cn-usd-original-fx",
    check: () => {
      // G04's USD invoice (IGST paid, 88,420,000 micros): credit a taxable $1,000 = 100,000 cents: IGST 18,000, total 118,000 (USD is not
      // rounded). INR at the ORIGINAL rate: 100,000 x 88.42 = 8,842,000; IGST 8,842,000 x 0.18 = 1,591,560; total 10,433,560.
      const original = good(usdDoc([200_000], { fx: 88_420_000, ctx: EXPORT_IGST }));
      const cn = good(
        creditNote(original, noCredit(original), { kind: "amount", taxableMinor: 100_000 }, EXPORT_IGST),
      );
      expect(cn.fxRateMicros).toBe(88_420_000);
      expect(totals(cn)).toMatchObject({ taxable: 100_000, igst: 18_000, roundOff: 0, total: 118_000 });
      expect(cn.inr).toEqual({
        taxableMinor: 8_842_000,
        cgstMinor: 0,
        sgstMinor: 0,
        igstMinor: 1_591_560,
        roundOffMinor: 0,
        totalMinor: 10_433_560,
      });
    },
  },
  {
    name: "cn-final-out-of-band",
    check: () => {
      // The final note must take the total that is left. If the figures are inconsistent (G01's invoice, a taxable 2,500,025 credited
      // before but its total recorded as 0), the target 11,800,000 is far from the 8,849,971 that is computed: refused.
      const original = g01();
      const credited: CreditedSoFar = {
        lines: [{ taxableMinor: 2_500_025, cgstMinor: 225_002, sgstMinor: 225_002, igstMinor: 0 }],
        creditedTotalMinor: 0,
      };
      expect(errorsOf(creditNote(original, credited, { kind: "full" }, DEFAULTS))).toEqual([
        "target_out_of_band@targetTotalMinor",
      ]);
    },
  },
  {
    name: "dn-keeps-original-supply",
    check: () => {
      // A debit note of Rs 500 on G02's invoice (Maharashtra, inter): the supply is the original's, IGST 50,000 x 0.18 = 9,000, total 59,000
      const original = good(inrDoc(REG_MH, [line(10_000_000)]));
      const dn = good(
        computeDocument(
          { currency: "INR", documentDate: DATE, supply: original.supply, lines: [line(50_000)] },
          DEFAULTS,
        ),
      );
      expect(dn.supply).toEqual(original.supply);
      expect(totals(dn)).toMatchObject({ igst: 9_000, total: 59_000 });
    },
  },
];
