// The typed client for credit and debit notes (M5.3; apps/admin/worker/invoice-notes.ts, note-view.ts, invoice-issue.ts): the parts the invoice view
// gains (an issued tax or export invoice's notes, what can still be credited, the credit deadline, the refund due and the actions; a note's request,
// its IMS status and its invoice), and the create, save and IMS calls. A note is issued, requested, approved and deleted through the invoice calls
// (`invoicesApi`). Money is integer minor units in the invoice's currency; the screens only format it (through core), never work it out.
import { request } from "../api.ts";
import type { Supply } from "./documents-api.ts";
import type { InvoiceStatus, InvoiceView } from "./invoices-api.ts";

export type NoteKind = "credit" | "debit";
export type NoteMode = "lines" | "amount" | "full";
export type ImsStatus = "pending" | "accepted" | "rejected" | "not_applicable";

/** One issued note of an invoice (the notes section, 07-T §6). */
export type NoteRow = {
  id: string;
  /** Which kind of note (FX-4, A5 6); absent from an older API, when the list it came in says it. */
  type?: "credit_note" | "debit_note";
  number: string | null;
  issueDate: string | null;
  /** When it was issued (UTC ms; FX-4 early check L4); absent from an older API. */
  issuedAt?: number | null;
  totalMinor: number;
  status: InvoiceStatus | string;
  imsStatus: ImsStatus | null;
};

/** One line of an invoice and what can still be credited on it: before GST (`taxableLeftMinor`) and with it. `line` is the request's key (0-based). */
export type CreditableLine = {
  line: number;
  position: number;
  description: string;
  taxableLeftMinor: number;
  grossLeftMinor: number;
};

/**
 * The credit deadline of an invoice (s.34(2), Q32, Q33; Researched 2026-10-28, 08-C RA-03): `lastDay` is the last day a credit note may be dated.
 * Step 5 contract (T §4, review 2026-10-28): `deadlineWarnFrom` is the first day of the month before the deadline's month (1 October by default) and `adviseIssueBy` the last
 * day of that month (31 October), both ISO and never after the last allowed day when an annual return was filed earlier; optional, so an older API still loads (the warning
 * then follows `daysLeft`).
 *
 * rt1 T1 (Researched 2026-10-30, s.34(2) CGST Act; Rule 59(1)-(2) CGST Rules (IFF) (08-C RA-31, RA-03)): `lastDay` is now the end of the last return period
 * before `returnBy` (the cutoff, or the day before the annual return was filed), so `daysLeft` and `passed` count to `lastDay`; `deadlineWarnFrom` is the first day
 * of the month before `lastDay`'s month and `adviseIssueBy` is `lastDay` (R2). `returnBy` fills 07-ZD line 2's "{cutoff date}"; `period` says whether the note goes
 * in a monthly return (monthly GSTR-1, or the IFF for a registered client) or the quarterly GSTR-1 (07-ZD line 3). Both optional, so an older API still loads.
 */
export type CreditDeadlineView = {
  date: string;
  lastDay: string;
  basis: "cutoff" | "annual_return";
  supplyFy: string;
  filedOn: string | null;
  daysLeft: number | null;
  passed: boolean;
  deadlineWarnFrom?: string | null;
  adviseIssueBy?: string | null;
  returnBy?: string;
  period?: "month" | "quarter";
};

export type NoteAction = { allowed: boolean; reasons: string[] };

/** The request a note stores and seals (`header_extras.noteOf`). `takes[].line` is the invoice's line index (0-based). */
export type NoteOfView = {
  kind: NoteKind;
  parent: {
    id: string;
    type: "tax_invoice" | "export_invoice";
    fy: string;
    number: string;
    issueDate: string;
    supplyType: string;
    recipientStatus: string;
    placeOfSupplyCode: string;
    totalMinor: number;
    totalInrMinor: number | null;
    lut?: { fy: string; arn: string };
  };
  reason: { code: string; text: string };
  /** `taxMinor`: a "Tax charged too low" debit note's tax to add (builder's contract, Q35); its takes carry a taxable value of 0. */
  request: {
    mode: NoteMode;
    grossMinor?: number;
    takes: { line: number; taxableMinor: number }[];
    taxMinor?: number;
  };
};

