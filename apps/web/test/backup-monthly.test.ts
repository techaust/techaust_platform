// P7 ops (docs/runs/p7-ops.md; PRD JOB-BKP-01; T7 F1): scripts/backup-monthly.mjs, the monthly finance-only copy made on the runner from the nightly export.
// The scope file it reads is backup-scope.ts's own (regenerated and compared here); the copy is built from an export of the REAL schema (every migration,
// triggers written before the rows), and read back: only the monthly tables, only the rows `monthlyExportSql` keeps, values exact. Runs in Node.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { FINANCE_AUDIT_ACTIONS } from "@techaust/core/audit";
import { BACKUP_SCOPE, monthlyExportSql } from "@techaust/db/backup-scope";
import { afterAll, describe, expect, it } from "vitest";
import {
  BackupError,
  type BackupScopeFile,
  buildFinanceCopy,
  FORMAT,
  ident,
  ifNotExists,
  parseScope,
  readScope,
  restoreFinanceCopy,
  SCOPE_FILE,
  safeMessage,
  scopeProblems,
  sqlLiteral,
  tablesOf,
} from "../../../scripts/backup-monthly.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "backup-monthly-"));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The scope file backup-scope.ts gives (key order kept). */
const expectedScope = (): BackupScopeFile => ({
  format: "techaust-backup-scope/1",
  monthly: Object.keys(BACKUP_SCOPE)
    .filter((t) => BACKUP_SCOPE[t] === "finance_monthly")
    .map((table) => ({ table, sql: monthlyExportSql(table) })),
  rollingOnly: Object.keys(BACKUP_SCOPE).filter((t) => BACKUP_SCOPE[t] === "rolling_only"),
});

/** UPDATE_BACKUP_SCOPE=1 rewrites the scope file before anything reads it. */
if (process.env.UPDATE_BACKUP_SCOPE === "1")
  writeFileSync(SCOPE_FILE, `${JSON.stringify(expectedScope(), null, 2)}\n`);

describe("scripts/backup-monthly-scope.json is backup-scope.ts's own [JOB-BKP-01]", () => {
  it("equals the scope regenerated from BACKUP_SCOPE and monthlyExportSql (UPDATE_BACKUP_SCOPE=1 rewrites it)", () => {
    const want = `${JSON.stringify(expectedScope(), null, 2)}\n`;
    const have = readFileSync(SCOPE_FILE, "utf8").replace(/\r\n/g, "\n");
    expect(
      have,
      "scripts/backup-monthly-scope.json is stale: run this test with UPDATE_BACKUP_SCOPE=1 and commit the file",
    ).toBe(want);
  });

  it("reads back with every monthly table once, and no rolling-only table among them", () => {
    const scope = readScope();
    expect(scope.monthly.map((m) => m.table)).toEqual(
      Object.keys(BACKUP_SCOPE).filter((t) => BACKUP_SCOPE[t] === "finance_monthly"),
    );
    for (const t of ["leads", "contacts", "clients", "email_log", "notes", "files"])
      expect(scope.rollingOnly).toContain(t);
  });

  it.each([
    ["not JSON's shape", JSON.stringify({ monthly: [] })],
    ["a wrong format", JSON.stringify({ format: "x", monthly: [], rollingOnly: [] })],
    [
      "a query of another table",
      JSON.stringify({
        format: "techaust-backup-scope/1",
        monthly: [{ table: "a", sql: "SELECT * FROM b" }],
        rollingOnly: [],
      }),
    ],
    [
      "two statements",
      JSON.stringify({
        format: "techaust-backup-scope/1",
        monthly: [{ table: "a", sql: "SELECT * FROM a; DELETE FROM a" }],
        rollingOnly: [],
      }),
    ],
    [
      "a write",
      JSON.stringify({
        format: "techaust-backup-scope/1",
        monthly: [{ table: "a", sql: "DELETE FROM a" }],
        rollingOnly: [],
      }),
    ],
    [
      "a table named twice",
      JSON.stringify({
        format: "techaust-backup-scope/1",
        monthly: [{ table: "a", sql: "SELECT * FROM a" }],
        rollingOnly: ["a"],
      }),
    ],
    [
      "a bad table name",
      JSON.stringify({ format: "techaust-backup-scope/1", monthly: [], rollingOnly: ['a"; DROP'] }),
    ],
  ])("refuses a scope file with %s", (_why, text) => {
    expect(() => parseScope(text)).toThrow(BackupError);
  });
});

