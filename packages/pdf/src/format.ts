// Small formatters for the view. Pure text work: quantities and rates are written by slicing digit strings, not by dividing.
import { parseIsoDate, toIst } from "@techaust/core/dates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const pad2 = (n: number) => String(n).padStart(2, "0");

type Ymd = { year: number; month: number; day: number };

/** "06 Oct 26". */
export const shortDate = ({ year, month, day }: Ymd): string =>
  `${pad2(day)} ${MONTHS[month - 1]} ${String(year).slice(-2)}`;

/** The IST date of a UTC instant, as "06 Oct 26". */
export const shortIstDate = (utcMs: number): string => shortDate(toIst(utcMs));

/** "2026-10-06" as "06 Oct 26"; anything else is returned as it came. */
export function shortIsoDate(iso: string): string {
  const d = parseIsoDate(iso);
  return d ? shortDate(d) : iso;
}

/** Milli-units as a decimal text: 1000 is "1", 1500 is "1.5", 250 is "0.25". */
export function formatQty(qtyMilli: number): string {
  const s = String(Math.abs(qtyMilli)).padStart(4, "0");
  const whole = s.slice(0, -3);
  const frac = s.slice(-3).replace(/0+$/, "");
  return `${qtyMilli < 0 ? "-" : ""}${whole}${frac === "" ? "" : `.${frac}`}`;
}

/** INR micros per USD as a decimal text with at least two places: 83500000 is "83.50". */
export function formatMicros(micros: number): string {
  const s = String(micros).padStart(7, "0");
  const whole = s.slice(0, -6);
  const frac = s.slice(-6).replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${frac}`;
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

/** "IN" as "India"; an unknown code stays as it is. */
export function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}
