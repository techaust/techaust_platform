// The full audit of M6–M7, fix round AF2 (run file docs/runs/full-audit-m6-m7.md, AU9, AU10, AU20, AU25, AU26): the trigger set `audit_af2_triggers`. No
// table is rebuilt (0079's and 0072's triggers are dropped and created again, never edited in place). Every abort message starts with the trigger's name. The
// enumerations and rules are frozen here (`*_AF2`), so the generated migration never changes; db tests pin them to the runtime SQL and core's lists.
//   1. AU10 (B6 L1): `pdf_failures.refused_at` is back-filled from the `pdf.refused` document bells that exist, and is set once;
//   2. AU9 (B6 M1): the new `retention_run_counts` columns hold their values (pages only go up, the flags are 0 or 1, "more tomorrow" only on a done family);
//   3. AU25 L1: a lead whose ADDRESS is held (a held contact or its held client with the same address, or a held lead with it) is neither erased nor deleted;
//   4. AU25 L2: the redaction hold fires on every redaction (0079's fired only on the first);
//   5. AU25 L3 and AU26: a done access request's export date is never before the request arrived; a done consent withdrawal names its own withdrawal (a
//      `lead.consent_withdraw` of its lead, or a `contact.update` of its contact that changed the marketing consent, with a `withdraw` receipt), made after the
//      request arrived (Researched 2026-11-07, DPDP Act 2023 s.6(4)–(6): the withdrawal is as easy as the consent and its consequences are borne by the
//      person; Settled by the lead on the safest reading, 2026-11-07 (run file AU26): never closed done without the proof);
//   6. AU20 (B4 L1): a member's digest may be switched off by a spam report on the digest itself (`digest_off_via = 'complaint'`);
//   7. AU25 L6: anonymising or erasing a contact (or deleting a lead) clears the staff's close notes of its requests and payment notices too.
import { CLOSE_BAD_0079, clientHeld, contactHeld } from "./triggers-data-protection.ts";

const abort = (message: string) => `SELECT RAISE(ABORT, '${message}');`;
const named = (name: string, message: string) => {
  if (message.includes("'")) throw new Error(`${name}: an abort message has no apostrophe`);
  return abort(`${name}: ${message}`);
};
const q = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/** AU20: how a member's weekly digest went off; `complaint` is new (the SES hook, on a spam report of the digest itself). */
export const DIGEST_OFF_VIA_AF2 = ["settings", "one_click", "complaint"] as const;

/** The audit actions and the contact field a done consent withdrawal may name (AU26). */
export const CONSENT_WITHDRAW_ACTIONS_AF2 = ["lead.consent_withdraw", "contact.update"] as const;

/**
 * AU25 L1: an address `email` is held: a contact with it (itself or its client under a hold) or a lead with it under a hold. The frozen twin of the runtime
 * `HELD_EMAIL_SQL` (`retention.ts`; a db test holds them equal).
 */
export const HELD_EMAIL_AF2 = (email: string) =>
  `(EXISTS (SELECT 1 FROM contacts hc JOIN clients hk ON hk.id = hc.client_id WHERE hc.email = lower(${email}) AND (hc.legal_hold = 1 OR hk.legal_hold = 1))
    OR EXISTS (SELECT 1 FROM leads hl WHERE lower(hl.contact_email) = lower(${email}) AND hl.legal_hold = 1))`;

/**
 * AU26: the action a done consent withdrawal names: the `lead.consent_withdraw` of its lead, or the `contact.update` of its contact whose `changed` list
 * holds `marketingConsent`, backed by a `withdraw` receipt of that contact; both at or after the request arrived.
 */
export const CONSENT_ACTION_AF2 = `EXISTS (SELECT 1 FROM audit_log a WHERE a.id = NEW.action_audit_id AND a.at >= NEW.received_at
      AND ((NEW.lead_ref IS NOT NULL AND a.action = 'lead.consent_withdraw' AND a.entity_type = 'lead' AND a.entity_id = NEW.lead_ref)
        OR (NEW.contact_ref IS NOT NULL AND a.action = 'contact.update' AND json_valid(a.summary) AND json_extract(a.summary, '$.contactId') = NEW.contact_ref
          AND EXISTS (SELECT 1 FROM json_each(a.summary, '$.changed') ch WHERE ch.value = 'marketingConsent')
          AND EXISTS (SELECT 1 FROM consent_receipts cr WHERE cr.contact_id = NEW.contact_ref AND cr.event = 'withdraw' AND cr.at >= NEW.received_at))))`;

/** The close rules after AF2: 0079's, a done access request's export date not before the request arrived (L3), and the consent withdrawal's proof (AU26). */
export const CLOSE_BAD_AF2 = `${CLOSE_BAD_0079}
    OR (OLD.status = 'open' AND NEW.status = 'closed' AND NEW.export_sent_at IS NOT NULL AND NEW.export_sent_at < coalesce(NEW.received_at, NEW.created_at))
    OR (OLD.status = 'open' AND NEW.status = 'closed' AND NEW.kind = 'consent_withdrawal' AND NEW.outcome = 'done' AND NOT ${CONSENT_ACTION_AF2})`;

