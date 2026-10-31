// The CSV files of M5.5b [ADM-REP-04, ADM-REP-06, ADM-CLI-04; LD83; every column UNVERIFIED, Settled by the lead on the safest reading, 2026-10-30 (08-C RA-23): a test import before the first GSTR-1]: golden CSVs of the sales
// register, the output tax, the GSTR-3B summary and the statement over the golden fixture, no bare LF, formula defence on text only,
// and the layout versions are known and frozen.
import { describe, expect, it } from "vitest";
import {
  CURRENT_GSTR3B_LAYOUT,
  CURRENT_OUTPUT_TAX_LAYOUT,
  CURRENT_SALES_REGISTER_LAYOUT,
  CURRENT_STATEMENT_LAYOUT,
  type FileLayout,
  GSTR3B_LAYOUTS,
  gstPeriod,
  gstr1Sections,
  gstr3bCsv,
  gstr3bSummary,
  OUTPUT_TAX_LAYOUTS,
  outputTaxCsv,
  outputTaxRows,
  SALES_REGISTER_LAYOUTS,
  STATEMENT_LAYOUTS,
  type StatementCsvInput,
  type StatementLabels,
  salesRegisterCsv,
  salesRegisterRows,
  statementCsv,
  statementCsvRows,
} from "../../src/gst/index.ts";
import { heldRowOf } from "../../src/gst/layouts.ts";
import { linesDeductingAll, NO_IMS_HELD } from "../../src/gst/summary.ts";
import { statementEntries } from "../../src/statement.ts";
import { GOLDEN_API_REGISTER, hasBareLineBreak, PARAMS, Q3, row, toApi } from "./fixtures.ts";

const range = (() => {
  const r = gstPeriod(Q3);
  if (!r.ok) throw new Error("period");
  return r.value;
})();
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; errors: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};

const LABELS: StatementLabels = {
  opening: "Opening (test label)",
  closing: "Closing (test label)",
  kinds: {
    tax_invoice: "Invoice (test label)",
    export_invoice: "Export invoice (test label)",
    debit_note: "Debit note (test label)",
    credit_note: "Credit note (test label)",
    receipt: "Payment received (test label)",
  },
};

