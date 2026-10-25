// Integrity triggers (docs/05 §5.3), generated from the schema so no column is forgotten. The SQL is written
// once into a hand-written migration (scripts/write-triggers.ts); a later schema change that adds a document
// column needs a new migration that drops and recreates the trigger, and test/triggers.test.ts fails until
// the installed trigger covers every content column.
import { INVOICE_FAMILY_SQL } from "@techaust/core/clients";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { documentLines, documentSections, paymentSchedules } from "./schema/documents.ts";
import {
  acceptances,
  accessLog,
  auditLog,
  cataloguePriceHistory,
  clientSessions,
  docCounters,
  documents,
  magicLinkTokens,
  staffUsers,
  termsBlocks,
  termsVersions,
} from "./schema/index.ts";

/** Columns of an issued document that may still change (ledger, status, void and e-invoice fields). */
export const MUTABLE_AFTER_FREEZE = [
  "status",
  "paid_minor",
  "credited_minor",
  "balance_minor",
  "irn",
  "ack_no",
  "ack_date",
  "signed_qr",
  "einv_status",
  "updated_at",
] as const;

/** Columns that may be filled in once after freezing (the PDF renders after issue; voiding is one-way). */
export const SET_ONCE_AFTER_FREEZE = [
  "snapshot_r2_key",
  "pdf_r2_key",
  "pdf_sha256",
  "voided_at",
  "void_reason",
] as const;

const columnNames = (table: Parameters<typeof getTableColumns>[0]) =>
  Object.values(getTableColumns(table)).map((c) => c.name);

/** Every documents column that is frozen at issue. */
export const frozenDocumentColumns = (): string[] => {
  const skip = new Set<string>([...MUTABLE_AFTER_FREEZE, ...SET_ONCE_AFTER_FREEZE]);
  return columnNames(documents).filter((c) => !skip.has(c));
};

const abort = (message: string) => `SELECT RAISE(ABORT, '${message}');`;
const appendOnly = (table: string) => [
  `CREATE TRIGGER \`${table}_no_update\` BEFORE UPDATE ON \`${table}\` BEGIN ${abort(`${table} is append-only`)} END;`,
  `CREATE TRIGGER \`${table}_no_delete\` BEFORE DELETE ON \`${table}\` BEGIN ${abort(`${table} is append-only`)} END;`,
];

/** Child rows of a document (lines, sections, payment schedule) are frozen with their parent. */
const frozenChildren = (table: string) => {
  const parentFrozen = (ref: "NEW" | "OLD") =>
    `(SELECT frozen_at FROM documents WHERE id = ${ref}.document_id) IS NOT NULL`;
  const msg = `${table} of an issued document cannot change`;
  return [
    `CREATE TRIGGER \`${table}_frozen_insert\` BEFORE INSERT ON \`${table}\` WHEN ${parentFrozen("NEW")} BEGIN ${abort(msg)} END;`,
    `CREATE TRIGGER \`${table}_frozen_update\` BEFORE UPDATE ON \`${table}\` WHEN ${parentFrozen("OLD")} OR ${parentFrozen("NEW")} BEGIN ${abort(msg)} END;`,
    `CREATE TRIGGER \`${table}_frozen_delete\` BEFORE DELETE ON \`${table}\` WHEN ${parentFrozen("OLD")} BEGIN ${abort(msg)} END;`,
  ];
};

