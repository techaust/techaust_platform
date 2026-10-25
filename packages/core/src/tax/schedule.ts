// Payment schedules [ADM-PROP-03, Q-P3-6, docs/05 §10]: a document total split into instalments that add up exactly.
// VERIFY WITH CA/LEGAL: instalments are whole rupees for INR when the settings round the total, so a part-payment can
// become a tax invoice for exactly that amount; the last instalment takes the remainder.
//  - percent steps: each instalment but the last is `total × share` floored to the unit, the last is the rest;
//  - amount steps: every instalment but the last is typed (a multiple of the unit), the last is the rest, and the
//    percentages shown are cumulative roundings that always add up to 100 %.
import { type Currency, divRoundHalfUp, isCurrency } from "../money.ts";
import { SCHEDULE_TRIGGERS } from "../schedule-text.ts";
import { roundingUnit } from "./totals.ts";
import {
  BP,
  fail,
  floorDiv,
  guard,
  isInt,
  isIntBetween,
  issue,
  num,
  ok,
  type ScheduleInstalment,
  type ScheduleStep,
  type TaxContext,
  type TaxIssue,
  type TaxResult,
  type TaxWarning,
  warn,
} from "./types.ts";

export const MAX_SCHEDULE_STEPS = 24;
const LABEL_MAX = 200;
const TRIGGERS: readonly string[] = SCHEDULE_TRIGGERS;

/** A step as it may arrive: either kind of field can be present, and `schedule_mixed_kinds` says which is wrong. */
type LooseStep = { label: string; trigger: string; pctBp?: number; amountMinor?: number };

/** Percent steps: all but the last are floored to the unit, the last takes the remainder. */
function percentInstalments(total: bigint, unit: bigint, bps: readonly number[]): bigint[] {
  const parts = bps.slice(0, -1).map((bp) => floorDiv(total * BigInt(bp), BP * unit) * unit);
  return [...parts, total - parts.reduce((a, p) => a + p, 0n)];
}

/** The percentages to show for typed amounts: cumulative roundings, so they add up to exactly 100 %. */
function shownPercents(total: bigint, amounts: readonly bigint[]): number[] {
  let running = 0n;
  let before = 0n;
  return amounts.map((a) => {
    running += a;
    const cumulative = total === 0n ? 0n : divRoundHalfUp(running * BP, total);
    const share = cumulative - before;
    before = cumulative;
    return num(share);
  });
}

/**
 * Splits a document total into the steps of a payment schedule. Steps are all percentages (`pctBp`, adding up to 10,000)
 * or all amounts (every step but the last has an `amountMinor`; the last is the remainder). Returns
 * `{ label, trigger, pctBp, amountMinor }[]`, the `payment_schedules` columns.
 */
export function computeSchedule(
  totalMinor: number,
  currency: Currency,
  steps: readonly ScheduleStep[],
  ctx: TaxContext,
): TaxResult<ScheduleInstalment[]> {
  return guard(() => {
    if (steps.length === 0) return fail([issue("schedule_empty", "steps")]);
    if (steps.length > MAX_SCHEDULE_STEPS) return fail([issue("schedule_too_many", "steps")]);
    const errors: TaxIssue[] = [];
    if (!isInt(totalMinor) || totalMinor < 0) errors.push(issue("total_invalid", "totalMinor"));
    if (!isCurrency(currency)) errors.push(issue("currency_invalid", "currency"));
    const loose = steps as readonly LooseStep[];
    const percents = loose.filter((s) => "pctBp" in s).length;
    if (percents !== 0 && percents !== loose.length) errors.push(issue("schedule_mixed_kinds", "steps"));
    const percentKind = percents === loose.length;
    const last = loose.length - 1;
    loose.forEach((s, i) => {
      const label = s.label.trim();
      const badAmount = !percentKind && i < last && !(isInt(s.amountMinor) && s.amountMinor >= 0);
      const badPercent = percentKind && !isIntBetween(s.pctBp, 0, 10000);
      if (
        label.length < 1 ||
        label.length > LABEL_MAX ||
        !TRIGGERS.includes(s.trigger) ||
        badAmount ||
        badPercent
      ) {
        errors.push(issue("schedule_step_invalid", "steps", i));
      }
    });
    if (errors.length > 0) return fail(errors);

    const total = BigInt(totalMinor);
    const unit = roundingUnit(currency, ctx);
    let amounts: bigint[];
    let pcts: number[];
    if (percentKind) {
      const bps = loose.map((s) => s.pctBp as number);
      if (bps.reduce((a, b) => a + b, 0) !== 10000) return fail([issue("schedule_pct_sum", "steps")]);
      amounts = percentInstalments(total, unit, bps);
      pcts = bps;
    } else {
      const typed = loose.slice(0, -1).map((s) => BigInt(s.amountMinor as number));
      typed.forEach((a, i) => {
        if (a % unit !== 0n) errors.push(issue("schedule_amount_not_whole_unit", "steps", i, "amountMinor"));
      });
      const typedSum = typed.reduce((a, b) => a + b, 0n);
      if (typedSum > total) errors.push(issue("schedule_exceeds_total", "steps"));
      if (errors.length > 0) return fail(errors);
      amounts = [...typed, total - typedSum];
      pcts = shownPercents(total, amounts);
    }

    const warnings: TaxWarning[] = [];
    const instalments = loose.map((s, i) => {
      if (amounts[i] === 0n) warnings.push(warn("schedule_zero_instalment", "steps", i));
      return {
        label: s.label,
        trigger: s.trigger as ScheduleInstalment["trigger"],
        pctBp: pcts[i] as number,
        amountMinor: num(amounts[i] as bigint),
      };
    });
    return ok(instalments, warnings);
  });
}
