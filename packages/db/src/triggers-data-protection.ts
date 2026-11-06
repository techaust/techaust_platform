// M7.4 data-protection tooling: the trigger set `data_protection_triggers` (migration 0079; run file docs/runs/m7.4-data-protection.md A, L23–L36).
// No table is rebuilt. Every abort message starts with the trigger's name. The enumerations are frozen here (`*_0079`) so the generated migration never
// changes; db tests pin them to core's lists. "Now" is `unixepoch('subsec')`, as every column default, which D1 runs.
//
// Floors no setting can cross: 366 days (Rule 8(3)'s "minimum period of one year" across 29 February; Researched 2026-10-28, DPDP Rules 2025 Rule 8(3)
// (08-C RB-09); Settled by the lead on the safest reading, 2026-11-06 (08-C RB-48), L34). The keyed hash kept after an erasure, and its end: Settled by the
// lead on the safest reading, 2026-11-06 (08-C RB-46). The request clock: Researched 2026-11-06, DPDP Rules 2025 r.14(3); SPDI r.5(9); privacy notice 07-A
// §§7–8 (08-C RB-47). The audit scrub: Settled by the lead on the safest reading, 2026-11-06 (08-C RB-48). Legal hold answers RA-25's open point by building
// it (Researched 2026-10-28, s.36 CGST Act (08-C RA-25)).
import { requestDueAtSql } from "@techaust/core/dsr";

const abort = (message: string) => `SELECT RAISE(ABORT, '${message}');`;
const named = (name: string, message: string) => {
  // The message is an SQL string literal: an apostrophe would end it.
  if (message.includes("'")) throw new Error(`${name}: an abort message has no apostrophe`);
  return abort(`${name}: ${message}`);
};
const q = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");
const NOW = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
/** 366 days in milliseconds (L34). */
export const FLOOR_MS_0079 = 366 * 86_400_000;
/** Older than the floor: `col` is before now minus 366 days. */
const pastFloor = (col: string) => `${col} < ${NOW} - ${FLOOR_MS_0079}`;

export const REQUEST_KINDS_0079 = [
  "contact_change",
  "data_access",
  "data_correction",
  "data_erasure",
  "grievance",
  "consent_withdrawal",
  "nomination",
] as const;
export const CHANNELS_0079 = ["portal", "email", "post", "phone", "in_person"] as const;
export const DECLINE_REASONS_0079 = [
  "legal_hold",
  "law_requires_keeping",
  "identity_not_confirmed",
  "duplicate",
  "not_on_record",
  "other",
] as const;
export const EMAIL_ONLY_DECLINE_REASONS_0079 = [
  "not_on_record",
  "identity_not_confirmed",
  "duplicate",
  "other",
] as const;
/** L42: the kinds closed `done` only once the identity is checked (core `IDENTITY_CHECKED_KINDS`). */
export const IDENTITY_CHECKED_KINDS_0079 = [
  "data_access",
  "data_correction",
  "data_erasure",
  "nomination",
] as const;
export const ERASURE_ACTIONS_0079 = ["contact.erase", "contact.anonymise", "lead.erase"] as const;
export const LEGAL_HOLD_ENTITY_TYPES_0079 = ["client", "contact", "lead"] as const;
export const LEGAL_HOLD_ACTIONS_0079 = ["set", "clear"] as const;
export const CONSENT_EVENTS_0079 = ["grant", "withdraw", "ended"] as const;
export const CONSENT_SOURCES_0079 = ["web_form", "staff", "unsubscribe", "erasure", "retention"] as const;
export const PURPOSES_0079 = ["respond_to_enquiry", "marketing_updates"] as const;
export const SUPPRESSION_REASONS_0079 = ["hard_bounce", "complaint", "manual", "erased"] as const;
export const R2_BUCKETS_0079 = ["files", "docs"] as const;
export const R2_REASONS_0079 = ["row_deleted", "redacted", "orphan", "signature_unused"] as const;
export const RETENTION_MODES_0079 = ["dry_run", "live"] as const;
export const RETENTION_FAMILIES_0079 = [
  "email_log",
  "email_events",
  "access_log",
  "audit_ip",
  "sessions",
  "counters",
  "bells",
  "stats",
  "requests",
  "consent",
  "runs",
] as const;
/** The audit actions whose `summary` keeps the browser and place of a sign-in (`apps/admin/worker/alerts.ts`); L33 scrubs `ua`, `city`, `country`. */
export const ALERT_ACTIONS_0079 = ["alert.new_device", "alert.2fa_change", "alert.lockout"] as const;
export const ALERT_SCRUB_KEYS_0079 = ["$.ua", "$.city", "$.country"] as const;
/** The tables an anonymised client takes no new row in (Step 0.7), with the SQL giving the row's client. */
export const ANONYMISED_LOCK_0079 = {
  projects: "NEW.client_id",
  milestones: "(SELECT p.client_id FROM projects p WHERE p.id = NEW.project_id)",
  notes: "coalesce(NEW.client_id, (SELECT p.client_id FROM projects p WHERE p.id = NEW.project_id))",
  files: "coalesce(NEW.client_id, (SELECT p.client_id FROM projects p WHERE p.id = NEW.project_id))",
  contacts: "NEW.client_id",
  care_plans: "NEW.client_id",
  time_logs:
    "coalesce((SELECT p.client_id FROM projects p WHERE p.id = NEW.project_id), (SELECT cp.client_id FROM care_plans cp WHERE cp.id = NEW.care_plan_id))",
  documents: "NEW.client_id",
} as const;

