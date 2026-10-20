// Display helpers. Times are stored as UTC ms and shown in IST (CLAUDE.md conventions).
import { formatIstDateTime } from "@techaust/core";
import type { Role } from "@techaust/core/permissions";

export const when = (utcMs: number | null | undefined) => (utcMs ? formatIstDateTime(utcMs) : "Never");

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

/** Keep only digits (people paste "123 456" or "123-456"). */
export const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 6);
