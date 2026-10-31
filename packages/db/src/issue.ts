// The send/issue batches of docs/05 §5.4 as statements for the caller's own `db.batch()`: `sendStatements` (proposals and estimates, M4.3) and
// `invoiceIssueStatements` (M5.1, LD3: one issue-batch module with shared helpers; the SQL of `sendStatements` is a stored contract, a
// snapshot test proves it did not move). Subpath export (`@techaust/db/issue`) so a Worker importing it doesn't pull in the Drizzle schema.
//
// The batch is built in two parts around the request's audit row (`mutate` in the admin Worker writes it between them):
//   main      = [ INSERT INTO issue_guard                          aborts unless the document is an unfrozen draft,
//                 (version 1 only) the counter row, then the take    the counter moves forward,
//                 the FREEZE UPDATE, last ]                          the audit row follows it with `changes() > 0`;
//   postAudit = [ INSERT INTO issue_result, UNGUARDED               aborts the whole batch unless the document was just frozen,
//                 UPDATE earlier versions to 'revised' ]            the counter's increment rolls back with it.
// `issue_result` must NOT carry the audit guard: a guarded insert would write nothing when the freeze matched no row, the batch would
// succeed, and a number would have been burned. Unguarded, a stale or refused send aborts as a whole (counter, lead, audit: nothing).
// A later version (version > 1) of a proposal or estimate takes no number: it copies series, FY, number and display from version 1.
import { INVOICE_FLOW_TYPES, NOTE_PARENT_LIVE_STATUSES, REMINDER_TYPES } from "@techaust/core/invoices";
import type {
  InvoiceBankBlock,
  InvoiceIssuerSnapshot,
  InvoiceSwiftBlock,
  IssuerSnapshot,
  RecipientSnapshot,
} from "./schema/documents.ts";
import {
  DISCOUNT_AFTER_SALE_FROM_SQL,
  fyTokenOfDateSql,
  LUT_FOR_FY_SQL,
  signedIssuerSql,
  taxOnlyNoteExactSql,
} from "./sql-rules.ts";

/** The pure SQL of the rules the triggers share (`sql-rules.ts`, no D1 types, so the Node-only trigger script can read it). */
export {
  DISCOUNT_AFTER_SALE_FROM_SQL,
  fyTokenOfDateSql,
  LUT_FOR_FY_SQL,
  signedIssuerSql,
  taxOnlyNoteExactSql,
} from "./sql-rules.ts";
/** The two frozen blocks of a sent document, for a caller that builds them (type only: nothing of the schema reaches a Worker bundle). */
export type { InvoiceBankBlock, InvoiceIssuerSnapshot, InvoiceSwiftBlock, IssuerSnapshot, RecipientSnapshot };

export type SendArgs = {
  documentId: string;
  /** The numbering series of the document type (core `SERIES_OF`). */
  series: string;
  /** The FY token the number is taken in ("2627"); ignored for a later version (it keeps its first version's). */
  fy: string;
  /** `sqlPrintfPattern(format)` of the settings' numbering format for the series. */
  pattern: string;
  argOrder: readonly ["fy", "n"] | readonly ["n", "fy"];
  /**
   * FX-1 (A0 6): `maxNumber(format)` of the series. A first version whose number would pass it refuses the send (the caller answers 409 `series_full`), and
   * the counter does not move: the same guard as the invoice freeze's. Written into the statement as an integer literal (it is not input: a whole number
   * from the format's padding), so the placeholders of the stored statement keep their numbers. A later version takes no number and ignores it.
   */
  maxNumber: number;
  /** Version 1 (or any non-versioned document) takes the next number; a later version copies its first version's. */
  isFirstVersion: boolean;
  groupId: string;
  version: number;
  now: number;
  /** ISO date (IST day of the send). */
  issueDate: string;
  validUntil: string;
  recipient: RecipientSnapshot;
  issuer: IssuerSnapshot;
  computedJson: string;
  snapshotSha256: string;
  issuedBy: string;
  expected: {
    /** The `updated_at` the send was prepared from. */
    updatedAt: number;
    contentSha256: string;
    /** The `version` of the `numbering` settings row read before the batch (null: no such row). A change in between refuses the send. */
    numberingVersion: number | null;
    /** The version needs the owner's approval of this exact content: an approved `discount` approval for the current hash must exist. */
    approvalNeeded: boolean;
  };
  /**
   * M4.5: who receives the offer. The freeze UPDATE is guarded on every contact still being valid (portal access on, not anonymised, this
   * client's), so a recipient who lost access between the read and the batch refuses the WHOLE send (no number is taken); the
   * `document_sends` rows are written after the freeze, in the same batch, guarded on the freeze having happened. `attachPdf` null: the client's setting.
   */
  sends?: { rows: readonly { id: string; contactId: string }[]; attachPdf: boolean | null };
};

export type SendStatements = {
  main: D1PreparedStatement[];
  /** Goes after the audit row: `issue_result` (unguarded) and the 'revised' move of the earlier versions. */
  postAudit: D1PreparedStatement[];
};

// ---- the pieces both batches share (the text of each statement is the same in every batch that uses it) ----------------------------------

/** `INSERT INTO issue_guard`: aborts unless the document is an unfrozen draft. */
const guardStatement = (db: D1Database, documentId: string) =>
  db.prepare("INSERT INTO issue_guard (document_id) VALUES (?1)").bind(documentId);

/** The counter row of (series, FY) and then its take: both the first version of a quote and every invoice number come through these. */
const counterStatements = (db: D1Database, series: string, fy: string): D1PreparedStatement[] => [
  db
    .prepare("INSERT INTO doc_counters (series, fy, next_no) VALUES (?1, ?2, 1) ON CONFLICT DO NOTHING")
    .bind(series, fy),
  db.prepare("UPDATE doc_counters SET next_no = next_no + 1 WHERE series = ?1 AND fy = ?2").bind(series, fy),
];

/** `issue_result` for a document that just took the next number of (series, FY): UNGUARDED, so a freeze that matched nothing aborts the batch. */
const issueResultStatement = (db: D1Database, documentId: string, series: string, fy: string) =>
  db
    .prepare("INSERT INTO issue_result (document_id, series, fy) SELECT ?1, ?2, ?3")
    .bind(documentId, series, fy);

