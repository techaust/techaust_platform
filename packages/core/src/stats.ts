// The nightly history table `stats_daily` [docs/05 section 1.2 rule 7]: which metrics the cron records, and the queue message that
// asks for one. The dashboard's figures are LIVE; this table is history for trends and reports (and the care-plan burn per plan).
// Pure, and no zod: the jobs Worker imports this file.
import { parseIsoDate } from "./dates.ts";

/** `dimension` is what the value is split by (or empty): a lead stage, a project status, or a care plan id. */
export const STATS_METRICS = [
  "leads.open",
  "projects.status",
  "milestones.due_14d",
  "care.used_minutes",
  "care.available_minutes",
  "time.minutes_prev_day",
] as const;
export type StatsMetric = (typeof STATS_METRICS)[number];

/** A metric that covers every active care plan is written in pages of this many plans, one page per message. */
export const STATS_PLAN_PAGE = 50;

/** One metric for one IST date; `after` continues a paged metric after that plan id. */
export type StatsMessage = { kind: "stats.metric"; metric: StatsMetric; date: string; after?: string };

export function isStatsMessage(body: unknown): body is StatsMessage {
  if (typeof body !== "object" || body === null) return false;
  const b = body as { kind?: unknown; metric?: unknown; date?: unknown; after?: unknown };
  if (b.kind !== "stats.metric") return false;
  if (typeof b.metric !== "string" || !(STATS_METRICS as readonly string[]).includes(b.metric)) return false;
  if (typeof b.date !== "string" || parseIsoDate(b.date) === null) return false;
  return b.after === undefined || (typeof b.after === "string" && b.after.length > 0 && b.after.length <= 64);
}

/** True for a message that says `kind: "stats.metric"` (a metric this version does not know is acknowledged and logged). */
export const isStatsKind = (body: unknown): boolean =>
  typeof body === "object" && body !== null && (body as { kind?: unknown }).kind === "stats.metric";