/** A lead row `a` (OLD) is held: itself, or (L1) its address. */
const leadHeld = (a: string) => `(${a}.legal_hold = 1 OR ${HELD_EMAIL_AF2(`${a}.contact_email`)})`;

/** AU10: the documents that have a `pdf.refused` bell get their refusal time (the first bell's), before the set-once trigger exists. */
export function auditAf2Backfill(): string[] {
  return [
    `INSERT INTO pdf_failures (document_id, nights, refused_at)
     SELECT n.entity_id, 0, min(n.created_at) FROM notifications n JOIN documents d ON d.id = n.entity_id
     WHERE n.kind = 'pdf.refused' AND n.entity_type = 'document' GROUP BY n.entity_id
     ON CONFLICT (document_id) DO UPDATE SET refused_at = coalesce(pdf_failures.refused_at, excluded.refused_at);`,
  ];
}

export function auditAf2TriggerStatements(): string[] {
  const pdf = [
    `CREATE TRIGGER \`pdf_failures_refused_once\` BEFORE UPDATE OF refused_at ON \`pdf_failures\` WHEN OLD.refused_at IS NOT NULL AND NEW.refused_at IS NOT OLD.refused_at BEGIN ${named("pdf_failures_refused_once", "a refused PDF stays refused")} END;`,
  ];
  const countsBad = (row: string) =>
    `${row}.pages < 0 OR ${row}.capped NOT IN (0, 1) OR ${row}.more_tomorrow NOT IN (0, 1) OR (${row}.more_tomorrow = 1 AND ${row}.done <> 1)`;
  const runs = [
    `CREATE TRIGGER \`retention_run_counts_af2_insert\` BEFORE INSERT ON \`retention_run_counts\` WHEN ${countsBad("NEW")} BEGIN ${named("retention_run_counts_af2_insert", "a clean-up count has whole pages, 0 or 1 flags, and more tomorrow only on a done family")} END;`,
    `CREATE TRIGGER \`retention_run_counts_af2_update\` BEFORE UPDATE ON \`retention_run_counts\` WHEN ${countsBad("NEW")} OR NEW.pages < OLD.pages OR (OLD.more_tomorrow = 1 AND NEW.more_tomorrow = 0) BEGIN ${named("retention_run_counts_af2_update", "a clean-up count has whole pages that only go up, 0 or 1 flags, and more tomorrow only on a done family, kept once set")} END;`,
  ];
  const leads = [
    "DROP TRIGGER `leads_held_no_delete`;",
    `CREATE TRIGGER \`leads_held_no_delete\` BEFORE DELETE ON \`leads\` WHEN ${leadHeld("OLD")} BEGIN ${named("leads_held_no_delete", "a lead under a legal hold, or whose address a held contact, client or lead has, is not deleted")} END;`,
    "DROP TRIGGER `leads_held_no_erase`;",
    `CREATE TRIGGER \`leads_held_no_erase\` BEFORE UPDATE OF erased_hash ON \`leads\` WHEN NEW.erased_hash IS NOT OLD.erased_hash AND ${leadHeld("OLD")} BEGIN ${named("leads_held_no_erase", "a lead under a legal hold, or whose address a held contact, client or lead has, is not erased")} END;`,
  ];
  const redact = [
    "DROP TRIGGER `documents_held_no_redact`;",
    `CREATE TRIGGER \`documents_held_no_redact\` BEFORE UPDATE OF redacted_at ON \`documents\` WHEN NEW.redacted_at IS NOT NULL AND NEW.redacted_at IS NOT OLD.redacted_at
       AND (${clientHeld("OLD.client_id")} OR EXISTS (SELECT 1 FROM contacts hk WHERE hk.id = OLD.contact_id AND ${contactHeld("hk")}))
       BEGIN ${named("documents_held_no_redact", "an offer of a client or contact under a legal hold (on itself, its client or a lead of the person) is not redacted, the first time or again")} END;`,
  ];
  const close = [
    "DROP TRIGGER `client_requests_close_rules`;",
    `CREATE TRIGGER \`client_requests_close_rules\` BEFORE UPDATE OF status ON \`client_requests\` WHEN ${CLOSE_BAD_AF2} BEGIN ${named("client_requests_close_rules", "a declined request has a known reason; an access, correction, erasure or nomination request is done only once its identity is checked; a done erasure names the erase or anonymise of its own contact or lead, and a done consent withdrawal the withdrawal of its own lead or contact, made after it arrived; a request naming only an address is declined; only a done access request has an export date, never before it arrived")} END;`,
  ];
  const flags = [
    "digest_weekly",
    "email_offer_viewed",
    "email_payment_received",
    "email_approvals",
    "email_hook_failed",
  ];
  const prefsBad = `${flags.map((f) => `NEW.${f} NOT IN (0, 1)`).join(" OR ")}
    OR (NEW.digest_off_via IS NOT NULL AND (NEW.digest_off_via NOT IN (${q(DIGEST_OFF_VIA_AF2)}) OR NEW.digest_weekly <> 0))`;
  const prefsMsg =
    "the switches are 0 or 1, and how the digest went off is known and kept only while it is off";
  const prefs = [
    "DROP TRIGGER `staff_notification_prefs_values`;",
    `CREATE TRIGGER \`staff_notification_prefs_values\` BEFORE INSERT ON \`staff_notification_prefs\` WHEN ${prefsBad} BEGIN ${named("staff_notification_prefs_values", prefsMsg)} END;`,
    "DROP TRIGGER `staff_notification_prefs_values_update`;",
    `CREATE TRIGGER \`staff_notification_prefs_values_update\` BEFORE UPDATE ON \`staff_notification_prefs\` WHEN ${prefsBad} BEGIN ${named("staff_notification_prefs_values_update", prefsMsg)} END;`,
  ];
  const notes = [
    "DROP TRIGGER `client_requests_erase_details`;",
    "CREATE TRIGGER `client_requests_erase_details` AFTER UPDATE OF anonymised_at ON `contacts` WHEN NEW.anonymised_at IS NOT NULL AND OLD.anonymised_at IS NULL BEGIN UPDATE client_requests SET details = NULL, close_note = NULL WHERE contact_id = NEW.id AND (details IS NOT NULL OR close_note IS NOT NULL); END;",
    "DROP TRIGGER `payment_notices_erase_note`;",
    "CREATE TRIGGER `payment_notices_erase_note` AFTER UPDATE OF anonymised_at ON `contacts` WHEN NEW.anonymised_at IS NOT NULL AND OLD.anonymised_at IS NULL BEGIN UPDATE payment_notices SET note = NULL, close_note = NULL WHERE contact_id = NEW.id AND (note IS NOT NULL OR close_note IS NOT NULL); END;",
    "DROP TRIGGER `client_requests_unlink_lead`;",
    "CREATE TRIGGER `client_requests_unlink_lead` BEFORE DELETE ON `leads` BEGIN UPDATE client_requests SET lead_id = NULL, details = NULL, close_note = NULL WHERE lead_id = OLD.id; END;",
    "DROP TRIGGER `client_requests_unlink_contact`;",
    "CREATE TRIGGER `client_requests_unlink_contact` BEFORE DELETE ON `contacts` BEGIN UPDATE client_requests SET contact_id = NULL, details = NULL, close_note = NULL WHERE contact_id = OLD.id; END;",
    "DROP TRIGGER `payment_notices_unlink_contact`;",
    "CREATE TRIGGER `payment_notices_unlink_contact` BEFORE DELETE ON `contacts` BEGIN UPDATE payment_notices SET contact_id = NULL, note = NULL, close_note = NULL WHERE contact_id = OLD.id; END;",
    // A closed notice keeps its close; only its staff note may become empty (L6).
    "DROP TRIGGER `payment_notices_fixed`;",
    `CREATE TRIGGER \`payment_notices_fixed\` BEFORE UPDATE ON \`payment_notices\` WHEN NEW.\`id\` IS NOT OLD.\`id\` OR NEW.\`client_id\` IS NOT OLD.\`client_id\` OR NEW.\`document_id\` IS NOT OLD.\`document_id\` OR NEW.\`via\` IS NOT OLD.\`via\` OR NEW.\`amount_minor\` IS NOT OLD.\`amount_minor\` OR NEW.\`currency\` IS NOT OLD.\`currency\` OR NEW.\`paid_on\` IS NOT OLD.\`paid_on\` OR NEW.\`reference\` IS NOT OLD.\`reference\` OR NEW.\`reference_norm\` IS NOT OLD.\`reference_norm\` OR NEW.\`created_at\` IS NOT OLD.\`created_at\`
    OR (NEW.\`contact_id\` IS NOT OLD.\`contact_id\` AND NEW.\`contact_id\` IS NOT NULL) OR (NEW.\`note\` IS NOT OLD.\`note\` AND NEW.\`note\` IS NOT NULL)
    OR (OLD.status <> 'open' AND (NEW.\`status\` IS NOT OLD.\`status\` OR NEW.\`payment_id\` IS NOT OLD.\`payment_id\` OR NEW.\`closed_by\` IS NOT OLD.\`closed_by\` OR NEW.\`closed_at\` IS NOT OLD.\`closed_at\` OR (NEW.\`close_note\` IS NOT OLD.\`close_note\` AND NEW.\`close_note\` IS NOT NULL))) BEGIN ${named("payment_notices_fixed", "a payment notice keeps the facts the client gave; its contact and notes only become empty; a close never changes")} END;`,
  ];
  return [...auditAf2Backfill(), ...pdf, ...runs, ...leads, ...redact, ...close, ...prefs, ...notes];
}
