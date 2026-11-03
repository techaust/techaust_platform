// Refunds, settlements, bank matches and FEMA reductions: the statements (M6.5; ADM-PAY-08, -10, ADM-INV-09, -17; run file A, C, L1, L2, L8 to L11, L33 to L39).
// Plain SQL text and statement builders for the caller's own `db.batch()` (the admin finance Worker's `mutate` and its RPC entrypoints); subpath export
// (`@techaust/db/refunds`): no Drizzle schema, no zod, so a Worker importing it stays small. The triggers of `refund_triggers` (0070) hold every rule again; each
// main statement carries its rules in its WHERE first, so a refused request writes nothing and aborts no batch (the route re-reads to explain it).
//
// A refund, batch 1 (C step 2, the `mutate` shape; ≈ 7 statements):
//   main  = `refundInsertStatement` (gateway `requested`; manual, outside or chargeback `succeeded`), every guard in its WHERE;
//   audit = written by `mutate` only when the main statement inserted the row;
//   side  = `refundSideStatements`: from a document, the `release` of exactly the amount, then the set-once link (review fix 1: the refund row first, with its
//           `release_allocation_id` NULL, so the foreign key never points at a row not written yet), then the recompute of the document; each guarded on the audit row;
//   last  = `ledgerResultStatement` (unguarded): net + refunds ≤ amount, and the document's figures equal the recompute.
// The recompute is unchanged (L1): the release lowers `paid_minor`. A refund only ever lowers settled money, so no batch here can complete a project's payment: the
// T11 deed hook is not appended (`packages/core/test/deed-hooks.test.ts` lists this file's builder with that reason).
import { ledgerResultStatement, recomputeStatement } from "./ledger.ts";
import type { GuardSql } from "./log.ts";
import { livePaidSql, liveTdsSql, PAYABLE_TYPES_SQL, paymentFreeSql, paymentNetSql } from "./sql-rules.ts";

export type { GuardSql };

/** A guard's SQL at the first placeholder after `used` values, and its values. */
const guarded = (g: GuardSql | undefined, used: number): { sql: string; params: readonly unknown[] } =>
  g ? { sql: ` AND ${g.sql(used + 1)}`, params: g.params } : { sql: "", params: [] };

/** A live session of an active Owner (`s` the session placeholder, `now` the instant), with a fresh step-up when `stepUp`. */
const ownerSessionSql = (s: string, now: string, stepUp: boolean) =>
  `EXISTS (SELECT 1 FROM staff_sessions ss JOIN staff_users su ON su.id = ss.user_id WHERE ss.id = ${s} AND ss.revoked_at IS NULL AND ss.idle_expires_at > ${now} AND ss.abs_expires_at > ${now}${stepUp ? ` AND ss.step_up_until > ${now}` : ""} AND su.status = 'active' AND su.role = 'owner')`;
const sessionUser = (s: string) => `(SELECT ss.user_id FROM staff_sessions ss WHERE ss.id = ${s})`;

// ---- batch 1: the refund row -----------------------------------------------------------------------------------------------------------------------------

export type RefundInsertArgs = {
  /** The UUIDv7 the SPA picked once per dialog: the idempotency key at our end and at the gateway's (L37). */
  id: string;
  paymentId: string;
  /** L33 `pending`, or the confirmed money's `credit` or `document`. */
  from: "credit" | "document" | "pending";
  documentId: string | null;
  creditNoteId: string | null;
  amountMinor: number;
  reasonCode: string;
  note: string | null;
  /** How the money goes back: through the payment's gateway (`requested`), by our bank transfer, or recorded after the fact (outside, a lost dispute). */
  way:
    | { kind: "gateway" }
    | {
        kind: "manual";
        mode: string;
        referenceNorm: string;
        paidOn: string;
        paidTo: "original" | "own_account";
      }
    | { kind: "outside"; origin: "outside" | "chargeback"; providerRefundId: string; settledOn: string };
  sessionId: string;
  now: number;
  /** The IST day of `now` (a manual refund succeeds the day it is recorded). */
  today: string;
};

/**
 * The main statement of a refund (C step 2): one `INSERT ... SELECT` whose WHERE holds every guard: the id is new; the session is a live Owner's with a fresh
 * step-up (`refunds.issue`); the client is live; no refund of the payment is open (L8); and the source, as `payment_refunds_bounds` holds it: from `credit`,
 * confirmed money received with at least the amount free (`paymentFreeSql`); from `document`, at most the document's excess and what this payment holds on it (the
 * document issued, live, payable and the client's, the credit note one of its own; a lost dispute, origin `chargeback`, needs no excess: L40); from `pending`
 * (L33), a pending gateway payment's whole amount through its own gateway, while none of its refunds stands (early check 1, finding 1). Zero rows: the route re-reads and answers 409 (`exceeds_refundable`, `exceeds_holding`, `refund_in_progress`, `client_gone`, `payment_not_confirmed`).
 * Binds `?1`..`?16` (`?15` for a gateway refund, which is not settled yet).
 */
