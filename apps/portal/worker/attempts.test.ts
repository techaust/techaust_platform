// The counter SQL under the portal's own policies [POR-01]: `RESERVE_SQL` and `FAIL_SQL` (moved to @techaust/auth)
// agree with the pure `reserveAttempt` / `recordFailure` for the email quota (3 in 15 minutes), the address quota
// (10 in an hour) and the failure counter (20 an hour, 15-minute block), on M1.4's kind of sequences: hand-written
// edges plus forty seeded random ones. The admin's defaults are proved unchanged by its own, untouched, suite.
import { env } from "cloudflare:workers";
import {
  type Attempts,
  FAIL_SQL,
  IP_LOCK_MS,
  IP_WINDOW_MS,
  LOCK_AFTER,
  LOCK_MS,
  MAGIC_IP_LIMIT,
  MAGIC_IP_LOCK_MS,
  MAGIC_IP_WINDOW_MS,
  MAGIC_MAIL_LIMIT,
  MAGIC_MAIL_LOCK_MS,
  MAGIC_MAIL_WINDOW_MS,
  PORTAL_FAIL_LIMIT,
  PORTAL_FAIL_LOCK_MS,
  PORTAL_FAIL_WINDOW_MS,
  RESERVE_SQL,
  recordFailure,
  reserveAttempt,
  WINDOW_MS,
} from "@techaust/auth";
import { describe, expect, it } from "vitest";

const T0 = 1_700_000_000_000;

type Policy = { name: string; limit: number; windowMs: number; lockMs: number };
const POLICIES: Policy[] = [
  {
    name: "email quota",
    limit: MAGIC_MAIL_LIMIT,
    windowMs: MAGIC_MAIL_WINDOW_MS,
    lockMs: MAGIC_MAIL_LOCK_MS,
  },
  { name: "address quota", limit: MAGIC_IP_LIMIT, windowMs: MAGIC_IP_WINDOW_MS, lockMs: MAGIC_IP_LOCK_MS },
  {
    name: "failure counter",
    limit: PORTAL_FAIL_LIMIT,
    windowMs: PORTAL_FAIL_WINDOW_MS,
    lockMs: PORTAL_FAIL_LOCK_MS,
  },
];

/** Hand-written edges (scaled to the policy) and forty seeded random sequences (gaps from 0 to 1.5 windows). */
function sequences(p: Policy): Record<string, number[]> {
  const { limit, windowMs: W, lockMs: L } = p;
  const burst = (n: number, at = T0) => Array.from({ length: n }, (_, i) => at + i);
  const cases: Record<string, number[]> = {
    "first attempt only": [T0],
    "up to the limit: the last one sets the lock": burst(limit),
    "one more after the limit is refused, nothing counted": burst(limit + 1),
    "window expires exactly at the window length (>=): restarts at 1": [T0, T0 + W],
    "one ms before the window ends: still counts": [T0, T0 + W - 1],
    "limit-1 attempts, the window passes, then limit-1 more: no lock": [
      ...burst(limit - 1),
      ...burst(limit - 1, T0 + W + 10),
    ],
    "lock, the window passes, a fresh attempt keeps the old locked_until": [...burst(limit), T0 + W + L + 50],
    "lock expires exactly at its end: counted, and locks again once at the limit": [
      ...burst(limit),
      T0 + limit - 1 + L - 1,
      T0 + limit - 1 + L,
      T0 + limit - 1 + L + 1,
    ],
  };
  let s = 4242 + limit;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
  for (let n = 0; n < 40; n++) {
    let t = T0;
    cases[`random sequence ${n}`] = Array.from({ length: 30 }, () => {
      t += Math.floor(rnd() < 0.1 ? rnd() * 1.5 * W : rnd() * Math.min(5000, W / 4));
      return t;
    });
  }
  return cases;
}

const rowOf = async (k: string) => {
  const r = await env.DB.prepare(
    "SELECT window_start, failures, locked_until FROM auth_attempts WHERE key = ?",
  )
    .bind(k)
    .first<{ window_start: number; failures: number; locked_until: number | null }>();
  return r
    ? ({ windowStart: r.window_start, failures: r.failures, lockedUntil: r.locked_until } as Attempts)
    : null;
};

for (const p of POLICIES) {
  describe(`RESERVE_SQL agrees with reserveAttempt: ${p.name} [POR-01]`, () => {
    for (const [name, times] of Object.entries(sequences(p))) {
      it(`same row, same refusals: ${name}`, async () => {
        const k = `p:test:${p.name}:${name}`.replace(/\W+/g, "-");
        let expected: Attempts | null = null;
        for (const at of times) {
          const model = reserveAttempt(expected, at, p.limit, p.lockMs, p.windowMs);
          const res = await env.DB.prepare(RESERVE_SQL)
            .bind(k, at, p.windowMs, p.limit, p.lockMs, null)
            .all();
          const returned = res.results[0] as { failures: number; locked_until: number | null } | undefined;
          if (model.allowed) {
            expect(returned).toEqual({ failures: model.row.failures, locked_until: model.row.lockedUntil });
            expect(await rowOf(k)).toEqual(model.row);
            expected = model.row;
          } else {
            expect(returned, "locked: no row comes back").toBeUndefined();
            expect(await rowOf(k), "locked: nothing is written").toEqual(expected);
          }
        }
      });
    }
  });
}

describe("FAIL_SQL agrees with recordFailure under the portal's failure policy [POR-01]", () => {
  const p = POLICIES[2] as Policy;
  for (const [name, times] of Object.entries(sequences(p))) {
    it(`same row: ${name}`, async () => {
      const k = `p:test:fail:${name}`.replace(/\W+/g, "-");
      let expected: Attempts | null = null;
      for (const at of times) {
        expected = recordFailure(expected, at, p.limit, p.lockMs, p.windowMs);
        await env.DB.prepare(FAIL_SQL).bind(k, at, p.windowMs, p.limit, p.lockMs).run();
        expect(await rowOf(k)).toEqual(expected);
      }
    });
  }
});

describe("the address block is checked in SQL by the other counters [POR-01]", () => {
  it("a reservation whose address key is locked writes nothing; with the address free it counts", async () => {
    const ip = "p:req:blocked-address";
    await env.DB.prepare(
      "INSERT INTO auth_attempts (key, window_start, failures, locked_until) VALUES (?, ?, 10, ?)",
    )
      .bind(ip, T0, T0 + 60_000)
      .run();
    const blocked = await env.DB.prepare(RESERVE_SQL)
      .bind("p:mail:x", T0 + 1, 900_000, 3, 900_000, ip)
      .all();
    expect(blocked.results).toEqual([]);
    expect(await rowOf("p:mail:x")).toBeNull();
    const free = await env.DB.prepare(RESERVE_SQL)
      .bind("p:mail:x", T0 + 61_000, 900_000, 3, 900_000, ip)
      .all();
    expect(free.results).toHaveLength(1);
  });

  it("the staff defaults still mean what they did: 10 an hour, a 15-minute lock; the address policy 100", () => {
    expect(LOCK_AFTER).toBe(10);
    expect(WINDOW_MS).toBe(3_600_000);
    expect(LOCK_MS).toBe(900_000);
    expect(IP_WINDOW_MS).toBe(3_600_000);
    expect(IP_LOCK_MS).toBe(900_000);
  });
});
