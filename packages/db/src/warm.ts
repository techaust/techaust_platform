// The start-up dry run's shared pieces (CPU warm-up (b)1, docs/runs/cpu-warmup.md; the portal's since M7.5 L39): the made-up D1 over an answer book of
// made-up rows, its key, and the hook the budget's start-up probe listens on. Each Worker's own dry run (its warm app, made-up env and calls) stays in its
// app: apps/admin/worker/warm-routes.ts, apps/portal/worker/warm-routes.ts. Pure: no I/O, no random value, no timer (global scope refuses them).

/** One made-up request: a path below `/api/v1`, its method and (for a write) its JSON body. */
export type WarmCall = { readonly method: string; readonly path: string; readonly body?: unknown };

/**
 * The answer book: FNV-1a of a statement's SQL → its made-up results (`p`: the parameters they were recorded for, kept only where one statement has several
 * entries; `r`: rows; `c`: rows changed).
 */
export type WarmRows = Readonly<
  Record<
    string,
    readonly { readonly p?: readonly unknown[]; readonly r: readonly unknown[]; readonly c: number }[]
  >
>;

/** A Worker's dry run: its calls and its answer book (the generated warm-fixtures/<worker>.ts). */
export type WarmFixture = { readonly calls: readonly WarmCall[]; readonly rows: WarmRows };

/** FNV-1a (32 bits, hex) of a SQL text: the answer book's key. Also used by the fixture writer (scripts/cpu-probe.mjs), which must hash the same way. */
export function sqlKey(sql: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < sql.length; i++) {
    h ^= sql.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const sameParams = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * What the made-up D1 saw of one statement (tests only, early check 2): its SQL, whether it reads, whether the answer book held it (a read it does not hold
 * is a MISS: a stale fixture, answered with no rows), and how many rows it answered.
 */
export type WarmStatementSeen = {
  readonly sql: string;
  readonly read: boolean;
  readonly hit: boolean;
  readonly rows: number;
};

/**
 * A made-up D1 over the answer book: reads get the recorded rows (those recorded for the same parameters, else the first), writes report one row changed.
 * `observe` (tests): called once per statement answered, so a test can fail a stale fixture (a read missing from the book) instead of a quiet empty answer.
 */
export function warmDb(book: WarmRows, observe?: (seen: WarmStatementSeen) => void): D1Database {
  const answer = (sql: string, params: readonly unknown[]) => {
    const entries = book[sqlKey(sql)];
    const hit = entries?.find((e) => e.p !== undefined && sameParams(e.p, params)) ?? entries?.[0];
    const write = !/^\s*(SELECT|WITH)\b/i.test(sql);
    const rows = (hit?.r ?? []) as Record<string, unknown>[];
    observe?.({ sql, read: !write, hit: hit !== undefined, rows: rows.length });
    const changes = hit ? hit.c : write ? 1 : 0;
    return {
      success: true as const,
      // A copy of each row: a handler that changes a row it read never changes the answer book.
      results: rows.map((r) => ({ ...r })),
      meta: {
        duration: 0,
        changes,
        last_row_id: 0,
        changed_db: changes > 0,
        rows_read: rows.length,
        rows_written: changes,
        size_after: 0,
      },
    };
  };
  const statement = (sql: string, params: readonly unknown[]): D1PreparedStatement => {
    const s = {
      sql,
      params,
      bind: (...values: unknown[]) => statement(sql, values),
      first: async (column?: string) => {
        const row = answer(sql, params).results[0] as Record<string, unknown> | undefined;
        if (row === undefined) return null;
        return column === undefined ? row : (row[column] ?? null);
      },
      all: async () => answer(sql, params),
      run: async () => answer(sql, params),
      raw: async (options?: { columnNames?: boolean }) => {
        const results = answer(sql, params).results;
        const rows = results.map((r) => (Array.isArray(r) ? r : Object.values(r)));
        if (!options?.columnNames) return rows;
        const first = results[0];
        return [first && !Array.isArray(first) ? Object.keys(first) : [], ...rows];
      },
    };
    return s as unknown as D1PreparedStatement;
  };
  const db = {
    prepare: (sql: string) => statement(sql, []),
    batch: async (statements: D1PreparedStatement[]) =>
      statements.map((st) => {
        const s = st as unknown as { sql: string; params: readonly unknown[] };
        return answer(s.sql, s.params);
      }),
    exec: async () => ({ count: 0, duration: 0 }),
    withSession: () => db,
    dump: async () => new ArrayBuffer(0),
  };
  return db as unknown as D1Database;
}

/**
 * The start-up probe's collector (scripts/worker-budget.mjs `STARTUP_PROBE`, CPU warm-up fix round, early check 1a): the probe puts a function by this name
 * in its sandbox's global scope and waits for what it is handed, so the budget times the dry run's microtasks as well as the module's evaluation. Workerd
 * has no such global, so in a deployed Worker this reads one missing property and does nothing.
 */
const STARTUP_PROBE = "__techaustStartupProbe";
/** Hands an entry's start-up work to the budget's start-up probe, when one is listening; never throws. */
export function exposeToStartupProbe(work: Promise<unknown>): void {
  try {
    const collect = (globalThis as Record<string, unknown>)[STARTUP_PROBE];
    if (typeof collect === "function") collect(work);
  } catch {
    // never stop a Worker from starting
  }
}
