// The retention matrix and its SQL (M7.4 A.6, B.5; ADM-SET-09, NFR-9, JOB-CRON-01; run file docs/runs/m7.4-data-protection.md). One row per table (a test
// fails on any table missing); for each job family the ONE predicate both the dry-run count and the live delete use (L5), so the trial report lists exactly
// what a live night removes. Financial records are never deleted (ADM-SET-09; Researched 2026-10-28, s.36 CGST Act (08-C RA-25)). Floors: Researched
// 2026-10-28, DPDP Rules 2025 Rule 8(3) (08-C RB-09); Settled by the lead on the safest reading, 2026-11-06 (08-C RB-48), 366 days in the triggers. The
// consent family and the `erased` stop rows: Settled by the lead on the safest reading, 2026-11-06 (08-C RB-46), L29, L30. The audit scrub: Settled by the
// lead on the safest reading, 2026-11-06 (08-C RB-48), L33.
//
// Placeholders of every family's SQL: `?1` the family's `before` (UTC ms; the stats family: an IST date "YYYY-MM-DD"; access_log: the UUIDv7 floor of
// `before`), `?2` the second figure (bells: `readBefore`; counters: `asOf`; access_log: `before` in UTC ms, its `at` bound (early check 1 L1); else unused
// but bound), `?3` the run id, `?4` the family name. `bindsOf` gives them.
import { istDate, toIsoDate } from "@techaust/core";
import { type RetentionCutoff, type RetentionFamily, SWITCH_LIVE_SQL } from "@techaust/core/retention";
import { ALERT_ACTIONS_0079, ALERT_SCRUB_KEYS_0079, auditIpDueSql, HELD_EMAIL_SQL } from "./dp-shared.ts";

/** How a table's rows end. */
export type RetentionRule =
  | { readonly kind: "family"; readonly family: RetentionFamily; readonly rule: string }
  | {
      readonly kind: "job";
      readonly job: "lead.purge" | "statement.purge" | "r2.drain" | "signin_pending.sweep";
      readonly rule: string;
    }
  | { readonly kind: "never"; readonly rule: string }
  | { readonly kind: "no_age_rule"; readonly rule: string }
  | { readonly kind: "staff_account"; readonly rule: string };

const financial = {
  kind: "never",
  rule: "financial record: never deleted (ADM-SET-09; RA-25; RB-37(b))",
} as const;
const record = (rule: string) => ({ kind: "never", rule }) as const;
const fam = (family: RetentionFamily, rule: string) => ({ kind: "family", family, rule }) as const;
const noAge = {
  kind: "no_age_rule",
  rule: "no age rule (07-A §5 8–10 years, first due after 2034): changes only by erase, anonymise or staff action",
} as const;
const staff = (rule: string) => ({ kind: "staff_account", rule }) as const;

