// The management reports (M7.3; ADM-REP-01, -02, -03, -05, -06; run file docs/runs/m7.3-reports.md B, L1 to L13). Pure rules and the JSON shapes of the report
// routes; every figure is an integer sum made in D1 SQL (`@techaust/db/reports`), so this module does no money arithmetic at all (L1: no rate maths, no
// splitting of payments, no balances at a past date). Each rule that SQL repeats has a twin there, held equal by a db test: `ageingBucketSql`,
// `sourcePathSql`, the care month's period day. Reports and statements are not tax documents (Researched 2026-10-28 (08-C RA-28)); a credit note counts on the
// day it is issued as a management figure, the 3B helper stays the GST view (Researched (08-C RA-04)).
import { addDays, daysBetween, fromIst, parseIsoDate, toIsoDate } from "./dates.ts";
import type { Currency } from "./money.ts";
import { divRoundHalfUp } from "./money.ts";

// ---- ageing (C9, L7) ----------------------------------------------------------------------------------------------------------------------------------

/** The ageing columns, in order (07 copy C12). "d1_30" is 1 to 30 days past due: overdue means strictly before today, as on the dashboard (L7). */
export const AGEING_BUCKETS = ["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

const dateOf = (iso: string, what: string) => {
  const d = parseIsoDate(iso);
  if (!d) throw new RangeError(`${what} is not a date: ${iso}`);
  return d;
};

/**
 * The ageing bucket of an amount due on `dueIso` (the last day to pay; null: no due date) as at `todayIso` (IST): days past due = `today − due`; 0 or less, or no
 * due date, is "not yet due"; then 1–30, 31–60, 61–90 and 91 or more. The SQL twin is `ageingBucketSql` (`@techaust/db/reports`). Throws on a malformed date.
 */
export function ageingBucket(dueIso: string | null, todayIso: string): AgeingBucket {
  const today = dateOf(todayIso, "Today");
  if (dueIso === null) return "not_due";
  const days = daysBetween(dateOf(dueIso, "The due date"), today);
  if (days <= 0) return "not_due";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

// ---- rates ---------------------------------------------------------------------------------------------------------------------------------------------

/**
 * `numerator / denominator` as whole basis points, half up (10,000 = 100 %); null when the denominator is 0, never NaN or Infinity. Both are counts: non-negative
 * safe integers, else a RangeError.
 */
export function rate(numerator: number, denominator: number): number | null {
  for (const n of [numerator, denominator])
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`A rate needs counts: ${n}`);
  if (denominator === 0) return null;
  return Number(divRoundHalfUp(BigInt(numerator) * 10_000n, BigInt(denominator)));
}

// ---- revenue kinds (L9) ---------------------------------------------------------------------------------------------------------------------------------

export const REVENUE_KINDS = ["recurring", "project", "other"] as const;
export type RevenueKind = (typeof REVENUE_KINDS)[number];

/**
 * A document's kind of revenue (L9): a care plan's (its own `care_plan_id`, or for a note or an advance invoice its parent's) is recurring, else a project's, else
 * other. The SQL twin is `revenueKindSql` in `@techaust/db/reports`.
 */
export function revenueKind(d: {
  readonly carePlanId: string | null;
  readonly parentCarePlanId: string | null;
  readonly projectId: string | null;
}): RevenueKind {
  if (d.carePlanId !== null || d.parentCarePlanId !== null) return "recurring";
  if (d.projectId !== null) return "project";
  return "other";
}

// ---- categories (L8) ------------------------------------------------------------------------------------------------------------------------------------

/** A line not from the catalogue (07 copy C10) has this key; the others are the catalogue's categories (`CATALOGUE_CATEGORIES`, today's category, L8). */
export const NO_CATEGORY = "none";

// ---- source paths (C3; DPDP minimisation, RB-31 pattern) ------------------------------------------------------------------------------------------------

/** The longest path the pipeline shows, in characters (code points, as SQLite's `substr` counts them; early check 8). */
export const SOURCE_PATH_MAX = 120;

/**
 * The page a lead came from, cut at the first `?` or `#` (query strings and fragments can carry personal data), then at `SOURCE_PATH_MAX` characters; null stays
 * null. Twin: `sourcePathSql`.
 */
export function sourcePath(page: string | null): string | null {
  if (page === null) return null;
  const q = page.indexOf("?");
  const h = page.indexOf("#");
  const cut = q < 0 ? h : h < 0 ? q : Math.min(q, h);
  const path = cut < 0 ? page : page.slice(0, cut);
  const chars = Array.from(path);
  return chars.length > SOURCE_PATH_MAX ? chars.slice(0, SOURCE_PATH_MAX).join("") : path;
}

// ---- periods ----------------------------------------------------------------------------------------------------------------------------------------------

/** The first and last day of an FY token (`2627` → 2026-04-01 to 2027-03-31); null for a token that is not four digits of consecutive years. */
export function fyBounds(token: string): { from: string; to: string; startYear: number } | null {
  if (!/^\d{4}$/.test(token)) return null;
  const startYear = 2000 + Number(token.slice(0, 2));
  if (Number(token.slice(2)) !== (startYear + 1) % 100) return null;
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31`, startYear };
}

/** The twelve IST months of an FY (`2026-04` to `2027-03`), in order. */
export function fyMonths(startYear: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    out.push(`${m >= 4 ? startYear : startYear + 1}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/** Leads are deleted 12 months after their last activity (Researched 2026-10-28 (08-C RB-10); Q3 A): the pipeline report reaches back this far, and no further. */
export const PIPELINE_MAX_DAYS = 366;

/**
 * The earliest first day a pipeline range may have, as at `todayIso`: the same day a year before (29 February → 1 March, the later day, so the range never
 * reaches back more than 12 months).
 */
export function pipelineEarliest(todayIso: string): string {
  const t = dateOf(todayIso, "Today");
  const back = { year: t.year - 1, month: t.month, day: t.day };
  return t.month === 2 && t.day === 29 ? `${back.year}-03-01` : toIsoDate(back);
}

export type PipelineRange = { from: string; to: string; fromMs: number; toMs: number };
export type PipelineRangeError = "range_invalid" | "range_too_long" | "range_too_old";

/**
 * A pipeline range (C3): `from` to `to` (IST dates, inclusive), at most 366 days, starting no earlier than `pipelineEarliest(today)`. `fromMs` is the first
 * instant of `from` and `toMs` the first instant after `to` (UTC ms), for the lead and decision timestamps.
 */
export function pipelineRange(
  fromIso: string,
  toIso: string,
  todayIso: string,
): PipelineRange | PipelineRangeError {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to || daysBetween(from, to) < 0) return "range_invalid";
  if (daysBetween(from, to) + 1 > PIPELINE_MAX_DAYS) return "range_too_long";
  if (fromIso < pipelineEarliest(todayIso)) return "range_too_old";
  return { from: fromIso, to: toIso, fromMs: fromIst(from), toMs: fromIst(addDays(to, 1)) };
}

/** Time to win (C3): days from the lead (or the offer's first version) to the acceptance, in these bands. */
export const TIME_TO_WIN_BANDS = ["d0_7", "d8_30", "d31_90", "d90_plus"] as const;
export type TimeToWinBand = (typeof TIME_TO_WIN_BANDS)[number];

/** A care-hours month (`YYYY-MM`) and its first and last days; null when malformed. */
export function monthBounds(month: string): { from: string; to: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const from = parseIsoDate(`${month}-01`);
  if (!from) return null;
  const next =
    from.month === 12 ? { year: from.year + 1, month: 1, day: 1 } : { ...from, month: from.month + 1 };
  return { from: toIsoDate(from), to: toIsoDate(addDays(next, -1)) };
}

/**
 * C4 (L13): the first days of the plan's billing periods that START in `month`, in order (each is also a day inside its period, for `currentUsage`):
 * - the billing day of the month, or the plan's start date when the plan began later in the month (its first period starts then);
 * - before it, the plan's start date when the plan began in the month BEFORE its billing day (review 1 finding 2): its first period is the short one from the
 *   start date to the day before the billing day (`planPeriodOf` clamps it), so that month has two periods (e.g. start 3 October, billing day 10: 3 to 9 October,
 *   then 10 October to 9 November).
 * Empty when the plan starts after the month. The SQL twins are `carePeriodFirstDaySql` and `carePeriodDaySql` (db `reports-delivery.ts`, read by
 * `CARE_HOURS_PAGE_SQL`); a db test compares them.
 */
export function carePeriodDays(month: string, billingDay: number, startDate: string): string[] {
  const b = monthBounds(month);
  if (!b) throw new RangeError(`Not a month: ${month}`);
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28)
    throw new RangeError(`Billing day must be 1 to 28: ${billingDay}`);
  const day = `${month}-${String(billingDay).padStart(2, "0")}`;
  const out: string[] = [];
  if (startDate >= b.from && startDate < day) out.push(startDate);
  const at = startDate > day ? startDate : day;
  if (at <= b.to) out.push(at);
  return out;
}

