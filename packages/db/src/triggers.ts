// Integrity triggers (docs/05 §5.3), generated from the schema so no column is forgotten. The SQL is written
// once into a hand-written migration (scripts/write-triggers.ts); a later schema change that adds a document
// column needs a new migration that drops and recreates the trigger, and test/triggers.test.ts fails until
// the installed trigger covers every content column.
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { documentLines, documentSections, paymentSchedules } from "./schema/documents.ts";
import { acceptances, auditLog, cataloguePriceHistory, docCounters, documents } from "./schema/index.ts";

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
    // Issue guard: the first statement of every issue batch is `INSERT INTO issue_guard (document_id) VALUES (?)`.
    // It aborts the whole batch unless the document is an unfrozen draft, so no number is consumed for a
    // document that can't be issued (an UPDATE matching zero rows would not fail on its own).
    "CREATE VIEW `issue_guard` AS SELECT NULL AS document_id;",
    `CREATE TRIGGER \`issue_guard_check\` INSTEAD OF INSERT ON \`issue_guard\` WHEN NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND status IN ('draft', 'pending_approval') AND frozen_at IS NULL) BEGIN ${abort("document is not an issuable draft")} END;`,
  ];
}

export const triggerMigrationSql = () =>
  `-- Hand-written: integrity triggers (docs/05 §5.3), generated by scripts/write-triggers.ts from src/triggers.ts.\n${triggerStatements().join("\n--> statement-breakpoint\n")}\n`;
