// The shared care-plan loader (M3.5): the admin API and the jobs Worker read plans, their terms and status history, and the
// minutes logged, with the SAME four statements, and turn them into `carePeriodUsage` per plan with the SAME pure assembler.
// Subpath export (`@techaust/db/care`): it imports only `@techaust/core/care` (no zod, no Drizzle schema), so the jobs bundle stays
// small. The statements are prepared, never run: the caller puts them in its own `db.batch()`.
//
// Readers of a PAST period use the history rows (`care_plan_terms`, `care_plan_status_log`), never the mirror columns of
// `care_plans`. Free plan: a plan list is capped at 100 (`json_each(?)`, not 100 bound parameters), and every statement is
// served by an index (EXPLAIN is tested).
import {
  type CarePeriodUsage,
  type CareStatus,
  type CareTier,
  carePeriodUsage,
  lastPeriods,
  type PeriodMinutes,
  periodStartSql,
  type RolloverRule,
  type StatusRow,
  type TermsRow,
} from "@techaust/core/care";

export const MAX_LOADED_PLANS = 100;

/**
 * Which plans to load: these ids (at most 100), or the first `active` active plans by creation (the dashboard's; one more is read to say
 * "truncated"). `after` pages the active plans: only those after that plan in `(created_at, id)` order, so the nightly statistics walk
 * every plan in pages of 50 (a continuation message carries the last plan id on). `on` (an IST date) picks the plans that were active
 * ON THAT DATE by their status history instead of today's mirror column, so a plan paused after the date still counts for it.
 */
export type PlanSource = { ids: readonly string[] } | { active: number; after?: string; on?: string };

/**
 * The usage window: the minutes logged up to `to` (an IST date, normally today) and back to the start of the period `periodsBack`
 * periods before the one that contains `to`, per plan (its own billing day decides the start). 1 gives this period and the one before
 * it (whose unused hours may carry in); 13 gives twelve periods and the one before the oldest.
 */
export type UsageWindow = { to: string; periodsBack: number };

export type PlanRaw = {
  id: string;
  client_id: string;
  client_code: string;
  client_name: string;
  currency: string;
  start_date: string;
  billing_day: number;
  status: CareStatus;
  tier: CareTier;
  price_minor: number;
  included_minutes: number;
  ai_ops_minor: number | null;
  overage_rate_minor: number | null;
  rollover: RolloverRule;
  paused_at: number | null;
  cancelled_at: number | null;
  created_at: number;
  updated_at: number;
};
export type TermsRaw = {
  id: string;
  care_plan_id: string;
  effective_from: string;
  created_at: number;
  tier: CareTier;
  price_minor: number;
  included_minutes: number;
  ai_ops_minor: number | null;
  overage_rate_minor: number | null;
  rollover: RolloverRule;
};
export type StatusRaw = {
  id: string;
  care_plan_id: string;
  effective_on: string;
  created_at: number;
  status: CareStatus;
};
/** One period of one plan (the long window groups by period). */
export type UsagePeriodRaw = { plan_id: string; ps: string; billable: number; non_billable: number };
/** The short window (this period and the one before it): one row per plan, the two periods side by side. */
export type UsageRecentRaw = {
  plan_id: string;
  cur_start: string;
  cur_billable: number;
  cur_non_billable: number;
  prev_start: string;
  prev_billable: number;
  prev_non_billable: number;
};
export type UsageRaw = UsagePeriodRaw | UsageRecentRaw;

/** The id list of a source as SQL, and how many placeholders it uses (`?1` is the id list in `ids` mode). */
function idsSql(source: PlanSource): { sql: string; bound: number; bind: unknown[] } {
  if ("ids" in source) {
    if (source.ids.length > MAX_LOADED_PLANS)
      throw new RangeError(`At most ${MAX_LOADED_PLANS} plans at a time`);
    return { sql: "SELECT value FROM json_each(?1)", bound: 1, bind: [JSON.stringify(source.ids)] };
  }
  const n = Math.trunc(source.active);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LOADED_PLANS)
    throw new RangeError(`Active plans: 1 to ${MAX_LOADED_PLANS}`);
  // The keyset continues on `care_plans_status_created (status, created_at, id)`: the row-value comparison against the previous
  // plan's own `(created_at, id)` is a range on that index. A plan id that is gone gives NULL, which matches nothing (an empty page).
  // With `on` (the status in force on a date) no status column filters: the walk is on `care_plans_created (created_at, id)`, every
  // plan (cancelled ones too) costs one search on `care_plan_status_log_plan`, and the page size bounds it.
  const after = source.after;
  const keyset =
    after === undefined
      ? ""
      : " AND (created_at, id) > (SELECT created_at, id FROM care_plans WHERE id = ?1)";
  if (source.on !== undefined) {
    const d = after === undefined ? "?1" : "?2";
    return {
      sql: `SELECT id FROM (SELECT id FROM care_plans WHERE (SELECT status FROM care_plan_status_log WHERE care_plan_id = care_plans.id AND effective_on <= ${d} ORDER BY effective_on DESC, created_at DESC, id DESC LIMIT 1) = 'active'${keyset} ORDER BY created_at, id LIMIT ${n + 1})`,
      bound: after === undefined ? 1 : 2,
      bind: after === undefined ? [source.on] : [after, source.on],
    };
  }
  return {
    sql: `SELECT id FROM (SELECT id FROM care_plans WHERE status = 'active'${keyset} ORDER BY created_at, id LIMIT ${n + 1})`,
    bound: after === undefined ? 0 : 1,
    bind: after === undefined ? [] : [after],
  };
}

