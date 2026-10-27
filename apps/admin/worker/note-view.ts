// The note parts of an invoice's JSON (M5.3; the screens are the designer's): on an issued tax or export invoice its notes, what can still be credited, the credit
// deadline, the refund due and what the Owner and Staff may do; on a credit or debit note its request, its IMS status and the link to its invoice. Codes and numbers only:
// the words are 07-T's. Everything is read back from stored rows, never from a request.
import { daysBetween, parseIsoDate } from "@techaust/core/dates";
import {
  type CreditDeadline,
  creditAllowed,
  creditedSoFarOf,
  creditNoteDeadline,
  isNoteType,
  NOTES_MAX,
  type NoteOf,
  refundDueOf,
} from "@techaust/core/invoices";
import { decide, type Role } from "@techaust/core/permissions";
import { type DocumentBundle, headerExtrasOfRow, type TermsRef } from "@techaust/db/documents";
import { CREDITED_SO_FAR_SQL, CREDITED_TOTALS_SQL } from "@techaust/db/issue";
import type { InvoiceSettings } from "./invoice-model.ts";
import { isLiveParentStatus, isNoteParentType, type ParentCtx } from "./note-model.ts";

/** Keyed by the INVOICE's id (`?1`): what an issued tax or export invoice's view needs about its notes. At most 50 rows (20 issued of each kind and an open draft of each). */
export const NOTES_VIEW_READS = [
  CREDITED_SO_FAR_SQL,
  CREDITED_TOTALS_SQL,
  "SELECT n.id, n.type, n.number_display, n.issue_date, n.total_minor, n.status, n.ims_status, n.frozen_at FROM documents n WHERE n.parent_id = ?1 AND n.type IN ('credit_note', 'debit_note') ORDER BY n.created_at, n.id LIMIT 50",
] as const;

type NoteListRow = {
  id: string;
  type: string;
  number_display: string | null;
  issue_date: string | null;
  total_minor: number;
  status: string;
  ims_status: string | null;
  frozen_at: number | null;
};

const itemOf = (r: NoteListRow) => ({
  id: r.id,
  number: r.number_display,
  issueDate: r.issue_date,
  totalMinor: r.total_minor,
  status: r.status,
  imsStatus: r.ims_status,
});

export type InvoiceNotesView = NonNullable<ReturnType<typeof invoiceNotesView>>;

/**
 * The notes of an issued tax or export invoice. `results` are the results of `NOTES_VIEW_READS` for this invoice. `reasons` are codes (empty: allowed now): the role,
 * the invoice's state, an anonymised client, an open draft, the limit of 20, and for a credit note nothing left to credit or the deadline.
 */