describe("values are written exactly", () => {
  it("writes NULL, integers beyond 2^53, reals, text with quotes, line breaks and NUL, and blobs, and reads them back unchanged", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE v (n, i, r, r2, t, t0, b)");
    const values = [
      null,
      9007199254740993n,
      1.5,
      2.0,
      "it's\n'quoted'\r\n€ ₹",
      "a\u0000b",
      new Uint8Array([0, 1, 254, 255]),
    ];
    db.exec(`INSERT INTO v VALUES (${values.map(sqlLiteral).join(", ")})`);
    const s = db.prepare(
      "SELECT n, i, r, r2, t, t0, b, typeof(i) AS ti, typeof(r2) AS tr2, typeof(t0) AS tt0 FROM v",
    );
    s.setReadBigInts(true);
    const row = s.get() as Record<string, unknown>;
    expect(row.n).toBeNull();
    expect(row.i).toBe(9007199254740993n);
    expect(row.r).toBe(1.5);
    expect(row.r2).toBe(2);
    expect(row.tr2).toBe("real");
    expect(row.t).toBe("it's\n'quoted'\r\n€ ₹");
    expect(row.t0).toBe("a\u0000b");
    expect(row.tt0).toBe("text");
    expect([...(row.b as Uint8Array)]).toEqual([0, 1, 254, 255]);
    expect(row.ti).toBe("integer");
    expect(() => sqlLiteral(Number.NaN)).toThrow(BackupError);
    expect(() => sqlLiteral({})).toThrow(BackupError);
    expect(ident('a"b')).toBe('"a""b"');
  });

  it("adds IF NOT EXISTS to a table definition once", () => {
    expect(ifNotExists("CREATE TABLE `t` (a)")).toBe("CREATE TABLE IF NOT EXISTS `t` (a)");
    expect(ifNotExists("CREATE TABLE IF NOT EXISTS t (a)")).toBe("CREATE TABLE IF NOT EXISTS t (a)");
  });
});

// ---------- an export of the real schema ----------

const migrations = join(ROOT, "packages/db/migrations");
/** A database with every migration applied (as production's), its triggers recorded and then dropped so made-up rows can go in. */
function realDb() {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  for (const f of readdirSync(migrations)
    .filter((x) => /^\d{4}_.+\.sql$/.test(x))
    .sort())
    db.exec(readFileSync(join(migrations, f), "utf8"));
  const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").all() as {
    name: string;
    sql: string;
  }[];
  for (const t of triggers) db.exec(`DROP TRIGGER ${ident(t.name)}`);
  // drizzle's table rebuilds end with `PRAGMA foreign_keys=ON`.
  db.exec("PRAGMA foreign_keys=OFF");
  return { db, triggers: triggers.map((t) => t.sql) };
}

/** One row, every NOT NULL column without a default filled with a made-up value (CHECKs still hold for the columns given). */
function insert(db: DatabaseSync, table: string, values: Record<string, unknown>) {
  const cols = db.prepare(`PRAGMA table_info(${ident(table)})`).all() as {
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }[];
  const row: Record<string, unknown> = {};
  for (const c of cols)
    if (c.notnull && c.dflt_value === null) row[c.name] = /int/i.test(c.type) ? 1n : `x-${c.name}`;
  Object.assign(row, values);
  const keys = Object.keys(row);
  db.exec(
    `INSERT INTO ${ident(table)} (${keys.map(ident).join(", ")}) VALUES (${keys.map((k) => sqlLiteral(row[k])).join(", ")})`,
  );
}

/**
 * The text of an export, written in the worst order for a loader: D1's pragma, a transaction, every table, the view and EVERY TRIGGER first, then the
 * rows, then the indexes (wrangler's own order is not proven yet: restore.md §3.4).
 */