export function triggerStatements(): string[] {
  const changed = frozenDocumentColumns().map((c) => `NEW.\`${c}\` IS NOT OLD.\`${c}\``);
  const setOnce = SET_ONCE_AFTER_FREEZE.map(
    (c) => `(OLD.\`${c}\` IS NOT NULL AND NEW.\`${c}\` IS NOT OLD.\`${c}\`)`,
  );
  const table = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).name;
  return [
    // Issued documents: content is frozen (ADM-INV-07, ADM-PROP-05). Corrections only via credit/debit notes.
    `CREATE TRIGGER \`documents_frozen_update\` BEFORE UPDATE ON \`documents\` WHEN OLD.frozen_at IS NOT NULL AND (\n  ${[...changed, ...setOnce].join("\n  OR ")}\n) BEGIN ${abort("issued document is frozen")} END;`,
    `CREATE TRIGGER \`documents_frozen_delete\` BEFORE DELETE ON \`documents\` WHEN OLD.frozen_at IS NOT NULL BEGIN ${abort("issued document cannot be deleted")} END;`,
    ...frozenChildren(table(documentLines)),
    ...frozenChildren(table(documentSections)),
    ...frozenChildren(table(paymentSchedules)),
    // Append-only evidence and history.
    ...appendOnly(table(auditLog)),
    ...appendOnly(table(acceptances)),
    ...appendOnly(table(cataloguePriceHistory)),
    // Gap-free numbering: counters only move forward and are never deleted (ADM-SET-04, ADM-INV-03).
    `CREATE TRIGGER \`doc_counters_no_decrease\` BEFORE UPDATE ON \`${table(docCounters)}\` WHEN NEW.next_no < OLD.next_no OR NEW.series IS NOT OLD.series OR NEW.fy IS NOT OLD.fy BEGIN ${abort("document counters only move forward")} END;`,
    `CREATE TRIGGER \`doc_counters_no_delete\` BEFORE DELETE ON \`${table(docCounters)}\` BEGIN ${abort("document counters cannot be deleted")} END;`,
    // The issue guard and its post-condition live in issueGuardStatements() (migration 0007). 0001 first created
    // an `issue_guard` that also accepted `pending_approval`; 0007 narrows it to `draft`.
  ];
}

/**
 * Staff-auth triggers (M1.5; a separate list and migration because the existing triggers have no IF NOT EXISTS):
 * - the last active owner can't be demoted, deactivated or reset (ADM-AUTH-07; backs the API's `last_owner` check);
 * - `access_log` rows can't be changed. DELETE stays open until the retention job (M7.4) adds its own guard.
 * `staff_users` has no delete trigger on purpose: the CPU benchmark deletes its throwaway users.
 */
export function authTriggerStatements(): string[] {
  const table = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).name;
  return [
    `CREATE TRIGGER \`staff_users_keep_owner\` BEFORE UPDATE OF role, status ON \`${table(staffUsers)}\` WHEN OLD.role = 'owner' AND OLD.status = 'active' AND (NEW.role <> 'owner' OR NEW.status <> 'active') AND NOT EXISTS (SELECT 1 FROM staff_users WHERE role = 'owner' AND status = 'active' AND id <> OLD.id) BEGIN ${abort("at least one active owner is required")} END;`,
    `CREATE TRIGGER \`access_log_no_update\` BEFORE UPDATE ON \`${table(accessLog)}\` BEGIN ${abort("access_log is append-only")} END;`,
  ];
}

/**
 * Portal-auth triggers (M1.6, POR-01, POR-02; a separate set because the existing triggers have no IF NOT EXISTS):
 * - a magic link's `used_at` is write-once (a used link can't be made fresh again);
 * - a client session's `revoked_at` is write-once (a signed-out session can't be revived);
 * - a client session's `contact_id` and `client_id` never change (a session always belongs to one contact at one
 *   organisation; moving a contact ends the session through the guard's join, it never re-points it).
 */
export function portalTriggerStatements(): string[] {
  const table = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).name;
  return [
    `CREATE TRIGGER \`magic_link_tokens_used_once\` BEFORE UPDATE OF used_at ON \`${table(magicLinkTokens)}\` WHEN OLD.used_at IS NOT NULL AND NEW.used_at IS NOT OLD.used_at BEGIN ${abort("a magic link use is write-once")} END;`,
    `CREATE TRIGGER \`client_sessions_revoked_once\` BEFORE UPDATE OF revoked_at ON \`${table(clientSessions)}\` WHEN OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at BEGIN ${abort("a client session revocation is write-once")} END;`,
    `CREATE TRIGGER \`client_sessions_keep_owner\` BEFORE UPDATE OF contact_id, client_id ON \`${table(clientSessions)}\` WHEN NEW.contact_id IS NOT OLD.contact_id OR NEW.client_id IS NOT OLD.client_id BEGIN ${abort("a client session contact and client cannot change")} END;`,
  ];
}

/**
 * Document-terms triggers (M3.1, ADM-SET-08; a separate set because the existing triggers have no IF NOT EXISTS):
 * a terms version is never edited or deleted, a change is a new version. Covers `terms_versions` (proposal and
 * invoice footer, referenced by documents) and `terms_blocks` (the other three kinds). No table is rebuilt.
 */