export function sendStatements(db: D1Database, a: SendArgs): SendStatements {
  const nextNo = "(SELECT next_no - 1 FROM doc_counters WHERE series = ?2 AND fy = ?3)";
  const printfArgs = a.argOrder[0] === "fy" ? `?3, ${nextNo}` : `${nextNo}, ?3`;
  const first = (col: string) =>
    `(SELECT v.${col} FROM documents v WHERE v.version_group_id = ?4 AND v.version = 1)`;
  const numbering = a.isFirstVersion
    ? {
        series: "?2",
        fy: "?3",
        number: nextNo,
        display: `printf(?5, ${printfArgs})`,
      }
    : {
        series: first("series"),
        fy: first("fy"),
        number: first("number"),
        display: first("number_display"),
      };
  const recipientGuard = a.sends
    ? " AND (SELECT count(*) FROM contacts rc WHERE rc.client_id = documents.client_id AND rc.portal_access = 1 AND rc.anonymised_at IS NULL AND rc.id IN (SELECT json_extract(value, '$.contactId') FROM json_each(?17))) = ?18"
    : "";
  const approval = a.expected.approvalNeeded
    ? " AND EXISTS (SELECT 1 FROM approvals ap WHERE ap.document_id = documents.id AND ap.kind = 'discount' AND ap.status = 'approved' AND ap.content_sha256 = documents.content_sha256)"
    : "";
  if (!Number.isSafeInteger(a.maxNumber) || a.maxNumber < 1)
    throw new RangeError(`maxNumber must be a whole number of at least 1, not ${a.maxNumber}`);
  const seriesRoom = a.isFirstVersion ? `\n         AND ${nextNo} <= ${a.maxNumber}` : "";
  // ?1 id, ?2 series, ?3 fy, ?4 group, ?5 pattern, ?6 now, ?7 issue date, ?8 valid until, ?9 recipient, ?10 issuer, ?11 computed,
  // ?12 snapshot sha, ?13 issued by, ?14 expected updated_at, ?15 expected content sha, ?16 numbering version, and with recipients (M4.5)
  // ?17 the recipients as JSON and ?18 their count. Exactly as many values as the highest placeholder are bound, whichever branch is built
  // (D1 refuses more values than the highest placeholder).
  const freeze = db
    .prepare(
      `UPDATE documents SET series = ${numbering.series}, fy = ${numbering.fy}, number = ${numbering.number}, number_display = ${numbering.display},
         status = 'sent', frozen_at = ?6, sent_at = ?6, issue_date = ?7, valid_until = ?8, recipient = ?9, issuer = ?10, computed = ?11,
         snapshot_sha256 = ?12, issued_by = ?13, updated_at = ?6
       WHERE id = ?1 AND status = 'draft' AND frozen_at IS NULL AND updated_at = ?14 AND content_sha256 = ?15
         AND (SELECT version FROM settings WHERE key = 'numbering') IS ?16
         AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.version_group_id = ?4 AND x.status IN ('accepted', 'converted'))
         AND NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = documents.client_id AND z.anonymised_at IS NOT NULL)${seriesRoom}${approval}${recipientGuard}
       RETURNING number_display, valid_until`,
    )
    .bind(
      a.documentId,
      a.series,
      a.fy,
      a.groupId,
      a.pattern,
      a.now,
      a.issueDate,
      a.validUntil,
      JSON.stringify(a.recipient),
      JSON.stringify(a.issuer),
      a.computedJson,
      a.snapshotSha256,
      a.issuedBy,
      a.expected.updatedAt,
      a.expected.contentSha256,
      a.expected.numberingVersion,
      ...(a.sends ? [JSON.stringify(a.sends.rows), a.sends.rows.length] : []),
    );
  const main: D1PreparedStatement[] = [guardStatement(db, a.documentId)];
  if (a.isFirstVersion) main.push(...counterStatements(db, a.series, a.fy));
  main.push(freeze);
  // issue_result's own arguments are the series and FY the document ended up with: for a later version, those of its first version.
  const resultSeries = a.isFirstVersion ? "?2" : first("series");
  const resultFy = a.isFirstVersion ? "?3" : first("fy");
  return {
    main,
    postAudit: [
      a.isFirstVersion
        ? issueResultStatement(db, a.documentId, a.series, a.fy)
        : db
            .prepare(
              `INSERT INTO issue_result (document_id, series, fy) SELECT ?1, ${resultSeries}, ${resultFy}`,
            )
            .bind(a.documentId, a.series, a.fy, a.groupId),
      // The earlier versions that were still open are superseded. Written only for a document that is now frozen and sent.
      db
        .prepare(
          `UPDATE documents SET status = 'revised' WHERE version_group_id = ?1 AND version < ?2 AND status IN ('sent', 'viewed')
             AND EXISTS (SELECT 1 FROM documents n WHERE n.id = ?3 AND n.status = 'sent' AND n.frozen_at IS NOT NULL)`,
        )
        .bind(a.groupId, a.version, a.documentId),
      // M4.5: one `document_sends` row per recipient, written only for the document this very batch froze (its `frozen_at` is `now`). The email
      // waits (`queued_at` NULL) until the jobs Worker has stored the PDF.
      ...(a.sends
        ? [
            db
              .prepare(
                `INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, queued_at, created_by, created_at)
                 SELECT json_extract(j.value, '$.id'), d.id, d.version_group_id, d.client_id, c.id, lower(c.email),
                   coalesce(?3, (SELECT cl.attach_pdf FROM clients cl WHERE cl.id = d.client_id)), 'send', NULL, ?4, ?5
                 FROM documents d JOIN json_each(?2) j
                   JOIN contacts c ON c.id = json_extract(j.value, '$.contactId') AND c.client_id = d.client_id AND c.portal_access = 1 AND c.anonymised_at IS NULL
                 WHERE d.id = ?1 AND d.status = 'sent' AND d.frozen_at = ?5`,
              )
              .bind(
                a.documentId,
                JSON.stringify(a.sends.rows),
                a.sends.attachPdf === null ? null : a.sends.attachPdf ? 1 : 0,
                a.issuedBy,
                a.now,
              ),
          ]
        : []),
    ],
  };
}

// ---- the invoice issue batch (M5.1, ADM-INV-03, -07, ADM-APR-01/02, LD5, LD6) -----------------------------------------------------------------

/**
 * Who may issue, written INTO the freeze statement (LD5): the session must be the Owner's, live, with a fresh step-up (`step_up_until` is
 * checked against the issue instant, not at the guard); an approval additionally names a PENDING `issue` approval of this document for exactly
 * this content. A refusal (an expired step-up, a decided or expired request) leaves the batch aborted and nothing written.
 *
 * M5.4 (LD58): `care_auto` is the monthly care-plan invoice the jobs Worker issues with no session at all. Its authority is the Owner's earlier choices, held in
 * the statement: the client's toggle was turned on by an active Owner (`clients.care_auto_issue_by`), the terms row the amount comes from was written by an Owner,
 * the document is the untouched draft the billing job made for this plan and period (`care_invoices`, `created_by` NULL, never edited), the plan is active, and the
 * subtotal is exactly the terms' price (plus AI Ops) with no discount and no overage. `issued_by` is NULL. Everything else (the settings, the client, the contact,
 * the content hash) is checked as for any issue.
 */
export type IssueAuthority =
  | { kind: "owner"; sessionId: string }
  | { kind: "approval"; sessionId: string; approvalId: string }
  | { kind: "care_auto"; carePlanId: string; periodStart: string; termsId: string };

