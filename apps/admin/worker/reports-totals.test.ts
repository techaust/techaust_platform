// The totals of every export equal the invoices' [ADM-REP-04, ADM-REP-06; M5.5b, LD71, LD72, LD73; VERIFY WITH CA/LEGAL]: 20 documents issued through the REAL routes (domestic and
// export invoices, credit and debit notes, a voided invoice, a proforma), read back through `GET /reports/registers`, and every report built from those rows in the gst core is held
// against an independent SUM over `documents` and against the others: GSTR-1, the HSN tables, the sales register, the output tax, the GSTR-3B summary and Table 13.
import { gstinCheckChar } from "@techaust/core";
import { fyOfDate, parseIsoDate } from "@techaust/core/dates";
import {
  docsIssuedInputs,
  docsRows,
  gstPeriod,
  gstr1Sections,
  gstr3bSummary,
  issuedRowsOf,
  outputTaxRows,
  type RegisterApiRow,
  type ReportMeta,
  SAC_DESCRIPTIONS,
  salesRegisterRows,
} from "@techaust/core/gst";
import { documentsIssuedSummary } from "@techaust/core/invoices";
import { beforeAll, describe, expect, it } from "vitest";
import { call, one, rows, sessionFor } from "./test-helpers.ts";
import { currentFy, lutOf, mkProforma, putSwiftBank, putTax } from "./test-invoice-types.ts";
import {
  issueInvoice,
  type J,
  json,
  mkInterClient,
  mkInvoiceClient,
  mkOverseasClient,
  putBank,
  putCompany,
  voidInvoice,
} from "./test-invoices.ts";
import { type Issued, issueCredit, issueDebit, mkIssuedInvoice, mkRegisteredClient } from "./test-notes.ts";

let n = 0;
const reg27 = () => {
  const first14 = `27AAAAA${String(++n).padStart(4, "0")}A1Z`;
  return mkInvoiceClient({
    gst_status: "registered",
    gstin: first14 + gstinCheckChar(first14),
    state_code: "27",
  });
};

