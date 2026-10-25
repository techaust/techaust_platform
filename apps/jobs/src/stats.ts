// The nightly statistics (M3.5, ADM-DASH-01 history, docs/05 section 1.2 rule 7, JOB-CRON-02). The dashboard's figures are live; `stats_daily` is
// the history for trends and reports.
//   cron (daily 22:00 UTC = 03:30 IST) -> `enqueueStats`: ONLY enqueues, and reads no D1. One `LEADS_QUEUE.sendBatch` with one
//     `stats.metric` message per metric, for the IST date that has just ENDED (the date of `scheduledTime` minus one day, so a billing day's
//     closing burn is kept under that day).
//   consumer -> `processStats`: ONE metric, or one page of at most 50 plans of a care metric, per message. Each metric is a single
//     `INSERT ... SELECT ... ON CONFLICT(date, metric, dimension) DO UPDATE`, so a rerun or a redelivery writes the same rows again. A care
//     metric reads its page of plans with the shared loader (`@techaust/db/care`), works the figures out with the pure core, and writes them
//     with one `json_each(?)` insert; more than 50 active plans send a continuation message carrying the last plan id (`after`).
//   What each value means: leads, projects and milestones are counts at the time the job runs (a few hours after the date ended; no stage
//   history exists to look further back), the care figures and `time.minutes_prev_day` are exactly as of the date. A dimension that is absent
//   means zero. No personal data is read or written: counts, minutes and plan ids.

