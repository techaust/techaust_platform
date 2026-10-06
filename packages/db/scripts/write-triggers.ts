// Writes the integrity triggers into a new, empty custom migration created by
// `drizzle-kit generate --custom --name <name>`. Applied migrations are never edited.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { triggerMigrationSql } from "../src/triggers.ts";

const name = process.argv[2] ?? "triggers";
const dir = join(import.meta.dirname, "..", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith(`_${name}.sql`));
if (!file)
  throw new Error(`No migration *_${name}.sql: run drizzle-kit generate --custom --name ${name} first`);
const current = readFileSync(join(dir, file), "utf8");
if (!/^(--[^\n]*\n?|\s)*$/.test(current))
  throw new Error(`${file} is not empty; migrations are never rewritten`);
writeFileSync(join(dir, file), triggerMigrationSql());
console.log(`wrote ${file}`);
