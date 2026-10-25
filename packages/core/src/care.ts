// Care plans: billing periods, the history lookups, hours used against hours included, and the overage amount
// [ADM-CARE-01, ADM-CARE-03; ADM-CARE-02 reads this in M5.4]. Pure: no I/O, no floats (money and ratios are integers and bigint).
//
// Owner's answers 2026-10-25 (docs/13), all encoded here:
//   - hours count over the BILLING PERIOD: from the billing day to the day before the next one;
//   - Q1: a price or hours change takes effect from the NEXT billing period (`termsEffectiveFrom`);
//   - Q2: only BILLABLE time uses the included hours; non-billable time is shown beside it;
//   - Q3: this period's hours are used first; only the PREVIOUS period's own unused hours carry over, and they never compound;
//   - Q4: the first, partial period gets the FULL monthly hours;
//   - Q5: a plan paused on its billing day gets NO hours that period (and no carried hours either); time logged after a
//     resume in that period is all overage.
// Readers of a past period use the history (`care_plan_terms`, `care_plan_status_log`), never the mirror columns of `care_plans`.
// VERIFY WITH CA/LEGAL: GST on the overage is M5.4's; the amounts here are before GST.
import { addDays, type CalendarDate, parseIsoDate, toIsoDate } from "./dates.ts";
import { divRoundHalfUp } from "./money.ts";

export const CARE_TIERS = ["essential", "growth", "scale", "dev_subscription", "custom"] as const;
export const CARE_STATUSES = ["active", "paused", "cancelled"] as const;
export const ROLLOVER_RULES = ["none", "one_month"] as const;
export type CareTier = (typeof CARE_TIERS)[number];
export type CareStatus = (typeof CARE_STATUSES)[number];
export type RolloverRule = (typeof ROLLOVER_RULES)[number];

/** Flag levels, in basis points of the hours available (ADM-CARE-03: 80 % and 100 %). */
export const CARE_NEAR_BP = 8_000;
export const CARE_REACHED_BP = 10_000;
/** Included hours are set in 15-minute steps, so the overage quantity of M5.4 is exact. */
export const CARE_STEP_MINUTES = 15;
export const MAX_BILLING_DAY = 28;
/** The highest overage rate a plan can carry, in minor units per hour (10 million rupees or dollars: a typing slip, not a rate). */
export const MAX_OVERAGE_RATE_MINOR = 1_000_000_000;

/** Active → paused or cancelled; paused → active or cancelled; cancelled is terminal. */
export const CARE_TRANSITIONS: Readonly<Record<CareStatus, readonly CareStatus[]>> = {
  active: ["paused", "cancelled"],
  paused: ["active", "cancelled"],
  cancelled: [],
};
export const canMoveCare = (from: CareStatus, to: CareStatus) => CARE_TRANSITIONS[from].includes(to);
/** The statuses a plan can be moved to `to` from (the API writes this as a SQL condition). */
export const careSourcesOf = (to: CareStatus): CareStatus[] =>
  CARE_STATUSES.filter((from) => canMoveCare(from, to));

// ---- periods -----------------------------------------------------------------------------------------------------------

/** A billing period: ISO dates, both ends inclusive. */
export type Period = { readonly start: string; readonly end: string };
export type PlanDates = { readonly billingDay: number; readonly startDate: string };

const assertBillingDay = (day: number) => {
  if (!Number.isInteger(day) || day < 1 || day > MAX_BILLING_DAY)
    throw new RangeError(`Billing day must be 1 to ${MAX_BILLING_DAY}: ${day}`);
};
const parse = (date: string): CalendarDate => {
  const d = parseIsoDate(date);
  if (!d) throw new RangeError(`Not a date: ${date}`);
  return d;
};
const shiftMonth = ({ year, month }: CalendarDate, by: number): { year: number; month: number } => {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.trunc(index / 12), month: (index % 12) + 1 };
};
const dateIn = (ym: { year: number; month: number }, day: number): CalendarDate => ({ ...ym, day });

/** The period that contains `date`: from the latest billing day on or before it to the day before the next. */
export function periodOf(date: string, billingDay: number): Period {
  assertBillingDay(billingDay);
  const d = parse(date);
  const startMonth = d.day >= billingDay ? shiftMonth(d, 0) : shiftMonth(d, -1);
  const start = dateIn(startMonth, billingDay);
  const next = dateIn(shiftMonth(start, 1), billingDay);
  return { start: toIsoDate(start), end: toIsoDate(addDays(next, -1)) };
}

