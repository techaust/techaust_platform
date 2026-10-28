// The exchange rate printed on a USD invoice (M5.2; ADM-INV-08, Rule 34(2) CGST Rules, GSTR-1 table 6A), pure: no I/O, no zod, no floats. The rate is
// typed by hand as a decimal STRING, read digit by digit into whole micros (INR micros per USD, 1,000,000 = INR 1), never through a float.
// Researched 2026-10-28, Rule 34(2) CGST Rules (08-C RA-21): the rate of which day is acceptable (Q24: the issue date, or up to `fxMaxAgeDays` earlier) and its source (Q7).
import { daysBetween, parseIsoDate } from "./dates.ts";

/** The dearest rate accepted: 1,000 INR per USD (a typing slip, not a rate, above it). */
export const FX_MAX_MICROS = 1_000_000_000;

/** "83.1234" gives 83123400; null for anything else (no sign, no exponent, no separators, no float): 1 to 4 whole digits, up to 4 decimals, above zero. */
export function parseFxRate(text: string): number | null {
  const m = /^(\d{1,4})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const whole = Number(m[1] as string);
  const fraction = Number((m[2] ?? "").padEnd(6, "0"));
  const micros = whole * 1_000_000 + fraction;
  return micros >= 1 && micros <= FX_MAX_MICROS ? micros : null;
}

/** Whole micros printed back as typed ("83123400" gives "83.1234"): four decimals, always; the form of the INR block's "1 USD = INR 83.1234". */
export function formatFxRate(rateMicros: number): string {
  const whole = Math.trunc(rateMicros / 1_000_000);
  const fraction = String(rateMicros % 1_000_000)
    .padStart(6, "0")
    .slice(0, 4);
  return `${whole}.${fraction}`;
}

/** What may be said of a rate's date against the day of supply (`refDate`). */
export type FxDateVerdict = "ok" | "same_day_exists" | "invalid";

/**
 * The rule of Rule 34(2) CGST Rules for the rate of a USD document (owner 2026-10-28, Q24; Researched 2026-10-28, 08-C RA-21): the rate is the one determined for the DAY OF SUPPLY
 * (`refDate`: the issue day, or for the tax invoice of a payment received the day the money arrived). A rate dated that day is right (`ok`). A rate of an EARLIER day is right only when
 * the Owner states that no rate was published that day and the rate is at most `maxAgeDays` older. OPEN (08-C RA-21, Q24): may the rate be up to 4 days older when a rate was published that day? The code takes the stricter reading (lead decision, 2026-10-28). The statement is the DAY it was
 * made for (`noRateDay`, an ISO date) and counts only when that day IS the day of supply: a statement made on Monday does not cover a Tuesday issue (review 2026-10-28, finding 1), so
 * Tuesday's own rate has to be used. Without a statement for the day of supply an earlier rate is `same_day_exists` (use that day's rate), however old it is; with it, older than the limit
 * is `invalid`. A rate of a LATER day is never valid, nor a date that is not a real ISO date.
 */
export function fxDateVerdict(
  fxDate: string,
  refDate: string,
  maxAgeDays: number,
  noRateDay: string | null | undefined,
): FxDateVerdict {
  const fx = parseIsoDate(fxDate);
  const ref = parseIsoDate(refDate);
  if (!fx || !ref || !Number.isSafeInteger(maxAgeDays) || maxAgeDays < 0) return "invalid";
  const age = daysBetween(fx, ref);
  if (age < 0) return "invalid";
  if (age === 0) return "ok";
  if (noRateDay !== refDate) return "same_day_exists";
  return age <= maxAgeDays ? "ok" : "invalid";
}

/** Whether the rate's date may be used (`fxDateVerdict` is `ok`). */
export const fxDateOk = (
  fxDate: string,
  refDate: string,
  maxAgeDays: number,
  noRateDay: string | null | undefined = null,
): boolean => fxDateVerdict(fxDate, refDate, maxAgeDays, noRateDay) === "ok";

export const FX_SOURCE_CODES = ["FBIL", "RBI", "OTHER"] as const;
export type FxSourceCode = (typeof FX_SOURCE_CODES)[number];

/** The words stored as `fx_source` and printed: the fixed labels, or the person's own words (1 to 60 characters) for "Other". Null when `OTHER` has no usable note. */
export function fxSourceLabel(code: FxSourceCode, note: string | null | undefined): string | null {
  if (code === "FBIL") return "FBIL reference rate";
  if (code === "RBI") return "RBI reference rate";
  const text = (note ?? "").trim();
  return text.length >= 1 && text.length <= 60 ? text : null;
}
