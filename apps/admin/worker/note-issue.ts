// Issuing a credit or debit note (M5.3; ADM-INV-11, ADM-INV-03, -07, ADM-APR-01/02; LD38..LD54; VERIFY WITH CA/LEGAL): what `issueInvoice` does differently for a note.
// Everything is worked out AGAIN from the frozen invoice, the credit notes issued so far (summed by SQL) and the takes stored in the draft: the draft's own figures
// are only what the person saw, never what is frozen, so a hash that does not match is `content_changed` (another note issued meanwhile lands here). The freeze
// statement (`invoiceIssueStatements` with `note`) holds the same rules in SQL: the invoice is still the one that was read, a credit note fits inside what is left
// and inside the deadline, at most 20 notes of the kind; a credit note moves its invoice's ledger in the same batch.
import {
  dueDateOf,
  imsStatusAtIssue,
  issueDateOf,
  type NoteBlocker,
  type NoteOf,
  noteKindOf,
} from "@techaust/core/invoices";
import type { TaxIssue } from "@techaust/core/tax";
import type { DocumentBundle, InvoiceHeaderExtras, TermsRef } from "@techaust/db/documents";
import type { InvoiceIssuerSnapshot, NoteIssueArgs, RecipientSnapshot } from "@techaust/db/issue";
import { type Ctx, err, NOT_FOUND } from "./context.ts";
import {
  type BankRow,
  type InvoiceComputation,
  type InvoiceSettings,
  type InvoiceState,
  ISSUE_BLOCKED,
  issuerOf,
  taxContext,
  todayOf,
} from "./invoice-model.ts";
import {
  blockersOfNote,
  CREDIT_DEADLINE_PASSED,
  deadlineOf,
  isLiveParentStatus,
  NOTE_PARENT_READS,
  NOTES_LIMIT,
  noteComputation,
  noteLines,
  noteOfOf,
  noteState,
  PARENT_CHANGED,
  PARENT_FULLY_CREDITED,
  PARENT_NOT_ISSUED,
  PARENT_STATEMENTS,
  PARENT_VOID,
  type ParentCtx,
  parentCtxOf,
  recomputeNote,
  storedNoteOf,
} from "./note-model.ts";
import { type ClientRow, CONTENT_CHANGED } from "./quote-model.ts";

export { NOTE_PARENT_READS, PARENT_STATEMENTS };

type ContactFacts = {
  id: string;
  name: string;
  email: string;
  anonymised_at: number | null;
  updated_at: number;
};

/** What `issueInvoice` takes from the read for a note. */
export type NoteIssueInput = {
  bundle: DocumentBundle<TermsRef>;
  client: ClientRow;
  contact: ContactFacts | null;
  settings: InvoiceSettings;
  bank: readonly BankRow[];
  newestTerms: TermsRef | null;
  /** The results of `parentStatements(db, NOTE_PARENT_READS, id)` (after the base read's own). */
  parent: readonly D1Result[];
};

export type NotePrepared = {
  state: InvoiceState;
  computation: InvoiceComputation;
  noteOf: NoteOf;
  p: ParentCtx;
  blockers: NoteBlocker[];
  /** The facts frozen with it: the parent's identity and the note's own live contact; the issuer without a bank block on a credit note. */
  recipient: RecipientSnapshot;
  issuer: InvoiceIssuerSnapshot;
  terms: TermsRef | null;
  dueDate: string | null;
  extras: InvoiceHeaderExtras;
  imsStatus: "pending" | "not_applicable" | null;
  noteArgs: NoteIssueArgs;
  /** The parent as the batch will leave it (a credit note moves it; a debit note does not). */
  deadlineLastDay: string | null;
};

/** The recipient of a note (LD52): the invoice's frozen legal identity, plus the note's own live contact (guarded as in M5.1). */
export function noteRecipientOf(p: ParentCtx, contact: ContactFacts | null): RecipientSnapshot {
  const { email: _e, contactId: _i, contactName: _n, ...identity } = p.recipient;
  return {
    ...identity,
    ...(contact && contact.anonymised_at === null
      ? { email: contact.email, contactId: contact.id, contactName: contact.name }
      : {}),
  };
}

/**
 * Works a note out for its issue, or answers for it: 404 when the invoice is gone, `content_changed` when the draft's hash is not what the figures give now, `issue_blocked`
 * with the note blockers. The caller then seals and freezes. `now` is the one instant of the issue (the deadline is judged by its IST day).
 */
