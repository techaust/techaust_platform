// Exact lockout counters (docs/05 §6.1): Turnstile after 3 failures (M2.4); a 15-minute lock after 10 failures per
// hour per account (`acct:` = a password attempt, `code:` = a code attempt), and per IP after 100 failures per hour
// (`ip:`). Pure decision functions; the Worker stores the rows in `auth_attempts` and its SQL is tested against
// these functions (`RESERVE_SQL` agrees with `reserveAttempt`).
import { enc, hex, hmacSha256, sha256 } from "./crypto.ts";

export const WINDOW_MS = 60 * 60 * 1000;
export const LOCK_AFTER = 10;
export const LOCK_MS = 15 * 60 * 1000;
export const TURNSTILE_AFTER = 3;
/** Per-IP: 100 failures an hour block the address for 15 minutes (50 would lock the benchmark runner). */
export const IP_LOCK_AFTER = 100;
export const IP_WINDOW_MS = WINDOW_MS;
export const IP_LOCK_MS = LOCK_MS;

export type Attempts = { windowStart: number; failures: number; lockedUntil: number | null };

export const isLocked = (a: Attempts | null, nowMs: number) => !!a?.lockedUntil && a.lockedUntil > nowMs;
export const needsTurnstile = (a: Attempts | null, nowMs: number) =>
  !!a && nowMs - a.windowStart < WINDOW_MS && a.failures >= TURNSTILE_AFTER;

/** The row after one more failure. */
export function recordFailure(
  a: Attempts | null,
  nowMs: number,
  lockAfter = LOCK_AFTER,
  lockMs = LOCK_MS,
  windowMs = WINDOW_MS,
): Attempts {
  const fresh = !a || nowMs - a.windowStart >= windowMs;
  const failures = fresh ? 1 : a.failures + 1;
  return {
    windowStart: fresh ? nowMs : a.windowStart,
    failures,
    lockedUntil: failures >= lockAfter ? nowMs + lockMs : (a?.lockedUntil ?? null),
  };
}

export type Reservation =
  | { allowed: false; row: Attempts }
  /** `lockStarted`: this very reservation set the lock (the attempt is still verified, then refused later). */
  | { allowed: true; row: Attempts; lockStarted: boolean };

/**
 * Count an attempt BEFORE it is checked (M1.5, LD1): the first step of every password or code attempt. While the
 * lock is in force nothing is counted and the attempt is refused; otherwise the attempt is counted at once (even
 * the one that sets the lock still gets verified), so parallel requests can't all slip past a lock that only the
 * first of them has set. A full sign-in deletes the row. The Worker does this in one SQL statement (`RESERVE_SQL`).
 */
export function reserveAttempt(a: Attempts | null, nowMs: number, lockAfter = LOCK_AFTER): Reservation {
  if (isLocked(a, nowMs)) return { allowed: false, row: a as Attempts };
  const row = recordFailure(a, nowMs, lockAfter);
  return { allowed: true, row, lockStarted: row.failures >= lockAfter };
}

/** Password counter key: a hash of the email, so unknown emails behave exactly like real ones. */
export const accountKey = async (email: string) =>
  `acct:${hex(await sha256(enc.encode(email))).slice(0, 32)}`;

/** Code counter key (TOTP, recovery code, step-up code), one per account: `code:<user id>`. */
export const codeKey = (userId: string) => `code:${userId}`;

/** Per-IP key: an HMAC of the address (no new secret, no raw IP stored in the counter table). */
export const ipKey = async (saltPepper: string, ip: string) =>
  `ip:${hex(await hmacSha256(saltPepper, enc.encode(`ip:${ip}`))).slice(0, 32)}`;
