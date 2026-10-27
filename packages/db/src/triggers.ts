// Integrity triggers (docs/05 §5.3), generated from the schema so no column is forgotten. The SQL is written
// once into a hand-written migration (scripts/write-triggers.ts); a later schema change that adds a document
// column needs a new migration that drops and recreates the trigger, and test/triggers.test.ts fails until
// the installed trigger covers every content column.
import { INVOICE_FAMILY_SQL, QUOTE_DOCUMENT_TYPES } from "@techaust/core/clients";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import {
  acceptanceCertificates,
  documentLines,
  documentSections,
  OFFER_LINK_PURPOSES,
  paymentSchedules,
} from "./schema/documents.ts";
import {
  acceptances,
  accessLog,
  auditLog,
  cataloguePriceHistory,
  clientSessions,
  docCounters,
  documents,
  magicLinkTokens,
  siteSnapshots,
  staffUsers,
  templates,
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
  // M5.3 (LD46): the client's IMS response to a credit note; the triggers of 0042 allow only the moves of `canSetImsStatus`.
  "ims_status",
  "updated_at",
] as const;

/** Columns that may be filled in once after freezing in migration 0001 (the PDF renders after issue; voiding is one-way). Pinned. */
export const SET_ONCE_0001 = [
  "snapshot_r2_key",
  "pdf_r2_key",
  "pdf_sha256",
  "voided_at",
  "void_reason",
] as const;

/**
 * Columns that may be filled in once after freezing, today. M4.3 adds the portal's reads and the client's decision (M4.5 writes
 * them): each can be set once, then never changed. M5.2 adds `service_completed_on` (LD29: set once, through `invoices.draft`).
 * Migration 0032 holds the list as it was before: `SET_ONCE_0032`.
 */
export const SET_ONCE_AFTER_FREEZE = [
  ...SET_ONCE_0001,
  "viewed_at",
  "decided_at",
  "decision_reason",
  "decision_note",
  "decided_contact_id",
  "service_completed_on",
] as const;

/** The set-once list exactly as migration 0032 installed it (pinned, LD35: a later column must not move the bytes of 0032). */
export const SET_ONCE_0032 = [
  ...SET_ONCE_0001,
  "viewed_at",
  "decided_at",
  "decision_reason",
  "decision_note",
  "decided_contact_id",
] as const;

const columnNames = (table: Parameters<typeof getTableColumns>[0]) =>
  Object.values(getTableColumns(table)).map((c) => c.name);

/** Every documents column that is frozen at issue, over the live schema. */
export const frozenDocumentColumns = (): string[] => {
  const skip = new Set<string>([...MUTABLE_AFTER_FREEZE, ...SET_ONCE_AFTER_FREEZE]);
  return columnNames(documents).filter((c) => !skip.has(c));
};

/**
 * The documents columns frozen by migration 0001, exactly as that file lists them. No documents column had been added before M4.3, so
 * this is also what the live schema gave then. `triggerStatements()` uses this pinned list, so the `triggers` set still generates
 * 0001 byte for byte after the table grew; the live list goes into the recreated trigger of the `document_triggers` set (0032).
 */
export const FROZEN_COLUMNS_0001 = [
  "id",
  "type",
  "client_id",
  "project_id",
  "care_plan_id",
  "parent_id",
  "version_group_id",
  "version",
  "series",
  "fy",
  "number",
  "number_display",
  "currency",
  "issue_date",
  "due_date",
  "valid_until",
  "supply_type",
  "place_of_supply_code",
  "recipient",
  "fx_rate_micros",
  "fx_date",
  "fx_source",
  "subtotal_minor",
  "discount_minor",
  "taxable_minor",
  "cgst_minor",
  "sgst_minor",
  "igst_minor",
  "round_off_minor",
  "total_minor",
  "total_inr_minor",
  "terms_version_id",
  "snapshot_sha256",
  "frozen_at",
  "issued_by",
  "realisation_due_at",
  "created_by",
  "created_at",
] as const;

/**
 * The documents columns frozen by migration 0032, exactly as that file lists them (pinned, LD35). M5.2 adds `export_declaration_id` and
 * `service_completed_on` to the table: `documentTriggerStatements()` uses this list so 0032 still regenerates byte for byte, and the
 * live list goes into the trigger that migration 0040 recreates.
 */
export const FROZEN_COLUMNS_0032 = [
  "id",
  "type",
  "client_id",
  "project_id",
  "care_plan_id",
  "parent_id",
  "version_group_id",
  "version",
  "series",
  "fy",
  "number",
  "number_display",
  "currency",
  "issue_date",
  "due_date",
  "valid_until",
  "supply_type",
  "place_of_supply_code",
  "recipient",
  "fx_rate_micros",
  "fx_date",
  "fx_source",
  "subtotal_minor",
  "discount_minor",
  "taxable_minor",
  "cgst_minor",
  "sgst_minor",
  "igst_minor",
  "round_off_minor",
  "total_minor",
  "total_inr_minor",
  "terms_version_id",
  "snapshot_sha256",
  "frozen_at",
  "issued_by",
  "title",
  "contact_id",
  "validity_days",
  "discount_kind",
  "discount_value",
  "export_mode",
  "content_sha256",
  "computed",
  "catalogue_reference_minor",
  "source_document_id",
  "source_step",
  "issuer",
  "sent_at",
  "realisation_due_at",
  "created_by",
  "created_at",
] as const;