/** A 64-character lower-case hex value (the keyed hash). */
const isHex64 = (v: string) => `(length(${v}) = 64 AND ${v} NOT GLOB '*[^0-9a-f]*')`;

/**
 * The stem of a sent version's stored objects (`docs/<type>/<fy label>/<number padded to 4>-v<version>`), the SQL twin of core `pdfKeys` (a db test holds
 * them equal); NULL when the row has no valid number, FY or version. `a` is the row (`OLD`, or a table alias).
 */
export const PDF_STEM_SQL = (a: string) =>
  `CASE WHEN ${a}.type GLOB '[a-z_]*' AND ${a}.type NOT GLOB '*[^a-z_]*' AND length(${a}.type) BETWEEN 1 AND 24
     AND ${a}.fy GLOB '[0-9][0-9][0-9][0-9]' AND (CAST(substr(${a}.fy, 1, 2) AS INTEGER) + 1) % 100 = CAST(substr(${a}.fy, 3, 2) AS INTEGER)
     AND ${a}.number BETWEEN 1 AND 999999999 AND ${a}.version BETWEEN 1 AND 999
   THEN 'docs/' || ${a}.type || '/' || (2000 + CAST(substr(${a}.fy, 1, 2) AS INTEGER)) || '-' || substr(${a}.fy, 3, 2) || '/' || printf('%04d', ${a}.number) || '-v' || CAST(${a}.version AS INTEGER) END`;

/**
 * A contact row `a` is held: itself, its client, or a lead of the person (the `HELD_LEAD_SQL` rule of `contact-access.ts`, over `a`; early check 1 M1: the
 * lead's address lower-cased, one EXISTS per index).
 */
const contactHeld = (a: string) =>
  `(${a}.legal_hold = 1 OR EXISTS (SELECT 1 FROM clients hc WHERE hc.id = ${a}.client_id AND hc.legal_hold = 1)
    OR EXISTS (SELECT 1 FROM leads hl WHERE hl.contact_id = ${a}.id AND hl.legal_hold = 1)
    OR EXISTS (SELECT 1 FROM leads hl WHERE lower(hl.contact_email) = lower(${a}.email) AND hl.legal_hold = 1 AND (hl.client_id IS NULL OR hl.client_id = ${a}.client_id)))`;
const clientHeld = (client: string) =>
  `EXISTS (SELECT 1 FROM clients hc WHERE hc.id = ${client} AND hc.legal_hold = 1)`;
const clientGone = (client: string) =>
  `EXISTS (SELECT 1 FROM clients z WHERE z.id = ${client} AND z.anonymised_at IS NOT NULL)`;

/**
 * Another live record holds the address (L20, round 5): a contact at any client that is neither anonymised nor marked by this erasure, or an unconverted
 * lead not marked by it. `email` is the lower-cased address; `self` excludes the row being erased.
 */
const liveHolder = (email: string, self: { contact?: string; lead?: string }) =>
  `(EXISTS (SELECT 1 FROM contacts o WHERE o.email = ${email}${self.contact ? ` AND o.id <> ${self.contact}` : ""} AND o.anonymised_at IS NULL AND o.erased_hash IS NULL)
    OR EXISTS (SELECT 1 FROM leads ol WHERE lower(ol.contact_email) = ${email}${self.lead ? ` AND ol.id <> ${self.lead}` : ""} AND ol.client_id IS NULL AND ol.erased_hash IS NULL))`;

/** The erasure stop and the plain row's removal (A.5): one `h:` row (a later erasure of the same person restarts its clock), and no plain address left. */
const stopStatements = (email: string) =>
  `DELETE FROM email_suppressions WHERE email = 'h:' || NEW.erased_hash;
   INSERT INTO email_suppressions (email, reason, at) VALUES ('h:' || NEW.erased_hash, 'erased', ${NOW});
   DELETE FROM email_suppressions WHERE email = ${email};`;

/**
 * The receipts of the erased row get its hash, and (L30) one `ended` receipt records the end, when the row had receipts. `col` is `contact_id` or `lead_id`.
 */
const receiptStatements = (col: "contact_id" | "lead_id") =>
  `UPDATE consent_receipts SET subject_hash = NEW.erased_hash WHERE ${col} = NEW.id AND subject_hash IS NULL;
   INSERT INTO consent_receipts (id, subject_hash, ${col}, event, source, notice_version, purposes, marketing, ip_hash, at)
     SELECT lower(hex(randomblob(16))), NEW.erased_hash, NEW.id, 'ended', 'erasure', NULL, '[]', 0, NULL, ${NOW}
     WHERE EXISTS (SELECT 1 FROM consent_receipts r WHERE r.${col} = NEW.id);`;

/**
 * A lead whose consent the back-fill and the `consent.hash` page may read: a lead with its own address (early check 1 M4: never one an anonymise turned into
 * the placeholder `anonymised+<id>@invalid`, core `anonymisedEmail`, nor one already marked erased). `l` is the alias.
 */
export const LEAD_WITH_ADDRESS_SQL = (l: string) =>
  `(${l}.erased_hash IS NULL AND lower(${l}.contact_email) NOT GLOB 'anonymised+*@invalid')`;

