// Payment receipts: the issue batch and the reads (M6.5; ADM-PAY-09, ADM-SET-04, JOB-PDF-01; run file A, C `issueReceipt`, L3 to L5, L34, L39). Plain SQL text and
// statement builders for the invoices Worker's `BillingJobs.issueReceipt` (its own batch, never inside a confirm batch, L3); subpath export
// (`@techaust/db/receipts`): no Drizzle schema, no zod.
//
// The issue batch is the M5.1 issue shape (docs/05 §5.4) with every guard in the main statement:
//   main      = [ the counter row of (receipt, FY), its take, the INSERT of the frozen receipt (number = the take; every guard in its WHERE) ];
//   audit     = `receipt.issue`, actor system, written only when the INSERT wrote the row (the caller's batch);
//   postAudit = [ `issue_result` UNGUARDED (a refused INSERT aborts the batch, the counter's take rolls back: no number is burned), the payment's set-once link ].
// A receipt is a `documents` row of type `receipt`, id `rct_` + the payment's id (the primary key: one per payment; a race aborts on it and the caller re-reads
// `already_issued`), series `receipt`, no parent, no tax, `total_minor` = the payment's amount, `header_extras.receiptOf` sealed (`snapshot_sha256`). It is not a GST
// document (Researched 2026-11-03, s.31(3)(d) CGST Act and Rule 50 CGST Rules as quoted in the GST Council flyer ch. 6 (08-C RA-39)); the trigger
// `documents_receipt_insert` (0070) holds the same rules.
import type { GuardSql } from "./log.ts";
import { istFyOfMsSql, paymentRefundedInFullSql } from "./sql-rules.ts";

export type { GuardSql };

/** The numbering series of a receipt (core `SERIES.receipt`: `TH/RCT/{FY}/{N}` by default). */
export const RECEIPT_SERIES_SQL = "receipt";

export type ReceiptIssueArgs = {
  paymentId: string;
  /** `rct_` + the payment's id (core `receiptIdOf`). */
  receiptId: string;
  /** The FY token of the issue day ("2627"). */
  fy: string;
  /** `sqlPrintfPattern(format)` of the receipt series' numbering format, and the order of its two arguments. */
  pattern: string;
  argOrder: readonly ["fy", "n"] | readonly ["n", "fy"];
  /** `maxNumber(format)`: a number past it refuses the issue (`series_full`), as an invoice's. */
  maxNumber: number;
  /** The `numbering` settings row's version read with the format (null: no row); a change in between refuses the issue. */
  numberingVersion: number | null;
  /** The ISO IST day of the issue: the receipt date (L4). */
  issueDate: string;
  /** JSON of `{ receiptOf }` (core `receiptHeaderOf`), and the seal of `receiptOf` (core `receiptSealOf`). */
  headerExtras: string;
  sealSha256: string;
  /** What the header was made from (the payment's amount, currency, client): the INSERT freezes only while they still hold. */
  amountMinor: number;
  currency: "INR" | "USD";
  clientId: string;
  now: number;
};

export type ReceiptIssueStatements = { main: D1PreparedStatement[]; postAudit: D1PreparedStatement[] };

/**
 * The receipt's issue batch (L3, L4). The INSERT's WHERE holds every guard: the payment is confirmed money received (never TDS, L5), of this client, currency and
 * amount, not withdrawn, has no receipt yet, the client is not anonymised, the numbering settings did not change since they were read, and the series has room.
 * Binds: counter `?1` series, `?2` FY; INSERT `?1`..`?13`.
 */
