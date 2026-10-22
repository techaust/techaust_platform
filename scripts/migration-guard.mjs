// Guard (CLAUDE.md Conventions, Migrations): a migration after 0006 must not rebuild (DROP TABLE, or the
// `__new_<table>` copy drizzle-kit writes) a table that other tables reference. D1 runs migrations with foreign keys
// ON and ignores `PRAGMA foreign_keys=OFF`, so the DROP deletes or fails every child row: with `ON DELETE CASCADE`
// the children vanish. Add the change another way (a new table, or ALTER TABLE ... ADD COLUMN), or allow-list the
// migration in scripts/migration-rebuild-allowlist.json with a reason the analyst has checked.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Migrations 0000-0006 were applied before this guard existed; only later ones are checked. */
export const FIRST_CHECKED = 7;

const NAME = "[`\"']?([A-Za-z0-9_]+)[`\"']?";
const normal = (table) => table.replace(/^__new_/, "");
const statements = (sql) =>
  sql
    .split("--> statement-breakpoint")
    .flatMap((chunk) => chunk.split(/;\s*(?:\r?\n|$)/))
    .map((s) => s.replace(/--[^\n]*/g, "").trim())
    .filter(Boolean);

/** parent table -> the other tables that reference it, from every CREATE TABLE and ALTER TABLE in the migrations. */
export function referencedBy(migrations) {
  const map = new Map();
  for (const { sql } of migrations) {
    for (const s of statements(sql)) {
      const owner = new RegExp(`^(?:CREATE TABLE|ALTER TABLE)\\s+(?:IF NOT EXISTS\\s+)?${NAME}`, "i").exec(
        s,
      )?.[1];
      if (!owner) continue;
      for (const m of s.matchAll(new RegExp(`REFERENCES\\s+${NAME}`, "gi"))) {
        const parent = normal(m[1]);
        const child = normal(owner);
        if (parent === child) continue; // a self-reference (parent_id) loses nothing it doesn't already lose
        map.set(parent, (map.get(parent) ?? new Set()).add(child));
      }
    }
  }
  return map;
}

/**
 * @param {{ name: string, sql: string }[]} migrations in file order (NNNN_name.sql)
 * @param {{ migration: string, table: string, reason: string }[]} allow
 * @returns {string[]} one message per violation
 */
export function findRebuildViolations(migrations, allow = []) {
  const parents = referencedBy(migrations);
  const problems = [];
  for (const { name, sql } of migrations) {
    if (Number.parseInt(name, 10) < FIRST_CHECKED) continue;
    const rebuilt = new Set();
    for (const s of statements(sql)) {
      const drop = new RegExp(`^DROP TABLE\\s+(?:IF EXISTS\\s+)?${NAME}`, "i").exec(s)?.[1];
      const copy = new RegExp(`^CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?${NAME}`, "i").exec(s)?.[1];
      if (drop) rebuilt.add(normal(drop));
      if (copy?.startsWith("__new_")) rebuilt.add(normal(copy));
    }
    for (const table of rebuilt) {
      const children = [...(parents.get(table) ?? [])].filter((c) => c !== table);
      if (children.length === 0) continue;
      if (allow.some((a) => a.migration === name && a.table === table && a.reason?.trim())) continue;
      problems.push(
        `${name} rebuilds \`${table}\`, which ${children.map((c) => `\`${c}\``).join(", ")} reference${children.length === 1 ? "s" : ""}. ` +
          "Dropping it cascades or breaks those rows on D1. Use ALTER TABLE ADD COLUMN or a new table, " +
          "or allow-list it (with a reason) in scripts/migration-rebuild-allowlist.json after the analyst's check.",
      );
    }
  }
  return problems;
}

export function loadMigrations(dir) {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}