describe("golden CSVs", () => {
  it("sales-register-v1", async () => {
    const csv = unwrap(
      salesRegisterCsv(unwrap(salesRegisterRows(GOLDEN_API_REGISTER, range, PARAMS.supplierStateCode))),
    );
    expect(hasBareLineBreak(csv)).toBe(false);
    await expect(csv).toMatchFileSnapshot("./__snapshots__/sales-register-v1-q3.csv");
  });

  it("output-tax-v1", async () => {
    const csv = unwrap(
      outputTaxCsv(unwrap(outputTaxRows(GOLDEN_API_REGISTER, range, PARAMS.supplierStateCode))),
    );
    expect(hasBareLineBreak(csv)).toBe(false);
    await expect(csv).toMatchFileSnapshot("./__snapshots__/output-tax-v1-q3.csv");
  });

  it("gstr3b-summary-v1 (byte for byte as before rt1: every credit note in cdnr deducted)", async () => {
    const sections = unwrap(gstr1Sections(GOLDEN_API_REGISTER, Q3, PARAMS));
    const csv = unwrap(gstr3bCsv(unwrap(gstr3bSummary(sections)), "gstr3b-summary-v1"));
    expect(hasBareLineBreak(csv)).toBe(false);
    await expect(csv).toMatchFileSnapshot("./__snapshots__/gstr3b-summary-v1-q3.csv");
  });

  it("gstr3b-summary-v2 (rt1 T3, RA-04): only IMS-accepted credit notes deducted, the held row last (07-ZD line 7)", async () => {
    const sections = unwrap(gstr1Sections(GOLDEN_API_REGISTER, Q3, PARAMS));
    const summary = unwrap(gstr3bSummary(sections));
    const csv = unwrap(gstr3bCsv(summary));
    expect(csv).toBe(unwrap(gstr3bCsv(summary, "gstr3b-summary-v2")));
    expect(hasBareLineBreak(csv)).toBe(false);
    const CRLF = "\r\n";
    const last = csv.split(CRLF).at(-2) ?? "";
    expect(
      last.startsWith(",Credit notes to registered clients not yet accepted in IMS (not deducted),,"),
    ).toBe(true);
    await expect(csv).toMatchFileSnapshot("./__snapshots__/gstr3b-summary-v2-q3.csv");
    // rt1 F3 (lead D8): the held row prints positive amounts not deducted; the value stays signed inside
    expect(last).toBe(
      ",Credit notes to registered clients not yet accepted in IMS (not deducted),,2000.00,0.00,180.00,180.00",
    );
    expect(last).not.toContain("-");
    expect(summary.imsHeld?.taxableMinor).toBe(-200_000);
    // 3.1(a) printed - held printed = the 3.1(a) that deducts every credit note (v1's)
    const amounts = (line: string) =>
      line
        .split(",")
        .slice(-4)
        .map((v) => Math.round(Number(v) * 100));
    const a = amounts(csv.split(CRLF)[1] ?? "");
    const held = amounts(last);
    const all31a = linesDeductingAll(summary).find((l) => l.table === "3.1(a)");
    expect(a.map((v, i) => v - (held[i] ?? 0))).toEqual([
      all31a?.taxableMinor,
      all31a?.igstMinor,
      all31a?.cgstMinor,
      all31a?.sgstMinor,
    ]);
    // with every credit note accepted, v2's lines are v1's and the held row is zero
    const accepted = GOLDEN_API_REGISTER.map((r) =>
      r.kind === "credit_note" ? { ...r, imsStatus: "accepted" } : r,
    );
    const all = unwrap(gstr3bSummary(unwrap(gstr1Sections(accepted, Q3, PARAMS))));
    const v1 = unwrap(gstr3bCsv(all, "gstr3b-summary-v1")).split(CRLF);
    const v2 = unwrap(gstr3bCsv(all, "gstr3b-summary-v2")).split(CRLF);
    expect(v2.slice(0, v1.length - 1)).toEqual(v1.slice(0, -1));
    expect(v2.at(-2)).toBe(
      ",Credit notes to registered clients not yet accepted in IMS (not deducted),,0.00,0.00,0.00,0.00",
    );
  });

  it("statement-v1", async () => {
    const rows = [
      {
        id: "i1",
        kind: "tax_invoice",
        date: "2026-10-05",
        number: "TH/INV/2627/0001",
        amountMinor: 1_180_000,
      },
      {
        id: "x1",
        kind: "export_invoice",
        date: "2026-10-09",
        number: "TH/EXP/2627/0001",
        amountMinor: 100_000,
      },
      { id: "c1", kind: "credit_note", date: "2026-10-12", number: "TH/CN/2627/0001", amountMinor: 118_000 },
      { id: "r1", kind: "receipt", date: "2026-10-12", number: "TH/INV/2627/0002", amountMinor: 5_900 },
      { id: "d1", kind: "debit_note", date: "2026-10-20", number: "TH/DN/2627/0001", amountMinor: 11_800 },
    ] as const;
    const s = statementEntries(rows, -50_000);
    if (!s.ok) throw new Error("statement");
    const csv = unwrap(
      statementCsv({
        from: "2026-10-01",
        to: "2026-10-31",
        openingMinor: -50_000,
        closingMinor: s.closingMinor,
        entries: s.entries,
        labels: LABELS,
      }),
    );
    expect(hasBareLineBreak(csv)).toBe(false);
    await expect(csv).toMatchFileSnapshot("./__snapshots__/statement-v1.csv");
  });

  it("a {number} in a kind label is the invoice the credit note is against; labels without it are unchanged", () => {
    const rows = [
      {
        id: "c1",
        kind: "credit_note",
        date: "2026-10-20",
        number: "CN1",
        amountMinor: 500,
        againstNumber: "INV9",
      },
      { id: "i1", kind: "tax_invoice", date: "2026-10-21", number: "INV10", amountMinor: 900 },
    ] as const;
    const s = statementEntries(rows, 0);
    if (!s.ok) throw new Error("statement");
    const labels: StatementLabels = {
      ...LABELS,
      kinds: { ...LABELS.kinds, credit_note: "Credit note against {number}" },
    };
    const out = unwrap(
      statementCsvRows({
        from: "2026-10-01",
        to: "2026-10-31",
        openingMinor: 0,
        closingMinor: s.closingMinor,
        entries: s.entries,
        labels,
      }),
    );
    expect(out.map((r) => r.details)).toEqual([
      "Opening (test label)",
      "Credit note against INV9",
      "Invoice (test label)",
      "Closing (test label)",
    ]);
  });
});