export function receiptIssueStatements(db: D1Database, a: ReceiptIssueArgs): ReceiptIssueStatements {
  if (!Number.isSafeInteger(a.maxNumber) || a.maxNumber < 1)
    throw new RangeError(`maxNumber must be a whole number of at least 1, not ${a.maxNumber}`);
  const nextNo = "(SELECT next_no - 1 FROM doc_counters WHERE series = ?2 AND fy = ?3)";
  const printfArgs = a.argOrder[0] === "fy" ? `?3, ${nextNo}` : `${nextNo}, ?3`;
  const insert = db
    .prepare(
      `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, issue_date, total_minor, header_extras, snapshot_sha256,
         frozen_at, created_at, updated_at)
       SELECT ?1, 'receipt', 'issued', p.client_id, p.currency, ?2, ?3, ${nextNo}, printf(?4, ${printfArgs}), ?5, p.amount_minor, ?6, ?7, ?8, ?8, ?8
       FROM payments p JOIN clients k ON k.id = p.client_id
       WHERE p.id = ?9 AND ?1 = 'rct_' || p.id AND p.status = 'confirmed' AND p.kind = 'payment' AND p.receipt_document_id IS NULL
         AND p.client_id = ?10 AND p.currency = ?11 AND p.amount_minor = ?12 AND k.anonymised_at IS NULL
         AND (SELECT version FROM settings WHERE key = 'numbering') IS ?13
         AND ${nextNo} BETWEEN 1 AND ${a.maxNumber}
         AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.id = ?1)`,
    )
    .bind(
      a.receiptId,
      RECEIPT_SERIES_SQL,
      a.fy,
      a.pattern,
      a.issueDate,
      a.headerExtras,
      a.sealSha256,
      a.now,
      a.paymentId,
      a.clientId,
      a.currency,
      a.amountMinor,
      a.numberingVersion,
    );
  return {
    main: [
      db
        .prepare("INSERT INTO doc_counters (series, fy, next_no) VALUES (?1, ?2, 1) ON CONFLICT DO NOTHING")
        .bind(RECEIPT_SERIES_SQL, a.fy),
      db
        .prepare("UPDATE doc_counters SET next_no = next_no + 1 WHERE series = ?1 AND fy = ?2")
        .bind(RECEIPT_SERIES_SQL, a.fy),
      insert,
    ],
    postAudit: [
      db
        .prepare("INSERT INTO issue_result (document_id, series, fy) SELECT ?1, ?2, ?3")
        .bind(a.receiptId, RECEIPT_SERIES_SQL, a.fy),
      // The payment names its receipt, set once (trigger `payments_receipt_link`), only for the receipt this very batch froze.
      db
        .prepare(
          "UPDATE payments SET receipt_document_id = ?2 WHERE id = ?1 AND receipt_document_id IS NULL AND EXISTS (SELECT 1 FROM documents r WHERE r.id = ?2 AND r.frozen_at = ?3)",
        )
        .bind(a.paymentId, a.receiptId, a.now),
    ],
  };
}

/**
 * What the issue reads first (one batch): the payment (confirmed, kind, amount, currency, client, mode, reference, provider, received day, verified time, its
 * receipt), the client (name, GSTIN, anonymised), what it holds on each document with the number and type, and its refunds that succeeded (finding 12). `?1` the payment.
 */
export const RECEIPT_PAYMENT_SQL = `SELECT p.id, p.client_id, p.kind, p.status, p.provider, p.currency, p.amount_minor, p.received_on, p.mode, p.reference_norm, p.verified_at,
       p.receipt_document_id, coalesce(k.legal_name, k.display_name) AS client_name, k.gstin AS client_gstin, k.anonymised_at,
       (SELECT coalesce(sum(r.amount_minor), 0) FROM payment_refunds r INDEXED BY payment_refunds_payment WHERE r.payment_id = p.id AND r.status = 'succeeded') AS refunded_minor,
       (SELECT 1 FROM documents x WHERE x.id = 'rct_' || p.id) AS receipt_exists
   FROM payments p JOIN clients k ON k.id = p.client_id WHERE p.id = ?1`;

/** The payment's net holdings by document at issue (`?1`), with each document's number and type (the receipt's "Applied to" lines). */
export const RECEIPT_ALLOCATIONS_SQL = `SELECT a.document_id, d.number_display, d.type, sum(CASE a.kind WHEN 'allocate' THEN a.amount_minor ELSE -a.amount_minor END) AS held
   FROM payment_allocations a INDEXED BY payment_allocations_payment JOIN documents d ON d.id = a.document_id
   WHERE a.payment_id = ?1 GROUP BY a.document_id, d.number_display, d.type ORDER BY d.number_display, a.document_id`;

/** M6–M7 audit AU3 (B0 7, B6 L4): after this many refused issues under the same numbering settings, the sweep leaves a payment out (one owners' bell). */
export const RECEIPT_ISSUE_MAX_FAILURES = 3;

/**
 * `receipt.sweep` (L3): confirmed money received still without a receipt, confirmed before `?1` (UTC ms), at most 20, through `payments_receipt_due`.
 * A client anonymised never gets a receipt, so its payments are left out (early check 2, finding 5: otherwise 20 of them would fill every sweep for ever).
 * M6–M7 audit AU3 (B0 7, B6 L4): never tried first, then the least recently tried (`receipt_tried_at`), then the oldest confirmation; a payment whose issue was
 * refused `RECEIPT_ISSUE_MAX_FAILURES` times under the current numbering settings is left out (a full series no longer blocks every other receipt for ever),
 * and comes back once the numbering settings change (a wider format). AU38 (early check L3): a payment left out for a full series (`series_full`) also comes
 * back once the FY of its last try is earlier than the FY of `?1` (the series is per FY, so a new FY has room again). `?1` is the sweep's cut-off (its run time
 * less `RECEIPT_SWEEP_AFTER_MS`), so on 1 April the payment returns within that margin.
 */
