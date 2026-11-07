// P7 ops (docs/runs/p7-ops.md; PRD JOB-BKP-01; 08 §6.1; owner 2026-10-07; T7 F1): the monthly finance-only copy kept 10 years, made ON THE RUNNER from
// the nightly plaintext export (.github/workflows/backup.yml), then encrypted with the nightly envelope (scripts/backup-encrypt.sh).
//
//   node scripts/backup-monthly.mjs build <export.sql> <finance.sql>      the export → the finance-only SQL (a new file; never over an existing one)
//   node scripts/backup-monthly.mjs restore <finance.sql> <finance.db>    the finance-only SQL → a new SQLite file to read (runbook restore.md §3.6)
//
// What the copy holds is decided in ONE place, `BACKUP_SCOPE` and `monthlyExportSql` in packages/db/src/backup-scope.ts: the invoice family and accepted
// offers with their child rows, payments, the ledger, the finance audit rows without IP or browser, and the contract records; never leads, contacts,
// proposals, estimates or any other table (rolling copies only, 90 days). This script runs where only wrangler is installed (no workspace package), so it
// reads that scope from scripts/backup-monthly-scope.json, which apps/web/test/backup-monthly.test.ts regenerates from backup-scope.ts and compares: the
// two can't drift.
//
// Build:
//   1. the export is loaded into an IN-MEMORY SQLite database (node:sqlite; no plaintext database file on disk), split by drill-verify's `loadOrder`
//      (schema, then rows; transactions dropped). Its triggers are never created (the copy needs none, and a trigger written before the rows it guards
//      would refuse them); foreign keys are off (the copy leaves out the tables they point at);
//   2. every table of the export must be classified by the scope, and every monthly table must be in the export: otherwise nothing is written;
//   3. the file: a header (format, time, row counts), each monthly table's own definition (only the columns its query keeps, with production's
//      declared types; no constraint, index or trigger) and its rows from `monthlyExportSql(table)` as `INSERT` statements naming their columns, in one
//      transaction.
// Nothing from the data is printed: the log shows the table count and the file's size only (the Actions logs of this public repository are public).

import { closeSync, existsSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadOrder } from "./drill-verify.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SCOPE_FILE = resolve(ROOT, "scripts/backup-monthly-scope.json");
export const FORMAT = "techaust-finance-monthly/1";

/** An error of this script's own, whose message holds no data (only table names, counts and file names). */
export class BackupError extends Error {}

/**
 * What the log may show of an error: this script's own message, or only SQLite's generic error text (`errstr`, e.g. "constraint failed"). SQLite's full
 * message can quote a piece of the statement ("near \"…\""), which may be data, and the Actions logs of this public repository are public.
 */
export const safeMessage = (e) =>
  e instanceof BackupError
    ? e.message
    : `SQLite: ${e && typeof e === "object" && "errstr" in e ? String(e.errstr) : "an error"}`;

/** Tables an export may hold that no scope classifies: D1's own (migrations) and SQLite's or Cloudflare's internal ones. */
export const UNSCOPED_TABLE = /^(d1_migrations$|sqlite_|_cf_)/;

/**
 * The scope file: `{ format, monthly: [{ table, sql }], rollingOnly: [table] }`. Throws on any other shape, a table named twice, or a query that is not a
 * single read of its own table.
 */
export function parseScope(text) {
  const scope = JSON.parse(text);
  if (
    scope?.format !== "techaust-backup-scope/1" ||
    !Array.isArray(scope.monthly) ||
    !Array.isArray(scope.rollingOnly)
  )
    throw new BackupError("the backup scope file has the wrong shape");
  const seen = new Set();
  for (const entry of scope.monthly) {
    if (!entry || typeof entry.table !== "string" || typeof entry.sql !== "string")
      throw new BackupError("a monthly entry needs a table and its sql");
    if (!/^[a-z][a-z0-9_]*$/.test(entry.table)) throw new BackupError(`bad table name ${entry.table}`);
    if (
      !/^SELECT\s/.test(entry.sql) ||
      !new RegExp(`\\bFROM ${entry.table}\\b`).test(entry.sql) ||
      entry.sql.includes(";")
    )
      throw new BackupError(`the query of ${entry.table} is not one read of that table`);
    if (seen.has(entry.table)) throw new BackupError(`${entry.table} is named twice`);
    seen.add(entry.table);
  }
  for (const table of scope.rollingOnly) {
    if (typeof table !== "string" || !/^[a-z][a-z0-9_]*$/.test(table))
      throw new BackupError(`bad table name ${table}`);
    if (seen.has(table)) throw new BackupError(`${table} is named twice`);
    seen.add(table);
  }
  return scope;
}