export function refundInsertStatement(db: D1Database, a: RefundInsertArgs): D1PreparedStatement {
  const w = a.way;
  const manual = w.kind === "manual" ? w : null;
  const outside = w.kind === "outside" ? w : null;
  // ?1 id, ?2 payment, ?3 document, ?4 credit note, ?5 amount, ?6 origin, ?7 mode, ?8 recipient, ?9 reason, ?10 reference, ?11 paid on, ?12 the gateway's id,
  // ?13 note, ?14 session, ?15 now, ?16 the settled IST day.
  const source =
    a.from === "credit"
      ? `p.status = 'confirmed' AND p.kind = 'payment' AND ?3 IS NULL AND ?4 IS NULL AND ?5 <= ${paymentFreeSql("p")}`
      : a.from === "document"
        ? `p.status = 'confirmed' AND p.kind = 'payment' AND EXISTS (SELECT 1 FROM documents d WHERE d.id = ?3 AND d.client_id = p.client_id AND d.currency = p.currency
             AND d.frozen_at IS NOT NULL AND d.status <> 'void' AND d.type IN ${PAYABLE_TYPES_SQL}
             AND (?5 <= ${livePaidSql("d.id")} + d.credited_minor + ${liveTdsSql("d.id")} - d.total_minor OR ?6 = 'chargeback') AND ?5 <= ${paymentNetSql("p.id", "d.id")})
           AND (?4 IS NULL OR EXISTS (SELECT 1 FROM documents cn WHERE cn.id = ?4 AND cn.type = 'credit_note' AND cn.parent_id = ?3 AND cn.frozen_at IS NOT NULL))`
        : `p.status = 'pending_verification' AND p.kind = 'payment' AND p.provider <> 'manual' AND ?3 IS NULL AND ?4 IS NULL AND ?5 = p.amount_minor
           AND NOT EXISTS (SELECT 1 FROM payment_refunds pr INDEXED BY payment_refunds_payment WHERE pr.payment_id = p.id AND pr.status <> 'failed')${w.kind === "manual" ? " AND 1 = 0" : ""}`;
  const provider = w.kind === "manual" ? "'manual'" : "p.provider";
  const status = w.kind === "gateway" ? "requested" : "succeeded";
  const settled = status === "succeeded";
  return db
    .prepare(
      `INSERT INTO payment_refunds (id, payment_id, client_id, document_id, credit_note_id, provider, origin, status, mode, paid_to, reason_code, currency, amount_minor,
         reference_norm, paid_on, provider_refund_id, note, requested_by, requested_at, settled_at, settled_on, updated_at)
       SELECT ?1, p.id, p.client_id, ?3, ?4, ${provider}, ?6, '${status}', ?7, ?8, ?9, p.currency, ?5, ?10, ?11, ?12, ?13, ${sessionUser("?14")}, ?15,
         ${settled ? "?15" : "NULL"}, ${settled ? "?16" : "NULL"}, ?15
       FROM payments p JOIN clients k ON k.id = p.client_id
       WHERE p.id = ?2 AND k.anonymised_at IS NULL AND NOT EXISTS (SELECT 1 FROM payment_refunds x WHERE x.id = ?1)
         AND NOT EXISTS (SELECT 1 FROM payment_refunds o INDEXED BY payment_refunds_payment WHERE o.payment_id = p.id AND o.status IN ('requested', 'processing'))
         AND ${w.kind === "manual" ? "1 = 1" : "p.provider <> 'manual'"}
         AND ${ownerSessionSql("?14", "?15", true)} AND ${source}`,
    )
    .bind(
      a.id,
      a.paymentId,
      a.documentId,
      a.creditNoteId,
      a.amountMinor,
      outside ? outside.origin : "owner",
      manual ? manual.mode : null,
      manual ? manual.paidTo : w.kind === "gateway" ? "original" : null,
      a.reasonCode,
      manual ? manual.referenceNorm : null,
      manual ? manual.paidOn : null,
      outside ? outside.providerRefundId : null,
      a.note,
      a.sessionId,
      a.now,
      // ?16 only when the refund is recorded settled (D1 refuses a value no placeholder takes).
      // A manual refund settles on the day it was paid (early check 1, finding 9), an outside one on the gateway's day.
      ...(settled ? [outside ? outside.settledOn : manual ? manual.paidOn : a.today] : []),
    );
}

/**
 * The side statements of batch 1 (review fix 1; C step 2), each guarded on the audit row: from a document, the `release` row (id `releaseId`) of exactly the
 * refund's amount, then the set-once link of the refund to it, then the recompute of the document (L1: the release lowers `paid_minor`). From credit or pending:
 * nothing (no ledger row moves; the refund is subtracted wherever free money is read). Follow them with `refundBatchResult` (unguarded).
 */
