// The ledger's statements (M6.1; ADM-PAY-05, ADM-PAY-06, ADM-INV-02, ADM-INV-09, ADM-INV-16, ADM-INV-17, ADM-APR-01, Q60; run file A.6 and C). Plain SQL text and
// statement builders for the caller's own `db.batch()` (the admin finance Worker's `mutate`, and the advance batch in `issue.ts`). Subpath export
// (`@techaust/db/ledger`): no Drizzle schema, no zod, so a Worker importing it stays small.
//
// Every change is ONE batch, in the `mutate` shape (apps/admin/worker/context.ts):
//   main      = the one conditional statement whose WHERE holds EVERY guard (the authority in SQL, the stale-read stamp, the anonymised client, the bounds);
//   audit     = written by `mutate` only when the main statement changed a row;
//   side      = the allocation rows, the approval and bells, then the recompute, each guarded on the audit row (`GuardSql`, bound after the statement's own values);
//   last      = `ledgerResultStatement`, NOT guarded: it aborts the whole batch unless the ledger adds up (the `issue_result` pattern), so a partial write can never
//               stay (a zero-row recompute, a stale allocation, a drifted figure). When the main statement matched nothing, the side statements write nothing and
//               the post-condition sees an unchanged, consistent ledger, so the batch succeeds with nothing written and `mutate` answers false (the route's 409).
// The recompute is one statement over the documents touched, never an increment: a replay or a concurrent change cannot double count.
import type { GuardSql } from "./log.ts";
import { femaDueSql, settingsBinds } from "./realisation.ts";
import {
  checkoutCapturingSql,
  LEDGER_STATUSES_SQL,
  ledgerStatusCaseSql,
  livePaidSql,
  liveTdsSql,
  PAYABLE_TYPES_SQL,
  paymentBlocksVoidSql,
  paymentDocumentsSql,
  paymentForDocumentSql,
  paymentFreeSql,
  paymentNetSql,
  paymentPendingForSql,
  paymentRecordedSql,
  paymentRefundedSql,
  SQL_CURRENCIES,
} from "./sql-rules.ts";

export type { GuardSql };
/** The shared SQL of the ledger rules (also used by the triggers of 0060). */
export {
  LEDGER_STATUSES_SQL,
  ledgerStatusCaseSql,
  livePaidSql,
  liveTdsSql,
  PAYABLE_TYPES_SQL,
  paymentBlocksVoidSql,
  paymentForDocumentSql,
  paymentFreeSql,
  paymentNetSql,
  paymentPendingForSql,
  paymentRecordedSql,
  paymentRefundedSql,
};

/** A guard's SQL at the first placeholder after `used` values, and its values. */
const guarded = (g: GuardSql | undefined, used: number): { sql: string; params: readonly unknown[] } =>
  g ? { sql: ` AND ${g.sql(used + 1)}`, params: g.params } : { sql: "", params: [] };

/** The client of row `alias` is not anonymised (an anonymised client locks every write). */
const clientLive = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = ${alias}.client_id AND z.anonymised_at IS NOT NULL)`;

/** A live session of an active member (`s` the session placeholder, `now` the instant), of the roles listed; `stepUp` also needs a fresh step-up (Q2). */
const sessionSql = (s: string, now: string, roles: readonly string[], stepUp: boolean, member?: string) =>
  `EXISTS (SELECT 1 FROM staff_sessions ss JOIN staff_users su ON su.id = ss.user_id WHERE ss.id = ${s} AND ss.revoked_at IS NULL AND ss.idle_expires_at > ${now} AND ss.abs_expires_at > ${now}${stepUp ? ` AND ss.step_up_until > ${now}` : ""} AND su.status = 'active' AND su.role IN (${roles.map((r) => `'${r}'`).join(", ")})${member ? ` AND su.id = ${member}` : ""})`;
/** The member behind session `s`. */
const sessionUser = (s: string) => `(SELECT ss.user_id FROM staff_sessions ss WHERE ss.id = ${s})`;

// ---- the recompute and the post-condition -------------------------------------------------------------------------------------------------------------

/**
 * What a recompute or a post-condition covers: every document the payments listed have an allocation row on, plus the documents listed (early check A8: a
 * list, so "Use credit" passes every source payment).
 */
export type LedgerTarget = {
  readonly paymentIds?: readonly string[];
  readonly documentIds?: readonly string[];
};

const targetIds =
  "SELECT value AS id FROM json_each(?1) UNION SELECT document_id FROM payment_allocations WHERE payment_id IN (SELECT value FROM json_each(?2))";

/**
 * The ledger recompute (run file A.6): for each frozen, not void tax invoice, export invoice or debit note of the target, `paid` = Σ allocate − Σ release over
 * confirmed `payment` rows, `tds` = Σ allocate over confirmed `tds` rows, `balance = max(0, total − paid − credited − tds)`, the status from the CASE twin of core
 * `ledgerStatusOf(total, paid, credited, tds)` (a void, converted or draft row keeps its status: only frozen ledger statuses move), and `updated_at =
 * max(now, updated_at + 1)` so a stale read is always refused. One statement writes all of them, so `documents_ledger_identity` sees the row whole. A proforma is
 * never recomputed: its paid amount is the advance batch's (M5.2). `?1` the JSON list of documents, `?2` the JSON list of payments, `?3` now, then the guard.
 */
export function recomputeStatement(
  db: D1Database,
  t: LedgerTarget,
  now: number,
  g?: GuardSql,
): D1PreparedStatement {
  const gs = guarded(g, 3);
  return db
    .prepare(
      `UPDATE documents SET paid_minor = r.paid, tds_minor = r.tds, balance_minor = max(0, documents.total_minor - r.paid - documents.credited_minor - r.tds),
         status = CASE WHEN documents.status IN ${LEDGER_STATUSES_SQL} THEN ${ledgerStatusCaseSql("documents.total_minor", "(r.paid + r.tds)", "documents.credited_minor")} ELSE documents.status END,
         updated_at = max(?3, documents.updated_at + 1)
       FROM (SELECT t.id, ${livePaidSql("t.id")} AS paid, ${liveTdsSql("t.id")} AS tds FROM (${targetIds}) t) AS r
       WHERE documents.id = r.id AND documents.frozen_at IS NOT NULL AND documents.type IN ${PAYABLE_TYPES_SQL} AND documents.status <> 'void'${gs.sql}`,
    )
    .bind(JSON.stringify(t.documentIds ?? []), JSON.stringify(t.paymentIds ?? []), now, ...gs.params);
}

/** `INSERT INTO ledger_result`: the post-condition, LAST in the batch and never guarded (see the header). `?1` the JSON list of documents, `?2` of payments. */
export function ledgerResultStatement(db: D1Database, t: LedgerTarget): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ledger_result (payment_ids, document_ids) SELECT ?2, (SELECT json_group_array(t.id) FROM (${targetIds}) t)`,
    )
    .bind(JSON.stringify(t.documentIds ?? []), JSON.stringify(t.paymentIds ?? []));
}

