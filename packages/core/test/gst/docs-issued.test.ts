// The Table 13 adapter [ADM-REP-04; M5.5b, LD73; VERIFY WITH CA/LEGAL]: register rows -> M5.1's `documentsIssuedSummary` -> `docsIssuedInputs` -> `docsRows`.
// The type-level tests pin the interfaces the adapter depends on: `tsc` covers this folder (the package's tsconfig includes `test`), so a change to
// `IssuedSummary`, `IssuedRow` or `RegisterRow` that breaks the contract fails the core typecheck.
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type DocsIssuedInput,
  docsIssuedInputs,
  docsRows,
  issuedRowsOf,
  type RegisterApiRow,
  type RegisterRow,
} from "../../src/gst/index.ts";
import { documentsIssuedSummary, type IssuedRow, type IssuedSummary } from "../../src/invoices.ts";
import { GOLDEN_API_REGISTER, row, toApi } from "./fixtures.ts";

describe("type-level: the contract between the summary, the adapter and Table 13", () => {
  it("IssuedSummary keeps the fields the adapter reads", () => {
    expectTypeOf<IssuedSummary>().toHaveProperty("series");
    expectTypeOf<IssuedSummary["series"]>().toBeString();
    expectTypeOf<IssuedSummary["fy"]>().toBeString();
    expectTypeOf<IssuedSummary["from"]>().toBeString();
    expectTypeOf<IssuedSummary["to"]>().toBeString();
    expectTypeOf<IssuedSummary["total"]>().toBeNumber();
    expectTypeOf<IssuedSummary["cancelled"]>().toBeNumber();
    // the key set may grow (the adapter ignores the rest), but it must contain these six
    expectTypeOf<"series" | "fy" | "from" | "to" | "total" | "cancelled">().toExtend<keyof IssuedSummary>();
  });

  it("IssuedRow is exactly what issuedRowsOf produces", () => {
    expectTypeOf(issuedRowsOf).returns.toEqualTypeOf<IssuedRow[]>();
    expectTypeOf<IssuedRow>().toEqualTypeOf<{
      readonly series: string;
      readonly fy: string;
      readonly number: number;
      readonly numberDisplay: string;
      readonly void: boolean;
    }>();
  });

  it("the adapter's output is a DocsIssuedInput[], and docsRows takes it", () => {
    type Out = Extract<ReturnType<typeof docsIssuedInputs>, { ok: true }>["value"];
    expectTypeOf<Out>().toExtend<DocsIssuedInput[]>();
    expectTypeOf(docsRows).parameter(0).toExtend<readonly DocsIssuedInput[]>();
  });

  it("a RegisterApiRow is a RegisterRow with the fields of the number and the client", () => {
    expectTypeOf<RegisterApiRow>().toExtend<RegisterRow>();
    expectTypeOf<RegisterApiRow["series"]>().toEqualTypeOf<DocsIssuedInput["series"]>();
    expectTypeOf<RegisterApiRow["fy"]>().toBeString();
    expectTypeOf<RegisterApiRow["seq"]>().toBeNumber();
    expectTypeOf<RegisterApiRow["clientId"]>().toBeString();
    expectTypeOf<RegisterApiRow["clientCode"]>().toBeString();
  });
});

describe("issuedRowsOf", () => {
  it("maps the series, FY, counter, printed number and the voided flag", () => {
    const a = toApi(row({ id: "a", number: "TH/INV/2627/0007" }), 7);
    const v = toApi(row({ id: "v", number: "TH/INV/2627/0008", voided: true }), 8);
    expect(issuedRowsOf([a, v])).toEqual([
      { series: "invoice", fy: "2627", number: 7, numberDisplay: "TH/INV/2627/0007", void: false },
      { series: "invoice", fy: "2627", number: 8, numberDisplay: "TH/INV/2627/0008", void: true },
    ]);
  });
});

describe("register -> documentsIssuedSummary -> docsRows", () => {
  it("gives the first and last number, the total and the cancelled count of each series", () => {
    const summary = documentsIssuedSummary(issuedRowsOf(GOLDEN_API_REGISTER));
    const inputs = docsIssuedInputs(summary);
    if (!inputs.ok) throw new Error(JSON.stringify(inputs.errors));
    const rows = docsRows(inputs.value);
    if (!rows.ok) throw new Error(JSON.stringify(rows.errors));
    const byNature = rows.value.map((r) => [r.series, r.from, r.to, r.total, r.cancelled]);
    expect(byNature).toEqual([
      // inv01..inv10 minus none: numbers 1..9 and 100 in the golden fixture; the voided one (0006) is cancelled
      ["invoice", "TH/INV/2627/0001", "TH/INV/2627/0100", 10, 1],
      ["export", "TH/EXP/2627/0001", "TH/EXP/2627/0003", 3, 0],
      ["creditNote", "TH/CN/2627/0001", "TH/CN/2627/0004", 4, 0],
      ["debitNote", "TH/DN/2627/0001", "TH/DN/2627/0001", 1, 0],
    ]);
    expect(rows.value.map((r) => r.nature)).toEqual([
      "Invoices for outward supply",
      "Invoices for outward supply",
      "Credit Note",
      "Debit Note",
    ]);
  });
});

describe("docsIssuedInputs", () => {
  const summary = (over: Partial<IssuedSummary> = {}): IssuedSummary => ({
    series: "invoice",
    fy: "2627",
    from: "A1",
    to: "A9",
    total: 9,
    cancelled: 1,
    net: 8,
    ...over,
  });

  it("drops the net figure", () => {
    const r = docsIssuedInputs([summary()]);
    expect(r).toEqual({
      ok: true,
      value: [{ series: "invoice", from: "A1", to: "A9", total: 9, cancelled: 1 }],
      warnings: [],
    });
  });

  it("a series that is not a GST document is series_not_gst at its index", () => {
    const r = docsIssuedInputs([summary(), summary({ series: "proforma" }), summary({ series: "nope" })]);
    expect(r).toEqual({
      ok: false,
      errors: [
        { code: "series_not_gst", path: [1] },
        { code: "series_not_gst", path: [2] },
      ],
    });
  });

  it("more than one financial year is period_invalid", () => {
    const r = docsIssuedInputs([summary(), summary({ series: "export", fy: "2728" })]);
    expect(r).toEqual({ ok: false, errors: [{ code: "period_invalid", path: ["period"] }] });
  });

  it("an empty summary is an empty list", () => {
    expect(docsIssuedInputs([])).toEqual({ ok: true, value: [], warnings: [] });
  });
});