// ---- the dashboard v2 (C5) ------------------------------------------------------------------------------------------------------------------------------

/** The days of the dashboard's open-leads trend, today included (C5 (c)). */
export const LEADS_TREND_DAYS = 30;

/**
 * The IST month before the one `todayIso` is in (C5 (b), the previous-month deltas): its first and last days. The SQL twin is `date(?3, '-1 month')` over the
 * month's first day (`INVOICED_SQL`, `COLLECTED_TILE_SQL`); a db test compares them.
 */
export function previousMonthOf(todayIso: string): { from: string; to: string } {
  const today = parseIsoDate(todayIso);
  if (!today) throw new RangeError(`Not a date: ${todayIso}`);
  const first = { year: today.year, month: today.month, day: 1 };
  const to = addDays(first, -1);
  return { from: toIsoDate({ ...to, day: 1 }), to: toIsoDate(to) };
}

/**
 * Where the dashboard opens each report from (C5 (e)): the reports the role may read, each with the role's period filled in (revenue: this FY's token; the
 * pipeline: this IST month to today; care plan hours: this month; the ageing: as at today, no parameter). An absent key is a report the role can't read.
 */
export type DashboardReportLinks = {
  revenue?: { fy: string };
  ageing?: Record<string, never>;
  pipeline?: { from: string; to: string };
  careHours?: { month: string };
};

