// The fixes after the M4.2 review [ADM-INV-05, ADM-INV-10, ADM-INV-11, ADM-PROP-03]: a fixed supply with trusted rates and a
// target, the warnings on the fixed-supply paths, the last schedule step, export modes, the supplier state, hostile
// credit-note originals. Every expected number has its arithmetic beside it.
import { describe, expect, it } from "vitest";
import {
  computeDocument,
  computeSchedule,
  creditNote,
  determineSupply,
  type InclusiveGroup,
  type ScheduleStep,
  splitInclusive,
} from "../../src/tax/index.ts";
import {
  DATE,
  DATE_OLD_FY,
  DEFAULTS,
  EXPORT_IGST_SUPPLY,
  EXPORT_LUT_SUPPLY,
  errorsOf,
  good,
  INTER_27_SUPPLY,
  INTRA_SUPPLY,
  inrDoc,
  line,
  makeCtx,
  NO_OVERRIDE,
  OVERSEAS_US,
  REG_WB,
  WITH_LUT,
  WITH_OLD_LUT,
  warningCodes,
} from "./fixtures.ts";

const group = (weightMinor: number, gstRateBp = 1800): InclusiveGroup => ({
  sac: "998314",
  gstRateBp,
  weightMinor,
});

describe("M1: a fixed supply takes trusted rates and a target", () => {
  it("a debit note at the original's 5 % rate passes with overrides off, and is refused without trustRates", () => {
    const input = {
      currency: "INR",
      documentDate: DATE,
      supply: INTER_27_SUPPLY,
      lines: [line(100_000, { gstRateBp: 500 })],
    } as const;
    expect(errorsOf(computeDocument(input, NO_OVERRIDE))).toEqual([
      "rate_override_not_allowed@lines.0.gstRateBp",
    ]);
    const d = good(computeDocument({ ...input, trustRates: true }, NO_OVERRIDE));
    // IGST = 100,000 x 500 / 10,000 = 5,000; total 105,000 (already whole rupees)
    expect(d).toMatchObject({
      taxableMinor: 100_000,
      igstMinor: 5_000,
      roundOffMinor: 0,
      totalMinor: 105_000,
    });
    expect(good(computeDocument({ ...input, trustRates: false }, DEFAULTS)).totalMinor).toBe(105_000);
  });

  it("a USD inclusive split recomputes to exactly its gross with the target (and not without it)", () => {
    const split = good(
      splitInclusive(100_002, [group(1)], EXPORT_IGST_SUPPLY, "USD", null, DEFAULTS, { documentDate: DATE }),
    );
    // Taxable 84,747; IGST = 84,747 x 1,800 / 10,000 = 15,254.46 -> 15,254; sum 100,001; target 100,002 -> round-off +1
    expect(split.lines[0]?.rateMinor).toBe(84_747);
    const again = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          supply: EXPORT_IGST_SUPPLY,
          lines: split.lines,
          trustRates: true,
          targetTotalMinor: 100_002,
        },
        DEFAULTS,
      ),
    );
    expect(again).toMatchObject({ igstMinor: 15_254, roundOffMinor: 1, totalMinor: 100_002 });
    expect(again).toEqual(split.document);
    const without = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          supply: EXPORT_IGST_SUPPLY,
          lines: split.lines,
          trustRates: true,
        },
        DEFAULTS,
      ),
    );
    expect(without.totalMinor).toBe(100_001);
  });

  it("an INR inclusive split recomputes to its gross with the target", () => {
    const split = good(
      splitInclusive(1_000_000, [group(1)], INTER_27_SUPPLY, "INR", null, DEFAULTS, { documentDate: DATE }),
    );
    // Taxable 847,458; IGST = 847,458 x 0.18 = 152,542.44 -> 152,542; sum 1,000,000; round-off 0
    const again = good(
      computeDocument(
        {
          currency: "INR",
          documentDate: DATE,
          supply: INTER_27_SUPPLY,
          lines: split.lines,
          trustRates: true,
          targetTotalMinor: 1_000_000,
        },
        DEFAULTS,
      ),
    );
    expect(again).toEqual(split.document);
    expect(again).toMatchObject({
      taxableMinor: 847_458,
      igstMinor: 152_542,
      roundOffMinor: 0,
      totalMinor: 1_000_000,
    });
  });

  it("the target keeps the band and the whole-rupee rule", () => {
    const base = {
      currency: "INR",
      documentDate: DATE,
      supply: INTER_27_SUPPLY,
      lines: [line(847_458)],
    } as const;
    // Sum 1,000,000: a target of 1,010,000 is 10,000 away (band 9,999); 1,000,050 is within the band but not a whole rupee
    expect(errorsOf(computeDocument({ ...base, targetTotalMinor: 1_010_000 }, DEFAULTS))).toEqual([
      "target_out_of_band@targetTotalMinor",
    ]);
    expect(errorsOf(computeDocument({ ...base, targetTotalMinor: 1_000_050 }, DEFAULTS))).toEqual([
      "target_not_whole_unit@targetTotalMinor",
    ]);
  });

  it("trustRates, targetTotalMinor and recipientStatus are refused beside a recipient", () => {
    const base = { currency: "INR", documentDate: DATE, recipient: REG_WB, lines: [line(100_000)] } as const;
    expect(errorsOf(computeDocument({ ...base, trustRates: true }, DEFAULTS))).toEqual([
      "supply_invalid@trustRates",
    ]);
    expect(errorsOf(computeDocument({ ...base, targetTotalMinor: 118_000 }, DEFAULTS))).toEqual([
      "supply_invalid@targetTotalMinor",
    ]);
    expect(errorsOf(computeDocument({ ...base, recipientStatus: "registered" }, DEFAULTS))).toEqual([
      "supply_invalid@recipientStatus",
    ]);
    expect(good(computeDocument({ ...base, trustRates: false }, DEFAULTS)).totalMinor).toBe(118_000);
  });
});

