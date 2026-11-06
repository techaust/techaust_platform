// M7.5 L18 (A2 finding D): the shared counting env of the admin, portal and jobs Worker tests. It runs inside workerd (the test pool) and is installed
// once per test file by each app's setup file (`installBudget`). Per INVOCATION (a request, a queue batch, a cron run: the dynamic extent the setup
// opens with `invocation()`), it counts:
//   - statements in each `db.batch()` (house rule: at most 45, T7);
//   - D1 calls (a batch counts once, docs read 2026-11-07, L16) plus subrequests (fetch, R2 operations, queue sends, service-binding fetches);
//     house rule: at most 45 together per invocation (Cloudflare's own limits are 50 D1 queries and 50 subrequests on the Free plan).
// A global `afterEach` fails the test whose invocation went over either line, unless the path is on KNOWN_OVER (a reported finding, never a raised
// limit). Writes made by the tests themselves (fixtures, seeds, reads back) run outside any invocation and are not counted.
//
// It also collects every distinct SQL text (with the first values bound to it) that ran inside an invocation, and `explainSweep` runs
// EXPLAIN QUERY PLAN on each after the file: a bare `SCAN <table>` (no index) fails unless the table is on SCAN_ALLOWED with a reason.
//
// Not counted: RPC method calls over a service binding (the stub is a proxy; the tests use in-process stand-ins), and queues or buckets that a test
// replaced by its own fake object. Pure bookkeeping otherwise: nothing here changes what a statement or a fetch does.

type Als<T> = { run<R>(store: T, fn: () => R): R; getStore(): T | undefined };
// workerd provides node:async_hooks under nodejs_compat (every app's config); the Workers tsconfigs carry no Node types, so the module is typed here.
const { AsyncLocalStorage } = (await import("node:async_hooks" as string)) as {
  AsyncLocalStorage: new <T>() => Als<T>;
};

/** The house rules (L16): statements in one batch, and D1 calls plus subrequests in one invocation. */
export const LIMITS = { batchStatements: 45, callsAndSubrequests: 45 } as const;

export type Invocation = {
  /** What ran: `GET /api/v1/invoices/inv_1`, `queue pdf.render`, `scheduled 30 * * * *`. */
  label: string;
  /** D1 calls (first/run/all/raw/exec, and each batch once). */
  d1: number;
  /** fetch, R2, queue sends and service-binding fetches. */
  sub: number;
  /** The largest batch, in statements (0 when the invocation made none). */
  maxBatch: number;
  /** Statements run in all (singles plus every batch's statements). */
  statements: number;
};

/**
 * Real paths known to go over a line: each names its finding and its fix (never a raised limit). A row is matched on the label; `what` says which
 * line it may cross. Empty when every path is within the lines.
 */
export const KNOWN_OVER: { label: RegExp; what: "batch" | "calls"; reason: string }[] = [];

/**
 * Bare `SCAN`s allowed, each with its reason: a table that stays a handful of rows, a scan that is the point, or a reported finding waiting for its index
 * (named, never silent). `sql`, when given, limits the entry to statements it matches. Anything else needs an index.
 */
export const SCAN_ALLOWED: { table: string; sql?: RegExp; reason: string }[] = [
  {
    table: "offer_links",
    sql: /^INSERT INTO acceptances\b/,
    reason:
      "M7.5 B2 finding S1: SQLite's foreign-key check of `offer_links.acceptance_id` (no index on that child column) scans offer_links on every acceptance insert. Fix: CREATE INDEX offer_links_acceptance ON offer_links (acceptance_id), a migration the lead numbers after B1's; then delete this entry.",
  },
];

const als = new AsyncLocalStorage<Invocation>();
let finished: Invocation[] = [];
const sqlSeen = new Map<string, unknown[]>();
let installed = false;

/** Runs `fn` as one invocation (nested calls count into the outer one: an in-process stand-in for another Worker belongs to its caller here). */
export async function invocation<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  if (als.getStore()) return fn();
  const inv: Invocation = { label, d1: 0, sub: 0, maxBatch: 0, statements: 0 };
  try {
    return await als.run(inv, fn);
  } finally {
    finished.push(inv);
  }
}

/** The SQL text and bound values of a D1 prepared statement (workerd's `D1PreparedStatement` keeps them as `statement` and `params`). */
function sqlOf(stmt: unknown): { sql: string; params: unknown[] } | null {
  if (typeof stmt !== "object" || stmt === null) return null;
  const sql = Reflect.get(stmt, "statement");
  const params = Reflect.get(stmt, "params");
  return typeof sql === "string" ? { sql, params: Array.isArray(params) ? params : [] } : null;
}

function noteSql(stmt: unknown): void {
  const s = sqlOf(stmt);
  if (s && !sqlSeen.has(s.sql)) sqlSeen.set(s.sql, s.params);
}