describe("text is defused, numbers are not", () => {
  it("a client name that starts like a formula gets a quote; a negative amount stays a number", () => {
    const evil = toApi(
      row({
        id: "e",
        number: "E1",
        name: "=HYPERLINK(1)",
        kind: "credit_note",
        noteOf: {
          number: "P1",
          issueDate: { year: 2026, month: 10, day: 1 },
          supplyType: "intra",
          recipientStatus: "registered",
          placeOfSupplyCode: "19",
          totalInrMinor: 1_000_000,
        },
      }),
      1,
    );
    const csv = unwrap(salesRegisterCsv(unwrap(salesRegisterRows([evil], range, "19"))));
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toMatch(/,-\d+\.\d{2},/);
    expect(csv).not.toContain("'-");
  });
});

describe("layout versions", () => {
  it("the current versions are known and frozen (3B is v2 since rt1)", () => {
    expect(CURRENT_SALES_REGISTER_LAYOUT).toBe("sales-register-v1");
    expect(CURRENT_OUTPUT_TAX_LAYOUT).toBe("output-tax-v1");
    expect(CURRENT_GSTR3B_LAYOUT).toBe("gstr3b-summary-v2");
    expect(CURRENT_STATEMENT_LAYOUT).toBe("statement-v1");
    for (const layouts of [SALES_REGISTER_LAYOUTS, OUTPUT_TAX_LAYOUTS, GSTR3B_LAYOUTS, STATEMENT_LAYOUTS]) {
      expect(Object.isFrozen(layouts)).toBe(true);
      for (const f of Object.values(layouts) as FileLayout<never>[]) {
        expect(Object.isFrozen(f)).toBe(true);
        expect(Object.isFrozen(f.columns)).toBe(true);
        expect(f.columns.every((c) => Object.isFrozen(c))).toBe(true);
      }
    }
  });

  it("an unknown version is layout_unknown, in every writer", () => {
    const expected = { ok: false, errors: [{ code: "layout_unknown", path: ["version"] }] };
    expect(salesRegisterCsv([], "sales-register-v0" as never)).toEqual(expected);
    expect(outputTaxCsv([], "output-tax-v0" as never)).toEqual(expected);
    expect(gstr3bCsv({ lines: [] }, "gstr3b-v0" as never)).toEqual(expected);
    expect(
      statementCsv(
        {
          from: "2026-10-01",
          to: "2026-10-31",
          openingMinor: 0,
          closingMinor: 0,
          entries: [],
          labels: LABELS,
        },
        "statement-v0" as never,
      ),
    ).toEqual(expected);
  });

  it("rt1 F3: heldRowOf prints magnitudes (bigint negation: a zero is 0, never -0) and keeps the count and numbers", () => {
    const zero = heldRowOf(NO_IMS_HELD);
    for (const v of [zero.taxableMinor, zero.igstMinor, zero.cgstMinor, zero.sgstMinor]) {
      expect(Object.is(v, 0)).toBe(true);
    }
    expect(
      heldRowOf({
        count: 2,
        numbers: ["C1", "C2"],
        taxableMinor: -150_050,
        igstMinor: -27_009,
        cgstMinor: 0,
        sgstMinor: 0,
      }),
    ).toEqual({
      table: "ims_held",
      count: 2,
      numbers: ["C1", "C2"],
      taxableMinor: 150_050,
      igstMinor: 27_009,
      cgstMinor: 0,
      sgstMinor: 0,
    });
    expect(
      unwrap(
        gstr3bCsv({
          lines: [],
          imsHeld: { count: 1, numbers: ["C1"], taxableMinor: -1, igstMinor: 0, cgstMinor: 0, sgstMinor: 0 },
        }),
      ).split("\r\n")[1],
    ).toBe(",Credit notes to registered clients not yet accepted in IMS (not deducted),,0.01,0.00,0.00,0.00");
  });

  it("rt1 review 9: each 3B version owns its row builder in the registry, and the writer is only that entry", () => {
    const summary = unwrap(gstr3bSummary(unwrap(gstr1Sections(GOLDEN_API_REGISTER, Q3, PARAMS))));
    const v1 = GSTR3B_LAYOUTS["gstr3b-summary-v1"];
    const v2 = GSTR3B_LAYOUTS["gstr3b-summary-v2"];
    // v1: every credit note in cdnr deducted, no held row
    expect(v1.rowsOf(summary)).toEqual(linesDeductingAll(summary));
    // v2: the summary's own lines (only IMS-accepted credit notes deducted), then the held row as printed
    expect(v2.rowsOf(summary)).toEqual([...summary.lines, heldRowOf(summary.imsHeld ?? NO_IMS_HELD)]);
    expect(v2.rowsOf({ lines: [] })).toEqual([heldRowOf(NO_IMS_HELD)]);
    for (const [version, layout] of Object.entries(GSTR3B_LAYOUTS)) {
      expect(typeof layout.rowsOf).toBe("function");
      expect(unwrap(gstr3bCsv(summary, version as keyof typeof GSTR3B_LAYOUTS))).toBe(
        layout.csv(summary, {}),
      );
      // the file has a header and one line per row the builder gives
      expect(layout.csv(summary, {}).split("\r\n")).toHaveLength(layout.rowsOf(summary).length + 2);
    }
  });

  it("gstr3b-summary-v2 of a summary built by hand without `imsHeld`: the held row is zeros (nothing held back)", () => {
    expect(unwrap(gstr3bCsv({ lines: [] }))).toBe(
      "Table,Description,Place of supply,Taxable value,IGST,CGST,SGST\r\n,Credit notes to registered clients not yet accepted in IMS (not deducted),,0.00,0.00,0.00,0.00\r\n",
    );
  });

  it("a header-only file for no rows ends in CRLF", () => {
    for (const csv of [
      unwrap(salesRegisterCsv([])),
      unwrap(outputTaxCsv([])),
      unwrap(gstr3bCsv({ lines: [] }, "gstr3b-summary-v1")),
    ]) {
      expect(csv.endsWith("\r\n")).toBe(true);
      expect(csv.split("\r\n")).toHaveLength(2);
    }
  });
});

