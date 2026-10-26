// Failure paths [ADM-REP-04, ADM-REP-07, ADM-INV-17]: one test per error code with its path, "a bad row fails the whole result",
// a forced throw becomes internal_error, and no public function throws for any input of the declared types.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type DocsIssuedInput,
  docsRows,
  edfCsv,
  edfMonth,
  edfRows,
  type GstIssue,
  type GstPeriod,
  type Gstr1Params,
  type Gstr1Sections,
  gstPeriod,
  gstr1Csv,
  gstr1Sections,
  type RegisterRow,
  realisationCsv,
  realisationDates,
  realisationRows,
  realisationRulesOf,
  realisationStatus,
} from "../../src/gst/index.ts";
import { d, GSTIN_27, PARAMS, parentOf, rate, row } from "./fixtures.ts";

const Q3: GstPeriod = { kind: "quarter", fyStartYear: 2026, quarter: 3 };
const errors = (
  register: readonly RegisterRow[],
  params: Gstr1Params = PARAMS,
  period: GstPeriod = Q3,
): GstIssue[] => {
  const r = gstr1Sections(register, period, params);
  if (r.ok) throw new Error("expected errors, got ok");
  return r.errors;
};
const good = row({ id: "good", number: "G1" });
const only = (code: string, id = "x") => [{ code, path: [id] }];

