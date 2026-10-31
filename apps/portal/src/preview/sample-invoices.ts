// DEV ONLY (sample-api.ts imports it; never in a build): sample invoices, payment requests and notes for the M5.4 screens, so the REAL routes can be seen
// in every state without a database. SAMPLE DATA ONLY (the repo is public): made-up numbers, "(sample)" names, made-up bank details. The figures are
// written out by hand as fixtures, each set consistent with itself (taxable + GST = total); nothing here is a real invoice.
import type { InvoiceItem, InvoiceLine, InvoiceSummary } from "../api.ts";
import { moneyText } from "../lib/invoices.ts";

const DAY = 86_400_000;
/** A day `n` days from today, as the API writes it (IST). */
const day = (n: number) => new Date(Date.now() + n * DAY + 19_800_000).toISOString().slice(0, 10);

const INR_BANK = {
  inr: {
    accountName: "TecHaust Technologies (sample)",
    accountNo: "000000000000 (sample)",
    ifsc: "SMPL0000001",
    bankName: "Sample Bank",
    branch: "Balurghat (sample)",
  },
};
const SWIFT_BANK = {
  swift: {
    accountName: "TecHaust Technologies (sample)",
    accountNo: "000000000000 (sample)",
    swift: "SMPLINBBXXX",
    bankName: "Sample Bank",
    branch: "Balurghat (sample)",
    bankAddress: "1 Sample Road, Balurghat, West Bengal, India (sample)",
    intermediary: null,
    purposeCode: "P0802",
  },
};

const line = (
  position: number,
  description: string,
  qtyMilli: number,
  unit: string,
  rateMinor: number,
  taxableMinor: number,
  gst: { cgst?: number; sgst?: number; igst?: number; rateBp: number },
  detail: string | null = null,
): InvoiceLine => ({
  position,
  description,
  detail,
  sac: "998314",
  qtyMilli,
  unit,
  rateMinor,
  taxableMinor,
  gstRateBp: gst.rateBp,
  cgstMinor: gst.cgst ?? 0,
  sgstMinor: gst.sgst ?? 0,
  igstMinor: gst.igst ?? 0,
  lineTotalMinor: taxableMinor + (gst.cgst ?? 0) + (gst.sgst ?? 0) + (gst.igst ?? 0),
});

type Base = Omit<InvoiceSummary, "total" | "balance">;
const finish = (b: Base): InvoiceSummary => ({
  ...b,
  total: moneyText(b.totals.totalMinor, b.currency),
  balance: b.balanceMinor === null ? null : moneyText(b.balanceMinor, b.currency),
});
const totals = (t: Partial<InvoiceSummary["totals"]> & { taxableMinor: number; totalMinor: number }) => ({
  subtotalMinor: t.taxableMinor,
  discountMinor: 0,
  cgstMinor: 0,
  sgstMinor: 0,
  igstMinor: 0,
  roundOffMinor: 0,
  totalInrMinor: null,
  ...t,
});