export function invoiceNotesView(a: {
  bundle: DocumentBundle<TermsRef>;
  role: Role;
  settings: InvoiceSettings;
  clientGone: boolean;
  todayIso: string;
  results: readonly D1Result[];
}) {
  const d = a.bundle.document;
  const [creditedR, totalsR, notesR] = a.results;
  const computed = d.computed;
  if (!computed || d.frozen_at === null || !isNoteParentType(d.type)) return null;
  const rows = (notesR?.results ?? []) as NoteListRow[];
  const issued = rows.filter((r) => r.frozen_at !== null);
  const totals = (totalsR?.results[0] ?? { total: 0, totalInr: 0, count: 0 }) as {
    total: number;
    totalInr: number;
    count: number;
  };
  const credited = creditedSoFarOf(computed, (creditedR?.results ?? []) as never, totals);
  const extras = headerExtrasOfRow(d);
  const dl: CreditDeadline = creditNoteDeadline(
    {
      parentFy: d.fy ?? "",
      parentIssueDate: d.issue_date ?? "",
      advanceReceivedOn: extras.advance?.receivedOn ?? null,
      serviceCompletedOn: d.service_completed_on ?? null,
    },
    a.settings.tax.creditNoteCutoff,
    a.settings.tax.annualReturnsFiled,
  );
  const passed = !creditAllowed(a.todayIso, dl);
  const last = parseIsoDate(dl.lastDay);
  const today = parseIsoDate(a.todayIso);
  const daysLeft = last && today ? daysBetween(today, last) : null;
  const totalLeft = credited ? computed.totalMinor - credited.creditedTotalMinor : null;
  const lines = credited
    ? computed.lines.map((l, i) => {
        const c = credited.lines[i];
        const took = (c?.taxableMinor ?? 0) + (c?.cgstMinor ?? 0) + (c?.sgstMinor ?? 0) + (c?.igstMinor ?? 0);
        return {
          line: l.index,
          position: i + 1,
          description: a.bundle.lines[i]?.description ?? "",
          taxableLeftMinor: l.taxableMinor - (c?.taxableMinor ?? 0),
          grossLeftMinor: l.taxableMinor + l.cgstMinor + l.sgstMinor + l.igstMinor - took,
        };
      })
    : [];
  const draftOf = (type: string) => rows.find((r) => r.type === type && r.frozen_at === null)?.id ?? null;
  const count = (type: string) => issued.filter((r) => r.type === type).length;
  const reasonsFor = (kind: "credit" | "debit") => {
    const out: string[] = [];
    const type = kind === "credit" ? "credit_note" : "debit_note";
    if (decide(a.role, "invoices.draft") === "deny") out.push("forbidden");
    if (d.status === "void") out.push("parent_void");
    else if (!isLiveParentStatus(d.status))
      out.push(
        d.status === "credited"
          ? kind === "credit"
            ? "parent_fully_credited"
            : "debit_parent_fully_credited"
          : "parent_not_issued",
      );
    else if (totalLeft !== null && totalLeft <= 0)
      out.push(kind === "credit" ? "parent_fully_credited" : "debit_parent_fully_credited");
    if (a.clientGone) out.push("client_anonymised");
    if (draftOf(type) !== null) out.push("note_draft_exists");
    if (count(type) >= NOTES_MAX) out.push("notes_limit");
    if (kind === "credit" && passed) out.push("credit_deadline_passed");
    return out;
  };
  const credit = reasonsFor("credit");
  const debit = reasonsFor("debit");
  return {
    notes: {
      credit: issued.filter((r) => r.type === "credit_note").map(itemOf),
      debit: issued.filter((r) => r.type === "debit_note").map(itemOf),
      /** The open draft of each kind, if any (one per invoice and kind). */
      drafts: { credit: draftOf("credit_note"), debit: draftOf("debit_note") },
      limit: NOTES_MAX,
    },
    creditable: totalLeft === null ? null : { totalLeftMinor: totalLeft, lines },
    creditDeadline: {
      date: dl.date,
      lastDay: dl.lastDay,
      basis: dl.basis,
      supplyFy: dl.supplyFy,
      filedOn: dl.filedOn,
      daysLeft,
      passed,
    },
    /** What the client is owed back (paid and credited above the total): derived, display only (M6 records the refund). */
    refundDueMinor: refundDueOf(d.total_minor, d.paid_minor, d.credited_minor),
    actions: {
      credit: { allowed: credit.length === 0, reasons: credit },
      debit: { allowed: debit.length === 0, reasons: debit },
    },
  };
}

export type NoteViewPart = NonNullable<ReturnType<typeof noteView>>;

/** What a credit or debit note's JSON adds: the request as stored, its IMS status and the invoice it is against. */
export function noteView(a: {
  bundle: DocumentBundle<TermsRef>;
  role: Role;
  stored: NoteOf | null;
  parent: ParentCtx | null;
}) {
  const d = a.bundle.document;
  if (!isNoteType(d.type)) return null;
  const frozen = d.frozen_at !== null;
  const p = a.parent;
  return {
    noteOf: a.stored,
    ims: {
      status: d.ims_status ?? null,
      canSet:
        frozen &&
        d.type === "credit_note" &&
        d.ims_status === "pending" &&
        decide(a.role, "invoices.ims") !== "deny",
    },
    parentLink: p
      ? {
          id: p.row.id,
          type: p.row.type,
          number: p.row.number_display,
          issueDate: p.row.issue_date,
          status: p.row.status,
          creditedMinor: p.row.credited_minor,
          balanceMinor: p.row.balance_minor,
        }
      : a.stored
        ? {
            id: a.stored.parent.id,
            type: a.stored.parent.type,
            number: a.stored.parent.number,
            issueDate: a.stored.parent.issueDate,
            status: null as string | null,
            creditedMinor: null as number | null,
            balanceMinor: null as number | null,
          }
        : null,
  };
}