/** What GET /invoices/:id adds in M5.3 (each null when it does not apply to the document). */
export type NoteParts = {
  notes: {
    credit: NoteRow[];
    debit: NoteRow[];
    drafts: { credit: string | null; debit: string | null };
    limit: number;
  } | null;
  creditable: { totalLeftMinor: number; lines: CreditableLine[] } | null;
  creditDeadline: CreditDeadlineView | null;
  refundDueMinor: number | null;
  actions: { credit: NoteAction; debit: NoteAction } | null;
  noteOf: NoteOfView | null;
  ims: { status: ImsStatus | null; canSet: boolean } | null;
  parentLink: {
    id: string;
    type: string;
    number: string | null;
    issueDate: string | null;
    status: string | null;
    creditedMinor: number | null;
    balanceMinor: number | null;
  } | null;
};

/** The invoice view with the M5.3 parts (optional, so an older API still loads). */
export type InvoiceWithNotes = InvoiceView & Partial<NoteParts>;

/** One computed line of a note as a create or a save answers it: `againstLine` is the invoice's line as the invoice numbers it (1-based). */
export type NotePreviewLine = {
  againstLine: number;
  line: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  lineTotalMinor: number;
};

export type NotePreview = {
  totals: {
    subtotalMinor: number;
    taxableMinor: number;
    cgstMinor: number;
    sgstMinor: number;
    igstMinor: number;
    roundOffMinor: number;
    totalMinor: number;
    totalInrMinor: number | null;
    words: string;
  };
  supply: Supply;
  lines: NotePreviewLine[];
};

/** What a create (201) or a save answers: the draft's version and content, and its worked-out preview. */
export type NoteSaved = {
  id: string;
  type: "credit_note" | "debit_note";
  updatedAt: number;
  contentSha256: string;
  totalMinor: number;
  request: NoteOfView["request"];
  preview: NotePreview;
};

export type Take = { line: number; taxableMinor: number };

export type CreditNoteIn = {
  expectedParentUpdatedAt: number;
  mode: NoteMode;
  lines?: Take[];
  grossMinor?: number;
  reasonCode: string;
  reasonText?: string;
};

export type DebitNoteIn = {
  expectedParentUpdatedAt: number;
  /** Every reason but "Tax charged too low" (which must send none). */
  lines?: Take[];
  reasonCode: string;
  reasonText?: string;
  /** Step 5 contract (Q35): "Tax charged too low" carries the total tax to add (> 0) and no lines; the taxable value is 0. */
  taxAmountMinor?: number;
};

/** `fields.note` of a PATCH: the whole request and reason again. */
export type NoteFieldsIn = {
  mode: NoteMode;
  lines?: Take[];
  grossMinor?: number;
  reasonCode: string;
  reasonText?: string;
  taxAmountMinor?: number;
};

const enc = encodeURIComponent;

export const notesApi = {
  /** POST /invoices/:id/credit-note (`:id` is the invoice): makes the draft and answers its preview. */
  createCredit: (invoiceId: string, body: CreditNoteIn) =>
    request<NoteSaved>(`/invoices/${enc(invoiceId)}/credit-note`, { body }),
  createDebit: (invoiceId: string, body: DebitNoteIn) =>
    request<NoteSaved>(`/invoices/${enc(invoiceId)}/debit-note`, { body }),
  /** PATCH /invoices/:id of a note draft: only its request and reason (its lines are derived). */
  save: (noteId: string, expectedUpdatedAt: number, note: NoteFieldsIn) =>
    request<NoteSaved & { ok: true }>(`/invoices/${enc(noteId)}`, {
      method: "PATCH",
      body: { expectedUpdatedAt, fields: { note } },
    }),
  /** POST /invoices/:id/ims-status (the Owner): the client's answer in the GST portal's IMS, once. */
  ims: (noteId: string, expectedUpdatedAt: number, status: "accepted" | "rejected") =>
    request<{ ok: true; imsStatus: ImsStatus; updatedAt: number }>(`/invoices/${enc(noteId)}/ims-status`, {
      body: { expectedUpdatedAt, status },
    }),
};
