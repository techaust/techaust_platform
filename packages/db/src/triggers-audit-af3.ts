// Full audit M6–M7 fix round AF3 (run file docs/runs/full-audit-m6-m7.md): the trigger set `audit_af3_triggers` (migration 0086, after 0085's ADD COLUMN):
//   AU51 (early check of AF2, M1): the clean-up's measured writes `retention_run_counts.written` (added by ALTER TABLE, so no CHECK) are a whole number that
//   is never below 0 and only goes up (the consumer adds each page batch's `meta.rows_written`; the run's budget reads their sum).
// New triggers only: no earlier trigger is dropped or recreated.

const abort = (message: string) => `SELECT RAISE(ABORT, '${message}');`;
const named = (name: string, message: string) => {
  if (message.includes("'")) throw new Error(`${name}: an abort message has no apostrophe`);
  return abort(`${name}: ${message}`);
};

const writtenBad = (row: string) => `typeof(${row}.written) <> 'integer' OR ${row}.written < 0`;

export function auditAf3TriggerStatements(): string[] {
  return [
    `CREATE TRIGGER \`retention_run_counts_written_insert\` BEFORE INSERT ON \`retention_run_counts\` WHEN ${writtenBad("NEW")} BEGIN ${named("retention_run_counts_written_insert", "a clean-up count has a whole number of rows written, never below 0")} END;`,
    `CREATE TRIGGER \`retention_run_counts_written_update\` BEFORE UPDATE OF written ON \`retention_run_counts\` WHEN ${writtenBad("NEW")} OR NEW.written < OLD.written BEGIN ${named("retention_run_counts_written_update", "a clean-up count has a whole number of rows written that only goes up")} END;`,
  ];
}