export function termsTriggerStatements(): string[] {
  const table = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).name;
  return [...appendOnly(table(termsVersions)), ...appendOnly(table(termsBlocks))];
}

/**
 * Client and contact triggers (M3.3, ADM-CLI-01, ADM-CLI-05; a separate set because the existing triggers have no IF NOT EXISTS;
 * neither table is rebuilt, they are referenced). VERIFY WITH CA/LEGAL:
 * - a client's currency cannot change once ANY invoice-family document of any status exists (the API's conditional write is
 *   the first line, this is the backstop; a proposal or estimate alone does not lock it);
 * - an anonymised contact is frozen (the tombstone cannot be edited or revived);
 * - a client in India (registered or unregistered) has a two-digit state code and an overseas client has none (owner answer
 *   Q1, 2026-10-25). The existing rows are not checked: only an insert, or a change to the status or the state, is.
 */
export function clientTriggerStatements(): string[] {
  const needsState =
    "NEW.gst_status IN ('registered', 'unregistered') AND (NEW.state_code IS NULL OR NOT (NEW.state_code GLOB '[0-9][0-9]'))";
  const noState = "NEW.gst_status = 'overseas' AND NEW.state_code IS NOT NULL";
  const bad = `(${needsState}) OR (${noState})`;
  const msg = abort("a client in India needs a state code and an overseas client has none");
  return [
    `CREATE TRIGGER \`clients_currency_locked\` BEFORE UPDATE OF currency ON \`clients\` WHEN NEW.currency IS NOT OLD.currency AND EXISTS (SELECT 1 FROM documents WHERE client_id = OLD.id AND type IN (${INVOICE_FAMILY_SQL})) BEGIN ${abort("currency is locked: the client has an invoice")} END;`,
    `CREATE TRIGGER \`contacts_anonymised_frozen\` BEFORE UPDATE ON \`contacts\` WHEN OLD.anonymised_at IS NOT NULL BEGIN ${abort("an anonymised contact cannot change")} END;`,
    `CREATE TRIGGER \`clients_state_check_insert\` BEFORE INSERT ON \`clients\` WHEN ${bad} BEGIN ${msg} END;`,
    `CREATE TRIGGER \`clients_state_check_update\` BEFORE UPDATE OF gst_status, state_code ON \`clients\` WHEN ${bad} BEGIN ${msg} END;`,
  ];
}

/**
 * Client type lock (M3.3 review, ADM-CLI-01; a separate set, the earlier ones have no IF NOT EXISTS): a client's type decides
 * which erase rules apply, so it cannot change once any issued (frozen) document exists. The API's conditional write is the first
 * line, this is the backstop. VERIFY WITH CA/LEGAL.
 */
export function clientTypeLockStatements(): string[] {
  return [
    `CREATE TRIGGER \`clients_type_locked\` BEFORE UPDATE OF type ON \`clients\` WHEN NEW.type IS NOT OLD.type AND EXISTS (SELECT 1 FROM documents WHERE client_id = OLD.id AND frozen_at IS NOT NULL) BEGIN ${abort("client type is locked: the client has an issued document")} END;`,
  ];
}

/**
 * Projects, milestones, notes and files (M3.4, ADM-PRJ-01..05; a separate set, the earlier ones have no IF NOT EXISTS). The API
 * checks these too; the triggers are the backstop that holds whatever writes to the tables.
 *   - a note or file always has a client, and when it names a project, that project belongs to the same client;
 *   - a project's client never changes;
 *   - a milestone is a fixed amount or a percentage of the budget (exactly one), and an amount is never negative;
 *   - a stored file never changes except for its `shared` flag (a different file is a new row).
 */
