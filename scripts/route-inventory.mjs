// M7.5 B2 (brief F, I1): builds the route inventory `.logs/route-inventory.json` (A2's shape: one row per admin ROUTES row of all four Workers, portal row,
// website Worker path, jobs fetch route, cron branch, queue kind and RPC method; each with NFR-2's limits, one planned measure and its D1 figures) and
// checks it with `@techaust/core/route-inventory`.
//
// Usage:
//   node scripts/route-inventory.mjs                       build and print the counts; exits 0 (the check's "no reading yet" rows are expected before I1)
//   node scripts/route-inventory.mjs --budget admin=<json> --budget portal=<json> --budget jobs=<json>
//        adds each row's D1 figures from the Vitest JSON reports the counting env fills (`taBudget` on each test's meta; M7.5 L18):
//        pnpm --filter @techaust/admin exec vitest run --reporter=json --outputFile.json=../../.logs/budget-admin.json
//   node scripts/route-inventory.mjs --readings <json>      merges staging readings `{ "<row id>": { firstMs, warmP99Ms, samples } | { probeMs } }`
//   node scripts/route-inventory.mjs --check               exits 1 when the check finds a problem (after I1: every row read or proxied, within limits)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  inventoryCounts,
  inventoryProblems,
  limitsFor,
  patternMatches,
} from "../packages/core/src/route-inventory.ts";
import { parseJsonc } from "./check-worker-config.mjs";
import {
  adminRows,
  CRON_BRANCHES,
  jobsFetchRows,
  kindOf,
  LOGIN_EXCEPTIONS,
  plannedMeasure,
  portalRows,
  QUEUE_EXTRA,
  QUEUE_KINDS,
  queueRowOf,
  rpcRows,
  webRows,
} from "./route-inventory-lib.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");
export const OUT = resolve(ROOT, ".logs/route-inventory.json");

/** Every row, from the sources as they are now. */
export function buildRows(src = read) {
  const routes = [
    ...adminRows(src("apps/admin/worker/guard.ts")),
    ...portalRows(src("apps/portal/worker/guard.ts")),
    ...webRows(src("apps/web/src/worker.ts"), src("apps/web/src/forms.ts")),
    ...jobsFetchRows(src("apps/jobs/src/index.ts")),
  ].map((r) => {
    const kind = kindOf(r.worker, r.method, r.path);
    const id = `${r.worker} ${r.method} ${r.path}`;
    return {
      id,
      worker: r.worker,
      kind,
      method: r.method,
      path: r.path,
      ...(r.permission ? { permission: r.permission } : {}),
      limits: limitsFor(kind, { loginException: LOGIN_EXCEPTIONS.has(id) }),
      measure: plannedMeasure({ ...r, kind }),
      d1: null,
    };
  });
  const crons = CRON_BRANCHES.map((c) => ({
    id: `jobs cron ${c.branch}`,
    worker: "jobs",
    kind: "cron",
    path: c.cron,
    limits: limitsFor("cron"),
    measure: plannedMeasure({ kind: "cron" }),
    d1: null,
  }));
  const queues = [...QUEUE_KINDS, ...QUEUE_EXTRA].map((k) => ({
    id: `jobs queue ${k}`,
    worker: "jobs",
    kind: "queue",
    path: k,
    limits: limitsFor("queue"),
    measure: plannedMeasure({ kind: "queue" }),
    d1: null,
  }));
  const rpc = [
    ...rpcRows(src("apps/admin/worker/finance.ts"), "admin-finance"),
    ...rpcRows(src("apps/admin/worker/invoicing.ts"), "admin-invoices"),
  ].map((r) => ({
    id: `${r.worker} rpc ${r.entrypoint}.${r.method}`,
    worker: r.worker,
    kind: "rpc",
    path: `${r.entrypoint}.${r.method}`,
    limits: limitsFor("rpc"),
    measure: plannedMeasure({ kind: "rpc" }),
    d1: null,
  }));
  return [...routes, ...crons, ...queues, ...rpc];
}