/** The plan's period that contains `date`: the first one starts on the start date; null before the plan starts. */
export function planPeriodOf(date: string, plan: PlanDates): Period | null {
  if (date < plan.startDate) return null;
  const p = periodOf(date, plan.billingDay);
  return p.start < plan.startDate ? { start: plan.startDate, end: p.end } : p;
}

/**
 * The period before `period` (by billing day; it may fall before the plan started: use `planPeriodOf` to find out). It is taken
 * from the natural start, so the clamped first period of a plan has the month before it as its previous one, not itself.
 */
export const previousPeriod = (period: Period, billingDay: number): Period =>
  periodOf(toIsoDate(addDays(parse(periodOf(period.start, billingDay).start), -1)), billingDay);

/** The first day of the period after the one that contains `today`. */
export const nextPeriodStart = (today: string, billingDay: number): string =>
  toIsoDate(addDays(parse(periodOf(today, billingDay).end), 1));

/** The plan's most recent periods, newest first, the one that contains `today` included; at most 12, none before the start. */
export function lastPeriods(today: string, plan: PlanDates, n: number): Period[] {
  if (!Number.isInteger(n) || n < 1 || n > 12) throw new RangeError(`Periods must be 1 to 12: ${n}`);
  const out: Period[] = [];
  let p = planPeriodOf(today, plan);
  while (p && out.length < n) {
    out.push(p);
    p = planPeriodOf(toIsoDate(addDays(parse(p.start), -1)), plan);
  }
  return out;
}

/**
 * The same rule as `periodOf`, as SQLite: the start of the period that contains the date `dateExpr`, for the billing day
 * `dayExpr` (both are SQL expressions: a column, or a bound `?n`). The TypeScript twin is `periodOf(...).start`, and a database
 * test proves they agree for billing days 1 to 28 on every date of four years. For a plan's first period the natural start is
 * returned (before the plan's start date): reports key their rows by it and `usageKey` finds them again.
 */
export const periodStartSql = (dateExpr: string, dayExpr: string): string =>
  `CASE WHEN CAST(strftime('%d', ${dateExpr}) AS INTEGER) >= ${dayExpr} THEN date(${dateExpr}, 'start of month', '+' || (${dayExpr} - 1) || ' days') ELSE date(${dateExpr}, 'start of month', '-1 month', '+' || (${dayExpr} - 1) || ' days') END`;

/** The key a period's usage is stored under: the natural (unclamped) start, which is what `periodStartSql` returns. */
export const usageKey = (period: Period, billingDay: number): string =>
  periodOf(period.start, billingDay).start;

// ---- history -----------------------------------------------------------------------------------------------------------

export type TermsRow = {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly createdAt: number;
  readonly tier: CareTier;
  readonly priceMinor: number;
  readonly includedMinutes: number;
  readonly aiOpsMinor: number | null;
  readonly overageRateMinor: number | null;
  readonly rollover: RolloverRule;
};
export type StatusRow = {
  readonly id: string;
  readonly effectiveOn: string;
  readonly createdAt: number;
  readonly status: CareStatus;
};

const newer = (a: { createdAt: number; id: string }, b: { createdAt: number; id: string }) =>
  a.createdAt !== b.createdAt ? a.createdAt > b.createdAt : a.id > b.id;

/** The terms row in force on `date`: the newest with `effectiveFrom ≤ date`; ties go to the later `createdAt`, then the larger id. */
export function termsOn(terms: readonly TermsRow[], date: string): TermsRow | undefined {
  let best: TermsRow | undefined;
  for (const t of terms) {
    if (t.effectiveFrom > date) continue;
    if (
      !best ||
      t.effectiveFrom > best.effectiveFrom ||
      (t.effectiveFrom === best.effectiveFrom && newer(t, best))
    )
      best = t;
  }
  return best;
}

/** The status row in force on `date`, with the same ordering. */
export function statusOn(log: readonly StatusRow[], date: string): StatusRow | undefined {
  let best: StatusRow | undefined;
  for (const s of log) {
    if (s.effectiveOn > date) continue;
    if (!best || s.effectiveOn > best.effectiveOn || (s.effectiveOn === best.effectiveOn && newer(s, best)))
      best = s;
  }
  return best;
}

/** The plan gives hours in a period only when it was active on the period's first day (Q5). */
export const hasAllowance = (log: readonly StatusRow[], period: Period): boolean =>
  statusOn(log, period.start)?.status === "active";