export function projectTriggerStatements(): string[] {
  const scope = (table: string) => {
    const bad =
      "NEW.client_id IS NULL OR (NEW.project_id IS NOT NULL AND (SELECT client_id FROM projects WHERE id = NEW.project_id) IS NOT NEW.client_id)";
    const msg = abort(`a ${table.slice(0, -1)} needs a client, and its project must belong to that client`);
    return [
      `CREATE TRIGGER \`${table}_scope_insert\` BEFORE INSERT ON \`${table}\` WHEN ${bad} BEGIN ${msg} END;`,
      `CREATE TRIGGER \`${table}_scope_update\` BEFORE UPDATE OF client_id, project_id ON \`${table}\` WHEN ${bad} BEGIN ${msg} END;`,
    ];
  };
  const mBad = "(NEW.amount_minor IS NULL) = (NEW.pct_bp IS NULL) OR NEW.amount_minor < 0";
  const mMsg = abort("a milestone has an amount or a percentage, not both, and the amount is not negative");
  const fileCols = [
    "id",
    "client_id",
    "project_id",
    "r2_key",
    "filename",
    "mime",
    "size",
    "sha256",
    "uploaded_by",
    "created_at",
  ];
  return [
    `CREATE TRIGGER \`projects_client_fixed\` BEFORE UPDATE OF client_id ON \`projects\` WHEN NEW.client_id IS NOT OLD.client_id BEGIN ${abort("the client of a project cannot change")} END;`,
    ...scope("notes"),
    ...scope("files"),
    `CREATE TRIGGER \`milestones_amount_or_pct_insert\` BEFORE INSERT ON \`milestones\` WHEN ${mBad} BEGIN ${mMsg} END;`,
    `CREATE TRIGGER \`milestones_amount_or_pct_update\` BEFORE UPDATE OF amount_minor, pct_bp ON \`milestones\` WHEN ${mBad} BEGIN ${mMsg} END;`,
    `CREATE TRIGGER \`files_immutable\` BEFORE UPDATE ON \`files\` WHEN ${fileCols.map((c) => `NEW.${c} IS NOT OLD.${c}`).join(" OR ")} BEGIN ${abort("a stored file cannot change except whether it is shared")} END;`,
  ];
}

/**
 * Care plans, their history and time logs (M3.5, ADM-CARE-01, ADM-TIME-01..03; a separate set, the earlier ones have no IF NOT EXISTS;
 * no table is rebuilt: `care_plans` and `time_logs` are referenced). Every abort message starts with the trigger's name, so the API
 * can tell which rule refused a write. The API checks the same rules in SQL conditions first; these are the backstop for whatever
 * writes to the tables.
 *   - an entry belongs to exactly one project or care plan; a person logs at most 24 hours a day; a work date is a real date;
 *   - a care-plan entry needs the plan to be ACTIVE on the work date (its newest status row on or before that date);
 *   - nothing is logged on a cancelled project; an entry's person never changes;
 *   - the two history tables are append-only; a plan's client, currency, billing day and start date never change;
 *   - the plan's price, hours, rate and rollover (and status) are always the newest history row (the mirror cannot drift).
 */