export type InvoiceIssueArgs = {
  documentId: string;
  /** The type the draft must have (`tax_invoice` in M5.1): a changed type refuses the issue. */
  type: string;
  /** The numbering series of the type (core `SERIES_OF`) and the FY token the number is taken in. */
  series: string;
  fy: string;
  /** `sqlPrintfPattern(format)` of the settings' numbering format for the series. */
  pattern: string;
  argOrder: readonly ["fy", "n"] | readonly ["n", "fy"];
  /** `maxNumber(format)`: a counter past it refuses the issue (`series_full`) and the counter does not move. */
  maxNumber: number;
  /** The issue instant (UTC ms): `frozen_at`, `updated_at`, and the instant the step-up is judged at. */
  now: number;
  /** ISO dates: the IST day of the issue, and the due date (M5.3: null for a credit note: nothing is owed on it, so nothing can be overdue). */
  issueDate: string;
  dueDate: string | null;
  recipient: RecipientSnapshot;
  issuer: InvoiceIssuerSnapshot;
  computedJson: string;
  snapshotSha256: string;
  /** The member who issued it; NULL for a `care_auto` issue (the batch that made it ran with no session, LD58). */
  issuedBy: string | null;
  /** The newest `invoice` terms version (the footer notes) at the read; none is allowed. */
  termsVersionId: string | null;
  /** M5.2 (LD23): the newest `export_declaration` block pinned to an export invoice that asked for it; null for everything else. Frozen with the document. */
  exportDeclarationId?: string | null;
  /**
   * M5.2 (LD37): the JSON text of exactly the sealed header keys the other columns cannot give (`{export?, proforma?, advance?}`), or null when
   * there are none. The freeze writes it and the freeze trigger keeps it: the frozen view, the PDF and the seal's verifier read it back, so nothing
   * is rebuilt from live settings after issue.
   */
  headerExtras?: string | null;
  /**
   * M5.3 (LD40, LD41, LD46): present exactly when `type` is a credit or debit note. The freeze then also holds, in its WHERE: the parent is still the frozen, live
   * invoice that was read (`updated_at` and `credited_minor` unchanged), a credit note fits inside what is left of it and is dated inside the deadline, and at
   * most 20 notes of this kind are issued; a credit note moves the parent's ledger in the same batch (recomputed from the notes, never incremented).
   */
  note?: NoteIssueArgs;
  /** M5.3 (LD46): the IMS status a credit note is issued with (`pending` for a GST-registered client, else `not_applicable`); null for every other document. */
  imsStatus?: "pending" | "not_applicable" | null;
  expected: {
    updatedAt: number;
    contentSha256: string;
    /** The `version` of each settings row read before the batch (null: no such row). A change in between refuses the issue. */
    numberingVersion: number | null;
    companyVersion: number | null;
    taxVersion: number | null;
    paymentTermsVersion: number | null;
    /** `max(updated_at)` of the active bank rows at the read (null: none). */
    bankStamp: number | null;
    /** The client's `updated_at` at the read: a changed client refuses the issue. */
    clientUpdatedAt: number;
    /** The contact named on the invoice (id and `updated_at` at the read), or null when it has none: a contact edited or anonymised since refuses the issue. */
    contact: { id: string; updatedAt: number } | null;
  };
  authority: IssueAuthority;
  /**
   * The requester's bell when an issue request was waiting (07-R: "Your invoice for {client name} was issued as {number}."): the client's name, and the link up to
   * the id. M5.3: `subject` is the document's word ("invoice" by default, "credit note" or "debit note") and `prefix` (empty now: 07-T §8 has every line) is kept for a wording that is not approved yet.
   */
  bell: { clientName: string; linkPrefix: string; subject?: string; prefix?: string };
};

/** What a note's freeze needs beyond an invoice's (M5.3). */
export type NoteIssueArgs = {
  kind: "credit" | "debit";
  parentId: string;
  /** The parent's `updated_at` and `credited_minor` at the read: another note issued since refuses this one (`parent_changed`). */
  expectedParentUpdatedAt: number;
  expectedParentCredited: number;
  /** A credit note only (G-11, Q33): the last day it may be dated, and the day the annual return was filed (null: not filed). A debit note has no deadline. */
  deadline: { lastDay: string; filedOn: string | null } | null;
};

/** At most this many issued notes of a kind per invoice (core `NOTES_MAX`: a test compares the two; core is not imported here to keep the Worker bundle small). */
export const NOTES_MAX_SQL = 20;

/** The parent statuses a note can be issued against: not void, not fully credited (core `ledgerStatusOf`'s other values). */
const NOTE_PARENT_LIVE = `(${NOTE_PARENT_LIVE_STATUSES.map((s) => `'${s}'`).join(", ")})`;

/**
 * M5.3 (LD40): what the frozen, not void credit notes of an invoice took per original line (`?1` = the invoice's id), summed by SQL over each note's stored
 * `computed.lines` (their `index` is the original line's): the taxable value and each tax head, and the INR view's (zero on an INR invoice). A second statement
 * (`CREDITED_TOTALS_SQL`) gives the totals. A test proves both equal the same sums worked out in JS (core `creditedSumOf`).
 */
export const CREDITED_SO_FAR_SQL = `SELECT CAST(json_extract(l.value, '$.index') AS INTEGER) AS idx,
       coalesce(sum(json_extract(l.value, '$.taxableMinor')), 0) AS taxable, coalesce(sum(json_extract(l.value, '$.cgstMinor')), 0) AS cgst,
       coalesce(sum(json_extract(l.value, '$.sgstMinor')), 0) AS sgst, coalesce(sum(json_extract(l.value, '$.igstMinor')), 0) AS igst,
       coalesce(sum(json_extract(l.value, '$.inr.taxableMinor')), 0) AS inrTaxable, coalesce(sum(json_extract(l.value, '$.inr.cgstMinor')), 0) AS inrCgst,
       coalesce(sum(json_extract(l.value, '$.inr.sgstMinor')), 0) AS inrSgst, coalesce(sum(json_extract(l.value, '$.inr.igstMinor')), 0) AS inrIgst
     FROM documents c, json_each(c.computed, '$.lines') l
     WHERE c.parent_id = ?1 AND c.type = 'credit_note' AND c.frozen_at IS NOT NULL AND c.status <> 'void'
     GROUP BY idx ORDER BY idx`;

/** The totals of the same notes: the sum of their totals, the sum of their INR totals (USD invoices), and how many there are. */
export const CREDITED_TOTALS_SQL = `SELECT coalesce(sum(c.total_minor), 0) AS total, coalesce(sum(c.total_inr_minor), 0) AS totalInr, count(*) AS count
     FROM documents c WHERE c.parent_id = ?1 AND c.type = 'credit_note' AND c.frozen_at IS NOT NULL AND c.status <> 'void'`;

/** How many notes of each kind are frozen on an invoice (`?1`): the limit of LD51 and the list's counts. */
export const NOTE_COUNTS_SQL = `SELECT c.type, count(*) AS count FROM documents c WHERE c.parent_id = ?1 AND c.type IN ('credit_note', 'debit_note') AND c.frozen_at IS NOT NULL GROUP BY c.type`;

/** The issue instant's freeze test, for the statements that follow it: this very batch froze the document. */
const FROZEN_BY_THIS_BATCH =
  "EXISTS (SELECT 1 FROM documents n WHERE n.id = ?1 AND n.status = 'issued' AND n.frozen_at = ?2)";

/**
 * T4 (rt2): the freeze of a document that must be signed (a credit or debit note, an invoice for a payment received; core `signatureRequired`). The issuer block
 * being frozen (`?9`) carries a signature reference and no `signatory` key (`signedIssuerSql`), and its SHA-256 is the one saved in Settings › Company at the issue
 * instant, so a signature removed or replaced between the read and the freeze refuses the batch. No new bind parameter. Researched 2026-10-30, Rule 53(1A) CGST Rules
 * (08-C RA-22); s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-17). OPEN (08-C RA-22): do Rules 50 and 53 carry Rule 46(q)'s electronic-issue proviso, and does a
 * stored image meet "signature" on an electronic document? The safest reading is built.
 */
