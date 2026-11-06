// M7.5 B2 (brief B, I1; A2's JSON shape): the route inventory, every unit of Worker work the staging CPU gate must cover (admin rows of all four Workers, the
// portal, the website's Worker paths, the jobs hooks, the crons by IST branch, the queue kinds and the RPC methods), and the pure check over it. Each row
// has exactly ONE measure: a `reading` (where on staging its CPU is read) or a named `proxy` with a reason (the local first-request probe, M6.2's
// inferred rule). `scripts/route-inventory.mjs` builds `.logs/route-inventory.json`; readings, when filled in after I1, are judged against the row's limits.
// Pure: no I/O.

export const INVENTORY_WORKERS = [
  "admin-front",
  "admin-api",
  "admin-finance",
  "admin-invoices",
  "portal",
  "web",
  "jobs",
] as const;
export type InventoryWorker = (typeof INVENTORY_WORKERS)[number];

/** `login`: staff and client sign-in; `hook`: a webhook or the unsubscribe path; `cron`: one IST branch of a cron; `queue`: one message kind; `rpc`: a method. */
export const INVENTORY_KINDS = ["route", "login", "hook", "cron", "queue", "rpc"] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

/** CPU limits in ms (NFR-2, brief I1): the first run of the row in an isolate, and the warm p99. */
export type Limits = { firstMs: number; warmP99Ms: number };

/** Where the row's CPU comes from on staging. */
export type Reading = {
  type: "reading";
  /** `bench`: bench-routes.mjs calls it; `owner-session`: the owner's scripted write session; `staging-logs`: it runs on staging by itself (crons, queues, RPC). */
  via: "bench" | "owner-session" | "staging-logs";
  /** Filled after I1: the worst first run and the warm p99 (nearest rank), in ms. */
  firstMs?: number;
  warmP99Ms?: number;
  samples?: number;
};
export type Proxy = {
  type: "proxy";
  /** The stand-in measured instead (only named ones count, lead decision N2). */
  name: "local-first-request-probe";
  reason: string;
  /** Filled from `scripts/cpu-probe.mjs`: the local first request, in ms (the rule is <= 2.5 ms, M6.2). */
  probeMs?: number;
};
export type Measure = Reading | Proxy;

/** The D1 figures of the row from the shared counting env (L18): the worst invocation seen in the tests. */
export type D1Figures = { calls: number; subrequests: number; maxBatch: number };

export type InventoryRow = {
  /** Unique: `<worker> <METHOD> <path>`, `jobs cron <branch>`, `jobs queue <kind>`, `<worker> rpc <Entrypoint>.<method>`. */
  id: string;
  worker: InventoryWorker;
  kind: InventoryKind;
  method?: string;
  path?: string;
  /** The ROUTES row's permission action (admin), when there is one. */
  action?: string;
  limits: Limits;
  measure: Measure | null;
  d1: D1Figures | null;
};

export type Inventory = { version: 1; generatedAt: string; rows: InventoryRow[] };

/** The local first-request probe's line (M6.2's inferred rule, brief I1 (5)). */
export const PROXY_LIMIT_MS = 2.5;
/** The house rule for D1 calls plus subrequests and for statements in one batch (L16). */
export const D1_LINE = 45;

/**
 * NFR-2's limits per kind (brief I1): sign-in 5 ms (the M1.4 exception of 6 ms stands for the staff login, `exception: true`), hooks 5, crons 5, an RPC's
 * first call 7, everything else 7; the warm p99 is 7 for every row.
 */
export function limitsFor(kind: InventoryKind, o: { loginException?: boolean } = {}): Limits {
  const first = kind === "login" ? (o.loginException ? 6 : 5) : kind === "hook" || kind === "cron" ? 5 : 7;
  return { firstMs: first, warmP99Ms: 7 };
}