/** A.6: every table, and how its rows end. The matrix test fails on any table of the schema missing here, or any name here not in the schema. */
export const RETENTION_MATRIX: Record<string, RetentionRule> = {
  // ---- deleted by a retention family or an existing job
  leads: {
    kind: "job",
    job: "lead.purge",
    rule: "unconverted, no hold, delete_after passed, no open data_erasure request naming it (leadsMonths ≥ 12)",
  },
  lead_activities: { kind: "job", job: "lead.purge", rule: "with its lead (ON DELETE CASCADE)" },
  email_log: fam(
    "email_log",
    "created_at and updated_at before emailLogMonths (≥ 12; floor 366 days); never to a held contact's or lead's address",
  ),
  email_events: fam("email_events", "received_at before emailLogMonths (floor 366 days)"),
  access_log: fam(
    "access_log",
    "UUIDv7 id before securityLogMonths (≥ 13; floor 366 days); never a held contact's rows",
  ),
  audit_log: fam(
    "audit_ip",
    "never deleted; ip, user_agent and the alert rows' ua/city/country removed after securityLogMonths (floor 366 days), never a held subject's (Q3 A, L33)",
  ),
  staff_sessions: fam("sessions", "30 days after abs_expires_at (L12)"),
  client_sessions: fam("sessions", "30 days after abs_expires_at (L12)"),
  magic_link_tokens: fam("sessions", "30 days after expires_at (L12)"),
  auth_attempts: fam("counters", "window older than 2 days and no lock in force"),
  pdf_asks: fam("counters", "asked more than 2 days ago"),
  hook_failures: fam(
    "counters",
    "window older than 2 days (a counter, not a payment record: Step 0.1 placed it here, out of the M6.2 never-deleted list)",
  ),
  notifications: fam(
    "bells",
    "read and older than 90 days, or any older than 12 months (L13); never a once-only marker (`BELL_MARKER_KINDS`, full audit AU10), whose title becomes a neutral line after 12 months (AU53)",
  ),
  stats_daily: fam(
    "stats",
    "per-plan rows (care metrics) older than 24 months; the aggregate rows are kept (L15)",
  ),
  client_requests: fam(
    "requests",
    "closed before requestsMonths (≥ 12, 36; floor 366 days); never a held subject's",
  ),
  consent_receipts: fam(
    "consent",
    "the subject ended (an ended receipt) and its newest receipt is older than consentProofMonths (≥ 12, 36; floor 366 days) (L30)",
  ),
  email_suppressions: fam(
    "consent",
    "only `erased` rows, ending with their subject's receipts (L29); hard-bounce, complaint and manual rows are kept (the stop list)",
  ),
  statement_pdfs: { kind: "job", job: "statement.purge", rule: "30 days (M5.5b)" },
  r2_deletions: { kind: "job", job: "r2.drain", rule: "deleted once its object is deleted" },
  retention_runs: fam("runs", "started more than 13 months ago"),
  retention_run_counts: fam("runs", "with its run (ON DELETE CASCADE)"),
  staff_signin_pending: {
    kind: "job",
    job: "signin_pending.sweep",
    rule: "deleted at the session start or once notified (M7.2, packages/db/src/signin-pending.ts)",
  },
  // ---- staff accounts (staff personal data, kept while the account exists; L36 for the devices)
  staff_users: staff(
    "kept while the account exists (deactivated, never deleted: the audit log names its actor)",
  ),
  staff_invites: staff("kept with the account it made; an expired invite is never usable"),
  staff_known_devices: staff(
    "L39, L47: kept while the account exists (the new-device alert's reference); deleted when the account is deactivated, in the same batch",
  ),
  staff_recovery_codes: staff("kept while the account exists (replaced as a set)"),
  staff_notification_prefs: staff("kept while the account exists"),
  // ---- no age rule
  clients: noAge,
  contacts: noAge,
  projects: noAge,
  milestones: noAge,
  notes: noAge,
  files: noAge,
  // ---- never deleted by any job
  documents: financial,
  document_lines: financial,
  document_sections: financial,
  payment_schedules: financial,
  acceptances: financial,
  acceptance_certificates: financial,
  document_sends: financial,
  offer_links: financial,
  doc_access_tokens: financial,
  approvals: financial,
  reminders: financial,
  advance_receipts: financial,
  payments: financial,
  payment_allocations: financial,
  realisation_extensions: financial,
  realisation_reductions: financial,
  realisation_advices: financial,
  realisation_advice_payments: financial,
  webhook_events: financial,
  checkout_sessions: financial,
  review_items: financial,
  payment_refunds: financial,
  settlements: financial,
  settlement_items: financial,
  bank_matches: financial,
  payment_notices: financial,
  pdf_failures: record(
    "kept with its document (ON DELETE CASCADE; documents are never deleted): the PDF bookkeeping of a financial record",
  ),
  care_plans: financial,
  care_plan_terms: financial,
  care_plan_status_log: financial,
  care_invoices: financial,
  time_logs: financial,
  doc_counters: financial,
  terms_blocks: record("terms text: never deleted (append-only)"),
  terms_versions: record("terms text: never deleted (append-only)"),
  fx_rates: financial,
  catalogue_items: record("catalogue: retired, never deleted"),
  catalogue_price_history: record("catalogue: append-only"),
  templates: record("append-only"),
  site_snapshots: record("append-only"),
  settings: record("settings: kept"),
  bank_accounts: financial,
  legal_holds: record("the legal hold history: append-only, never deleted"),
  retention_switches: record("the real-deletion switch history (C.7): append-only, never deleted"),
  deeds: record(
    "T11: a final or signed deed is the legal record of a transfer of rights (RB-38(a)); a draft goes only with an anonymised client",
  ),
  // Rebuild PDF (JOB-PDF-02): ids, keys and hashes only; the readers resolve the served PDF of a kept document through them for as long as it is kept.
  pdf_repairs: record(
    "Rebuild PDF: the request record of a stored PDF re-made (ids, keys and hashes only): append-only, never deleted",
  ),
  pdf_repair_results: record(
    "Rebuild PDF: how each request ended and the rebuilt key the readers serve: append-only, never deleted",
  ),
};

