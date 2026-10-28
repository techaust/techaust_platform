// Number and date text for the export files (M5.5a): amounts with two decimals, rates without trailing zeros, dates as
// dd-Mmm-yyyy. No floats: everything goes through integers and bigint. Researched 2026-10-28, GSTN advisories of June 2025 (08-C RA-23) (the GSTN Offline Tool formats
// are UNVERIFIED, from memory; the owner or CA imports a sample before filing).
import type { CalendarDate } from "../dates.ts";

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

const checkInt = (n: number, what: string): void => {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be a safe integer: ${n}`);
};

/** Minor units as a decimal with two places: 50000 -> "500.00", -50 -> "-0.50". */
export function formatAmount(minor: number): string {
  checkInt(minor, "Amount");
  const value = BigInt(minor);
  const abs = value < 0n ? -value : value;
  const text = `${abs / 100n}.${pad(Number(abs % 100n), 2)}`;
  return value < 0n ? `-${text}` : text;
}

/** Basis points as a percentage without trailing zeros: 1800 -> "18", 1250 -> "12.5", 25 -> "0.25", 0 -> "0". */
export function formatRate(bp: number): string {
  checkInt(bp, "Rate");
  if (bp < 0) throw new RangeError(`Rate must not be negative: ${bp}`);
  const whole = Math.trunc(bp / 100);
  const fraction = pad(bp % 100, 2).replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole}.${fraction}`;
}

/** An exchange rate in micros as a six-decimal string: 83500000 -> "83.500000". */
export function formatMicros(micros: number): string {
  checkInt(micros, "Exchange rate");
  if (micros < 0) throw new RangeError(`Exchange rate must not be negative: ${micros}`);
  return `${Math.trunc(micros / 1_000_000)}.${pad(micros % 1_000_000, 6)}`;
}

/** A count as plain digits. */
export function formatCount(n: number): string {
  checkInt(n, "Count");
  if (n < 0) throw new RangeError(`Count must not be negative: ${n}`);
  return String(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "05-Oct-2026" (UNVERIFIED: the Offline Tool's date format). */
export function formatDate(date: CalendarDate): string {
  const month = MONTHS[date.month - 1];
  if (month === undefined) throw new RangeError(`Invalid month: ${date.month}`);
  return `${pad(date.day, 2)}-${month}-${pad(date.year, 4)}`;
}
