// What the client sees of an invoice, proforma, credit note or debit note (M5.4; POR-06, LD62; Researched 2026-10-28, s.34(3) CGST Act, Rule 53 (08-C RA-22)): a summary built from the FROZEN row of the document and its frozen lines, never from the
// R2 envelope (the full document is the PDF, which this Worker streams but never builds) and never importing `@techaust/pdf` (a 40 KB module the portal does not carry). The same function answers the
// emailed link (`/t/document`) and the signed-in routes (`/invoices/:id`), so the two can never disagree. Pure: no I/O.
import { gstEstimateOfHeaderExtras, issueDateOf, NOTES_MAX, noteOfFromStored } from "@techaust/core/invoices";
import { formatMoney, money } from "@techaust/core/money";
import { percentFromBp } from "@techaust/core/schedule-text";
import { withdrawnSql } from "@techaust/db/sql-rules";

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

/** A live document in an open status (the first half of `openOrWithdrawnSql`): the only state whose PDF is served. `d` is the documents alias. */
export const openSql = (d: string) => `(${d}.voided_at IS NULL AND ${d}.status IN (${STATUSES_SQL}))`;
/**
 * ADM-INV-10 (owner, 2026-10-30, docs/13; Q3 of runs/proforma-withdraw): what a client may open: a live document in an open status, OR a withdrawn proforma
 * (a void proforma that had reached the client, `withdrawnSql`), which the client sees as withdrawn: no amount due, no due date, no PDF, never the reason.
 * Any other void document stays closed. `d` is the documents alias. A row with status `void` that passes this is therefore always a withdrawn proforma.
 */
export const openOrWithdrawnSql = (d: string) => `(${openSql(d)} OR ${withdrawnSql(d)})`;

/** The 409 of a PDF asked for a withdrawn proforma (07-ZF 20, owner-approved 2026-10-31): the stored PDF still carries the bank details (Q3). */
export const PDF_WITHDRAWN = {
  code: "withdrawn",
  message: "The PDF isn't available because this payment request was withdrawn.",
} as const;

/**
 * A withdrawn proforma among the rows the predicate above let through: a void proforma (early check B2: the type is checked too, so a void row of
 * another type, which the predicate never lets through, could never read as withdrawn).
 */
export const isWithdrawnRow = (r: { type: string; status: string }) =>
  r.type === "proforma" && r.status === "void";
/** The types that list their credit notes (final sweep P2): a tax invoice and an export invoice. A proforma or a note has none of its own. */
export const CREDITABLE_TYPES = ["tax_invoice", "export_invoice"] as const;
const CREDITABLE_SQL = quoted(CREDITABLE_TYPES);

/**
 * The parent of the document, joined once (final sweep review 7): a primary-key seek bound to the same client, so another client's document is
 * never read. Every statement that selects `SUMMARY_COLS` (as `d`) adds this join (`p`).
 */
export const SUMMARY_PARENT_JOIN =
  "LEFT JOIN documents p ON p.id = d.parent_id AND p.client_id = d.client_id";

/**
 * The columns of the frozen document the summary needs (with `SUMMARY_PARENT_JOIN`). `parent_open_id` (final sweep P15): a credit or debit note's
 * invoice, only when one the client may open itself (frozen, not void, an open status and type: the list's own rule), so the page can link to it.
 */
export const SUMMARY_COLS = `d.id, d.type, d.status, d.number_display, d.issue_date, d.due_date, d.currency, d.subtotal_minor, d.discount_minor, d.taxable_minor, d.cgst_minor, d.sgst_minor, d.igst_minor,
    d.round_off_minor, d.total_minor, d.total_inr_minor, d.paid_minor, d.credited_minor, d.balance_minor, d.issuer, d.header_extras, d.pdf_r2_key, d.viewed_at, d.voided_at,
    p.number_display AS parent_number,
    CASE WHEN d.type IN ('credit_note', 'debit_note') AND p.frozen_at IS NOT NULL AND p.voided_at IS NULL AND p.status IN (${STATUSES_SQL})
       AND p.type IN (${TYPES_SQL}) THEN p.id END AS parent_open_id`;

/**
 * The client's first view of one document (`?1` client, `?2` document, `?3` now; a primary-key UPDATE, 0 rows after the first view). FX-5 (owner decision
 * 2026-10-30, docs/13; 08-C RA-10): a document the client has opened can't be voided (core `viewed_by_client`, the void route's `viewed_at IS NULL`, the
 * trigger `documents_viewed_no_void`), so the view is written BEFORE the answer, in the same batch as the read that serves it, and only on a document the
 * client may open: frozen, not void, an open status and type. A void that lands first leaves `viewed_at` NULL and the read a 404; a view that lands first
 * refuses the void. `viewed_at` may be filled in once after the freeze (the frozen-document trigger allows it).
 */