export const SAMPLE_INVOICES: InvoiceSummary[] = [
  finish({
    id: "inv-due",
    type: "tax_invoice",
    status: "issued",
    numberDisplay: "TH/INV/2627/0007",
    issueDate: day(-2),
    dueDate: day(5),
    currency: "INR",
    parentNumber: null,
    totals: totals({
      taxableMinor: 2_000_000,
      cgstMinor: 180_000,
      sgstMinor: 180_000,
      totalMinor: 2_360_000,
    }),
    paidMinor: 0,
    creditedMinor: 0,
    balanceMinor: 2_360_000,
    lines: [
      line(1, "Workflow automation, phase 1 (sample)", 1000, "project", 2_000_000, 2_000_000, {
        cgst: 180_000,
        sgst: 180_000,
        rateBp: 1800,
      }),
    ],
    bank: INR_BANK,
    pdfReady: true,
  }),
  finish({
    id: "inv-overdue",
    type: "tax_invoice",
    status: "partially_paid",
    numberDisplay: "TH/INV/2627/0004",
    issueDate: day(-24),
    dueDate: day(-17),
    currency: "INR",
    parentNumber: null,
    totals: totals({
      subtotalMinor: 5_000_000,
      discountMinor: 500_000,
      taxableMinor: 4_500_000,
      igstMinor: 810_000,
      totalMinor: 5_310_000,
    }),
    paidMinor: 2_000_000,
    creditedMinor: 0,
    // M6.1 (T8): the client deducted TDS, shown in 07-ZH line 18's words (sample figures, as the server sends them)
    tdsMinor: 450_000,
    tdsRow: { label: "TDS deducted by you", amount: moneyText(450_000, "INR") },
    balanceMinor: 2_860_000,
    // final sweep P3: one line with a percent discount, one with an amount, as the PDF prints them
    lines: [
      {
        ...line(1, "Discovery workshop (sample)", 2000, "day", 1_000_000, 1_800_000, {
          igst: 324_000,
          rateBp: 1800,
        }),
        discountKind: "percent",
        discountValue: 1000,
        discount: "10 %",
      },
      {
        ...line(2, "Order portal build (sample)", 1000, "project", 3_000_000, 2_700_000, {
          igst: 486_000,
          rateBp: 1800,
        }),
        discountKind: "fixed",
        discountValue: 300_000,
        discount: moneyText(300_000, "INR"),
      },
    ],
    bank: INR_BANK,
    pdfReady: true,
  }),
  finish({
    id: "pro-due",
    type: "proforma",
    status: "issued",
    numberDisplay: "TH/PRO/2627/0002",
    issueDate: day(-1),
    dueDate: day(6),
    currency: "INR",
    parentNumber: null,
    // FX-4 (A5 5): issued with the estimate marker, so its tax heads read "CGST (estimate)"
    gstEstimate: true,
    totals: totals({ taxableMinor: 1_000_000, cgstMinor: 90_000, sgstMinor: 90_000, totalMinor: 1_180_000 }),
    paidMinor: 0,
    creditedMinor: 0,
    balanceMinor: 1_180_000,
    lines: [
      line(1, "Advance for the reporting dashboard (sample)", 1000, "project", 1_000_000, 1_000_000, {
        cgst: 90_000,
        sgst: 90_000,
        rateBp: 1800,
      }),
    ],
    bank: INR_BANK,
    pdfReady: false,
  }),
  finish({
    id: "dn-due",
    type: "debit_note",
    status: "issued",
    numberDisplay: "TH/DN/2627/0001",
    issueDate: day(-3),
    dueDate: day(4),
    currency: "INR",
    parentNumber: "TH/INV/2627/0004",
    // final sweep P15: the note's invoice (openable, so linked when signed in) and its frozen reason with words typed for it
    parentId: "inv-overdue",
    noteReason: { code: "price_correction", text: "The rate on line 2 was typed lower than agreed (sample)" },
    totals: totals({ taxableMinor: 100_000, igstMinor: 18_000, totalMinor: 118_000 }),
    paidMinor: 0,
    creditedMinor: 0,
    balanceMinor: 118_000,
    lines: [
      line(1, "Price correction on line 2 (sample)", 1000, "item", 100_000, 100_000, {
        igst: 18_000,
        rateBp: 1800,
      }),
    ],
    bank: INR_BANK,
    pdfReady: true,
  }),
  finish({
    id: "cn-1",
    type: "credit_note",
    status: "issued",
    numberDisplay: "TH/CN/2627/0001",
    issueDate: day(-9),
    dueDate: null,
    currency: "INR",
    parentNumber: "TH/INV/2627/0003",
    parentId: "inv-paid",
    noteReason: { code: "service_deficient", text: "" },
    totals: totals({ taxableMinor: 200_000, cgstMinor: 18_000, sgstMinor: 18_000, totalMinor: 236_000 }),
    paidMinor: 0,
    creditedMinor: 0,
    balanceMinor: 0,
    lines: [
      line(1, "Credit for two reports delivered late (sample)", 1000, "item", 200_000, 200_000, {
        cgst: 18_000,
        sgst: 18_000,
        rateBp: 1800,
      }),
    ],
    bank: null,
    pdfReady: true,
  }),
  finish({
    id: "inv-paid",
    type: "tax_invoice",
    status: "paid",
    numberDisplay: "TH/INV/2627/0003",
    issueDate: day(-40),
    dueDate: day(-33),
    currency: "INR",
    parentNumber: null,
    totals: totals({
      taxableMinor: 1_200_000,
      cgstMinor: 108_000,
      sgstMinor: 108_000,
      totalMinor: 1_416_000,
    }),
    paidMinor: 1_180_000,
    creditedMinor: 236_000,
    // final sweep P2: the "Credited ({numbers})" row
    creditNotes: [{ id: "cn-1", numberDisplay: "TH/CN/2627/0001" }],
    balanceMinor: 0,
    lines: [
      line(1, "Monthly care plan, Essential (sample)", 1000, "month", 1_200_000, 1_200_000, {
        cgst: 108_000,
        sgst: 108_000,
        rateBp: 1800,
      }),
    ],
    bank: INR_BANK,
    pdfReady: true,
  }),
  finish({
    id: "exp-usd",
    type: "export_invoice",
    status: "issued",
    numberDisplay: "TH/EXP/2627/0001",
    issueDate: day(-4),
    dueDate: day(10),
    currency: "USD",
    parentNumber: null,
    totals: totals({ taxableMinor: 240_000, totalMinor: 240_000, totalInrMinor: 20_040_000 }),
    paidMinor: 0,
    creditedMinor: 0,
    balanceMinor: 240_000,
    lines: [
      line(1, "Shopify and Zoho sync, build (sample)", 1000, "project", 180_000, 180_000, { rateBp: 0 }),
      line(2, "Support, first month (sample)", 1000, "month", 60_000, 60_000, { rateBp: 0 }),
    ],
    bank: SWIFT_BANK,
    pdfReady: true,
  }),
  finish({
    id: "inv-long",
    type: "tax_invoice",
    status: "issued",
    numberDisplay: "TH/INV/2627/0010",
    issueDate: day(0),
    dueDate: day(7),
    currency: "INR",
    parentNumber: null,
    totals: totals({
      taxableMinor: 9_600_000,
      cgstMinor: 864_000,
      sgstMinor: 864_000,
      totalMinor: 11_328_000,
    }),
    paidMinor: 0,
    creditedMinor: 0,
    balanceMinor: 11_328_000,
    lines: Array.from({ length: 12 }, (_, i) =>
      line(
        i + 1,
        i === 0
          ? "Integration of the dealer ordering portal with the existing ERP, including the price-list import, the stock sync and the order export (sample)"
          : `Sample work item ${i + 1} (sample)`,
        1000,
        "item",
        800_000,
        800_000,
        { cgst: 72_000, sgst: 72_000, rateBp: 1800 },
        i === 0
          ? "A long detail line under the description, to show how it wraps on a phone (sample)."
          : null,
      ),
    ),
    bank: INR_BANK,
    pdfReady: true,
  }),
  finish({
    // FX-4 (A5 5): a payment request sealed before FX-4 has no estimate marker, so its tax head stays plain "IGST" (as its PDF)
    id: "pro-old",
    type: "proforma",
    status: "issued",
    numberDisplay: "TH/PRO/2627/0001",
    issueDate: day(-20),
    dueDate: day(10),
    currency: "INR",
    parentNumber: null,
    gstEstimate: false,
    totals: totals({ taxableMinor: 500_000, igstMinor: 90_000, totalMinor: 590_000 }),
    paidMinor: 0,
    creditedMinor: 0,
    balanceMinor: 590_000,
    lines: [
      line(1, "Advance for the site audit (sample)", 1000, "project", 500_000, 500_000, {
        igst: 90_000,
        rateBp: 1800,
      }),
    ],
    bank: INR_BANK,
    pdfReady: true,
  }),
  finish({
    // ADM-INV-10 (07-ZF 18, 19): a payment request withdrawn after the client received it: no amount due, no due date, no PDF, no bank block, and
    // never the staff's reason (the API sends none of them).
    id: "pro-withdrawn",
    type: "proforma",
    status: "withdrawn",
    withdrawnOn: day(-2),
    numberDisplay: "TH/PRO/2627/0003",
    issueDate: day(-9),
    dueDate: null,
    currency: "INR",
    parentNumber: null,
    gstEstimate: true,
    totals: totals({
      taxableMinor: 9_000_000,
      cgstMinor: 810_000,
      sgstMinor: 810_000,
      totalMinor: 10_620_000,
    }),
    paidMinor: 0,
    creditedMinor: 0,
    balanceMinor: null,
    lines: [
      line(1, "Advance for the booking form (sample)", 1000, "project", 9_000_000, 9_000_000, {
        cgst: 810_000,
        sgst: 810_000,
        rateBp: 1800,
      }),
    ],
    bank: null,
    pdfReady: false,
  }),
];