describe("gstr1Sections: one test per error code", () => {
  it("kind_not_reportable (any row, voided or not)", () => {
    expect(errors([row({ id: "x", override: { kind: "proforma" as never } })])).toEqual(
      only("kind_not_reportable"),
    );
    expect(errors([row({ id: "x", voided: true, override: { kind: "receipt" as never } })])).toEqual(
      only("kind_not_reportable"),
    );
  });

  it("gstin_missing and gstin_invalid", () => {
    expect(errors([row({ id: "x", gstin: null })])).toEqual(only("gstin_missing"));
    expect(errors([row({ id: "x", gstin: "" })])).toEqual(only("gstin_missing"));
    expect(errors([row({ id: "x", gstin: "19ABCDE1234F1Z1" })])).toEqual(only("gstin_invalid"));
    expect(errors([row({ id: "x", gstin: "short" })])).toEqual(only("gstin_invalid"));
  });

  it("gstin_missing is also found on a note whose parent is B2B", () => {
    const parent = row({ id: "p", number: "P1", gstin: GSTIN_27 });
    expect(errors([row({ id: "x", kind: "credit_note", gstin: null, noteOf: parentOf(parent) })])).toEqual(
      only("gstin_missing"),
    );
  });

  it("parent_missing", () => {
    expect(errors([row({ id: "x", kind: "credit_note", noteOf: null })])).toEqual(only("parent_missing"));
    expect(errors([row({ id: "x", kind: "debit_note", noteOf: null })])).toEqual(only("parent_missing"));
  });

  it("a note's parent is ignored on an invoice", () => {
    const parent = row({ id: "p", number: "P1" });
    expect(gstr1Sections([row({ id: "x", noteOf: parentOf(parent) })], Q3, PARAMS).ok).toBe(true);
  });

  it("sac_missing", () => {
    expect(errors([row({ id: "x", rates: [rate(null, 1800, 1000, "intra")] })])).toEqual(only("sac_missing"));
  });

  it("rates_empty", () => {
    expect(errors([row({ id: "x", rates: [] })])).toEqual(only("rates_empty"));
  });

  it("rate_invalid", () => {
    for (const bad of [10_001, -1, 1.5, Number.NaN, 2 ** 60]) {
      const r = row({ id: "x", rates: [{ ...rate("998314", 1800, 1000, "intra"), rateBp: bad }] });
      expect(errors([r]).map((e) => e.code)).toContain("rate_invalid");
      expect(errors([r]).every((e) => e.path[0] === "x")).toBe(true);
    }
    expect(
      gstr1Sections([row({ id: "x", rates: [rate("998314", 10_000, 1000, "intra")] })], Q3, PARAMS).ok,
    ).toBe(true);
    expect(gstr1Sections([row({ id: "x", rates: [rate("998314", 0, 1000, "intra")] })], Q3, PARAMS).ok).toBe(
      true,
    );
  });

  it("amount_invalid: negative, fractional, not a number, beyond the safe range", () => {
    const withTotal = (v: number) => row({ id: "x", override: { totalInrMinor: v } });
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      expect(errors([withTotal(bad)])).toEqual(only("amount_invalid"));
    }
    expect(errors([row({ id: "x", override: { totalMinor: -5 } })])).toEqual(only("amount_invalid"));
    expect(errors([row({ id: "x", override: { roundOffInrMinor: 0.5 } })])).toEqual(only("amount_invalid"));
    for (const field of ["taxableMinor", "igstMinor", "cgstMinor", "sgstMinor"] as const) {
      const r = row({ id: "x", rates: [{ ...rate("998314", 1800, 1000, "intra"), [field]: -1 }] });
      expect(errors([r])).toEqual(only("amount_invalid"));
    }
  });

  it("the sign comes from the kind: a negative amount on a credit note is still amount_invalid", () => {
    const parent = row({ id: "p", number: "P1", gstin: GSTIN_27 });
    const note = row({
      id: "x",
      kind: "credit_note",
      gstin: GSTIN_27,
      noteOf: parentOf(parent),
      rates: [{ ...rate("998314", 1800, 1000, "intra"), taxableMinor: -1000 }],
    });
    expect(errors([note]).map((e) => e.code)).toContain("amount_invalid");
  });

  it("totals_mismatch: the rates and the round-off must add up to the total, to the paisa", () => {
    expect(errors([row({ id: "x", override: { totalInrMinor: 1_180_001 } })])).toEqual(
      only("totals_mismatch"),
    );
    expect(errors([row({ id: "x", override: { roundOffInrMinor: 1 } })])).toEqual(only("totals_mismatch"));
    expect(gstr1Sections([row({ id: "x", roundOff: -3 })], Q3, PARAMS).ok).toBe(true);
  });

  it("pos_invalid and export_pos_mismatch", () => {
    expect(errors([row({ id: "x", override: { placeOfSupplyCode: "50" as never } })])).toEqual(
      only("pos_invalid"),
    );
    expect(errors([row({ id: "x", override: { placeOfSupplyCode: "" as never } })])).toEqual(
      only("pos_invalid"),
    );
    expect(
      errors([row({ id: "x", supply: "export_lut", status: "overseas", gstin: null, pos: "19" })]),
    ).toEqual(only("export_pos_mismatch"));
    expect(errors([row({ id: "x", pos: "96" })])).toEqual(only("export_pos_mismatch"));
    expect(errors([row({ id: "x", supply: "inter", pos: "96" })])).toEqual(only("export_pos_mismatch"));
  });

  it("number_invalid: 1 to 16 characters", () => {
    expect(errors([row({ id: "x", number: "" })])).toEqual(only("number_invalid"));
    expect(errors([row({ id: "x", number: "A".repeat(17) })])).toEqual(only("number_invalid"));
    expect(errors([row({ id: "x", override: { number: 5 as never } })])).toEqual(only("number_invalid"));
    expect(
      gstr1Sections([row({ id: "x", number: "A".repeat(16) }), row({ id: "y", number: "B" })], Q3, PARAMS).ok,
    ).toBe(true);
  });

  it("duplicate_row: the same id, or the same kind and number", () => {
    expect(errors([row({ id: "x", number: "A" }), row({ id: "x", number: "B" })])).toEqual(
      only("duplicate_row"),
    );
    expect(errors([row({ id: "x", number: "A" }), row({ id: "y", number: "A" })])).toEqual(
      only("duplicate_row", "y"),
    );
    // the same number in two kinds is fine
    const cn = row({ id: "c", number: "A", kind: "credit_note", gstin: GSTIN_27, noteOf: parentOf(good) });
    expect(gstr1Sections([row({ id: "x", number: "A" }), cn], Q3, PARAMS).ok).toBe(true);
  });

  it("date_invalid (also on voided rows: the period cannot be told without a date)", () => {
    expect(errors([row({ id: "x", date: d(2026, 13, 1) })])).toEqual(only("date_invalid"));
    expect(errors([row({ id: "x", date: d(2026, 2, 30) })])).toEqual(only("date_invalid"));
    expect(errors([row({ id: "x", voided: true, date: d(2026, 0, 1) })])).toEqual(only("date_invalid"));
  });

  it("threshold_invalid and period_invalid are not tied to a row", () => {
    for (const bad of [-1, 0.5, Number.NaN]) {
      expect(errors([good], { ...PARAMS, b2clThresholdInrMinor: bad })).toEqual([
        { code: "threshold_invalid", path: ["params", "b2clThresholdInrMinor"] },
      ]);
    }
    expect(errors([good], PARAMS, { kind: "month", year: 2026, month: 13 })).toEqual([
      { code: "period_invalid", path: ["period"] },
    ]);
    expect(
      errors(
        [good],
        { ...PARAMS, b2clThresholdInrMinor: -1 },
        { kind: "quarter", fyStartYear: 2026, quarter: 5 as never },
      ).map((e) => e.code),
    ).toEqual(["period_invalid", "threshold_invalid"]);
  });

  it("amount_out_of_range: a sum beyond the safe-integer range", () => {
    const big = (id: string) =>
      row({ id, number: id, rates: [rate("998314", 0, 5_000_000_000_000_000, "intra")] });
    expect(gstr1Sections([big("a"), big("b")], Q3, PARAMS)).toEqual({
      ok: false,
      errors: [{ code: "amount_out_of_range", path: [] }],
    });
  });

  it("a forced throw is internal_error, not an exception", () => {
    const boom = {
      get id(): string {
        throw new Error("boom");
      },
    } as unknown as RegisterRow;
    expect(gstr1Sections([boom], Q3, PARAMS)).toEqual({
      ok: false,
      errors: [{ code: "internal_error", path: [] }],
    });
    expect(gstr1Sections(null as never, Q3, PARAMS)).toEqual({
      ok: false,
      errors: [{ code: "internal_error", path: [] }],
    });
  });
});