export function refundSideStatements(
  db: D1Database,
  a: {
    refundId: string;
    paymentId: string;
    documentId: string | null;
    amountMinor: number;
    releaseId: string;
    now: number;
  },
  g: GuardSql,
): D1PreparedStatement[] {
  if (a.documentId === null) return [];
  const g1 = guarded(g, 5);
  const g2 = guarded(g, 3);
  return [
    db
      .prepare(
        `INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_by, created_at)
         SELECT ?1, r.payment_id, r.document_id, r.amount_minor, 'release', r.requested_by, ?5 FROM payment_refunds r
         WHERE r.id = ?4 AND r.payment_id = ?2 AND r.document_id = ?3 AND r.release_allocation_id IS NULL${g1.sql}`,
      )
      .bind(a.releaseId, a.paymentId, a.documentId, a.refundId, a.now, ...g1.params),
    db
      .prepare(
        `UPDATE payment_refunds SET release_allocation_id = ?2, updated_at = max(?3, updated_at) WHERE id = ?1 AND release_allocation_id IS NULL${g2.sql}`,
      )
      .bind(a.refundId, a.releaseId, a.now, ...g2.params),
    recomputeStatement(db, { documentIds: [a.documentId] }, a.now, g),
  ];
}

/**
 * The post-conditions of a refund batch (unguarded, last): `ledger_result` (the payment's net + refunds ≤ its amount, and the document's figures, if any, equal
 * the recompute), then `refund_result` (a refund from a document is linked to its release: early check 1, finding 8).
 */
export const refundBatchResult = (
  db: D1Database,
  a: { paymentId: string; documentId: string | null; refundId: string },
): D1PreparedStatement[] => [
  ledgerResultStatement(db, { paymentIds: [a.paymentId], documentIds: a.documentId ? [a.documentId] : [] }),
  refundResultStatement(db, [a.refundId]),
];

/** `refund_result` (0070, trigger `refund_result_check`): every refund listed that came from a document names its release. Unguarded. */
export const refundResultStatement = (db: D1Database, refundIds: readonly string[]): D1PreparedStatement =>
  db.prepare("INSERT INTO refund_result (refund_ids) VALUES (?1)").bind(JSON.stringify(refundIds));

// ---- batch 2 and the gateway's word: status moves ---------------------------------------------------------------------------------------------------

/**
 * A refund moves by the gateway's word (C step 3, `checkRefund`, a refund event): `processing`, `succeeded` (with the settled instant and IST day) or `failed`
 * (with the gateway's code; the released money stays as credit, never back on the invoice). Only from a status that may move there (core `canMoveRefund`), the
 * gateway's id set once (`coalesce`), one more attempt counted. Zero rows: already moved (a replay). Binds `?1`..`?7`.
 */
export function refundMoveStatement(
  db: D1Database,
  a: {
    refundId: string;
    to: "processing" | "succeeded" | "failed";
    providerRefundId: string | null;
    providerStatus: string | null;
    failureCode: string | null;
    now: number;
    /** The IST day of `now` (with `succeeded`). */
    today: string;
  },
  g?: GuardSql,
): D1PreparedStatement {
  const from = a.to === "processing" ? "('requested')" : "('requested', 'processing')";
  const gs = guarded(g, 7);
  return db
    .prepare(
      `UPDATE payment_refunds SET status = ?2, provider_refund_id = coalesce(provider_refund_id, ?3), provider_status = coalesce(?4, provider_status),
         failure_code = CASE WHEN ?2 = 'failed' THEN ?5 ELSE failure_code END, attempts = attempts + 1, last_attempt_at = ?6, updated_at = max(?6, updated_at),
         settled_at = CASE WHEN ?2 = 'succeeded' THEN ?6 END, settled_on = CASE WHEN ?2 = 'succeeded' THEN ?7 END
       WHERE id = ?1 AND status IN ${from} AND (?3 IS NULL OR provider_refund_id IS NULL OR provider_refund_id = ?3)${gs.sql}`,
    )
    .bind(
      a.refundId,
      a.to,
      a.providerRefundId,
      a.providerStatus,
      a.failureCode,
      a.now,
      a.today,
      ...gs.params,
    );
}

/**
 * A refund's review item of `kind` opens once per refund (early check 2, findings 1c, 2 and 1d: the tenth check, every later one, the dead-letter queue and L42's
 * PayPal cut-off all reach `refund_stuck`; an event seen twice reaches `refund_after_failed` twice): no item of that kind for that refund, open or resolved, exists
 * yet. One seek of `review_items_payment` (the refund's payment). Added to `g` (the batch's own guard), when given.
 */
