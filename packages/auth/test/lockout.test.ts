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
  reserveAttemptGated,
  TURNSTILE_AFTER,
  WINDOW_MS,
} from "../src/lockout.ts";
import {
  MAGIC_IP_LIMIT,
  MAGIC_IP_LOCK_MS,
  MAGIC_IP_WINDOW_MS,
  MAGIC_MAIL_LIMIT,
  MAGIC_MAIL_LOCK_MS,
  MAGIC_MAIL_WINDOW_MS,
} from "../src/portal.ts";

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

describe("reserveAttempt with a window and a lock of its own (M1.6 portal quotas) [POR-01]", () => {
  it("the defaults are unchanged: calling with three arguments equals calling with the M1.5 constants", () => {
    fc.assert(
      fc.property(
        fc.option(attempts, { nil: null }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 1, max: 12 }),
        (a, now, lockAfter) => {
          expect(reserveAttempt(a, now, lockAfter)).toEqual(
            reserveAttempt(a, now, lockAfter, LOCK_MS, WINDOW_MS),
          );
        },
      ),
    );
  });

  it("property: with any lock and window the row is recordFailure's with the same lock and window", () => {
    fc.assert(
      fc.property(
        fc.option(attempts, { nil: null }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 4_000_000 }),
        fc.integer({ min: 1, max: 4_000_000 }),
        (a, now, lockAfter, lockMs, windowMs) => {
          const r = reserveAttempt(a, now, lockAfter, lockMs, windowMs);
          expect(r.allowed).toBe(!isLocked(a, now));
          if (r.allowed) expect(r.row).toEqual(recordFailure(a, now, lockAfter, lockMs, windowMs));
        },
      ),
    );
  });

  it("address quota: the 10th request in an hour is served and sets a one-hour lock; the 11th is refused", () => {
    let a: Attempts | null = null;
    for (let i = 1; i <= MAGIC_IP_LIMIT; i++) {
      const r = reserveAttempt(a, 1_000 + i, MAGIC_IP_LIMIT, MAGIC_IP_LOCK_MS, MAGIC_IP_WINDOW_MS);
      expect(r.allowed, `request ${i}`).toBe(true);
      a = r.row;
    }
    expect(a?.lockedUntil).toBe(1_000 + MAGIC_IP_LIMIT + MAGIC_IP_LOCK_MS);
    expect(reserveAttempt(a, 2_000, MAGIC_IP_LIMIT, MAGIC_IP_LOCK_MS, MAGIC_IP_WINDOW_MS).allowed).toBe(
      false,
    );
    const later = 1_000 + MAGIC_IP_LIMIT + MAGIC_IP_LOCK_MS;
    expect(reserveAttempt(a, later, MAGIC_IP_LIMIT, MAGIC_IP_LOCK_MS, MAGIC_IP_WINDOW_MS)).toMatchObject({
      allowed: true,
      row: { failures: 1 },
    });
  });

  it("email quota: the 3rd request in 15 minutes is served; the 4th is refused until 15 minutes later", () => {
    let a: Attempts | null = null;
    for (let i = 1; i <= MAGIC_MAIL_LIMIT; i++) {
      const r = reserveAttempt(a, 10_000 + i, MAGIC_MAIL_LIMIT, MAGIC_MAIL_LOCK_MS, MAGIC_MAIL_WINDOW_MS);
      expect(r.allowed).toBe(true);
      a = r.row;
    }
    const fourth = reserveAttempt(a, 10_100, MAGIC_MAIL_LIMIT, MAGIC_MAIL_LOCK_MS, MAGIC_MAIL_WINDOW_MS);
    expect(fourth.allowed).toBe(false);
    const free = 10_000 + MAGIC_MAIL_LIMIT + MAGIC_MAIL_LOCK_MS;
    expect(reserveAttempt(a, free, MAGIC_MAIL_LIMIT, MAGIC_MAIL_LOCK_MS, MAGIC_MAIL_WINDOW_MS).allowed).toBe(
      true,
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

  it("ip: counts IPv6 by its /64, so rotating inside it does not dodge the block (M1.6 follow-up)", async () => {
    const a = await ipKey(KEY, "2001:db8:0:1::1");
    expect(await ipKey(KEY, "2001:db8:0:1:abcd:ef01:2345:6789")).toBe(a);
    expect(await ipKey(KEY, "2001:0db8:0000:0001:0000:0000:0000:0002")).toBe(a);
    expect(await ipKey(KEY, "[2001:DB8:0:1::5]")).toBe(a);
    expect(await ipKey(KEY, "2001:db8:0:2::1")).not.toBe(a);
    expect(await ipKey(KEY, "::ffff:203.0.113.5")).toBe(await ipKey(KEY, "203.0.113.5")); // mapped IPv4
    expect(await ipKey(KEY, "unknown")).toMatch(/^ip:[0-9a-f]{32}$/); // unparsable: one stable bucket
  });
});

describe("reserveAttemptGated [ADM-AUTH-06]", () => {
  const row = (failures: number, windowStart = 0, lockedUntil: number | null = null): Attempts => ({
    windowStart,
    failures,
    lockedUntil,
  });

  it("counts the first three attempts without a token, then asks for one without counting", () => {
    let a: Attempts | null = null;
    for (let i = 1; i <= TURNSTILE_AFTER; i++) {
      const r = reserveAttemptGated(a, 1000 + i, false);
      expect(r.allowed).toBe(true);
      if (r.allowed) a = r.row;
    }
    expect(a?.failures).toBe(3);
    const refused = reserveAttemptGated(a, 2000, false);
    expect(refused).toEqual({ allowed: false, row: a, turnstileRequired: true });
    const verified = reserveAttemptGated(a, 2000, true);
    expect(verified.allowed && verified.row.failures).toBe(4);
  });

  it("a lock in force refuses first, whatever the token says", () => {
    const locked = row(10, 0, 5000);
    expect(reserveAttemptGated(locked, 4000, true)).toEqual({ allowed: false, row: locked });
    expect(reserveAttemptGated(locked, 4000, false)).toEqual({ allowed: false, row: locked });
  });

  it("after the lock ends the count goes on only with a verified token", () => {
    const ended = row(10, 0, 5000);
    expect(reserveAttemptGated(ended, 5000, false)).toMatchObject({
      allowed: false,
      turnstileRequired: true,
    });
    expect(reserveAttemptGated(ended, 5000, true).allowed).toBe(true);
  });

  it("an expired window restarts at 1 and needs no token", () => {
    const old = row(7, 0, null);
    const r = reserveAttemptGated(old, WINDOW_MS, false);
    expect(r.allowed && r.row).toEqual({ windowStart: WINDOW_MS, failures: 1, lockedUntil: null });
    expect(reserveAttemptGated(old, WINDOW_MS - 1, false)).toMatchObject({ turnstileRequired: true });
  });

  it("with a verified token it is exactly reserveAttempt (property)", () => {
    fc.assert(
      fc.property(fc.option(attempts, { nil: null }), fc.integer({ min: 0, max: 5_000_000 }), (a, now) => {
        expect(reserveAttemptGated(a, now, true)).toEqual(reserveAttempt(a, now));
      }),
    );
  });

  it("without a token it is reserveAttempt except where a token is due, and then it changes nothing (property)", () => {
    fc.assert(
      fc.property(fc.option(attempts, { nil: null }), fc.integer({ min: 0, max: 5_000_000 }), (a, now) => {
        const g = reserveAttemptGated(a, now, false);
        if (!g.allowed && "turnstileRequired" in g) {
          expect(a).not.toBeNull();
          expect(isLocked(a, now)).toBe(false);
          expect(a && now - a.windowStart < WINDOW_MS && a.failures >= TURNSTILE_AFTER).toBe(true);
          expect(g.row).toBe(a);
        } else {
          expect(g).toEqual(reserveAttempt(a, now));
        }
      }),
    );
  });
});