const issued: Record<string, Issued> = {};
let voidedId = "";
const allRows: RegisterApiRow[] = [];
let meta: ReportMeta;
const today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
  const o = await sessionFor("owner", { stepUp: true });
  const mk = async (
    key: string,
    prices: number[],
    client?: () => Promise<{ clientId: string; contactId: string }>,
    fields?: Record<string, unknown>,
  ) => {
    issued[key] = await mkIssuedInvoice(o, {
      prices,
      ...(client ? { client } : {}),
      ...(fields ? { fields } : {}),
    });
  };
  // domestic, registered: intra-state (CGST + SGST) and inter-state (IGST)
  await mk("b2bA", [100_000], mkRegisteredClient);
  await mk("b2bB", [250_000, 80_000], mkRegisteredClient);
  await mk("b2bC", [333_333], mkRegisteredClient);
  await mk("b2bInterA", [500_000], reg27);
  await mk("b2bInterB", [120_000, 60_000], reg27);
  // unregistered: intra-state, and inter-state around the Rs 1,00,000 line (a total rounds to a whole rupee)
  await mk("b2csA", [75_000]);
  await mk("b2csB", [1_200_000]);
  await mk("b2csInterAt", [8_474_600], mkInterClient); // total Rs 1,00,000.00: not above the threshold
  await mk("b2clAbove", [8_474_700], mkInterClient); // total Rs 1,00,001.00: above it
  // exports: USD under LUT, and with IGST paid
  await mk("expA", [100_000], mkOverseasClient);
  await mk("expB", [250_000, 50_000], mkOverseasClient);
  await mk("expC", [10_000], mkOverseasClient);
  await mk("expIgst", [200_000], mkOverseasClient, { exportMode: "igst_paid" });
  // notes: credit notes against a b2b, an inter b2b, a b2cl, an export and a b2cs; debit notes against a b2b and a b2cs
  await issueCredit(o, issued.b2bA?.id as string, {
    mode: "lines",
    lines: [{ line: 0, taxableMinor: 10_000 }],
  });
  await issueCredit(o, issued.b2bInterA?.id as string, {
    mode: "lines",
    lines: [{ line: 0, taxableMinor: 20_000 }],
  });
  await issueCredit(o, issued.b2clAbove?.id as string, {
    mode: "lines",
    lines: [{ line: 0, taxableMinor: 1_000_00 }],
  });
  await issueCredit(o, issued.expB?.id as string, {
    mode: "lines",
    lines: [{ line: 0, taxableMinor: 5_000 }],
  });
  await issueCredit(o, issued.b2csA?.id as string, {
    mode: "lines",
    lines: [{ line: 0, taxableMinor: 5_000 }],
  });
  await issueDebit(o, issued.b2bB?.id as string, { lines: [{ line: 1, taxableMinor: 5_000 }] });
  await issueDebit(o, issued.b2csB?.id as string, { lines: [{ line: 0, taxableMinor: 7_000 }] });
  // a voided invoice (issued, then voided in the same month, never emailed) and a proforma (never in a return)
  const doomed = await mkIssuedInvoice(o, { prices: [55_000] });
  voidedId = doomed.id;
  expect((await voidInvoice(o, doomed.id)).status).toBe(200);
  const pf = await mkProforma(o, { price: 90_000 });
  expect((await issueInvoice(o, pf.id)).status).toBe(200);

  // read the whole financial year back through the route, page by page
  const fy = fyOfDate(parseIsoDate(today) as never);
  const q = `from=${fy.startYear}-04-01&to=${fy.startYear + 1}-03-31`;
  let after = "";
  for (let i = 0; i < 10; i++) {
    const res = await call(`/reports/registers?${q}${after}`, { cookie: o.cookie });
    expect(res.status, await res.clone().text()).toBe(200);
    const b = (await json(res)) as J;
    allRows.push(...b.rows);
    meta = b.meta;
    if (!b.next) break;
    after = `&after=${b.next}`;
  }
}, 600_000);