function exportText(db: DatabaseSync, triggers: string[], extra = "") {
  const objects = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
    )
    .all() as { type: string; name: string; sql: string }[];
  const out = ["PRAGMA defer_foreign_keys=TRUE;", "BEGIN TRANSACTION;"];
  for (const o of objects.filter((x) => x.type === "table" || x.type === "view")) out.push(`${o.sql};`);
  for (const t of triggers) out.push(`${t};`);
  for (const o of objects.filter((x) => x.type === "table")) {
    const s = db.prepare(`SELECT * FROM ${ident(o.name)}`);
    s.setReadBigInts(true);
    for (const row of s.iterate() as Iterable<Record<string, unknown>>) {
      const keys = Object.keys(row);
      out.push(
        `INSERT INTO ${ident(o.name)} (${keys.map(ident).join(",")}) VALUES(${keys.map((k) => sqlLiteral(row[k])).join(",")});`,
      );
    }
  }
  for (const o of objects.filter((x) => x.type === "index")) out.push(`${o.sql};`);
  out.push("COMMIT;");
  return `${out.join("\n")}\n${extra}`;
}

const FIN = FINANCE_AUDIT_ACTIONS[0] as string;
const BIG = 9007199254740993n;
const SECRET_IP = "203.0.113.77";
const SECRET_UA = "Mozilla/5.0 (made-up browser for the audit row)";
const LEAD_EMAIL = "lead-person@example.test";
const CONTACT_EMAIL = "contact-person@example.test";

function sampleExport() {
  const { db, triggers } = realDb();
  const frozen = (n: number, display: string) => ({
    frozen_at: 1_760_000_000_000n,
    number: BigInt(n),
    number_display: display,
  });
  insert(db, "terms_versions", { id: "tv-pinned", kind: "invoice" });
  insert(db, "terms_versions", { id: "tv-unused", kind: "invoice", version: 2n });
  insert(db, "documents", {
    id: "d-inv",
    type: "tax_invoice",
    status: "issued",
    client_id: "c1",
    currency: "INR",
    terms_version_id: "tv-pinned",
    total_minor: BIG,
    recipient: "Shop 'A'\nRoad 1",
    ...frozen(1, "TH/25-26/1"),
  });
  insert(db, "documents", {
    id: "d-prop-open",
    type: "proposal",
    status: "sent",
    client_id: "c1",
    currency: "INR",
    ...frozen(1, "TH/P/1"),
  });
  insert(db, "documents", {
    id: "d-prop-acc",
    type: "proposal",
    status: "accepted",
    client_id: "c1",
    currency: "USD",
    ...frozen(2, "TH/P/2"),
  });
  insert(db, "documents", {
    id: "d-est-draft",
    type: "estimate",
    status: "draft",
    client_id: "c1",
    currency: "INR",
  });
  for (const d of ["d-inv", "d-prop-open", "d-prop-acc", "d-est-draft"])
    insert(db, "document_lines", { id: `l-${d}`, document_id: d });
  insert(db, "acceptances", { id: "a1", document_id: "d-prop-acc", contact_id: "k1" });
  insert(db, "deeds", {
    id: "deed-final",
    status: "final",
    number: 1n,
    number_display: "TH/DA/25-26/1",
    fy: "2025",
    made_on: "2026-01-05",
    snapshot: "{}",
    snapshot_sha256: "0".repeat(64),
    finalised_at: 1_760_000_000_000n,
    finalised_by: "s1",
  });
  insert(db, "deeds", { id: "deed-draft", status: "draft", project_id: "pr2" });
  insert(db, "audit_log", {
    id: "au-fin",
    actor_type: "staff",
    action: FIN,
    entity_type: "document",
    summary: '{"number":"TH/25-26/1"}',
    ip: SECRET_IP,
    user_agent: SECRET_UA,
  });
  insert(db, "audit_log", {
    id: "au-other",
    actor_type: "staff",
    action: "lead.create",
    entity_type: "lead",
  });
  insert(db, "leads", { id: "lead1", source: "web", contact_email: LEAD_EMAIL });
  insert(db, "contacts", { id: "k1", email: CONTACT_EMAIL });
  insert(db, "payments", {
    id: "p1",
    client_id: "c1",
    kind: "payment",
    provider: "manual",
    status: "confirmed",
    currency: "INR",
    amount_minor: 12_345n,
    received_on: "2026-11-01",
  });
  return { db, triggers };
}

