// GSTR-1 Table 13 by interface [ADM-REP-04; OPEN (08-C RA-10): may a tax invoice issued in error and never delivered be shown as cancelled in GSTR-1 Table 13 with no credit note?]: the nature-of-document text, the order of the rows, and what
// is checked. Error codes are in failures.test.ts.
import { describe, expect, it } from "vitest";
import { type DocsIssuedInput, docsRows, NATURE_OF_DOCUMENT } from "../../src/gst/index.ts";
import { SERIES, type Series } from "../../src/numbering.ts";

const input = (series: Series, over: Partial<DocsIssuedInput> = {}): DocsIssuedInput => ({
  series,
  from: `${series}/1`,
  to: `${series}/9`,
  total: 9,
  cancelled: 0,
  ...over,
});

describe("NATURE_OF_DOCUMENT", () => {
  it("covers exactly the GST series of the numbering table", () => {
    const gstSeries = (Object.keys(SERIES) as Series[]).filter((s) => SERIES[s].gst);
    expect(Object.keys(NATURE_OF_DOCUMENT).sort()).toEqual(gstSeries.sort());
  });
  it("uses the portal's wording; invoice and export are the same type (two rows)", () => {
    expect(NATURE_OF_DOCUMENT).toEqual({
      invoice: "Invoices for outward supply",
      export: "Invoices for outward supply",
      creditNote: "Credit Note",
      debitNote: "Debit Note",
      receiptVoucher: "Receipt voucher",
      refundVoucher: "Refund voucher",
    });
    expect(Object.isFrozen(NATURE_OF_DOCUMENT)).toBe(true);
  });
});

describe("docsRows", () => {
  it("gives one row per input, in the order of the series table, whatever the order of the inputs", () => {
    const r = docsRows([
      input("refundVoucher"),
      input("debitNote"),
      input("export"),
      input("receiptVoucher"),
      input("invoice"),
      input("creditNote"),
    ]);
    expect(r.ok && r.value.map((x) => x.series)).toEqual([
      "invoice",
      "export",
      "creditNote",
      "debitNote",
      "receiptVoucher",
      "refundVoucher",
    ]);
    expect(r.ok && r.value.map((x) => x.nature)).toEqual([
      "Invoices for outward supply",
      "Invoices for outward supply",
      "Credit Note",
      "Debit Note",
      "Receipt voucher",
      "Refund voucher",
    ]);
  });

  it("keeps two ranges of one series in the order given, and passes the figures through", () => {
    const r = docsRows([
      input("invoice", { from: "B1", to: "B5", total: 5, cancelled: 1 }),
      input("creditNote"),
      input("invoice", { from: "A1", to: "A9", total: 9, cancelled: 0 }),
    ]);
    expect(r.ok && r.value).toEqual([
      {
        series: "invoice",
        nature: "Invoices for outward supply",
        from: "B1",
        to: "B5",
        total: 5,
        cancelled: 1,
      },
      {
        series: "invoice",
        nature: "Invoices for outward supply",
        from: "A1",
        to: "A9",
        total: 9,
        cancelled: 0,
      },
      {
        series: "creditNote",
        nature: "Credit Note",
        from: "creditNote/1",
        to: "creditNote/9",
        total: 9,
        cancelled: 0,
      },
    ]);
  });

  it("leaves the net figure to the Offline Tool: a row has no net field", () => {
    const r = docsRows([input("invoice")]);
    expect(r.ok && Object.keys(r.value[0] as object).sort()).toEqual([
      "cancelled",
      "from",
      "nature",
      "series",
      "to",
      "total",
    ]);
  });

  it("reports every bad input, by its index", () => {
    const r = docsRows([input("proforma"), input("invoice", { total: -1 }), input("invoice")]);
    expect(r).toEqual({
      ok: false,
      errors: [
        { code: "series_not_gst", path: [0] },
        { code: "docs_counts_invalid", path: [1] },
      ],
    });
  });
});
