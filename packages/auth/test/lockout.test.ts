import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Attempts,
  accountKey,
  codeKey,
  IP_LOCK_AFTER,
  IP_LOCK_MS,
  ipKey,
  isLocked,
  LOCK_AFTER,
  LOCK_MS,
  recordFailure,
  reserveAttempt,
  WINDOW_MS,
} from "../src/lockout.ts";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY2 = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

const attempts = fc.record({
  windowStart: fc.integer({ min: 0, max: 2_000_000 }),
  failures: fc.integer({ min: 1, max: 30 }),
  lockedUntil: fc.option(fc.integer({ min: 0, max: 3_000_000 }), { nil: null }),
});

describe("reserveAttempt [ADM-AUTH-06]", () => {
  it("refuses, and changes nothing, while the lock is in force", () => {
    const locked: Attempts = { windowStart: 0, failures: 10, lockedUntil: 1000 };
    expect(reserveAttempt(locked, 999)).toEqual({ allowed: false, row: locked });
    expect(reserveAttempt(locked, 1000).allowed).toBe(true); // the lock ends at locked_until
  });

  it("counts the attempt at once; the one that reaches the limit sets the lock and is still allowed", () => {
    let a: Attempts | null = null;
    for (let i = 1; i < LOCK_AFTER; i++) {
      const r = reserveAttempt(a, 10 + i);
      expect(r).toMatchObject({ allowed: true, lockStarted: false });
      a = r.row;
    }
    const tenth = reserveAttempt(a, 100);
    expect(tenth).toMatchObject({ allowed: true, lockStarted: true });
    expect(tenth.row.lockedUntil).toBe(100 + LOCK_MS);
    expect(reserveAttempt(tenth.row, 101).allowed).toBe(false);
  });

  it("a fresh window restarts at one", () => {
    const old: Attempts = { windowStart: 0, failures: 9, lockedUntil: null };
    const r = reserveAttempt(old, WINDOW_MS);
    expect(r).toMatchObject({ allowed: true, lockStarted: false });
    expect(r.row).toEqual({ windowStart: WINDOW_MS, failures: 1, lockedUntil: null });
  });

  it("property: allowed exactly when not locked; the new row is recordFailure's; lockStarted means the limit", () => {
    fc.assert(
      fc.property(
        fc.option(attempts, { nil: null }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 1, max: 12 }),
        (a, now, lockAfter) => {
          const r = reserveAttempt(a, now, lockAfter);
          expect(r.allowed).toBe(!isLocked(a, now));
          if (r.allowed) {
            expect(r.row).toEqual(recordFailure(a, now, lockAfter));
            expect(r.lockStarted).toBe(r.row.failures >= lockAfter);
          } else {
            expect(r.row).toBe(a);
          }
        },
      ),
    );
  });
});

describe("recordFailure with another policy (the per-address counter)", () => {
  it("locks at 100 failures for 15 minutes, in an hour window", () => {
    let a: Attempts | null = null;
    for (let i = 0; i < IP_LOCK_AFTER - 1; i++)
      a = recordFailure(a, 1000 + i, IP_LOCK_AFTER, IP_LOCK_MS, WINDOW_MS);
    expect(a?.lockedUntil).toBeNull();
    a = recordFailure(a, 2000, IP_LOCK_AFTER, IP_LOCK_MS, WINDOW_MS);
    expect(a).toMatchObject({ failures: IP_LOCK_AFTER, lockedUntil: 2000 + IP_LOCK_MS });
    expect(recordFailure(a, 2000 + WINDOW_MS + 1, IP_LOCK_AFTER, IP_LOCK_MS, WINDOW_MS)).toMatchObject({
      failures: 1,
    });
    expect(IP_LOCK_AFTER).toBe(100);
    expect(IP_LOCK_MS).toBe(15 * 60 * 1000);
  });
});

describe("counter keys", () => {
  it("acct: is 32 hex of SHA-256(email); code: is the user id", async () => {
    expect(await accountKey("a@example.com")).toMatch(/^acct:[0-9a-f]{32}$/);
    expect(await accountKey("a@example.com")).toBe(await accountKey("a@example.com"));
    expect(await accountKey("a@example.com")).not.toBe(await accountKey("b@example.com"));
    expect(codeKey("019abc")).toBe("code:019abc");
  });

  it("ip: is an HMAC of the address: stable, 32 hex, secret-dependent, never the address", async () => {
    const k = await ipKey(KEY, "203.0.113.5");
    expect(k).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(k).toBe(await ipKey(KEY, "203.0.113.5"));
    expect(k).not.toBe(await ipKey(KEY, "203.0.113.6"));
    expect(k).not.toBe(await ipKey(KEY2, "203.0.113.5"));
    expect(k).not.toContain("203");
    expect(await ipKey(KEY, "2001:db8::1")).toMatch(/^ip:[0-9a-f]{32}$/);
  });
});