/** One allocation row to write (ids are UUIDv7 picked by the caller; the trigger `payment_allocations_bounds` checks each row as it lands). */
export type AllocationRow = {
  readonly id: string;
  readonly paymentId: string;
  readonly documentId: string;
  readonly amountMinor: number;
  readonly kind: "allocate" | "release";
};

/** The allocation rows, each guarded (normally on the audit row). `who` is the member (null for a gateway in M6.2). */
export function allocationStatements(
  db: D1Database,
  rows: readonly AllocationRow[],
  who: string | null,
  now: number,
  g?: GuardSql,
): D1PreparedStatement[] {
  return rows.map((r) => {
    const gs = guarded(g, 7);
    return db
      .prepare(
        `INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_by, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE 1 = 1${gs.sql}`,
      )
      .bind(r.id, r.paymentId, r.documentId, r.amountMinor, r.kind, who, now, ...gs.params);
  });
}

/**
 * The same rows in ONE statement (code review finding 3): "Use credit" may draw on many sources and "Move excess to credit" may give back from many payments, so
 * the batch stays a fixed number of statements however many rows it writes (D1 Free: 50 queries per invocation, every batch statement counted; the T7 budget of
 * 45). The rows land one by one in list order, so `payment_allocations_bounds` checks each as it lands, exactly as with `allocationStatements`. `?1` the JSON
 * list of rows, `?2` the member, `?3` now, then the guard. Nothing is written for an empty list.
 */
export function allocationsInsertStatement(
  db: D1Database,
  rows: readonly AllocationRow[],
  who: string | null,
  now: number,
  g?: GuardSql,
): D1PreparedStatement {
  const gs = guarded(g, 3);
  return db
    .prepare(
      `INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_by, created_at)
       SELECT json_extract(j.value, '$.id'), json_extract(j.value, '$.paymentId'), json_extract(j.value, '$.documentId'), json_extract(j.value, '$.amountMinor'),
              json_extract(j.value, '$.kind'), ?2, ?3
       FROM json_each(?1) j WHERE 1 = 1${gs.sql} ORDER BY j.key`,
    )
    .bind(
      JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          paymentId: r.paymentId,
          documentId: r.documentId,
          amountMinor: r.amountMinor,
          kind: r.kind,
        })),
      ),
      who,
      now,
      ...gs.params,
    );
}

// ---- record (POST /payments) --------------------------------------------------------------------------------------------------------------------------

export type RecordPaymentArgs = {
  /** The UUIDv7 the SPA picked (L12): the same id again inserts nothing (the route answers 409 `already_recorded`). */
  id: string;
  clientId: string;
  kind: "payment" | "tds";
  /** `confirmed` for the Owner (with a live step-up, Q2), `pending_verification` for Staff. */
  status: "confirmed" | "pending_verification";
  currency: "INR" | "USD";
  amountMinor: number;
  chargesMinor: number;
  receivedOn: string;
  mode: string | null;
  /** `normaliseReference` of the typed reference, or null. */
  referenceNorm: string | null;
  inrReceivedMinor: number | null;
  /** Staff's allocations as JSON `[{documentId, amountMinor}]` (pending only; null for the Owner, whose allocations are rows). */
  requestedAllocations: string | null;
  tds: { section: string; rateBp: number; certificateNo: string | null; certificateOn: string | null } | null;
  note: string | null;
  recordedBy: string;
  sessionId: string;
  now: number;
  /** L12: the user confirmed past a reference already seen. */
  confirmDuplicate: boolean;
};

/**
 * The main statement of a record: one `INSERT ... SELECT` whose WHERE holds every guard: the id is new; the client is live and of this currency; the reference
 * was not seen on a pending or confirmed payment (unless confirmed past, L12); the session is live and belongs to the recorder, an Owner with a fresh step-up for
 * a confirmed entry (Q2) or a Staff member for a pending one (early check A6: an Owner never records a pending entry). The triggers hold the shape (TDS rules, the insert state). Binds `?1`..`?21`.
 * L38 (merge plan R4): no requested proforma is void (voided or withdrawn between the route's read and this write), so a Staff entry never asks for a proforma
 * that is no longer issued; `json_each(NULL)` has no rows, so the Owner's entry (no requested allocations) is untouched.
 */
