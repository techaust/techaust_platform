// The readers and the claim of M5.4's recurring work, as SQL text (ADM-CARE-02, ADM-INV-13, ADM-INV-19, ADM-INV-10; LD59, LD60, LD67). Subpath export
// (`@techaust/db/billing`): no zod, no Drizzle schema, so the jobs Worker and the admin API both import it. Every reader is keyset-paged (at most 50 rows),
// served by an index (a test EXPLAINs each one), and takes its clock as a bound value, never `now()`: a fake-clock test and a replay see the same rows.
import { periodStartSql } from "@techaust/core/care";
import { REMINDER_LIVE_STATUSES, REMINDER_TYPES } from "@techaust/core/invoices";

const quoted = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/**
 * The active plans whose current billing period has not been billed (ADM-CARE-02), oldest plan first, at most 50. `?1` today (IST date), `?2` and `?3` the last
 * row's `created_at` and `id` (the first page binds -1 and ''). A plan is listed when its start date has come and `last_billed_period` is empty or before the
 * START of its current period (`periodStartSql`, then the plan's start date for its first, partial period). Whether the plan was ACTIVE at that start, and the
 * period's amounts, are read from the history by `draftCarePlan`; this only finds the candidates. Index: `care_plans_status_created`.
 */
export const CARE_DUE_SQL = `SELECT p.id, p.client_id, p.created_at FROM care_plans p
   WHERE p.status = 'active' AND (p.created_at > ?2 OR (p.created_at = ?2 AND p.id > ?3)) AND p.start_date <= ?1
     AND (p.last_billed_period IS NULL OR p.last_billed_period < max(p.start_date, ${periodStartSql("?1", "p.billing_day")}))
   ORDER BY p.created_at, p.id LIMIT 50`;

/**
 * M5.4's unbilled-work reader (ADM-INV-19, Rule 47; LD67): milestones marked ready to bill whose work was delivered at or before the cutoff and that have no frozen,
 * not void invoice document yet, oldest delivery first, keyset by `(delivered_at, id)`, at most 50 rows. `?1` the cutoff in UTC ms (core `unbilledCutoff`: delivered
 * on or before the IST day `alertDays` days ago), `?2` and `?3` the last row's `delivered_at` and `id` (the first page binds -1 and ''). A milestone whose document
 * is a live proforma belongs to `PROFORMA_TAX_INVOICE_DUE_SQL` instead (the two sets are disjoint). Index: `milestones_unbilled`.
 */
export const UNBILLED_SQL = `SELECT m.id AS milestone_id, m.delivered_at, m.title, m.project_id, p.client_id, c.display_name AS client_name
   FROM milestones m INDEXED BY milestones_unbilled JOIN projects p ON p.id = m.project_id JOIN clients c ON c.id = p.client_id
   WHERE m.status = 'ready_to_bill' AND m.delivered_at IS NOT NULL AND m.delivered_at <= ?1 AND (m.delivered_at > ?2 OR (m.delivered_at = ?2 AND m.id > ?3))
     AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = m.document_id AND d.frozen_at IS NOT NULL AND d.status <> 'void')
   ORDER BY m.delivered_at, m.id LIMIT 50`;

/**
 * The reminders that are due and still waiting (ADM-INV-13), oldest first, at most 50: `?1` now (UTC ms), `?2` and `?3` the last row's `due_at` and `id` (the first
 * page binds -1 and ''). Index: `reminders_pending` (rows that were sent or given up are not in it, so they are never read again).
 */
export const REMINDER_DUE_SQL = `SELECT id, document_id, offset_days, due_at FROM reminders INDEXED BY reminders_pending
   WHERE sent_at IS NULL AND skipped_reason IS NULL AND due_at <= ?1 AND (due_at > ?2 OR (due_at = ?2 AND id > ?3))
   ORDER BY due_at, id LIMIT 50`;

