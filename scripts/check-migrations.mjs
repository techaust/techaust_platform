// CI guard: no migration after 0006 rebuilds a table other tables reference (see scripts/migration-guard.mjs).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findRebuildViolations, loadMigrations } from "./migration-guard.mjs";

const migrations = loadMigrations(fileURLToPath(new URL("../packages/db/migrations/", import.meta.url)));
const allow = JSON.parse(
  readFileSync(new URL("./migration-rebuild-allowlist.json", import.meta.url), "utf8"),
);
const problems = findRebuildViolations(migrations, allow);
if (problems.length > 0) {
  for (const p of problems) console.error(`migration guard: ${p}`);
  process.exit(1);
}
console.log(`migration guard: ok (${migrations.length} migrations, none rebuilds a referenced table)`);
