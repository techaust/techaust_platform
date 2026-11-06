// M7.5 I4 (Q5 A; docs/runbooks/restore.md, drill-log.md): `pnpm drill:verify` checks a restored database in a LOCAL scratch D1 against what the
// code says it must hold. It never touches a remote database: the read-only staging export (`wrangler d1 export … --remote --output`, the owner's or the
// lead's step in the runbook) is a file this script only reads.
//
//   node scripts/drill-verify.mjs --import <export.sql> [--persist-to .wrangler/drill]   load the export into a FRESH scratch D1, then verify
//   node scripts/drill-verify.mjs [--persist-to .wrangler/drill]                         verify what is already there
//
// Loading: the export is split into schema (tables, indexes, views), data (inserts) and triggers, and run in that order, so an export that writes a
// trigger before the rows it guards (an append-only or frozen-row trigger would refuse them) still loads (brief I4 "risk to prove").
// Checks (each one a line; any failure exits 1):
//   1. row counts per table (printed; the run fails if the database has no tables);
//   2. numbering: for every `doc_counters` row, the documents (or deeds) of that series and FY run 1..next_no-1 with no gap and nothing above;
//   3. the ledger: every frozen payable document's paid, TDS and balance equal the recompute from its live allocations (the recompute's own SQL);
//   4. the audit tail: the newest rows of `audit_log` (printed: id, action, time), and none dated in the future;
//   5. triggers: every trigger the trigger sets of packages/db/src/triggers*.ts leave installed is present;
//   6. migrations: `d1_migrations` holds one row per file in packages/db/migrations.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ---------- pure parts (tested in packages/core/test/drill-verify.test.ts) ----------

/**
 * An SQL export cut into statements, knowing quotes and comments, with a trigger kept whole (its body's `;` up to its `END;`). Each statement keeps its
 * text as written.
 */
