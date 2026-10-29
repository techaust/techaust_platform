// What the client sees of an invoice, proforma, credit note or debit note (M5.4; POR-06, LD62; Researched 2026-10-28, s.34(3) CGST Act, Rule 53 (08-C RA-22)): a summary built from the FROZEN row of the document and its frozen lines, never from the
// R2 envelope (the full document is the PDF, which this Worker streams but never builds) and never importing `@techaust/pdf` (a 40 KB module the portal does not carry). The same function answers the
// emailed link (`/t/document`) and the signed-in routes (`/invoices/:id`), so the two can never disagree. Pure: no I/O.
import { gstEstimateOfHeaderExtras } from "@techaust/core/invoices";
import { formatMoney, money } from "@techaust/core/money";

/** The types a client can open: the whole invoice family except a receipt (M6). */
export const CLIENT_INVOICE_TYPES = [
  "proforma",
  "tax_invoice",
  "export_invoice",
  "credit_note",
  "debit_note",
] as const;
/** The statuses a client can open. An ALLOW-LIST (a status added to the schema later stays closed until decided: a test compares it with the schema): no draft, no pending approval, no void (LD62). */
export const CLIENT_INVOICE_STATUSES = [
  "issued",
  "partially_paid",
  "paid",
  "partially_credited",
  "credited",
  "converted",
] as const;

const quoted = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");
export const TYPES_SQL = quoted(CLIENT_INVOICE_TYPES);
export const STATUSES_SQL = quoted(CLIENT_INVOICE_STATUSES);

/** The columns of the frozen document the summary needs. */
export const SUMMARY_COLS = `d.id, d.type, d.status, d.number_display, d.issue_date, d.due_date, d.currency, d.subtotal_minor, d.discount_minor, d.taxable_minor, d.cgst_minor, d.sgst_minor, d.igst_minor,
    d.round_off_minor, d.total_minor, d.total_inr_minor, d.paid_minor, d.credited_minor, d.balance_minor, d.issuer, d.header_extras, d.pdf_r2_key, d.viewed_at,
    (SELECT p.number_display FROM documents p WHERE p.id = d.parent_id AND p.client_id = d.client_id) AS parent_number`;

/** The frozen lines of one document of one client. `?1` client, `?2` document. */
export const LINES_SQL =
  "SELECT l.position, l.description, l.detail, l.sac, l.qty_milli, l.unit, l.rate_minor, l.taxable_minor, l.gst_rate_bp, l.cgst_minor, l.sgst_minor, l.igst_minor, l.line_total_minor FROM document_lines l JOIN documents d ON d.id = l.document_id WHERE d.client_id = ?1 AND d.id = ?2 ORDER BY l.position LIMIT 101";

export type SummaryRow = {
  id: string;
  type: string;
  status: string;
  number_display: string | null;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  taxable_minor: number;
  cgst_minor: number;
  sgst_minor: number;
  igst_minor: number;
  round_off_minor: number;
  total_minor: number;
  total_inr_minor: number | null;
  paid_minor: number;
  credited_minor: number;
  balance_minor: number;
  issuer: string | null;
  /** The frozen header keys (LD37); read only for a proforma's GST estimate marker (FX-4, A5 5). */
  header_extras: string | null;
  pdf_r2_key: string | null;
  viewed_at: number | null;
  parent_number: string | null;
};
export type LineRow = {
  position: number;
  description: string;
  detail: string | null;
  sac: string | null;
  qty_milli: number;
  unit: string;
  rate_minor: number;
  taxable_minor: number;
  gst_rate_bp: number;
  cgst_minor: number;
  sgst_minor: number;
  igst_minor: number;
  line_total_minor: number;
};

type Bank = {
  accountName: string;
  accountNo: string;
  ifsc: string | null;
  bankName: string;
  branch: string | null;
};

type SwiftBank = {
  accountName: string;
  accountNo: string;
  swift: string;
  bankName: string;
  branch: string | null;
  bankAddress: string | null;
  intermediary: string | null;
  purposeCode: string | null;
};
/** The bank block a document prints: the INR account on an INR document, the SWIFT account on a USD one (early check finding 8). */
export type BankView = { inr: Bank | null } | { swift: SwiftBank | null };

