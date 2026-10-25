// The send/issue batch of docs/05 §5.4 as statements for the caller's own `db.batch()` (M4.3; M5 reuses it for invoices). Subpath export
// (`@techaust/db/issue`) so a Worker importing it doesn't pull in the Drizzle schema.
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
import type { IssuerSnapshot, RecipientSnapshot } from "./schema/documents.ts";

/** The two frozen blocks of a sent document, for a caller that builds them (type only: nothing of the schema reaches a Worker bundle). */
export type { IssuerSnapshot, RecipientSnapshot };

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
};

export type SendStatements = {
  main: D1PreparedStatement[];
  /** Goes after the audit row: `issue_result` (unguarded) and the 'revised' move of the earlier versions. */
  postAudit: D1PreparedStatement[];
};

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
  const approval = a.expected.approvalNeeded
    ? " AND EXISTS (SELECT 1 FROM approvals ap WHERE ap.document_id = documents.id AND ap.kind = 'discount' AND ap.status = 'approved' AND ap.content_sha256 = documents.content_sha256)"
    : "";
  // ?1 id, ?2 series, ?3 fy, ?4 group, ?5 pattern, ?6 now, ?7 issue date, ?8 valid until, ?9 recipient, ?10 issuer, ?11 computed,
  // ?12 snapshot sha, ?13 issued by, ?14 expected updated_at, ?15 expected content sha, ?16 numbering version. Exactly 16 values are
  // bound, whichever branch is built (D1 refuses more values than the highest placeholder).
  const freeze = db
    .prepare(
      `UPDATE documents SET series = ${numbering.series}, fy = ${numbering.fy}, number = ${numbering.number}, number_display = ${numbering.display},
         status = 'sent', frozen_at = ?6, sent_at = ?6, issue_date = ?7, valid_until = ?8, recipient = ?9, issuer = ?10, computed = ?11,
         snapshot_sha256 = ?12, issued_by = ?13, updated_at = ?6
       WHERE id = ?1 AND status = 'draft' AND frozen_at IS NULL AND updated_at = ?14 AND content_sha256 = ?15
         AND (SELECT version FROM settings WHERE key = 'numbering') IS ?16
         AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.version_group_id = ?4 AND x.status = 'accepted')${approval}`,
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
    );
  const main: D1PreparedStatement[] = [
    db.prepare("INSERT INTO issue_guard (document_id) VALUES (?1)").bind(a.documentId),
  ];
  if (a.isFirstVersion) {
    main.push(
      db
        .prepare("INSERT INTO doc_counters (series, fy, next_no) VALUES (?1, ?2, 1) ON CONFLICT DO NOTHING")
        .bind(a.series, a.fy),
      db
        .prepare("UPDATE doc_counters SET next_no = next_no + 1 WHERE series = ?1 AND fy = ?2")
        .bind(a.series, a.fy),
    );
  }
  main.push(freeze);
  // issue_result's own arguments are the series and FY the document ended up with: for a later version, those of its first version.
  const resultSeries = a.isFirstVersion ? "?2" : first("series");
  const resultFy = a.isFirstVersion ? "?3" : first("fy");
  return {
    main,
    postAudit: [
      db
        .prepare(`INSERT INTO issue_result (document_id, series, fy) SELECT ?1, ${resultSeries}, ${resultFy}`)
        .bind(
          ...(a.isFirstVersion ? [a.documentId, a.series, a.fy] : [a.documentId, a.series, a.fy, a.groupId]),
        ),
      // The earlier versions that were still open are superseded. Written only for a document that is now frozen and sent.
      db
        .prepare(
          `UPDATE documents SET status = 'revised' WHERE version_group_id = ?1 AND version < ?2 AND status IN ('sent', 'viewed')
             AND EXISTS (SELECT 1 FROM documents n WHERE n.id = ?3 AND n.status = 'sent' AND n.frozen_at IS NOT NULL)`,
        )
        .bind(a.groupId, a.version, a.documentId),
    ],
  };
}