/** One table of a family: what makes a row old enough (`age`), what holds it (`held`, or none), the column the oldest date is read from, the page order. */
type FamilyTable = {
  readonly table: string;
  readonly age: string;
  readonly held: string | null;
  readonly oldest: string;
  readonly order: string;
  /** What a live page does to the rows: a delete (by default) or the audit scrub's UPDATE. */
  readonly scrub?: string;
};

/** A held contact (itself or its client) by an id expression. */
export const HELD_CONTACT_SQL = (contactId: string) =>
  `EXISTS (SELECT 1 FROM contacts hc JOIN clients hk ON hk.id = hc.client_id WHERE hc.id = ${contactId} AND (hc.legal_hold = 1 OR hk.legal_hold = 1))`;
// An address held by a contact (itself or its client) or a lead under a legal hold: in `dp-shared.ts` since the full audit (AU25 L1), so the admin API and
// the jobs purge read it without bundling the retention matrix; re-exported here unchanged.
export { HELD_EMAIL_SQL };

const HELD_CLIENT = (clientId: string) =>
  `EXISTS (SELECT 1 FROM clients hk WHERE hk.id = ${clientId} AND hk.legal_hold = 1)`;
const HELD_LEAD = (leadId: string) =>
  `EXISTS (SELECT 1 FROM leads hl WHERE hl.id = ${leadId} AND hl.legal_hold = 1)`;

const q = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/** A live lead (not erased) or a live contact (neither anonymised nor erased) by an id expression. */
const LIVE_LEAD = (leadId: string) =>
  `EXISTS (SELECT 1 FROM leads kl WHERE kl.id = ${leadId} AND kl.erased_hash IS NULL)`;
const LIVE_CONTACT = (contactId: string) =>
  `EXISTS (SELECT 1 FROM contacts kc WHERE kc.id = ${contactId} AND kc.anonymised_at IS NULL AND kc.erased_hash IS NULL)`;
/**
 * The consent family's rule for a hash `h` (H1, L46): no receipt of the hash is at or after the cut-off (`?1`), and none is linked to a live lead or contact,
 * or to a lead or contact that has any receipt at or after the cut-off. With `?1` at or before now minus 366 days (core `cutoffOf`), this is a subset of
 * what `consent_receipts_no_delete` allows, so a page never aborts on a young linked receipt.
 */
export const HASH_SETTLED_SQL = (h: string) =>
  `NOT EXISTS (SELECT 1 FROM consent_receipts y WHERE y.subject_hash = ${h} AND y.at >= ?1)
            AND NOT EXISTS (SELECT 1 FROM consent_receipts k WHERE k.subject_hash = ${h} AND (
              (k.lead_id IS NOT NULL AND (${LIVE_LEAD("k.lead_id")} OR EXISTS (SELECT 1 FROM consent_receipts yl WHERE yl.lead_id = k.lead_id AND yl.at >= ?1)))
              OR (k.contact_id IS NOT NULL AND (${LIVE_CONTACT("k.contact_id")} OR EXISTS (SELECT 1 FROM consent_receipts yc WHERE yc.contact_id = k.contact_id AND yc.at >= ?1)))))`;
/**
 * Full audit M6–M7 AU10 (B6 L1): the bell kinds a job reads back as a once-only marker ("rung once, ever"), so deleting one would make it ring again: the PDF
 * refusal (`pdf.refused`; the PDF sweep reads `pdf_failures.refused_at` too), the daily alerts' unbilled work and proforma due (`alerts.ts` reads them), and
 * the export realisation stages (`REALISATION_BELLS_SQL`). The `bells` family never deletes them; they are few (one per document or milestone and owner).
 * AU53: after 12 months in all it replaces their title with `BELL_MARKER_SCRUBBED_TITLE` (the title can name a client or a person).
 */