/** The bank block as frozen into the issuer (null parts when none was saved, or the text is not JSON). Only the keys the page prints are returned. */
function bankOf(issuer: string | null, currency: string): BankView {
  const none: BankView = currency === "USD" ? { swift: null } : { inr: null };
  if (!issuer) return none;
  try {
    const bank = (JSON.parse(issuer) as { bank?: { inr?: Bank | null; swift?: SwiftBank | null } }).bank;
    if (currency === "USD") {
      const s = bank?.swift;
      return {
        swift: s
          ? {
              accountName: s.accountName,
              accountNo: s.accountNo,
              swift: s.swift,
              bankName: s.bankName,
              branch: s.branch ?? null,
              bankAddress: s.bankAddress ?? null,
              intermediary: s.intermediary ?? null,
              purposeCode: s.purposeCode ?? null,
            }
          : null,
      };
    }
    const b = bank?.inr;
    return {
      inr: b
        ? {
            accountName: b.accountName,
            accountNo: b.accountNo,
            ifsc: b.ifsc ?? null,
            bankName: b.bankName,
            branch: b.branch ?? null,
          }
        : null,
    };
  } catch {
    return none;
  }
}

const text = (minor: number, currency: string) =>
  formatMoney(money(minor, currency === "USD" ? "USD" : "INR"));

/** The list row: what a table needs. */
export function listItemOf(
  r: Pick<
    SummaryRow,
    | "id"
    | "type"
    | "status"
    | "number_display"
    | "issue_date"
    | "due_date"
    | "currency"
    | "total_minor"
    | "balance_minor"
  >,
) {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    numberDisplay: r.number_display,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    currency: r.currency,
    totalMinor: r.total_minor,
    balanceMinor: r.balance_minor,
    total: text(r.total_minor, r.currency),
    balance: text(r.balance_minor, r.currency),
  };
}

/**
 * The page's data. Money is given in minor units with the currency AND as text for the headline figures. A credit note has no due date and no balance (nothing is owed on it); a debit note's due date is its
 * own (Q30). `pdfReady` says whether the PDF exists yet (the download answers 409 `pdf_pending` until it does). No payment fields here: paying is M6 and M7.1.
 */
export function summaryOf(r: SummaryRow, lines: readonly LineRow[]) {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    numberDisplay: r.number_display,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    currency: r.currency,
    parentNumber: r.parent_number,
    /**
     * FX-4 (A5 5): a proforma sealed with the estimate marker (every one issued from FX-4 on) shows its tax heads as estimates; one sealed before shows
     * as it was. False on every other type (Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28): a proforma's GST is shown as an estimate).
     */
    gstEstimate: r.type === "proforma" && gstEstimateOfHeaderExtras(r.header_extras),
    totals: {
      subtotalMinor: r.subtotal_minor,
      discountMinor: r.discount_minor,
      taxableMinor: r.taxable_minor,
      cgstMinor: r.cgst_minor,
      sgstMinor: r.sgst_minor,
      igstMinor: r.igst_minor,
      roundOffMinor: r.round_off_minor,
      totalMinor: r.total_minor,
      totalInrMinor: r.total_inr_minor,
    },
    paidMinor: r.paid_minor,
    creditedMinor: r.credited_minor,
    balanceMinor: r.balance_minor,
    total: text(r.total_minor, r.currency),
    balance: text(r.balance_minor, r.currency),
    lines: lines.map((l) => ({
      position: l.position,
      description: l.description,
      detail: l.detail,
      sac: l.sac,
      qtyMilli: l.qty_milli,
      unit: l.unit,
      rateMinor: l.rate_minor,
      taxableMinor: l.taxable_minor,
      gstRateBp: l.gst_rate_bp,
      cgstMinor: l.cgst_minor,
      sgstMinor: l.sgst_minor,
      igstMinor: l.igst_minor,
      lineTotalMinor: l.line_total_minor,
    })),
    bank: r.type === "credit_note" ? null : bankOf(r.issuer, r.currency),
    pdfReady: r.pdf_r2_key !== null,
  };
}

export type InvoiceSummary = ReturnType<typeof summaryOf>;