describe("a bad row fails the whole result", () => {
  it("good rows next to a bad one give no partial answer, and the path names the bad row", () => {
    const r = gstr1Sections(
      [good, row({ id: "bad", number: "B", gstin: null }), row({ id: "y", number: "Y" })],
      Q3,
      PARAMS,
    );
    expect(r).toEqual({ ok: false, errors: [{ code: "gstin_missing", path: ["bad"] }] });
  });

  it("every problem is listed once, in row order", () => {
    const r = gstr1Sections(
      [
        row({ id: "a", number: "", gstin: null }),
        row({ id: "b", number: "B", override: { totalInrMinor: 5 } }),
      ],
      Q3,
      PARAMS,
    );
    expect(r).toEqual({
      ok: false,
      errors: [
        { code: "number_invalid", path: ["a"] },
        { code: "gstin_missing", path: ["a"] },
        { code: "totals_mismatch", path: ["b"] },
      ],
    });
  });

  it("voided and out-of-period rows are not checked beyond kind, date and duplicates", () => {
    const voidedBroken = row({
      id: "v",
      number: "V",
      voided: true,
      override: { totalInrMinor: 5, rates: [] },
    });
    const lateBroken = row({ id: "l", number: "L", date: d(2027, 6, 1), override: { totalInrMinor: -5 } });
    expect(gstr1Sections([good, voidedBroken, lateBroken], Q3, PARAMS).ok).toBe(true);
  });
});

describe("hsn_description_missing is one warning per SAC, and prototype names are not descriptions", () => {
  it("warns once", () => {
    const a = row({
      id: "a",
      number: "A",
      rates: [rate("999999", 1800, 1000, "intra"), rate("999999", 500, 1000, "intra")],
    });
    const b = row({
      id: "b",
      number: "B",
      status: "unregistered",
      gstin: null,
      rates: [rate("999999", 1800, 1000, "intra"), rate("constructor", 1800, 1000, "intra")],
    });
    const r = gstr1Sections([a, b], Q3, PARAMS);
    expect(r.ok && r.warnings).toEqual([
      { code: "hsn_description_missing", path: ["hsn", "999999"] },
      { code: "hsn_description_missing", path: ["hsn", "constructor"] },
    ]);
  });
});