export const BELL_MARKER_KINDS = [
  "pdf.refused",
  "milestone.unbilled",
  "proforma.tax_invoice_due",
  "export.fema_approaching",
  "export.fema_overdue",
  "export.gst_approaching",
  "export.gst_overdue",
] as const;

/**
 * Full audit AU53: the title a once-only marker bell keeps after 12 months (staff-only; the builder's draft for the lead, run file "AF3 report"). Plain
 * ASCII without quotes, so it sits in the SQL as a literal.
 */
export const BELL_MARKER_SCRUBBED_TITLE =
  "An alert from over a year ago. Its details were removed after 12 months.";

/** The per-plan statistics (a care plan id in `dimension`). */
export const PER_PLAN_METRICS = ["care.used_minutes", "care.available_minutes"] as const;

/** Each family's tables, in the order a page handles them. */
export const FAMILY_TABLES: Record<RetentionFamily, readonly FamilyTable[]> = {
  email_log: [
    {
      table: "email_log",
      age: "email_log.created_at < ?1 AND email_log.updated_at < ?1",
      held: HELD_EMAIL_SQL("email_log.to_email"),
      oldest: "created_at",
      order: "created_at, id",
    },
  ],
  email_events: [
    {
      table: "email_events",
      age: "email_events.received_at < ?1",
      held: null,
      oldest: "received_at",
      order: "received_at, id",
    },
  ],
  access_log: [
    {
      table: "access_log",
      // L1 (early check 1): the id's time and the stored `at` both before the cut-off, so the row passes the floor trigger's `at` check whatever its id says.
      age: "access_log.id < ?1 AND access_log.at < ?2",
      held: `(access_log.realm = 'portal' AND access_log.actor_id IS NOT NULL AND ${HELD_CONTACT_SQL("access_log.actor_id")})`,
      oldest: "at",
      order: "id",
    },
  ],
  audit_ip: [
    {
      table: "audit_log",
      // Early check 2, low 7: the same text as the WHERE of the partial index `audit_log_ip_due` (at, id), so the scan reads only rows still to scrub.
      age: `audit_log.at < ?1 AND ${auditIpDueSql("audit_log.")}`,
      held: `((audit_log.entity_type = 'client' AND ${HELD_CLIENT("audit_log.entity_id")})
        OR (audit_log.entity_type = 'contact' AND EXISTS (SELECT 1 FROM contacts hc WHERE hc.id = audit_log.entity_id AND hc.legal_hold = 1))
        OR (audit_log.entity_type = 'lead' AND ${HELD_LEAD("audit_log.entity_id")}))`,
      oldest: "at",
      order: "at, id",
      scrub: `ip = NULL, user_agent = NULL, summary = CASE WHEN action IN (${q(ALERT_ACTIONS_0079)}) AND json_valid(summary) THEN json_remove(summary, ${q(ALERT_SCRUB_KEYS_0079)}) ELSE summary END`,
    },
  ],
  sessions: [
    {
      table: "staff_sessions",
      age: "staff_sessions.abs_expires_at < ?1",
      held: null,
      oldest: "abs_expires_at",
      order: "abs_expires_at",
    },
    {
      table: "client_sessions",
      age: "client_sessions.abs_expires_at < ?1",
      held: null,
      oldest: "abs_expires_at",
      order: "abs_expires_at",
    },
    {
      table: "magic_link_tokens",
      age: "magic_link_tokens.expires_at < ?1",
      held: null,
      oldest: "expires_at",
      order: "expires_at",
    },
  ],
  counters: [
    {
      table: "auth_attempts",
      age: "auth_attempts.window_start < ?1 AND (auth_attempts.locked_until IS NULL OR auth_attempts.locked_until < ?2)",
      held: null,
      oldest: "window_start",
      order: "window_start",
    },
    { table: "pdf_asks", age: "pdf_asks.asked_at < ?1", held: null, oldest: "asked_at", order: "asked_at" },
    {
      table: "hook_failures",
      age: "hook_failures.window_start < ?1",
      held: null,
      oldest: "window_start",
      order: "window_start",
    },
  ],
  bells: [
    {
      table: "notifications",
      age: `notifications.created_at < ?2 AND (notifications.read_at IS NOT NULL OR notifications.created_at < ?1) AND notifications.kind NOT IN (${q(BELL_MARKER_KINDS)})`,
      held: null,
      oldest: "created_at",
      order: "created_at, id",
    },
    {
      // Full audit M6–M7 AU53 (early check of AF2, M3; Settled by the lead on the safest reading, 2026-11-07, DPDP Act 2023 s.8(7) (08-C RB-11)): a
      // once-only marker bell stays (deleting it would ring again), but after 12 months in all its title, which can name a client or a person, becomes
      // one neutral line. The link (ids only) stays. A scrubbed row is no longer due, so a page never takes it twice.
      table: "notifications",
      age: `notifications.created_at < ?1 AND notifications.kind IN (${q(BELL_MARKER_KINDS)}) AND notifications.title <> '${BELL_MARKER_SCRUBBED_TITLE}'`,
      held: null,
      oldest: "created_at",
      order: "created_at, id",
      scrub: `title = '${BELL_MARKER_SCRUBBED_TITLE}'`,
    },
  ],
  stats: [
    {
      table: "stats_daily",
      age: `stats_daily.metric IN (${q(PER_PLAN_METRICS)}) AND stats_daily.date < ?1`,
      held: null,
      oldest: "date",
      order: "metric, date",
    },
  ],
  requests: [
    {
      table: "client_requests",
      age: "client_requests.status = 'closed' AND client_requests.closed_at < ?1",
      held: `((client_requests.client_id IS NOT NULL AND ${HELD_CLIENT("client_requests.client_id")})
        OR (client_requests.contact_id IS NOT NULL AND EXISTS (SELECT 1 FROM contacts hc WHERE hc.id = client_requests.contact_id AND hc.legal_hold = 1))
        OR (client_requests.lead_id IS NOT NULL AND ${HELD_LEAD("client_requests.lead_id")}))`,
      oldest: "closed_at",
      order: "closed_at, id",
    },
  ],
  consent: [
    {
      table: "consent_receipts",
      // L30, L46: a subject's receipts go together, once the subject has ended (an `ended` receipt, written by an erasure or the purge, carries its hash),
      // none of its receipts is at or after the cut-off, and (early check 1 H1) none of them is linked to a live lead or contact, or to a lead or contact
      // with a receipt at or after the cut-off (the link checks of the trigger `consent_receipts_no_delete`): an `ended` receipt of an earlier, purged lead
      // never takes the proof of a live record with the same address. Every receipt of one hash shares the verdict, so a hash goes whole. A receipt with
      // neither a hash nor a link (a lead purged before hashes existed) goes on its own age. L4: a page takes the `ended` rows last (`order`), so an `ended`
      // row is never deleted while another receipt of its hash remains.
      // RULE (early check 1 re-check): every receipt of one hash must share ONE verdict (due or not due, together). L4's page order depends on it: the
      // `ended` row goes in the page that takes the last of its hash only because no receipt of that hash can be left behind as "not due". So no per-row
      // condition may ever be added to the hashed branch (its `at < ?1` is implied for every receipt of the hash by HASH_SETTLED_SQL); a new condition
      // must be a condition on the hash as a whole, or the predicate and the order must be redesigned together.
      age: `consent_receipts.at < ?1 AND (
          (consent_receipts.subject_hash IS NOT NULL
            AND EXISTS (SELECT 1 FROM consent_receipts e WHERE e.subject_hash = consent_receipts.subject_hash AND e.event = 'ended')
            AND ${HASH_SETTLED_SQL("consent_receipts.subject_hash")})
          OR (consent_receipts.subject_hash IS NULL AND consent_receipts.lead_id IS NULL AND consent_receipts.contact_id IS NULL))`,
      held: null,
      oldest: "at",
      order: "(event = 'ended'), at, id",
    },
    {
      table: "email_suppressions",
      // L29: the `h:` stop ends with its subject's receipts (none at or after the cut-off, none linked to a live record: H1).
      age: `email_suppressions.reason = 'erased' AND email_suppressions.at < ?1
        AND ${HASH_SETTLED_SQL("substr(email_suppressions.email, 3)")}`,
      held: null,
      oldest: "at",
      order: "at",
    },
  ],
  runs: [
    {
      table: "retention_runs",
      age: "retention_runs.started_at < ?1",
      held: null,
      oldest: "started_at",
      order: "started_at, id",
    },
  ],
};