// ---- usage and overage -------------------------------------------------------------------------------------------------

/** Minutes logged in one period (from `time_logs`, grouped by `periodStartSql`). */
export type PeriodMinutes = { readonly billable: number; readonly nonBillable: number };
export type UsageMap = ReadonlyMap<string, PeriodMinutes>;

export type CareUsageInput = {
  readonly plan: PlanDates;
  readonly terms: readonly TermsRow[];
  readonly statuses: readonly StatusRow[];
  /** Keyed by `usageKey(period)` (the natural period start). A missing key means no time. */
  readonly usage: UsageMap;
  /** Any date inside the period wanted. */
  readonly date: string;
};

export type CareFlag = "none" | "near" | "reached";
export type CarePeriodUsage = {
  period: Period;
  included: number;
  rolloverIn: number;
  available: number;
  used: number;
  nonBillable: number;
  remaining: number;
  overageMinutes: number;
  /** Minor units, before GST. Null when there is overage and the plan has no rate. */
  overageMinor: number | null;
  rateMissing: boolean;
  rateMinor: number | null;
  /** Basis points of the hours available that were used (floor); null when there are none. */
  burnBp: number | null;
  flag: CareFlag;
};

const minutesOf = (usage: UsageMap, period: Period, billingDay: number): PeriodMinutes =>
  usage.get(usageKey(period, billingDay)) ?? { billable: 0, nonBillable: 0 };

const includedOf = (input: CareUsageInput, period: Period): number =>
  hasAllowance(input.statuses, period) ? (termsOn(input.terms, period.start)?.includedMinutes ?? 0) : 0;

/**
 * The amount for `minutes` at `rateMinor` per hour, half up to the minor unit. Throws (RangeError) when the result is not a safe integer,
 * rather than returning a rounded wrong number; the rate is capped at `MAX_OVERAGE_RATE_MINOR` where it is entered.
 */
export const overageAmount = (minutes: number, rateMinor: number): number => {
  const amount = divRoundHalfUp(BigInt(minutes) * BigInt(rateMinor), 60n);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER))
    throw new RangeError(
      `The overage amount is not a safe integer: ${minutes} minutes at ${rateMinor} an hour`,
    );
  return Number(amount);
};

/**
 * Hours used against hours included for the plan's period that contains `date`; null before the plan starts.
 * `rolloverIn` is the previous period's own unused hours (never its carried ones), and only when that period was a plan period
 * with allowance and one-month rollover, and this period has allowance too.
 */
export function carePeriodUsage(input: CareUsageInput): CarePeriodUsage | null {
  const { plan } = input;
  const period = planPeriodOf(input.date, plan);
  if (!period) return null;
  const terms = termsOn(input.terms, period.start);
  const included = includedOf(input, period);

  let rolloverIn = 0;
  const before = previousPeriod(period, plan.billingDay);
  if (hasAllowance(input.statuses, period) && planPeriodOf(before.end, plan)) {
    const prev = planPeriodOf(before.end, plan) as Period; // checked just above
    if (hasAllowance(input.statuses, prev) && termsOn(input.terms, prev.start)?.rollover === "one_month") {
      const left = includedOf(input, prev) - minutesOf(input.usage, prev, plan.billingDay).billable;
      rolloverIn = left > 0 ? left : 0;
    }
  }

  const { billable: used, nonBillable } = minutesOf(input.usage, period, plan.billingDay);
  const available = included + rolloverIn;
  const overageMinutes = used > available ? used - available : 0;
  const rateMinor = terms?.overageRateMinor ?? null;
  const rateMissing = overageMinutes > 0 && rateMinor === null;
  const burnBp = available > 0 ? Number((BigInt(used) * 10_000n) / BigInt(available)) : null;
  let flag: CareFlag = "none";
  // Overage means the hours are used up, whatever was available (including none: all billable time is then overage).
  if (overageMinutes > 0) flag = "reached";
  else if (available > 0) {
    if (BigInt(used) * 10_000n >= BigInt(CARE_REACHED_BP) * BigInt(available)) flag = "reached";
    else if (BigInt(used) * 10_000n >= BigInt(CARE_NEAR_BP) * BigInt(available)) flag = "near";
  }
  return {
    period,
    included,
    rolloverIn,
    available,
    used,
    nonBillable,
    remaining: available > used ? available - used : 0,
    overageMinutes,
    overageMinor:
      overageMinutes === 0 ? 0 : rateMinor === null ? null : overageAmount(overageMinutes, rateMinor),
    rateMissing,
    rateMinor,
    burnBp,
    flag,
  };
}

