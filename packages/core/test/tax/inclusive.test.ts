// The inclusive split [ADM-PROP-09, ADM-INV-10]: the cases the golden table does not name.
import { describe, expect, it } from "vitest";
import {
  computeDocument,
  groupsOf,
  type InclusiveGroup,
  MAX_GROUPS,
  type Supply,
  splitInclusive,
} from "../../src/tax/index.ts";
import {
  DATE,
  DEFAULTS,
  EXPORT_IGST_SUPPLY,
  EXPORT_LUT_SUPPLY,
  errorsOf,
  good,
  INTER_27_SUPPLY,
  INTRA_SUPPLY,
  inrDoc,
  line,
  NO_OVERRIDE,
  OVERSEAS_US,
  REG_MH,
  warningCodes,
} from "./fixtures.ts";

const group = (weightMinor: number, gstRateBp = 1800, sac: string | null = "998314"): InclusiveGroup => ({
  sac,
  gstRateBp,
  weightMinor,
});
const split = (gross: number, groups: InclusiveGroup[], supply = INTER_27_SUPPLY) =>
  splitInclusive(gross, groups, supply, "INR", null, DEFAULTS);

describe("splitInclusive: input checks", () => {
  it("needs 1 to 10 groups", () => {
    expect(errorsOf(split(100_000, []))).toEqual(["no_groups@groups"]);
    expect(
      errorsOf(
        split(
          100_000,
          Array.from({ length: MAX_GROUPS + 1 }, () => group(1)),
        ),
      ),
    ).toEqual(["too_many_groups@groups"]);
    const ten = good(
      split(
        1_000_000,
        Array.from({ length: MAX_GROUPS }, () => group(1)),
      ),
    );
    expect(ten.lines).toHaveLength(10);
    expect(ten.document.totalMinor).toBe(1_000_000);
  });

  it("the gross must be a non-negative whole number (and is then checked for a whole rupee)", () => {
    for (const gross of [-100, 150.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(errorsOf(split(gross, [group(1)]))).toEqual(["gross_invalid@grossMinor"]);
    }
  });

  it("weights must be non-negative whole numbers and not all zero; rates 0 to 10,000 bp; all reported together", () => {
    expect(errorsOf(split(100_000, [group(-1), group(1.5), group(Number.NaN)]))).toEqual([
      "group_weight_invalid@groups.0.weightMinor",
      "group_weight_invalid@groups.1.weightMinor",
      "group_weight_invalid@groups.2.weightMinor",
    ]);
    expect(errorsOf(split(100_000, [group(0), group(0)]))).toEqual(["group_weight_invalid@groups"]);
    expect(errorsOf(split(100_000, [group(5, -1), group(5, 10_001)]))).toEqual([
      "gst_rate_invalid@groups.0.gstRateBp",
      "gst_rate_invalid@groups.1.gstRateBp",
    ]);
  });

  it("the currency and FX rules apply", () => {
    expect(
      errorsOf(
        splitInclusive(100_000, [group(1)], INTER_27_SUPPLY, "EUR" as unknown as "INR", null, DEFAULTS),
      ),
    ).toContain("currency_invalid@currency");
    expect(
      errorsOf(
        splitInclusive(100_000, [group(1)], INTER_27_SUPPLY, "INR", { rateMicros: 83_000_000 }, DEFAULTS),
      ),
    ).toEqual(["fx_not_applicable@fx"]);
    expect(
      errorsOf(splitInclusive(100_000, [group(1)], EXPORT_IGST_SUPPLY, "USD", { rateMicros: 0 }, DEFAULTS)),
    ).toEqual(["fx_invalid@fx.rateMicros"]);
  });

  it("problems with the lines that are built (a bad SAC) come back as line errors", () => {
    expect(errorsOf(split(100_000, [group(1, 1800, "9983")]))).toEqual(["sac_invalid@lines.0.sac"]);
  });
});

describe("splitInclusive: the source document's rates and supply", () => {
  it("a source at 500 bp still splits when the settings no longer allow line rates", () => {
    // Rs 1,050.00 at 5 % inter: T = 100,000 (tax 100,000 x 0.05 = 5,000; the sum is exactly 105,000; T + 1 gives 105,001)
    const { lines, document: d } = good(
      splitInclusive(105_000, [group(1, 500)], INTER_27_SUPPLY, "INR", null, NO_OVERRIDE),
    );
    expect(lines.map((l) => [l.rateMinor, l.gstRateBp])).toEqual([[100_000, 500]]);
    expect(d).toMatchObject({
      taxableMinor: 100_000,
      igstMinor: 5_000,
      roundOffMinor: 0,
      totalMinor: 105_000,
    });
  });

  it("a fixed supply that does not hold together is supply_invalid", () => {
    const bad: Supply[] = [
      { type: "intra", placeOfSupplyCode: "27", supplierStateCode: "19" },
      { type: "inter", placeOfSupplyCode: "19", supplierStateCode: "19" },
      { type: "export_lut", placeOfSupplyCode: "27", supplierStateCode: "19" },
    ];
    for (const supply of bad) {
      expect(errorsOf(splitInclusive(100_000, [group(1)], supply, "INR", null, DEFAULTS))).toEqual([
        "supply_invalid@supply",
      ]);
    }
  });
});

describe("groupsOf: the source document's tax summary as groups", () => {
  it("weights are taxable plus tax per (SAC, rate) group", () => {
    // 1,000,000 at 18 % (IGST 180,000 -> 1,180,000) and 500,000 at 5 % (IGST 25,000 -> 525,000)
    const doc = good(inrDoc(REG_MH, [line(1_000_000), line(500_000, { sac: "998313", gstRateBp: 500 })]));
    expect(groupsOf(doc.summary)).toEqual([
      { sac: "998314", gstRateBp: 1800, weightMinor: 1_180_000 },
      { sac: "998313", gstRateBp: 500, weightMinor: 525_000 },
    ]);
  });

  it("under LUT there is no tax, so the weight is the taxable value, and the split can use the groups", () => {
    const usd = good(
      computeDocument(
        { currency: "USD", documentDate: DATE, recipient: OVERSEAS_US, lines: [line(100_000)] },
        DEFAULTS,
      ),
    );
    const groups = groupsOf(usd.summary);
    expect(groups).toEqual([{ sac: "998314", gstRateBp: 1800, weightMinor: 100_000 }]);
    expect(usd.summary[0]?.effectiveRateBp).toBe(0);
    // Under LUT the split has no tax: 25,000 cents is all taxable
    const { document: d } = good(splitInclusive(25_000, groups, EXPORT_LUT_SUPPLY, "USD", null, DEFAULTS));
    expect(d).toMatchObject({ taxableMinor: 25_000, igstMinor: 0, roundOffMinor: 0, totalMinor: 25_000 });
  });
});

describe("splitInclusive: the residual warning is for USD only", () => {
  it("an INR split with a round-off of 1 paisa has no inclusive_residual warning", () => {
    // Rs 2.00 inter at 18 %: T = 169 (169 x 0.18 = 30.42 -> 30; sum 199); T = 170 gives 30.6 -> 31, sum 201 > 200. Round-off +1.
    const r = split(200, [group(1)]);
    expect(good(r).document).toMatchObject({
      taxableMinor: 169,
      igstMinor: 30,
      roundOffMinor: 1,
      totalMinor: 200,
    });
    expect(warningCodes(r)).toEqual([]);
  });
});

describe("splitInclusive: results", () => {
  it("a gross of 0 gives lines of 0 and a total of 0", () => {
    const { lines, document: d } = good(split(0, [group(5), group(7)]));
    expect(lines.map((l) => l.rateMinor)).toEqual([0, 0]);
    expect(d.totalMinor).toBe(0);
  });

  it("a group with weight 0 gets nothing", () => {
    const { lines } = good(split(1_000_000, [group(0), group(3)]));
    expect(lines.map((l) => l.rateMinor)).toEqual([0, 847_458]);
  });

  it("unequal weights: Rs 10,000 over 1 : 2 (shares 333,333 and 666,667, the spare paisa to the larger remainder)", () => {
    // Share 1: T = 282,486 (IGST 50,847, sum 333,333; T + 1 gives 333,335). Share 2: T = 564,972 (IGST 101,695, sum 666,667).
    const { lines, document: d } = good(split(1_000_000, [group(1), group(2)]));
    expect(lines.map((l) => l.rateMinor)).toEqual([282_486, 564_972]);
    expect(d).toMatchObject({
      taxableMinor: 847_458,
      igstMinor: 152_542,
      roundOffMinor: 0,
      totalMinor: 1_000_000,
    });
  });

  it("USD with FX: the INR view is worked out on the split lines", () => {
    // 100,000 cents, IGST paid: T = 84,746 (IGST 15,254, sum 100,000; T + 1 would be 100,001). INR at 83: taxable 84,746 x 83 = 7,033,918;
    // IGST 7,033,918 x 0.18 = 1,266,105.24 -> 1,266,105; total 8,300,023
    const r = splitInclusive(
      100_000,
      [group(1)],
      EXPORT_IGST_SUPPLY,
      "USD",
      { rateMicros: 83_000_000 },
      DEFAULTS,
    );
    const { document: d } = good(r);
    expect(d).toMatchObject({
      taxableMinor: 84_746,
      igstMinor: 15_254,
      roundOffMinor: 0,
      totalMinor: 100_000,
    });
    expect(d.inr).toMatchObject({ taxableMinor: 7_033_918, igstMinor: 1_266_105, totalMinor: 8_300_023 });
    expect(warningCodes(r)).toEqual([]);
  });

  it("a group without a SAC is allowed, with the line warning", () => {
    const r = split(100_000, [group(1, 1800, null)], INTRA_SUPPLY);
    expect(good(r).lines[0]?.sac).toBeNull();
    expect(warningCodes(r)).toEqual(["sac_missing"]);
  });
});