export const RECEIPTS_DUE_SQL = `SELECT p.id FROM payments p INDEXED BY payments_receipt_due
   WHERE p.status = 'confirmed' AND p.kind = 'payment' AND p.receipt_document_id IS NULL AND p.verified_at < ?1
     AND NOT EXISTS (SELECT 1 FROM clients k WHERE k.id = p.client_id AND k.anonymised_at IS NOT NULL)
     AND (p.receipt_failures < ${RECEIPT_ISSUE_MAX_FAILURES} OR p.receipt_fail_version IS NOT (SELECT version FROM settings WHERE key = 'numbering')
       OR (p.receipt_fail_reason = 'series_full' AND ${istFyOfMsSql("p.receipt_tried_at")} < ${istFyOfMsSql("?1")}))
   ORDER BY coalesce(p.receipt_tried_at, 0), p.verified_at, p.id LIMIT 20`;

/**
 * M6–M7 audit AU3 (B0 7, B6 L4): a refused receipt issue (`issueReceipt` answered `not_eligible` for a payment that is due): one more failure under the numbering
 * settings' version `?4` (a new version starts the count again at 1), the time and the reason (`series_full`, `changed`, a header code). Then, in the same
 * batch, ONE owners' bell when this very write made it the `RECEIPT_ISSUE_MAX_FAILURES`th failure (kind `receipt.blocked`, the payment, `?2` the title):
 * guarded on the row now holding exactly that count at exactly this instant, so a later try writes no second bell. Binds `?1` payment, `?2` reason, `?3` now,
 * `?4` version; the bell `?1` payment, `?2` title, `?3` now, `?4` link.
 */
export function receiptFailureStatements(
  db: D1Database,
  a: {
    paymentId: string;
    reason: string;
    numberingVersion: number | null;
    now: number;
    bellTitle: string;
    link: string;
  },
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE payments SET receipt_failures = CASE WHEN receipt_fail_version IS ?4 THEN receipt_failures + 1 ELSE 1 END, receipt_tried_at = ?3,
           receipt_fail_reason = ?2, receipt_fail_version = ?4
         WHERE id = ?1 AND status = 'confirmed' AND kind = 'payment' AND receipt_document_id IS NULL`,
      )
      .bind(a.paymentId, a.reason.slice(0, 32), a.now, a.numberingVersion),
    db
      .prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
         SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'receipt.blocked', 'payment', ?1, ?2, ?4 FROM staff_users u
         WHERE u.status = 'active' AND u.role = 'owner'
           AND EXISTS (SELECT 1 FROM payments bp WHERE bp.id = ?1 AND bp.receipt_failures = ${RECEIPT_ISSUE_MAX_FAILURES} AND bp.receipt_tried_at = ?3)`,
      )
      .bind(a.paymentId, a.bellTitle, a.now, a.link),
  ];
}

/**
 * A payment's receipt (`?1` payment): its number, day, status and PDF state (the Payments panel's "Receipt being prepared"), and whether the payment has been
 * refunded in full (M7.2 review 1, finding 5: "Send receipt again" is hidden then; the route refuses it with 409 `receipt_refunded`).
 */
export const RECEIPT_OF_PAYMENT_SQL = `SELECT r.id, r.number_display, r.issue_date, r.status, r.pdf_sha256 IS NOT NULL AS has_pdf, r.voided_at,
     coalesce((SELECT ${paymentRefundedInFullSql("p")} FROM payments p WHERE p.id = ?1), 0) AS refunded_in_full
   FROM documents r WHERE r.id = 'rct_' || ?1 AND r.type = 'receipt'`;

/**
 * The receipt PDFs still to render (L39: their own partial index), at most 20: issued receipts of clients not anonymised only (early check 2, findings 4 and 5: a
 * void receipt or an erased client's is never rendered, so neither may hold a place in the sweep). Review part 1, finding 4, as M4.4's `SWEEP_SQL` (jobs `pdf.ts`):
 * only receipts issued at or before `?1` (UTC ms; the sweep binds its instant less `RECEIPT_SWEEP_AFTER_MS`, so a render already queued is never doubled), never one
 * whose PDF failed on `?2` IST nights (`pdf_failures`) or that has a refusal bell (`pdf.refused`: a bad seal is never tried again), the least recently tried
 * first (`pdf_failures.last_attempt_at`, never tried counts as 0), then the oldest.
 */
export const RECEIPT_PDF_PENDING_SQL = `SELECT r.id FROM documents r INDEXED BY documents_receipt_pdf_pending LEFT JOIN pdf_failures f ON f.document_id = r.id
   WHERE r.frozen_at IS NOT NULL AND r.pdf_sha256 IS NULL AND r.type = 'receipt' AND r.status = 'issued' AND r.frozen_at <= ?1
     AND coalesce(f.nights, 0) < ?2
     AND NOT EXISTS (SELECT 1 FROM clients k WHERE k.id = r.client_id AND k.anonymised_at IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.entity_type = 'document' AND n.entity_id = r.id AND n.kind = 'pdf.refused')
   ORDER BY coalesce(f.last_attempt_at, 0), r.frozen_at, r.id LIMIT 20`;
