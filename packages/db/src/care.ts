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

/** Which plans to load: these ids (at most 100), or the first `active` active plans by creation (the dashboard's, one more is read to say "truncated"). */
export type PlanSource = { ids: readonly string[] } | { active: number };

/** The usage window: minutes logged from `from` to `to` (inclusive IST dates) are grouped by period. */
export type UsageWindow = { from: string; to: string };

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
export type UsageRaw = { plan_id: string; ps: string; billable: number; non_billable: number };

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
  return {
    sql: `SELECT id FROM (SELECT id FROM care_plans WHERE status = 'active' ORDER BY created_at, id LIMIT ${n + 1})`,
    bound: 0,
    bind: [],
  };
}

const PLAN_COLS =
  "p.id, p.client_id, c.code AS client_code, c.display_name AS client_name, p.currency, p.start_date, p.billing_day, p.status, p.tier, p.price_minor, p.included_minutes, p.ai_ops_minor, p.overage_rate_minor, p.rollover, p.paused_at, p.cancelled_at, p.created_at, p.updated_at";

export type CareQuery = { sql: string; bind: unknown[] };

/** The four queries, in this order: plans, every terms row, every status row, usage by period (the SQL is exported so a test can EXPLAIN it). */
export function careQueries(
  source: PlanSource,
  window: UsageWindow,
): [CareQuery, CareQuery, CareQuery, CareQuery] {
  const ids = idsSql(source);
  const from = ids.bound + 1;
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
    {
      sql: `SELECT t.care_plan_id AS plan_id, ${periodStartSql("t.work_date", "p.billing_day")} AS ps, sum(CASE WHEN t.billable = 1 THEN t.minutes ELSE 0 END) AS billable, sum(CASE WHEN t.billable = 0 THEN t.minutes ELSE 0 END) AS non_billable FROM time_logs t JOIN care_plans p ON p.id = t.care_plan_id WHERE t.care_plan_id IN (${ids.sql}) AND t.work_date BETWEEN ?${from} AND ?${from + 1} GROUP BY t.care_plan_id, ps`,
      bind: [...ids.bind, window.from, window.to],
    },
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
  for (const r of results.usage)
    out.get(r.plan_id)?.usage.set(r.ps, { billable: r.billable ?? 0, nonBillable: r.non_billable ?? 0 });
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