export const SIGNED_FREEZE_SQL = `${signedIssuerSql("?9")} AND json_extract(?9, '$.signature.sha256') = (SELECT json_extract(cs.value, '$.signature.sha256') FROM settings cs WHERE cs.key = 'company')`;

/** What every invoice freeze needs, whoever the authority is (the owner, an approval, or the owner's advance action). */
type FreezeBase = Omit<InvoiceIssueArgs, "authority" | "bell">;

/** The Owner's authority in SQL (`?24` is the session): live, with a fresh step-up judged at the issue instant. Shared by the owner, the approval and the advance batches. */
const OWNER_AUTHORITY_SQL =
  "EXISTS (SELECT 1 FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id WHERE s.id = ?24 AND s.revoked_at IS NULL AND s.idle_expires_at > ?5 AND s.abs_expires_at > ?5 AND s.step_up_until > ?5 AND u.role = 'owner' AND u.status = 'active')";

/**
 * The authority of an automatic care invoice (M5.4, LD58): `?24` is the care plan, `?30` the period start and `?31` the terms row (bound by the tail). Nothing here
 * reads a session: the Owner's choices were made earlier, with a fresh code, and are read back from the rows they wrote. In order: the toggle of the plan's client
 * was turned on by an active Owner; that period was recorded as billed for this very document and these terms, with no overage; the terms row is the one in force at
 * the period start and an Owner wrote it; the plan is active now and was at the period start; the amount is the terms' price plus AI Ops with no discount, in INR, with no line of marked placeholder text (early check finding 4). Then the
 * draft itself: made by the job (no member), never saved since, and with no pending approval.
 */
const CARE_AUTO_SQL = `EXISTS (SELECT 1 FROM care_plans p JOIN clients k ON k.id = p.client_id
            JOIN staff_users o ON o.id = k.care_auto_issue_by AND o.role = 'owner' AND o.status = 'active'
            JOIN care_invoices ci ON ci.care_plan_id = p.id AND ci.period_start = ?30 AND ci.document_id = documents.id AND ci.terms_id = ?31 AND ci.overage_minutes IS NULL
            JOIN care_plan_terms t ON t.id = ?31 AND t.care_plan_id = p.id
            JOIN staff_users tc ON tc.id = t.created_by AND tc.role = 'owner'
    WHERE p.id = ?24 AND p.id = documents.care_plan_id AND k.id = documents.client_id AND k.care_auto_issue = 1 AND p.status = 'active'
      AND p.last_billed_period = ?30
      AND t.id = (SELECT id FROM care_plan_terms WHERE care_plan_id = p.id AND effective_from <= ?30 ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1)
      AND (SELECT status FROM care_plan_status_log WHERE care_plan_id = p.id AND effective_on <= ?30 ORDER BY effective_on DESC, created_at DESC, id DESC LIMIT 1) = 'active'
      AND documents.subtotal_minor = t.price_minor + coalesce(t.ai_ops_minor, 0) AND documents.discount_minor = 0)
  AND documents.created_by IS NULL AND documents.created_at = documents.updated_at AND documents.currency = 'INR'
  AND NOT EXISTS (SELECT 1 FROM document_lines pl WHERE pl.document_id = documents.id AND pl.description LIKE '%[Placeholder%')
  AND NOT EXISTS (SELECT 1 FROM approvals ap WHERE ap.document_id = documents.id AND ap.status = 'pending')`;

/**
 * The freeze UPDATE every invoice issue ends with, with every condition in its WHERE (LD5; a read only explains a refusal):
 *   ?1 id, ?2 series, ?3 fy, ?4 pattern, ?5 now, ?6 issue date, ?7 due date, ?8 recipient, ?9 issuer, ?10 computed, ?11 snapshot sha, ?12 issued by,
 *   ?13 terms version, ?14 expected updated_at, ?15 expected content sha, ?16 numbering, ?17 company, ?18 tax, ?19 payment terms versions, ?20 bank stamp,
 *   ?21 client updated_at, ?22 highest number, ?23 type, ?24 session, ?25 contact id, ?26 contact updated_at (both null: no contact), ?27 the export
 *   declaration block (M5.2), ?28 the header extras JSON (M5.2, LD37), ?29 the IMS status of a credit note (M5.3, LD46; null for everything else), and from ?30
 *   whatever `tail` binds (the approval, a note's parent and deadline, or the advance action's amount, proforma and its stamp).
 * A proforma's `valid_until` is its due date (M5.2, LD28, Q28): the freeze writes it, so the column is sealed with the rest. A CREDIT note starts with a balance of
 * 0 (M5.3, LD41: nothing is owed on it, so M5.4 never chases it); every other document starts with its total. Exactly as many values as the highest
 * placeholder are bound (D1 refuses more).
 */
function freezeStatement(
  db: D1Database,
  a: FreezeBase,
  who: { sql: string; bind: string },
  tail: { where: string; binds: readonly unknown[] },
): D1PreparedStatement {
  const nextNo = "(SELECT next_no - 1 FROM doc_counters WHERE series = ?2 AND fy = ?3)";
  const printfArgs = a.argOrder[0] === "fy" ? `?3, ${nextNo}` : `${nextNo}, ?3`;
  return db
    .prepare(
      `UPDATE documents SET series = ?2, fy = ?3, number = ${nextNo}, number_display = printf(?4, ${printfArgs}),
         status = 'issued', frozen_at = ?5, issue_date = ?6, due_date = ?7, recipient = ?8, issuer = ?9, computed = ?10,
         snapshot_sha256 = ?11, issued_by = ?12, terms_version_id = ?13, balance_minor = CASE WHEN ?23 = 'credit_note' THEN 0 ELSE total_minor END, updated_at = ?5,
         valid_until = CASE WHEN ?23 = 'proforma' THEN ?7 ELSE valid_until END, export_declaration_id = ?27, header_extras = ?28, ims_status = ?29
       WHERE id = ?1 AND type = ?23 AND status = 'draft' AND frozen_at IS NULL AND updated_at = ?14 AND content_sha256 = ?15
         AND (SELECT version FROM settings WHERE key = 'numbering') IS ?16
         AND (SELECT version FROM settings WHERE key = 'company') IS ?17
         AND (SELECT version FROM settings WHERE key = 'tax') IS ?18
         AND (SELECT version FROM settings WHERE key = 'payment_terms') IS ?19
         AND (SELECT max(updated_at) FROM bank_accounts WHERE active = 1) IS ?20
         AND (SELECT updated_at FROM clients WHERE id = documents.client_id) = ?21
         AND NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = documents.client_id AND z.anonymised_at IS NOT NULL)
         AND ${nextNo} <= ?22
         AND (?25 IS NULL OR EXISTS (SELECT 1 FROM contacts k WHERE k.id = ?25 AND k.client_id = documents.client_id AND k.anonymised_at IS NULL AND k.updated_at = ?26))
         AND ${who.sql}${tail.where}
       RETURNING number_display, number`,
    )
    .bind(
      a.documentId,
      a.series,
      a.fy,
      a.pattern,
      a.now,
      a.issueDate,
      a.dueDate,
      JSON.stringify(a.recipient),
      JSON.stringify(a.issuer),
      a.computedJson,
      a.snapshotSha256,
      a.issuedBy,
      a.termsVersionId,
      a.expected.updatedAt,
      a.expected.contentSha256,
      a.expected.numberingVersion,
      a.expected.companyVersion,
      a.expected.taxVersion,
      a.expected.paymentTermsVersion,
      a.expected.bankStamp,
      a.expected.clientUpdatedAt,
      a.maxNumber,
      a.type,
      who.bind,
      a.expected.contact?.id ?? null,
      a.expected.contact?.updatedAt ?? null,
      a.exportDeclarationId ?? null,
      a.headerExtras ?? null,
      a.imsStatus ?? null,
      ...tail.binds,
    );
}