export function recordPaymentStatement(db: D1Database, a: RecordPaymentArgs): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm, inr_received_minor,
         requested_allocations, tds_section, tds_rate_bp, tds_certificate_no, tds_certificate_on, note, recorded_by, recorded_at, verified_by, verified_at)
       SELECT ?1, ?2, ?3, 'manual', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19,
         CASE ?4 WHEN 'confirmed' THEN ?18 END, CASE ?4 WHEN 'confirmed' THEN ?19 END
       WHERE NOT EXISTS (SELECT 1 FROM payments x WHERE x.id = ?1)
         AND EXISTS (SELECT 1 FROM clients c WHERE c.id = ?2 AND c.anonymised_at IS NULL AND c.currency = ?5)
         AND (?21 = 1 OR ?10 IS NULL OR NOT EXISTS (SELECT 1 FROM payments r WHERE r.reference_norm = ?10 AND r.status IN ('pending_verification', 'confirmed')))
         AND NOT EXISTS (SELECT 1 FROM json_each(?12) rj JOIN documents rd ON rd.id = json_extract(rj.value, '$.documentId') WHERE rd.type = 'proforma' AND rd.status = 'void')
         AND CASE ?4 WHEN 'confirmed' THEN ${sessionSql("?20", "?19", ["owner"], true, "?18")} ELSE ${sessionSql("?20", "?19", ["staff"], false, "?18")} END`,
    )
    .bind(
      a.id,
      a.clientId,
      a.kind,
      a.status,
      a.currency,
      a.amountMinor,
      a.chargesMinor,
      a.receivedOn,
      a.mode,
      a.referenceNorm,
      a.inrReceivedMinor,
      a.requestedAllocations,
      a.tds?.section ?? null,
      a.tds?.rateBp ?? null,
      a.tds?.certificateNo ?? null,
      a.tds?.certificateOn ?? null,
      a.note,
      a.recordedBy,
      a.now,
      a.sessionId,
      a.confirmDuplicate ? 1 : 0,
    );
}

/** The bell text and link the caller supplies (the words are 07-ZH's; nothing here invents copy). */
export type Bell = { readonly title: string; readonly link: string };

/**
 * A Staff entry (pending): the `payment_verify` approval (one per pending payment: `approvals_payment_pending`) and a bell for every active Owner (`INSERT OR
 * IGNORE`: one per owner and payment), both guarded. Kind `payment.verify`, entity `payment`.
 */
export function paymentApprovalStatements(
  db: D1Database,
  a: {
    approvalId: string;
    paymentId: string;
    requestedBy: string;
    contentSha256: string;
    now: number;
    bell: Bell;
  },
  g: GuardSql,
): D1PreparedStatement[] {
  const g1 = guarded(g, 5);
  const g2 = guarded(g, 4);
  return [
    db
      .prepare(
        `INSERT INTO approvals (id, kind, document_id, payment_id, requested_by, content_sha256, status, created_at) SELECT ?1, 'payment_verify', NULL, ?2, ?3, ?4, 'pending', ?5 WHERE 1 = 1${g1.sql}`,
      )
      .bind(a.approvalId, a.paymentId, a.requestedBy, a.contentSha256, a.now, ...g1.params),
    db
      .prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
         SELECT 'n_' || lower(hex(randomblob(16))), o.id, 'payment.verify', 'payment', ?1, ?2, ?3
         FROM staff_users o WHERE o.role = 'owner' AND o.status = 'active' AND o.id <> ?4${g2.sql}`,
      )
      .bind(a.paymentId, a.bell.title, a.bell.link, a.requestedBy, ...g2.params),
  ];
}

// ---- verify (POST /payments/:id/verify) ----------------------------------------------------------------------------------------------------------------

/**
 * The main statement of a decision: a PENDING payment read at `expectedRecordedAt`, of a live client, decided by an Owner with a fresh step-up (Q2). Confirm adds
 * the Owner's allocation rows (`allocationStatements`, which may differ from what Staff asked, L6), the recompute and `ledger_result`; both decisions add
 * `decideApprovalStatements`. A second decision changes nothing (409 `payment_not_pending`). Binds `?1` payment, `?2` the new status, `?3` now, `?4` session,
 * `?5` note, `?6` the expected `recorded_at`.
 *
 * M6.3 staging fix 2 (L5): a confirm never moves a payment that asks for a proforma (`paymentProformaSql`): that money is confirmed only by the advance batch
 * (issuing the tax invoice for the payment received), whatever allocations the caller sends. A reject is unchanged.
 */
