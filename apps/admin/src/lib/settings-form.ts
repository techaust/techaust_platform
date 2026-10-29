// Pure helpers for the settings forms (ADM-SET-01..10, ADM-G-04): what a person types becomes the stored value
// (rates in basis points, money in minor units through @techaust/core, never floats), and the API's field paths become
// the ids of the fields on screen, so an error lands next to the field that caused it.
import { type Currency, formatMoney, money, parseMoney } from "@techaust/core";

export type FieldErrors = Record<string, string>;

/** The id of the field for a value path ("lut.arn" or ["lut", "arn"] → "f-lut-arn"). */
export const fieldId = (path: string | readonly PropertyKey[]) =>
  `f-${(typeof path === "string" ? path.split(".") : path.map(String)).filter(Boolean).join("-")}`;

/**
 * The closest field on the page for a path: "buildSchedule.0.pctBp" tries f-buildSchedule-0-pctBp, then
 * f-buildSchedule-0, then f-buildSchedule. `exists` is `document.getElementById` in the app (a stub in tests).
 */
export function nearestField(path: string, exists: (id: string) => boolean): string | null {
  const parts = path.split(".").filter(Boolean);
  for (let n = parts.length; n > 0; n--) {
    const id = fieldId(parts.slice(0, n));
    if (exists(id)) return id;
  }
  return null;
}

/** "18" or "18.5" (%) → 1800 or 1850 basis points; null if it isn't a rate with at most 2 decimals. */
export function percentToBp(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bp <= 10_000 ? bp : null;
}

/** 1850 → "18.5", 1800 → "18". */
export function bpToPercent(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = String(bp % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** A whole number within limits, or null. */
export function intIn(input: string, min: number, max = Number.MAX_SAFE_INTEGER): number | null {
  const t = input.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * FX-5 (full audit C4, 07-Z §2 line 4): the days the newest proposal terms state (`meta.termsDueDays.stated`) when any of them differs from the
 * payment due days on screen: the number being typed while it is a valid one (0 to 90), else the saved one. Empty: they agree, or the terms
 * state no days.
 */
export function termsDueDaysClash(
  stated: readonly number[] | undefined,
  typed: string,
  saved: number,
): number[] {
  if (!stated || stated.length === 0) return [];
  const due = intIn(typed, 0, 90) ?? saved;
  return stated.some((n) => n !== due) ? [...stated] : [];
}

/** Minor units as people type them back (no symbol; whole amounts without ".00"): 1_00_000_00 INR → "1,00,000". */
export const moneyInput = (minor: number, currency: Currency) =>
  formatMoney(money(minor, currency), { symbol: false, wholeUnits: true });

/** What a person typed in a money field → minor units, or the parser's message. Negative amounts are refused. */
export function moneyFrom(
  input: string,
  currency: Currency,
): { ok: true; minor: number } | { ok: false; error: string } {
  const r = parseMoney(input, currency);
  if (!r.ok) return { ok: false, error: `${r.error}.` };
  if (r.value.amount < 0) return { ok: false, error: "Enter an amount of zero or more." };
  return { ok: true, minor: r.value.amount };
}

/** Empty text → null (the schemas store "not set" as null). */
export const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

/** A loose email check for the form (the schema checks again, and so does the API). */
export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Reminder offsets in words: -3 → "3 days before", 0 → "On the due date", 1 → "1 day after". */
export function offsetText(days: number): string {
  if (days === 0) return "On the due date";
  const n = Math.abs(days);
  return `${n} ${n === 1 ? "day" : "days"} ${days < 0 ? "before" : "after"}`;
}
