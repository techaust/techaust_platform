// The exchange rate printed on a USD invoice (M5.2; ADM-INV-08, Rule 34(2) CGST Rules, GSTR-1 table 6A), pure: no I/O, no zod, no floats. The rate is
// typed by hand as a decimal STRING, read digit by digit into whole micros (INR micros per USD, 1,000,000 = INR 1), never through a float.
// VERIFY WITH CA/LEGAL: the rate of which day is acceptable (Q24: the issue date, or up to `fxMaxAgeDays` earlier) and its source (Q7).
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

/**
 * Whether the rate's date may be used on a document of `refDate` (ISO dates): `refDate - maxAgeDays <= fxDate <= refDate`. A rate of the future is
 * never valid (Q24). A date that is not a real ISO date is invalid.
 */
export function fxDateOk(fxDate: string, refDate: string, maxAgeDays: number): boolean {
  const fx = parseIsoDate(fxDate);
  const ref = parseIsoDate(refDate);
  if (!fx || !ref || !Number.isSafeInteger(maxAgeDays) || maxAgeDays < 0) return false;
  const age = daysBetween(fx, ref);
  return age >= 0 && age <= maxAgeDays;
}

export const FX_SOURCE_CODES = ["FBIL", "RBI", "OTHER"] as const;
export type FxSourceCode = (typeof FX_SOURCE_CODES)[number];

/** The words stored as `fx_source` and printed: the fixed labels, or the person's own words (1 to 60 characters) for "Other". Null when `OTHER` has no usable note. */
export function fxSourceLabel(code: FxSourceCode, note: string | null | undefined): string | null {
  if (code === "FBIL") return "FBIL reference rate";
  if (code === "RBI") return "RBI reference rate";
  const text = (note ?? "").trim();
  return text.length >= 1 && text.length <= 60 ? text : null;
}
