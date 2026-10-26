// Return periods and calendar-month arithmetic (M5.5a; ADM-REP-04). Integer maths only, IST calendar dates, no Date
// object (so no time zone and no `Date.now()`). VERIFY WITH CA/LEGAL: a quarter is the QRMP quarter of the financial year.
import type { CalendarDate } from "../dates.ts";
import { compareDates, fail, type GstPeriod, type GstResult, isIntBetween, issue, ok } from "./types.ts";

export type PeriodRange = { readonly from: CalendarDate; readonly to: CalendarDate };

const isLeap = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** The last day (28 to 31) of a month; `month` is 1 to 12. */
export function lastDayOfMonth(year: number, month: number): number {
  if (!isIntBetween(year, 1, 9999) || !isIntBetween(month, 1, 12)) {
    throw new RangeError(`Invalid month: ${year}-${month}`);
  }
  return month === 2 && isLeap(year) ? 29 : (DAYS[month - 1] as number);
}

/**
 * `date` plus whole months, with the day clamped to the end of the target month (31 May + 9 months = 28 or 29 February;
 * 29 February + 12 months = 28 February). VERIFY WITH CA/LEGAL for the "last allowed day" reading of the due dates.
 */
export function addMonthsClamped(date: CalendarDate, months: number): CalendarDate {
  if (!Number.isSafeInteger(months)) throw new RangeError(`Months must be an integer: ${months}`);
  const total = date.month - 1 + months;
  let years = Math.trunc(total / 12);
  let month = total % 12;
  if (month < 0) {
    month += 12;
    years -= 1;
  }
  const year = date.year + years;
  return { year, month: month + 1, day: Math.min(date.day, lastDayOfMonth(year, month + 1)) };
}

/** The first and last day of a return period. A bad month, quarter or year is `period_invalid`. */
export function gstPeriod(period: GstPeriod): GstResult<PeriodRange> {
  if (period.kind === "month") {
    if (!isIntBetween(period.year, 1, 9999) || !isIntBetween(period.month, 1, 12)) {
      return fail([issue("period_invalid", "period")]);
    }
    return ok({
      from: { year: period.year, month: period.month, day: 1 },
      to: { year: period.year, month: period.month, day: lastDayOfMonth(period.year, period.month) },
    });
  }
  if (
    period.kind === "quarter" &&
    isIntBetween(period.fyStartYear, 1, 9998) &&
    isIntBetween(period.quarter, 1, 4)
  ) {
    // Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec of fyStartYear; Q4 = Jan–Mar of the next year.
    const first = 4 + (period.quarter - 1) * 3;
    const startYear = first > 12 ? period.fyStartYear + 1 : period.fyStartYear;
    const startMonth = first > 12 ? first - 12 : first;
    const end = addMonthsClamped({ year: startYear, month: startMonth, day: 1 }, 2);
    return ok({
      from: { year: startYear, month: startMonth, day: 1 },
      to: { year: end.year, month: end.month, day: lastDayOfMonth(end.year, end.month) },
    });
  }
  return fail([issue("period_invalid", "period")]);
}

/** Whether a date lies in a range (both ends included). */
export const inPeriod = (date: CalendarDate, range: PeriodRange): boolean =>
  compareDates(date, range.from) >= 0 && compareDates(date, range.to) <= 0;
