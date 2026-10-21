// Writes a set of integrity triggers into a new, empty custom migration created by
// `drizzle-kit generate --custom --name <set>`. <set> is a key of TRIGGER_SETS in src/triggers.ts
// (`triggers` is the default, `auth_triggers` is M1.5, `portal_triggers` is M1.6). Applied migrations are never edited.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TRIGGER_SETS, type TriggerSet, triggerMigrationSql } from "../src/triggers.ts";

const name = process.argv[2] ?? "triggers";
if (!Object.hasOwn(TRIGGER_SETS, name))
  throw new Error(`Unknown trigger set "${name}" (known: ${Object.keys(TRIGGER_SETS).join(", ")})`);
const dir = join(import.meta.dirname, "..", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith(`_${name}.sql`));
if (!file)
  throw new Error(`No migration *_${name}.sql: run drizzle-kit generate --custom --name ${name} first`);
const current = readFileSync(join(dir, file), "utf8");
if (!/^(--[^\n]*\n?|\s)*$/.test(current))
  throw new Error(`${file} is not empty; migrations are never rewritten`);
writeFileSync(join(dir, file), triggerMigrationSql(name as TriggerSet));
console.log(`wrote ${file}`);
