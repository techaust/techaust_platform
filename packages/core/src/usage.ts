// M7.5 D1 (Q4 A, owner 2026-11-01): the account's daily use of the Cloudflare Free plan, read once a day from the GraphQL Analytics API by the jobs
// Worker (`usage.daily`, queued by the 03:30 IST cron) and kept in `stats_daily` as `cf.*` metrics; the 09:00 IST owner alerts ring a bell at 50 % and
// 80 % of a daily Free limit; the dashboard's usage tile (designer, later) reads the last 30 days. Pure, and no zod: the jobs Worker imports this file.
//
// Dataset and field names: Cloudflare docs read 2026-11-07 through Context7 (cloudflare-docs): `workersInvocationsAdaptive` (sum `requests`, dimensions
// `scriptName`, `status`; `status` "exceededResources" is the CPU and 1027 outcome; the brief's "exceededCpu" is not a documented status, so this is the
// field kept), `d1AnalyticsAdaptiveGroups` (sum `rowsRead`, `rowsWritten`, dimension `databaseId`, filter `date_geq`/`date_leq`) and
// `queueMessageOperationsAdaptiveGroups` (sum `billableOperations`, dimension `actionType`). UNVERIFIED until the owner's token exists: that the three
// datasets answer together in one query (aliases `w`, `d`, `q`), and the `limit` caps. Browser Run time is NOT in a documented GraphQL dataset
// (not found 2026-11-07): it stays our own `pdf.browser_ms` metric (docs/runbooks/budget-audit.md).
//
// Days are UTC days: Cloudflare's daily Free limits reset at 00:00 UTC (budget-audit.md), unlike the other `stats_daily` rows (IST dates).

/** The daily Free limits the alerts and the tile measure against (docs/runbooks/budget-audit.md, read 2026-11-07). */
export const FREE_DAILY_LIMITS = {
  "cf.requests": 100_000,
  "cf.d1.rows_read": 5_000_000,
  "cf.d1.rows_written": 100_000,
  "cf.queue.operations": 10_000,
} as const;
export type UsageMetric = keyof typeof FREE_DAILY_LIMITS;
export const USAGE_METRICS = Object.keys(FREE_DAILY_LIMITS) as UsageMetric[];

/** Recorded with the limits but measured against none: invocations that ended `exceededResources` (CPU over 10 ms, or error 1027). */
export const EXCEEDED_METRIC = "cf.exceeded_resources";

/** The alert lines (percent of a daily Free limit). */
export const USAGE_THRESHOLDS = [50, 80] as const;

/** Days of history the tile reads. */
export const USAGE_TILE_DAYS = 30;

export type UsageMessage = { v: 1; kind: "usage.daily"; day: string };

export const isUsageKind = (body: unknown): boolean =>
  typeof body === "object" && body !== null && (body as { kind?: unknown }).kind === "usage.daily";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isUsageMessage = (body: unknown): body is UsageMessage =>
  isUsageKind(body) &&
  (body as { v?: unknown }).v === 1 &&
  typeof (body as { day?: unknown }).day === "string" &&
  ISO_DAY.test((body as { day: string }).day);

/** The UTC day that ended last before `scheduledTime` (the 03:30 IST cron runs at 22:00 UTC: today's UTC day isn't over, so yesterday's). */
export const usageDayOf = (scheduledTime: number): string =>
  new Date(scheduledTime - 86_400_000).toISOString().slice(0, 10);

export const usageMessageOf = (scheduledTime: number): UsageMessage => ({
  v: 1,
  kind: "usage.daily",
  day: usageDayOf(scheduledTime),
});

/** The one GraphQL query (variables `a` account tag, `s`/`e` the day's start and next day's start, `d` the day). */
export const USAGE_QUERY = `query Usage($a: string!, $s: Time!, $e: Time!, $d: Date!) {
  viewer {
    accounts(filter: { accountTag: $a }) {
      w: workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $s, datetime_lt: $e }) {
        sum { requests }
        dimensions { scriptName status }
      }
      d: d1AnalyticsAdaptiveGroups(limit: 100, filter: { date_geq: $d, date_leq: $d }) {
        sum { rowsRead rowsWritten }
        dimensions { databaseId }
      }
      q: queueMessageOperationsAdaptiveGroups(limit: 100, filter: { date_geq: $d, date_leq: $d }) {
        sum { billableOperations }
        dimensions { actionType }
      }
    }
  }
}`;

export const usageVariables = (accountTag: string, day: string) => {
  const start = Date.parse(`${day}T00:00:00Z`);
  return {
    a: accountTag,
    s: new Date(start).toISOString(),
    e: new Date(start + 86_400_000).toISOString(),
    d: day,
  };
};

/** One `stats_daily` row (the date is the message's day). `dimension` "" is the account total. */
export type UsageRow = { metric: string; dimension: string; value: number };

export type UsageParse =
  | { ok: true; rows: UsageRow[]; missing: ("workers" | "d1" | "queues")[]; errors: number }
  | { ok: false; reason: "not_json" | "graphql_error" | "no_account" };