export function refundItemOnceGuard(
  a: { paymentId: string; refundId: string; kind: string },
  g?: GuardSql,
): GuardSql {
  const once: GuardSql = {
    sql: (at) =>
      `NOT EXISTS (SELECT 1 FROM review_items ri INDEXED BY review_items_payment WHERE ri.payment_id = ?${at} AND ri.kind = ?${at + 1} AND json_extract(ri.facts, '$.refundId') = ?${at + 2})`,
    params: [a.paymentId, a.kind, a.refundId],
  };
  return g
    ? {
        sql: (at) => `${g.sql(at)} AND ${once.sql(at + g.params.length)}`,
        params: [...g.params, ...once.params],
      }
    : once;
}

/** A check that changed nothing at the gateway: one more attempt counted (the sweep's idle clock restarts). Open refunds only. */
export const refundAttemptStatement = (
  db: D1Database,
  a: { refundId: string; now: number },
): D1PreparedStatement =>
  db
    .prepare(
      "UPDATE payment_refunds SET attempts = attempts + 1, last_attempt_at = ?2, updated_at = max(?2, updated_at) WHERE id = ?1 AND status IN ('requested', 'processing')",
    )
    .bind(a.refundId, a.now);

/**
 * L33: once the full refund of a PENDING gateway payment succeeded, the payment is rejected by the system (no member, `verified_at` set; trigger
 * `payments_status_flow` of 0070 allows exactly this). It was never confirmed, so it never counted; it gets no receipt. Guarded, after the move to `succeeded`.
 */
export const pendingRefundedRejectStatement = (
  db: D1Database,
  a: { refundId: string; now: number },
  g?: GuardSql,
): D1PreparedStatement => {
  const gs = guarded(g, 2);
  return db
    .prepare(
      `UPDATE payments SET status = 'rejected', verified_at = ?2
       WHERE id = (SELECT r.payment_id FROM payment_refunds r WHERE r.id = ?1 AND r.status = 'succeeded' AND r.document_id IS NULL) AND status = 'pending_verification'
         AND provider <> 'manual' AND amount_minor = (SELECT r.amount_minor FROM payment_refunds r WHERE r.id = ?1)${gs.sql}`,
    )
    .bind(a.refundId, a.now, ...gs.params);
};

/**
 * Review part 1, finding 1a: the claim a re-post makes BEFORE it sends anything (`checkRefund`, the sweep and the Owner's "Try again"): one more attempt counted
 * and `last_attempt_at` moved to now, only while the refund is still `requested` with no gateway id AND its `last_attempt_at` is still the value the caller read
 * (`seen`, NULL included: `IS`). One row changed: this caller alone may post; zero: a cancel, another re-post or the gateway's word got there first, so nothing is
 * sent. A cancel binds the same `last_attempt_at` (`refundCancelStatement`), so a claim between its read and its write leaves the cancel with zero rows.
 * Binds `?1` refund, `?2` now, `?3` the `last_attempt_at` read.
 */
export const refundRepostClaimStatement = (
  db: D1Database,
  a: { refundId: string; now: number; seen: number | null },
): D1PreparedStatement =>
  db
    .prepare(
      `UPDATE payment_refunds SET attempts = attempts + 1, last_attempt_at = ?2, updated_at = max(?2, updated_at)
       WHERE id = ?1 AND status = 'requested' AND provider_refund_id IS NULL AND last_attempt_at IS ?3`,
    )
    .bind(a.refundId, a.now, a.seen);

/**
 * `cancel` (C step 4): a refund still `requested` is failed by the Owner (step-up) only after the gateway showed no refund for our id (the route fetches first); its
 * code is `cancelled`. Review part 1, finding 1b: only while `last_attempt_at` is still the value the route read before asking the gateway (`seen`): a re-post
 * that claimed the row in between (`refundRepostClaimStatement`) may have a request on its way, so the cancel writes nothing (the route answers 409 `too_soon`).
 * Binds `?1` refund, `?2` now, `?3` session, `?4` the `last_attempt_at` read.
 */
export const refundCancelStatement = (
  db: D1Database,
  a: { refundId: string; now: number; sessionId: string; seen: number | null },
): D1PreparedStatement =>
  db
    .prepare(
      `UPDATE payment_refunds SET status = 'failed', failure_code = 'cancelled', updated_at = max(?2, updated_at)
       WHERE id = ?1 AND status = 'requested' AND provider_refund_id IS NULL AND last_attempt_at IS ?4 AND ${ownerSessionSql("?3", "?2", true)}`,
    )
    .bind(a.refundId, a.now, a.sessionId, a.seen);

// ---- the withdraw's receipt (L10) -------------------------------------------------------------------------------------------------------------------------

/**
 * The +1 statement of a withdraw (L10): the withdrawn payment's receipt, if it has one, is voided (reason `payment_withdrawn`), guarded on the withdraw's audit
 * row; no client email. Trigger `documents_receipt_status` allows the move only once the payment reads withdrawn. Binds `?1` payment, `?2` now, then the guard.
 */