export const readScope = (path = SCOPE_FILE) => parseScope(readFileSync(path, "utf8"));

/** An SQL identifier, double-quoted. */
export const ident = (name) => `"${String(name).replaceAll('"', '""')}"`;

const hex = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");

/**
 * One value as an SQLite literal that reads back as the same value and type: NULL; an integer (bigint, never rounded); a real (always with a point or an
 * exponent, so it stays REAL); text in single quotes (a NUL inside goes as a cast blob); a blob as X'…'.
 */
export function sqlLiteral(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new BackupError("a REAL value is not finite");
    const s = String(v);
    return /[.eE]/.test(s) ? s : `${s}.0`;
  }
  if (typeof v === "string")
    return v.includes("\u0000")
      ? `CAST(X'${Buffer.from(v, "utf8").toString("hex")}' AS TEXT)`
      : `'${v.replaceAll("'", "''")}'`;
  if (v instanceof Uint8Array) return `X'${hex(v)}'`;
  throw new BackupError(`a value of type ${typeof v} can't be written`);
}

/** A fresh in-memory database with foreign keys off (the copy leaves out the tables they point at). */
const memoryDb = () => new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });

const internalTarget = (s) =>
  /^CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?sqlite_/i.test(s) ||
  /^(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE|REPLACE\s+INTO)\s+[`"[]?sqlite_/i.test(s);

/** Loads an export's schema and rows (never its triggers) into `db`. */
export function loadExport(db, sqlText) {
  const { schema, data } = loadOrder(sqlText);
  for (const s of schema) if (!internalTarget(s)) db.exec(s);
  // Off again after the schema (a statement there could turn them on), and before the transaction (the pragma does nothing inside one).
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec("BEGIN");
  try {
    for (const s of data) if (!internalTarget(s)) db.exec(s);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** The tables of a database: name → its `CREATE TABLE` text. */
export function tablesOf(db) {
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  return new Map(rows.map((r) => [String(r.name), String(r.sql)]));
}

/** Why the export and the scope don't fit (empty: they fit). */
export function scopeProblems(tables, scope) {
  const problems = [];
  const known = new Set([...scope.monthly.map((m) => m.table), ...scope.rollingOnly]);
  for (const m of scope.monthly)
    if (!tables.has(m.table)) problems.push(`the export has no table ${m.table} (a monthly table)`);
  for (const name of tables.keys())
    if (!UNSCOPED_TABLE.test(name) && !known.has(name))
      problems.push(`the export's table ${name} is not in BACKUP_SCOPE (packages/db/src/backup-scope.ts)`);
  return problems;
}

/**
 * The copy's own definition of a monthly table: exactly the columns its query returns, each with the type production declares for it, and no constraint
 * (P7 ops: a column the scope leaves out, such as an acceptance's `typed_name`, is NOT NULL in production, so production's own definition can't hold
 * the copy). The copy is a record to read, never a database to run on.
 */
export function copyTableSql(db, table, sql) {
  const declared = new Map(
    db
      .prepare(`PRAGMA table_info(${ident(table)})`)
      .all()
      .map((c) => [String(c.name), String(c.type ?? "")]),
  );
  const cols = db
    .prepare(sql)
    .columns()
    .map((c) => {
      const type = (c.type ?? declared.get(String(c.name)) ?? "").trim();
      return type ? `${ident(c.name)} ${type}` : ident(c.name);
    });
  return `CREATE TABLE ${ident(table)} (${cols.join(", ")});`;
}

/**
 * Writes the finance-only SQL of a loaded database through `write(text)`. Returns the row count of each monthly table (in the file's header too, which
 * is encrypted with the rest; never printed).
 */
export function writeFinanceSql(
  db,
  scope,
  write,
  { createdAt = new Date().toISOString(), source = "" } = {},
) {
  const counts = {};
  for (const { table, sql } of scope.monthly) {
    const r = db.prepare(`SELECT count(*) AS n FROM (${sql})`).get();
    counts[table] = Number(r?.n ?? 0);
  }
  write(`-- ${FORMAT}\n`);
  write(
    `-- The monthly finance-only copy (PRD JOB-BKP-01; packages/db/src/backup-scope.ts), made ${createdAt}${source ? ` from ${source}` : ""}.\n`,
  );
  write(
    "-- Restore: docs/runbooks/restore.md §3.6 (node scripts/backup-monthly.mjs restore <this file> <new .db>).\n",
  );
  write(`-- Rows: ${scope.monthly.map((m) => `${m.table} ${counts[m.table]}`).join(", ")}\n`);
  write("PRAGMA foreign_keys=OFF;\n");
  for (const { table, sql } of scope.monthly) write(`${copyTableSql(db, table, sql)}\n`);
  write("BEGIN TRANSACTION;\n");
  for (const { table, sql } of scope.monthly) {
    const stmt = db.prepare(sql);
    stmt.setReadBigInts(true);
    let head = null;
    for (const row of stmt.iterate()) {
      const keys = Object.keys(row);
      head ??= `INSERT INTO ${ident(table)} (${keys.map(ident).join(", ")}) VALUES (`;
      write(`${head}${keys.map((k) => sqlLiteral(row[k])).join(", ")});\n`);
    }
  }
  write("COMMIT;\n");
  return counts;
}