const PLAN_COLS =
  "p.id, p.client_id, c.code AS client_code, c.display_name AS client_name, p.currency, p.start_date, p.billing_day, p.status, p.tier, p.price_minor, p.included_minutes, p.ai_ops_minor, p.overage_rate_minor, p.rollover, p.paused_at, p.cancelled_at, p.created_at, p.updated_at";

export type CareQuery = { sql: string; bind: unknown[] };

/**
 * Minutes per plan and period. The short window (`periodsBack` 1: the lists and the dashboard) sums this period and the one before it
 * in ONE row per plan with a conditional sum, grouped by the plan: the (care_plan_id, work_date, billable, minutes) index is read in its
 * own order, with no sort. A plan that never had a one-month rollover rule carries nothing in, so only its current period is read (its
 * previous period shows as zero, which is what it carries). `CROSS JOIN` fixes the join order (plans first), which the per-plan lower bound of the window needs. The long window (the plan page) groups by period, `periodStartSql` (a sort of a few hundred entries).
 */
function usageSql(ids: string, at: number, periodsBack: number): string {
  const to = `?${at}`;
  if (periodsBack === 1) {
    const cur = periodStartSql(to, "p.billing_day");
    const prev = `date(${cur}, '-1 months')`;
    const sum = (flag: number, from: string, until: string) =>
      `sum(CASE WHEN t.billable = ${flag} AND t.work_date >= ${from}${until} THEN t.minutes ELSE 0 END)`;
    return `SELECT t.care_plan_id AS plan_id, ${cur} AS cur_start, ${sum(1, cur, "")} AS cur_billable, ${sum(0, cur, "")} AS cur_non_billable, ${prev} AS prev_start, ${sum(1, prev, ` AND t.work_date < ${cur}`)} AS prev_billable, ${sum(0, prev, ` AND t.work_date < ${cur}`)} AS prev_non_billable FROM care_plans p CROSS JOIN time_logs t ON t.care_plan_id = p.id WHERE p.id IN (${ids}) AND t.work_date >= CASE WHEN EXISTS (SELECT 1 FROM care_plan_terms r WHERE r.care_plan_id = p.id AND r.rollover = 'one_month') THEN ${prev} ELSE ${cur} END AND t.work_date <= ${to} GROUP BY t.care_plan_id`;
  }
  return `SELECT t.care_plan_id AS plan_id, ${periodStartSql("t.work_date", "p.billing_day")} AS ps, sum(CASE WHEN t.billable = 1 THEN t.minutes ELSE 0 END) AS billable, sum(CASE WHEN t.billable = 0 THEN t.minutes ELSE 0 END) AS non_billable FROM care_plans p CROSS JOIN time_logs t ON t.care_plan_id = p.id WHERE p.id IN (${ids}) AND t.work_date >= date(${periodStartSql(to, "p.billing_day")}, '-' || ${periodsBack} || ' months') AND t.work_date <= ${to} GROUP BY t.care_plan_id, ps`;
}