export function timeTriggerStatements(): string[] {
  const named = (name: string, message: string) => abort(`${name}: ${message}`);
  const oneTargetBad = "(NEW.project_id IS NULL) = (NEW.care_plan_id IS NULL)";
  const dayCapBad =
    "(SELECT coalesce(sum(minutes), 0) FROM time_logs WHERE user_id = NEW.user_id AND work_date = NEW.work_date AND id IS NOT NEW.id) + NEW.minutes > 1440";
  const dateBad = "date(NEW.work_date) IS NOT NEW.work_date";
  const planInactiveBad =
    "NEW.care_plan_id IS NOT NULL AND (SELECT status FROM care_plan_status_log WHERE care_plan_id = NEW.care_plan_id AND effective_on <= NEW.work_date ORDER BY effective_on DESC, created_at DESC, id DESC LIMIT 1) IS NOT 'active'";
  const projectClosedBad =
    "NEW.project_id IS NOT NULL AND (SELECT status FROM projects WHERE id = NEW.project_id) = 'cancelled'";
  const history = (table: string) => [
    `CREATE TRIGGER \`${table}_no_update\` BEFORE UPDATE ON \`${table}\` BEGIN ${named(`${table}_no_update`, `${table} is append-only`)} END;`,
    `CREATE TRIGGER \`${table}_no_delete\` BEFORE DELETE ON \`${table}\` BEGIN ${named(`${table}_no_delete`, `${table} is append-only`)} END;`,
  ];
  const newestTerms =
    "(SELECT id FROM care_plan_terms WHERE care_plan_id = NEW.id ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1)";
  const termsDrift = `NOT EXISTS (SELECT 1 FROM care_plan_terms t WHERE t.id = ${newestTerms} AND t.tier IS NEW.tier AND t.price_minor IS NEW.price_minor AND t.included_minutes IS NEW.included_minutes AND t.ai_ops_minor IS NEW.ai_ops_minor AND t.overage_rate_minor IS NEW.overage_rate_minor AND t.rollover IS NEW.rollover)`;
  const statusDrift =
    "NEW.status IS NOT (SELECT status FROM care_plan_status_log WHERE care_plan_id = NEW.id ORDER BY effective_on DESC, created_at DESC, id DESC LIMIT 1)";
  const fixed =
    "NEW.client_id IS NOT OLD.client_id OR NEW.currency IS NOT OLD.currency OR NEW.billing_day IS NOT OLD.billing_day OR NEW.start_date IS NOT OLD.start_date";
  return [
    `CREATE TRIGGER \`time_logs_one_target_insert\` BEFORE INSERT ON \`time_logs\` WHEN ${oneTargetBad} BEGIN ${named("time_logs_one_target_insert", "an entry belongs to exactly one project or care plan")} END;`,
    `CREATE TRIGGER \`time_logs_one_target_update\` BEFORE UPDATE OF project_id, care_plan_id ON \`time_logs\` WHEN ${oneTargetBad} BEGIN ${named("time_logs_one_target_update", "an entry belongs to exactly one project or care plan")} END;`,
    `CREATE TRIGGER \`time_logs_day_cap_insert\` BEFORE INSERT ON \`time_logs\` WHEN ${dayCapBad} BEGIN ${named("time_logs_day_cap_insert", "a person logs at most 24 hours a day")} END;`,
    `CREATE TRIGGER \`time_logs_day_cap_update\` BEFORE UPDATE OF user_id, work_date, minutes ON \`time_logs\` WHEN ${dayCapBad} BEGIN ${named("time_logs_day_cap_update", "a person logs at most 24 hours a day")} END;`,
    `CREATE TRIGGER \`time_logs_date_valid_insert\` BEFORE INSERT ON \`time_logs\` WHEN ${dateBad} BEGIN ${named("time_logs_date_valid_insert", "the work date is not a date")} END;`,
    `CREATE TRIGGER \`time_logs_date_valid_update\` BEFORE UPDATE OF work_date ON \`time_logs\` WHEN ${dateBad} BEGIN ${named("time_logs_date_valid_update", "the work date is not a date")} END;`,
    `CREATE TRIGGER \`time_logs_plan_active_insert\` BEFORE INSERT ON \`time_logs\` WHEN ${planInactiveBad} BEGIN ${named("time_logs_plan_active_insert", "the care plan is not active on that date")} END;`,
    `CREATE TRIGGER \`time_logs_plan_active_update\` BEFORE UPDATE OF care_plan_id, work_date ON \`time_logs\` WHEN ${planInactiveBad} BEGIN ${named("time_logs_plan_active_update", "the care plan is not active on that date")} END;`,
    `CREATE TRIGGER \`time_logs_project_open_insert\` BEFORE INSERT ON \`time_logs\` WHEN ${projectClosedBad} BEGIN ${named("time_logs_project_open_insert", "the project is cancelled")} END;`,
    `CREATE TRIGGER \`time_logs_project_open_update\` BEFORE UPDATE OF project_id ON \`time_logs\` WHEN NEW.project_id IS NOT OLD.project_id AND ${projectClosedBad} BEGIN ${named("time_logs_project_open_update", "the project is cancelled")} END;`,
    `CREATE TRIGGER \`time_logs_user_fixed\` BEFORE UPDATE OF user_id ON \`time_logs\` WHEN NEW.user_id IS NOT OLD.user_id BEGIN ${named("time_logs_user_fixed", "the person of a time entry cannot change")} END;`,
    ...history("care_plan_terms"),
    ...history("care_plan_status_log"),
    `CREATE TRIGGER \`care_plans_fixed\` BEFORE UPDATE OF client_id, currency, billing_day, start_date ON \`care_plans\` WHEN ${fixed} BEGIN ${named("care_plans_fixed", "the client, currency, billing day and start date of a care plan cannot change")} END;`,
    `CREATE TRIGGER \`care_plans_terms_match\` BEFORE UPDATE OF tier, price_minor, included_minutes, ai_ops_minor, overage_rate_minor, rollover ON \`care_plans\` WHEN ${termsDrift} BEGIN ${named("care_plans_terms_match", "the terms of a care plan are the newest row of its terms history")} END;`,
    `CREATE TRIGGER \`care_plans_status_match\` BEFORE UPDATE OF status ON \`care_plans\` WHEN ${statusDrift} BEGIN ${named("care_plans_status_match", "the status of a care plan is the newest row of its status history")} END;`,
  ];
}