/** The lead's stored purposes the trigger knows, as a JSON array. */
const leadPurposes = `(SELECT coalesce(json_group_array(p.value), '[]') FROM json_each(json_extract(l.consent, '$.purposes')) p WHERE p.value IN (${q(PURPOSES_0079)}))`;
const RECEIPT_COLS =
  "(id, subject_hash, lead_id, contact_id, event, source, notice_version, purposes, marketing, ip_hash, at)";
const LEAD_CONSENT_OK = `l.consent IS NOT NULL AND json_valid(l.consent) AND json_type(l.consent, '$.at') = 'integer' AND json_type(l.consent, '$.purposes') = 'array' AND ${LEAD_WITH_ADDRESS_SQL("l")}`;
/** A contact's marketing consent that was granted (still, or until it was withdrawn: the grant's `at` is kept by the withdraw, `apps/admin/worker/clients.ts`). */
const CONTACT_CONSENT_OK = `c.anonymised_at IS NULL AND c.erased_hash IS NULL AND c.marketing_consent IS NOT NULL AND json_valid(c.marketing_consent)
       AND json_type(c.marketing_consent, '$.at') = 'integer'
       AND (json_type(c.marketing_consent, '$.granted') = 'true' OR json_type(c.marketing_consent, '$.withdrawnAt') = 'integer')`;

/**
 * The one-off back-fills, before any trigger of this set exists:
 * - A.1: the clock of existing requests; L42: an existing (portal) request counts as identity-checked by its sign-in, when it arrived;
 * - A.3: one `grant` receipt per lead with consent (as the jobs Worker stores it, `apps/jobs/src/leads.ts`), no hash; L41: one `grant` receipt per live
 *   contact whose marketing consent was granted (source `staff`, no notice version, marketing only, as core `receiptOf`); early check 1 H3: one `withdraw`
 *   receipt (source `staff`, as core `withdrawalOf`) for each of those whose consent carries `withdrawnAt`. M4: no anonymised or erased lead.
 */
export function dataProtectionBackfill(): string[] {
  return [
    `UPDATE client_requests SET received_at = created_at, due_at = ${requestDueAtSql("created_at")}, ack_due_at = created_at + 172800000 WHERE received_at IS NULL;`,
    "UPDATE client_requests SET identity_checked_at = received_at WHERE channel = 'portal' AND identity_checked_at IS NULL;",
    `INSERT INTO consent_receipts ${RECEIPT_COLS}
     SELECT lower(hex(randomblob(16))), NULL, l.id, NULL, 'grant', CASE l.source WHEN 'web' THEN 'web_form' ELSE 'staff' END,
       json_extract(l.consent, '$.noticeVersion'), ${leadPurposes},
       CASE WHEN json_extract(l.consent, '$.marketing') = 1 THEN 1 ELSE 0 END,
       json_extract(l.consent, '$.ipHash'), json_extract(l.consent, '$.at')
     FROM leads l WHERE ${LEAD_CONSENT_OK};`,
    `INSERT INTO consent_receipts ${RECEIPT_COLS}
     SELECT lower(hex(randomblob(16))), NULL, l.id, NULL, 'withdraw', 'staff', json_extract(l.consent, '$.noticeVersion'), ${leadPurposes}, 0, NULL,
       json_extract(l.consent, '$.withdrawnAt')
     FROM leads l WHERE ${LEAD_CONSENT_OK} AND json_type(l.consent, '$.withdrawnAt') = 'integer';`,
    `INSERT INTO consent_receipts ${RECEIPT_COLS}
     SELECT lower(hex(randomblob(16))), NULL, NULL, c.id, 'grant', 'staff', NULL, '["marketing_updates"]', 1, NULL, json_extract(c.marketing_consent, '$.at')
     FROM contacts c WHERE ${CONTACT_CONSENT_OK};`,
    `INSERT INTO consent_receipts ${RECEIPT_COLS}
     SELECT lower(hex(randomblob(16))), NULL, NULL, c.id, 'withdraw', 'staff', NULL, '["marketing_updates"]', 0, NULL, json_extract(c.marketing_consent, '$.withdrawnAt')
     FROM contacts c WHERE ${CONTACT_CONSENT_OK} AND json_type(c.marketing_consent, '$.withdrawnAt') = 'integer';`,
  ];
}