/** The dry run counts at most this many rows of a table (one batch, rows read bounded). */
export const DRY_RUN_COUNT_CAP = 10_000;
/** A live page removes at most this many rows of each table of the family. */
export const LIVE_PAGE_ROWS = 500;
/**
 * Full audit M6–M7 AU9 (B6 M1), AU40, AU51 (early check of AF2, M1): a live run stops once the rows D1 measured as written by its batches (`written`, the
 * sum of `meta.rows_written` of every statement of each page batch, index and trigger writes included, added by the consumer after each batch:
 * `RECORD_WRITTEN_SQL`) reach this many across ALL its families, so a backlog after months of dry runs never spends the account's 100,000 daily D1 row
 * writes in one night. A page is taken only while the run's total is below the budget, so a night writes at most the budget plus one page
 * (`LIVE_PAGE_WRITE_CEILING`). A page that finds the budget spent deletes nothing and ends its family with `capped` (and `more_tomorrow` when it has rows
 * due); the next night's run carries on, and this run still finishes and rings as before.
 */
export const RUN_WRITE_BUDGET = 40_000;
/**
 * AU51: the most rows one live page may write (its upsert, up to 500 deletes or scrubs per table of its family with their index and trigger writes, the run's
 * finish and bell), so the worst night is `RUN_WRITE_BUDGET + LIVE_PAGE_WRITE_CEILING`, well inside D1's 100,000 a day. A db test measures a full page of
 * the families against it (`retention-budget.test.ts`).
 */