const itemOf = (d: InvoiceSummary): InvoiceItem => ({
  id: d.id,
  type: d.type,
  status: d.status,
  numberDisplay: d.numberDisplay,
  issueDate: d.issueDate,
  dueDate: d.dueDate,
  currency: d.currency,
  totalMinor: d.totals.totalMinor,
  balanceMinor: d.balanceMinor,
  total: d.total,
  balance: d.balance,
  withdrawnOn: d.withdrawnOn ?? null,
});

/** The invoice link tokens of the sample: 43 characters; the first letter picks the case. */
export const SAMPLE_INVOICE_TOKENS = {
  invoice: `I${"a".repeat(42)}`,
  proforma: `P${"a".repeat(42)}`,
  credit: `C${"a".repeat(42)}`,
  withdrawn: `W${"a".repeat(42)}`,
  ended: `Z${"a".repeat(42)}`,
};

const ofToken = (t: string) =>
  t.startsWith("I")
    ? SAMPLE_INVOICES[0]
    : t.startsWith("P")
      ? SAMPLE_INVOICES[2]
      : t.startsWith("C")
        ? SAMPLE_INVOICES[4]
        : t.startsWith("W")
          ? SAMPLE_INVOICES.find((x) => x.id === "pro-withdrawn")
          : undefined;

