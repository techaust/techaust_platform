// Display helpers. Times are stored as UTC ms and shown in IST (CLAUDE.md conventions). A date-only moment (a lead's next action, stored as the last
// millisecond of its IST day) prints as the day alone, never "23:59 IST" (FX-3, A3 10: core `formatIstMoment`).
import { daysBetween, formatIstMoment, isIstDayEnd, istDate } from "@techaust/core/dates";

export const when = (utcMs: number | null | undefined) => (utcMs ? formatIstMoment(utcMs) : "Never");

const rtf = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 3_600],
  ["day", 86_400],
  ["week", 604_800],
  ["month", 2_629_800],
  ["year", 31_557_600],
];

/**
 * "just now", "12 minutes ago", "yesterday", "3 weeks ago" (the absolute IST time is shown next to it). A date-only moment counts whole IST days
 * ("today", "yesterday", "in 3 days"), so an action due yesterday never reads "10 hours ago".
 */
export function relative(utcMs: number, now = Date.now()): string {
  if (isIstDayEnd(utcMs)) {
    const days = daysBetween(istDate(now), istDate(utcMs));
    return Math.abs(days) < 7 ? rtf.format(days, "day") : relativeSpan(utcMs, now);
  }
  return relativeSpan(utcMs, now);
}

function relativeSpan(utcMs: number, now: number): string {
  const s = Math.round((utcMs - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "just now";
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let size = 60;
  for (const [u, n] of STEPS) {
    if (abs >= n * 0.9) {
      unit = u;
      size = n;
    }
  }
  return rtf.format(Math.round(s / size), unit);
}

export { ROLE_LABELS } from "@techaust/core/permissions";

export const STATUS_LABELS = {
  active: "Active",
  invited: "Invited",
  deactivated: "Deactivated",
} as const;

/** The invite token travels in the URL fragment (#t=…), which is never sent to servers or kept in logs. */
export const inviteTokenFromHash = (hash: string) => new URLSearchParams(hash.replace(/^#/, "")).get("t");

/** Base32 secret in groups of four, for typing into an authenticator app. */
export const groupSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

/** A server message as a sentence: the API's messages have no full stop ("Check the form and try again"). */
export const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** Keep only digits (people paste "123 456" or "123-456"). */
export const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 6);
