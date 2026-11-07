// M7.5 D1/G (Q4 A): the data of the dashboard's Free-plan usage tile (the designer builds the tile): the account's daily Cloudflare totals of the last 30 UTC
// days that the jobs Worker's `usage.daily` recorded in `stats_daily` (`cf.*`, dimension "" = the account), with the Free limits and the alert lines.
// Owner and Accountant only (`usage.read`). One indexed read (`stats_daily_metric` (metric, date)), at most 5 metrics x 31 days = 155 rows (L50); nothing written.
// A day the job could not read is absent (a gap on the tile), never a zero.
import {
  EXCEEDED_METRIC,
  FREE_DAILY_LIMITS,
  USAGE_METRICS,
  USAGE_THRESHOLDS,
  USAGE_TILE_DAYS,
  usageDayOf,
} from "@techaust/core/usage";
import { Hono } from "hono/tiny";
import type { AppEnv } from "./context.ts";

const METRICS = [...USAGE_METRICS, EXCEEDED_METRIC];

/** `?1` the first UTC day read. */
export const USAGE_TILE_SQL = `SELECT date, metric, value FROM stats_daily WHERE metric IN (${METRICS.map((m) => `'${m}'`).join(", ")}) AND dimension = '' AND date >= ?1 ORDER BY date`;

/** One recorded UTC day: a value per metric the job read that day (a metric it couldn't read is absent). */
export type UsageDay = { date: string; values: Partial<Record<string, number>> };
export type UsageTile = {
  limits: typeof FREE_DAILY_LIMITS;
  thresholds: readonly number[];
  days: UsageDay[];
  /** The newest recorded day, or null before the first reading. */
  newest: string | null;
};

export const dashboardUsage = new Hono<AppEnv>().get("/", async (c) => {
  // A UTC day on purpose (Cloudflare's daily limits reset at 00:00 UTC). L50: one day more than the tile's 30, because before the 06:00 IST reading the
  // tile's window ends the day before yesterday (apps/admin/src/lib/usage.ts); at most 5 metrics x 31 days = 155 rows.
  const since = usageDayOf(Date.now() - USAGE_TILE_DAYS * 86_400_000);
  const rows = (
    await c.env.DB.prepare(USAGE_TILE_SQL).bind(since).all<{ date: string; metric: string; value: number }>()
  ).results;
  const byDay = new Map<string, UsageDay>();
  for (const r of rows) {
    const day = byDay.get(r.date) ?? { date: r.date, values: {} };
    day.values[r.metric] = r.value;
    byDay.set(r.date, day);
  }
  const days = [...byDay.values()];
  const body: UsageTile = {
    limits: FREE_DAILY_LIMITS,
    thresholds: USAGE_THRESHOLDS,
    days,
    newest: days.at(-1)?.date ?? null,
  };
  return c.json(body);
});