import { addDays, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import {
  STATS_MILESTONE_DAYS,
  STATS_PLAN_PAGE,
  type StatsMessage,
  statsDateOf,
  statsMessages,
} from "@techaust/core/stats";
import { assembleCare, careStatements, currentUsage } from "@techaust/db/care";
import { logEvent } from "./log.ts";

/** The leads that are still open (the dashboard's `OPEN_STAGES`: every stage but `won` and `lost`; a test holds the two together). */
const OPEN_LEAD_STAGES = "'new', 'qualified', 'proposal_sent'";

const COLUMNS = "INSERT INTO stats_daily (date, metric, dimension, value, updated_at)";
const UPSERT =
  "ON CONFLICT(date, metric, dimension) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";

/** Clears one metric's rows for a date (`?1` date, `?2` metric) before a grouped metric is written again. */
const CLEAR_METRIC_SQL = "DELETE FROM stats_daily WHERE date = ?1 AND metric = ?2";

/** The statements of the metrics that are one query (exported so a test can EXPLAIN them). `?1` date, `?2` time, `?3` the end of the milestone window. */
export const STATS_SQL = {
  "leads.open": `${COLUMNS} SELECT ?1, 'leads.open', stage, count(*), ?2 FROM leads WHERE stage IN (${OPEN_LEAD_STAGES}) GROUP BY stage ${UPSERT}`,
  "projects.status": `${COLUMNS} SELECT ?1, 'projects.status', status, count(*), ?2 FROM projects WHERE true GROUP BY status ${UPSERT}`,
  "milestones.due_14d": `${COLUMNS} SELECT ?1, 'milestones.due_14d', '', count(*), ?2 FROM milestones WHERE status IN ('pending', 'ready_to_bill') AND due_date BETWEEN ?1 AND ?3 ${UPSERT}`,
  "time.minutes_prev_day": `${COLUMNS} SELECT ?1, 'time.minutes_prev_day', '', coalesce(sum(minutes), 0), ?2 FROM time_logs WHERE work_date = ?1 ${UPSERT}`,
} as const;

/** The metrics with one row per dimension (a stage, a status): a rerun clears the date's rows first, so a dimension that fell to zero goes. */
export const GROUPED_METRICS: ReadonlySet<keyof typeof STATS_SQL> = new Set([
  "leads.open",
  "projects.status",
]);

/** The care figures of one page of plans: `?1` date, `?2` metric, `?3` time, `?4` the `[planId, value]` pairs as JSON. */
export const CARE_STATS_SQL = `${COLUMNS} SELECT ?1, ?2, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), ?3 FROM json_each(?4) j WHERE true ${UPSERT}`;

/**
 * The cron's one job: enqueue a message per metric for the IST day that just ended. No D1 read. Returns that date.
 * `also` rides in the same `sendBatch` (one queue call): the daily document-expiry message (M4.3), which the consumer routes by its kind.
 */
export async function enqueueStats(
  env: Env,
  scheduledTime: number,
  also: readonly unknown[] = [],
): Promise<string> {
  const date = statsDateOf(scheduledTime);
  const bodies = statsMessages(date);
  await env.LEADS_QUEUE.sendBatch([...bodies, ...also].map((body) => ({ body })));
  logEvent("stats.enqueued", { date, metrics: bodies.length });
  return date;
}

export type StatsResult = { rows: number; continued: boolean };

/** Handles one `stats.metric` message (a valid one: the queue routes the rest to `skipStats`). */
export async function processStats(env: Env, msg: StatsMessage, now = Date.now()): Promise<StatsResult> {
  const { metric, date } = msg;
  if (metric === "care.used_minutes" || metric === "care.available_minutes") return careMetric(env, msg, now);
  const stmt = env.DB.prepare(STATS_SQL[metric]);
  if (GROUPED_METRICS.has(metric)) {
    // A grouped metric clears its day's rows first, in the same batch: a stage that fell to zero since an earlier run must not keep
    // its old count. The batch is one transaction, so a failure leaves the earlier rows.
    const [, written] = await env.DB.batch([
      env.DB.prepare(CLEAR_METRIC_SQL).bind(date, metric),
      stmt.bind(date, now),
    ]);
    const rows = written?.meta.changes ?? 0;
    logEvent("stats.metric", { metric, date, rows });
    return { rows, continued: false };
  }
  const res =
    metric === "milestones.due_14d"
      ? await stmt
          .bind(
            date,
            now,
            toIsoDate(
              addDays(
                parseIsoDate(date) as NonNullable<ReturnType<typeof parseIsoDate>>,
                STATS_MILESTONE_DAYS,
              ),
            ),
          )
          .run()
      : await stmt.bind(date, now).run();
  const rows = res.meta.changes;
  logEvent("stats.metric", { metric, date, rows });
  return { rows, continued: false };
}

async function careMetric(env: Env, msg: StatsMessage, now: number): Promise<StatsResult> {
  const { metric, date } = msg;
  // The plans active ON the recorded date (status history), not today's status: a plan paused after midnight keeps the day's row.
  const source =
    msg.after === undefined
      ? { active: STATS_PLAN_PAGE, on: date }
      : { active: STATS_PLAN_PAGE, after: msg.after, on: date };
  const [plans, terms, status, usage] = await env.DB.batch(
    careStatements(env.DB, source, { to: date, periodsBack: 1 }),
  );
  const { plans: loaded, truncated } = assembleCare(
    {
      plans: (plans?.results ?? []) as never,
      terms: (terms?.results ?? []) as never,
      status: (status?.results ?? []) as never,
      usage: (usage?.results ?? []) as never,
    },
    STATS_PLAN_PAGE,
  );
  const pairs: [string, number][] = [];
  for (const d of loaded.values()) {
    const u = currentUsage(d, date);
    if (u) pairs.push([d.plan.id, metric === "care.used_minutes" ? u.used : u.available]);
  }
  if (pairs.length) await env.DB.prepare(CARE_STATS_SQL).bind(date, metric, now, JSON.stringify(pairs)).run();
  // The continuation goes after the page is written: a redelivery that finds the page already written writes the same rows again.
  const last = [...loaded.keys()].at(-1);
  if (truncated && last !== undefined) {
    await env.LEADS_QUEUE.sendBatch([{ body: { ...msg, after: last } satisfies StatsMessage }]);
  }
  logEvent("stats.metric", { metric, date, rows: pairs.length, more: truncated });
  return { rows: pairs.length, continued: truncated };
}

/** A `stats.metric` body this version cannot use (an unknown metric, a bad date): acknowledged and logged, never a lead. */
export function skipStats(body: unknown): void {
  const m = (body as { metric?: unknown } | null)?.metric;
  logEvent("stats.unknown", { metric: typeof m === "string" ? m.slice(0, 40) : undefined });
}

/** A stats message that ran out of tries: the next night writes the date again; no alert and no retry. */
export function logStatsDeadLetter(queue: string, body: unknown): void {
  const m = (body as { metric?: unknown } | null)?.metric;
  logEvent("stats.dead_letter", { queue, metric: typeof m === "string" ? m.slice(0, 40) : undefined });
}