describe("M2: the warnings stay on the fixed-supply paths", () => {
  it("a Rs 60,000 B2C intra split warns for the details; without a status, or for a registered one, it does not", () => {
    // Total 6,000,000 paise >= the 5,000,000 threshold (Rs 50,000)
    const run = (recipientStatus?: "registered" | "unregistered" | "overseas") =>
      splitInclusive(6_000_000, [group(1)], INTRA_SUPPLY, "INR", null, DEFAULTS, {
        documentDate: DATE,
        recipientStatus,
      });
    expect(warningCodes(run("unregistered"))).toContain("b2c_details_required");
    expect(warningCodes(run())).not.toContain("b2c_details_required");
    expect(warningCodes(run("registered"))).not.toContain("b2c_details_required");
    expect(errorsOf(run("overseas"))).toEqual(["supply_invalid@recipientStatus"]);
  });

  it("a fixed-supply document with an unregistered status warns the same way", () => {
    const r = computeDocument(
      {
        currency: "INR",
        documentDate: DATE,
        supply: INTRA_SUPPLY,
        recipientStatus: "unregistered",
        lines: [line(5_084_746)],
      },
      DEFAULTS,
    );
    // Each of CGST and SGST: 5,084,746 x 1,800 / 20,000 = 457,627.14 -> 457,627; total 5,084,746 + 915,254 = 6,000,000
    expect(good(r).totalMinor).toBe(6_000_000);
    expect(warningCodes(r)).toContain("b2c_details_required");
    expect(
      errorsOf(
        computeDocument(
          {
            currency: "INR",
            documentDate: DATE,
            supply: INTRA_SUPPLY,
            recipientStatus: "overseas",
            lines: [line(100)],
          },
          DEFAULTS,
        ),
      ),
    ).toEqual(["supply_invalid@recipientStatus"]);
  });

  it("an unknown recipient status is supply_invalid", () => {
    const recipientStatus = "company" as unknown as "registered";
    expect(
      errorsOf(
        splitInclusive(100_000, [group(1)], INTRA_SUPPLY, "INR", null, DEFAULTS, {
          documentDate: DATE,
          recipientStatus,
        }),
      ),
    ).toEqual(["supply_invalid@recipientStatus"]);
  });

  it("an export_lut split warns when no LUT is saved for the document's FY", () => {
    const run = (ctx = DEFAULTS, documentDate: typeof DATE | typeof DATE_OLD_FY = DATE) =>
      splitInclusive(25_000, [group(1)], EXPORT_LUT_SUPPLY, "USD", null, ctx, { documentDate });
    expect(warningCodes(run())).toContain("lut_missing_for_fy");
    expect(warningCodes(run(WITH_LUT))).not.toContain("lut_missing_for_fy");
    // A LUT of FY 2025-26 does not cover 25 Oct 2026 (FY 2026-27), but covers 31 Mar 2026
    expect(warningCodes(run(WITH_OLD_LUT))).toContain("lut_missing_for_fy");
    expect(warningCodes(run(WITH_OLD_LUT, DATE_OLD_FY))).not.toContain("lut_missing_for_fy");
    const doc = computeDocument(
      { currency: "USD", documentDate: DATE, supply: EXPORT_LUT_SUPPLY, lines: [line(25_000)] },
      DEFAULTS,
    );
    expect(warningCodes(doc)).toContain("lut_missing_for_fy");
    expect(
      warningCodes(
        computeDocument(
          { currency: "USD", documentDate: DATE, supply: EXPORT_IGST_SUPPLY, lines: [line(25_000)] },
          DEFAULTS,
        ),
      ),
    ).not.toContain("lut_missing_for_fy");
  });

  it("splitInclusive refuses a date it cannot use", () => {
    expect(
      errorsOf(
        splitInclusive(100_000, [group(1)], INTER_27_SUPPLY, "INR", null, DEFAULTS, {
          documentDate: { year: 2026, month: 2, day: 30 },
        }),
      ),
    ).toEqual(["date_invalid@documentDate"]);
  });
});