/** The `taBudget` summaries of a Vitest JSON report (every test's meta). */
export function budgetsOf(report) {
  const out = [];
  for (const file of report?.testResults ?? [])
    for (const t of file.assertionResults ?? []) for (const b of t.meta?.taBudget ?? []) out.push(b);
  return out;
}

/**
 * The suite's labels joined to rows: `METHOD /path` to the suite's route rows by pattern; jobs `queue <q> <kind>` to its row (`queueRowOf`: emails to
 * `email`, a form submission to `lead`, a dead letter to its queue's row, else the kind's row). Worst figures kept.
 */
export function applyBudgets(rows, suite, budgets) {
  const workers =
    suite === "admin"
      ? ["admin-front", "admin-api", "admin-finance", "admin-invoices"]
      : suite === "portal"
        ? ["portal"]
        : ["jobs"];
  const candidates = rows.filter((r) => workers.includes(r.worker));
  let joined = 0;
  for (const b of budgets) {
    const [first, second, third] = String(b.label).split(" ");
    let row;
    if (first === "queue") {
      const path = queueRowOf(second, third);
      row = candidates.find((r) => r.kind === "queue" && r.path === path);
    } else if (first === "scheduled") row = undefined;
    else
      row = candidates.find(
        (r) =>
          r.method === first &&
          typeof r.path === "string" &&
          r.path.startsWith("/") &&
          patternMatches(r.path, second ?? ""),
      );
    if (!row) continue;
    joined++;
    const d = row.d1 ?? { calls: 0, subrequests: 0, maxBatch: 0 };
    row.d1 = {
      calls: Math.max(d.calls, b.d1),
      subrequests: Math.max(d.subrequests, b.sub),
      maxBatch: Math.max(d.maxBatch, b.maxBatch),
    };
  }
  return joined;
}

/** Staging or probe figures into the planned measures (`{ id: { firstMs, warmP99Ms, samples } }` or `{ id: { probeMs } }`). */
export function applyReadings(rows, readings) {
  for (const row of rows) {
    const r = readings?.[row.id];
    if (!r || !row.measure) continue;
    Object.assign(row.measure, r);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const rows = buildRows();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--budget") {
      const [suite, file] = String(args[++i]).split("=");
      const n = applyBudgets(rows, suite, budgetsOf(JSON.parse(readFileSync(resolve(file), "utf8"))));
      console.log(`budget ${suite}: ${n} test invocations joined to rows`);
    } else if (args[i] === "--readings")
      applyReadings(rows, JSON.parse(readFileSync(resolve(args[++i]), "utf8")));
  }
  // The configured crons must be the ones the branches name (a new cron needs its rows).
  const jobsCrons = parseJsonc(read("apps/jobs/wrangler.jsonc")).triggers?.crons ?? [];
  const named = new Set(CRON_BRANCHES.map((c) => c.cron));
  const unknownCron = jobsCrons.filter((c) => !named.has(c));
  const inventory = { version: 1, generatedAt: new Date().toISOString(), rows };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(inventory, null, 2)}\n`);
  const counts = inventoryCounts(rows);
  console.log(`route inventory: ${rows.length} rows -> ${OUT}`);
  console.log(JSON.stringify(counts));
  const withD1 = rows.filter((r) => r.d1).length;
  console.log(`rows with D1 figures from the tests: ${withD1}`);
  const problems = [
    ...unknownCron.map((c) => `jobs cron "${c}" has no inventory branch`),
    ...inventoryProblems(inventory, { loginExceptions: [...LOGIN_EXCEPTIONS] }),
  ];
  for (const p of problems.slice(0, 50)) console.log(`  ${p}`);
  if (problems.length > 50) console.log(`  … and ${problems.length - 50} more`);
  if (args.includes("--check") && problems.length > 0) process.exit(1);
}
