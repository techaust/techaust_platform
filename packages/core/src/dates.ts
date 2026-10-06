// Time rules [ADM-G-08]: store UTC milliseconds, show India Standard Time, financial year 1 April – 31 March.
// IST is a fixed UTC+05:30 with no daylight saving, so plain arithmetic is exact (and cheaper than Intl).

export const IST_OFFSET_MS = 19_800_000; // 5 h 30 min
const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar date in IST. `month` is 1–12. */
export type CalendarDate = { readonly year: number; readonly month: number; readonly day: number };
export type IstDateTime = CalendarDate & {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
};

const assertMs = (utcMs: number) => {
  if (!Number.isSafeInteger(utcMs)) throw new RangeError(`Expected UTC milliseconds: ${utcMs}`);
};

/** The IST wall-clock reading of a UTC instant. */
export function toIst(utcMs: number): IstDateTime {
  assertMs(utcMs);
  const d = new Date(utcMs + IST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

export function isValidDate({ year, month, day }: CalendarDate): boolean {
  if (![year, month, day].every(Number.isInteger) || year < 1 || year > 9999) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** The UTC instant of an IST wall-clock time (default: midnight at the start of the day). */
export function fromIst(date: CalendarDate, hour = 0, minute = 0, second = 0): number {
  if (!isValidDate(date)) throw new RangeError(`Invalid date: ${JSON.stringify(date)}`);
  const d = new Date(0);
  d.setUTCFullYear(date.year, date.month - 1, date.day);
  d.setUTCHours(hour, minute, second, 0);
  return d.getTime() - IST_OFFSET_MS;
}

export const istDate = (utcMs: number): CalendarDate => {
  const { year, month, day } = toIst(utcMs);
  return { year, month, day };
};

/** Add whole days to a calendar date (for due dates and validity periods). */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  if (!Number.isSafeInteger(days)) throw new RangeError(`Days must be an integer: ${days}`);
  return istDate(fromIst(date) + days * DAY_MS);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export const daysBetween = (a: CalendarDate, b: CalendarDate): number => (fromIst(b) - fromIst(a)) / DAY_MS;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** "2026-10-06" ⇄ CalendarDate (the format of date inputs and of date columns). */
export const toIsoDate = ({ year, month, day }: CalendarDate) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
export function parseIsoDate(value: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidDate(date) ? date : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "06 Oct 2026" (unambiguous for Indian and US readers alike). */
export const formatDate = ({ year, month, day }: CalendarDate) => `${pad(day)} ${MONTHS[month - 1]} ${year}`;
/** "06 Oct 2026, 14:05 IST". */
export function formatIstDateTime(utcMs: number): string {
  const t = toIst(utcMs);
  return `${formatDate(t)}, ${pad(t.hour)}:${pad(t.minute)} IST`;
}

/** An Indian financial year, named by the calendar year it starts in (FY 2026-27 → 2026). */
export type FinancialYear = {
  readonly startYear: number;
  /** "2026-27", for people. */
  readonly label: string;
  /** "2627", for document numbers (keeps GST numbers within 16 characters, ADM-SET-04). */
  readonly token: string;
  /** First instant of 1 April 00:00 IST (inclusive), in UTC ms. */
  readonly startMs: number;
  /** First instant of the next FY (exclusive), in UTC ms. */
  readonly endMs: number;
};

export function financialYear(startYear: number): FinancialYear {
  if (!Number.isInteger(startYear) || startYear < 1 || startYear > 9998) {
    throw new RangeError(`Invalid financial year start: ${startYear}`);
  }
  const yy = (y: number) => pad(y % 100);
  return {
    startYear,
    label: `${startYear}-${yy(startYear + 1)}`,
    token: `${yy(startYear)}${yy(startYear + 1)}`,
    startMs: fromIst({ year: startYear, month: 4, day: 1 }),
    endMs: fromIst({ year: startYear + 1, month: 4, day: 1 }),
  };
}

/** The financial year of a calendar date: April onwards belongs to the FY starting that year. */
export const fyOfDate = (date: CalendarDate): FinancialYear =>
  financialYear(date.month >= 4 ? date.year : date.year - 1);

/** The financial year of a UTC instant, judged by the IST date (31 Mar 23:59 IST is still the old FY). */
export const fyOf = (utcMs: number): FinancialYear => fyOfDate(istDate(utcMs));
