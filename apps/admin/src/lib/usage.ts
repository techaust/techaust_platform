// The dashboard's Free-plan usage tile (M7.5 G, Q4 A; Owner and Accountant, `usage.read`, docs/04 §9 row L40): the words and the pure rules behind it.
// The figures are the API's (`GET /api/v1/dashboard/usage`, apps/admin/worker/dashboard-usage.ts), counted by the jobs Worker's nightly `usage.daily` from
// Cloudflare's analytics. Days are UTC days (Cloudflare's daily limits reset at 00:00 UTC). A day the job couldn't read is absent: a gap, never a zero.
// The limits, the metric names and the 50 % and 80 % lines come from core (`@techaust/core/usage`), the same ones the 09:00 bells use, so the tile and the
// bell never disagree about a crossing. Staff lines: 07-ZS (drafted by the designer, approved by the lead under the owner's delegation; run file H).
import {
  EXCEEDED_METRIC,
  FREE_DAILY_LIMITS,
  USAGE_METRIC_LABELS,
  USAGE_METRICS,
  USAGE_THRESHOLDS,
  USAGE_TILE_DAYS,
  type UsageMetric,
  usageCrossings,
  usageDayOf,
} from "@techaust/core/usage";
import type { UsageDay, UsageTile } from "../api.ts";
import { isoDayText } from "./reports.ts";

export { USAGE_THRESHOLDS };

/** 07-ZS: the tile's staff lines. */
export const USAGE_COPY = {
  /** ZS1 */
  title: "Free plan usage",
  /** ZS2: the newest reading is yesterday's (the usual morning). */
  intro: (day: string) => `Use on ${day} (UTC) against each daily limit, with the last 30 days.`,
  /** ZS3: the newest reading is older than yesterday (the nightly reading stopped, or the token was removed). */
  stale: (day: string) => `No reading since ${day} (UTC). The figures are from that day.`,
  /** ZS4: "{figure} of {limit}". */
  ofLimit: (value: string, limit: string) => `${value} of ${limit}`,
  /** ZS5: a metric the reading missed that day. */
  notRead: "Not read",
  /** ZS6: the share of the limit; a figure above zero that rounds down to 0 says so. */
  share: (pct: number, value: number) => (value > 0 && pct < 1 ? "Under 1 %" : `${pct} %`),
  /** ZS7: the status words beside a share (with the reserved status colours and an icon; never colour alone). */
  reached: { 50: "50 % reached", 80: "80 % reached", limit: "Limit reached" },
  /** ZS8: the marks on each strip. */
  mark: (t: number) => `${t} %`,
  /** ZS9: invocations Cloudflare stopped for CPU time or memory (`exceededResources`), counted with no limit. */
  stopped: "Requests stopped at a Free-plan limit",
  /** ZS10: before the first nightly reading, or while there is no analytics token. */
  empty:
    "No readings yet. Figures arrive each morning once the Cloudflare analytics token is set and the nightly reading has run.",
  /** ZS11: screen readers, while it loads. */
  loading: "Loading Free plan usage",
  /** ZS12: it didn't load. */
  failed: "The usage figures didn't load. Try again in a moment.",
  retry: "Try again",
  /** ZS13: each strip's name (the readout and the table give every day). */
  stripLabel: (metric: string, high: string, day: string, share: string, read: number) =>
    `${metric} over the last 30 days: highest ${high} on ${day} (${share} of the limit); ${read} of 30 days read.`,
  stripNone: (metric: string) => `${metric} over the last 30 days: no day read.`,
  /** ZS14: the readout's line under the day. */
  ofTheLimit: (share: string) => `${share} of the limit`,
  /** ZS15: the table of the 30 days. */
  showTable: "Show the 30 days as a table",
  hideTable: "Hide the table",
  tableCaption: "Free plan usage over the last 30 days, newest first",
  dayColumn: "Day (UTC)",
  stoppedColumn: "Stopped at a limit",
} as const;

export const usageCount = (n: number) => n.toLocaleString("en-IN");

/** The whole percent of the limit, rounded down (79.9 % is 79 %, below the 80 % line, as core's integer check). */
export const sharePct = (value: number, limit: number) => (limit > 0 ? Math.floor((value * 100) / limit) : 0);

export const shareText = (value: number, limit: number) => USAGE_COPY.share(sharePct(value, limit), value);

/** The status of a day's figure: the limit reached, else the highest alert line crossed (core's own check), else none. */
export function levelOf(metric: UsageMetric, value: number): "limit" | 50 | 80 | null {
  if (value >= FREE_DAILY_LIMITS[metric]) return "limit";
  return usageCrossings([{ metric, value }])[0]?.threshold ?? null;
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** One limit's row: yesterday's (or the newest) figure and its 30 days. */
export type UsageRow = {
  metric: UsageMetric;
  label: string;
  limit: number;
  /** The figure on the newest day read; null when that day's reading missed it. */
  latest: number | null;
  points: { date: string; value: number }[];
};

export type UsageView = {
  /** The 30-day window, UTC days: `to` is yesterday. */
  from: string;
  to: string;
  newest: string;
  /** The newest reading is older than yesterday. */
  stale: boolean;
  rows: UsageRow[];
  /** Requests stopped at a limit on the newest day; null when not read. */
  stopped: number | null;
  /** Every day of the window, newest first (the table): a day not read has no values, and says so, as the strip's gap does. */
  days: UsageDay[];
};

/** The tile's model from the API's answer, at `now` (ms). Null before the first reading. */
export function usageView(tile: UsageTile, now: number): UsageView | null {
  if (!tile.newest) return null;
  const to = usageDayOf(now);
  const from = addDays(to, -(USAGE_TILE_DAYS - 1));
  const days = tile.days.filter((d) => d.date >= from && d.date <= to);
  const newestDay = tile.days.find((d) => d.date === tile.newest);
  const value = (d: UsageDay | undefined, m: string) => {
    const v = d?.values[m];
    return typeof v === "number" ? v : null;
  };
  return {
    from,
    to,
    newest: tile.newest,
    stale: tile.newest < to,
    rows: USAGE_METRICS.map((metric) => ({
      metric,
      label: USAGE_METRIC_LABELS[metric],
      limit: tile.limits[metric] ?? FREE_DAILY_LIMITS[metric],
      latest: value(newestDay, metric),
      points: days.flatMap((d) => {
        const v = value(d, metric);
        return v === null ? [] : [{ date: d.date, value: v }];
      }),
    })),
    stopped: value(newestDay, EXCEEDED_METRIC),
    days: Array.from({ length: USAGE_TILE_DAYS }, (_, k) => {
      const date = addDays(to, -k);
      return days.find((d) => d.date === date) ?? { date, values: {} };
    }),
  };
}

/** A UTC day as the admin writes dates ("06 Nov 2026"). */
export const usageDayText = isoDayText;

/** A strip's accessible name: its highest day and how many days were read (the readout and the table carry each day). */
export function stripLabel(row: UsageRow): string {
  const high = row.points.reduce<{ date: string; value: number } | null>(
    (best, p) => (best === null || p.value > best.value ? p : best),
    null,
  );
  if (!high) return USAGE_COPY.stripNone(row.label);
  return USAGE_COPY.stripLabel(
    row.label,
    usageCount(high.value),
    usageDayText(high.date),
    shareText(high.value, row.limit),
    row.points.length,
  );
}