/**
 * The part of a note's freeze WHERE that is about its parent (M5.3, LD40): `first` is the number of the first placeholder the tail binds (the parent's id, its
 * `updated_at`, its `credited_minor`, the last day a credit note may be dated, the day the annual return was filed). The invoice is still the frozen, live
 * tax or export invoice that was read, of this client and currency; a credit note fits inside what is left of it (the total only: the trigger of 0042 holds
 * each tax head) and is dated (`?6`, the issue day) on or before the last day and strictly before the day the return was filed; and fewer than 20 notes of
 * this kind are issued on it. A tax-only debit note has no round-off: its total is exactly its tax (FX-4, `taxOnlyNoteExactSql`; Settled by the lead on the safest reading, 2026-10-30 (08-C RA-33)). A debit note on an
 * export under LUT needs a LUT with an ARN saved for the FY of its own issue day `?6` (rt1 T2; Researched 2026-10-30, Rule 96A(1) CGST Rules, Notification 37/2017-CT
 * (08-C RA-19, Q39); the twin of the trigger `documents_debit_note_lut_fy`, 0054). The last day a credit note may be dated is the caller's `lastDay` (rt1 T1: the end of
 * the latest return period before the return deadline, core `creditNoteDeadline`). Everything is in the statement, so a refusal writes nothing.
 */
function noteIssueTail(n: NoteIssueArgs, first: number): { where: string; binds: readonly unknown[] } {
  const p = `?${first}`;
  const at = (k: number) => `?${first + k}`;
  return {
    where: ` AND EXISTS (SELECT 1 FROM documents p WHERE p.id = documents.parent_id AND p.id = ${p} AND p.type IN ('tax_invoice', 'export_invoice') AND p.frozen_at IS NOT NULL AND p.status IN ${NOTE_PARENT_LIVE} AND p.client_id = documents.client_id AND p.currency = documents.currency AND p.updated_at = ${at(1)} AND p.credited_minor = ${at(2)} AND (documents.type = 'debit_note' OR (documents.total_minor <= p.total_minor - p.credited_minor AND ?6 <= ${at(3)} AND (${at(4)} IS NULL OR ?6 < ${at(4)})))
           AND (documents.type <> 'debit_note' OR (p.export_mode IS NOT 'lut' AND p.supply_type IS NOT 'export_lut') OR ${LUT_FOR_FY_SQL.replaceAll("?FY", fyTokenOfDateSql("?6"))}))
         AND (SELECT count(*) FROM documents c WHERE c.parent_id = ${p} AND c.type = documents.type AND c.frozen_at IS NOT NULL) < ${NOTES_MAX_SQL}
         AND (json_extract(documents.header_extras, '$.noteOf.reason.code') IS NOT 'discount_after_sale' OR ?6 >= '${DISCOUNT_AFTER_SALE_FROM_SQL}')
         AND ${taxOnlyNoteExactSql("documents")}
         AND ${SIGNED_FREEZE_SQL}`,
    binds: [
      n.parentId,
      n.expectedParentUpdatedAt,
      n.expectedParentCredited,
      n.deadline?.lastDay ?? null,
      n.deadline?.filedOn ?? null,
    ],
  };
}

/**
 * The invoice issue batch, in the same two parts as `sendStatements` around the request's audit row:
 *   main      = [ guard, counter row, counter take, the FREEZE UPDATE ... RETURNING number_display, number ]
 *   postAudit = [ issue_result UNGUARDED, the milestone to 'invoiced' (not for a proforma, M5.2), the pending `issue` approval to 'approved', the requester's bell ]
 * Every condition is in the freeze statement's WHERE (a read only explains a refusal), so a stale save, a changed setting, a changed client,
 * a full series, or an authority that is gone writes NOTHING: `issue_result` aborts the batch, the counter rolls back with it. The number is
 * outside the seal (it is assigned here); `balance_minor` starts at the total (LD17: M5 writes no payments here). A PROFORMA does not move its milestone
 * (finding 2): the work is not invoiced until a tax invoice exists, so the unbilled milestone stays visible to the 25-day warning.
 */