type Fn = (...a: unknown[]) => unknown;
function wrapMethod(proto: object, name: string, before: (self: unknown, args: unknown[]) => void): void {
  const orig = Reflect.get(proto, name) as Fn | undefined;
  if (typeof orig !== "function" || Reflect.get(orig, "__budget") === true) return;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    before(this, args);
    return orig.apply(this, args);
  };
  Reflect.set(wrapped, "__budget", true);
  Object.defineProperty(proto, name, { value: wrapped, configurable: true, writable: true });
}

/** Queue and R2 bindings of the admin, portal and jobs Workers (any one of a kind is enough). */
const BINDING_NAMES = ["EMAIL_QUEUE", "LEADS_QUEUE", "PDF_QUEUE", "FILES", "DOCS"];

const isObj = (v: unknown): v is object => typeof v === "object" && v !== null;
const hasFns = (v: unknown, names: string[]) =>
  isObj(v) && names.every((n) => typeof Reflect.get(v, n) === "function");

/**
 * Patches the prototypes of the bindings in `env` (D1, its statements, queues, R2 buckets, service bindings) and `globalThis.fetch`, once per
 * isolate. Only work inside an `invocation()` is counted.
 */
export function installBudget(env: object): void {
  if (installed) return;
  installed = true;
  const db = Reflect.get(env, "DB");
  if (hasFns(db, ["prepare", "batch"])) {
    const dbProto = Object.getPrototypeOf(db) as object;
    wrapMethod(dbProto, "batch", (_self, args) => {
      const inv = als.getStore();
      if (!inv) return;
      const stmts = Array.isArray(args[0]) ? (args[0] as unknown[]) : [];
      inv.d1++;
      inv.statements += stmts.length;
      inv.maxBatch = Math.max(inv.maxBatch, stmts.length);
      for (const s of stmts) noteSql(s);
    });
    wrapMethod(dbProto, "exec", () => {
      const inv = als.getStore();
      if (inv) inv.d1++;
    });
    const stmtProto = Object.getPrototypeOf(
      (db as { prepare(q: string): unknown }).prepare("SELECT 1"),
    ) as object;
    for (const m of ["first", "run", "all", "raw"])
      wrapMethod(stmtProto, m, (self) => {
        const inv = als.getStore();
        if (!inv) return;
        inv.d1++;
        inv.statements++;
        noteSql(self);
      });
  }
  const sub = () => {
    const inv = als.getStore();
    if (inv) inv.sub++;
  };
  // The test pool's `env` is a proxy whose bindings don't enumerate, so they are read by name; one binding of a kind patches its whole class.
  const names = new Set([...Object.keys(env), ...BINDING_NAMES]);
  for (const name of names) {
    const value = Reflect.get(env, name) as unknown;
    if (!isObj(value)) continue;
    const proto = Object.getPrototypeOf(value) as object | null;
    if (!proto || proto === Object.prototype) continue;
    if (hasFns(value, ["send", "sendBatch"]))
      for (const m of ["send", "sendBatch"]) wrapMethod(proto, m, sub);
    else if (hasFns(value, ["head", "get", "put", "delete", "list"]))
      for (const m of ["head", "get", "put", "delete", "list", "createMultipartUpload"])
        wrapMethod(proto, m, sub);
  }
  // globalThis.fetch, typed loosely (this package's tsconfig has no DOM or Workers types).
  const g = globalThis as unknown as { fetch: Fn };
  const realFetch = g.fetch;
  if (typeof realFetch === "function" && Reflect.get(realFetch, "__budget") !== true) {
    const counted = (...args: unknown[]) => {
      sub();
      return realFetch.apply(globalThis, args);
    };
    Reflect.set(counted, "__budget", true);
    g.fetch = counted;
  }
}

/** The invocations finished since the last call (the global afterEach takes them after each test). */
export function takeInvocations(): Invocation[] {
  const out = finished;
  finished = [];
  return out;
}

/** The problems of a set of invocations against the house rules, minus the known, reported paths. */
export function budgetProblems(invocations: Invocation[]): string[] {
  const problems: string[] = [];
  const known = (inv: Invocation, what: "batch" | "calls") =>
    KNOWN_OVER.some((k) => k.what === what && k.label.test(inv.label));
  for (const inv of invocations) {
    if (inv.maxBatch > LIMITS.batchStatements && !known(inv, "batch"))
      problems.push(
        `${inv.label}: a batch of ${inv.maxBatch} statements (house rule ${LIMITS.batchStatements}, M7.5 L16/L18)`,
      );
    if (inv.d1 + inv.sub > LIMITS.callsAndSubrequests && !known(inv, "calls"))
      problems.push(
        `${inv.label}: ${inv.d1} D1 calls + ${inv.sub} subrequests = ${inv.d1 + inv.sub} (house rule ${LIMITS.callsAndSubrequests}, M7.5 L16/L18)`,
      );
  }
  return problems;
}