/**
 * The invoice quantity (milli-units of an hour) for overage minutes: M5.4 bills hours. Only 15-minute steps are exact, so
 * anything else throws. With the tax engine's half-up `quantity × rate`, the line amount equals `overageAmount` exactly.
 */
export function overageQuantityMilli(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes % CARE_STEP_MINUTES !== 0)
    throw new RangeError(`Overage minutes must be a multiple of ${CARE_STEP_MINUTES}: ${minutes}`);
  return Math.trunc(minutes / CARE_STEP_MINUTES) * 250;
}

// ---- when a change takes effect ----------------------------------------------------------------------------------------

/** New terms: from the start date if the plan has not started, else from the next billing period (Q1). */
export const termsEffectiveFrom = (today: string, plan: PlanDates): string =>
  today < plan.startDate ? plan.startDate : nextPeriodStart(today, plan.billingDay);

/** A status change takes effect today (IST), or on the start date if that is later. */
export const statusEffectiveOn = (today: string, plan: PlanDates): string =>
  today < plan.startDate ? plan.startDate : today;

// ---- a care plan from an accepted estimate (M4.3 item 8; ADM-EST-02) ------------------------------------------------------

/** The catalogue services a care plan is made from: S16 Care Plans (three tiers as default lines), S17 AI Ops, S18 Dev Subscription. */
export const CARE_SERVICE_CODES = { care: "S16", aiOps: "S17", dev: "S18" } as const;
/** The S16 default lines (their names in the catalogue, lower case) and the tier each one is. */
const CARE_LINE_TIERS: ReadonlyMap<string, CareTier> = new Map([
  ["essential", "essential"],
  ["growth", "growth"],
  ["scale", "scale"],
]);

/** One line of an estimate as far as the mapping needs it. `catalogueLine` is the server-set key, never the editable description. */
export type EstimateCareLine = {
  /** The catalogue code of the line's service (S1 to S18), or null for a custom line. */
  readonly code: string | null;
  /** The name of the catalogue default line the line was made from (set by the server), or null. */
  readonly catalogueLine: string | null;
  readonly qtyMilli: number;
  readonly unit: string;
  /** The line's taxable amount: after its own discount and its share of the document discount. */
  readonly taxableMinor: number;
};
export type CareFromEstimate = {
  readonly tier: CareTier;
  /** The care line's taxable amount: the plan's monthly price. */
  readonly priceMinor: number;
  /** The AI Ops line's taxable amount, or null when the estimate has none. */
  readonly aiOpsMinor: number | null;
};

/**
 * What care plan an estimate describes, or null when it describes none (the API answers 409 `not_a_care_estimate`):
 * exactly one care line (an S16 line made from the Essential, Growth or Scale default line, or an S18 line) and at most one S17 line,
 * each for exactly one month. Anything else (a custom line, a second care line, another service, a different quantity or unit, an
 * S16 line with no default line behind it) is not a care estimate. The tier comes from the key the server set when it made the
 * line, never from the description, which anyone can edit.
 */
export function careFromEstimate(lines: readonly EstimateCareLine[]): CareFromEstimate | null {
  let care: { tier: CareTier; priceMinor: number } | null = null;
  let aiOps: number | null = null;
  for (const l of lines) {
    if (
      l.unit !== "month" ||
      l.qtyMilli !== 1000 ||
      !Number.isSafeInteger(l.taxableMinor) ||
      l.taxableMinor < 0
    )
      return null;
    if (l.code === CARE_SERVICE_CODES.aiOps) {
      if (aiOps !== null) return null;
      aiOps = l.taxableMinor;
    } else if (l.code === CARE_SERVICE_CODES.care || l.code === CARE_SERVICE_CODES.dev) {
      if (care !== null) return null;
      const tier: CareTier | undefined =
        l.code === CARE_SERVICE_CODES.dev
          ? "dev_subscription"
          : l.catalogueLine === null
            ? undefined
            : CARE_LINE_TIERS.get(l.catalogueLine.trim().toLowerCase());
      if (tier === undefined) return null;
      care = { tier, priceMinor: l.taxableMinor };
    } else return null;
  }
  return care === null ? null : { ...care, aiOpsMinor: aiOps };
}