// ---- the other modules -------------------------------------------------------------------------------------------------------
describe("docsRows", () => {
  const ok1: DocsIssuedInput = { series: "invoice", from: "A1", to: "A9", total: 9, cancelled: 1 };
  it("series_not_gst for a series that is not a GST document, or not a series", () => {
    expect(docsRows([ok1, { ...ok1, series: "proforma" }])).toEqual({
      ok: false,
      errors: [{ code: "series_not_gst", path: [1] }],
    });
    expect(docsRows([{ ...ok1, series: "receipt" }])).toEqual({
      ok: false,
      errors: [{ code: "series_not_gst", path: [0] }],
    });
    expect(docsRows([{ ...ok1, series: "toString" as never }])).toEqual({
      ok: false,
      errors: [{ code: "series_not_gst", path: [0] }],
    });
    expect(docsRows([{ ...ok1, series: 5 as never }])).toEqual({
      ok: false,
      errors: [{ code: "series_not_gst", path: [0] }],
    });
  });
  it("docs_counts_invalid for counts that are not whole, negative, or cancelled above total, and for an empty range", () => {
    const bad: Partial<DocsIssuedInput>[] = [
      { total: -1 },
      { total: 1.5 },
      { cancelled: -1 },
      { cancelled: 10 },
      { cancelled: Number.NaN },
      { total: Number.NaN },
      { from: "" },
      { to: "" },
      { from: 5 as never },
      { to: null as never },
    ];
    for (const b of bad) {
      expect(docsRows([{ ...ok1, ...b }])).toEqual({
        ok: false,
        errors: [{ code: "docs_counts_invalid", path: [0] }],
      });
    }
    expect(docsRows([{ ...ok1, total: 0, cancelled: 0 }]).ok).toBe(true);
    expect(docsRows([{ ...ok1, total: 5, cancelled: 5 }]).ok).toBe(true);
  });
  it("an empty list is an empty table, and a throw is internal_error", () => {
    expect(docsRows([])).toEqual({ ok: true, value: [], warnings: [] });
    expect(docsRows(null as never)).toEqual({ ok: false, errors: [{ code: "internal_error", path: [] }] });
  });
});