// ---- the JSON of the report routes --------------------------------------------------------------------------------------------------------------------

/**
 * Invoiced figures of one currency (C1, C2): tax invoices, export invoices and debit notes add, credit notes subtract, voided documents and proformas never.
 * `count` is documents (lines for a category). The INR equivalents are the frozen INR values (RA-21: the time-of-supply rate on the invoice, never converted
 * again); null when any USD document lacks one (L4). `inrMissing`: how many of the `count` documents (lines for a category) have no INR value, `count` less
 * those with one (review 1 finding 4; 0 for INR, and above 0 exactly when the INR figures are null): the SPA's "{count} USD invoices have no INR value" line.
 */
export type InvoicedFigures = {
  currency: Currency;
  count: number;
  taxableMinor: number;
  totalMinor: number;
  inrTaxableMinor: number | null;
  inrTotalMinor: number | null;
  inrMissing: number;
};

/**
 * Collected figures of one currency (C1, C2; RA-17, RA-36: money counts on the day it was received): confirmed money received, less the refunds that went out
 * (by the day they succeeded), and TDS apart (RA-30). `inrCollectedMinor`: the bank advice's INR amounts (M6.1 L15; management only), null when `inrMissing` USD
 * payments or refunds have none (07 copy C7).
 */
export type CollectedFigures = {
  currency: Currency;
  payments: number;
  receivedMinor: number;
  refundedMinor: number;
  collectedMinor: number;
  tdsMinor: number;
  inrCollectedMinor: number | null;
  inrMissing: number;
};

export type RevenueByMonth = {
  by: "month";
  fy: string;
  from: string;
  to: string;
  months: { month: string; invoiced: InvoicedFigures[]; collected: CollectedFigures[] }[];
};
export type RevenueByKey<K extends string> = {
  by: "category" | "kind";
  fy: string;
  from: string;
  to: string;
  rows: { key: K; invoiced: InvoicedFigures[] }[];
  /** Category only: the documents' round-off per currency, which belongs to no line (Σ line totals + round-off = the invoiced total). */
  roundOff?: { currency: Currency; roundOffMinor: number; inrRoundOffMinor: number | null }[];
};

export type RevenueClientRow = {
  client: { id: string; code: string; name: string };
  invoiced: InvoicedFigures;
  collected: CollectedFigures;
};

export type AgeingRow = {
  client: { id: string; code: string; name: string };
  currency: Currency;
  /** Per bucket, the open balance (tax included) and how many documents. */
  buckets: Record<AgeingBucket, { count: number; balanceMinor: number }>;
  totalMinor: number;
  /** The client's credit held in this currency, shown apart and never netted (C13, RA-36). */
  creditHeldMinor: number;
};

export type PipelineReport = {
  from: string;
  to: string;
  earliest: string;
  leads: {
    created: number;
    byStage: Record<string, number>;
    lostByReason: Record<string, number>;
    bySource: Record<string, number>;
    won: number;
    conversionBp: number | null;
    topPaths: { path: string | null; created: number; won: number }[];
  };
  openTrend: { date: string; open: number }[];
  offers: {
    sent: { status: string; currency: Currency; count: number; taxableMinor: number }[];
    accepted: number;
    rejected: number;
    expired: number;
    winRateBp: number | null;
    timeToWin: { count: number; medianDays: number | null; bands: Record<TimeToWinBand, number> };
  };
};

/** A care invoice as the care-hours report shows it: a draft has no number or issue day; `status` is the document's (`void` when voided). */
export type CareBilled = {
  /** null once the draft was discarded */
  documentId: string | null;
  number: string | null;
  issueDate: string | null;
  /** the document's status (`draft`, `issued`, …), `void` for a voided one, `discarded` for a discarded draft (07 C18b "Draft discarded") */
  status: string | null;
};

export type CareHoursRow = {
  planId: string;
  client: { id: string; code: string; name: string };
  period: { start: string; end: string };
  includedMinutes: number;
  rolloverInMinutes: number;
  availableMinutes: number;
  usedMinutes: number;
  overageMinutes: number;
  burnBp: number | null;
  flag: "none" | "near" | "reached";
  /** The care invoice for this period (its plan fee), and the one that bills this period's overage (07 copy C17 to C19); null: not billed yet. */
  billed: CareBilled | null;
  overageBilled: CareBilled | null;
};
