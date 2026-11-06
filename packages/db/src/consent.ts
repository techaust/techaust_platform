// Consent receipts in SQL (M7.4 A.3, A.6, L30; FRM-05; run file docs/runs/m7.4-data-protection.md). The statements the routes and jobs add to their batches;
// the erasure paths need none (the `erased_hash` triggers stamp the receipts and write the `ended` receipt). Researched 2026-10-28, DPDP Act s.6, s.6(10)
// (08-C RB-28); the keyed hash after an erasure and the end: Settled by the lead on the safest reading, 2026-11-06 (08-C RB-46).
import { LEAD_WITH_ADDRESS_SQL } from "./triggers-data-protection.ts";

/**
 * One receipt (`?1` id, `?2` subject hash or NULL, `?3` lead id, `?4` contact id, `?5` event, `?6` source, `?7` notice version, `?8` purposes JSON, `?9`
 * marketing 0/1, `?10` ip hash, `?11` time). Core `receiptOf` / `withdrawalOf` give the values; the trigger `consent_receipts_values` checks them.
 */
export const INSERT_RECEIPT_SQL = `INSERT INTO consent_receipts (id, subject_hash, lead_id, contact_id, event, source, notice_version, purposes, marketing, ip_hash, at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`;

/**
 * The routine lead purge (D, round 3, L30), placed BEFORE its DELETE (the lead's receipts are unlinked by ON DELETE SET NULL after it) and guarded like it
 * (`guard`, SQL from `?4`): the lead's receipts take the keyed hash of its address (`?2`), then one `ended` receipt (source `retention`, at `?3`) records its
 * end, only when it had receipts. The purge never sets `erased_hash`, so no stop is written: an aged-out enquirer stays emailable. `?1` the lead.
 */
export const PURGE_RECEIPTS_SQL = (guard: string) => [
  `UPDATE consent_receipts SET subject_hash = ?2 WHERE lead_id = ?1 AND subject_hash IS NULL AND ${guard}`,
  `INSERT INTO consent_receipts (id, subject_hash, lead_id, contact_id, event, source, notice_version, purposes, marketing, ip_hash, at)
   SELECT lower(hex(randomblob(16))), ?2, ?1, NULL, 'ended', 'retention', NULL, '[]', 0, NULL, ?3
   WHERE EXISTS (SELECT 1 FROM consent_receipts r WHERE r.lead_id = ?1) AND ${guard}`,
];

/**
 * The one-off `consent.hash` back-fill (D.6): at most 50 receipts still without a hash whose lead or contact still holds its own address, oldest first.
 * Early check 1 M4: never a lead an anonymise gave the placeholder address, nor a lead or contact already marked erased (its receipts took the real hash then).
 */
export const UNHASHED_RECEIPTS_SQL = `SELECT r.id, coalesce(lower(l.contact_email), c.email) AS email
  FROM consent_receipts r LEFT JOIN leads l ON l.id = r.lead_id LEFT JOIN contacts c ON c.id = r.contact_id
  WHERE r.subject_hash IS NULL
    AND ((l.id IS NOT NULL AND ${LEAD_WITH_ADDRESS_SQL("l")}) OR (c.id IS NOT NULL AND c.anonymised_at IS NULL AND c.erased_hash IS NULL))
  ORDER BY r.at, r.id LIMIT 50`;
