// Exact lockout counters (docs/05 §6.1): Turnstile after 3 failures; a 15-minute lock after 10 failures per
// hour per account. Pure decision functions; the Worker stores the row in `auth_attempts`.
export const WINDOW_MS = 60 * 60 * 1000;
export const LOCK_AFTER = 10;
export const LOCK_MS = 15 * 60 * 1000;
export const TURNSTILE_AFTER = 3;

export type Attempts = { windowStart: number; failures: number; lockedUntil: number | null };

export const isLocked = (a: Attempts | null, nowMs: number) => !!a?.lockedUntil && a.lockedUntil > nowMs;
export const needsTurnstile = (a: Attempts | null, nowMs: number) =>
  !!a && nowMs - a.windowStart < WINDOW_MS && a.failures >= TURNSTILE_AFTER;

/** The row after one more failure. */
export function recordFailure(a: Attempts | null, nowMs: number): Attempts {
  const fresh = !a || nowMs - a.windowStart >= WINDOW_MS;
  const failures = fresh ? 1 : a.failures + 1;
  return {
    windowStart: fresh ? nowMs : a.windowStart,
    failures,
    lockedUntil: failures >= LOCK_AFTER ? nowMs + LOCK_MS : (a?.lockedUntil ?? null),
  };
}