/** The freeze trigger of `documents` for a list of frozen columns and a list of set-once columns. */
const frozenUpdateTrigger = (frozen: readonly string[], setOnceList: readonly string[]) => {
  const changed = frozen.map((c) => `NEW.\`${c}\` IS NOT OLD.\`${c}\``);
  const setOnce = setOnceList.map((c) => `(OLD.\`${c}\` IS NOT NULL AND NEW.\`${c}\` IS NOT OLD.\`${c}\`)`);
  return `CREATE TRIGGER \`documents_frozen_update\` BEFORE UPDATE ON \`documents\` WHEN OLD.frozen_at IS NOT NULL AND (\n  ${[...changed, ...setOnce].join("\n  OR ")}\n) BEGIN ${abort("issued document is frozen")} END;`;
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
  const table = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).name;
  return [
    // Issued documents: content is frozen (ADM-INV-07, ADM-PROP-05). Corrections only via credit/debit notes.
    // Pinned to what migration 0001 installed; the live list is the `document_triggers` set (M4.3).
    frozenUpdateTrigger(FROZEN_COLUMNS_0001, SET_ONCE_0001),
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

/**
 * Catalogue triggers (M4.1, ADM-CAT-03..05; a separate set, the earlier ones have no IF NOT EXISTS). A template is never edited
 * or deleted (an edit is a new version), a published snapshot is never edited or deleted (the website build and the audit read
 * it), and a catalogue item is never deleted (it is retired by deactivating it, so documents that snapshot a line keep their
 * code). `catalogue_price_history` is already append-only since 0001. No table is rebuilt.
 */
export function catalogueTriggerStatements(): string[] {
  const table = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).name;
  return [
    // SQLite treats NULLs as distinct, so the unique index on (kind, category, version) does not stop two versions of a block
    // without a category. drizzle-kit cannot write an expression index over several columns, so it is written here.
    "CREATE UNIQUE INDEX `templates_kind_category_version_coalesced` ON `templates` (`kind`, coalesce(`category`, ''), `version`);",
    ...appendOnly(table(templates)),
    ...appendOnly(table(siteSnapshots)),
    `CREATE TRIGGER \`catalogue_items_no_delete\` BEFORE DELETE ON \`catalogue_items\` BEGIN ${abort("a catalogue item is retired by deactivating it, never deleted")} END;`,
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

/**
 * Proposals and estimates (M4.3, ADM-PROP-05, ADM-PROP-06, ADM-EST-01, ADM-APR-02; a separate set, the earlier ones have no IF NOT EXISTS).
 * `documents` is referenced by other tables, so nothing is rebuilt: the freeze trigger and the issue post-condition are dropped and
 * created again, the rest is new. The API checks every rule too; these hold whatever writes to the tables. In this order:
 *   1. the backfill: a draft the M3.2 convert made has no version group yet (its group is its own id);
 *   2. `documents_frozen_update` over the live columns, with the M4.5 set-once columns;
 *   3. `issue_result_check`: a proposal or estimate ends `sent` (an invoice `issued`); version 1 holds the number the counter just
 *      handed out; a later version holds exactly its first version's number and display, series and FY (the counter does not move);
 *   4. a new version needs its predecessor frozen, same type, client and currency; version 1 is its own group;
 *   5. a version's type, client, currency, group and version never change; any other document type has version 1 only;
 *   6. a later version's number is its group's first version's number;
 *   7. the status flow of a proposal or estimate (`pending_approval` is a record in `approvals`, never a status);
 *   8. the contact of a document belongs to its client;
 *   9. a line from the catalogue carries its catalogue rate (the discount guard's reference);
 *  10. an approval's identity never changes and it only moves pending to approved, rejected or expired, or approved to expired;
 *  11. a care plan's source estimate is set once.
 * Each abort message starts with its trigger's name, so the API can map it.
 */
export function documentTriggerStatements(): string[] {
  const quotes = QUOTE_DOCUMENT_TYPES.map((t) => `'${t}'`).join(", ");
  const contactScope =
    "NEW.contact_id IS NOT NULL AND (SELECT client_id FROM contacts WHERE id = NEW.contact_id) IS NOT NEW.client_id";
  const fromStatus = (s: string) => `OLD.status = '${s}'`;
  const flow = [
    `(${fromStatus("draft")} AND NEW.status = 'sent')`,
    `(${fromStatus("sent")} AND NEW.status = 'viewed')`,
    `(OLD.status IN ('sent', 'viewed') AND NEW.status IN ('accepted', 'rejected', 'expired', 'revised'))`,
  ];
  const approvalMoves = [
    "(OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'expired'))",
    "(OLD.status = 'approved' AND NEW.status = 'expired')",
  ];
  const sameAsFirst =
    "v.series = d.series AND v.fy = d.fy AND v.number = d.number AND v.number_display = d.number_display";
  return [
    // 1. backfill (before the version triggers exist)
    `UPDATE documents SET version_group_id = id WHERE type IN (${quotes}) AND version_group_id IS NULL AND frozen_at IS NULL;`,
    // 2. the freeze trigger over the live schema
    "DROP TRIGGER `documents_frozen_update`;",
    frozenUpdateTrigger(FROZEN_COLUMNS_0032, SET_ONCE_0032),
    // 3. the issue post-condition
    "DROP TRIGGER `issue_result_check`;",
    `CREATE TRIGGER \`issue_result_check\` INSTEAD OF INSERT ON \`issue_result\` WHEN NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = NEW.document_id AND d.status = CASE WHEN d.type IN (${quotes}) THEN 'sent' ELSE 'issued' END AND d.frozen_at IS NOT NULL AND d.series = NEW.series AND d.fy = NEW.fy AND d.number >= 1 AND d.number_display IS NOT NULL AND (((d.type NOT IN (${quotes}) OR d.version = 1) AND d.number = (SELECT c.next_no - 1 FROM doc_counters c WHERE c.series = NEW.series AND c.fy = NEW.fy)) OR (d.type IN (${quotes}) AND d.version > 1 AND EXISTS (SELECT 1 FROM documents v WHERE v.version_group_id = d.version_group_id AND v.version = 1 AND v.frozen_at IS NOT NULL AND ${sameAsFirst})))) BEGIN ${abort("issue did not freeze the document with the number just taken")} END;`,
    // 4. versions
    `CREATE TRIGGER \`documents_version_insert\` BEFORE INSERT ON \`documents\` WHEN NEW.type IN (${quotes}) AND (NEW.version_group_id IS NULL OR (NEW.version = 1 AND NEW.version_group_id IS NOT NEW.id) OR (NEW.version > 1 AND NOT EXISTS (SELECT 1 FROM documents p WHERE p.version_group_id = NEW.version_group_id AND p.version = NEW.version - 1 AND p.frozen_at IS NOT NULL AND p.type = NEW.type AND p.client_id = NEW.client_id AND p.currency = NEW.currency))) BEGIN ${abort("documents_version_insert: a proposal or estimate version needs its group, and a later version needs the frozen version before it")} END;`,
    `CREATE TRIGGER \`documents_version_fixed\` BEFORE UPDATE OF type, client_id, currency, version_group_id, version ON \`documents\` WHEN OLD.type IN (${quotes}) AND (NEW.type IS NOT OLD.type OR NEW.client_id IS NOT OLD.client_id OR NEW.currency IS NOT OLD.currency OR NEW.version_group_id IS NOT OLD.version_group_id OR NEW.version IS NOT OLD.version) BEGIN ${abort("documents_version_fixed: the type, client, currency, group and version of a proposal or estimate never change")} END;`,
    `CREATE TRIGGER \`documents_version_single_insert\` BEFORE INSERT ON \`documents\` WHEN NEW.type NOT IN (${quotes}) AND NEW.version IS NOT 1 BEGIN ${abort("documents_version_single: only a proposal or estimate has versions; any other document is version 1")} END;`,
    `CREATE TRIGGER \`documents_version_single_update\` BEFORE UPDATE OF version, type ON \`documents\` WHEN NEW.type NOT IN (${quotes}) AND NEW.version IS NOT 1 BEGIN ${abort("documents_version_single: only a proposal or estimate has versions; any other document is version 1")} END;`,
    `CREATE TRIGGER \`documents_version_number\` BEFORE UPDATE OF number ON \`documents\` WHEN NEW.type IN (${quotes}) AND NEW.version > 1 AND NEW.number IS NOT NULL AND NEW.number IS NOT (SELECT v.number FROM documents v WHERE v.version_group_id = NEW.version_group_id AND v.version = 1) BEGIN ${abort("documents_version_number: a later version keeps the number of its first version")} END;`,
    // 7. status flow
    `CREATE TRIGGER \`documents_status_flow\` BEFORE UPDATE OF status ON \`documents\` WHEN NEW.status IS NOT OLD.status AND OLD.type IN (${quotes}) AND NOT (${flow.join(" OR ")}) BEGIN ${abort("documents_status_flow: that status change is not allowed")} END;`,
    // 8. contact scope
    `CREATE TRIGGER \`documents_contact_scope_insert\` BEFORE INSERT ON \`documents\` WHEN ${contactScope} BEGIN ${abort("documents_contact_scope: the contact must belong to the client")} END;`,
    `CREATE TRIGGER \`documents_contact_scope_update\` BEFORE UPDATE OF contact_id, client_id ON \`documents\` WHEN ${contactScope} BEGIN ${abort("documents_contact_scope: the contact must belong to the client")} END;`,
    // 9. catalogue reference on a proposal or estimate line
    `CREATE TRIGGER \`document_lines_catalogue_rate\` BEFORE INSERT ON \`document_lines\` WHEN NEW.catalogue_item_id IS NOT NULL AND NEW.catalogue_rate_minor IS NULL AND (SELECT type FROM documents WHERE id = NEW.document_id) IN (${quotes}) BEGIN ${abort("document_lines_catalogue_rate: a catalogue line needs its catalogue rate")} END;`,
    // 10. approvals
    `CREATE TRIGGER \`approvals_flow\` BEFORE UPDATE ON \`approvals\` WHEN NEW.kind IS NOT OLD.kind OR NEW.document_id IS NOT OLD.document_id OR NEW.requested_by IS NOT OLD.requested_by OR NEW.content_sha256 IS NOT OLD.content_sha256 OR (NEW.status IS NOT OLD.status AND NOT (${approvalMoves.join(" OR ")})) BEGIN ${abort("approvals_flow: an approval keeps what it was asked for and only moves forward")} END;`,
    // 11. care plan source
    `CREATE TRIGGER \`care_plans_source_fixed\` BEFORE UPDATE OF source_document_id ON \`care_plans\` WHEN OLD.source_document_id IS NOT NULL AND NEW.source_document_id IS NOT OLD.source_document_id BEGIN ${abort("care_plans_source_fixed: the source estimate of a care plan is set once")} END;`,
  ];
}

/**
 * Offer-link and send triggers (M4.5; new triggers only, no table is rebuilt):
 *  1. an offer link has a known purpose (a trigger, not a CHECK: a new purpose is a trigger swap, not a rebuild);
 *  2. an offer link never changes except its `revoked_at`, once, from NULL;
 *  3. an acceptance certificate is append-only;
 *  4. a send row changes only by `queued_at` (set once) and by clearing `contact_id` and `email` (erase and anonymise).
 * Each abort message starts with its trigger's name, so the API can map it.
 */
export function offerTriggerStatements(): string[] {
  const table = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).name;
  const purposes = OFFER_LINK_PURPOSES.map((p) => `'${p}'`).join(", ");
  const changed = (cols: string[]) => cols.map((c) => `NEW.\`${c}\` IS NOT OLD.\`${c}\``).join(" OR ");
  const linkFixed = changed([
    "token_hash",
    "send_id",
    "acceptance_id",
    "document_id",
    "version_group_id",
    "client_id",
    "contact_id",
    "email",
    "purpose",
    "expires_at",
    "created_at",
  ]);
  const sendFixed = changed([
    "id",
    "document_id",
    "version_group_id",
    "client_id",
    "attach_pdf",
    "kind",
    "created_by",
    "created_at",
  ]);
  const purposeMsg = abort("offer_links_purpose: an offer link is for an offer or a confirmation");
  return [
    `CREATE TRIGGER \`offer_links_purpose_insert\` BEFORE INSERT ON \`offer_links\` WHEN NEW.purpose NOT IN (${purposes}) BEGIN ${purposeMsg} END;`,
    `CREATE TRIGGER \`offer_links_purpose_update\` BEFORE UPDATE OF purpose ON \`offer_links\` WHEN NEW.purpose NOT IN (${purposes}) BEGIN ${purposeMsg} END;`,
    `CREATE TRIGGER \`offer_links_fixed\` BEFORE UPDATE ON \`offer_links\` WHEN ${linkFixed} OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at) BEGIN ${abort("offer_links_fixed: an offer link only gets revoked, once")} END;`,
    ...appendOnly(table(acceptanceCertificates)),
    `CREATE TRIGGER \`document_sends_fixed\` BEFORE UPDATE ON \`document_sends\` WHEN ${sendFixed} OR (OLD.queued_at IS NOT NULL AND NEW.queued_at IS NOT OLD.queued_at) OR (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NOT OLD.cancelled_at) OR (NEW.contact_id IS NOT OLD.contact_id AND NEW.contact_id IS NOT NULL) OR (NEW.email IS NOT OLD.email AND NEW.email IS NOT NULL) BEGIN ${abort("document_sends_fixed: a send changes only when it is queued or cancelled, or when its contact is erased")} END;`,
  ];
}

/**
 * The invoice flow types and the status moves exactly as migration 0038 lists them (pinned, as `FROZEN_COLUMNS_0001` is). `invoiceTriggerStatements()`
 * uses these, so the `invoice_triggers` set keeps generating 0038 byte for byte when core's `INVOICE_STATUS_FLOW` grows in M5.2 or M5.3; the move
 * that follows goes into a NEW migration with its own pinned table. A db test compares the installed trigger with core's `canMoveInvoiceStatus`
 * move by move, so a change in core that no migration follows fails there.
 */
export const INVOICE_FLOW_TYPES_0038 = [
  "proforma",
  "tax_invoice",
  "export_invoice",
  "credit_note",
  "debit_note",
] as const;
export const INVOICE_STATUS_FLOW_0038: readonly {
  readonly from: string;
  readonly to: string;
  readonly types?: readonly string[];
  readonly unsettled?: true;
}[] = [
  { from: "draft", to: "issued" },
  { from: "issued", to: "void", unsettled: true },
  { from: "issued", to: "partially_paid" },
  { from: "issued", to: "paid" },
  { from: "issued", to: "partially_credited" },
  { from: "issued", to: "credited" },
  { from: "partially_paid", to: "issued" },
  { from: "partially_paid", to: "paid" },
  { from: "partially_paid", to: "partially_credited" },
  { from: "partially_paid", to: "credited" },
  { from: "paid", to: "issued" },
  { from: "paid", to: "partially_paid" },
  { from: "paid", to: "partially_credited" },
  { from: "paid", to: "credited" },
  { from: "partially_credited", to: "issued" },
  { from: "partially_credited", to: "partially_paid" },
  { from: "partially_credited", to: "paid" },
  { from: "partially_credited", to: "credited" },
  { from: "credited", to: "issued" },
  { from: "credited", to: "partially_paid" },
  { from: "credited", to: "paid" },
  { from: "credited", to: "partially_credited" },
  { from: "issued", to: "converted", types: ["proforma"] },
  { from: "partially_paid", to: "converted", types: ["proforma"] },
  { from: "paid", to: "converted", types: ["proforma"] },
];

/**
 * The invoice triggers (M5.1, ADM-INV-02, -03, -07, LD21; new triggers only, no table is rebuilt; every abort message starts with the trigger's
 * name so the API can map it). VERIFY WITH CA/LEGAL for the rules; the API checks the same rules in SQL conditions first, these hold
 * whatever writes to the tables:
 *   1. `documents_invoice_status_flow`: the moves of `INVOICE_STATUS_FLOW_0038` (the pinned copy of core's table; a db test compares
 *      every move with `canMoveInvoiceStatus`); `void` and `converted` are terminal; a void needs nothing paid or credited and no issued child;
 *   2. `documents_void_pairing`: a document that becomes void carries `voided_at` and `void_reason` and is frozen; no other status has `voided_at` (a void row is then fixed by the freeze trigger and the flow);
 *   3. an invoice-family document has its client's currency (M3.3 follow-up);
 *   4. `export_invoice` is for an overseas client, `tax_invoice` for a client in India (SEZ is not modelled);
 *   5. `parent_id` (a foreign key would need a rebuild of a referenced table) is null or names a FROZEN, not void, document of the SAME client in an
 *      allowed pair: credit or debit note -> tax or export invoice; tax or export invoice -> proforma; receipt -> any invoice-flow type (M6);
 *   6. a milestone's `document_id` names an invoice-family document of the milestone's own client.
 */
export function invoiceTriggerStatements(): string[] {
  const q = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");
  // 1. The moves, grouped by (from, types, unsettled) so each group is one clause.
  type FlowGroup = { from: string; tos: string[]; types: readonly string[] | undefined; unsettled: boolean };
  const groups = new Map<string, FlowGroup>();
  for (const m of INVOICE_STATUS_FLOW_0038) {
    const key = `${m.from}|${m.types?.join(",") ?? ""}|${m.unsettled === true}`;
    const g: FlowGroup = groups.get(key) ?? {
      from: m.from,
      tos: [],
      types: m.types,
      unsettled: m.unsettled === true,
    };
    g.tos.push(m.to);
    groups.set(key, g);
  }
  const unsettledSql =
    "NEW.paid_minor = 0 AND OLD.paid_minor = 0 AND NEW.credited_minor = 0 AND OLD.credited_minor = 0 AND NOT EXISTS (SELECT 1 FROM documents c WHERE c.parent_id = OLD.id AND c.frozen_at IS NOT NULL)";
  const clauses = [...groups.values()].map(
    (g) =>
      `(OLD.status = '${g.from}' AND NEW.status IN (${q(g.tos)})${g.types ? ` AND OLD.type IN (${q(g.types)})` : ""}${g.unsettled ? ` AND ${unsettledSql}` : ""})`,
  );
  const clientStatus = "(SELECT gst_status FROM clients WHERE id = NEW.client_id)";
  // The update triggers leave an issued document to `documents_frozen_update`, which refuses every one of these columns (one message, one owner).
  const badCurrency = `NEW.type IN (${INVOICE_FAMILY_SQL}) AND NEW.currency IS NOT (SELECT currency FROM clients WHERE id = NEW.client_id)`;
  const open = "OLD.frozen_at IS NULL AND ";
  const badType = `(NEW.type = 'export_invoice' AND ${clientStatus} IS NOT 'overseas') OR (NEW.type = 'tax_invoice' AND ${clientStatus} IS 'overseas')`;
  const flow = q(INVOICE_FLOW_TYPES_0038);
  const badParent = `NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documents p WHERE p.id = NEW.parent_id AND p.frozen_at IS NOT NULL AND p.status <> 'void' AND p.client_id = NEW.client_id AND ((NEW.type IN ('credit_note', 'debit_note') AND p.type IN ('tax_invoice', 'export_invoice')) OR (NEW.type IN ('tax_invoice', 'export_invoice') AND p.type = 'proforma') OR (NEW.type = 'receipt' AND p.type IN (${flow}))))`;
  const badMilestone = `NEW.document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = NEW.document_id AND d.type IN (${INVOICE_FAMILY_SQL}) AND d.client_id = (SELECT client_id FROM projects WHERE id = NEW.project_id))`;
  const named = (name: string, message: string) => abort(`${name}: ${message}`);
  const currencyMsg = named("documents_invoice_currency", "an invoice has the currency of its client");
  const typeMsg = named(
    "documents_invoice_type_client",
    "an export invoice is for an overseas client and a tax invoice for a client in India",
  );
  const parentMsg = named(
    "documents_parent_check",
    "the parent must be an issued, not void, document of the same client in an allowed pair",
  );
  const milestoneMsg = named(
    "milestones_document_scope",
    "the document of a milestone must be an invoice of the same client",
  );
  return [
    `CREATE TRIGGER \`documents_invoice_status_flow\` BEFORE UPDATE OF status ON \`documents\` WHEN NEW.status IS NOT OLD.status AND OLD.type IN (${flow}) AND NOT (${clauses.join(" OR ")}) BEGIN ${named("documents_invoice_status_flow", "that status change is not allowed")} END;`,
    `CREATE TRIGGER \`documents_void_pairing\` BEFORE UPDATE OF status, voided_at, void_reason ON \`documents\` WHEN NEW.type IN (${flow}) AND OLD.status <> 'void' AND ((NEW.status = 'void' AND (NEW.voided_at IS NULL OR NEW.void_reason IS NULL OR NEW.frozen_at IS NULL)) OR (NEW.status <> 'void' AND NEW.voided_at IS NOT NULL)) BEGIN ${named("documents_void_pairing", "a void document has its time and reason, and only an issued document can be void")} END;`,
    `CREATE TRIGGER \`documents_invoice_currency_insert\` BEFORE INSERT ON \`documents\` WHEN ${badCurrency} BEGIN ${currencyMsg} END;`,
    `CREATE TRIGGER \`documents_invoice_currency_update\` BEFORE UPDATE OF type, currency, client_id ON \`documents\` WHEN ${open}${badCurrency} BEGIN ${currencyMsg} END;`,
    `CREATE TRIGGER \`documents_invoice_type_client_insert\` BEFORE INSERT ON \`documents\` WHEN ${badType} BEGIN ${typeMsg} END;`,
    `CREATE TRIGGER \`documents_invoice_type_client_update\` BEFORE UPDATE OF type, client_id ON \`documents\` WHEN ${open}(${badType}) BEGIN ${typeMsg} END;`,
    `CREATE TRIGGER \`documents_parent_check_insert\` BEFORE INSERT ON \`documents\` WHEN ${badParent} BEGIN ${parentMsg} END;`,
    `CREATE TRIGGER \`documents_parent_check_update\` BEFORE UPDATE OF parent_id, type, client_id ON \`documents\` WHEN ${open}${badParent} BEGIN ${parentMsg} END;`,
    `CREATE TRIGGER \`milestones_document_scope\` BEFORE UPDATE OF document_id ON \`milestones\` WHEN ${badMilestone} BEGIN ${milestoneMsg} END;`,
    `CREATE TRIGGER \`milestones_document_scope_insert\` BEFORE INSERT ON \`milestones\` WHEN ${badMilestone} BEGIN ${milestoneMsg} END;`,
  ];
}

/**
 * The documents columns frozen and set-once as migration 0040 installs them (M5.2; pinned like 0032's, so that M5.3's `ims_status` column and its
 * own migration cannot move the bytes of 0040). Today equal to the live lists; the coverage test in `triggers.test.ts` checks the INSTALLED trigger
 * against the live schema, so a later column that no migration covers still fails there.
 */
export const FROZEN_COLUMNS_0040 = [
  ...FROZEN_COLUMNS_0032.slice(0, FROZEN_COLUMNS_0032.indexOf("realisation_due_at") + 1),
  "export_declaration_id",
  "header_extras",
  ...FROZEN_COLUMNS_0032.slice(FROZEN_COLUMNS_0032.indexOf("realisation_due_at") + 1),
] as const;
export const SET_ONCE_0040 = [...SET_ONCE_0032, "service_completed_on"] as const;

/**
 * Invoice types (M5.2, ADM-INV-01, -06, -10, LD22, LD23, LD29, LD35; new triggers only, no table is rebuilt; every abort message starts with the
 * trigger's name so the API can map it). VERIFY WITH CA/LEGAL for the rules; the API checks the same rules in SQL conditions first:
 *   1. `documents_frozen_update` dropped and created again over the columns of 0040 (`export_declaration_id` and `header_extras` are frozen; `service_completed_on`
 *      is set once);
 *   2. `documents_service_completed_date_insert` / `_update`: a service date is a real ISO date, and only a tax or export invoice has one;
 *   3. `advance_receipts_no_update` / `_no_delete`: append-only;
 *   4. `advance_receipts_scope_insert`: the proforma is a frozen proforma of the client; the invoice is a frozen tax or export invoice of the same
 *      client and currency whose parent is that proforma; `received_on` is a real date.
 */
export function invoiceTypeTriggerStatements(): string[] {
  const named = (name: string, message: string) => abort(`${name}: ${message}`);
  const dateBad =
    "NEW.service_completed_on IS NOT NULL AND (date(NEW.service_completed_on) IS NOT NEW.service_completed_on OR NEW.type NOT IN ('tax_invoice', 'export_invoice'))";
  const dateMsg = "a service date is a real date, and only a tax or export invoice has one";
  const scopeBad =
    "NOT EXISTS (SELECT 1 FROM documents p WHERE p.id = NEW.proforma_id AND p.type = 'proforma' AND p.frozen_at IS NOT NULL AND p.client_id = NEW.client_id AND p.currency = NEW.currency) OR NOT EXISTS (SELECT 1 FROM documents i WHERE i.id = NEW.invoice_id AND i.type IN ('tax_invoice', 'export_invoice') AND i.frozen_at IS NOT NULL AND i.parent_id = NEW.proforma_id AND i.client_id = NEW.client_id AND i.currency = NEW.currency AND i.total_minor = NEW.amount_minor) OR date(NEW.received_on) IS NOT NEW.received_on";
  return [
    "DROP TRIGGER `documents_frozen_update`;",
    frozenUpdateTrigger(FROZEN_COLUMNS_0040, SET_ONCE_0040),
    `CREATE TRIGGER \`documents_service_completed_date_insert\` BEFORE INSERT ON \`documents\` WHEN ${dateBad} BEGIN ${named("documents_service_completed_date_insert", dateMsg)} END;`,
    `CREATE TRIGGER \`documents_service_completed_date_update\` BEFORE UPDATE OF service_completed_on ON \`documents\` WHEN ${dateBad} BEGIN ${named("documents_service_completed_date_update", dateMsg)} END;`,
    `CREATE TRIGGER \`advance_receipts_no_update\` BEFORE UPDATE ON \`advance_receipts\` BEGIN ${named("advance_receipts_no_update", "advance_receipts is append-only")} END;`,
    `CREATE TRIGGER \`advance_receipts_no_delete\` BEFORE DELETE ON \`advance_receipts\` BEGIN ${named("advance_receipts_no_delete", "advance_receipts is append-only")} END;`,
    `CREATE TRIGGER \`advance_receipts_scope_insert\` BEFORE INSERT ON \`advance_receipts\` WHEN ${scopeBad} BEGIN ${named("advance_receipts_scope_insert", "an advance receipt links a frozen proforma to the tax or export invoice made from it (same client and currency, the invoice total is the amount) on a real date")} END;`,
  ];
}

/**
 * Credit and debit notes (M5.3, ADM-INV-11, LD38..LD51; new triggers only, no table is rebuilt, `ims_status` has no CHECK; every abort message starts with
 * the trigger's name so the API can map it). VERIFY WITH CA/LEGAL for the rules; the API and the freeze statement check the same rules in SQL conditions
 * first, these hold whatever writes to the tables:
 *   1. `documents_note_parent_required_insert` / `_update`: a credit or debit note has a parent;
 *   2. `documents_note_issue_check`: at the freeze, the parent is a frozen tax or export invoice of the same client and currency that is still live
 *      (issued, part paid, paid or part credited: not void, not fully credited) and the note has the parent's supply, place of supply, rate and route (a
 *      parent that was voided after the draft was made refuses it: `documents_parent_check_*` only looks when the parent link changes);
 *   3. `documents_credit_note_cap`: at the freeze, a credit note's total, taxable value, each tax head and (a USD invoice) INR total are each at most the
 *      parent's minus the other issued, not void credit notes of that parent;
 *   4. `documents_ledger_bounds`: `credited_minor` is between 0 and the total, and `balance_minor` is never negative;
 *   5. `documents_note_no_void`: a credit or debit note is never voided (Q31: a wrong note is corrected by another note);
 *   6. `documents_ims_status_insert` / `_update`: `ims_status` starts empty; only a credit note gets one, set once at the freeze (`pending`, or
 *      `not_applicable`), and a `pending` one moves once to `accepted` or `rejected` (core `canSetImsStatus` is the twin);
 *   7. `documents_credit_note_ims_required`: a credit note cannot freeze with an empty IMS status (the freeze sets it; the update trigger above only
 *      looks when `ims_status` changes, so an empty one would pass unseen).
 */
export function noteTriggerStatements(): string[] {
  const named = (name: string, message: string) => abort(`${name}: ${message}`);
  const notes = "('credit_note', 'debit_note')";
  const issuing = `OLD.status = 'draft' AND NEW.status = 'issued' AND NEW.type IN ${notes}`;
  const needsParent = `NEW.type IN ${notes} AND NEW.parent_id IS NULL`;
  const badParent =
    "NOT EXISTS (SELECT 1 FROM documents p WHERE p.id = NEW.parent_id AND p.type IN ('tax_invoice', 'export_invoice') AND p.frozen_at IS NOT NULL AND p.status IN ('issued', 'partially_paid', 'paid', 'partially_credited') AND p.client_id = NEW.client_id AND p.currency = NEW.currency AND p.supply_type IS NEW.supply_type AND p.place_of_supply_code IS NEW.place_of_supply_code AND p.fx_rate_micros IS NEW.fx_rate_micros AND p.export_mode IS NEW.export_mode)";
  const heads = [
    "total_minor",
    "taxable_minor",
    "cgst_minor",
    "sgst_minor",
    "igst_minor",
    "total_inr_minor",
  ] as const;
  const sums = heads.map((h) => `coalesce(sum(c.${h}), 0) AS ${h}`).join(", ");
  const over = heads.map((h) => `NEW.${h} > p.${h} - s.${h}`).join(" OR ");
  const overCap = `EXISTS (SELECT 1 FROM documents p, (SELECT ${sums} FROM documents c WHERE c.parent_id = NEW.parent_id AND c.type = 'credit_note' AND c.frozen_at IS NOT NULL AND c.status <> 'void' AND c.id <> NEW.id) s WHERE p.id = NEW.parent_id AND (${over}))`;
  const ledgerBad = "NEW.credited_minor < 0 OR NEW.credited_minor > NEW.total_minor OR NEW.balance_minor < 0";
  // Three-valued logic: `OLD.ims_status = 'pending'` is NULL when it was empty, and a NULL WHEN does not fire; so `IS` for every comparison with a nullable column and `coalesce` around the whole move.
  const imsMove =
    "(OLD.ims_status IS NULL AND NEW.ims_status IN ('pending', 'not_applicable') AND OLD.type = 'credit_note' AND OLD.frozen_at IS NULL AND NEW.frozen_at IS NOT NULL) OR (OLD.ims_status IS 'pending' AND NEW.ims_status IN ('accepted', 'rejected') AND OLD.type = 'credit_note' AND OLD.frozen_at IS NOT NULL)";
  const imsBad = `NEW.ims_status IS NOT OLD.ims_status AND NOT coalesce(${imsMove}, 0)`;
  const imsRequiredMsg = "a credit note is issued with its IMS status set (pending or not applicable)";
  const parentMsg = "a credit or debit note names its invoice";
  const imsMsg =
    "the IMS status is set once at the issue of a credit note, and a pending one is answered once";
  return [
    `CREATE TRIGGER \`documents_note_parent_required_insert\` BEFORE INSERT ON \`documents\` WHEN ${needsParent} BEGIN ${named("documents_note_parent_required_insert", parentMsg)} END;`,
    `CREATE TRIGGER \`documents_note_parent_required_update\` BEFORE UPDATE OF parent_id, type ON \`documents\` WHEN ${needsParent} BEGIN ${named("documents_note_parent_required_update", parentMsg)} END;`,
    `CREATE TRIGGER \`documents_note_issue_check\` BEFORE UPDATE OF status ON \`documents\` WHEN ${issuing} AND ${badParent} BEGIN ${named("documents_note_issue_check", "the invoice of a note must be an issued, live invoice of the same client and currency, with the same supply, rate and route")} END;`,
    `CREATE TRIGGER \`documents_credit_note_cap\` BEFORE UPDATE OF status ON \`documents\` WHEN ${issuing} AND NEW.type = 'credit_note' AND ${overCap} BEGIN ${named("documents_credit_note_cap", "the credit notes of an invoice cannot add up to more than the invoice, in total or in any tax head")} END;`,
    `CREATE TRIGGER \`documents_ledger_bounds\` BEFORE UPDATE OF credited_minor, balance_minor ON \`documents\` WHEN ${ledgerBad} BEGIN ${named("documents_ledger_bounds", "credited is between zero and the total, and the balance is never negative")} END;`,
    `CREATE TRIGGER \`documents_note_no_void\` BEFORE UPDATE OF status ON \`documents\` WHEN NEW.status = 'void' AND OLD.type IN ${notes} BEGIN ${named("documents_note_no_void", "a credit or debit note is never voided")} END;`,
    `CREATE TRIGGER \`documents_ims_status_insert\` BEFORE INSERT ON \`documents\` WHEN NEW.ims_status IS NOT NULL BEGIN ${named("documents_ims_status_insert", imsMsg)} END;`,
    `CREATE TRIGGER \`documents_ims_status_update\` BEFORE UPDATE OF ims_status ON \`documents\` WHEN ${imsBad} BEGIN ${named("documents_ims_status_update", imsMsg)} END;`,
    `CREATE TRIGGER \`documents_credit_note_ims_required\` BEFORE UPDATE OF status ON \`documents\` WHEN ${issuing} AND NEW.type = 'credit_note' AND NEW.ims_status IS NULL BEGIN ${named("documents_credit_note_ims_required", imsRequiredMsg)} END;`,
  ];
}

/**
 * Recurring care invoices, invoice links and reminders (M5.4, ADM-CARE-02, ADM-INV-13, POR-06, LD55, LD58..LD60; new triggers only: no table is rebuilt,
 * `0043_billing.sql` only added columns, a table and indexes; every abort message starts with the trigger's name so the API can map it). VERIFY WITH CA/LEGAL
 * for the rules; the statements that write these tables hold the same rules in their WHERE, these hold whatever writes to them:
 *   0. a one-off backfill, before any trigger exists: a toggle that was on before M5.4 has no Owner behind it (LD58: "existing toggles count as off"), so it is
 *      switched off, and the rule of 6 then holds for every row;
 *   1. `care_plans_billed_forward`: the billed period only moves forward, and is a date;
 *   2. `care_plan_terms_after_billed`: new terms cannot take effect on or before a period already billed;
 *   3. `care_invoices_no_update` / `care_invoices_no_delete`: the billed-period record is append-only, except that a discarded draft's `document_id` is set to NULL once;
 *   4. `doc_access_tokens_bound_insert`: an invoice link is bound to a contact, a client and an address (lower case), names a frozen document of that client,
 *      the contact belongs to that client, and a send it names is a send of that document to that contact;
 *   5. `doc_access_tokens_fixed`: only `revoked_at` may change, once;
 *   6. `clients_care_auto_issue_by_insert` / `_update`: the toggle on means an active Owner is named as who turned it on; off means nobody is named;
 *   7. `reminders_fixed`: a reminder's document, offset and due time never change; it is sent once (the only move back is a give-back of the same claim while
 *      no email is recorded); its skip reason moves only between empty and `paused`, or from empty to a final value once.
 */
export function billingTriggerStatements(): string[] {
  const named = (name: string, message: string) => abort(`${name}: ${message}`);
  const changed = (cols: string[]) => cols.map((c) => `NEW.\`${c}\` IS NOT OLD.\`${c}\``).join(" OR ");
  const billedBad =
    "NEW.last_billed_period IS NOT OLD.last_billed_period AND (NEW.last_billed_period IS NULL OR date(NEW.last_billed_period) IS NOT NEW.last_billed_period OR (OLD.last_billed_period IS NOT NULL AND NEW.last_billed_period <= OLD.last_billed_period))";
  const termsBad =
    "NEW.effective_from <= (SELECT last_billed_period FROM care_plans WHERE id = NEW.care_plan_id)";
  const invoiceFixed = `${changed(["care_plan_id", "period_start", "period_end", "terms_id", "overage_period_start", "overage_minutes", "created_at"])} OR (NEW.document_id IS NOT OLD.document_id AND NOT (OLD.document_id IS NOT NULL AND NEW.document_id IS NULL))`;
  const tokenBad =
    "NEW.contact_id IS NULL OR NEW.client_id IS NULL OR NEW.email IS NULL OR NEW.email <> lower(NEW.email) OR NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = NEW.document_id AND d.client_id = NEW.client_id AND d.frozen_at IS NOT NULL) OR NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = NEW.contact_id AND c.client_id = NEW.client_id) OR (NEW.send_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_sends s WHERE s.id = NEW.send_id AND s.document_id = NEW.document_id AND s.contact_id = NEW.contact_id))";
  const tokenFixed = `${changed(["token_hash", "document_id", "purpose", "expires_at", "created_at", "contact_id", "client_id", "email", "send_id"])} OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)`;
  const autoBad =
    "(NEW.care_auto_issue = 1 AND NOT EXISTS (SELECT 1 FROM staff_users o WHERE o.id = NEW.care_auto_issue_by AND o.role = 'owner' AND o.status = 'active')) OR (NEW.care_auto_issue IS NOT 1 AND NEW.care_auto_issue_by IS NOT NULL)";
  const autoMsg = "the auto-issue toggle on names an active Owner, and off names nobody";
  const reminderBad = `${changed(["document_id", "offset_days", "due_at"])} OR (OLD.sent_at IS NOT NULL AND NEW.sent_at IS NOT OLD.sent_at AND NOT (NEW.sent_at IS NULL AND OLD.email_log_id IS NULL)) OR (OLD.email_log_id IS NOT NULL AND NEW.email_log_id IS NOT OLD.email_log_id) OR (NEW.skipped_reason IS NOT OLD.skipped_reason AND NOT ((OLD.skipped_reason IS NULL AND NEW.skipped_reason IS NOT NULL) OR (OLD.skipped_reason IS 'paused' AND NEW.skipped_reason IS NULL)))`;
  return [
    // 0. the backfill (before the clients triggers exist)
    "UPDATE clients SET care_auto_issue = 0 WHERE care_auto_issue = 1 AND care_auto_issue_by IS NULL;",
    `CREATE TRIGGER \`care_plans_billed_forward\` BEFORE UPDATE OF last_billed_period ON \`care_plans\` WHEN ${billedBad} BEGIN ${named("care_plans_billed_forward", "the billed period only moves forward, and is a date")} END;`,
    `CREATE TRIGGER \`care_plan_terms_after_billed\` BEFORE INSERT ON \`care_plan_terms\` WHEN ${termsBad} BEGIN ${named("care_plan_terms_after_billed", "new terms cannot start on or before a period that was already billed")} END;`,
    `CREATE TRIGGER \`care_invoices_no_update\` BEFORE UPDATE ON \`care_invoices\` WHEN ${invoiceFixed} BEGIN ${named("care_invoices_no_update", "a billed period is never changed; the document of a discarded draft is cleared once")} END;`,
    `CREATE TRIGGER \`care_invoices_no_delete\` BEFORE DELETE ON \`care_invoices\` BEGIN ${named("care_invoices_no_delete", "a billed period is never deleted")} END;`,
    `CREATE TRIGGER \`doc_access_tokens_bound_insert\` BEFORE INSERT ON \`doc_access_tokens\` WHEN ${tokenBad} BEGIN ${named("doc_access_tokens_bound_insert", "an invoice link belongs to one contact of the client of a frozen document, with the address in lower case")} END;`,
    `CREATE TRIGGER \`doc_access_tokens_fixed\` BEFORE UPDATE ON \`doc_access_tokens\` WHEN ${tokenFixed} BEGIN ${named("doc_access_tokens_fixed", "an invoice link only gets revoked, once")} END;`,
    `CREATE TRIGGER \`clients_care_auto_issue_by_insert\` BEFORE INSERT ON \`clients\` WHEN ${autoBad} BEGIN ${named("clients_care_auto_issue_by_insert", autoMsg)} END;`,
    `CREATE TRIGGER \`clients_care_auto_issue_by_update\` BEFORE UPDATE OF care_auto_issue, care_auto_issue_by ON \`clients\` WHEN ${autoBad} BEGIN ${named("clients_care_auto_issue_by_update", autoMsg)} END;`,
    `CREATE TRIGGER \`reminders_fixed\` BEFORE UPDATE ON \`reminders\` WHEN ${reminderBad} BEGIN ${named("reminders_fixed", "a reminder keeps its document, offset and due time, is sent once, and is paused or skipped only by the allowed moves")} END;`,
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
  catalogue_triggers: {
    what: "catalogue append-only triggers and no delete of items (M4.1)",
    statements: catalogueTriggerStatements,
  },
  time_triggers: {
    what: "time-log, care-plan history and mirror integrity (M3.5)",
    statements: timeTriggerStatements,
  },
  issue_guard: {
    what: "issue guard narrowed to drafts, plus the issue post-condition (docs/05 §5.4)",
    statements: issueGuardStatements,
  },
  document_triggers: {
    what: "proposal and estimate versions, status flow, approvals, the freeze trigger recreated and the issue post-condition for versions (M4.3)",
    statements: documentTriggerStatements,
  },
  offer_triggers: {
    what: "offer links, send rows and acceptance certificates (M4.5)",
    statements: offerTriggerStatements,
  },
  invoice_triggers: {
    what: "invoice status flow, void pairing, currency, type and parent checks, milestone scope (M5.1)",
    statements: invoiceTriggerStatements,
  },
  invoice_type_triggers: {
    what: "freeze trigger recreated for M5.2's columns, service date check, advance receipts append-only and scope (M5.2)",
    statements: invoiceTypeTriggerStatements,
  },
  note_triggers: {
    what: "credit and debit notes: parent required, issue check, credit cap, ledger bounds, no void, IMS status and its presence at the freeze (M5.3)",
    statements: noteTriggerStatements,
  },
  billing_triggers: {
    what: "care billing forward-only, terms after a billed period, billed-period record, bound invoice links, the auto-issue owner and reminder moves (M5.4)",
    statements: billingTriggerStatements,
  },
} as const;
export type TriggerSet = keyof typeof TRIGGER_SETS;

export const triggerMigrationSql = (set: TriggerSet = "triggers") =>
  `-- Hand-written: ${TRIGGER_SETS[set].what}, generated by scripts/write-triggers.ts from src/triggers.ts.\n${TRIGGER_SETS[set].statements().join("\n--> statement-breakpoint\n")}\n`;
