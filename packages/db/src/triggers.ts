// Integrity triggers (docs/05 §5.3), generated from the schema so no column is forgotten. The SQL is written
// once into a hand-written migration (scripts/write-triggers.ts); a later schema change that adds a document
// column needs a new migration that drops and recreates the trigger, and test/triggers.test.ts fails until
// the installed trigger covers every content column.
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
  issue_guard: {
    what: "issue guard narrowed to drafts, plus the issue post-condition (docs/05 §5.4)",
    statements: issueGuardStatements,
  },
} as const;
export type TriggerSet = keyof typeof TRIGGER_SETS;

export const triggerMigrationSql = (set: TriggerSet = "triggers") =>
  `-- Hand-written: ${TRIGGER_SETS[set].what}, generated by scripts/write-triggers.ts from src/triggers.ts.\n${TRIGGER_SETS[set].statements().join("\n--> statement-breakpoint\n")}\n`;