export function dataProtectionTriggerStatements(): string[] {
  // ---- 1. floors (366 days)
  const floors = [
    `CREATE TRIGGER \`access_log_delete_floor\` BEFORE DELETE ON \`access_log\` WHEN NOT ${pastFloor("OLD.at")} BEGIN ${named("access_log_delete_floor", "an access log row is kept at least 366 days")} END;`,
    `CREATE TRIGGER \`email_log_delete_floor\` BEFORE DELETE ON \`email_log\` WHEN NOT ${pastFloor("max(OLD.created_at, OLD.updated_at)")} BEGIN ${named("email_log_delete_floor", "an email log row is kept at least 366 days after its last change")} END;`,
    `CREATE TRIGGER \`email_events_delete_floor\` BEFORE DELETE ON \`email_events\` WHEN NOT ${pastFloor("OLD.received_at")} BEGIN ${named("email_events_delete_floor", "an email event is kept at least 366 days")} END;`,
    "DROP TRIGGER `client_requests_no_delete`;",
    `CREATE TRIGGER \`client_requests_delete_guard\` BEFORE DELETE ON \`client_requests\` WHEN NOT (OLD.status = 'closed' AND OLD.closed_at IS NOT NULL AND ${pastFloor("OLD.closed_at")}) BEGIN ${named("client_requests_delete_guard", "a request is deleted only when it closed more than 366 days ago")} END;`,
  ];

  // ---- 2. legal hold
  const holdValuesBad = `NEW.entity_type NOT IN (${q(LEGAL_HOLD_ENTITY_TYPES_0079)}) OR NEW.action NOT IN (${q(LEGAL_HOLD_ACTIONS_0079)})
    OR NOT EXISTS (SELECT 1 FROM staff_users o WHERE o.id = NEW.by AND o.role = 'owner' AND o.status = 'active')
    OR (NEW.entity_type = 'client' AND NOT EXISTS (SELECT 1 FROM clients e WHERE e.id = NEW.entity_id AND e.legal_hold = (NEW.action = 'clear')))
    OR (NEW.entity_type = 'contact' AND NOT EXISTS (SELECT 1 FROM contacts e WHERE e.id = NEW.entity_id AND e.legal_hold = (NEW.action = 'clear') AND e.anonymised_at IS NULL))
    OR (NEW.entity_type = 'lead' AND NOT EXISTS (SELECT 1 FROM leads e WHERE e.id = NEW.entity_id AND e.legal_hold = (NEW.action = 'clear')))`;
  const filesClient =
    "coalesce(OLD.client_id, (SELECT p.client_id FROM projects p WHERE p.id = OLD.project_id))";
  const hold = [
    `CREATE TRIGGER \`legal_holds_values\` BEFORE INSERT ON \`legal_holds\` WHEN ${holdValuesBad} BEGIN ${named("legal_holds_values", "a hold is set or cleared by an active Owner on an existing client, contact (not anonymised) or lead, and changes its state")} END;`,
    `CREATE TRIGGER \`legal_holds_mirror\` AFTER INSERT ON \`legal_holds\` BEGIN
       UPDATE clients SET legal_hold = (NEW.action = 'set') WHERE NEW.entity_type = 'client' AND id = NEW.entity_id;
       UPDATE contacts SET legal_hold = (NEW.action = 'set') WHERE NEW.entity_type = 'contact' AND id = NEW.entity_id;
       UPDATE leads SET legal_hold = (NEW.action = 'set') WHERE NEW.entity_type = 'lead' AND id = NEW.entity_id;
     END;`,
    `CREATE TRIGGER \`legal_holds_no_update\` BEFORE UPDATE ON \`legal_holds\` BEGIN ${named("legal_holds_no_update", "the legal hold history is never changed")} END;`,
    `CREATE TRIGGER \`legal_holds_no_delete\` BEFORE DELETE ON \`legal_holds\` BEGIN ${named("legal_holds_no_delete", "the legal hold history is never deleted")} END;`,
    `CREATE TRIGGER \`contacts_held_no_delete\` BEFORE DELETE ON \`contacts\` WHEN ${contactHeld("OLD")} BEGIN ${named("contacts_held_no_delete", "a contact under a legal hold (on itself, its client or a lead of the person) is not erased")} END;`,
    `CREATE TRIGGER \`contacts_held_no_anonymise\` BEFORE UPDATE OF anonymised_at ON \`contacts\` WHEN OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL AND ${contactHeld("OLD")} BEGIN ${named("contacts_held_no_anonymise", "a contact under a legal hold (on itself, its client or a lead of the person) is not anonymised")} END;`,
    `CREATE TRIGGER \`clients_held_no_anonymise\` BEFORE UPDATE OF anonymised_at ON \`clients\` WHEN OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL AND OLD.legal_hold = 1 BEGIN ${named("clients_held_no_anonymise", "a client under a legal hold is not anonymised")} END;`,
    `CREATE TRIGGER \`leads_held_no_delete\` BEFORE DELETE ON \`leads\` WHEN OLD.legal_hold = 1 BEGIN ${named("leads_held_no_delete", "a lead under a legal hold is not deleted")} END;`,
    `CREATE TRIGGER \`files_held_no_delete\` BEFORE DELETE ON \`files\` WHEN ${clientHeld(filesClient)} BEGIN ${named("files_held_no_delete", "a file of a client under a legal hold is not deleted")} END;`,
    `CREATE TRIGGER \`notes_held_no_delete\` BEFORE DELETE ON \`notes\` WHEN ${clientHeld(filesClient)} BEGIN ${named("notes_held_no_delete", "a note of a client under a legal hold is not deleted")} END;`,
    // Early check 1 M2: the offer's contact counts as held the same way as for its erase (itself, its client or a lead of the person).
    `CREATE TRIGGER \`documents_held_no_redact\` BEFORE UPDATE OF redacted_at ON \`documents\` WHEN OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL
       AND (${clientHeld("OLD.client_id")} OR EXISTS (SELECT 1 FROM contacts hk WHERE hk.id = OLD.contact_id AND ${contactHeld("hk")}))
       BEGIN ${named("documents_held_no_redact", "an offer of a client or contact under a legal hold (on itself, its client or a lead of the person) is not redacted")} END;`,
    // Early check 1 M2: a held lead is never marked erased (the lead erase sets the hash before its DELETE, the anonymise in its matched-leads UPDATE).
    `CREATE TRIGGER \`leads_held_no_erase\` BEFORE UPDATE OF erased_hash ON \`leads\` WHEN OLD.legal_hold = 1 AND NEW.erased_hash IS NOT OLD.erased_hash BEGIN ${named("leads_held_no_erase", "a lead under a legal hold is not erased")} END;`,
  ];

  // ---- 3. the anonymised lock (never on payments or payment notices: review fix 20)
  const lock = Object.entries(ANONYMISED_LOCK_0079).map(
    ([table, client]) =>
      `CREATE TRIGGER \`${table}_anonymised_lock\` BEFORE INSERT ON \`${table}\` WHEN ${clientGone(client)} BEGIN ${named(`${table}_anonymised_lock`, "an anonymised client takes nothing new")} END;`,
  );
  const changed = (cols: readonly string[]) =>
    cols.map((c) => `NEW.\`${c}\` IS NOT OLD.\`${c}\``).join(" OR ");
  // Step 0.3(b): the anonymise batch clears a registered individual's GSTIN in the statement after it sets `anonymised_at`; exactly that move stays allowed,
  // and only for an individual (early check 1 L3: a business keeps its GSTIN, a business's own identifier, not a person's).
  const gstinCleared =
    "OLD.type = 'individual' AND NEW.gstin IS NULL AND OLD.gst_status = 'registered' AND NEW.gst_status = 'unregistered' AND OLD.gstin IS NOT NULL";
  lock.push(
    `CREATE TRIGGER \`clients_anonymised_frozen\` BEFORE UPDATE ON \`clients\` WHEN OLD.anonymised_at IS NOT NULL
       AND (${changed(["legal_name", "display_name", "billing_address", "service_address", "notes", "tags", "type", "anonymised_at"])}
         OR ((${changed(["gstin", "gst_status"])}) AND NOT (${gstinCleared})))
       BEGIN ${named("clients_anonymised_frozen", "an anonymised client keeps its removed details removed")} END;`,
  );

  // ---- 4. the R2 outbox (zero batch statements). Early check 1 L8 (B1's choice): a key already queued is skipped by `ON CONFLICT (bucket, key) DO NOTHING`
  // only; any other failure (a key over 512 characters, the CHECK) aborts the delete or the redaction instead of losing the object silently, as `INSERT OR
  // IGNORE` would. Every key family written today is bounded far under 512 (a db test).
  const outbox = [
    `CREATE TRIGGER \`files_r2_outbox\` AFTER DELETE ON \`files\` BEGIN INSERT INTO r2_deletions (bucket, key, reason) VALUES ('files', OLD.r2_key, 'row_deleted') ON CONFLICT (bucket, key) DO NOTHING; END;`,
    `CREATE TRIGGER \`documents_redact_outbox\` AFTER UPDATE OF redacted_at ON \`documents\` WHEN OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL BEGIN
       INSERT INTO r2_deletions (bucket, key, reason)
         SELECT 'docs', k, 'redacted' FROM (
           SELECT OLD.snapshot_r2_key AS k UNION ALL SELECT OLD.pdf_r2_key
           UNION ALL SELECT (${PDF_STEM_SQL("OLD")}) || '.json' UNION ALL SELECT (${PDF_STEM_SQL("OLD")}) || '.pdf'
         ) WHERE k IS NOT NULL
         ON CONFLICT (bucket, key) DO NOTHING;
     END;`,
  ];

  // ---- 5. the erasure stop (M.1 settled, RB-46) and the receipts' hash and end (L30)
  const stop = [
    "DROP TRIGGER `email_suppressions_reason`;",
    "DROP TRIGGER `email_suppressions_reason_update`;",
    ...["email_suppressions_reason", "email_suppressions_reason_update"].map((name, i) => {
      const bad = `NEW.reason NOT IN (${q(SUPPRESSION_REASONS_0079)}) OR NEW.email IS NOT lower(NEW.email)
        OR (NEW.reason = 'erased') IS NOT (substr(NEW.email, 1, 2) = 'h:' AND ${isHex64("substr(NEW.email, 3)")})
        OR (NEW.reason <> 'erased' AND substr(NEW.email, 1, 2) = 'h:')`;
      return `CREATE TRIGGER \`${name}\` BEFORE ${i === 0 ? "INSERT" : "UPDATE OF email, reason"} ON \`email_suppressions\` WHEN ${bad} BEGIN ${named(name, "a stopped address is lower-cased and stopped for a hard bounce, a complaint or by hand, or is the keyed hash of an erased address")} END;`;
    }),
    `CREATE TRIGGER \`contacts_erased_hash\` BEFORE UPDATE OF erased_hash ON \`contacts\` WHEN (OLD.erased_hash IS NOT NULL AND NEW.erased_hash IS NOT OLD.erased_hash) OR (NEW.erased_hash IS NOT NULL AND NOT ${isHex64("NEW.erased_hash")}) BEGIN ${named("contacts_erased_hash", "an erased hash is 64 lower-case hex characters, set once")} END;`,
    `CREATE TRIGGER \`leads_erased_hash\` BEFORE UPDATE OF erased_hash ON \`leads\` WHEN (OLD.erased_hash IS NOT NULL AND NEW.erased_hash IS NOT OLD.erased_hash) OR (NEW.erased_hash IS NOT NULL AND NOT ${isHex64("NEW.erased_hash")}) BEGIN ${named("leads_erased_hash", "an erased hash is 64 lower-case hex characters, set once")} END;`,
    `CREATE TRIGGER \`contacts_erased_suppress\` AFTER UPDATE OF erased_hash ON \`contacts\` WHEN OLD.erased_hash IS NULL AND NEW.erased_hash IS NOT NULL AND NOT ${liveHolder("lower(OLD.email)", { contact: "OLD.id" })} BEGIN ${stopStatements("lower(OLD.email)")} END;`,
    `CREATE TRIGGER \`contacts_erased_receipts\` AFTER UPDATE OF erased_hash ON \`contacts\` WHEN OLD.erased_hash IS NULL AND NEW.erased_hash IS NOT NULL BEGIN ${receiptStatements("contact_id")} END;`,
    `CREATE TRIGGER \`leads_erased_suppress\` AFTER UPDATE OF erased_hash ON \`leads\` WHEN OLD.erased_hash IS NULL AND NEW.erased_hash IS NOT NULL AND NOT ${liveHolder("lower(OLD.contact_email)", { lead: "OLD.id" })} BEGIN ${stopStatements("lower(OLD.contact_email)")} END;`,
    `CREATE TRIGGER \`leads_erased_receipts\` AFTER UPDATE OF erased_hash ON \`leads\` WHEN OLD.erased_hash IS NULL AND NEW.erased_hash IS NOT NULL BEGIN ${receiptStatements("lead_id")} END;`,
  ];

  // ---- 6. client_requests: the kinds, the clock, the steps and the close
  // Every insert gives the clock (the portal: `received_at` = `created_at`; staff: the start of the IST day typed), checked against the SQL twin of core
  // `requestDueAt` (never a future day: 5 minutes of clock skew allowed). No trigger fills it afterwards: D1 counts a trigger's writes in `meta.changes`, and
  // the portal's insert reads `changes === 1`.
  const clockInsertBad = `NEW.channel NOT IN (${q(CHANNELS_0079)})
    OR NEW.received_at IS NULL OR NEW.received_at > ${NOW} + 300000 OR NEW.received_at > NEW.created_at + 300000
    OR (NEW.channel = 'portal' AND NEW.received_at IS NOT NEW.created_at)
    OR NEW.due_at IS NOT ${requestDueAtSql("NEW.received_at")} OR NEW.ack_due_at IS NOT NEW.received_at + 172800000
    OR (NEW.channel = 'portal') IS NOT (NEW.logged_by IS NULL)
    OR (NEW.logged_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff_users s WHERE s.id = NEW.logged_by AND s.status = 'active'))
    OR NEW.acknowledged_at IS NOT NULL OR NEW.identity_checked_by IS NOT NULL
    OR (NEW.identity_checked_at IS NOT NULL AND (NEW.channel <> 'portal' OR NEW.identity_checked_at IS NOT NEW.received_at))
    OR NEW.decline_reason IS NOT NULL OR NEW.action_audit_id IS NOT NULL OR NEW.export_sent_at IS NOT NULL
    OR (NEW.kind = 'data_erasure' AND NEW.contact_ref IS NULL AND NEW.lead_ref IS NULL AND NEW.requester_email IS NULL)
    OR (NEW.lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads cl WHERE cl.id = NEW.lead_id AND cl.client_id IS NOT NULL))`;
  const set = (col: string) => `(OLD.${col} IS NOT NULL AND NEW.${col} IS NOT OLD.${col})`;
  const stepsBad = `${changed(["channel", "logged_by", "received_at", "due_at", "ack_due_at"])}
    OR ${set("acknowledged_at")} OR ${set("identity_checked_at")} OR ${set("identity_checked_by")}
    OR (NEW.identity_checked_by IS NOT NULL AND NEW.identity_checked_at IS NULL)
    OR (NEW.identity_checked_at IS NOT NULL AND NEW.identity_checked_by IS NULL AND (NEW.channel <> 'portal' OR NEW.identity_checked_at IS NOT NEW.received_at))
    OR (OLD.identity_checked_at IS NULL AND NEW.identity_checked_at IS NOT NULL AND NEW.identity_checked_by IS NULL)
    OR (OLD.identity_checked_at IS NULL AND NEW.identity_checked_at IS NOT NULL AND NEW.identity_checked_at < NEW.received_at)
    OR (OLD.identity_checked_at IS NOT NULL AND NEW.identity_checked_by IS NOT OLD.identity_checked_by)
    OR (NEW.identity_checked_by IS NOT NULL AND NEW.identity_checked_by IS NOT OLD.identity_checked_by AND NOT EXISTS (SELECT 1 FROM staff_users s WHERE s.id = NEW.identity_checked_by AND s.status = 'active'))
    OR (NEW.acknowledged_at IS NOT NULL AND NEW.acknowledged_at < NEW.received_at)
    OR (NOT (OLD.status = 'open' AND NEW.status = 'closed') AND (${changed(["decline_reason", "action_audit_id", "export_sent_at"])}))`;
  const erasureAction = `EXISTS (SELECT 1 FROM audit_log a WHERE a.id = NEW.action_audit_id AND a.at >= NEW.received_at
      AND ((NEW.contact_ref IS NOT NULL AND a.action IN ('contact.erase', 'contact.anonymise') AND json_extract(a.summary, '$.contactId') = NEW.contact_ref)
        OR (NEW.lead_ref IS NOT NULL AND a.action = 'lead.erase' AND a.entity_type = 'lead' AND a.entity_id = NEW.lead_ref)))`;
  const closeBad = `OLD.status = 'open' AND NEW.status = 'closed' AND (
       (NEW.outcome = 'declined' AND (NEW.decline_reason IS NULL OR NEW.decline_reason NOT IN (${q(DECLINE_REASONS_0079)}) OR NEW.action_audit_id IS NOT NULL OR NEW.export_sent_at IS NOT NULL))
    OR (NEW.outcome = 'done' AND NEW.decline_reason IS NOT NULL)
    OR (NEW.outcome = 'done' AND NEW.kind IN (${q(IDENTITY_CHECKED_KINDS_0079)}) AND NEW.identity_checked_at IS NULL)
    OR (NEW.kind = 'data_erasure' AND NEW.contact_ref IS NULL AND NEW.lead_ref IS NULL
        AND (NEW.outcome IS NOT 'declined' OR NEW.decline_reason NOT IN (${q(EMAIL_ONLY_DECLINE_REASONS_0079)})))
    OR (NEW.kind = 'data_erasure' AND NEW.outcome = 'done' AND NOT ${erasureAction})
    OR (NEW.export_sent_at IS NOT NULL AND NOT (NEW.kind = 'data_access' AND NEW.outcome = 'done' AND NEW.export_sent_at >= 0)))`;
  const requests = [
    "DROP TRIGGER `client_requests_kind`;",
    `CREATE TRIGGER \`client_requests_kind\` BEFORE INSERT ON \`client_requests\` WHEN NEW.kind NOT IN (${q(REQUEST_KINDS_0079)}) BEGIN ${named("client_requests_kind", "a request is of a known kind")} END;`,
    `CREATE TRIGGER \`client_requests_clock_insert\` BEFORE INSERT ON \`client_requests\` WHEN ${clockInsertBad} BEGIN ${named("client_requests_clock_insert", "a request starts with its known channel, its clock (received, reply due, acknowledgement due) and no step or close detail (a portal request may start with its identity checked by the sign-in, when it arrived); staff log the requests that did not come through the portal; an erasure request names a contact, a lead or an address; a converted lead is never a subject")} END;`,
    `CREATE TRIGGER \`client_requests_steps\` BEFORE UPDATE ON \`client_requests\` WHEN ${stepsBad} BEGIN ${named("client_requests_steps", "a request keeps its clock and channel; it is acknowledged and its identity checked once each, the check by an active staff member (only a portal request is checked by its sign-in, when it arrived, with no staff member); the decline reason, the fulfilling action and the export date are set only by the close")} END;`,
    `CREATE TRIGGER \`client_requests_close_rules\` BEFORE UPDATE OF status ON \`client_requests\` WHEN ${closeBad} BEGIN ${named("client_requests_close_rules", "a declined request has a known reason; an access, correction, erasure or nomination request is done only once its identity is checked; a done erasure names the erase or anonymise of its own contact or lead, made after it arrived; a request naming only an address is declined; only a done access request has an export date")} END;`,
  ];

  // ---- 7. consent receipts, the outbox and the run tables
  const receiptBad = `NEW.event NOT IN (${q(CONSENT_EVENTS_0079)}) OR NEW.source NOT IN (${q(CONSENT_SOURCES_0079)})
    OR NOT json_valid(NEW.purposes) OR json_type(NEW.purposes) IS NOT 'array'
    OR EXISTS (SELECT 1 FROM json_each(NEW.purposes) p WHERE p.value NOT IN (${q(PURPOSES_0079)}) OR p.type <> 'text')
    OR NEW.marketing NOT IN (0, 1) OR typeof(NEW.at) <> 'integer' OR NEW.at < 0
    OR (NEW.subject_hash IS NOT NULL AND NOT ${isHex64("NEW.subject_hash")})
    OR (NEW.subject_hash IS NULL AND NEW.lead_id IS NULL AND NEW.contact_id IS NULL)
    OR (NEW.event = 'ended') IS NOT (NEW.source IN ('erasure', 'retention'))`;
  const keep = ["id", "event", "source", "notice_version", "purposes", "marketing", "ip_hash", "at"];
  const receiptUpdateOk = `NOT (${changed(keep)})
    AND (NEW.subject_hash IS OLD.subject_hash OR (OLD.subject_hash IS NULL AND ${isHex64("NEW.subject_hash")}))
    AND (NEW.lead_id IS OLD.lead_id OR NEW.lead_id IS NULL)
    AND (NEW.contact_id IS OLD.contact_id OR NEW.contact_id IS NULL)`;
  const youngOfSubject = (col: string) =>
    `(OLD.${col} IS NOT NULL AND EXISTS (SELECT 1 FROM consent_receipts y WHERE y.${col} = OLD.${col} AND NOT ${pastFloor("y.at")}))`;
  const receiptDeleteBad = `NOT ${pastFloor("OLD.at")} OR ${youngOfSubject("subject_hash")} OR ${youngOfSubject("lead_id")} OR ${youngOfSubject("contact_id")}`;
  const runs = [
    `CREATE TRIGGER \`consent_receipts_values\` BEFORE INSERT ON \`consent_receipts\` WHEN ${receiptBad} BEGIN ${named("consent_receipts_values", "a consent receipt has a known event, source and purposes, a time, a keyed hash or a link to its lead or contact, and only an end is written by an erasure or the clean-up")} END;`,
    `CREATE TRIGGER \`consent_receipts_no_update\` BEFORE UPDATE ON \`consent_receipts\` WHEN NOT (${receiptUpdateOk}) BEGIN ${named("consent_receipts_no_update", "a consent receipt only gains its keyed hash once and loses its link when the lead or contact is deleted")} END;`,
    `CREATE TRIGGER \`consent_receipts_no_delete\` BEFORE DELETE ON \`consent_receipts\` WHEN ${receiptDeleteBad} BEGIN ${named("consent_receipts_no_delete", "a consent receipt is deleted only when it and every receipt of its person are more than 366 days old")} END;`,
    `CREATE TRIGGER \`r2_deletions_values\` BEFORE INSERT ON \`r2_deletions\` WHEN NEW.bucket NOT IN (${q(R2_BUCKETS_0079)}) OR NEW.reason NOT IN (${q(R2_REASONS_0079)}) BEGIN ${named("r2_deletions_values", "an object to delete is in a known bucket for a known reason")} END;`,
    `CREATE TRIGGER \`r2_deletions_fixed\` BEFORE UPDATE ON \`r2_deletions\` WHEN ${changed(["id", "bucket", "key", "reason", "created_at"])} OR NEW.attempts < OLD.attempts BEGIN ${named("r2_deletions_fixed", "an object to delete keeps its key; only its attempts go up")} END;`,
    `CREATE TRIGGER \`retention_runs_values\` BEFORE INSERT ON \`retention_runs\` WHEN NEW.mode NOT IN (${q(RETENTION_MODES_0079)}) BEGIN ${named("retention_runs_values", "a clean-up run is a dry run or live")} END;`,
    `CREATE TRIGGER \`retention_runs_fixed\` BEFORE UPDATE ON \`retention_runs\` WHEN ${changed(["id", "as_of", "mode", "started_at", "families"])} OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS NOT OLD.finished_at) BEGIN ${named("retention_runs_fixed", "a clean-up run keeps its time and mode and finishes once")} END;`,
    `CREATE TRIGGER \`retention_run_counts_values\` BEFORE INSERT ON \`retention_run_counts\` WHEN NEW.family NOT IN (${q(RETENTION_FAMILIES_0079)}) OR NEW.done NOT IN (0, 1) BEGIN ${named("retention_run_counts_values", "a clean-up count is of a known family")} END;`,
    `CREATE TRIGGER \`retention_run_counts_fixed\` BEFORE UPDATE ON \`retention_run_counts\` WHEN ${changed(["run_id", "family"])} OR NEW.done NOT IN (0, 1) OR (OLD.done = 1 AND NEW.done = 0) BEGIN ${named("retention_run_counts_fixed", "a clean-up count keeps its run and family and is done once")} END;`,
  ];

  // ---- 8. Q3 A, L33: the audit scrub (ip and user agent to NULL, three alert summaries' ua, city and country removed) past 366 days, never for a held
  // subject; every other column equal; DELETE stays refused (`audit_log_no_delete`).
  const auditCols = [
    "id",
    "at",
    "actor_type",
    "actor_id",
    "role",
    "action",
    "entity_type",
    "entity_id",
    "request_id",
  ];
  const heldEntity = `((OLD.entity_type = 'client' AND ${clientHeld("OLD.entity_id")})
    OR (OLD.entity_type = 'contact' AND EXISTS (SELECT 1 FROM contacts hk WHERE hk.id = OLD.entity_id AND hk.legal_hold = 1))
    OR (OLD.entity_type = 'lead' AND EXISTS (SELECT 1 FROM leads hl WHERE hl.id = OLD.entity_id AND hl.legal_hold = 1)))`;
  const scrubOk = `${pastFloor("OLD.at")} AND NOT (${changed(auditCols)})
    AND (NEW.ip IS OLD.ip OR NEW.ip IS NULL) AND (NEW.user_agent IS OLD.user_agent OR NEW.user_agent IS NULL)
    AND (NEW.summary IS OLD.summary OR (OLD.action IN (${q(ALERT_ACTIONS_0079)}) AND json_valid(OLD.summary) AND NEW.summary IS json_remove(OLD.summary, ${q(ALERT_SCRUB_KEYS_0079)})))
    AND NOT ${heldEntity}`;
  const audit = [
    "DROP TRIGGER `audit_log_no_update`;",
    `CREATE TRIGGER \`audit_log_no_update\` BEFORE UPDATE ON \`audit_log\` WHEN NOT (${scrubOk}) BEGIN ${named("audit_log_no_update", "audit_log is append-only, except that a row more than 366 days old of a subject not under a legal hold loses its IP address and browser")} END;`,
  ];

  return [
    ...dataProtectionBackfill(),
    ...floors,
    ...hold,
    ...lock,
    ...outbox,
    ...stop,
    ...requests,
    ...runs,
    ...audit,
  ];
}
