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
import type { InvoiceIssuerSnapshot, IssuerSnapshot, RecipientSnapshot } from "./schema/documents.ts";

/** The two frozen blocks of a sent document, for a caller that builds them (type only: nothing of the schema reaches a Worker bundle). */
export type { InvoiceIssuerSnapshot, IssuerSnapshot, RecipientSnapshot };

export type SendArgs = {
  documentId: string;
  /** The numbering series of the document type (core `SERIES_OF`). */
  series: string;
  /** The FY token the number is taken in ("2627"); ignored for a later version (it keeps its first version's). */
  fy: string;
  /** `sqlPrintfPattern(format)` of the settings' numbering format for the series. */
  pattern: string;
  argOrder: readonly ["fy", "n"] | readonly ["n", "fy"];
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
         AND NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = documents.client_id AND z.anonymised_at IS NOT NULL)${approval}${recipientGuard}
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
 * this content. A refusal (an expired step-up, a decided or expired request) leaves the batch aborted and nothing written. `system` actors
 * (the care-plan auto-issue, M5.4) are added by their milestone.
 */
export type IssueAuthority =
  | { kind: "owner"; sessionId: string }
  | { kind: "approval"; sessionId: string; approvalId: string };

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
  /** ISO dates: the IST day of the issue, and the due date. */
  issueDate: string;
  dueDate: string;
  recipient: RecipientSnapshot;
  issuer: InvoiceIssuerSnapshot;
  computedJson: string;
  snapshotSha256: string;
  issuedBy: string;
  /** The newest `invoice` terms version (the footer notes) at the read; none is allowed. */
  termsVersionId: string | null;
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
  };
  authority: IssueAuthority;
  /** The words of the requester's bell when an issue request was pending (interim wording, 07-R decides): the title up to the number, and the link up to the id. */
  bell: { title: string; linkPrefix: string };
};

/** The issue instant's freeze test, for the statements that follow it: this very batch froze the document. */
const FROZEN_BY_THIS_BATCH =
  "EXISTS (SELECT 1 FROM documents n WHERE n.id = ?1 AND n.status = 'issued' AND n.frozen_at = ?2)";

/**
 * The invoice issue batch, in the same two parts as `sendStatements` around the request's audit row:
 *   main      = [ guard, counter row, counter take, the FREEZE UPDATE ... RETURNING number_display, number ]
 *   postAudit = [ issue_result UNGUARDED, the milestone to 'invoiced', the pending `issue` approval to 'approved', the requester's bell ]
 * Every condition is in the freeze statement's WHERE (a read only explains a refusal), so a stale save, a changed setting, a changed client,
 * a full series, or an authority that is gone writes NOTHING: `issue_result` aborts the batch, the counter rolls back with it. The number is
 * outside the seal (it is assigned here); `balance_minor` starts at the total (LD17: M5 writes no payments). Exactly as many values as the
 * highest placeholder are bound (D1 refuses more).
 */
export function invoiceIssueStatements(db: D1Database, a: InvoiceIssueArgs): SendStatements {
  const nextNo = "(SELECT next_no - 1 FROM doc_counters WHERE series = ?2 AND fy = ?3)";
  const printfArgs = a.argOrder[0] === "fy" ? `?3, ${nextNo}` : `${nextNo}, ?3`;
  const owner =
    "EXISTS (SELECT 1 FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id WHERE s.id = ?24 AND s.revoked_at IS NULL AND s.step_up_until > ?5 AND u.role = 'owner' AND u.status = 'active')";
  const approval =
    a.authority.kind === "approval"
      ? " AND EXISTS (SELECT 1 FROM approvals ap WHERE ap.id = ?25 AND ap.document_id = documents.id AND ap.kind = 'issue' AND ap.status = 'pending' AND ap.content_sha256 = documents.content_sha256)"
      : "";
  // ?1 id, ?2 series, ?3 fy, ?4 pattern, ?5 now, ?6 issue date, ?7 due date, ?8 recipient, ?9 issuer, ?10 computed, ?11 snapshot sha, ?12 issued by,
  // ?13 terms version, ?14 expected updated_at, ?15 expected content sha, ?16 numbering, ?17 company, ?18 tax, ?19 payment terms versions, ?20 bank
  // stamp, ?21 client updated_at, ?22 highest number, ?23 type, ?24 session, and for an approval ?25 the approval id.
  const freeze = db
    .prepare(
      `UPDATE documents SET series = ?2, fy = ?3, number = ${nextNo}, number_display = printf(?4, ${printfArgs}),
         status = 'issued', frozen_at = ?5, issue_date = ?6, due_date = ?7, recipient = ?8, issuer = ?9, computed = ?10,
         snapshot_sha256 = ?11, issued_by = ?12, terms_version_id = ?13, balance_minor = total_minor, updated_at = ?5
       WHERE id = ?1 AND type = ?23 AND status = 'draft' AND frozen_at IS NULL AND updated_at = ?14 AND content_sha256 = ?15
         AND (SELECT version FROM settings WHERE key = 'numbering') IS ?16
         AND (SELECT version FROM settings WHERE key = 'company') IS ?17
         AND (SELECT version FROM settings WHERE key = 'tax') IS ?18
         AND (SELECT version FROM settings WHERE key = 'payment_terms') IS ?19
         AND (SELECT max(updated_at) FROM bank_accounts WHERE active = 1) IS ?20
         AND (SELECT updated_at FROM clients WHERE id = documents.client_id) = ?21
         AND NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = documents.client_id AND z.anonymised_at IS NOT NULL)
         AND ${nextNo} <= ?22
         AND ${owner}${approval}
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
      a.authority.sessionId,
      ...(a.authority.kind === "approval" ? [a.authority.approvalId] : []),
    );
  return {
    main: [guardStatement(db, a.documentId), ...counterStatements(db, a.series, a.fy), freeze],
    postAudit: [
      issueResultStatement(db, a.documentId, a.series, a.fy),
      // The milestone this invoice was made from is now invoiced; `delivered_at` was set when it became ready to bill (LD12) and is kept.
      db
        .prepare(
          `UPDATE milestones SET status = 'invoiced', delivered_at = coalesce(delivered_at, ?2), updated_at = ?2
           WHERE document_id = ?1 AND status = 'ready_to_bill' AND ${FROZEN_BY_THIS_BATCH}`,
        )
        .bind(a.documentId, a.now),
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
             ?4 || ' ' || (SELECT number_display FROM documents WHERE id = ?1), ?5 || ?1
           FROM approvals r JOIN staff_users u ON u.id = r.requested_by AND u.status = 'active'
           WHERE r.document_id = ?1 AND r.kind = 'issue' AND r.status = 'approved' AND r.decided_at = ?2 AND r.decided_by = ?3 AND r.requested_by <> ?3
             AND ${FROZEN_BY_THIS_BATCH}`,
        )
        .bind(a.documentId, a.now, a.issuedBy, a.bell.title, a.bell.linkPrefix),
    ],
  };
}