describe("M4 and L4: schedule steps", () => {
  const pct = (pctBp: number, label = "Step"): ScheduleStep => ({ label, trigger: "milestone", pctBp });

  it("Rs 101 at 50/50/0 is refused: the last instalment would show 0 % but hold Rs 1", () => {
    // 10,100 x 5,000 / (10,000 x 100) = 50.5 -> 50 -> 5,000 each; the last would be 100
    const r = computeSchedule(10_100, "INR", [pct(5000), pct(5000), pct(0)], DEFAULTS);
    expect(errorsOf(r)).toEqual(["schedule_step_invalid@steps.2"]);
  });

  it("a 0 % step that is not the last is fine and warns", () => {
    // 5,000, 0, then the rest: 10,100 - 5,000 - 0 = 5,100
    const r = computeSchedule(10_100, "INR", [pct(5000), pct(0), pct(5000)], DEFAULTS);
    expect(good(r).map((i) => i.amountMinor)).toEqual([5_000, 0, 5_100]);
    expect(r.ok && r.warnings).toEqual([{ code: "schedule_zero_instalment", path: ["steps", 1] }]);
  });

  it("the kind of a step is its pctBp: a step with both fields is schedule_mixed_kinds", () => {
    const both = {
      label: "A",
      trigger: "milestone",
      pctBp: 10_000,
      amountMinor: 100,
    } as unknown as ScheduleStep;
    expect(errorsOf(computeSchedule(10_000, "INR", [both], DEFAULTS))).toEqual([
      "schedule_mixed_kinds@steps",
    ]);
    // An explicit undefined pctBp is not a percent step
    const amountOnly = { label: "A", trigger: "milestone", pctBp: undefined } as unknown as ScheduleStep;
    expect(good(computeSchedule(10_000, "INR", [amountOnly], DEFAULTS))[0]).toMatchObject({
      amountMinor: 10_000,
      pctBp: 10_000,
    });
  });
});