function build(text: string) {
  const dir = scratch();
  const exp = join(dir, "techaust-prod-20261201T211000Z.sql");
  writeFileSync(exp, text);
  const out = join(dir, "techaust-prod-finance-2026-12.sql");
  return { dir, exp, out };
}

describe("buildFinanceCopy on an export of the real schema [JOB-BKP-01, T7 F1]", () => {
  const { db, triggers } = sampleExport();
  const text = exportText(db, triggers);
  const { dir, exp, out } = build(text);
  const result = buildFinanceCopy(exp, out, { createdAt: "2026-12-01T21:12:00.000Z" });
  const file = readFileSync(out, "utf8");
  const restored = join(dir, "finance.db");
  const counts = restoreFinanceCopy(out, restored);
  const r = new DatabaseSync(restored);
  const ids = (sql: string) => (r.prepare(sql).all() as { id: string }[]).map((x) => x.id).sort();

  it("the real schema fits the scope: every table classified, every monthly table present", () => {
    expect(scopeProblems(tablesOf(db), readScope())).toEqual([]);
    expect(triggers.length).toBeGreaterThan(200);
  });

  it("writes the header, the monthly tables' definitions (no index, no trigger, no view) and one transaction", () => {
    expect(file.startsWith(`-- ${FORMAT}\n`)).toBe(true);
    expect(file).toContain("made 2026-12-01T21:12:00.000Z from techaust-prod-20261201T211000Z.sql");
    expect(file).toMatch(/^-- Rows: documents 2, document_lines 2, /m);
    expect(file).not.toMatch(/CREATE (UNIQUE )?INDEX|CREATE TRIGGER|CREATE VIEW/i);
    expect(file.match(/^CREATE TABLE IF NOT EXISTS /gm)).toHaveLength(readScope().monthly.length);
    expect(file.match(/^BEGIN TRANSACTION;$/gm)).toHaveLength(1);
    expect(file.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(result.tables).toBe(readScope().monthly.length);
    expect(result.bytes).toBe(Buffer.byteLength(file));
  });

  it("restores into exactly the monthly tables, never a rolling-only one", () => {
    expect(Object.keys(counts).sort()).toEqual(
      readScope()
        .monthly.map((m) => m.table)
        .sort(),
    );
    for (const t of ["leads", "contacts", "clients", "email_log"]) {
      expect(counts[t]).toBeUndefined();
      expect(file).not.toContain(`INSERT INTO "${t}"`);
    }
    expect(file).not.toContain(LEAD_EMAIL);
    expect(file).not.toContain(CONTACT_EMAIL);
  });

  it("keeps the invoice family and accepted offers with their lines; leaves out open and draft proposals and estimates", () => {
    expect(ids("SELECT id FROM documents")).toEqual(["d-inv", "d-prop-acc"]);
    expect(ids("SELECT id FROM document_lines")).toEqual(["l-d-inv", "l-d-prop-acc"]);
    expect(ids("SELECT id FROM acceptances")).toEqual(["a1"]);
    expect(file).not.toContain("d-prop-open");
    expect(file).not.toContain("d-est-draft");
  });

  it("keeps only numbered deeds and pinned terms, and the payments whole", () => {
    expect(ids("SELECT id FROM deeds")).toEqual(["deed-final"]);
    expect(ids("SELECT id FROM terms_versions")).toEqual(["tv-pinned"]);
    expect(ids("SELECT id FROM payments")).toEqual(["p1"]);
  });

  it("keeps only finance audit rows, without the IP address or the browser (L35)", () => {
    expect(ids("SELECT id FROM audit_log")).toEqual(["au-fin"]);
    const a = r.prepare("SELECT ip, user_agent, summary FROM audit_log").get() as Record<string, unknown>;
    expect(a).toEqual({ ip: null, user_agent: null, summary: '{"number":"TH/25-26/1"}' });
    expect(file).not.toContain(SECRET_IP);
    expect(file).not.toContain(SECRET_UA);
  });

  it("keeps every value exactly: an amount beyond 2^53, text with quotes and line breaks", () => {
    const s = r.prepare("SELECT total_minor, recipient, currency FROM documents WHERE id = 'd-inv'");
    s.setReadBigInts(true);
    expect(s.get()).toEqual({ total_minor: BIG, recipient: "Shop 'A'\nRoad 1", currency: "INR" });
  });

  it("the copy also loads onto a schema built from the migrations (triggers dropped first), every row in place", () => {
    const { db: target } = realDb();
    target.exec(file);
    const n = (t: string) =>
      Number((target.prepare(`SELECT count(*) AS n FROM ${ident(t)}`).get() as { n: number }).n);
    expect(n("documents")).toBe(2);
    expect(n("audit_log")).toBe(1);
    expect(n("leads")).toBe(0);
    target.close();
  });

  afterAll(() => {
    r.close();
    db.close();
  });
});

describe("buildFinanceCopy refuses, and leaves nothing behind", () => {
  it("refuses an export holding a table the scope does not classify", () => {
    const { db, triggers } = sampleExport();
    db.exec("CREATE TABLE new_feature (id TEXT PRIMARY KEY)");
    const { exp, out } = build(exportText(db, triggers));
    expect(() => buildFinanceCopy(exp, out)).toThrow(/new_feature is not in BACKUP_SCOPE/);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses an export missing a monthly table", () => {
    const { db, triggers } = sampleExport();
    db.exec("DROP TABLE payment_refunds");
    const { exp, out } = build(exportText(db, triggers));
    expect(() => buildFinanceCopy(exp, out)).toThrow(/no table payment_refunds/);
    expect(existsSync(out)).toBe(false);
  });

  it("never writes over an existing file", () => {
    const { db, triggers } = sampleExport();
    const { exp, out } = build(exportText(db, triggers));
    writeFileSync(out, "keep");
    expect(() => buildFinanceCopy(exp, out)).toThrow(/already exists/);
    expect(readFileSync(out, "utf8")).toBe("keep");
  });

  it("an SQLite error is reported without the statement's text (the log is public)", () => {
    const { db, triggers } = sampleExport();
    const { exp, out } = build(
      exportText(db, triggers, "INSERT INTO payments VALUES ('secret-value-77' oops);\n"),
    );
    let caught: unknown;
    try {
      buildFinanceCopy(exp, out);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(BackupError);
    expect(safeMessage(caught)).toMatch(/^SQLite: /);
    expect(safeMessage(caught)).not.toContain("secret-value-77");
    expect(existsSync(out)).toBe(false);
  });
});

describe("the command line", () => {
  const script = join(ROOT, "scripts/backup-monthly.mjs");
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

  it("build prints only the table count and the size; restore reads it back", () => {
    const { db, triggers } = sampleExport();
    const { dir, exp, out } = build(exportText(db, triggers));
    const b = run("build", exp, out);
    expect(b.status, b.stderr).toBe(0);
    expect(b.stdout.trim()).toMatch(
      /^backup-monthly: wrote techaust-prod-finance-2026-12\.sql \(\d+ tables, \d+ bytes\)\.$/,
    );
    expect(b.stderr).toBe("");
    const restored = join(dir, "restored.db");
    const rr = run("restore", out, restored);
    expect(rr.status, rr.stderr).toBe(0);
    expect(rr.stdout).toContain("documents: 2");
    expect(rr.stdout).toContain("Keep it private; delete it when done.");
  });

  it("a failed build prints no data from the export and exits 1", () => {
    const { db, triggers } = sampleExport();
    const { exp, out } = build(
      exportText(db, triggers, "INSERT INTO payments VALUES ('secret-value-88' oops);\n"),
    );
    const b = run("build", exp, out);
    expect(b.status).toBe(1);
    expect(b.stderr).toMatch(/^backup-monthly: SQLite: /);
    expect(`${b.stdout}${b.stderr}`).not.toContain("secret-value-88");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a wrong mode, missing paths and a file that is not a finance copy", () => {
    expect(run("dump", "a", "b").status).toBe(1);
    expect(run("build").status).toBe(1);
    const dir = scratch();
    const notCopy = join(dir, "x.sql");
    writeFileSync(notCopy, "SELECT 1;");
    const r = run("restore", notCopy, join(dir, "x.db"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("is not a techaust-finance-monthly/1 file");
    expect(existsSync(join(dir, "x.db"))).toBe(false);
  });
});
