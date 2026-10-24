// Display helpers. Times are stored as UTC ms and shown in IST (CLAUDE.md conventions).
import { formatIstDateTime } from "@techaust/core";
import type { Role } from "@techaust/core/permissions";

export const when = (utcMs: number | null | undefined) => (utcMs ? formatIstDateTime(utcMs) : "Never");

const rtf = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 3_600],
  ["day", 86_400],
  ["week", 604_800],
  ["month", 2_629_800],
  ["year", 31_557_600],
];

/** "just now", "12 minutes ago", "yesterday", "3 weeks ago" (the absolute IST time is shown next to it). */
export function relative(utcMs: number, now = Date.now()): string {
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

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  staff: "Staff",
  sales: "Sales",
  accountant: "Accountant",
};

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