const DIMENSION = /^[A-Za-z0-9._-]{1,80}$/;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const dim = (v: unknown): string => (typeof v === "string" && DIMENSION.test(v) ? v : "other");
const listOf = (v: unknown): Record<string, unknown>[] | null =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    : null;
const field = (o: unknown, k: string): unknown =>
  typeof o === "object" && o !== null ? (o as Record<string, unknown>)[k] : undefined;

/**
 * The GraphQL answer to `stats_daily` rows: totals (dimension "") and per Worker, per database and per action type. A dataset that is missing (null, or
 * named in `errors`) is listed in `missing` and records nothing (partial data is kept, never zero-filled); no dataset at all is a failure. Only codes
 * and counts are kept (script names, database ids, action types), never anything else from the answer.
 */
export function parseUsage(text: string): UsageParse {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const errors = listOf(field(body, "errors")) ?? [];
  const account = listOf(field(field(field(body, "data"), "viewer"), "accounts"))?.[0];
  if (!account) return { ok: false, reason: errors.length > 0 ? "graphql_error" : "no_account" };
  const rows: UsageRow[] = [];
  const missing: ("workers" | "d1" | "queues")[] = [];
  const add = (metric: string, dimension: string, value: number) => {
    const at = rows.find((r) => r.metric === metric && r.dimension === dimension);
    if (at) at.value += value;
    else rows.push({ metric, dimension, value });
  };

  const w = listOf(account.w);
  if (w === null) missing.push("workers");
  else {
    add("cf.requests", "", 0);
    add(EXCEEDED_METRIC, "", 0);
    for (const g of w) {
      const requests = num(field(field(g, "sum"), "requests")) ?? 0;
      const script = dim(field(field(g, "dimensions"), "scriptName"));
      add("cf.requests", "", requests);
      add("cf.requests", script, requests);
      if (field(field(g, "dimensions"), "status") === "exceededResources") {
        add(EXCEEDED_METRIC, "", requests);
        add(EXCEEDED_METRIC, script, requests);
      }
    }
  }
  const d = listOf(account.d);
  if (d === null) missing.push("d1");
  else {
    add("cf.d1.rows_read", "", 0);
    add("cf.d1.rows_written", "", 0);
    for (const g of d) {
      const db = dim(field(field(g, "dimensions"), "databaseId"));
      const read = num(field(field(g, "sum"), "rowsRead")) ?? 0;
      const written = num(field(field(g, "sum"), "rowsWritten")) ?? 0;
      add("cf.d1.rows_read", "", read);
      add("cf.d1.rows_read", db, read);
      add("cf.d1.rows_written", "", written);
      add("cf.d1.rows_written", db, written);
    }
  }
  const q = listOf(account.q);
  if (q === null) missing.push("queues");
  else {
    add("cf.queue.operations", "", 0);
    for (const g of q) {
      const ops = num(field(field(g, "sum"), "billableOperations")) ?? 0;
      add("cf.queue.operations", "", ops);
      add("cf.queue.operations", dim(field(field(g, "dimensions"), "actionType")), ops);
    }
  }
  if (missing.length === 3) return { ok: false, reason: errors.length > 0 ? "graphql_error" : "no_account" };
  return { ok: true, rows, missing, errors: errors.length };
}

/** A daily total at or over an alert line: the highest line crossed per metric. */
export type UsageCrossing = {
  metric: UsageMetric;
  threshold: (typeof USAGE_THRESHOLDS)[number];
  value: number;
  limit: number;
};

/** The crossings of one day's totals (rows with dimension ""). No rows: no crossing (no alert without data). */
export function usageCrossings(totals: { metric: string; value: number }[]): UsageCrossing[] {
  const out: UsageCrossing[] = [];
  for (const metric of USAGE_METRICS) {
    const row = totals.find((t) => t.metric === metric);
    if (!row) continue;
    const limit = FREE_DAILY_LIMITS[metric];
    // Integer maths: value * 100 >= limit * threshold.
    const crossed = [...USAGE_THRESHOLDS].reverse().find((t) => row.value * 100 >= limit * t);
    if (crossed !== undefined) out.push({ metric, threshold: crossed, value: row.value, limit });
  }
  return out;
}

/** Staff words (drafted by builder B2 for the lead's approval under the delegation; M7.5 H): the metric names on a bell. */
export const USAGE_METRIC_LABELS: Record<UsageMetric, string> = {
  "cf.requests": "Worker requests",
  "cf.d1.rows_read": "D1 rows read",
  "cf.d1.rows_written": "D1 rows written",
  "cf.queue.operations": "Queue operations",
};

/** The bell title (staff line, drafted for the lead): "Free plan: Worker requests at 80 % of the daily limit on 2026-11-06 (81,234 of 100,000)". */
export function usageBellTitle(c: UsageCrossing, day: string): string {
  const n = (v: number) => v.toLocaleString("en-IN");
  return `Free plan: ${USAGE_METRIC_LABELS[c.metric]} at ${c.threshold} % of the daily limit on ${day} (${n(c.value)} of ${n(c.limit)})`;
}

/** The newest day among recorded totals (the alerts read the last few days and use the newest), or null. */
export function newestUsageDay(rows: { date: string }[]): string | null {
  let best: string | null = null;
  for (const r of rows) if (best === null || r.date > best) best = r.date;
  return best;
}