describe("realisation and EDF error codes", () => {
  const inv = (over: Partial<RegisterRow> = {}) =>
    row({
      id: "e1",
      number: "E1",
      kind: "export_invoice",
      supply: "export_lut",
      date: d(2026, 11, 3),
      rates: [rate("998314", 1800, 1000, "export_lut")],
      ...{ override: over },
    });

  it("rules_invalid for zero, fractional or absurd months and negative days", () => {
    for (const bad of [
      { warnMonths: 0 },
      { warnMonths: 1.5 },
      { escalateMonths: 0 },
      { escalateMonths: -1 },
      { escalateExtraDays: -1 },
      { escalateExtraDays: 0.5 },
      { warnMonths: Number.NaN },
      { warnMonths: 5000 },
    ]) {
      expect(
        realisationRulesOf({ warnMonths: 9, escalateMonths: 12, escalateExtraDays: 15, ...bad }),
      ).toEqual({
        ok: false,
        errors: [{ code: "rules_invalid", path: ["rules"] }],
      });
    }
    expect(realisationRulesOf({ warnMonths: 9, escalateMonths: 12, escalateExtraDays: 0 }).ok).toBe(true);
  });

  it("rules_invalid for the rules passed to the functions", () => {
    const rules = {
      femaMonthsForeign: 9,
      femaMonthsInr: 0,
      gstMonths: 12,
      gstExtraDays: 15,
      approachingDays: 30,
      rulesFrom: d(2026, 10, 1),
    };
    expect(realisationDates({ invoiceDate: d(2026, 11, 3), currency: "USD" }, rules)).toEqual({
      ok: false,
      errors: [{ code: "rules_invalid", path: ["rules"] }],
    });
    expect(
      realisationStatus(
        { invoiceDate: d(2026, 11, 3), currency: "USD", outstandingMinor: 1 },
        d(2027, 1, 1),
        rules,
      ),
    ).toEqual({
      ok: false,
      errors: [{ code: "rules_invalid", path: ["rules"] }],
    });
    expect(realisationRows([], d(2027, 1, 1), rules)).toEqual({
      ok: false,
      errors: [{ code: "rules_invalid", path: ["rules"] }],
    });
    expect(edfRows([], 2026, 11, { rules })).toEqual({
      ok: false,
      errors: [{ code: "rules_invalid", path: ["rules"] }],
    });
    expect(edfRows([inv()], 2026, 11, { rules })).toEqual({
      ok: false,
      errors: [{ code: "rules_invalid", path: ["rules"] }],
    });
  });

  it("date_invalid for the invoice date, the extension and today; amount_invalid for the outstanding amount", () => {
    expect(realisationDates({ invoiceDate: d(2026, 13, 1), currency: "USD" })).toEqual({
      ok: false,
      errors: [{ code: "date_invalid", path: [] }],
    });
    expect(
      realisationDates({
        invoiceDate: d(2026, 11, 1),
        currency: "USD",
        extension: { femaDue: d(2027, 2, 30) },
      }),
    ).toEqual({
      ok: false,
      errors: [{ code: "date_invalid", path: ["extension"] }],
    });
    const base = { invoiceDate: d(2026, 11, 1), currency: "USD" as const, outstandingMinor: 1 };
    expect(realisationStatus(base, d(2027, 13, 1))).toEqual({
      ok: false,
      errors: [{ code: "date_invalid", path: ["today"] }],
    });
    expect(realisationStatus({ ...base, outstandingMinor: 1.5 }, d(2027, 1, 1))).toEqual({
      ok: false,
      errors: [{ code: "amount_invalid", path: ["outstandingMinor"] }],
    });
    expect(realisationRows([], d(2027, 13, 1))).toEqual({
      ok: false,
      errors: [{ code: "date_invalid", path: ["today"] }],
    });
    expect(realisationRows([inv({ issueDate: d(2026, 13, 1) })], d(2027, 1, 1))).toEqual({
      ok: false,
      errors: [{ code: "date_invalid", path: ["e1"] }],
    });
    expect(realisationRows([inv({ outstandingMinor: Number.NaN })], d(2027, 1, 1))).toEqual({
      ok: false,
      errors: [{ code: "amount_invalid", path: ["e1", "outstandingMinor"] }],
    });
  });

  it("fx_missing and the other EDF codes, with the invoice's id as the path", () => {
    expect(edfRows([inv({ currency: "USD", fxRateMicros: null })], 2026, 11)).toEqual({
      ok: false,
      errors: [{ code: "fx_missing", path: ["e1"] }],
    });
    expect(edfRows([inv({ issueDate: d(2026, 13, 1) })], 2026, 11)).toEqual({
      ok: false,
      errors: [{ code: "date_invalid", path: ["e1"] }],
    });
    expect(edfRows([inv({ totalMinor: -1 })], 2026, 11)).toEqual({
      ok: false,
      errors: [{ code: "amount_invalid", path: ["e1"] }],
    });
    expect(edfRows([inv({ totalInrMinor: 1.5 })], 2026, 11)).toEqual({
      ok: false,
      errors: [{ code: "amount_invalid", path: ["e1"] }],
    });
    for (const fx of [0, -1, 1.5]) {
      expect(edfRows([inv({ currency: "USD", fxRateMicros: fx })], 2026, 11)).toEqual({
        ok: false,
        errors: [{ code: "amount_invalid", path: ["e1"] }],
      });
    }
    expect(edfRows([], 2026, 13)).toEqual({
      ok: false,
      errors: [{ code: "period_invalid", path: ["period"] }],
    });
    expect(edfMonth(2026, 0)).toEqual({ ok: false, errors: [{ code: "period_invalid", path: ["period"] }] });
    expect(edfMonth(0, 1)).toEqual({ ok: false, errors: [{ code: "period_invalid", path: ["period"] }] });
  });

  it("layout_unknown for a version that does not exist", () => {
    const empty = {
      period: Q3,
      range: { from: d(2026, 10, 1), to: d(2026, 12, 31) },
    } as unknown as Gstr1Sections;
    expect(gstr1Csv(empty, [], "gstr1-csv-v9" as never)).toEqual({
      ok: false,
      errors: [{ code: "layout_unknown", path: ["version"] }],
    });
    expect(edfCsv([], "edf-v9" as never)).toEqual({
      ok: false,
      errors: [{ code: "layout_unknown", path: ["version"] }],
    });
    expect(realisationCsv([], "realisation-v9" as never)).toEqual({
      ok: false,
      errors: [{ code: "layout_unknown", path: ["version"] }],
    });
    expect(edfCsv([], "toString" as never).ok).toBe(false);
  });

  it("a forced throw in a writer is internal_error", () => {
    expect(
      edfCsv([
        {
          get number(): string {
            throw new Error("x");
          },
        },
      ] as never),
    ).toEqual({ ok: false, errors: [{ code: "internal_error", path: [] }] });
    expect(realisationCsv([null] as never)).toEqual({
      ok: false,
      errors: [{ code: "internal_error", path: [] }],
    });
    expect(gstr1Csv(null as never, [])).toEqual({
      ok: false,
      errors: [{ code: "internal_error", path: [] }],
    });
  });
});

