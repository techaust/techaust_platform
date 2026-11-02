// Remittance advices (M6.4; L12; ADM-INV-17; run file docs/runs/m6.4-paypal.md A3 and C): the statements and reads of the advice archive, for the admin finance
// Worker's routes (stage B2). Plain SQL text and statement builders for the caller's own `db.batch()`; subpath export (`@techaust/db/advices`): no Drizzle schema,
// no zod.
//
// Why an archive (Settled by the lead on the safest reading, 2026-10-30 (08-C RB-05)): proof of realisation is the bank advice or e-FIRA, and for a PA-CB the
// settlement report mapped to the invoice. PayPal India's FIRA is weekly since February 2026 (all withdrawals of a week in one FIRA) and PayPal keeps it for the
// last 12 months only (Settled by the lead on the safest reading, 2026-11-02 (08-C RA-38)), so one advice proves many payments, and each is kept here, write-once
// in `DOCS`, before PayPal drops it. The triggers of `paypal_triggers` (0068) hold every rule again; each statement below also carries its rules in its WHERE, so a
// refused request writes nothing and aborts no batch (the caller re-reads to explain it).
import type { GuardSql } from "./log.ts";

export type { GuardSql };

/** A guard's SQL at the first placeholder after `used` values, and its values. */
const guarded = (g: GuardSql | undefined, used: number): { sql: string; params: readonly unknown[] } =>
  g ? { sql: ` AND ${g.sql(used + 1)}`, params: g.params } : { sql: "", params: [] };

/** At most this many payments are linked in one request (the schema's `ADVICE_LINK_MAX`, run file C: `{paymentIds[1..50]}`). */
export const ADVICE_LINK_MAX = 50;
/** A list page (keyset; one more row is read to know whether another page follows). */
export const ADVICE_PAGE_SIZE = 50;

/** An active Owner or Staff member (`?n`). */
const ownerOrStaff = (p: string) =>
  `EXISTS (SELECT 1 FROM staff_users am WHERE am.id = ${p} AND am.role IN ('owner', 'staff') AND am.status = 'active')`;

export type AdviceCreateArgs = {
  id: string;
  provider: "paypal" | "stripe" | "bank";
  kind: "efira" | "fira" | "firc" | "brc" | "settlement_report" | "other";
  adviceRef: string;
  issuedOn: string;
  periodFrom: string | null;
  periodTo: string | null;
  inrTotalMinor: number | null;
  note: string | null;
  recordedBy: string;
  now: number;
};

/**
 * A new advice (`payments.attachProof`, Owner or Staff), with no file yet: only while the member is an active Owner or Staff member and no advice of this provider,
 * kind and reference exists (zero rows: 409 `advice_ref_exists`, or the member is gone). The CHECK constraints hold the dates, the period's order, the INR total
 * (> 0, for the register only: never a GST value) and the lengths. `?1`..`?11`.
 */