export function receiptVoidStatement(
  db: D1Database,
  a: { paymentId: string; now: number },
  g: GuardSql,
): D1PreparedStatement {
  const gs = guarded(g, 2);
  return db
    .prepare(
      `UPDATE documents SET status = 'void', voided_at = ?2, void_reason = 'payment_withdrawn', updated_at = max(?2, updated_at + 1)
       WHERE id = 'rct_' || ?1 AND type = 'receipt' AND status = 'issued'
         AND EXISTS (SELECT 1 FROM payments vp WHERE vp.id = ?1 AND vp.status = 'withdrawn')${gs.sql}`,
    )
    .bind(a.paymentId, a.now, ...gs.params);
}

// ---- reads ---------------------------------------------------------------------------------------------------------------------------------------------

const REFUND_COLS = `r.id, r.payment_id, r.client_id, r.document_id, r.credit_note_id, r.provider, r.origin, r.status, r.mode, r.paid_to, r.reason_code, r.currency,
       r.amount_minor, r.inr_refunded_minor, r.reference_norm, r.paid_on, r.provider_refund_id, r.provider_status, r.failure_code, r.requested_by, r.requested_at,
       r.attempts, r.last_attempt_at, r.settled_at, r.settled_on, r.updated_at`;

/** One refund by id (`?1`), with its payment's gateway reference and status (what `checkRefund` and the routes read). */
export const REFUND_READ_SQL = `SELECT ${REFUND_COLS}, p.provider_payment_id, p.status AS payment_status, p.amount_minor AS payment_amount_minor
   FROM payment_refunds r JOIN payments p ON p.id = r.payment_id WHERE r.id = ?1`;

/** A payment's refunds (`?1`), newest first (at most a handful: one open at a time). */
export const PAYMENT_REFUNDS_SQL = `SELECT ${REFUND_COLS} FROM payment_refunds r INDEXED BY payment_refunds_payment WHERE r.payment_id = ?1 ORDER BY r.requested_at DESC, r.id DESC`;

/** A refund by the gateway's id (`?1` provider, `?2` its refund id): a refund event names it (L36). */
export const REFUND_BY_PROVIDER_REF_SQL = `SELECT ${REFUND_COLS} FROM payment_refunds r INDEXED BY payment_refunds_provider_ref WHERE r.provider = ?1 AND r.provider_refund_id = ?2`;

/**
 * `refund.sweep`: the open refunds idle since before `?1` (UTC ms), oldest first, at most 20 (through `payment_refunds_pending`). A refund never tried counts as
 * idle only once it was requested before `?1` too, so one still in its route's call is never swept at once (early check 1, finding 3).
 */
export const REFUNDS_IDLE_SQL = `SELECT r.id FROM payment_refunds r INDEXED BY payment_refunds_pending
   WHERE r.status IN ('requested', 'processing') AND ((r.last_attempt_at IS NULL AND r.requested_at < ?1) OR r.last_attempt_at < ?1)
   ORDER BY r.last_attempt_at, r.id LIMIT 20`;

/** The Refunds tab, all statuses: one page newest first, keyset `(requested_at, id)` with `?1`/`?2` (the first page binds a far-future instant and ''), at most 51; `payment_refunds_list`. */
export const REFUNDS_LIST_SQL = `SELECT ${REFUND_COLS}, c.code AS client_code, c.display_name AS client_name
   FROM payment_refunds r INDEXED BY payment_refunds_list JOIN clients c ON c.id = r.client_id
   WHERE r.requested_at < ?1 OR (r.requested_at = ?1 AND r.id < ?2)
   ORDER BY r.requested_at DESC, r.id DESC LIMIT 51`;

/** The Refunds tab filtered by status `?1`: as `REFUNDS_LIST_SQL` with `?2`/`?3` as the keyset, through `payment_refunds_status_list` (early check 1, finding 10). */
export const REFUNDS_LIST_BY_STATUS_SQL = `SELECT ${REFUND_COLS}, c.code AS client_code, c.display_name AS client_name
   FROM payment_refunds r INDEXED BY payment_refunds_status_list JOIN clients c ON c.id = r.client_id
   WHERE r.status = ?1 AND (r.requested_at < ?2 OR (r.requested_at = ?2 AND r.id < ?3))
   ORDER BY r.requested_at DESC, r.id DESC LIMIT 51`;

/**
 * B4 (run file, the client Overview's "Refund in progress"): one client's refunds (`?1`), newest first, keyset `(requested_at, id)` with `?2`/`?3` as
 * `REFUNDS_LIST_SQL`; with `status`, only that status (`?4`). A seek of `payment_refunds_client (client_id, requested_at, id)`: the status is checked on the client's
 * own rows only (a client has a handful of refunds). At most 51.
 */