export function verifyPaymentStatement(
  db: D1Database,
  a: {
    paymentId: string;
    decision: "confirmed" | "rejected";
    now: number;
    sessionId: string;
    note: string | null;
    expectedRecordedAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE payments SET status = ?2, verified_by = ${sessionUser("?4")}, verified_at = ?3, decision_note = ?5
       WHERE id = ?1 AND status = 'pending_verification' AND recorded_at = ?6 AND ${clientLive("payments")} AND ${sessionSql("?4", "?3", ["owner"], true)}
         AND (?2 <> 'confirmed' OR ${paymentProformaSql("payments")} IS NULL)`,
    )
    .bind(a.paymentId, a.decision, a.now, a.sessionId, a.note, a.expectedRecordedAt);
}

/** The pending `payment_verify` approval follows the decision (approved or rejected), and the requester gets a bell (kind `payment.decided`), both guarded. */
export function decideApprovalStatements(
  db: D1Database,
  a: { paymentId: string; decidedBy: string | null; now: number; note: string | null; bell: Bell },
  g: GuardSql,
): D1PreparedStatement[] {
  const g1 = guarded(g, 4);
  const g2 = guarded(g, 3);
  return [
    db
      .prepare(
        `UPDATE approvals SET status = CASE (SELECT p.status FROM payments p WHERE p.id = ?1) WHEN 'confirmed' THEN 'approved' ELSE 'rejected' END, decided_by = ?2, decided_at = ?3, note = ?4
         WHERE payment_id = ?1 AND kind = 'payment_verify' AND status = 'pending' AND (SELECT p.status FROM payments p WHERE p.id = ?1) IN ('confirmed', 'rejected')${g1.sql}`,
      )
      .bind(a.paymentId, a.decidedBy, a.now, a.note, ...g1.params),
    db
      .prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
         SELECT 'n_' || lower(hex(randomblob(16))), p.recorded_by, 'payment.decided', 'payment', p.id, ?2, ?3
         FROM payments p JOIN staff_users u ON u.id = p.recorded_by AND u.status = 'active'
         WHERE p.id = ?1 AND p.recorded_by IS NOT p.verified_by AND p.status IN ('confirmed', 'rejected')${g2.sql}`,
      )
      .bind(a.paymentId, a.bell.title, a.bell.link, ...g2.params),
  ];
}

// ---- withdraw (POST /payments/:id/withdraw, L7) -------------------------------------------------------------------------------------------------------

/**
 * M6.5 (L10, review fix 2): payment `?1` has no refund that is not `failed`: a withdraw would otherwise leave "Collected" subtracting a refund of money never
 * counted. The trigger `payments_withdraw_no_refunds` (0070) holds the same rule; the route answers 409 `refunds_exist` when the withdraw writes nothing.
 */
export const NO_LIVE_REFUND_SQL =
  "NOT EXISTS (SELECT 1 FROM payment_refunds wr INDEXED BY payment_refunds_payment WHERE wr.payment_id = ?1 AND wr.status <> 'failed')";

/**
 * The main statement of a withdraw: a CONFIRMED payment of a live client, by an Owner with a fresh step-up, with a reason, and (M6.5) with no refund that is not failed. A payment that stands for an M5.2
 * advance receipt is never withdrawn here (`advance_receipt_id IS NULL`): its tax invoice was issued because the money arrived, so a credit note is the
 * correction (lead's safe side; listed for the early check). Follow it with `recomputeStatement(db, {paymentIds: [paymentId]}, now, g)` (every document the payment
 * touched) and `ledgerResultStatement(db, {paymentIds: [paymentId]})`. Binds `?1` payment, `?2` now, `?3` session, `?4` reason.
 */
export function withdrawPaymentStatement(
  db: D1Database,
  a: { paymentId: string; now: number; sessionId: string; reason: string },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE payments SET status = 'withdrawn', withdrawn_by = ${sessionUser("?3")}, withdrawn_at = ?2, withdraw_reason = ?4
       WHERE id = ?1 AND status = 'confirmed' AND advance_receipt_id IS NULL AND ${clientLive("payments")} AND ${sessionSql("?3", "?2", ["owner"], true)}
         AND ${NO_LIVE_REFUND_SQL}`,
    )
    .bind(a.paymentId, a.now, a.sessionId, a.reason);
}

// ---- credit: apply and release (L2, L13) ------------------------------------------------------------------------------------------------------------

/** The client's credit in the document's currency, for a document row `d`: what its confirmed payments hold unallocated (derived, no table, L2). */
// M6.5 (L35): the free money of each payment (`paymentFreeSql`: amount − net − refunds not failed).
const creditOf = (d: string) =>
  `(SELECT coalesce(sum(${paymentFreeSql("cp")}), 0) FROM payments cp WHERE cp.client_id = ${d}.client_id AND cp.currency = ${d}.currency AND cp.status = 'confirmed' AND cp.kind = 'payment')`;

/**
 * The main statement of "Use credit" (`apply`) or "Move excess to credit" (`release`): the document is claimed (its `updated_at` moves) only while it is the
 * frozen, live invoice or debit note read (`expectedUpdatedAt`), of a live client, by an Owner with a fresh step-up, and the amount fits: at most the balance and
 * the client's credit (apply), at most the excess (release). The caller then adds the allocation rows (apply: from `CREDIT_SOURCES_SQL`, first in first out,
 * core `creditSources`; release: from `DOCUMENT_HOLDINGS_SQL`), the recompute of the document and `ledger_result` (with every source payment as a target, or
 * the document). Binds `?1` document, `?2` expected `updated_at`, `?3` now, `?4` session, `?5` amount.
 */
export function creditClaimStatement(
  db: D1Database,
  a: {
    kind: "apply" | "release";
    documentId: string;
    expectedUpdatedAt: number;
    now: number;
    sessionId: string;
    amountMinor: number;
  },
): D1PreparedStatement {
  const fits =
    a.kind === "apply"
      ? `?5 <= max(0, documents.total_minor - documents.paid_minor - documents.credited_minor - documents.tds_minor) AND ?5 <= ${creditOf("documents")}`
      : "?5 <= max(0, documents.paid_minor + documents.credited_minor + documents.tds_minor - documents.total_minor)";
  return db
    .prepare(
      `UPDATE documents SET updated_at = max(?3, updated_at + 1)
       WHERE id = ?1 AND updated_at = ?2 AND frozen_at IS NOT NULL AND status <> 'void' AND type IN ${PAYABLE_TYPES_SQL} AND ${clientLive("documents")}
         AND ${sessionSql("?4", "?3", ["owner"], true)} AND ${fits}`,
    )
    .bind(a.documentId, a.expectedUpdatedAt, a.now, a.sessionId, a.amountMinor);
}

// ---- set once: the TDS certificate, the proof (L11, L19) ----------------------------------------------------------------------------------------------

/** The Form 16A number and date of a pending or confirmed TDS entry, set once, by an Owner or Staff member (no fresh code: it moves no money). */
export function tdsCertificateStatement(
  db: D1Database,
  a: { paymentId: string; certificateNo: string; certificateOn: string; sessionId: string; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE payments SET tds_certificate_no = ?2, tds_certificate_on = ?3
       WHERE id = ?1 AND kind = 'tds' AND status IN ('pending_verification', 'confirmed') AND tds_certificate_no IS NULL AND ${clientLive("payments")}
         AND ${sessionSql("?4", "?5", ["owner", "staff"], false)}`,
    )
    .bind(a.paymentId, a.certificateNo, a.certificateOn, a.sessionId, a.now);
}