/** The largest figures per label, for the route inventory's `d1` field (printed as one `TA-BUDGET` line per file when asked). */
export function summarise(invocations: Invocation[]): Invocation[] {
  const by = new Map<string, Invocation>();
  for (const inv of invocations) {
    const had = by.get(inv.label);
    if (!had) by.set(inv.label, { ...inv });
    else {
      had.d1 = Math.max(had.d1, inv.d1);
      had.sub = Math.max(had.sub, inv.sub);
      had.maxBatch = Math.max(had.maxBatch, inv.maxBatch);
      had.statements = Math.max(had.statements, inv.statements);
    }
  }
  return [...by.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** The SQL texts seen inside invocations since the last sweep (and forgets them). */
export function takeSql(): Map<string, unknown[]> {
  const out = new Map(sqlSeen);
  sqlSeen.clear();
  return out;
}

/** A plan line that is a bare scan of a table (no index): `SCAN clients`, not `SCAN clients USING INDEX …` nor a CTE or subquery. */
export function bareScanOf(detail: string, tables: Set<string>): string | null {
  const m = /^SCAN (\S+)(?: AS \S+)?$/.exec(detail.trim());
  if (!m?.[1]) return null;
  const name = m[1].replace(/^["`[]|["`\]]$/g, "");
  return tables.has(name) ? name : null;
}

const PLANNED = /^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|REPLACE)\b/i;

/**
 * EXPLAIN QUERY PLAN over every SQL text taken (`takeSql`), on the real D1 and outside any invocation (so nothing is counted). A bare scan of a table
 * that is not on SCAN_ALLOWED is a problem; a statement the planner can't read with its first bound values is skipped (reported in `skipped`).
 */
export async function explainSweep(
  db: D1Like,
  sql: Map<string, unknown[]>,
): Promise<{ problems: string[]; checked: number; skipped: number }> {
  const tables = new Set(
    (
      await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()
    ).results.map((r) => r.name),
  );
  const problems: string[] = [];
  let checked = 0;
  let skipped = 0;
  for (const [text, params] of sql) {
    if (!PLANNED.test(text)) continue;
    let details: string[];
    try {
      const stmt = db.prepare(`EXPLAIN QUERY PLAN ${text}`);
      const bound = params.length > 0 ? stmt.bind(...params) : stmt;
      details = (await bound.all<{ detail: string }>()).results.map((r) => r.detail);
    } catch {
      skipped++;
      continue;
    }
    checked++;
    for (const d of details) {
      const table = bareScanOf(d, tables);
      const allowed = SCAN_ALLOWED.some(
        (a) => a.table === table && (a.sql === undefined || a.sql.test(text)),
      );
      if (table && !allowed)
        problems.push(`SCAN ${table} (no index) in: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
  return { problems: [...new Set(problems)], checked, skipped };
}

/**
 * The setup files' one call: installs the counters on `env`, fails a test whose invocation crossed a line (afterEach), and after the file runs the
 * EXPLAIN sweep (afterAll; skipped when `explain` is false). Each test's figures go on its task meta as `taBudget` (the label summary), which
 * Vitest's JSON reporter writes out: `scripts/route-inventory.mjs --budget <report.json>` reads them for the inventory's `d1` field. (The test pool
 * shows a passing test's console output nowhere, so the meta is the channel.) The hooks come from the caller's vitest.
 */
export function budgetHooks(o: {
  env: object;
  afterEach: (fn: (ctx: { task: { meta: object } }) => void) => void;
  afterAll: (fn: () => Promise<void>, timeout?: number) => void;
  explain?: boolean;
}): void {
  installBudget(o.env);
  o.afterEach((ctx) => {
    const done = takeInvocations();
    if (done.length > 0) Reflect.set(ctx.task.meta, "taBudget", summarise(done));
    const problems = budgetProblems(done);
    if (problems.length > 0) throw new Error(`D1/subrequest budget:\n${problems.join("\n")}`);
  });
  o.afterAll(async () => {
    takeInvocations();
    if (o.explain === false) return;
    const db = Reflect.get(o.env, "DB") as D1Like | undefined;
    if (!db) return;
    const sweep = await explainSweep(db, takeSql());
    if (sweep.problems.length > 0)
      throw new Error(
        `EXPLAIN sweep (M7.5 L18): a bare SCAN needs an index or a SCAN_ALLOWED reason:\n${sweep.problems.join("\n")}`,
      );
  }, 60_000);
}

/** The part of D1 the sweep uses (typed here: this package carries no Workers types). */
export type D1Like = {
  prepare(sql: string): {
    bind(...v: unknown[]): { all<T>(): Promise<{ results: T[] }> };
    all<T>(): Promise<{ results: T[] }>;
  };
};