describe("L1 and L2: export modes and the supplier state", () => {
  const when = { documentDate: DATE, currency: "USD" } as const;

  it("an unknown export mode is an error, not IGST", () => {
    const exportMode = "paid" as unknown as "lut";
    expect(errorsOf(determineSupply(OVERSEAS_US, DEFAULTS, { ...when, exportMode }))).toEqual([
      "supply_invalid@exportMode",
    ]);
    expect(
      errorsOf(
        computeDocument(
          { currency: "USD", documentDate: DATE, recipient: OVERSEAS_US, exportMode, lines: [line(100)] },
          DEFAULTS,
        ),
      ),
    ).toEqual(["supply_invalid@exportMode"]);
    expect(good(determineSupply(OVERSEAS_US, DEFAULTS, { ...when, exportMode: "igst_paid" })).type).toBe(
      "export_igst",
    );
    expect(good(determineSupply(OVERSEAS_US, DEFAULTS, { ...when, exportMode: "lut" })).type).toBe(
      "export_lut",
    );
  });

  it("a mode given for a domestic recipient is an error", () => {
    expect(errorsOf(determineSupply(REG_WB, DEFAULTS, { ...when, exportMode: "lut" }))).toEqual([
      "supply_invalid@exportMode",
    ]);
  });

  it("an unknown supplier state in the context is an error", () => {
    const ctx = makeCtx({ supplier: "ZZ" as unknown as "19" });
    expect(errorsOf(determineSupply(REG_WB, ctx, when))).toEqual(["supply_invalid@ctx.supplierStateCode"]);
    expect(errorsOf(inrDoc(REG_WB, [line(100)], {}, ctx))).toEqual(["supply_invalid@ctx.supplierStateCode"]);
  });
});

describe("L3: hostile input to creditNote and overrides", () => {
  const original = good(inrDoc(REG_WB, [line(100_000)]));
  const zero = { taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 };
  const credited = { lines: [zero], creditedTotalMinor: 0 };

  it("a damaged total is credit_shape_mismatch", () => {
    for (const totalMinor of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1]) {
      expect(errorsOf(creditNote({ ...original, totalMinor }, credited, { kind: "full" }, DEFAULTS))).toEqual(
        ["credit_shape_mismatch@original.totalMinor"],
      );
    }
  });

  it("a damaged INR total or FX rate on a USD invoice is credit_shape_mismatch", () => {
    const usd = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          recipient: OVERSEAS_US,
          lines: [line(100_000)],
          fx: { rateMicros: 83_000_000 },
        },
        DEFAULTS,
      ),
    );
    const creditedInr = { ...credited, inr: { lines: [zero], totalMinor: 0 } };
    if (!usd.inr) throw new Error("expected an INR view");
    expect(
      errorsOf(
        creditNote(
          { ...usd, inr: { ...usd.inr, totalMinor: Number.NaN } },
          creditedInr,
          { kind: "full" },
          DEFAULTS,
        ),
      ),
    ).toEqual(["credit_shape_mismatch@original.inr.totalMinor"]);
    expect(
      errorsOf(creditNote({ ...usd, fxRateMicros: Number.NaN }, creditedInr, { kind: "full" }, DEFAULTS)),
    ).toEqual(["credit_shape_mismatch@original.fxRateMicros"]);
  });

  it("a damaged line rate or index is credit_shape_mismatch", () => {
    const bad = {
      ...original,
      lines: [{ ...(original.lines[0] as (typeof original.lines)[0]), effectiveRateBp: Number.NaN }],
    };
    expect(errorsOf(creditNote(bad, credited, { kind: "full" }, DEFAULTS))).toEqual([
      "credit_shape_mismatch@original.lines.0",
    ]);
  });

  it("a place-of-supply override reason that is not a string is pos_override_reason_required", () => {
    for (const reason of [undefined, null, 5, {}, ["x"]]) {
      const placeOfSupplyOverride = { code: "27", reason } as unknown as { code: string; reason: string };
      expect(errorsOf(inrDoc(REG_WB, [line(100)], { placeOfSupplyOverride }))).toEqual([
        "pos_override_reason_required@placeOfSupplyOverride.reason",
      ]);
    }
  });
});