/**
 * A payment's proof, set once (L10, L11; OPEN (08-C RB-05): which document proves a services export was realised, and does the bank accept a PayPal or Stripe
 * advice? Free-text type plus the file): the DOCS key `payments/<id>/proof-<sha256>` written by the caller first, write-once.
 */
export function proofStatement(
  db: D1Database,
  a: {
    paymentId: string;
    kind: string;
    ref: string | null;
    r2Key: string;
    sha256: string;
    mime: string;
    sessionId: string;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE payments SET proof_kind = ?2, proof_ref = ?3, proof_r2_key = ?4, proof_sha256 = ?5, proof_mime = ?6
       WHERE id = ?1 AND proof_r2_key IS NULL AND status IN ('pending_verification', 'confirmed') AND ${clientLive("payments")}
         AND ${sessionSql("?7", "?8", ["owner", "staff"], false)}`,
    )
    .bind(a.paymentId, a.kind, a.ref, a.r2Key, a.sha256, a.mime, a.sessionId, a.now);
}

// ---- realisation extensions (Q60, L14) ------------------------------------------------------------------------------------------------------------------

/**
 * A FEMA extension granted by the AD bank (Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-04)): for a frozen, not void export invoice of a live
 * client, by an active Owner, to a day LATER than the invoice's current FEMA date (`femaDueSql` over the `tax` settings, earlier extensions included). The GST date
 * follows (Rule 96A(1)(b) CGST Rules (08-C RA-20)). Binds `?1` id, `?2` document, `?3` the new day, `?4` the bank's reference, `?5` the member, `?6` now, `?7` session.
 */
export function realisationExtensionStatement(
  db: D1Database,
  a: {
    id: string;
    documentId: string;
    extendedTo: string;
    bankRef: string;
    recordedBy: string;
    now: number;
    sessionId: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO realisation_extensions (id, document_id, extended_to, bank_ref, recorded_by, created_at)
       SELECT ?1, d.id, ?3, ?4, ?5, ?6 FROM documents d
       WHERE d.id = ?2 AND d.type = 'export_invoice' AND d.frozen_at IS NOT NULL AND d.status <> 'void' AND d.voided_at IS NULL AND ${clientLive("d")}
         AND ?3 > ${femaDueSql("d", settingsBinds("NULL"))}
         AND ${sessionSql("?7", "?6", ["owner"], false, "?5")}`,
    )
    .bind(a.id, a.documentId, a.extendedTo, a.bankRef, a.recordedBy, a.now, a.sessionId);
}