export const REFUNDS_LIST_BY_CLIENT_SQL = (status: boolean): string =>
  `SELECT ${REFUND_COLS}, c.code AS client_code, c.display_name AS client_name
   FROM payment_refunds r INDEXED BY payment_refunds_client JOIN clients c ON c.id = r.client_id
   WHERE r.client_id = ?1 AND (r.requested_at < ?2 OR (r.requested_at = ?2 AND r.id < ?3))${status ? " AND r.status = ?4" : ""}
   ORDER BY r.requested_at DESC, r.id DESC LIMIT 51`;

// ---- settlements (L11) ---------------------------------------------------------------------------------------------------------------------------------

/** One settlement as the caller read it from the gateway (`GET /v1/settlements/{id}` or the recon's settlement fields). */
export type SettlementRow = {
  id: string;
  settlementId: string;
  utr: string | null;
  amountMinor: number;
  feesMinor: number;
  taxMinor: number;
  settledAt: number | null;
  settledOn: string;
  status: string | null;
};
/** One recon item (core `ReconItem`, with our row id). */
export type SettlementItemRow = {
  id: string;
  entityType: string;
  entityId: string;
  direction: "credit" | "debit";
  amountMinor: number;
  feeMinor: number;
  taxMinor: number;
  settlementId: string | null;
};

/**
 * One recon page in ONE batch of five statements (C `fetchSettlements`; ≈ 5): the settlements (a known one keeps its facts and gets its UTR once, through
 * `ON CONFLICT … DO UPDATE`), the items (one per gateway entity, `unmatched` with no link; a known one is left as it is through `ON CONFLICT … DO NOTHING`), the
 * settlement of an item seen before without one, then the matches: a payment item to OUR payment with the same gateway id and amount (core `matchItem`;
 * `fee_mismatch` when Razorpay's fee or its tax differs from what the payment row recorded; a payment with no fee tax on record has no fee on record and is not
 * compared: early check 1, finding 6), a refund item to our refund with the same gateway id and amount. An item whose amount differs stays unmatched (the
 * "Unmatched" tab). All rows are `provider`'s. Never `INSERT OR IGNORE` (finding 7): a row breaking NOT NULL or a CHECK (a missing day, a negative amount) aborts
 * the batch instead of vanishing; the caller passes only items it read whole (core `readRazorpayRecon`). Binds per statement.
 */
export function settlementPageStatements(
  db: D1Database,
  a: {
    provider: "razorpay";
    settlements: readonly SettlementRow[];
    items: readonly SettlementItemRow[];
    now: number;
  },
): D1PreparedStatement[] {
  const settlements = JSON.stringify(a.settlements);
  const items = JSON.stringify(a.items);
  const ourSettlement = (j: string) =>
    `(SELECT s.id FROM settlements s INDEXED BY settlements_provider_ref WHERE s.provider = ?1 AND s.settlement_id = json_extract(${j}.value, '$.settlementId'))`;
  return [
    db
      .prepare(
        `INSERT INTO settlements (id, provider, settlement_id, utr, currency, amount_minor, fees_minor, tax_minor, settled_at, settled_on, status, fetched_at)
         SELECT json_extract(j.value, '$.id'), ?1, json_extract(j.value, '$.settlementId'), json_extract(j.value, '$.utr'), 'INR', json_extract(j.value, '$.amountMinor'),
           json_extract(j.value, '$.feesMinor'), json_extract(j.value, '$.taxMinor'), json_extract(j.value, '$.settledAt'), json_extract(j.value, '$.settledOn'),
           json_extract(j.value, '$.status'), ?3
         FROM json_each(?2) j WHERE true ORDER BY j.key
         ON CONFLICT (provider, settlement_id) DO UPDATE SET utr = coalesce(settlements.utr, excluded.utr), fetched_at = max(settlements.fetched_at, excluded.fetched_at)`,
      )
      .bind(a.provider, settlements, a.now),
    db
      .prepare(
        `INSERT INTO settlement_items (id, settlement_id, provider, entity_type, entity_id, direction, amount_minor, fee_minor, tax_minor, "match", created_at)
         SELECT json_extract(j.value, '$.id'), ${ourSettlement("j")}, ?1, json_extract(j.value, '$.entityType'), json_extract(j.value, '$.entityId'),
           json_extract(j.value, '$.direction'), json_extract(j.value, '$.amountMinor'), json_extract(j.value, '$.feeMinor'), json_extract(j.value, '$.taxMinor'), 'unmatched', ?3
         FROM json_each(?2) j WHERE true ORDER BY j.key
         ON CONFLICT (provider, entity_type, entity_id) DO NOTHING`,
      )
      .bind(a.provider, items, a.now),
    db
      .prepare(
        `UPDATE settlement_items SET settlement_id = (SELECT ${ourSettlement("j")} FROM json_each(?2) j
             WHERE json_extract(j.value, '$.entityType') = settlement_items.entity_type AND json_extract(j.value, '$.entityId') = settlement_items.entity_id LIMIT 1)
         WHERE provider = ?1 AND settlement_id IS NULL
           AND EXISTS (SELECT 1 FROM json_each(?2) j WHERE json_extract(j.value, '$.entityType') = settlement_items.entity_type
             AND json_extract(j.value, '$.entityId') = settlement_items.entity_id AND json_extract(j.value, '$.settlementId') IS NOT NULL)`,
      )
      .bind(a.provider, items),
    db
      .prepare(
        `UPDATE settlement_items INDEXED BY settlement_items_entity SET "match" = 'matched', payment_id = p.id,
           fee_mismatch = CASE WHEN p.fee_tax_minor IS NOT NULL AND (p.charges_minor IS NOT settlement_items.fee_minor OR p.fee_tax_minor <> settlement_items.tax_minor) THEN 1 ELSE 0 END
         FROM payments p INDEXED BY payments_provider_ref
         WHERE settlement_items.provider = ?1 AND settlement_items."match" = 'unmatched' AND settlement_items.entity_type = 'payment'
           AND p.provider = settlement_items.provider AND p.provider_payment_id = settlement_items.entity_id AND p.amount_minor = settlement_items.amount_minor
           AND settlement_items.entity_id IN (SELECT json_extract(j.value, '$.entityId') FROM json_each(?2) j)`,
      )
      .bind(a.provider, items),
    db
      .prepare(
        `UPDATE settlement_items INDEXED BY settlement_items_entity SET "match" = 'matched', refund_id = r.id
         FROM payment_refunds r INDEXED BY payment_refunds_provider_ref
         WHERE settlement_items.provider = ?1 AND settlement_items."match" = 'unmatched' AND settlement_items.entity_type = 'refund'
           AND r.provider = settlement_items.provider AND r.provider_refund_id = settlement_items.entity_id AND r.amount_minor = settlement_items.amount_minor
           AND settlement_items.entity_id IN (SELECT json_extract(j.value, '$.entityId') FROM json_each(?2) j)`,
      )
      .bind(a.provider, items),
  ];
}