export const LIVE_PAGE_WRITE_CEILING = 10_000;
/**
 * AU51: the consumer adds a page batch's measured writes to its family's row (`?1` run, `?2` family, `?3` rows written, a whole number >= 0) right after the
 * batch, before it queues the next page (the leads queue runs one message at a time, so the next page reads the total).
 */
export const RECORD_WRITTEN_SQL =
  "UPDATE retention_run_counts SET written = written + ?3 WHERE run_id = ?1 AND family = ?2 AND ?3 > 0";
/** AU51: the rows a batch wrote, as D1 measured them (`meta.rows_written` of each statement; a missing figure counts 0). */
export const rowsWrittenOf = (results: readonly { meta?: { rows_written?: number } }[]): number =>
  results.reduce((n, r) => n + Math.max(0, Math.trunc(r.meta?.rows_written ?? 0)), 0);

/** The single predicate of a table (L5): old enough and not held. Both the dry-run count and the live page select with it. */
export const dueWhere = (t: FamilyTable): string => (t.held ? `(${t.age}) AND NOT ${t.held}` : `(${t.age})`);
const heldWhere = (t: FamilyTable): string | null => (t.held ? `(${t.age}) AND ${t.held}` : null);

/** The UUIDv7 that sorts before every id made at or after `ms` (access_log rows are pruned by id: every writer uses `uuidv7`, `packages/db/src/log.ts`). */
export function uuidv7Floor(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms >= 2 ** 48) throw new RangeError(`Bad timestamp: ${ms}`);
  const hex = ms.toString(16).padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-0000-0000-000000000000`;
}

/** `?1` and `?2` of a family for a run at `asOf` with its cut-off (see the header). */
export function bindsOf(family: RetentionFamily, cutoff: RetentionCutoff, asOf: number): [unknown, unknown] {
  switch (family) {
    case "access_log":
      return [uuidv7Floor(cutoff.before), cutoff.before];
    case "stats":
      return [toIsoDate(istDate(cutoff.before)), asOf];
    case "bells":
      return [cutoff.before, cutoff.readBefore ?? cutoff.before];
    default:
      return [cutoff.before, asOf];
  }
}

const countOf = (t: FamilyTable, where: string, cap: number) =>
  `(SELECT count(*) FROM (SELECT 1 FROM ${t.table} WHERE ${where} LIMIT ${cap}))`;
const oldestOf = (t: FamilyTable) =>
  t.table === "stats_daily"
    ? `(SELECT (CAST(strftime('%s', min(date)) AS INTEGER) - 19800) * 1000 FROM stats_daily WHERE ${dueWhere(t)})`
    : `(SELECT min(${t.oldest}) FROM ${t.table} WHERE ${dueWhere(t)})`;
const sum = (xs: string[]) => (xs.length === 1 ? (xs[0] as string) : `(${xs.join(" + ")})`);
const minOf = (xs: string[]) =>
  xs.length === 1
    ? (xs[0] as string)
    : `(SELECT min(x) FROM (${xs.map((x) => `SELECT ${x} AS x`).join(" UNION ALL ")}))`;

/**
 * The dry run of a family (one batch, one statement): rows due (each table counted up to `DRY_RUN_COUNT_CAP`), rows held back by a legal hold, the oldest
 * due date, `done`, and (full audit AU9) `capped` when any table's due count reached the cap (the screen says "10,000 or more"), into
 * `retention_run_counts`. Each table is counted once: the counts are columns of one sub-select, read by the sum and by the cap test. Writes nothing else.
 * Binds: `?1`, `?2` (`bindsOf`), `?3` run id, `?4` family.
 */
export function dryRunSql(family: RetentionFamily): string {
  const tables = FAMILY_TABLES[family];
  const cols = tables.map((t, i) => `${countOf(t, dueWhere(t), DRY_RUN_COUNT_CAP)} AS c${i}`);
  const due = sum(tables.map((_, i) => `c${i}`));
  const capped = tables.map((_, i) => `c${i} >= ${DRY_RUN_COUNT_CAP}`).join(" OR ");
  const helds = tables
    .map((t) => heldWhere(t))
    .flatMap((w, i) => (w ? [countOf(tables[i] as FamilyTable, w, DRY_RUN_COUNT_CAP)] : []));
  const held = helds.length ? sum(helds) : "0";
  // An upsert fed by a SELECT needs a WHERE (SQLite's parsing rule for ON CONFLICT after a SELECT).
  return `INSERT INTO retention_run_counts (run_id, family, due, held_skipped, oldest_at, done, capped)
    SELECT ?3, ?4, ${due}, ${held}, ${minOf(tables.map(oldestOf))}, 1, (${capped}) FROM (SELECT ${cols.join(", ")}) WHERE 1
    ON CONFLICT(run_id, family) DO UPDATE SET due = excluded.due, held_skipped = excluded.held_skipped, oldest_at = excluded.oldest_at, done = 1, capped = excluded.capped`;
}

/**
 * One live page of a family: first the count upsert (the page's rows, read with the same predicate in the same transaction, added to `due`; `held_skipped`
 * and `oldest_at` read and set on the first page only (L6: CASE runs only the branch it takes, so a later page, which finds its row, runs neither read);
 * `done` once every table had fewer than a full page), then per table `DELETE … WHERE rowid IN (SELECT rowid …
 * ORDER BY … LIMIT 500)` (never `DELETE … LIMIT`, a build option D1 may lack), or the audit scrub's UPDATE. The consumer sends the family again while
 * `done` is 0. Statements: 1 + the family's tables.
 *
 * Early check 2 M2: every statement also holds the real-deletion switch (`SWITCH_LIVE_SQL`; one batch is one transaction, so all of them read the same row).
 * A page queued before the Owner turned the switch off deletes and scrubs nothing, adds 0 to `due` and marks the family done (`done` 1 whatever the tables
 * hold), so the consumer stops sending it and the run finishes. CASE runs only the branch it takes, so a stopped page reads none of the tables. The switch is
 * never part of `dueWhere`: the dry run counts the same rows whatever the switch says.
 */
export function livePageSql(family: RetentionFamily): string[] {
  const tables = FAMILY_TABLES[family];
  const page = (t: FamilyTable) => countOf(t, dueWhere(t), LIVE_PAGE_ROWS);
  const helds = tables
    .map((t) => heldWhere(t))
    .flatMap((w, i) => (w ? [countOf(tables[i] as FamilyTable, w, DRY_RUN_COUNT_CAP)] : []));
  const done = tables.map((t) => `${page(t)} < ${LIVE_PAGE_ROWS}`).join(" AND ");
  const onFirst = (x: string, otherwise: string) =>
    `CASE WHEN NOT EXISTS (SELECT 1 FROM retention_run_counts WHERE run_id = ?3 AND family = ?4) THEN ${x} ELSE ${otherwise} END`;
  const ifLive = (x: string, off: string) => `CASE WHEN ${SWITCH_LIVE_SQL} THEN ${x} ELSE ${off} END`;
  // AU9, AU40, AU51: `pages` counts the run's live pages, family by family; `spent` is the rows the run's batches wrote BEFORE this page, as D1 measured
  // them (`written`, added after each batch). A page within the budget counts and acts (and, when rows are left, the consumer sends the next one). A page
  // that finds the budget spent counts nothing, acts on nothing (`capped` 1, which the deletes read), and ends its family, with `more_tomorrow` when rows are
  // due. A stopped page (the switch went off) is done as before and never marks either.
  const spent = "(SELECT coalesce(sum(rs.written), 0) FROM retention_run_counts rs WHERE rs.run_id = ?3)";
  const within = `${spent} < ${RUN_WRITE_BUDGET}`;
  const anyDue = tables.map((t) => `EXISTS (SELECT 1 FROM ${t.table} WHERE ${dueWhere(t)})`).join(" OR ");
  const upsert = `INSERT INTO retention_run_counts (run_id, family, due, held_skipped, oldest_at, done, pages, capped, more_tomorrow)
    VALUES (?3, ?4, ${ifLive(`CASE WHEN ${within} THEN ${sum(tables.map(page))} ELSE 0 END`, "0")}, ${helds.length ? ifLive(onFirst(sum(helds), "0"), "0") : "0"}, ${ifLive(onFirst(minOf(tables.map(oldestOf)), "NULL"), "NULL")},
      ${ifLive(`CASE WHEN ${within} THEN (${done}) ELSE 1 END`, "1")}, ${ifLive(`CASE WHEN ${within} THEN 1 ELSE 0 END`, "0")},
      ${ifLive(`CASE WHEN ${within} THEN 0 ELSE 1 END`, "0")}, ${ifLive(`CASE WHEN ${within} THEN 0 ELSE (${anyDue}) END`, "0")})
    ON CONFLICT(run_id, family) DO UPDATE SET due = retention_run_counts.due + excluded.due, pages = retention_run_counts.pages + excluded.pages,
      done = excluded.done, capped = max(retention_run_counts.capped, excluded.capped),
      more_tomorrow = max(retention_run_counts.more_tomorrow, excluded.more_tomorrow)`;
  // AU40, AU51: a page after the run's budget acts on nothing (its family's row says `capped`, written by the upsert above in the same batch).
  const notCapped =
    "NOT EXISTS (SELECT 1 FROM retention_run_counts cr WHERE cr.run_id = ?3 AND cr.family = ?4 AND cr.capped = 1)";
  const act = tables.map((t) => {
    const ids = `SELECT rowid FROM ${t.table} WHERE ${dueWhere(t)} ORDER BY ${t.order} LIMIT ${LIVE_PAGE_ROWS}`;
    return t.scrub
      ? `UPDATE ${t.table} SET ${t.scrub} WHERE rowid IN (${ids}) AND ${SWITCH_LIVE_SQL} AND ${notCapped}`
      : `DELETE FROM ${t.table} WHERE rowid IN (${ids}) AND ${SWITCH_LIVE_SQL} AND ${notCapped}`;
  });
  return [upsert, ...act];
}

/**
 * Prepared statements of a family's dry run (`mode` dry_run) or one live page, bound for the run. `db` is the D1 binding; one `db.batch` runs them.
 */
export function retentionStatements(
  db: D1Database,
  family: RetentionFamily,
  mode: "dry_run" | "live",
  cutoff: RetentionCutoff,
  asOf: number,
  runId: string,
): D1PreparedStatement[] {
  const binds = [...bindsOf(family, cutoff, asOf), runId, family];
  const sqls = mode === "dry_run" ? [dryRunSql(family)] : livePageSql(family);
  // Each statement takes the placeholders up to the highest it names (a delete names ?1, sometimes ?2; the upsert all four).
  return sqls.map((s) => db.prepare(s).bind(...binds.slice(0, highestPlaceholder(s))));
}

/** The highest `?N` a statement names. */
export const highestPlaceholder = (sql: string): number =>
  Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