/** The bank's letter of an extension, set once (DOCS key `extensions/<id>/letter-<sha256>`), by an active Owner, while the client is live (early check A5). */
export function extensionLetterStatement(
  db: D1Database,
  a: {
    id: string;
    documentId: string;
    r2Key: string;
    sha256: string;
    mime: string;
    sessionId: string;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE realisation_extensions SET letter_r2_key = ?3, letter_sha256 = ?4, letter_mime = ?5
       WHERE id = ?1 AND document_id = ?2 AND letter_r2_key IS NULL
         AND EXISTS (SELECT 1 FROM documents ld JOIN clients z ON z.id = ld.client_id WHERE ld.id = ?2 AND z.anonymised_at IS NULL)
         AND ${sessionSql("?6", "?7", ["owner"], false)}`,
    )
    .bind(a.id, a.documentId, a.r2Key, a.sha256, a.mime, a.sessionId, a.now);
}

// ---- reads ---------------------------------------------------------------------------------------------------------------------------------------------

/**
 * M6.3 staging fix 2 (L5): the proforma payment `p` is for (`paymentDocumentsSql`), or NULL. Such money is confirmed only by issuing the tax invoice for the payment
 * received, never by the ordinary decision, whatever allocations the dialog sends.
 */
export const paymentProformaSql = (p: string): string =>
  `(SELECT pfd.id FROM documents pfd WHERE pfd.id IN (${paymentDocumentsSql(p)}) AND pfd.type = 'proforma' LIMIT 1)`;

/** Document row `d` (alias) is an issued or part-converted proforma: one whose tax invoice for a payment received can still be issued. */
const issuableProformaSql = (d: string): string =>
  `${d}.type = 'proforma' AND ${d}.frozen_at IS NOT NULL AND ${d}.status IN ('issued', 'converted')`;
/** The row condition of `proformaTakesPaymentSql`: document row `d` (alias) is a proforma that can take payment `p`'s whole amount. */
const takesRowSql = (d: string, p: string): string =>
  `(${issuableProformaSql(d)} AND ${d}.balance_minor >= ${p}.amount_minor)`;

/**
 * M6.3 staging fixes, review M3 (L5; lead's decision 1(b), 2026-11-02): proforma `doc` (an SQL expression for its id) can still take payment `p`'s money (an SQL
 * table name or alias of `payments`) as its tax invoice for a payment received: an issued or part-converted proforma whose balance is at least the whole payment
 * (the advance puts the whole amount on the new invoice). Otherwise no advance can take it, so it never blocks one (`firstWaitingPaymentSql`); money above an
 * issued proforma's balance is held for the M6.5 refund (`proformaOverpaidBySql`: "The client paid more than the proforma's balance. It waits for a refund.").
 * A primary-key seek.
 */
export const proformaTakesPaymentSql = (p: string, doc: string): string =>
  `EXISTS (SELECT 1 FROM documents tpd WHERE tpd.id = ${doc} AND ${takesRowSql("tpd", p)})`;

/**
 * Review M3: payment `p` is more than the balance of proforma `doc` (an SQL expression for its id), an issued or part-converted one: no tax invoice can take it,
 * so it waits for a refund (lead's decision 1(b)). A void or withdrawn proforma is not this case (its money is held for another reason), so it reads false. A
 * primary-key seek.
 */
export const proformaOverpaidBySql = (p: string, doc: string): string =>
  `EXISTS (SELECT 1 FROM documents wrd WHERE wrd.id = ${doc} AND ${issuableProformaSql("wrd")} AND wrd.balance_minor < ${p}.amount_minor)`;

/** Review M3: `proformaOverpaidBySql` for the proforma payment `p` asks for (`paymentProformaSql`); the payment view and the approvals queue read it (pending only). */
export const paymentWaitsRefundSql = (p: string): string => proformaOverpaidBySql(p, paymentProformaSql(p));

/**
 * M6.3 staging fixes 1 and 2 (L5, L12; lead's decisions 1 and 2, 2026-11-02): the FIRST payment waiting for the tax invoice of proforma `doc` of client `client`
 * (SQL expressions): PENDING, kind `payment`, for the proforma (`paymentForDocumentSql`); an online payment before a manual entry, then the oldest. While any
 * waits, that proforma's tax invoice for a payment received is issued only WITH this one ("Confirm by issuing the tax invoice"): never as a new receipt (no
 * `paymentId`) and never with another entry, so the same money is never counted twice and the entries are taken one at a time. Review M3: only a payment the
 * proforma can still take (`proformaTakesPaymentSql`: issued or part-converted, a balance of at least the payment); money above the balance waits for the M6.5
 * refund and blocks no advance (it can't be confirmed by issuing or by the decision either, so it is never counted). Selects `cols` (`id, provider`); a seek of
 * `payments_client`.
 */
export const firstWaitingPaymentSql = (doc: string, client: string, cols = "wp.id, wp.provider"): string =>
  `SELECT ${cols} FROM payments wp INDEXED BY payments_client
   WHERE wp.client_id = ${client} AND wp.status = 'pending_verification' AND wp.kind = 'payment' AND ${paymentForDocumentSql("wp", doc)}
     AND ${proformaTakesPaymentSql("wp", doc)}
   ORDER BY wp.provider = 'manual', wp.recorded_at, wp.id LIMIT 1`;

/** The first payment waiting for proforma `?1` (its client read from the proforma), for the 409 `online_payment_waiting` / `payment_waiting` and `details.paymentId`. */
export const WAITING_PAYMENT_SQL = /* @__PURE__ */ (() =>
  firstWaitingPaymentSql("?1", "(SELECT wd.client_id FROM documents wd WHERE wd.id = ?1)"))();

/** L12: the newest pending or confirmed payment with this reference (`?1`, normalised), with its day and client, for the soft 409 `reference_seen`. */
export const PAYMENT_REFERENCE_SEEN_SQL = `SELECT p.id, p.received_on, p.client_id, c.code AS client_code, c.display_name AS client_name
   FROM payments p INDEXED BY payments_reference JOIN clients c ON c.id = p.client_id
   WHERE p.reference_norm = ?1 AND p.status IN ('pending_verification', 'confirmed') ORDER BY p.received_on DESC, p.id DESC LIMIT 1`;

/**
 * A client's credit by currency (`client` an SQL expression for the client's id): confirmed `payment` rows' amount minus what they hold net. One seek of
 * `payments_client`. Early check 2, finding 10: a builder, so a caller keyed by something else (the Payments panel, by the document) never edits this SQL's text.
 */
export const clientCreditSql = (client: string): string =>
  `SELECT p.currency, coalesce(sum(${paymentFreeSql("p")}), 0) AS credit
   FROM payments p INDEXED BY payments_client WHERE p.client_id = ${client} AND p.status = 'confirmed' AND p.kind = 'payment' GROUP BY p.currency ORDER BY p.currency`;

/** A client's credit by currency (`?1` the client). */
// Built by a call, so marked pure: a Worker that imports this module without the name (the admin API, through `issue.ts`) drops it from its bundle.
export const CLIENT_CREDIT_SQL = /* @__PURE__ */ clientCreditSql("?1");

/**
 * Where credit comes from (`?1` client, `?2` currency): confirmed payments holding something free, first in first out (core `creditSources`), at most 50. M6.5
 * (L35): `refunded` is what each has refunded or is refunding (`paymentRefundedSql`); the free money is `amount_minor - net - refunded` (`paymentFreeSql`).
 */
export const CREDIT_SOURCES_SQL = `SELECT s.id, s.received_on, s.amount_minor, s.net, s.refunded FROM (
     SELECT p.id, p.received_on, p.amount_minor, ${paymentNetSql("p.id")} AS net, ${paymentRefundedSql("p.id")} AS refunded
     FROM payments p INDEXED BY payments_client
     WHERE p.client_id = ?1 AND p.currency = ?2 AND p.status = 'confirmed' AND p.kind = 'payment') s
   WHERE s.amount_minor - s.net - s.refunded > 0
   ORDER BY s.received_on, s.id LIMIT 50`;

/** The most sources one "Use credit" draws on (`CREDIT_DRAW_SQL`); more would be refused as `exceeds_credit`. */
export const CREDIT_DRAW_MAX = 500;

/**
 * The sources "Use credit" draws `?3` from (`?1` client, `?2` currency; code review finding 3): the same confirmed `payment` rows as `CREDIT_SOURCES_SQL`, first
 * in first out, but only as many as cover the amount: a row is listed while the credit before it is below `?3` (a running sum over `payments_client`'s order). ONE
 * read however many sources there are, at most `CREDIT_DRAW_MAX` rows; each row's net is evaluated once. Core `creditSources` then picks from these rows.
 */
// M6.5 (L35): each row's free money is `amount_minor - net - refunded` (the twin of `paymentFreeSql`, evaluated once per row).
export const CREDIT_DRAW_SQL = `SELECT w.id, w.received_on, w.amount_minor, w.net, w.refunded FROM (
     SELECT s.id, s.received_on, s.amount_minor, s.net, s.refunded, sum(s.amount_minor - s.net - s.refunded) OVER (ORDER BY s.received_on, s.id ROWS UNBOUNDED PRECEDING) AS upto FROM (
       SELECT p.id, p.received_on, p.amount_minor, ${paymentNetSql("p.id")} AS net, ${paymentRefundedSql("p.id")} AS refunded
       FROM payments p INDEXED BY payments_client
       WHERE p.client_id = ?1 AND p.currency = ?2 AND p.status = 'confirmed' AND p.kind = 'payment') s
     WHERE s.amount_minor - s.net - s.refunded > 0) w
   WHERE w.upto - (w.amount_minor - w.net - w.refunded) < ?3 ORDER BY w.received_on, w.id LIMIT ${CREDIT_DRAW_MAX}`;

/** The ledger panel of a document (`?1`): each payment with a row on it (with its own gateway, M6.5 review P2-4), what it holds there net, oldest money first. */
export const DOCUMENT_HOLDINGS_SQL = `SELECT a.payment_id, p.kind, p.status, p.provider, p.received_on, p.mode, p.reference_norm, p.currency, p.amount_minor, p.tds_section, p.tds_rate_bp,
       p.tds_certificate_no, p.proof_r2_key IS NOT NULL AS has_proof,
       sum(CASE a.kind WHEN 'allocate' THEN a.amount_minor ELSE -a.amount_minor END) AS held
   FROM payment_allocations a INDEXED BY payment_allocations_document JOIN payments p ON p.id = a.payment_id
   WHERE a.document_id = ?1 GROUP BY a.payment_id ORDER BY p.received_on, a.payment_id`;

/** The Owner's "Payments to check" list: pending payments oldest first, keyset `(recorded_at, id)` with `?1`/`?2` (the first page binds -1 and ''), at most 51. */
export const PENDING_PAYMENTS_SQL = `SELECT p.id, p.client_id, c.code AS client_code, c.display_name AS client_name, p.kind, p.currency, p.amount_minor, p.received_on, p.mode,
       p.reference_norm, p.requested_allocations, p.recorded_by, p.recorded_at
   FROM payments p INDEXED BY payments_pending JOIN clients c ON c.id = p.client_id
   WHERE p.status = 'pending_verification' AND (p.recorded_at > ?1 OR (p.recorded_at = ?1 AND p.id > ?2))
   ORDER BY p.recorded_at, p.id LIMIT 51`;

/** How many payments wait for the Owner (the dashboard tile; read through the partial index only). */
export const PENDING_PAYMENTS_COUNT_SQL =
  "SELECT count(*) AS n FROM payments p INDEXED BY payments_pending WHERE p.status = 'pending_verification'";

/**
 * M6.2 (fix round 3 item 3): the same read, in ONE pass, telling the kinds apart as bits: 1 a pending manual entry (core `payment_pending`: the Owner rejects
 * it), 2 a pending gateway payment (core `payment_pending_gateway`: it can't be rejected; its tax invoice is issued, or it is resolved in Needs review); 0 none.
 * Decode with `PENDING_MANUAL` / `PENDING_GATEWAY` / `PENDING_CAPTURE`. M6.4 (L24; early check 1 finding 8): 4, a PayPal checkout of the document whose capture
 * PayPal holds or a capture call has claimed (core `payment_pending_capture`: no payment row yet, so nothing to confirm; its own staff line).
 */
export const paymentPendingKindsSql = (doc: string, client: string): string =>
  `(SELECT coalesce(max(vp.provider = 'manual'), 0) + 2 * coalesce(max(vp.provider <> 'manual'), 0) + 4 * (${checkoutCapturingSql(doc)}) FROM payments vp INDEXED BY payments_client
     WHERE vp.client_id = ${client} AND vp.status = 'pending_verification' AND ${paymentForDocumentSql("vp", doc)})`;
export const PENDING_MANUAL = 1;
export const PENDING_GATEWAY = 2;
export const PENDING_CAPTURE = 4;

/** L17, L32 (the void facts): for document `?1` of client `?2`, whether a PENDING payment asks for it (`pending`) and whether an allocation row names it (`recorded`). */
export const PAYMENT_ASKS_FOR_DOCUMENT_SQL = /* @__PURE__ */ (() =>
  `SELECT ${paymentPendingForSql("?1", "?2")} AS pending, ${paymentRecordedSql("?1")} AS recorded`)();

/**
 * M6.5 (L9): the refunds "Collected" subtracts: SUCCEEDED refunds of confirmed money-received rows, by the IST day they succeeded (`settled_on`), read through
 * `payment_refunds_settled`. A pending payment refunded in full (L33) ends `rejected`: it was never collected, so its refund is not subtracted either.
 */
const SETTLED_REFUNDS_FROM = `FROM payment_refunds f INDEXED BY payment_refunds_settled JOIN payments fp ON fp.id = f.payment_id
         WHERE f.status = 'succeeded' AND f.settled_on >= ?1 AND f.settled_on <= ?2 AND fp.status = 'confirmed' AND fp.kind = 'payment'`;

/**
 * "Collected": confirmed `payment` rows by currency received from `?1` to `?2` (ISO, inclusive), read through `payments_confirmed` (the reference twin of the tile),
 * less (M6.5, L9) the refunds that succeeded in the range (`SETTLED_REFUNDS_FROM`). `n` counts the payments; a currency has a row when it has a payment or a refund.
 */
export const COLLECTED_SQL = `SELECT x.currency, sum(x.amount) AS collected, sum(x.n) AS n FROM (
     SELECT p.currency, p.amount_minor AS amount, 1 AS n
       FROM payments p INDEXED BY payments_confirmed WHERE p.status = 'confirmed' AND p.kind = 'payment' AND p.received_on >= ?1 AND p.received_on <= ?2
     UNION ALL
     SELECT f.currency, -f.amount_minor, 0
       ${SETTLED_REFUNDS_FROM}) x
   GROUP BY x.currency ORDER BY x.currency`;

/** The currencies a payment can be in (`SQL_CURRENCIES`, the schema's `CURRENCY_CODES`; a db test pins the two together). */
export const COLLECTED_CURRENCIES = SQL_CURRENCIES;

const collectedPick = (prefix: string, row = "t") =>
  `CASE c.currency ${COLLECTED_CURRENCIES.map((c) => `WHEN '${c}' THEN ${row}.${prefix}_${c}`).join(" ")} END`;

/**
 * The dashboard's "Collected" tile (07-ZH line 16; early check 2, finding 6): this FY (`?1` to `?2`) and this IST month (`?3` to `?4`) in ONE pass over the
 * FY's confirmed `payment` rows, one row per currency that has any (`fy_collected`, `fy_n`, `month_collected`, `month_n`). No GROUP BY: D1 counts every row
 * a temporary GROUP BY b-tree takes in and gives back, which doubled the reads (measured: 2,000 for 1,000 payments grouped, 1,000 flat); the sums per currency
 * are columns of one aggregate row, turned into rows afterwards. Equal to `COLLECTED_SQL` over each range (a test holds the twins together). M6.5 (L9): less the
 * refunds that succeeded in the FY and in the month: one more aggregate row `r` over `payment_refunds_settled` (no GROUP BY either); a currency with only a refund
 * in the FY has a row too.
 */
export const COLLECTED_TILE_SQL = /* @__PURE__ */ (() => {
  const cols = COLLECTED_CURRENCIES.flatMap((c) => [
    `coalesce(sum(CASE WHEN p.currency = '${c}' THEN p.amount_minor END), 0) AS fy_${c}`,
    `count(CASE WHEN p.currency = '${c}' THEN 1 END) AS fyn_${c}`,
    `coalesce(sum(CASE WHEN p.currency = '${c}' AND p.received_on >= ?3 AND p.received_on <= ?4 THEN p.amount_minor END), 0) AS m_${c}`,
    `count(CASE WHEN p.currency = '${c}' AND p.received_on >= ?3 AND p.received_on <= ?4 THEN 1 END) AS mn_${c}`,
  ]).join(", ");
  const refundCols = COLLECTED_CURRENCIES.flatMap((c) => [
    `coalesce(sum(CASE WHEN f.currency = '${c}' THEN f.amount_minor END), 0) AS fy_${c}`,
    `count(CASE WHEN f.currency = '${c}' THEN 1 END) AS fyn_${c}`,
    `coalesce(sum(CASE WHEN f.currency = '${c}' AND f.settled_on >= ?3 AND f.settled_on <= ?4 THEN f.amount_minor END), 0) AS m_${c}`,
  ]).join(", ");
  return `SELECT c.currency, ${collectedPick("fy")} - ${collectedPick("fy", "r")} AS fy_collected, ${collectedPick("fyn")} AS fy_n,
       ${collectedPick("m")} - ${collectedPick("m", "r")} AS month_collected, ${collectedPick("mn")} AS month_n
   FROM (SELECT ${cols}
         FROM payments p INDEXED BY payments_confirmed WHERE p.status = 'confirmed' AND p.kind = 'payment' AND p.received_on >= ?1 AND p.received_on <= ?2) t
   JOIN (SELECT ${refundCols}
         ${SETTLED_REFUNDS_FROM}) r
   JOIN (${COLLECTED_CURRENCIES.map((c) => `SELECT '${c}' AS currency`).join(" UNION ALL ")}) c
   WHERE ${collectedPick("fyn")} > 0 OR ${collectedPick("fyn", "r")} > 0 ORDER BY c.currency`;
})();
