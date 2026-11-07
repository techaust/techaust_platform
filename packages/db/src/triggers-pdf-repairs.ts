// Rebuild PDF (JOB-PDF-02; run file docs/runs/rebuild-pdf.md, L1, L7, L12; owner Q1 = B, 2026-11-07): the trigger set `pdf_repair_triggers` (migration 0088,
// after 0087's CREATE TABLE):
//   1. `pdf_repairs` and `pdf_repair_results` are append-only;
//   2. a request names a subject that may be rebuilt now (its kind's state, its PDF recorded, a client not anonymised, an offer neither redacted nor still open
//      for acceptance), records that subject's own key as `original_key`, takes the next `n`, the key `<stem>-r<n>.pdf` and, as `old_key`, the key served;
//   3. a result belongs to its request (the same original key and `n`, the request's new key when rebuilt) and is never earlier than it;
//   4. a redacted offer's rebuilt PDFs go to the R2 outbox with its other objects (`documents_redact_outbox`, 0079).
// New triggers only: no earlier trigger is dropped or recreated. The subject rule is `rebuildableKeyByKindSql` (`pdf-repairs.ts`), the one the request's own
// guard reads; the drift test fails when it changes after this set was applied.
import { IST_DAY_SQL, REPAIR_KEY_SQL, rebuildableKeyByKindSql, servedKeySql } from "./pdf-repairs.ts";

const abort = (message: string) => `SELECT RAISE(ABORT, '${message}');`;
const named = (name: string, message: string) => {
  if (message.includes("'")) throw new Error(`${name}: an abort message has no apostrophe`);
  return abort(`${name}: ${message}`);
};
const appendOnly = (table: string) => [
  `CREATE TRIGGER \`${table}_no_update\` BEFORE UPDATE ON \`${table}\` BEGIN ${abort(`${table} is append-only`)} END;`,
  `CREATE TRIGGER \`${table}_no_delete\` BEFORE DELETE ON \`${table}\` BEGIN ${abort(`${table} is append-only`)} END;`,
];

export function pdfRepairTriggerStatements(): string[] {
  const subjectKey = rebuildableKeyByKindSql(
    "NEW.subject_kind",
    "NEW.subject_id",
    IST_DAY_SQL("NEW.requested_at"),
  );
  const nextN =
    "1 + coalesce((SELECT max(q.n) FROM pdf_repairs q WHERE q.subject_kind = NEW.subject_kind AND q.subject_id = NEW.subject_id), 0)";
  const request = (r: string) => `(SELECT ${r} FROM pdf_repairs p WHERE p.id = NEW.repair_id)`;
  return [
    ...appendOnly("pdf_repairs"),
    ...appendOnly("pdf_repair_results"),
    `CREATE TRIGGER \`pdf_repairs_insert\` BEFORE INSERT ON \`pdf_repairs\` WHEN NEW.original_key IS NOT (${subjectKey}) BEGIN ${named("pdf_repairs_insert", "a rebuild names a subject that may be rebuilt now and its own recorded key")} END;`,
    `CREATE TRIGGER \`pdf_repairs_insert_n\` BEFORE INSERT ON \`pdf_repairs\` WHEN NEW.n IS NOT (${nextN}) BEGIN ${named("pdf_repairs_insert_n", "a rebuild takes the next number of its subject")} END;`,
    `CREATE TRIGGER \`pdf_repairs_insert_keys\` BEFORE INSERT ON \`pdf_repairs\` WHEN NEW.new_key IS NOT (${REPAIR_KEY_SQL("NEW.original_key", "NEW.n")}) OR NEW.old_key IS NOT (${servedKeySql("NEW.original_key")}) BEGIN ${named("pdf_repairs_insert_keys", "a rebuild writes to the original key with -r and its number, and names the key served as the old one")} END;`,
    `CREATE TRIGGER \`pdf_repair_results_insert\` BEFORE INSERT ON \`pdf_repair_results\` WHEN ${request("1")} IS NULL
       OR NEW.original_key IS NOT ${request("p.original_key")} OR NEW.n IS NOT ${request("p.n")}
       OR (NEW.outcome = 'rebuilt' AND NEW.new_key IS NOT ${request("p.new_key")})
       OR (NEW.outcome <> 'rebuilt' AND (NEW.new_key IS NOT NULL OR NEW.new_sha256 IS NOT NULL OR NEW.bytes IS NOT NULL))
       OR NEW.completed_at < ${request("p.requested_at")}
       BEGIN ${named("pdf_repair_results_insert", "a rebuild result belongs to its request, with its keys, never before it")} END;`,
    `CREATE TRIGGER \`documents_redact_repairs_outbox\` AFTER UPDATE OF redacted_at ON \`documents\` WHEN OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND OLD.pdf_r2_key IS NOT NULL BEGIN
       INSERT INTO r2_deletions (bucket, key, reason)
         SELECT 'docs', r.new_key, 'redacted' FROM pdf_repair_results r WHERE r.original_key = OLD.pdf_r2_key AND r.outcome = 'rebuilt'
         ON CONFLICT (bucket, key) DO NOTHING;
     END;`,
  ];
}