export async function prepareNoteIssue(
  c: Ctx,
  i: NoteIssueInput,
  now: number,
  expectedContentSha256: string | null,
  who: { id: string; name: string },
): Promise<Response | NotePrepared> {
  const d = i.bundle.document;
  const kind = noteKindOf(d.type as "credit_note" | "debit_note");
  const p = parentCtxOf(i.parent);
  if (!p) return err(c, NOT_FOUND, 404);
  const stored = storedNoteOf(d);
  if (!stored) return err(c, CONTENT_CHANGED, 409);
  const today = todayOf(now);
  const issueDate = issueDateOf(now);
  const taxCtx = taxContext(i.settings);
  const re = recomputeNote(kind, p, stored.request.takes, taxCtx, today);
  const noteOf = noteOfOf(kind, p, stored.reason, stored.request);
  const state = noteState({
    id: d.id,
    kind,
    p,
    client: i.client,
    contactId: d.contact_id,
    note: noteOf,
    lines: noteLines(p, stored.request.takes),
  });
  const computation = await noteComputation(state, re.computed, re.errors);
  if (
    computation.hash !== d.content_sha256 ||
    (expectedContentSha256 !== null && expectedContentSha256 !== d.content_sha256)
  )
    return err(c, CONTENT_CHANGED, 409);
  const dl = kind === "credit" ? deadlineOf(p, i.settings) : null;
  const blockers = blockersOfNote({
    kind,
    currency: d.currency,
    p,
    stored,
    re,
    settings: i.settings,
    bank: i.bank,
    issueDate,
  });
  if (blockers.length > 0 || !re.computed)
    return c.json(
      {
        error: { code: ISSUE_BLOCKED.code, message: ISSUE_BLOCKED.message },
        blockers: blockers.length > 0 ? blockers : [{ code: "computed_errors" }],
        request_id: c.var.rid,
      },
      409,
    );
  const settings = i.settings;
  return {
    state,
    computation,
    noteOf,
    p,
    blockers,
    recipient: noteRecipientOf(p, i.contact),
    // A credit note prints no bank block (nothing is owed on it), a debit note the invoice's: the same issuer block as an invoice of the currency.
    issuer: issuerOf(settings, kind === "credit" ? [] : i.bank, who, kind === "credit" ? "INR" : d.currency),
    // No footer notes on a credit note; a debit note pins the newest `invoice` terms (LD52).
    terms: kind === "credit" ? null : i.newestTerms,
    // Nothing is owed on a credit note: no due date. A debit note is due by the client's terms.
    dueDate:
      kind === "credit"
        ? null
        : dueDateOf(issueDate, i.client.payment_terms_days, settings.paymentTerms.dueDays),
    extras: { noteOf, ...(state.fx ? { fx: state.fx } : {}) },
    imsStatus: kind === "credit" ? imsStatusAtIssue(p.recipientStatus) : null,
    noteArgs: {
      kind,
      parentId: p.row.id,
      expectedParentUpdatedAt: p.row.updated_at,
      expectedParentCredited: p.row.credited_minor,
      deadline: dl ? { lastDay: dl.lastDay, filedOn: dl.filedOn } : null,
    },
    deadlineLastDay: dl?.lastDay ?? null,
  };
}

/**
 * The freeze refused and wrote nothing: which note rule it was, read once (after the checks every document has). `null`: none of the note rules, the caller's own
 * answer (a stale save) follows. Order: the invoice went void or is not live, it moved (`parent_changed`: another note issued, a payment), the deadline, the limit.
 */
export async function explainNote(
  c: Ctx,
  d: { kind: "credit" | "debit"; parentId: string },
  x: {
    expectedParentUpdatedAt: number;
    expectedParentCredited: number;
    deadline: { lastDay: string; filedOn: string | null } | null;
    issueDate: string;
  },
): Promise<Response | null> {
  const row = await c.env.DB.prepare(
    "SELECT p.status, p.updated_at, p.credited_minor, p.total_minor, (SELECT count(*) FROM documents n WHERE n.parent_id = p.id AND n.type = ?2 AND n.frozen_at IS NOT NULL) AS n FROM documents p WHERE p.id = ?1",
  )
    .bind(d.parentId, d.kind === "credit" ? "credit_note" : "debit_note")
    .first<{ status: string; updated_at: number; credited_minor: number; total_minor: number; n: number }>();
  if (!row) return err(c, PARENT_NOT_ISSUED, 409);
  if (row.status === "void") return err(c, PARENT_VOID, 409);
  if (!isLiveParentStatus(row.status))
    return err(
      c,
      d.kind === "credit" && row.status === "credited" ? PARENT_FULLY_CREDITED : PARENT_NOT_ISSUED,
      409,
    );
  if (
    x.deadline &&
    (x.issueDate > x.deadline.lastDay || (x.deadline.filedOn !== null && x.issueDate >= x.deadline.filedOn))
  )
    return c.json({ error: CREDIT_DEADLINE_PASSED, date: x.deadline.lastDay, request_id: c.var.rid }, 409);
  if (row.updated_at !== x.expectedParentUpdatedAt || row.credited_minor !== x.expectedParentCredited)
    return err(c, PARENT_CHANGED, 409);
  if (row.n >= 20) return err(c, NOTES_LIMIT, 409);
  return null;
}

export type { TaxIssue };