describe("the statement file", () => {
  const base: StatementCsvInput = {
    from: "2026-10-01",
    to: "2026-10-31",
    openingMinor: 0,
    closingMinor: 0,
    entries: [],
    labels: LABELS,
  };

  it("has the opening row, the entries and the closing row; debit and credit are blank on the other side", () => {
    const rows = unwrap(
      statementCsvRows({
        ...base,
        openingMinor: 1_000,
        closingMinor: 2_000,
        entries: [
          {
            id: "a",
            kind: "tax_invoice",
            date: "2026-10-05",
            number: "N1",
            amountMinor: 1_500,
            debitMinor: 1_500,
            creditMinor: 0,
            balanceMinor: 2_500,
          },
          {
            id: "b",
            kind: "credit_note",
            date: "2026-10-06",
            number: "N2",
            amountMinor: 500,
            debitMinor: 0,
            creditMinor: 500,
            balanceMinor: 2_000,
          },
        ],
      }),
    );
    expect(rows.map((r) => [r.details, r.document, r.debitMinor, r.creditMinor, r.balanceMinor])).toEqual([
      ["Opening (test label)", "", null, null, 1_000],
      ["Invoice (test label)", "N1", 1_500, null, 2_500],
      ["Credit note (test label)", "N2", null, 500, 2_000],
      ["Closing (test label)", "", null, null, 2_000],
    ]);
  });

  it("refuses a bad date or amount, at its place, and writes nothing", () => {
    const entry = {
      id: "a",
      kind: "tax_invoice",
      date: "2026-10-05",
      number: "N1",
      amountMinor: 1,
      debitMinor: 1,
      creditMinor: 0,
      balanceMinor: 1,
    } as const;
    const r = statementCsvRows({
      ...base,
      from: "2026-13-01",
      to: "nope",
      openingMinor: 1.5,
      closingMinor: Number.NaN,
      entries: [{ ...entry, date: "2026-02-30" }, { ...entry, debitMinor: 0.5 }, entry],
    });
    expect(r).toEqual({
      ok: false,
      errors: [
        { code: "date_invalid", path: ["from"] },
        { code: "date_invalid", path: ["to"] },
        { code: "amount_invalid", path: ["openingMinor"] },
        { code: "amount_invalid", path: ["closingMinor"] },
        { code: "date_invalid", path: ["entries", 0] },
        { code: "amount_invalid", path: ["entries", 1] },
      ],
    });
    expect(statementCsv({ ...base, to: "nope" }).ok).toBe(false);
  });
});