export function splitStatements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  const inTrigger = () => /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(cur);
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      cur += " ";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === close && sql[j + 1] === close && close !== "]") j += 2;
        else if (sql[j] === close) break;
        else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === ";") {
      if (inTrigger() && !/\bEND\s*$/i.test(cur)) {
        cur += ch;
        i++;
        continue;
      }
      if (cur.trim()) out.push(`${cur.trim()};`);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The export's statements in load order: schema (and pragmas), then data, then triggers. Transactions are dropped (the D1 import runs each file whole). */
export function loadOrder(sql) {
  const schema = [];
  const data = [];
  const triggers = [];
  for (const s of splitStatements(sql)) {
    if (/^(BEGIN|COMMIT|END)\s*(TRANSACTION)?\s*;?$/i.test(s)) continue;
    if (/^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(s)) triggers.push(s);
    else if (/^(INSERT|REPLACE|UPDATE|DELETE)\b/i.test(s)) data.push(s);
    else schema.push(s);
  }
  return { schema, data, triggers };
}

/** The triggers a sequence of statements leaves installed (CREATE adds, DROP removes), in order. */
export function installedTriggers(statements) {
  const names = new Set();
  // In text order: a statement list may hold a DROP and the CREATE that replaces it.
  const re = /(CREATE|DROP)\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?[`"[]?(\w+)/gi;
  for (const s of statements)
    for (const m of s.matchAll(re)) {
      if (!m[2]) continue;
      if (m[1]?.toUpperCase() === "CREATE") names.add(m[2]);
      else names.delete(m[2]);
    }
  return names;
}

/**
 * Numbering problems: `counters` rows `{series, fy, next_no}`, `numbered` rows `{series, fy, max_no, distinct_no, min_no}` (documents and deeds together).
 * A series and FY must hold exactly the numbers 1..next_no-1: no gap, nothing above the counter, nothing numbered without a counter.
 */
export function numberingProblems(counters, numbered) {
  const problems = [];
  const key = (r) => `${r.series}/${r.fy}`;
  const have = new Map(numbered.map((r) => [key(r), r]));
  for (const c of counters) {
    const last = Number(c.next_no) - 1;
    const r = have.get(key(c)) ?? { max_no: 0, distinct_no: 0, min_no: last > 0 ? 1 : 0 };
    have.delete(key(c));
    if (Number(r.max_no ?? 0) !== last)
      problems.push(`${key(c)}: the last number is ${r.max_no ?? 0}, the counter says ${last}`);
    else if (Number(r.distinct_no) !== last || (last > 0 && Number(r.min_no) !== 1))
      problems.push(`${key(c)}: ${r.distinct_no} numbers for 1..${last} (a gap)`);
  }
  for (const r of have.values()) problems.push(`${key(r)}: numbered documents with no counter row`);
  return problems;
}

/** The migration files of packages/db/migrations (`NNNN_name.sql`). */
export const migrationFiles = (dir = join(ROOT, "packages/db/migrations")) =>
  readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f));

// ---------- local D1 through the jobs app's wrangler (never --remote) ----------

const jobs = join(ROOT, "apps/jobs");
const wrangler = join(jobs, "node_modules", "wrangler", "bin", "wrangler.js");

function d1Args(persist) {
  return ["d1", "execute", "DB", "--local", "--persist-to", persist];
}

/** The rows of every statement in `sql` (`;`-separated), one array per statement. */
function queryAll(persist, sql) {
  const out = execFileSync(process.execPath, [wrangler, ...d1Args(persist), "--json", "--command", sql], {
    cwd: jobs,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((r) => r?.results ?? []);
}

/** One read: the rows of the LAST statement in `sql`. */
const query = (persist, sql) => queryAll(persist, sql).at(-1) ?? [];

function runFile(persist, statements) {
  if (statements.length === 0) return;
  const dir = mkdtempSync(join(tmpdir(), "drill-"));
  try {
    const file = join(dir, "part.sql");
    writeFileSync(file, `${statements.join("\n")}\n`);
    execFileSync(process.execPath, [wrangler, ...d1Args(persist), "--file", file], {
      cwd: jobs,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function verify(persist) {
  const problems = [];
  const started = Date.now();
  const line = (s) => console.log(s);

  // 1. row counts
  const tables = query(
    persist,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).map((r) => r.name);
  if (tables.length === 0) problems.push("the database has no tables");
  else {
    // One statement per table (D1 caps the terms of one compound SELECT).
    const counts = queryAll(
      persist,
      tables.map((t) => `SELECT '${t}' AS t, count(*) AS n FROM "${t}"`).join("; "),
    ).map((rows) => rows[0] ?? {});
    line(`1. row counts (${tables.length} tables): ${counts.map((r) => `${r.t} ${r.n}`).join(", ")}`);
  }

  // 2. numbering
  const counters = query(persist, "SELECT series, fy, next_no FROM doc_counters ORDER BY series, fy");
  const numbered = query(
    persist,
    `SELECT series, fy, max(number) AS max_no, count(DISTINCT number) AS distinct_no, min(number) AS min_no FROM documents WHERE number IS NOT NULL GROUP BY series, fy
     UNION ALL SELECT 'deed', fy, max(number), count(DISTINCT number), min(number) FROM deeds WHERE number IS NOT NULL GROUP BY fy`,
  );
  const numbering = numberingProblems(counters, numbered);
  problems.push(...numbering);
  line(`2. numbering: ${counters.length} series and FY rows, ${numbering.length} problem(s)`);

  // 3. ledger recompute (the recompute's own SQL from packages/db/src/sql-rules.ts)
  const { livePaidSql, liveTdsSql, PAYABLE_TYPES_SQL } = await import("../packages/db/src/sql-rules.ts");
  const off = query(
    persist,
    `SELECT count(*) AS n FROM (SELECT d.id, d.paid_minor, d.tds_minor, d.balance_minor, d.total_minor, d.credited_minor, ${livePaidSql("d.id")} AS paid, ${liveTdsSql("d.id")} AS tds
       FROM documents d WHERE d.frozen_at IS NOT NULL AND d.type IN ${PAYABLE_TYPES_SQL} AND d.status <> 'void') x
     WHERE x.paid_minor <> x.paid OR x.tds_minor <> x.tds OR x.balance_minor <> max(0, x.total_minor - x.paid - x.credited_minor - x.tds)`,
  )[0]?.n;
  if (Number(off) > 0)
    problems.push(`${off} payable document(s) whose stored paid, TDS or balance differ from the recompute`);
  line(`3. ledger: ${Number(off ?? 0)} document(s) off the recompute`);

  // 4. audit tail
  const tail = query(persist, "SELECT id, action, at FROM audit_log ORDER BY at DESC, id DESC LIMIT 5");
  const future = tail.filter((r) => Number(r.at) > Date.now() + 60_000);
  if (future.length > 0) problems.push(`${future.length} audit row(s) dated in the future`);
  line(
    `4. audit tail: ${tail.map((r) => `${r.action} ${new Date(Number(r.at)).toISOString()}`).join("; ") || "(empty)"}`,
  );

  // 5. triggers
  const { TRIGGER_SETS } = await import("../packages/db/src/triggers.ts");
  const expected = installedTriggers(Object.values(TRIGGER_SETS).flatMap((s) => s.statements()));
  const present = new Set(
    query(persist, "SELECT name FROM sqlite_master WHERE type = 'trigger'").map((r) => r.name),
  );
  const missing = [...expected].filter((t) => !present.has(t));
  if (missing.length > 0) problems.push(`missing triggers: ${missing.join(", ")}`);
  line(
    `5. triggers: ${present.size} installed, ${expected.size} expected from the trigger sets, ${missing.length} missing`,
  );

  // 6. migrations
  const files = migrationFiles().length;
  const applied = Number(query(persist, "SELECT count(*) AS n FROM d1_migrations")[0]?.n ?? 0);
  if (applied !== files)
    problems.push(`d1_migrations has ${applied} rows, packages/db/migrations has ${files} files`);
  line(`6. migrations: ${applied} applied of ${files}`);

  line(`verified in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return problems;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const at = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes("--remote")) {
    console.error(
      "drill-verify works on a LOCAL scratch D1 only; export staging read-only first (docs/runbooks/restore.md).",
    );
    process.exit(2);
  }
  const persist = resolve(at("--persist-to") ?? join(ROOT, ".wrangler/drill"));
  const started = Date.now();
  const exportFile = at("--import");
  if (exportFile) {
    if (existsSync(join(persist, "v3", "d1")) && readdirSync(join(persist, "v3", "d1")).length > 0) {
      console.error(
        `${persist} already holds a database: delete it (a fresh scratch D1 for each drill) and run again.`,
      );
      process.exit(2);
    }
    const parts = loadOrder(readFileSync(resolve(exportFile), "utf8"));
    console.log(
      `loading ${exportFile}: ${parts.schema.length} schema, ${parts.data.length} data, ${parts.triggers.length} trigger statements (schema, data, triggers)`,
    );
    runFile(persist, parts.schema);
    runFile(persist, parts.data);
    runFile(persist, parts.triggers);
    console.log(`loaded in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  const problems = await verify(persist);
  console.log(`drill total ${((Date.now() - started) / 1000).toFixed(1)} s (RTO 4 h)`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`drill FAILED: ${p}`);
    process.exit(1);
  }
  console.log("drill-verify: ok");
}