export const VIEW_SQL = `UPDATE documents SET viewed_at = ?3
   WHERE client_id = ?1 AND id = ?2 AND viewed_at IS NULL AND frozen_at IS NOT NULL AND voided_at IS NULL AND status IN (${STATUSES_SQL}) AND type IN (${TYPES_SQL})`;

/** The PDF routes' view: only a PDF that is delivered counts (a 409 `pdf_pending` gives the client nothing; lead, 2026-10-30). */
export const VIEW_PDF_SQL = `${VIEW_SQL} AND pdf_r2_key IS NOT NULL`;

/** The frozen lines of one document of one client, with each line's discount as typed (the PDF's Discount column, final sweep P3). `?1` client, `?2` document. */
export const LINES_SQL =
  "SELECT l.position, l.description, l.detail, l.sac, l.qty_milli, l.unit, l.rate_minor, l.discount_kind, l.discount_value, l.taxable_minor, l.gst_rate_bp, l.cgst_minor, l.sgst_minor, l.igst_minor, l.line_total_minor FROM document_lines l JOIN documents d ON d.id = l.document_id WHERE d.client_id = ?1 AND d.id = ?2 ORDER BY l.position LIMIT 101";

/**
 * The issued credit notes of the same client against one invoice (final sweep P2, the "Credited ({numbers})" row): only notes the client may open
 * itself (frozen, not void, an open status), in the order they were issued. `?1` client, `?2` the invoice. At most `NOTES_MAX` (20) can be issued
 * per invoice (LD51), so one page holds them all. The statement sits in a batch before the document's type is known, so the type is checked here
 * (final sweep review 6): the document is read first by its primary key, and only a tax or export invoice of this client that the client may open
 * reads any note (a proforma, a note or anything else reads none). The notes are served by `documents_parent`.
 */
export const CREDIT_NOTES_SQL = `SELECT n.id, n.number_display FROM documents i
   JOIN documents n INDEXED BY documents_parent ON n.parent_id = i.id
   WHERE i.id = ?2 AND i.client_id = ?1 AND i.type IN (${CREDITABLE_SQL}) AND i.frozen_at IS NOT NULL AND i.voided_at IS NULL AND i.status IN (${STATUSES_SQL})
     AND n.client_id = ?1 AND n.type = 'credit_note' AND n.frozen_at IS NOT NULL AND n.voided_at IS NULL AND n.status IN (${STATUSES_SQL})
   ORDER BY n.frozen_at, n.id LIMIT ${NOTES_MAX}`;

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
  /** ADM-INV-10: set only on a withdrawn proforma among the rows a client can read (`openOrWithdrawnSql`). */
  voided_at: number | null;
  parent_number: string | null;
  parent_open_id: string | null;
};
export type LineRow = {
  position: number;
  description: string;
  detail: string | null;
  sac: string | null;
  qty_milli: number;
  unit: string;
  rate_minor: number;
  /** "percent" (value in basis points) or "fixed" (value in minor units), both null when the line has no discount. */
  discount_kind: string | null;
  discount_value: number | null;
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

export type CreditNoteRow = { id: string; number_display: string | null };

const text = (minor: number, currency: string) =>
  formatMoney(money(minor, currency === "USD" ? "USD" : "INR"));

/** A line's discount as the PDF prints it (`packages/pdf/src/invoice-view.ts`): "10 %" for a percentage, the amount for a fixed one; null for none. */
function discountText(l: LineRow, currency: string): string | null {
  if (l.discount_value === null || !Number.isSafeInteger(l.discount_value) || l.discount_value < 0)
    return null;
  if (l.discount_kind === "percent") return `${percentFromBp(l.discount_value)} %`;
  if (l.discount_kind === "fixed") return text(l.discount_value, currency);
  return null;
}

/** A credit or debit note's reason as frozen in `header_extras.noteOf` (the code, and the words typed for it); null on other types or damaged data. */
function noteReasonOf(type: string, headerExtras: string | null): { code: string; text: string } | null {
  if ((type !== "credit_note" && type !== "debit_note") || !headerExtras) return null;
  let extras: unknown;
  try {
    extras = JSON.parse(headerExtras);
  } catch {
    return null;
  }
  const noteOf =
    typeof extras === "object" && extras !== null
      ? noteOfFromStored((extras as { noteOf?: unknown }).noteOf)
      : null;
  return noteOf ? { code: noteOf.reason.code, text: noteOf.reason.text } : null;
}

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
    | "voided_at"
  >,
) {
  // ADM-INV-10 (Q3): a withdrawn proforma lists as withdrawn, with no amount due and no due date.
  const withdrawn = isWithdrawnRow(r);
  return {
    id: r.id,
    type: r.type,
    status: withdrawn ? "withdrawn" : r.status,
    numberDisplay: r.number_display,
    issueDate: r.issue_date,
    dueDate: withdrawn ? null : r.due_date,
    currency: r.currency,
    totalMinor: r.total_minor,
    balanceMinor: withdrawn ? null : r.balance_minor,
    total: text(r.total_minor, r.currency),
    balance: withdrawn ? null : text(r.balance_minor, r.currency),
    /** ADM-INV-10: the IST day it was withdrawn (07-ZF 19's {date}); null unless withdrawn. */
    withdrawnOn: withdrawnOnOf(r),
  };
}

