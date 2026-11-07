// What the long-term monthly backup may hold (M7.4 B.6; JOB-BKP-01; T7 F1; run file docs/runs/m7.4-data-protection.md L11, L35). The workflow itself is Phase
// 7 L7 (the owner's yes); this file only defines its scope. Owner decision 2026-10-07 (docs/13): the first-of-month copy kept 10 years holds the finance and
// GST tables only (invoices, notes, receipts, payments, the ledger and the audit rows of those), never leads or contacts, so erased personal data leaves every
// backup within the 90 days of the rolling copies; `documents` also holds proposals and estimates, so the monthly copy takes only the invoice family (T7 F1).
// L35: the `audit_log` export leaves out the IP address, the browser and the three alert summaries' `ua`, `city` and `country` (Settled by the lead on the
// safest reading, 2026-11-06 (08-C RB-48)). L40: the contract records read with the invoices join it: the deeds (numbered ones), the proposal and estimate
// terms versions and the terms blocks that sent documents pin, and the care plans' terms and status history. Every table is classified; a test fails on any
// table missing. L48 (lead, 2026-11-06): accepted proposals and estimates, their acceptances and certificates join the monthly copy (Settled by the lead on
// the safest reading, 2026-10-30 (08-C RB-37)). P7 ops (lead, 2026-11-07; the privacy notice: long-term archive copies hold only invoices, payments and
// other tax records): no contact's personal data in the 10-year copy. An acceptance is kept only as evidence that a document was accepted (ids, time, way,
// hashes, terms), without the typed name, the email, the IP address, the browser or the country, as L35 does for `audit_log`; a document's frozen
// recipient block loses the contact's name and the email (the client's legal name, address, GSTIN and state, which Rule 46 needs, stay) (Settled by the
// lead on the safest reading, 2026-11-07 (08-C RB-12)).
import { FINANCE_AUDIT_ACTIONS } from "@techaust/core/audit";
import { INVOICE_FAMILY_SQL } from "@techaust/core/clients";
import { getTableColumns } from "drizzle-orm";
import { ALERT_ACTIONS_0079, ALERT_SCRUB_KEYS_0079 } from "./dp-shared.ts";
import { documents } from "./schema/documents.ts";

export type BackupScope = "finance_monthly" | "rolling_only";

const F = "finance_monthly" as const;
const R = "rolling_only" as const;

/** Every table: in the monthly finance copy (10 years) or only in the rolling copies (90 days). For the lead and the owner to confirm before L7. */
export const BACKUP_SCOPE: Record<string, BackupScope> = {
  // finance and GST
  documents: F,
  document_lines: F,
  document_sections: F,
  payment_schedules: F,
  doc_counters: F,
  advance_receipts: F,
  payments: F,
  payment_allocations: F,
  payment_refunds: F,
  realisation_extensions: F,
  realisation_reductions: F,
  realisation_advices: F,
  realisation_advice_payments: F,
  settlements: F,
  settlement_items: F,
  bank_matches: F,
  care_invoices: F,
  fx_rates: F,
  audit_log: F,
  // contract records read with the invoices for 8 years (L40)
  deeds: F,
  terms_versions: F,
  terms_blocks: F,
  care_plan_terms: F,
  care_plan_status_log: F,
  // L48: an accepted proposal or estimate (the version accepted, with its lines, sections and schedule), its acceptance and certificate
  acceptances: F,
  acceptance_certificates: F,
  // everything else: rolling copies only
  access_log: R,
  approvals: R,
  auth_attempts: R,
  bank_accounts: R,
  care_plans: R,
  catalogue_items: R,
  catalogue_price_history: R,
  checkout_sessions: R,
  client_requests: R,
  client_sessions: R,
  clients: R,
  consent_receipts: R,
  contacts: R,
  doc_access_tokens: R,
  document_sends: R,
  email_events: R,
  email_log: R,
  email_suppressions: R,
  files: R,
  hook_failures: R,
  lead_activities: R,
  leads: R,
  legal_holds: R,
  retention_switches: R,
  magic_link_tokens: R,
  milestones: R,
  notes: R,
  notifications: R,
  offer_links: R,
  payment_notices: R,
  pdf_asks: R,
  pdf_failures: R,
  projects: R,
  r2_deletions: R,
  reminders: R,
  retention_run_counts: R,
  retention_runs: R,
  review_items: R,
  settings: R,
  site_snapshots: R,
  staff_invites: R,
  staff_known_devices: R,
  staff_notification_prefs: R,
  staff_recovery_codes: R,
  staff_sessions: R,
  staff_signin_pending: R,
  staff_users: R,
  statement_pdfs: R,
  stats_daily: R,
  templates: R,
  time_logs: R,
  webhook_events: R,
};

const q = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");
/** L48: the accepted versions of proposals and estimates (an acceptance names the version accepted). */
const ACCEPTED_OFFERS = "SELECT document_id FROM acceptances";
const MONTHLY_DOCS = `SELECT id FROM documents WHERE type IN (${INVOICE_FAMILY_SQL}) OR id IN (${ACCEPTED_OFFERS})`;

/** The columns of `audit_log` the monthly copy keeps: never `ip` or `user_agent` (L35). */
export const AUDIT_EXPORT_COLUMNS = [
  "id",
  "at",
  "actor_type",
  "actor_id",
  "role",
  "action",
  "entity_type",
  "entity_id",
  "summary",
  "request_id",
] as const;