export function invoiceIssueStatements(db: D1Database, a: InvoiceIssueArgs): SendStatements {
  const approval =
    a.authority.kind === "approval"
      ? {
          where:
            " AND EXISTS (SELECT 1 FROM approvals ap WHERE ap.id = ?30 AND ap.document_id = documents.id AND ap.kind = 'issue' AND ap.status = 'pending' AND ap.content_sha256 = documents.content_sha256)",
          binds: [a.authority.approvalId] as const,
        }
      : { where: "", binds: [] as const };
  // M5.4: an automatic care invoice has no session: its authority text is its own, and it binds the period and the terms at ?30 and ?31 (the plan is ?24).
  const care = a.authority.kind === "care_auto" ? a.authority : null;
  const who = care
    ? { sql: CARE_AUTO_SQL, bind: care.carePlanId }
    : { sql: OWNER_AUTHORITY_SQL, bind: (a.authority as { sessionId: string }).sessionId };
  const careBinds = care ? ([care.periodStart, care.termsId] as const) : ([] as const);
  // A note's parent tail follows the approval's (its placeholders start where the approval's end).
  const noteTail = a.note
    ? noteIssueTail(a.note, 30 + approval.binds.length + careBinds.length)
    : { where: "", binds: [] as const };
  const freeze = freezeStatement(db, a, who, {
    where: approval.where + noteTail.where,
    binds: [...approval.binds, ...careBinds, ...noteTail.binds],
  });
  const isNote = a.type === "credit_note" || a.type === "debit_note";
  return {
    main: [guardStatement(db, a.documentId), ...counterStatements(db, a.series, a.fy), freeze],
    postAudit: [
      issueResultStatement(db, a.documentId, a.series, a.fy),
      // The milestone this invoice was made from is now invoiced (one made by "Start project" (M4.5) is still pending when its first-instalment draft is issued, so both count); `delivered_at` was set when it became ready to bill (LD12) and is kept: an advance invoice on a pending milestone leaves it unset (the work is not delivered). A proforma leaves its milestone alone, and so does a note (LD41: the invoice's milestone stays `invoiced`).
      ...(a.type === "proforma" || isNote
        ? []
        : [
            db
              .prepare(
                `UPDATE milestones SET delivered_at = CASE WHEN status = 'ready_to_bill' THEN coalesce(delivered_at, ?2) ELSE delivered_at END,
             status = 'invoiced', updated_at = ?2
           WHERE document_id = ?1 AND status IN ('pending', 'ready_to_bill') AND ${FROZEN_BY_THIS_BATCH}`,
              )
              .bind(a.documentId, a.now),
          ]),
      // An issue request that was waiting for exactly this content is approved: by the approver in the approval path, by the owner who issued directly.
      db
        .prepare(
          `UPDATE approvals SET status = 'approved', decided_by = ?3, decided_at = ?2
           WHERE document_id = ?1 AND kind = 'issue' AND status = 'pending' AND content_sha256 = (SELECT content_sha256 FROM documents WHERE id = ?1)
             AND ${FROZEN_BY_THIS_BATCH}`,
        )
        .bind(a.documentId, a.now, a.issuedBy),
      // The requester's bell (one row; the unique member, kind and entity keeps a redelivery from adding twice).
      db
        .prepare(
          `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
           SELECT 'n_' || lower(hex(randomblob(16))), r.requested_by, 'approval.decided', 'approval', r.id,
             ?7 || 'Your ' || ?6 || ' for ' || ?4 || ' was issued as ' || (SELECT number_display FROM documents WHERE id = ?1) || '.', ?5 || ?1
           FROM approvals r JOIN staff_users u ON u.id = r.requested_by AND u.status = 'active'
           WHERE r.document_id = ?1 AND r.kind = 'issue' AND r.status = 'approved' AND r.decided_at = ?2 AND r.decided_by = ?3 AND r.requested_by <> ?3
             AND ${FROZEN_BY_THIS_BATCH}`,
        )
        .bind(
          a.documentId,
          a.now,
          a.issuedBy,
          a.bell.clientName,
          a.bell.linkPrefix,
          a.bell.subject ?? "invoice",
          a.bell.prefix ?? "",
        ),
      // M5.3 (LD41): a CREDIT note reduces what its invoice is owed, in this same batch and only for the document this very batch froze. The credited total is
      // RECOMPUTED from the issued, not void credit notes (never incremented: a replay or a concurrent note cannot double count), then the balance and the status
      // follow from it (core `ledgerStatusOf` is the twin of the CASE; a refund due is derived, M6). The invoice's `updated_at` always MOVES (`max(now, old + 1)`): two
      // notes in one millisecond must not leave the stamp a stale draft read. A debit note moves nothing on its invoice (LD42).
      // FX-1 (A0 4): ONE statement writes the credited total, the balance and the status together, from the same recomputed sum (`s.credited`), so the row is never
      // seen half written: the trigger `documents_ledger_identity` (0050) checks balance = max(0, total - paid - credited) on every write of the ledger.
      ...(a.note && a.note.kind === "credit"
        ? [
            db
              .prepare(
                `UPDATE documents SET credited_minor = s.credited, balance_minor = max(0, total_minor - paid_minor - s.credited),
                   status = CASE WHEN s.credited >= total_minor THEN 'credited' WHEN paid_minor > 0 AND total_minor - paid_minor - s.credited <= 0 THEN 'paid' WHEN paid_minor > 0 THEN 'partially_paid' WHEN s.credited > 0 THEN 'partially_credited' ELSE 'issued' END,
                   updated_at = max(?2, updated_at + 1)
                 FROM (SELECT coalesce(sum(c.total_minor), 0) AS credited FROM documents c WHERE c.parent_id = ?3 AND c.type = 'credit_note' AND c.frozen_at IS NOT NULL AND c.status <> 'void') AS s
                 WHERE documents.id = ?3 AND ${FROZEN_BY_THIS_BATCH}`,
              )
              .bind(a.documentId, a.now, a.note.parentId),
          ]
        : []),
    ],
  };
}

// ---- the tax invoice for money received against a proforma (M5.2, Q9, LD22, G-6; Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17)) --------------------------------------

/** One line of the new invoice: the proforma's own split of the amount received (`splitInclusive` over its groups), already worked out by the caller. */
export type AdvanceLine = {
  id: string;
  position: number;
  description: string;
  detail: string | null;
  sac: string;
  qtyMilli: number;
  unit: string;
  rateMinor: number;
  taxableMinor: number;
  gstRateBp: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  lineTotalMinor: number;
};

export type AdvanceIssueArgs = Omit<InvoiceIssueArgs, "authority" | "bell" | "expected" | "type"> & {
  /** The new invoice's type: an export invoice for an overseas client, else a tax invoice. */
  type: "tax_invoice" | "export_invoice";
  /** The proforma the money was received against, and the `updated_at` it was read at (a changed proforma refuses the batch). */
  proformaId: string;
  expectedProformaUpdatedAt: number;
  /** Owner only: the session whose live step-up the freeze checks. */
  sessionId: string;
  amountMinor: number;
  /**
   * Q37 (owner 2026-10-28): the FY token ("2627") of the receipt day, set only when this is an export invoice on the LUT route; the freeze then needs a LUT with
   * an ARN saved for that FY in the `tax` setting at the issue instant (`advance_lut_missing`). Null on every other advance invoice.
   */
  lutFy?: string | null;
  /** ISO date the money arrived, and `normaliseReference` of its bank or gateway reference (the idempotency key with the proforma). */
  receivedOn: string;
  referenceNorm: string;
  /** The `advance_receipts` row's id (also sealed in the invoice header). */
  receiptId: string;
  /** The hash of the new invoice's draft content (the row is inserted with it, and the freeze checks it). */
  contentSha256: string;
  expected: Omit<InvoiceIssueArgs["expected"], "updatedAt" | "contentSha256">;
  /** The draft the batch inserts before it freezes it: the columns a save writes, and the lines. */
  draft: {
    clientId: string;
    projectId: string | null;
    contactId: string | null;
    currency: string;
    exportMode: string | null;
    fx: { rateMicros: number; date: string; source: string; noRateDay?: string } | null;
    subtotalMinor: number;
    discountMinor: number;
    taxableMinor: number;
    cgstMinor: number;
    sgstMinor: number;
    igstMinor: number;
    roundOffMinor: number;
    totalMinor: number;
    totalInrMinor: number | null;
    supplyType: string;
    placeOfSupplyCode: string;
    lines: readonly AdvanceLine[];
  };
};

/**
 * The advance batch (the only place M5 writes a paid amount, LD22): in ONE batch, INSERT the new invoice as a draft (its parent is the proforma) with
 * its lines, then the same guard, counter and FREEZE as any invoice issue (every M5.1 condition) plus what only this action needs, in the freeze's
 * WHERE: the amount equals the invoice's total, and the proforma is still the frozen proforma read (`updated_at`), issued or converted, with a
 * balance of at least the amount. After the audit row: `issue_result` UNGUARDED (a refusal rolls the whole batch back, the inserted draft and the
 * counter with it), the `advance_receipts` row (a repeated reference aborts the batch on its unique key), the proforma moved to `converted` with its
 * paid and balance updated, the proforma's milestone to `invoiced` once its balance is 0 (delivered_at kept, LD12), and the new invoice to `paid`
 * with balance 0. Authority: the Owner's session with a live step-up, checked inside the freeze statement.
 */