/** The IST day a withdrawn proforma was withdrawn; null on every other row. */
const withdrawnOnOf = (r: { type: string; status: string; voided_at: number | null }) =>
  isWithdrawnRow(r) && r.voided_at !== null ? issueDateOf(r.voided_at) : null;

/**
 * The page's data. Money is given in minor units with the currency AND as text for the headline figures. A credit note has no due date and no balance (nothing is owed on it); a debit note's due date is its
 * own (Q30). `pdfReady` says whether the PDF exists yet (the download answers 409 `pdf_pending` until it does). No payment fields here: paying is M6 and M7.1.
 */
export function summaryOf(r: SummaryRow, lines: readonly LineRow[], creditNotes: readonly CreditNoteRow[]) {
  const isInvoice = (CREDITABLE_TYPES as readonly string[]).includes(r.type);
  // ADM-INV-10 (owner, 2026-10-30, docs/13; Q3): a withdrawn proforma shows its details as withdrawn: no amount due, no due date, no PDF, never the reason.
  const withdrawn = isWithdrawnRow(r);
  return {
    id: r.id,
    type: r.type,
    status: withdrawn ? "withdrawn" : r.status,
    /** ADM-INV-10: the IST day it was withdrawn (07-ZF 19's {date}); null unless withdrawn. */
    withdrawnOn: withdrawnOnOf(r),
    numberDisplay: r.number_display,
    issueDate: r.issue_date,
    dueDate: withdrawn ? null : r.due_date,
    currency: r.currency,
    parentNumber: r.parent_number,
    /** Final sweep P15: a note's invoice, when the client may open it (same client, open status); null otherwise and on every other type. */
    parentId: r.parent_open_id,
    /** Final sweep P15: a credit or debit note's reason as frozen (`code` is one of core `NOTE_REASONS`; `text` the words typed); null on other types. */
    noteReason: noteReasonOf(r.type, r.header_extras),
    /** Final sweep P2: the issued credit notes against this invoice (the "Credited" row names them); empty on every other type. */
    creditNotes: isInvoice ? creditNotes.map((n) => ({ id: n.id, numberDisplay: n.number_display })) : [],
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
    balanceMinor: withdrawn ? null : r.balance_minor,
    total: text(r.total_minor, r.currency),
    balance: withdrawn ? null : text(r.balance_minor, r.currency),
    lines: lines.map((l) => ({
      position: l.position,
      description: l.description,
      detail: l.detail,
      sac: l.sac,
      qtyMilli: l.qty_milli,
      unit: l.unit,
      rateMinor: l.rate_minor,
      /** Final sweep P3: the line's discount as typed ("percent": basis points; "fixed": minor units) and as the PDF prints it. */
      discountKind: l.discount_value === null ? null : l.discount_kind,
      discountValue: l.discount_value,
      discount: discountText(l, r.currency),
      taxableMinor: l.taxable_minor,
      gstRateBp: l.gst_rate_bp,
      cgstMinor: l.cgst_minor,
      sgstMinor: l.sgst_minor,
      igstMinor: l.igst_minor,
      lineTotalMinor: l.line_total_minor,
    })),
    // ADM-INV-10 (Q3 A, early check A2): no bank block on a withdrawn proforma, so nothing invites a payment. M6/M7.1 handoff: any payment field added here is null for a withdrawn proforma.
    bank: r.type === "credit_note" || withdrawn ? null : bankOf(r.issuer, r.currency),
    /** ADM-INV-10: never on a withdrawn proforma (the PDF routes answer 409 `withdrawn`). */
    pdfReady: !withdrawn && r.pdf_r2_key !== null,
  };
}

export type InvoiceSummary = ReturnType<typeof summaryOf>;