/** The settlements list, newest first, keyset `(settled_on, id)` with `?1`/`?2` (the first page binds '9999-12-31' and ''), with matched and item counts; at most 51. */
export const SETTLEMENTS_SQL = `SELECT s.id, s.provider, s.settlement_id, s.utr, s.currency, s.amount_minor, s.fees_minor, s.tax_minor, s.settled_on, s.status,
       (SELECT count(*) FROM settlement_items i INDEXED BY settlement_items_settlement WHERE i.settlement_id = s.id) AS items,
       (SELECT count(*) FROM settlement_items i INDEXED BY settlement_items_settlement WHERE i.settlement_id = s.id AND i."match" = 'matched') AS matched,
       (SELECT bm.id FROM bank_matches bm INDEXED BY bank_matches_settlement WHERE bm.settlement_id = s.id AND bm.removed_at IS NULL) AS bank_match_id
   FROM settlements s INDEXED BY settlements_settled
   WHERE s.settled_on < ?1 OR (s.settled_on = ?1 AND s.id < ?2)
   ORDER BY s.settled_on DESC, s.id DESC LIMIT 51`;

/** The unmatched settlement items, oldest first, keyset `(created_at, id)` with `?1`/`?2` (first page -1 and ''), through `settlement_items_unmatched`; at most 51. */
export const UNMATCHED_ITEMS_SQL = `SELECT i.id, i.settlement_id, i.provider, i.entity_type, i.entity_id, i.direction, i.amount_minor, i.fee_minor, i.tax_minor, i.created_at
   FROM settlement_items i INDEXED BY settlement_items_unmatched
   WHERE i."match" = 'unmatched' AND (i.created_at > ?1 OR (i.created_at = ?1 AND i.id > ?2))
   ORDER BY i.created_at, i.id LIMIT 51`;

// ---- bank matches (L11) ----------------------------------------------------------------------------------------------------------------------------------

/**
 * "Seen in the bank statement" (`payments.reconcile`, the Owner): one match of a confirmed payment, a settlement or a succeeded refund, only while none is active
 * for it (zero rows: 409 `match_exists`, or the target is not in that state). Binds `?1` id, `?2` kind, `?3` target id, `?4` day, `?5` reference, `?6` session, `?7` now.
 */