const period = (() => {
  const fy = fyOfDate(parseIsoDate(today) as never);
  const r = gstPeriod({ kind: "month", year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  if (!r.ok) throw new Error("period");
  return { month: r.value, fy };
})();

/** An independent sum over `documents` per head, by SQL on the columns (INR) and on `computed.inr` (USD): not the register query, not the core. */
async function oracle() {
  const r = await one<{ t: number; i: number; c: number; s: number; n: number }>(
    `SELECT sum(CASE type WHEN 'credit_note' THEN -1 ELSE 1 END * (CASE currency WHEN 'INR' THEN taxable_minor ELSE json_extract(computed, '$.inr.taxableMinor') END)) AS t,
            sum(CASE type WHEN 'credit_note' THEN -1 ELSE 1 END * (CASE currency WHEN 'INR' THEN igst_minor ELSE json_extract(computed, '$.inr.igstMinor') END)) AS i,
            sum(CASE type WHEN 'credit_note' THEN -1 ELSE 1 END * (CASE currency WHEN 'INR' THEN cgst_minor ELSE json_extract(computed, '$.inr.cgstMinor') END)) AS c,
            sum(CASE type WHEN 'credit_note' THEN -1 ELSE 1 END * (CASE currency WHEN 'INR' THEN sgst_minor ELSE json_extract(computed, '$.inr.sgstMinor') END)) AS s,
            count(*) AS n
       FROM documents WHERE frozen_at IS NOT NULL AND type IN ('tax_invoice', 'export_invoice', 'credit_note', 'debit_note') AND voided_at IS NULL AND issue_date BETWEEN ?1 AND ?2`,
    `${period.fy.startYear}-04-01`,
    `${period.fy.startYear + 1}-03-31`,
  );
  return { taxable: r?.t ?? 0, igst: r?.i ?? 0, cgst: r?.c ?? 0, sgst: r?.s ?? 0, count: r?.n ?? 0 };
}

const PARAMS = () => ({
  b2clThresholdInrMinor: meta.b2clThresholdInrMinor,
  supplierStateCode: meta.supplierStateCode,
  sacDescriptions: SAC_DESCRIPTIONS,
});

describe("the register, read back through the route", () => {
  it("holds at least 20 documents of the four kinds, a voided one, and no proforma", async () => {
    expect(allRows.length).toBeGreaterThanOrEqual(20);
    expect(new Set(allRows.map((r) => r.kind))).toEqual(
      new Set(["tax_invoice", "export_invoice", "credit_note", "debit_note"]),
    );
    expect(allRows.find((r) => r.id === voidedId)?.voided).toBe(true);
    expect(allRows.filter((r) => r.voided)).toHaveLength(1);
    const proformas = await rows<{ id: string }>("SELECT id FROM documents WHERE type = 'proforma'");
    for (const p of proformas) expect(allRows.some((r) => r.id === p.id)).toBe(false);
  });

  it("every row reaches GSTR-1 as it is: no error, in the quarter of today", async () => {
    const q = Math.floor(((Number(today.slice(5, 7)) + 8) % 12) / 3) + 1;
    const r = gstr1Sections(
      allRows,
      { kind: "quarter", fyStartYear: period.fy.startYear, quarter: q as 1 | 2 | 3 | 4 },
      PARAMS(),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.b2b.length).toBeGreaterThan(0);
    expect(r.value.exp.length).toBeGreaterThan(0);
    expect(r.value.cdnr.length + r.value.cdnur.length).toBeGreaterThan(0);
  });
});

describe("the totals equal the invoices' and each other's", () => {
  it("the signed register sum = an independent SUM over documents, per head", async () => {
    const o = await oracle();
    const sum = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    for (const r of allRows) {
      if (r.voided) continue;
      const sign = r.kind === "credit_note" ? -1 : 1;
      for (const x of r.rates) {
        sum.taxable += sign * x.taxableMinor;
        sum.igst += sign * x.igstMinor;
        sum.cgst += sign * x.cgstMinor;
        sum.sgst += sign * x.sgstMinor;
      }
    }
    expect(sum).toEqual({ taxable: o.taxable, igst: o.igst, cgst: o.cgst, sgst: o.sgst });
    expect(allRows.filter((r) => !r.voided)).toHaveLength(o.count);
  });

  it("GSTR-1 overall = HSN b2b + b2c = the sales register = the output tax = 3B 3.1(a) + 3.1(b); the proforma nowhere; the voided only in Table 13", async () => {
    const o = await oracle();
    const fyRange = {
      from: { year: period.fy.startYear, month: 4, day: 1 },
      to: { year: period.fy.startYear + 1, month: 3, day: 31 },
    };
    // one GSTR-1 for the whole range is not a return, so split by quarter and add the four: the quarters cover the year
    const heads = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    let hsn = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    let b3 = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    for (const quarter of [1, 2, 3, 4] as const) {
      const sections = gstr1Sections(
        allRows,
        { kind: "quarter", fyStartYear: period.fy.startYear, quarter },
        PARAMS(),
      );
      if (!sections.ok) throw new Error(JSON.stringify(sections.errors));
      const t = sections.value.totals;
      heads.taxable += t.overall.taxableMinor;
      heads.igst += t.overall.igstMinor;
      heads.cgst += t.overall.cgstMinor;
      heads.sgst += t.overall.sgstMinor;
      expect(t.hsnB2b.taxableMinor + t.hsnB2c.taxableMinor).toBe(t.overall.taxableMinor);
      expect(t.hsnB2b.igstMinor + t.hsnB2c.igstMinor).toBe(t.overall.igstMinor);
      hsn = {
        taxable: hsn.taxable + t.hsnB2b.taxableMinor + t.hsnB2c.taxableMinor,
        igst: hsn.igst + t.hsnB2b.igstMinor + t.hsnB2c.igstMinor,
        cgst: hsn.cgst + t.hsnB2b.cgstMinor + t.hsnB2c.cgstMinor,
        sgst: hsn.sgst + t.hsnB2b.sgstMinor + t.hsnB2c.sgstMinor,
      };
      const summary = gstr3bSummary(sections.value);
      if (!summary.ok) throw new Error(JSON.stringify(summary.errors));
      const a = summary.value.lines.find((l) => l.table === "3.1(a)");
      const b = summary.value.lines.find((l) => l.table === "3.1(b)");
      b3 = {
        taxable: b3.taxable + (a?.taxableMinor ?? 0) + (b?.taxableMinor ?? 0),
        igst: b3.igst + (a?.igstMinor ?? 0) + (b?.igstMinor ?? 0),
        cgst: b3.cgst + (a?.cgstMinor ?? 0) + (b?.cgstMinor ?? 0),
        sgst: b3.sgst + (a?.sgstMinor ?? 0) + (b?.sgstMinor ?? 0),
      };
    }
    const expected = { taxable: o.taxable, igst: o.igst, cgst: o.cgst, sgst: o.sgst };
    expect(heads).toEqual(expected);
    expect(hsn).toEqual(expected);
    expect(b3).toEqual(expected);
    const sales = salesRegisterRows(allRows, fyRange, meta.supplierStateCode);
    if (!sales.ok) throw new Error(JSON.stringify(sales.errors));
    const salesSum = sales.value
      .filter((r) => r.status === "issued")
      .reduce(
        (s, r) => ({
          taxable: s.taxable + r.taxableMinor,
          igst: s.igst + r.igstMinor,
          cgst: s.cgst + r.cgstMinor,
          sgst: s.sgst + r.sgstMinor,
        }),
        { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
      );
    expect(salesSum).toEqual(expected);
    const tax = outputTaxRows(allRows, fyRange, meta.supplierStateCode);
    if (!tax.ok) throw new Error(JSON.stringify(tax.errors));
    expect(
      tax.value.reduce(
        (s, r) => ({
          taxable: s.taxable + r.taxableMinor,
          igst: s.igst + r.igstMinor,
          cgst: s.cgst + r.cgstMinor,
          sgst: s.sgst + r.sgstMinor,
        }),
        { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
      ),
    ).toEqual(expected);
    // the voided invoice is a cancelled row of zeros in the sales register, in no other report
    expect(sales.value.filter((r) => r.status === "cancelled").map((r) => r.docId)).toEqual([voidedId]);
  });

  it("Table 13: documentsIssuedSummary -> adapter -> docsRows gives each series' from, to, total and cancelled", async () => {
    const summary = documentsIssuedSummary(issuedRowsOf(allRows));
    const inputs = docsIssuedInputs(summary);
    if (!inputs.ok) throw new Error(JSON.stringify(inputs.errors));
    const table = docsRows(inputs.value);
    if (!table.ok) throw new Error(JSON.stringify(table.errors));
    for (const row of table.value) {
      const mine = await rows<{ number: number; number_display: string; status: string }>(
        "SELECT number, number_display, status FROM documents WHERE series = ?1 AND frozen_at IS NOT NULL ORDER BY number",
        row.series,
      );
      expect(row.total).toBe(mine.length);
      expect(row.from).toBe(mine[0]?.number_display);
      expect(row.to).toBe(mine.at(-1)?.number_display);
      expect(row.cancelled).toBe(mine.filter((m) => m.status === "void").length);
    }
    expect(table.value.find((r) => r.series === "invoice")?.cancelled).toBe(1);
    expect(table.value.map((r) => r.series)).toEqual(["invoice", "export", "creditNote", "debitNote"]);
  });
});