/**
 * Review L3: a payment request withdrawn while its page is open. It reads as due until its PDF is asked for; that answer is 409 `withdrawn`, and from
 * then on (until the tab reloads) the page's reload finds it withdrawn. Not in the list.
 */
let raceWithdrawn = false;
const raceDoc = (): InvoiceSummary => {
  const base = SAMPLE_INVOICES.find((x) => x.id === "pro-withdrawn") as InvoiceSummary;
  return raceWithdrawn
    ? { ...base, id: "pro-race", numberDisplay: "TH/PRO/2627/0004" }
    : finish({
        ...base,
        id: "pro-race",
        numberDisplay: "TH/PRO/2627/0004",
        status: "issued",
        withdrawnOn: null,
        dueDate: day(5),
        balanceMinor: base.totals.totalMinor,
        bank: INR_BANK,
        pdfReady: true,
      });
};

type Json = (status: number, body: unknown) => Response;
type Err = (status: number, code: string) => Response;

/** The invoice part of the sample API; null when the path is not an invoice path. */
export function answerInvoices(
  path: string,
  method: string,
  body: Record<string, unknown>,
  empty: boolean,
  h: { json: Json; error: Err; pdf: (name: string) => Response },
): Response | null {
  const file = (d: InvoiceSummary) => `${(d.numberDisplay ?? "invoice").replaceAll("/", "-")}.pdf`;
  if (method === "GET" && /^\/invoices(\?|$)/.test(path))
    return h.json(200, { invoices: empty ? [] : SAMPLE_INVOICES.map(itemOf), next: null });
  const m = /^\/invoices\/([^/?]+)(\/pdf)?$/.exec(path);
  if (m && m[1] === "pro-race" && !empty) {
    if (!m[2]) return h.json(200, { document: raceDoc() });
    raceWithdrawn = true;
    return h.error(409, "withdrawn");
  }
  if (m) {
    const d = SAMPLE_INVOICES.find((x) => x.id === decodeURIComponent(m[1] ?? ""));
    if (!d || empty) return h.error(404, "not_found");
    if (m[2])
      return d.status === "withdrawn"
        ? h.error(409, "withdrawn")
        : d.pdfReady
          ? h.pdf(file(d))
          : h.error(409, "pdf_pending");
    return h.json(200, { document: d });
  }
  const t = /^\/t\/document(\/pdf)?$/.exec(path);
  if (t) {
    const d = ofToken(String(body.token ?? ""));
    if (!d) return h.error(404, "not_found");
    if (t[1])
      return d.status === "withdrawn"
        ? h.error(409, "withdrawn")
        : d.pdfReady
          ? h.pdf(file(d))
          : h.error(409, "pdf_pending");
    return h.json(200, { document: d });
  }
  return null;
}