export function bankMatchStatement(
  db: D1Database,
  a: {
    id: string;
    kind: "payment" | "settlement" | "refund";
    targetId: string;
    statementOn: string;
    statementRef: string | null;
    sessionId: string;
    now: number;
  },
): D1PreparedStatement {
  const target =
    a.kind === "payment"
      ? "EXISTS (SELECT 1 FROM payments mp WHERE mp.id = ?3 AND mp.status = 'confirmed') AND NOT EXISTS (SELECT 1 FROM bank_matches x INDEXED BY bank_matches_payment WHERE x.payment_id = ?3 AND x.removed_at IS NULL)"
      : a.kind === "refund"
        ? "EXISTS (SELECT 1 FROM payment_refunds mr WHERE mr.id = ?3 AND mr.status = 'succeeded') AND NOT EXISTS (SELECT 1 FROM bank_matches x INDEXED BY bank_matches_refund WHERE x.refund_id = ?3 AND x.removed_at IS NULL)"
        : "EXISTS (SELECT 1 FROM settlements ms WHERE ms.id = ?3) AND NOT EXISTS (SELECT 1 FROM bank_matches x INDEXED BY bank_matches_settlement WHERE x.settlement_id = ?3 AND x.removed_at IS NULL)";
  return db
    .prepare(
      `INSERT INTO bank_matches (id, target_kind, payment_id, settlement_id, refund_id, statement_on, statement_ref, matched_by, matched_at)
       SELECT ?1, ?2, CASE ?2 WHEN 'payment' THEN ?3 END, CASE ?2 WHEN 'settlement' THEN ?3 END, CASE ?2 WHEN 'refund' THEN ?3 END, ?4, ?5, ${sessionUser("?6")}, ?7
       WHERE ${target} AND ${ownerSessionSql("?6", "?7", false)}`,
    )
    .bind(a.id, a.kind, a.targetId, a.statementOn, a.statementRef, a.sessionId, a.now);
}

/** The undo of a match, once, by the Owner, with a reason. Binds `?1` match, `?2` reason, `?3` session, `?4` now. */
export const bankMatchRemoveStatement = (
  db: D1Database,
  a: { id: string; reason: string; sessionId: string; now: number },
): D1PreparedStatement =>
  db
    .prepare(
      `UPDATE bank_matches SET removed_by = ${sessionUser("?3")}, removed_at = ?4, remove_reason = ?2 WHERE id = ?1 AND removed_at IS NULL AND ${ownerSessionSql("?3", "?4", false)}`,
    )
    .bind(a.id, a.reason, a.sessionId, a.now);

// ---- FEMA reductions (RB-43) -----------------------------------------------------------------------------------------------------------------------------

/**
 * The AD bank's Reg. 6 reduction of an export invoice (`realisation.reduce`, the Owner with a fresh step-up; Settled by the lead on the safest reading, 2026-11-03
 * (08-C RB-43)): for an issued, live export invoice of a live client, in its currency, all reductions together never above its total. Zero rows: 409. Binds `?1`..`?9`.
 */
export function realisationReductionStatement(
  db: D1Database,
  a: {
    id: string;
    documentId: string;
    amountMinor: number;
    approvedOn: string;
    bankRef: string;
    declaration: boolean;
    note: string | null;
    sessionId: string;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO realisation_reductions (id, document_id, currency, amount_minor, approved_on, bank_ref, declaration, note, recorded_by, created_at)
       SELECT ?1, d.id, d.currency, ?3, ?4, ?5, ?6, ?7, ${sessionUser("?8")}, ?9 FROM documents d JOIN clients k ON k.id = d.client_id
       WHERE d.id = ?2 AND d.type = 'export_invoice' AND d.frozen_at IS NOT NULL AND d.status <> 'void' AND d.voided_at IS NULL AND k.anonymised_at IS NULL
         AND ?3 + (SELECT coalesce(sum(x.amount_minor), 0) FROM realisation_reductions x WHERE x.document_id = d.id) <= d.total_minor
         AND ${ownerSessionSql("?8", "?9", true)}`,
    )
    .bind(
      a.id,
      a.documentId,
      a.amountMinor,
      a.approvedOn,
      a.bankRef,
      a.declaration ? 1 : 0,
      a.note,
      a.sessionId,
      a.now,
    );
}

/** The bank's letter of a reduction, set once (DOCS key `reductions/<id>/letter-<sha256>`, written first, write-once), by the Owner. */
export const reductionLetterStatement = (
  db: D1Database,
  a: { id: string; r2Key: string; sha256: string; mime: string; sessionId: string; now: number },
): D1PreparedStatement =>
  db
    .prepare(
      `UPDATE realisation_reductions SET letter_r2_key = ?2, letter_sha256 = ?3, letter_mime = ?4 WHERE id = ?1 AND letter_r2_key IS NULL AND ${ownerSessionSql("?5", "?6", false)}`,
    )
    .bind(a.id, a.r2Key, a.sha256, a.mime, a.sessionId, a.now);

/** An export invoice's reductions (`?1`), newest first. */
export const REDUCTIONS_OF_DOCUMENT_SQL = `SELECT r.id, r.currency, r.amount_minor, r.approved_on, r.bank_ref, r.declaration, r.letter_r2_key IS NOT NULL AS has_letter, r.recorded_by, r.created_at
   FROM realisation_reductions r INDEXED BY realisation_reductions_document WHERE r.document_id = ?1 ORDER BY r.approved_on DESC, r.id DESC`;