/** Problems with one measure (shape and, when figures are present, the limits). */
function measureProblems(row: InventoryRow): string[] {
  const m = row.measure;
  if (m === null || typeof m !== "object") return [`${row.id}: no reading and no named proxy`];
  if (m.type === "reading") {
    const p: string[] = [];
    if (!["bench", "owner-session", "staging-logs"].includes(m.via))
      p.push(`${row.id}: unknown reading source ${String(m.via)}`);
    if (m.firstMs !== undefined && m.firstMs > row.limits.firstMs)
      p.push(`${row.id}: first run ${m.firstMs} ms over its ${row.limits.firstMs} ms`);
    if (m.warmP99Ms !== undefined && m.warmP99Ms > row.limits.warmP99Ms)
      p.push(`${row.id}: warm p99 ${m.warmP99Ms} ms over ${row.limits.warmP99Ms} ms`);
    if ((m.firstMs ?? 0) > 10 || (m.warmP99Ms ?? 0) > 10) p.push(`${row.id}: over the Free plan's 10 ms`);
    if ("name" in m || "reason" in m) p.push(`${row.id}: a reading and a proxy at once`);
    return p;
  }
  if (m.type === "proxy") {
    const p: string[] = [];
    if (m.name !== "local-first-request-probe")
      p.push(`${row.id}: proxy ${String(m.name)} is not a named proxy`);
    if (typeof m.reason !== "string" || m.reason.trim().length < 10)
      p.push(`${row.id}: a proxy needs its reason`);
    if (m.probeMs !== undefined && m.probeMs > PROXY_LIMIT_MS)
      p.push(`${row.id}: local first request ${m.probeMs} ms over ${PROXY_LIMIT_MS} ms`);
    if ("via" in m) p.push(`${row.id}: a reading and a proxy at once`);
    return p;
  }
  return [`${row.id}: measure type must be "reading" or "proxy"`];
}

/**
 * Every problem of an inventory: a duplicate id, an unknown worker or kind, limits that aren't NFR-2's for the kind, a row with no measure or with both,
 * a proxy without a name or a reason, a figure over its limit, and D1 figures over the house line. Empty: the inventory passes.
 */
export function inventoryProblems(inv: Inventory, o: { loginExceptions?: string[] } = {}): string[] {
  const problems: string[] = [];
  if (inv.version !== 1) problems.push("inventory version must be 1");
  if (!Array.isArray(inv.rows) || inv.rows.length === 0) return [...problems, "inventory has no rows"];
  const seen = new Set<string>();
  for (const row of inv.rows) {
    if (seen.has(row.id)) problems.push(`${row.id}: listed twice`);
    seen.add(row.id);
    if (!(INVENTORY_WORKERS as readonly string[]).includes(row.worker))
      problems.push(`${row.id}: unknown worker ${row.worker}`);
    if (!(INVENTORY_KINDS as readonly string[]).includes(row.kind)) {
      problems.push(`${row.id}: unknown kind ${row.kind}`);
      continue;
    }
    const want = limitsFor(row.kind, { loginException: o.loginExceptions?.includes(row.id) ?? false });
    if (row.limits?.firstMs !== want.firstMs || row.limits?.warmP99Ms !== want.warmP99Ms)
      problems.push(
        `${row.id}: limits must be first ${want.firstMs} ms, warm p99 ${want.warmP99Ms} ms (NFR-2)`,
      );
    problems.push(...measureProblems(row));
    if (row.d1) {
      if (row.d1.calls + row.d1.subrequests > D1_LINE)
        problems.push(
          `${row.id}: ${row.d1.calls} D1 calls + ${row.d1.subrequests} subrequests over ${D1_LINE}`,
        );
      if (row.d1.maxBatch > D1_LINE)
        problems.push(`${row.id}: a batch of ${row.d1.maxBatch} statements over ${D1_LINE}`);
    }
  }
  return problems;
}

/** Counts per worker and kind, for the report. */
export function inventoryCounts(rows: InventoryRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.worker] = (out[r.worker] ?? 0) + 1;
    out[`kind:${r.kind}`] = (out[`kind:${r.kind}`] ?? 0) + 1;
    const t = r.measure?.type ?? "none";
    out[`measure:${t}`] = (out[`measure:${t}`] ?? 0) + 1;
  }
  return out;
}

/** A path pattern (`/api/v1/invoices/:id`) matched against a concrete path (`/api/v1/invoices/inv_1`): for joining the test figures to rows. */
export function patternMatches(pattern: string, path: string): boolean {
  const a = pattern.split("/");
  const b = path.split("?")[0]?.split("/") ?? [];
  const same = (s: string, i: number) => s.startsWith(":") || s === b[i];
  // A trailing `*` takes one segment or more.
  if (a.at(-1) === "*") return b.length >= a.length && a.slice(0, -1).every(same);
  return a.length === b.length && a.every(same);
}