/** The only statuses a document can be issued from (docs/05 §5.4 change 14: drafts only; owner decision 2026-10-07).
 * An approval (`approvals`, kind `issue`) is a record next to the draft, not a document status. Shared by the guard
 * trigger below and by the reference issue batch in test/helpers.ts, so the two cannot drift apart again. */
export const ISSUABLE_STATUSES = ["draft"] as const;
const issuableSql = ISSUABLE_STATUSES.map((s) => `'${s}'`).join(", ");

/**
 * The issue guard and post-condition (docs/05 §5.4), a separate set and migration (0007) because 0001's guard
 * accepted `pending_approval` and its trigger can't be edited in place. Every issue batch is:
 *   1. `INSERT INTO issue_guard (document_id) VALUES (?)`: aborts unless the document is an unfrozen draft;
 *   2. take the number (counter row, increment) and freeze the document with it;
 *   3. `INSERT INTO issue_result (document_id, series, fy) VALUES (?, ?, ?)`: aborts unless the document is now
 *      issued and frozen with exactly the number the counter just handed out (a zero-row UPDATE passes silently
 *      otherwise, and the counter would have moved for nothing).
 * D1 runs the batch as one transaction, so an abort rolls the counter back too.
 */
export function issueGuardStatements(): string[] {
  return [
    "DROP TRIGGER `issue_guard_check`;",
    `CREATE TRIGGER \`issue_guard_check\` INSTEAD OF INSERT ON \`issue_guard\` WHEN NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND status IN (${issuableSql}) AND frozen_at IS NULL) BEGIN ${abort("document is not an issuable draft")} END;`,
    "CREATE VIEW `issue_result` AS SELECT NULL AS document_id, NULL AS series, NULL AS fy;",
    `CREATE TRIGGER \`issue_result_check\` INSTEAD OF INSERT ON \`issue_result\` WHEN NOT EXISTS (SELECT 1 FROM documents d JOIN doc_counters c ON c.series = NEW.series AND c.fy = NEW.fy WHERE d.id = NEW.document_id AND d.status = 'issued' AND d.frozen_at IS NOT NULL AND d.series = NEW.series AND d.fy = NEW.fy AND d.number >= 1 AND d.number = c.next_no - 1 AND d.number_display IS NOT NULL) BEGIN ${abort("issue did not freeze the document with the number just taken")} END;`,
  ];
}

/** The trigger sets, by the name the migration is created with (`drizzle-kit generate --custom --name <set>`). */
export const TRIGGER_SETS = {
  triggers: { what: "integrity triggers (docs/05 §5.3)", statements: triggerStatements },
  auth_triggers: { what: "staff-auth triggers (M1.5)", statements: authTriggerStatements },
  portal_triggers: { what: "portal-auth triggers (M1.6)", statements: portalTriggerStatements },
  terms_triggers: { what: "document-terms append-only triggers (M3.1)", statements: termsTriggerStatements },
  client_triggers: {
    what: "client currency lock, anonymised-contact freeze and state-code check (M3.3)",
    statements: clientTriggerStatements,
  },
  client_type_lock: {
    what: "client type lock once a document is issued (M3.3 review)",
    statements: clientTypeLockStatements,
  },
  project_triggers: {
    what: "project, milestone, note and file integrity (M3.4)",
    statements: projectTriggerStatements,
  },
  time_triggers: {
    what: "time-log, care-plan history and mirror integrity (M3.5)",
    statements: timeTriggerStatements,
  },
  issue_guard: {
    what: "issue guard narrowed to drafts, plus the issue post-condition (docs/05 §5.4)",
    statements: issueGuardStatements,
  },
} as const;
export type TriggerSet = keyof typeof TRIGGER_SETS;

export const triggerMigrationSql = (set: TriggerSet = "triggers") =>
  `-- Hand-written: ${TRIGGER_SETS[set].what}, generated by scripts/write-triggers.ts from src/triggers.ts.\n${TRIGGER_SETS[set].statements().join("\n--> statement-breakpoint\n")}\n`;