/** A writer into a NEW file (mode 600; refuses an existing one), buffered. */
function fileWriter(path) {
  const fd = openSync(path, "wx", 0o600);
  let buf = [];
  let size = 0;
  let total = 0;
  const flush = () => {
    if (buf.length === 0) return;
    writeSync(fd, buf.join(""));
    buf = [];
    size = 0;
  };
  return {
    write(text) {
      buf.push(text);
      size += text.length;
      total += Buffer.byteLength(text);
      if (size > 1 << 20) flush();
    },
    close() {
      flush();
      closeSync(fd);
      return total;
    },
    fail() {
      try {
        closeSync(fd);
      } catch {}
      rmSync(path, { force: true });
    },
  };
}

/** The build: export file → finance-only SQL file. Nothing is left behind on a failure. */
export function buildFinanceCopy(exportPath, outPath, { scope = readScope(), createdAt } = {}) {
  if (existsSync(outPath)) throw new BackupError(`${basename(outPath)} already exists; nothing was written`);
  const db = memoryDb();
  try {
    loadExport(db, readFileSync(exportPath, "utf8"));
    const problems = scopeProblems(tablesOf(db), scope);
    if (problems.length > 0)
      throw new BackupError(
        `the export does not fit the backup scope; nothing was written:\n- ${problems.join("\n- ")}`,
      );
    const out = fileWriter(outPath);
    try {
      const counts = writeFinanceSql(db, scope, out.write, { createdAt, source: basename(exportPath) });
      return { tables: Object.keys(counts).length, bytes: out.close(), counts };
    } catch (e) {
      out.fail();
      throw e;
    }
  } finally {
    db.close();
  }
}

/** The restore: finance-only SQL → a NEW SQLite file (foreign keys off: the copy leaves out the tables they point at). Returns the row counts. */
export function restoreFinanceCopy(financePath, dbPath) {
  const text = readFileSync(financePath, "utf8");
  if (!text.startsWith(`-- ${FORMAT}\n`))
    throw new BackupError(`${basename(financePath)} is not a ${FORMAT} file`);
  if (existsSync(dbPath)) throw new BackupError(`${basename(dbPath)} already exists; nothing was written`);
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: false });
  try {
    db.exec(text);
    const counts = {};
    for (const name of tablesOf(db).keys())
      counts[name] = Number(db.prepare(`SELECT count(*) AS n FROM ${ident(name)}`).get()?.n ?? 0);
    return counts;
  } catch (e) {
    db.close();
    rmSync(dbPath, { force: true });
    throw e;
  } finally {
    if (db.isOpen) db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, from, to] = process.argv.slice(2);
  try {
    if (!from || !to || (mode !== "build" && mode !== "restore"))
      throw new BackupError(
        "usage: backup-monthly.mjs build <export.sql> <finance.sql> | restore <finance.sql> <finance.db>",
      );
    if (mode === "build") {
      const r = buildFinanceCopy(resolve(from), resolve(to));
      console.log(`backup-monthly: wrote ${basename(to)} (${r.tables} tables, ${r.bytes} bytes).`);
    } else {
      const counts = restoreFinanceCopy(resolve(from), resolve(to));
      // The owner's own terminal: the counts help compare with the copy's header.
      for (const [name, n] of Object.entries(counts)) console.log(`${name}: ${n}`);
      console.log(
        `backup-monthly: restored into ${basename(to)} (${Object.keys(counts).length} tables). Keep it private; delete it when done.`,
      );
    }
  } catch (e) {
    // The build runs in a public log: only a message with no data (safeMessage). The restore runs in the owner's own terminal: the full message.
    console.error(`backup-monthly: ${mode === "restore" && e instanceof Error ? e.message : safeMessage(e)}`);
    process.exit(1);
  }
}