// ---- no public function throws -------------------------------------------------------------------------------------------------
const wild = fc.oneof(
  fc.integer(),
  fc.double({ noDefaultInfinity: false }),
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0,
    2 ** 53,
    -(2 ** 53),
    Number.MAX_VALUE,
  ),
  fc.integer({ min: -5, max: 20_000 }),
);
const text = fc.oneof(fc.string(), fc.constantFrom("", "19", "96", "invoice", "USD", "INR"));
const wildDate = fc.record({ year: wild, month: wild, day: wild });
const wildRate = fc.record({
  sac: fc.oneof(text, fc.constant(null)),
  rateBp: wild,
  taxableMinor: wild,
  igstMinor: wild,
  cgstMinor: wild,
  sgstMinor: wild,
});
const wildRow: fc.Arbitrary<RegisterRow> = fc
  .record({
    id: text,
    kind: fc.constantFrom("tax_invoice", "export_invoice", "credit_note", "debit_note", "other"),
    voided: fc.boolean(),
    number: text,
    issueDate: fc.oneof(wildDate, fc.constant(d(2026, 11, 3))),
    currency: fc.constantFrom("INR", "USD"),
    totalMinor: wild,
    totalInrMinor: wild,
    roundOffInrMinor: wild,
    fxRateMicros: fc.oneof(wild, fc.constant(null)),
    supplyType: fc.constantFrom("intra", "inter", "export_lut", "export_igst"),
    placeOfSupplyCode: fc.oneof(text, fc.constantFrom("19", "96", "27")),
    reverseCharge: fc.boolean(),
    recipient: fc.record({
      status: fc.constantFrom("registered", "unregistered", "overseas"),
      gstin: fc.oneof(text, fc.constant(null), fc.constant(GSTIN_27)),
      name: text,
      address: fc.oneof(text, fc.constant(null)),
      stateCode: fc.constant(null),
      countryCode: fc.oneof(text, fc.constant(null)),
    }),
    rates: fc.array(wildRate, { maxLength: 3 }),
    noteOf: fc.oneof(
      fc.constant(null),
      fc.record({
        number: text,
        issueDate: wildDate,
        supplyType: fc.constantFrom("intra", "inter", "export_lut"),
        recipientStatus: fc.constantFrom("registered", "unregistered", "overseas"),
        placeOfSupplyCode: text,
        totalInrMinor: wild,
      }),
    ),
    outstandingMinor: wild,
    purposeCode: fc.oneof(text, fc.constant(null)),
  })
  .map((r) => r as unknown as RegisterRow);

describe("no public function throws for any input of the declared types", () => {
  it("gstr1Sections, the export-list functions and the CSV writers always return a result", () => {
    fc.assert(
      fc.property(
        fc.array(wildRow, { maxLength: 4 }),
        fc.record({
          kind: fc.constantFrom("month", "quarter"),
          year: wild,
          month: wild,
          fyStartYear: wild,
          quarter: wild,
        }),
        wild,
        wildDate,
        (register, period, threshold, date) => {
          const results = [
            gstr1Sections(register, period as unknown as GstPeriod, {
              ...PARAMS,
              b2clThresholdInrMinor: threshold,
            }),
            edfRows(register, date.year, date.month),
            realisationRows(register, date),
            realisationStatus({ invoiceDate: date, currency: "USD", outstandingMinor: threshold }, date),
            realisationDates({ invoiceDate: date, currency: "INR" }),
            gstPeriod(period as unknown as GstPeriod),
            edfMonth(date.year, date.month),
            realisationRulesOf({
              warnMonths: threshold,
              escalateMonths: date.year,
              escalateExtraDays: date.day,
            }),
            docsRows([{ series: "invoice", from: "a", to: "b", total: threshold, cancelled: date.day }]),
          ];
          for (const r of results) expect(typeof r.ok).toBe("boolean");
          const sections = results[0];
          if (sections?.ok) {
            const out = gstr1Csv(sections.value as Gstr1Sections, []);
            expect(typeof out.ok).toBe("boolean");
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});