export function advanceIssueStatements(db: D1Database, a: AdvanceIssueArgs): SendStatements {
  const d = a.draft;
  const insert = db
    .prepare(
      `INSERT INTO documents (id, type, status, client_id, project_id, parent_id, contact_id, currency, supply_type, place_of_supply_code, export_mode,
         fx_rate_micros, fx_date, fx_source, subtotal_minor, discount_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor, round_off_minor,
         total_minor, total_inr_minor, content_sha256, created_by, created_at, updated_at, fx_no_rate_day)
       VALUES (?1, ?2, 'draft', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?25, ?26)`,
    )
    .bind(
      a.documentId,
      a.type,
      d.clientId,
      d.projectId,
      a.proformaId,
      d.contactId,
      d.currency,
      d.supplyType,
      d.placeOfSupplyCode,
      d.exportMode,
      d.fx?.rateMicros ?? null,
      d.fx?.date ?? null,
      d.fx?.source ?? null,
      d.subtotalMinor,
      d.discountMinor,
      d.taxableMinor,
      d.cgstMinor,
      d.sgstMinor,
      d.igstMinor,
      d.roundOffMinor,
      d.totalMinor,
      d.totalInrMinor,
      a.contentSha256,
      a.issuedBy,
      a.now,
      d.fx?.noRateDay ?? null,
    );
  const lines = d.lines.map((l) =>
    db
      .prepare(
        `INSERT INTO document_lines (id, document_id, position, description, detail, sac, qty_milli, unit, rate_minor, taxable_minor, gst_rate_bp,
           cgst_minor, sgst_minor, igst_minor, line_total_minor)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
      )
      .bind(
        l.id,
        a.documentId,
        l.position,
        l.description,
        l.detail,
        l.sac,
        l.qtyMilli,
        l.unit,
        l.rateMinor,
        l.taxableMinor,
        l.gstRateBp,
        l.cgstMinor,
        l.sgstMinor,
        l.igstMinor,
        l.lineTotalMinor,
      ),
  );
  const base: FreezeBase = {
    ...a,
    expected: { ...a.expected, updatedAt: a.now, contentSha256: a.contentSha256 },
  };
  const freeze = freezeStatement(
    db,
    base,
    { sql: OWNER_AUTHORITY_SQL, bind: a.sessionId },
    {
      where: ` AND total_minor = ?30
         AND EXISTS (SELECT 1 FROM documents p WHERE p.id = ?31 AND p.type = 'proforma' AND p.frozen_at IS NOT NULL AND p.status IN ('issued', 'converted') AND p.updated_at = ?32 AND p.balance_minor >= ?30 AND p.client_id = documents.client_id AND p.currency = documents.currency)
         AND (?33 IS NULL OR ${LUT_FOR_FY_SQL.replaceAll("?FY", "?33")})
         AND ${SIGNED_FREEZE_SQL}`,
      binds: [a.amountMinor, a.proformaId, a.expectedProformaUpdatedAt, a.lutFy ?? null],
    },
  );
  return {
    main: [
      insert,
      ...lines,
      guardStatement(db, a.documentId),
      ...counterStatements(db, a.series, a.fy),
      freeze,
    ],
    postAudit: [
      issueResultStatement(db, a.documentId, a.series, a.fy),
      // The evidence: one row per payment reference of the proforma (the unique key makes a repeated reference abort the whole batch).
      db
        .prepare(
          `INSERT INTO advance_receipts (id, proforma_id, invoice_id, client_id, currency, amount_minor, received_on, reference_norm, created_by, created_at)
           SELECT ?3, ?2, d.id, d.client_id, d.currency, ?4, ?5, ?6, ?7, ?8 FROM documents d WHERE d.id = ?1 AND d.status = 'issued' AND d.frozen_at = ?8`,
        )
        .bind(
          a.documentId,
          a.proformaId,
          a.receiptId,
          a.amountMinor,
          a.receivedOn,
          a.referenceNorm,
          a.issuedBy,
          a.now,
        ),
      // The proforma is converted (terminal) with the payment on it; it stays `converted` while a balance is left (further payments are allowed).
      db
        .prepare(
          `UPDATE documents SET status = 'converted', paid_minor = paid_minor + ?3, balance_minor = balance_minor - ?3, updated_at = ?4
           WHERE id = ?2 AND type = 'proforma' AND EXISTS (SELECT 1 FROM documents n WHERE n.id = ?1 AND n.status = 'issued' AND n.frozen_at = ?4)`,
        )
        .bind(a.documentId, a.proformaId, a.amountMinor, a.now),
      // The work is invoiced only when the proforma is settled: the milestone moves once its balance is 0 (after the update above).
      db
        .prepare(
          `UPDATE milestones SET delivered_at = CASE WHEN status = 'ready_to_bill' THEN coalesce(delivered_at, ?3) ELSE delivered_at END,
             status = 'invoiced', updated_at = ?3
           WHERE document_id = ?2 AND status IN ('pending', 'ready_to_bill')
             AND (SELECT balance_minor FROM documents WHERE id = ?2) = 0
             AND EXISTS (SELECT 1 FROM documents n WHERE n.id = ?1 AND n.status = 'issued' AND n.frozen_at = ?3)`,
        )
        .bind(a.documentId, a.proformaId, a.now),
      // The new invoice is paid: nothing is left to chase.
      db
        .prepare(
          `UPDATE documents SET status = 'paid', paid_minor = total_minor, balance_minor = 0 WHERE id = ?1 AND status = 'issued' AND frozen_at = ?2`,
        )
        .bind(a.documentId, a.now),
    ],
  };
}

// ---- a credit or debit note draft (M5.3, LD38; M6 reuses it for "refund → credit note draft") -------------------------------------------------------------

export type NoteDraftArgs = {
  /** The `documents` columns of the new draft (id, type, status `draft`, client, parent, project, contact, currency, supply, totals, `computed`, `content_sha256`, `header_extras`, who and when). */
  columns: Readonly<Record<string, unknown>>;
  kind: "credit" | "debit";
  parentId: string;
  clientId: string;
  /** The parent's `updated_at` and `credited_minor` at the read: another note issued since refuses the draft. */
  expectedParentUpdatedAt: number;
  expectedParentCredited: number;
  /** The IST day of the draft and, for a credit note, the deadline it is judged against (a draft past the deadline is refused too, LD45). */
  today: string;
  deadline: { lastDay: string; filedOn: string | null } | null;
};

/**
 * The guarded INSERT of a note draft (one statement; the caller adds the lines and the audit row, and every later statement is guarded on that audit row). The
 * row is written only while the invoice is still the frozen, live tax or export invoice that was read (`updated_at` and `credited_minor` unchanged), of this
 * client, in this currency, the client is not an anonymised individual, fewer than 20 notes of this kind are issued, and a credit note's day is inside the
 * deadline. A second open draft of this kind on the invoice is the partial unique index `documents_open_note` (the insert then throws).
 */
export function noteDraftStatements(db: D1Database, a: NoteDraftArgs): D1PreparedStatement[] {
  const keys = Object.keys(a.columns);
  const n = keys.length;
  const at = (k: number) => `?${n + k}`;
  const type = a.kind === "credit" ? "credit_note" : "debit_note";
  const guard = `EXISTS (SELECT 1 FROM documents p WHERE p.id = ${at(1)} AND p.type IN ('tax_invoice', 'export_invoice') AND p.frozen_at IS NOT NULL AND p.status IN ${NOTE_PARENT_LIVE} AND p.client_id = ${at(2)} AND p.updated_at = ${at(3)} AND p.credited_minor = ${at(4)} AND p.currency = ${at(5)})
       AND NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = ${at(2)} AND z.anonymised_at IS NOT NULL)
       AND (SELECT count(*) FROM documents c WHERE c.parent_id = ${at(1)} AND c.type = '${type}' AND c.frozen_at IS NOT NULL) < ${NOTES_MAX_SQL}
       AND (${a.kind === "debit" ? "1" : `${at(6)} <= ${at(7)} AND (${at(8)} IS NULL OR ${at(6)} < ${at(8)})`})`;
  return [
    db
      .prepare(
        `INSERT INTO documents (${keys.join(", ")}) SELECT ${keys.map((_, i) => `?${i + 1}`).join(", ")} WHERE ${guard}`,
      )
      .bind(
        ...Object.values(a.columns),
        a.parentId,
        a.clientId,
        a.expectedParentUpdatedAt,
        a.expectedParentCredited,
        a.columns.currency,
        // Exactly as many values as the highest placeholder (D1 refuses more): a debit note has no deadline placeholders.
        ...(a.kind === "debit" ? [] : [a.today, a.deadline?.lastDay ?? null, a.deadline?.filedOn ?? null]),
      ),
  ];
}

/**
 * M5.4's reader (ADM-INV-10, Rule 47): milestones whose work was DELIVERED (ready to bill) and whose proforma still has a balance, oldest delivery first, keyset by
 * `(delivered_at, id)`, at most 50 rows. `?1` the cutoff (delivered at or before it: core `unbilledCutoff`), `?2` and `?3` the last row's `delivered_at` and `id` (the first
 * page binds -1 and ''). Served by `milestones_unbilled` (0043). Disjoint from `UNBILLED_SQL` (billing.ts): that one lists milestones with NO live frozen document.
 */
export const PROFORMA_TAX_INVOICE_DUE_SQL = `SELECT m.id AS milestone_id, m.delivered_at, m.title, m.project_id, d.id AS proforma_id, d.number_display, d.client_id, d.currency, d.balance_minor, c.display_name AS client_name
   FROM milestones m INDEXED BY milestones_unbilled JOIN documents d ON d.id = m.document_id AND d.type = 'proforma' AND d.frozen_at IS NOT NULL AND d.status <> 'void' AND d.balance_minor > 0
   JOIN clients c ON c.id = d.client_id AND c.anonymised_at IS NULL
   WHERE m.status = 'ready_to_bill' AND m.delivered_at IS NOT NULL AND m.delivered_at <= ?1 AND (m.delivered_at > ?2 OR (m.delivered_at = ?2 AND m.id > ?3))
   ORDER BY m.delivered_at, m.id LIMIT 50`;

// ---- the send of an issued invoice, and its reminders (M5.4, ADM-INV-15, ADM-INV-13, LD55, LD60) -------------------------------------------------------------------

export type InvoiceSendArgs = {
  documentId: string;
  /** One row per recipient (1 to 5): the new `document_sends` id and the contact. */
  rows: readonly { id: string; contactId: string }[];
  /** null: the client's setting (`clients.attach_pdf`). */
  attachPdf: boolean | null;
  /** The member who sent it, or the Owner who turned the automatic issue on (`kind` `auto`). */
  createdBy: string;
  kind: "send" | "resend" | "auto";
  now: number;
  /** The care issue writes its sends in the batch that froze the document: the document's `frozen_at` must be exactly this. Null for a send of an invoice issued earlier. */
  frozenAt: number | null;
  /** The reminders to create, only on the FIRST send (core `reminderRows`): one row per future offset. `id` is the new `reminders` id. */
  reminders: readonly { id: string; offset: number; dueAt: number }[];
};

/** The types a send can be about, and the statuses it cannot (a draft is not frozen; a void document is never sent). Credit and debit notes are sent too (LD15). */
const inList = (xs: readonly string[]) => `(${xs.map((x) => `'${x}'`).join(", ")})`;
/** One source in core (review L6): every invoice-family type is sent, and core `REMINDER_TYPES` are chased. */
const SENDABLE_TYPES = inList(INVOICE_FLOW_TYPES);
const REMINDED_TYPES = inList(REMINDER_TYPES);

/**
 * The statements of a send, for the caller's own `db.batch()` (after its audit row, with the same guard, or in the care issue's batch after the freeze): the
 * `document_sends` rows (`version_group_id` is the document's own id: an invoice has no versions) and, on the first send, the reminders. Each statement is
 * written ALL OR NONE: the document must be a frozen, not void, invoice-family document of this client (in the care issue, frozen by this very batch), the
 * client not anonymised, and every named contact must still be a contact of the client with portal access (the count of valid contacts equals the list). The
 * reminders are guarded on the first send row existing, so a refused send writes none, and are `INSERT OR IGNORE` on the unique `(document_id, offset_days)`
 * key, so a second first-send can never double them. `queued_at` stays NULL: the email waits for the PDF (the render step or the send route queues it).
 * ?1 document, ?2 rows JSON, ?3 attach (null: the client's), ?4 kind, ?5 created by, ?6 now, ?7 frozen at (null: any).
 */
export function invoiceSendStatements(db: D1Database, a: InvoiceSendArgs): D1PreparedStatement[] {
  const valid = `d.id = ?1 AND d.type IN ${SENDABLE_TYPES} AND d.frozen_at IS NOT NULL AND d.status <> 'void' AND d.voided_at IS NULL AND (?7 IS NULL OR d.frozen_at = ?7)
       AND NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = d.client_id AND z.anonymised_at IS NOT NULL)
       AND (SELECT count(*) FROM contacts c2 WHERE c2.client_id = d.client_id AND c2.portal_access = 1 AND c2.can_see_finance = 1 AND c2.anonymised_at IS NULL AND c2.id IN (SELECT json_extract(value, '$.contactId') FROM json_each(?2))) = json_array_length(?2)`;
  const rows = JSON.stringify(a.rows);
  const first = a.rows[0];
  const sends = db
    .prepare(
      `INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, queued_at, created_by, created_at)
       SELECT json_extract(j.value, '$.id'), d.id, d.id, d.client_id, c.id, lower(c.email), coalesce(?3, (SELECT cl.attach_pdf FROM clients cl WHERE cl.id = d.client_id)), ?4, NULL, ?5, ?6
       FROM documents d JOIN json_each(?2) j
         JOIN contacts c ON c.id = json_extract(j.value, '$.contactId') AND c.client_id = d.client_id AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL
       WHERE ${valid}`,
    )
    .bind(
      a.documentId,
      rows,
      a.attachPdf === null ? null : a.attachPdf ? 1 : 0,
      a.kind,
      a.createdBy,
      a.now,
      a.frozenAt,
    );
  if (a.reminders.length === 0 || !first) return [sends];
  const reminders = db
    .prepare(
      `INSERT OR IGNORE INTO reminders (id, document_id, offset_days, due_at, created_at)
       SELECT json_extract(j.value, '$.id'), d.id, json_extract(j.value, '$.offset'), json_extract(j.value, '$.dueAt'), ?3
       FROM documents d JOIN json_each(?2) j
       WHERE d.id = ?1 AND d.type IN ${REMINDED_TYPES} AND d.frozen_at IS NOT NULL AND d.status <> 'void'
         AND EXISTS (SELECT 1 FROM document_sends s WHERE s.id = ?4 AND s.document_id = d.id)`,
    )
    .bind(a.documentId, JSON.stringify(a.reminders), a.now, first.id);
  return [sends, reminders];
}
