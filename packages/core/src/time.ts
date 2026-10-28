// Time logs: the rules for an entry's date, who may still edit it, and the timesheet week [ADM-TIME-01..03]. Pure.
// Minutes are whole 15-minute steps, at most 24 hours per person per day (the database enforces both: a CHECK and a trigger).
// Staff time logs are staff personal data (DPDP, Researched 2026-10-28, s.31(5) CGST Act (08-C RA-24) for retention; they back overage invoices).
import { addDays, parseIsoDate, toIsoDate } from "./dates.ts";

export const TIME_STEP = 15;
export const DAY_CAP = 1_440;
export const LOCK_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const validMinutes = (minutes: number): boolean =>
  Number.isInteger(minutes) && minutes >= TIME_STEP && minutes <= DAY_CAP && minutes % TIME_STEP === 0;

export type EntryDateCheck = "ok" | "future" | "owner_only_date";

const shift = (date: string, days: number): string => {
  const d = parseIsoDate(date);
  if (!d) throw new RangeError(`Not a date: ${date}`);
  return toIsoDate(addDays(d, days));
};

/**
 * Whether a work date may be logged. Nobody logs a future date. A date more than 7 days back needs `time.writeAny`
 * (the owner), so exactly `today − 7` is still allowed and `today − 8` is not.
 */
export function entryDateCheck(input: {
  today: string;
  workDate: string;
  canWriteAny: boolean;
}): EntryDateCheck {
  if (input.workDate > input.today) return "future";
  if (!input.canWriteAny && input.workDate < shift(input.today, -LOCK_DAYS)) return "owner_only_date";
  return "ok";
}

/** The author's 7-day edit window counts from the row's `created_at` (written by the app): locked from exactly 7 days on. */
export const authorLocked = (createdAt: number, now: number): boolean =>
  now >= createdAt + LOCK_DAYS * DAY_MS;

/** The Monday to Sunday week that contains `date` (the timesheet week, IST dates). */
export function weekOf(date: string): { start: string; end: string } {
  const d = parseIsoDate(date);
  if (!d) throw new RangeError(`Not a date: ${date}`);
  // 0 = Sunday ... 6 = Saturday (a calendar date has no time zone).
  const weekday = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  const sinceMonday = (weekday + 6) % 7;
  const start = shift(date, -sinceMonday);
  return { start, end: shift(start, 6) };
}