export function adviceCreateStatement(db: D1Database, a: AdviceCreateArgs): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO realisation_advices (id, provider, kind, advice_ref, issued_on, period_from, period_to, inr_total_minor, note, recorded_by, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
       WHERE ${ownerOrStaff("?10")}
         AND NOT EXISTS (SELECT 1 FROM realisation_advices x INDEXED BY realisation_advices_ref WHERE x.provider = ?2 AND x.kind = ?3 AND x.advice_ref = ?4)`,
    )
    .bind(
      a.id,
      a.provider,
      a.kind,
      a.adviceRef,
      a.issuedOn,
      a.periodFrom,
      a.periodTo,
      a.inrTotalMinor,
      a.note,
      a.recordedBy,
      a.now,
    );
}

/**
 * The advice's file, set once (`PUT /payments/advices/:id/file`; the bytes already stored write-once in `DOCS` under `advices/<id>/file-<sha256>`): only while it
 * has none (zero rows: 409 `file_already_set`). The trigger `realisation_advices_fixed` holds the type (PDF, JPEG or PNG). `?1` id, `?2` key, `?3` SHA-256, `?4`
 * type, then `g`.
 */
export function adviceFileStatement(
  db: D1Database,
  a: { id: string; r2Key: string; sha256: string; mime: string },
  g?: GuardSql,
): D1PreparedStatement {
  const gs = guarded(g, 4);
  return db
    .prepare(
      `UPDATE realisation_advices SET file_r2_key = ?2, file_sha256 = ?3, file_mime = ?4 WHERE id = ?1 AND file_r2_key IS NULL${gs.sql}`,
    )
    .bind(a.id, a.r2Key, a.sha256, a.mime, ...gs.params);
}

/**
 * The payment `p` (an alias of `payments`) may go on advice `a` (an alias of `realisation_advices`): confirmed money received (`payment`), of the advice's provider
 * (a bank advice takes manual entries in USD or INR; a gateway's advice its own USD payments), of a client not anonymised (alias `k`), on no advice now. The
 * twin of the trigger `realisation_advice_payments_insert` (0068).
 */
export const linkableSql = (p: string, a: string, k: string): string =>
  `(${p}.status = 'confirmed' AND ${p}.kind = 'payment' AND ${k}.anonymised_at IS NULL
    AND ((${a}.provider = 'bank' AND ${p}.provider = 'manual' AND ${p}.currency IN ('USD', 'INR')) OR (${a}.provider <> 'bank' AND ${p}.provider = ${a}.provider AND ${p}.currency = 'USD'))
    AND NOT ${paymentHasAdviceSql(p)})`;

/** Payment `p` (an alias) is on an advice now (a link not taken off): one seek of `realisation_advice_payments_active`. The "Proof awaited" filter reads it too. */
export const paymentHasAdviceSql = (p: string): string =>
  `EXISTS (SELECT 1 FROM realisation_advice_payments al INDEXED BY realisation_advice_payments_active WHERE al.payment_id = ${p}.id AND al.removed_at IS NULL)`;

/**
 * Links 1 to 50 payments to an advice in ONE statement, all or none (`POST /payments/advices/:id/payments`, `payments.attachProof`): `?2` is the JSON array of
 * payment ids, distinct; every one must be linkable (`linkableSql`) and the member an active Owner or Staff member. Zero rows: the caller re-reads to explain
 * (`payment_not_confirmed`, `wrong_provider`, `already_linked`, `client_anonymised`). `?1` advice, `?2` ids, `?3` member, `?4` now, then `g`.
 */
export function adviceLinkStatement(
  db: D1Database,
  a: { adviceId: string; paymentIds: readonly string[]; by: string; now: number },
  g?: GuardSql,
): D1PreparedStatement {
  const gs = guarded(g, 4);
  return db
    .prepare(
      `INSERT INTO realisation_advice_payments (advice_id, payment_id, created_by, created_at)
       SELECT ?1, j.value, ?3, ?4 FROM json_each(?2) j
       WHERE json_array_length(?2) BETWEEN 1 AND ${ADVICE_LINK_MAX}
         AND (SELECT count(DISTINCT dj.value) FROM json_each(?2) dj) = json_array_length(?2)
         AND (SELECT count(*) FROM json_each(?2) cj JOIN payments p ON p.id = cj.value JOIN realisation_advices a ON a.id = ?1 JOIN clients k ON k.id = p.client_id
              WHERE ${linkableSql("p", "a", "k")}) = json_array_length(?2)
         AND ${ownerOrStaff("?3")}${gs.sql}`,
    )
    .bind(a.adviceId, JSON.stringify(a.paymentIds), a.by, a.now, ...gs.params);
}

/**
 * A payment taken off an advice (`payments.adviceUnlink`, the Owner only), with a reason of 1 to 200 characters, once: only while the link is on and the member is
 * an active Owner (zero rows: 404 or 409). The row stays, as the history of what proved what. `?1` advice, `?2` payment, `?3` member, `?4` now, `?5` reason, then
 * `g`.
 */
export function adviceUnlinkStatement(
  db: D1Database,
  a: { adviceId: string; paymentId: string; by: string; now: number; reason: string },
  g?: GuardSql,
): D1PreparedStatement {
  const gs = guarded(g, 5);
  return db
    .prepare(
      `UPDATE realisation_advice_payments SET removed_by = ?3, removed_at = ?4, remove_reason = ?5
       WHERE advice_id = ?1 AND payment_id = ?2 AND removed_at IS NULL AND length(trim(?5)) BETWEEN 1 AND 200
         AND EXISTS (SELECT 1 FROM staff_users au WHERE au.id = ?3 AND au.role = 'owner' AND au.status = 'active')${gs.sql}`,
    )
    .bind(a.adviceId, a.paymentId, a.by, a.now, a.reason, ...gs.params);
}

const ADVICE_COLS =
  "a.id, a.provider, a.kind, a.advice_ref, a.issued_on, a.period_from, a.period_to, a.inr_total_minor, a.file_r2_key, a.file_sha256, a.file_mime, a.note, a.recorded_by, a.created_at";

/**
 * The advices, newest first, keyset `(issued_on, id)` descending: the first page binds `?1` NULL; a later page binds the last row's day and id. At most 51 (one
 * more than a page), each with how many payments it proves now (`linked`). Through `realisation_advices_issued`.
 */
export const ADVICES_SQL = `SELECT ${ADVICE_COLS},
     (SELECT count(*) FROM realisation_advice_payments l WHERE l.advice_id = a.id AND l.removed_at IS NULL) AS linked
   FROM realisation_advices a INDEXED BY realisation_advices_issued
   WHERE ?1 IS NULL OR a.issued_on < ?1 OR (a.issued_on = ?1 AND a.id < ?2)
   ORDER BY a.issued_on DESC, a.id DESC LIMIT ${ADVICE_PAGE_SIZE + 1}`;

/** One advice (`?1`): a primary-key seek. */
export const ADVICE_READ_SQL = `SELECT ${ADVICE_COLS} FROM realisation_advices a WHERE a.id = ?1`;

/** The advice of a provider, kind and reference (`?1`..`?3`), to explain a refused create (409 `advice_ref_exists`). */
export const ADVICE_BY_REF_SQL = `SELECT a.id FROM realisation_advices a INDEXED BY realisation_advices_ref WHERE a.provider = ?1 AND a.kind = ?2 AND a.advice_ref = ?3`;

/**
 * The payments of advice `?1` (links on and taken off), by the day the money arrived, keyset `(received_on, id)` with `?2`/`?3` (the first page binds '' and ''),
 * at most 51. The client's name, or null once anonymised (the screen shows "Anonymised client").
 */
export const ADVICE_PAYMENTS_SQL = `SELECT l.payment_id, l.created_by, l.created_at, l.removed_by, l.removed_at, l.remove_reason,
     p.provider, p.currency, p.amount_minor, p.received_on, p.reference_norm, p.client_id,
     CASE WHEN k.anonymised_at IS NULL THEN k.display_name END AS client_name
   FROM realisation_advice_payments l JOIN payments p ON p.id = l.payment_id JOIN clients k ON k.id = p.client_id
   WHERE l.advice_id = ?1 AND (p.received_on > ?2 OR (p.received_on = ?2 AND p.id > ?3))
   ORDER BY p.received_on, p.id LIMIT ${ADVICE_PAGE_SIZE + 1}`;

/** The advice a payment (`?1`) is on now, if any (its detail): one seek of `realisation_advice_payments_active`. */
export const PAYMENT_ADVICE_SQL = `SELECT a.id, a.provider, a.kind, a.advice_ref, a.issued_on, l.created_by, l.created_at
   FROM realisation_advice_payments l INDEXED BY realisation_advice_payments_active JOIN realisation_advices a ON a.id = l.advice_id
   WHERE l.payment_id = ?1 AND l.removed_at IS NULL`;

/**
 * The "Without advice" list (`GET /payments/without-advice?provider=…`): one provider's confirmed payments (`?1`: `paypal`, `stripe`, or `manual` for the bank's)
 * in currency `?4` (NULL: any) on no advice now, of clients not anonymised, by the day the money arrived, keyset `(received_on, id)` with `?2`/`?3` (the first page
 * binds '' and ''), at most 51. One range of `payments_confirmed_provider`, then a seek of `realisation_advice_payments_active` per row.
 */
export const PAYMENTS_WITHOUT_ADVICE_SQL = `SELECT p.id, p.provider, p.client_id, p.currency, p.amount_minor, p.received_on, p.reference_norm, p.provider_payment_id,
     CASE WHEN k.anonymised_at IS NULL THEN k.display_name END AS client_name
   FROM payments p INDEXED BY payments_confirmed_provider JOIN clients k ON k.id = p.client_id
   WHERE p.provider = ?1 AND p.status = 'confirmed' AND p.kind = 'payment' AND (p.received_on > ?2 OR (p.received_on = ?2 AND p.id > ?3))
     AND (?4 IS NULL OR p.currency = ?4) AND k.anonymised_at IS NULL AND NOT ${paymentHasAdviceSql("p")}
   ORDER BY p.received_on, p.id LIMIT ${ADVICE_PAGE_SIZE + 1}`;

/**
 * How many of a provider's confirmed payments (`?1`) received from `?2` to `?3` (ISO, inclusive) are on no advice: the nav count and the monthly advice reminder
 * that rides `edf.reminder` (S9: "{count} PayPal payments from {month} have no remittance advice yet."). One range of `payments_confirmed_provider`.
 */
export const PAYMENTS_WITHOUT_ADVICE_COUNT_SQL = `SELECT count(*) AS n FROM payments p INDEXED BY payments_confirmed_provider JOIN clients k ON k.id = p.client_id
   WHERE p.provider = ?1 AND p.status = 'confirmed' AND p.kind = 'payment' AND p.received_on >= ?2 AND p.received_on <= ?3
     AND k.anonymised_at IS NULL AND NOT ${paymentHasAdviceSql("p")}`;
