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
  issueBodyOf,
  issueInvoice,
  type J,
  json,
  mkInterClient,
  mkInvoice,
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
let inrExportId = "";
let advanceId = "";
let advanceProformaId = "";
const extraClients: string[] = [];
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
  // an export invoice in INR (Q8: the Owner confirms it at issue; a client abroad billed in rupees)
  const inrExport = await mkInvoice(o, {
    client: () =>
      mkInvoiceClient({
        country: "US",
        gst_status: "overseas",
        state_code: null,
        currency: "INR",
        billing_address: JSON.stringify({ line1: "1 Main St", city: "Austin", country: "US" }),
      }),
    price: 150_000,
  });
  const inrExportIssued = await issueInvoice(o, inrExport.id, {
    ...(await issueBodyOf(inrExport.id)),
    confirmInrExport: true,
  });
  expect(inrExportIssued.status, await inrExportIssued.clone().text()).toBe(200);
  inrExportId = inrExport.id;
  extraClients.push(inrExport.clientId);
  // the Q9 pair: a proforma and a tax invoice for the money received against it (the only payment M5 records)
  const pf2 = await mkProforma(o, { price: 200_000 });
  expect((await issueInvoice(o, pf2.id)).status).toBe(200);
  const stamp = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", pf2.id);
  const adv = await call(`/invoices/${pf2.id}/advance-invoice`, {
    cookie: o.cookie,
    body: {
      expectedProformaUpdatedAt: stamp?.updated_at,
      amountMinor: 59_000,
      receivedOn: today,
      reference: "UTR TOTALS 0001",
    },
  });
  expect(adv.status, await adv.clone().text()).toBe(201);
  advanceId = ((await json(adv)) as J).id;
  advanceProformaId = pf2.id;
  extraClients.push(pf2.clientId);

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

describe("the INR export, the Q9 advance invoice and the purpose code (M5, L5)", () => {
  it("an INR export is an export invoice in rupees under LUT, to place of supply 96, and reaches GSTR-1's export table", () => {
    const r = allRows.find((x) => x.id === inrExportId);
    expect(r).toMatchObject({
      kind: "export_invoice",
      currency: "INR",
      supplyType: "export_lut",
      placeOfSupplyCode: "96",
      recipient: { status: "overseas", countryCode: "US" },
      fxRateMicros: null,
    });
    expect(r?.totalInrMinor).toBe(r?.totalMinor);
    const q = Math.floor(((Number(today.slice(5, 7)) + 8) % 12) / 3) + 1;
    const sections = gstr1Sections(
      allRows,
      { kind: "quarter", fyStartYear: period.fy.startYear, quarter: q as 1 | 2 | 3 | 4 },
      PARAMS(),
    );
    if (!sections.ok) throw new Error(JSON.stringify(sections.errors));
    expect(sections.value.exp.some((e) => e.docId === inrExportId)).toBe(true);
  });

  it("the USD exports carry the SWIFT purpose code of the issued snapshot; the INR export and domestic invoices carry none (L5)", () => {
    const usd = allRows.filter((r) => r.currency === "USD");
    expect(usd.length).toBeGreaterThanOrEqual(4);
    for (const r of usd.filter((x) => x.kind === "export_invoice")) {
      expect(r.purposeCode, r.number).toBe("P0802");
    }
    expect(allRows.find((x) => x.id === inrExportId)?.purposeCode).toBeNull();
    expect(allRows.find((x) => x.id === issued.b2bA?.id)?.purposeCode).toBeNull();
  });

  it("the Q9 advance invoice is a paid tax invoice in the register; its proforma is not", async () => {
    const r = allRows.find((x) => x.id === advanceId);
    expect(r).toMatchObject({ kind: "tax_invoice", outstandingMinor: 0, voided: false });
    expect(allRows.some((x) => x.id === advanceProformaId)).toBe(false);
    const receipt = await rows<{ amount_minor: number; invoice_id: string }>(
      "SELECT amount_minor, invoice_id FROM advance_receipts WHERE proforma_id = ?1",
      advanceProformaId,
    );
    expect(receipt).toEqual([{ amount_minor: 59_000, invoice_id: advanceId }]);
  });
});

describe("the statement reconciles with the invoices, client by client (ADM-CLI-04)", () => {
  const fy = () => fyOfDate(parseIsoDate(today) as never);
  const statement = async (clientId: string, currency: string) => {
    const o = await sessionFor("owner");
    const q = `from=${fy().startYear}-04-01&to=${fy().startYear + 1}-03-31&currency=${currency}`;
    const res = await call(`/clients/${clientId}/statement?${q}`, { cookie: o.cookie });
    expect(res.status).toBe(200);
    return (await json(res)) as J;
  };
  const ledger = async (clientId: string, currency: string) =>
    (
      await one<{ s: number | null }>(
        `SELECT sum(balance_minor) AS s FROM documents WHERE client_id = ?1 AND currency = ?2 AND frozen_at IS NOT NULL
           AND type IN ('tax_invoice', 'export_invoice', 'debit_note') AND voided_at IS NULL AND status <> 'void' AND balance_minor > 0`,
        clientId,
        currency,
      )
    )?.s ?? 0;

  it("for every client of the register: the closing balance = the sum of the balances of its open debit documents, and opening + debits - credits = closing", async () => {
    const pairs = new Map<string, { clientId: string; currency: string }>();
    for (const r of allRows)
      pairs.set(`${r.clientId}|${r.currency}`, { clientId: r.clientId, currency: r.currency });
    expect(pairs.size).toBeGreaterThan(10);
    let withCredits = 0;
    for (const { clientId, currency } of pairs.values()) {
      const s = await statement(clientId, currency);
      expect(s.next, clientId).toBeNull();
      expect(s.range.closingMinor, `${clientId} ${currency}`).toBe(await ledger(clientId, currency));
      expect(s.range.openingMinor + s.range.debitMinor - s.range.creditMinor).toBe(s.range.closingMinor);
      expect(s.entries.at(-1)?.balanceMinor ?? 0).toBe(s.range.closingMinor);
      if (s.range.creditMinor > 0) withCredits++;
    }
    // the clients with credit notes and the Q9 client are in the set
    expect(withCredits).toBeGreaterThanOrEqual(5);
  });

  it("the Q9 invoice and its receipt net to zero on the statement; the proforma is absent; the INR export is a debit", async () => {
    const adv = allRows.find((x) => x.id === advanceId) as RegisterApiRow;
    const s = await statement(adv.clientId, "INR");
    expect(s.entries.map((e: J) => e.kind)).toEqual(["tax_invoice", "receipt"]);
    expect(s.entries.map((e: J) => e.number)).toEqual([adv.number, adv.number]);
    expect(s.entries[0].debitMinor).toBe(adv.totalMinor);
    expect(s.entries[1].creditMinor).toBe(59_000);
    expect(adv.totalMinor).toBe(59_000);
    expect(s.range.closingMinor).toBe(0);
    const exp = allRows.find((x) => x.id === inrExportId) as RegisterApiRow;
    const e = await statement(exp.clientId, "INR");
    expect(e.entries.map((x: J) => [x.kind, x.debitMinor])).toEqual([["export_invoice", exp.totalMinor]]);
    expect(e.range.closingMinor).toBe(exp.totalMinor);
  });
});