/**
 * The claim of one reminder (LD60): ONE statement that sets `sent_at` and carries EVERY stop rule in its WHERE, so a rule can never be skipped by a caller. `?1` the
 * reminder id, `?2` now. It changes a row only when the reminder is still waiting and due, its document is an issued (frozen), not void invoice, proforma or debit note
 * that still owes money (`balance_minor > 0`, status issued, partially paid or partially credited), its client is not anonymised and has not turned reminders off,
 * somebody can still be written to (a send of the document that was not cancelled, to a contact who still has portal access), and no LATER offset of the same document
 * is also due (the later one is the one to send; the earlier ones are superseded in the same batch). Core `skipReasonOf` is the twin. A redelivered message finds the
 * row claimed and changes nothing. `RETURNING` gives the consumer what it needs without another read.
 */
export const REMINDER_CLAIM_SQL = `UPDATE reminders SET sent_at = ?2
   WHERE id = ?1 AND sent_at IS NULL AND skipped_reason IS NULL AND due_at <= ?2
     AND EXISTS (SELECT 1 FROM documents d JOIN clients c ON c.id = d.client_id
                 WHERE d.id = reminders.document_id AND d.frozen_at IS NOT NULL AND d.voided_at IS NULL AND d.type IN (${quoted(REMINDER_TYPES)})
                   AND d.status IN (${quoted(REMINDER_LIVE_STATUSES)}) AND d.balance_minor > 0
                   AND c.anonymised_at IS NULL AND coalesce(json_extract(c.reminder_policy, '$.enabled'), 1) <> 0
                   AND EXISTS (SELECT 1 FROM document_sends s JOIN contacts k ON k.id = s.contact_id AND k.client_id = s.client_id
                               WHERE s.document_id = d.id AND s.cancelled_at IS NULL AND k.portal_access = 1 AND k.anonymised_at IS NULL))
     AND NOT EXISTS (SELECT 1 FROM reminders r2 WHERE r2.document_id = reminders.document_id AND r2.offset_days > reminders.offset_days
                     AND r2.sent_at IS NULL AND r2.skipped_reason IS NULL AND r2.due_at <= ?2)
   RETURNING id, document_id, offset_days`;

/**
 * The facts `skipReasonOf` judges, for a reminder the claim refused (`?1` its id, `?2` now), in one row. The consumer writes the reason with `REMINDER_SKIP_SQL` so the
 * scan never reads the row again.
 */
export const REMINDER_FACTS_SQL = `SELECT r.sent_at, r.skipped_reason, r.due_at, d.frozen_at IS NOT NULL AS frozen, d.type, d.status, d.balance_minor, d.voided_at IS NOT NULL AS voided,
       c.anonymised_at IS NOT NULL AS client_anonymised, coalesce(json_extract(c.reminder_policy, '$.enabled'), 1) <> 0 AS policy_enabled,
       EXISTS (SELECT 1 FROM document_sends s JOIN contacts k ON k.id = s.contact_id AND k.client_id = s.client_id
               WHERE s.document_id = d.id AND s.cancelled_at IS NULL AND k.portal_access = 1 AND k.anonymised_at IS NULL) AS has_recipient,
       EXISTS (SELECT 1 FROM reminders r2 WHERE r2.document_id = r.document_id AND r2.offset_days > r.offset_days AND r2.sent_at IS NULL AND r2.skipped_reason IS NULL AND r2.due_at <= ?2) AS later_due
     FROM reminders r JOIN documents d ON d.id = r.document_id JOIN clients c ON c.id = d.client_id WHERE r.id = ?1`;

/** A final skip (`?2`, never `paused`) written once to a waiting row (`?1`): `reminders_fixed` refuses any later change. */
export const REMINDER_SKIP_SQL =
  "UPDATE reminders SET skipped_reason = ?2 WHERE id = ?1 AND sent_at IS NULL AND skipped_reason IS NULL";

/**
 * After a claim, the EARLIER offsets of the same document that are still waiting and already due are superseded (an outage that let three pile up sends one):
 * `?1` the document id, `?2` the claimed offset, `?3` now. Written in the claim's own batch.
 */
export const SUPERSEDE_SQL = `UPDATE reminders SET skipped_reason = 'superseded'
   WHERE document_id = ?1 AND offset_days < ?2 AND sent_at IS NULL AND skipped_reason IS NULL AND due_at <= ?3`;
