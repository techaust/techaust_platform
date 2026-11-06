// What the long-term monthly backup may hold (M7.4 B.6; JOB-BKP-01; T7 F1; run file docs/runs/m7.4-data-protection.md L11, L35). The workflow itself is Phase
// 7 L7 (the owner's yes); this file only defines its scope. Owner decision 2026-10-07 (docs/13): the first-of-month copy kept 10 years holds the finance and
// GST tables only (invoices, notes, receipts, payments, the ledger and the audit rows of those), never leads or contacts, so erased personal data leaves every
// backup within the 90 days of the rolling copies; `documents` also holds proposals and estimates, so the monthly copy takes only the invoice family (T7 F1).
// L35: the `audit_log` export leaves out the IP address, the browser and the three alert summaries' `ua`, `city` and `country` (Settled by the lead on the
// safest reading, 2026-11-06 (08-C RB-48)). Every table is classified; a test fails on any table missing.
import { FINANCE_AUDIT_ACTIONS } from "@techaust/core/audit";
import { INVOICE_FAMILY_SQL } from "@techaust/core/clients";
import { ALERT_ACTIONS_0079, ALERT_SCRUB_KEYS_0079 } from "./triggers-data-protection.ts";

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
  // everything else: rolling copies only
  acceptances: R,
  acceptance_certificates: R,
  access_log: R,
  approvals: R,
  auth_attempts: R,
  bank_accounts: R,
  care_plan_status_log: R,
  care_plan_terms: R,
  care_plans: R,
  catalogue_items: R,
  catalogue_price_history: R,
  checkout_sessions: R,
  client_requests: R,
  client_sessions: R,
  clients: R,
  consent_receipts: R,
  contacts: R,
  deeds: R,
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
  terms_blocks: R,
  terms_versions: R,
  time_logs: R,
  webhook_events: R,
};

const q = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");
const INVOICE_DOCS = `SELECT id FROM documents WHERE type IN (${INVOICE_FAMILY_SQL})`;

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
 * The row filter (and, for `audit_log`, the column list) of each monthly table: the invoice family's documents and their child rows; the audit rows of the
 * finance actions (`FINANCE_AUDIT_ACTIONS`), without IP and browser and with the alert keys removed (an alert is not a finance action today; the removal
 * holds if one ever becomes one). Every other monthly table is taken whole.
 */
export function monthlyExportSql(table: string): string {
  if (BACKUP_SCOPE[table] !== "finance_monthly")
    throw new RangeError(`${table} is not in the monthly finance copy`);
  switch (table) {
    case "documents":
      return `SELECT * FROM documents WHERE type IN (${INVOICE_FAMILY_SQL})`;
    case "document_lines":
    case "document_sections":
    case "payment_schedules":
      return `SELECT * FROM ${table} WHERE document_id IN (${INVOICE_DOCS})`;
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