/** The four queries, in this order: plans, every terms row, every status row, usage by period (the SQL is exported so a test can EXPLAIN it). */
export function careQueries(
  source: PlanSource,
  window: UsageWindow,
): [CareQuery, CareQuery, CareQuery, CareQuery] {
  const ids = idsSql(source);
  const at = ids.bound + 1;
  if (!Number.isInteger(window.periodsBack) || window.periodsBack < 0 || window.periodsBack > 24)
    throw new RangeError(`Periods back: 0 to 24`);
  return [
    {
      sql: `SELECT ${PLAN_COLS} FROM care_plans p JOIN clients c ON c.id = p.client_id WHERE p.id IN (${ids.sql}) ORDER BY p.created_at, p.id`,
      bind: ids.bind,
    },
    {
      sql: `SELECT id, care_plan_id, effective_from, created_at, tier, price_minor, included_minutes, ai_ops_minor, overage_rate_minor, rollover FROM care_plan_terms WHERE care_plan_id IN (${ids.sql}) ORDER BY care_plan_id, effective_from, created_at, id`,
      bind: ids.bind,
    },
    {
      sql: `SELECT id, care_plan_id, effective_on, created_at, status FROM care_plan_status_log WHERE care_plan_id IN (${ids.sql}) ORDER BY care_plan_id, effective_on, created_at, id`,
      bind: ids.bind,
    },
    { sql: usageSql(ids.sql, at, window.periodsBack), bind: [...ids.bind, window.to] },
  ];
}

/** The four prepared statements of `careQueries`, ready for the caller's own `db.batch()`. */
export function careStatements(
  db: D1Database,
  source: PlanSource,
  window: UsageWindow,
): [D1PreparedStatement, D1PreparedStatement, D1PreparedStatement, D1PreparedStatement] {
  const [a, b, c, d] = careQueries(source, window).map((q) => db.prepare(q.sql).bind(...q.bind)) as [
    D1PreparedStatement,
    D1PreparedStatement,
    D1PreparedStatement,
    D1PreparedStatement,
  ];
  return [a, b, c, d];
}

/** A plan with its history and its usage by period (keyed by the natural period start). */
export type CarePlanData = {
  plan: PlanRaw;
  terms: TermsRow[];
  statuses: StatusRow[];
  usage: Map<string, PeriodMinutes>;
};

const termsRow = (r: TermsRaw): TermsRow => ({
  id: r.id,
  effectiveFrom: r.effective_from,
  createdAt: r.created_at,
  tier: r.tier,
  priceMinor: r.price_minor,
  includedMinutes: r.included_minutes,
  aiOpsMinor: r.ai_ops_minor,
  overageRateMinor: r.overage_rate_minor,
  rollover: r.rollover,
});
const statusRow = (r: StatusRaw): StatusRow => ({
  id: r.id,
  effectiveOn: r.effective_on,
  createdAt: r.created_at,
  status: r.status,
});

/**
 * The four results as plans keyed by id, in the order read. At most `cap` plans are kept; `truncated` says more were read (the
 * `active` source reads one more than it keeps for exactly this).
 */
export function assembleCare(
  results: {
    plans: readonly PlanRaw[];
    terms: readonly TermsRaw[];
    status: readonly StatusRaw[];
    usage: readonly UsageRaw[];
  },
  cap: number = MAX_LOADED_PLANS,
): { plans: Map<string, CarePlanData>; truncated: boolean } {
  const out = new Map<string, CarePlanData>();
  for (const plan of results.plans.slice(0, cap))
    out.set(plan.id, { plan, terms: [], statuses: [], usage: new Map() });
  for (const r of results.terms) out.get(r.care_plan_id)?.terms.push(termsRow(r));
  for (const r of results.status) out.get(r.care_plan_id)?.statuses.push(statusRow(r));
  for (const r of results.usage) {
    const usage = out.get(r.plan_id)?.usage;
    if (!usage) continue;
    if ("ps" in r) usage.set(r.ps, { billable: r.billable ?? 0, nonBillable: r.non_billable ?? 0 });
    else {
      usage.set(r.cur_start, { billable: r.cur_billable ?? 0, nonBillable: r.cur_non_billable ?? 0 });
      usage.set(r.prev_start, { billable: r.prev_billable ?? 0, nonBillable: r.prev_non_billable ?? 0 });
    }
  }
  return { plans: out, truncated: results.plans.length > cap };
}

const input = (d: CarePlanData, date: string) => ({
  plan: { billingDay: d.plan.billing_day, startDate: d.plan.start_date },
  terms: d.terms,
  statuses: d.statuses,
  usage: d.usage,
  date,
});

/** The plan's current period (null before it starts). */
export const currentUsage = (d: CarePlanData, today: string): CarePeriodUsage | null =>
  carePeriodUsage(input(d, today));

/** The plan's last `n` periods (at most 12), newest first. */
export function pastUsage(d: CarePlanData, today: string, n: number): CarePeriodUsage[] {
  const out: CarePeriodUsage[] = [];
  for (const p of lastPeriods(today, { billingDay: d.plan.billing_day, startDate: d.plan.start_date }, n)) {
    const u = carePeriodUsage(input(d, p.start));
    if (u) out.push(u);
  }
  return out;
}