/**
 * The columns of `acceptances` the monthly copy keeps (P7 ops): the ids, the time, the way it was accepted and the hashes and terms that prove what was
 * accepted. Never `typed_name`, `email`, `ip`, `user_agent` or `country`. A new column is classified here or in `ACCEPTANCE_PERSONAL_COLUMNS` (a test
 * fails otherwise).
 */
export const ACCEPTANCE_EXPORT_COLUMNS = [
  "id",
  "document_id",
  "contact_id",
  "session_id",
  "accepted_at",
  "pdf_sha256",
  "terms_version_id",
  "certificate_r2_key",
  "via",
  "offer_link_hash",
  "snapshot_sha256",
] as const;
/** The personal columns of `acceptances`, never in the monthly copy. */
export const ACCEPTANCE_PERSONAL_COLUMNS = ["typed_name", "email", "ip", "user_agent", "country"] as const;

/** The keys removed from a document's frozen `recipient` block in the monthly copy (P7 ops): the contact's name and the email. */
export const RECIPIENT_SCRUB_KEYS = ["email", "contactName"] as const;

/**
 * The columns of `documents` written as NULL in the monthly copy (lead, 2026-11-07, the same safest reading): `decision_note` is the client's own free
 * text when deciding on an offer, not a tax record.
 */
export const BLANKED_DOCUMENT_COLUMNS = ["decision_note"] as const;

/** Every column of `documents` (from the schema, so a new column joins the copy), `recipient` scrubbed of `RECIPIENT_SCRUB_KEYS`, `BLANKED_DOCUMENT_COLUMNS` NULL. */
const documentColumns = () =>
  Object.values(getTableColumns(documents))
    .map((c) => c.name)
    .map((c) =>
      c === "recipient"
        ? `CASE WHEN json_valid(recipient) THEN json_remove(recipient, ${q(RECIPIENT_SCRUB_KEYS.map((k) => `$.${k}`))}) ELSE recipient END AS recipient`
        : BLANKED_DOCUMENT_COLUMNS.includes(c as (typeof BLANKED_DOCUMENT_COLUMNS)[number])
          ? `NULL AS ${c}`
          : c,
    )
    .join(", ");

/**
 * The row filter (and, for `audit_log`, `acceptances` and `documents`, the column list) of each monthly table: the invoice family's documents (the
 * recipient block without the contact's name and the email) and their child rows; the audit rows of the finance actions (`FINANCE_AUDIT_ACTIONS`), without IP and browser and with the alert keys removed (an alert is not a finance action today; the removal
 * holds if one ever becomes one); L40: the terms versions and blocks a sent (frozen) document or an acceptance pins, never an unused draft text; the deeds
 * that were numbered (finalised, signed, or cancelled after finalising), never a draft. L48: the accepted version of a proposal or estimate joins the
 * invoice family with its child rows (RB-37 (b): accepted offers are kept as long as the tax records); a never-accepted offer stays rolling-only. P7 ops:
 * an acceptance only in `ACCEPTANCE_EXPORT_COLUMNS` (no name, email, IP, browser or country). Every other monthly table (the acceptance certificates
 * included: a key and a hash) is taken whole.
 */
export function monthlyExportSql(table: string): string {
  if (BACKUP_SCOPE[table] !== "finance_monthly")
    throw new RangeError(`${table} is not in the monthly finance copy`);
  switch (table) {
    case "documents":
      return `SELECT ${documentColumns()} FROM documents WHERE type IN (${INVOICE_FAMILY_SQL}) OR id IN (${ACCEPTED_OFFERS})`;
    case "acceptances":
      return `SELECT ${ACCEPTANCE_EXPORT_COLUMNS.join(", ")} FROM acceptances`;
    case "document_lines":
    case "document_sections":
    case "payment_schedules":
      return `SELECT * FROM ${table} WHERE document_id IN (${MONTHLY_DOCS})`;
    case "terms_versions":
      return `SELECT * FROM terms_versions WHERE id IN (SELECT terms_version_id FROM documents WHERE frozen_at IS NOT NULL AND terms_version_id IS NOT NULL)
        OR id IN (SELECT terms_version_id FROM acceptances WHERE terms_version_id IS NOT NULL)`;
    case "terms_blocks":
      return "SELECT * FROM terms_blocks WHERE id IN (SELECT export_declaration_id FROM documents WHERE frozen_at IS NOT NULL AND export_declaration_id IS NOT NULL)";
    case "deeds":
      return "SELECT * FROM deeds WHERE number IS NOT NULL";
    case "audit_log": {
      const cols = AUDIT_EXPORT_COLUMNS.map((c) =>
        c === "summary"
          ? `CASE WHEN action IN (${q(ALERT_ACTIONS_0079)}) AND json_valid(summary) THEN json_remove(summary, ${q(ALERT_SCRUB_KEYS_0079)}) ELSE summary END AS summary`
          : c,
      );
      return `SELECT ${cols.join(", ")} FROM audit_log WHERE action IN (${q(FINANCE_AUDIT_ACTIONS)})`;
    }
    default:
      return `SELECT * FROM ${table}`;
  }
}
