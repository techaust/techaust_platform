// Lockout [ADM-AUTH-06]: counters reserved atomically before an attempt is checked (`acct:` for passwords, `code:` for
// codes, `ip:` per address), proved equal to the pure model, and proved race-free with parallel requests.
import { env } from "cloudflare:workers";
import {
  type Attempts,
  accountKey,
  codeKey,
  IP_LOCK_AFTER,
  IP_LOCK_MS,
  IP_WINDOW_MS,
  ipKey,
  LOCK_AFTER,
  LOCK_MS,
  recordFailure,
  reserveAttempt,
  totpCode,
  WINDOW_MS,
} from "@techaust/auth";
import { describe, expect, it } from "vitest";
import { RESERVE_SQL } from "./auth.ts";
import {
  attemptsRow,
  barrierDb,
  bodyOf,
  call,
  challengeFor,
  counting,
  countOf,
  enrol,
  hash,
  rows,
  sessionFor,
  userId,
  withDb,
  wrongCode,
} from "./test-helpers.ts";

const T0 = 1_700_000_000_000;
const H = WINDOW_MS;
const seed = (key: string, failures: number, at = Date.now(), lockedUntil: number | null = null) =>
  env.DB.prepare(
    "INSERT OR REPLACE INTO auth_attempts (key, window_start, failures, locked_until) VALUES (?, ?, ?, ?)",
  )
    .bind(key, at, failures, lockedUntil)
    .run();

// ---------------------------------------------------------------------------------------------------------------
describe("RESERVE_SQL agrees with reserveAttempt [ADM-AUTH-06]", () => {
  type Row = Attempts;
  const reserve = async (k: string, at: number, lockAfter = LOCK_AFTER, ipk: string | null = null) => {
    const res = await env.DB.prepare(RESERVE_SQL).bind(k, at, WINDOW_MS, lockAfter, LOCK_MS, ipk).all();
    const r = (await env.DB.prepare(
      "SELECT window_start, failures, locked_until FROM auth_attempts WHERE key = ?",
    )
      .bind(k)
      .first()) as { window_start: number; failures: number; locked_until: number | null } | null;
    return {
      returned: res.results[0] as { failures: number; locked_until: number | null } | undefined,
      row: r
        ? ({ windowStart: r.window_start, failures: r.failures, lockedUntil: r.locked_until } as Row)
        : null,
    };
  };

  // M1.4's eight hand-written sequences, then forty seeded random ones (gaps from 0 ms to 1.5 windows).
  const cases: Record<string, number[]> = {
    "first attempt only": [T0],
    "9 then lock at the 10th": Array.from({ length: 10 }, (_, i) => T0 + i * 1000),
    "11 attempts: the 11th is refused, nothing counted": Array.from({ length: 11 }, (_, i) => T0 + i * 1000),
    "window expires exactly at WINDOW_MS (>=): restarts at 1": [T0, T0 + H],
    "one ms before the window ends: still counts": [T0, T0 + H - 1],
    "9 attempts, window passes, then 9 more: no lock": [
      ...Array.from({ length: 9 }, (_, i) => T0 + i),
      ...Array.from({ length: 9 }, (_, i) => T0 + H + 10 + i),
    ],
    "lock, window passes, a fresh attempt keeps the old locked_until": [
      ...Array.from({ length: 10 }, (_, i) => T0 + i),
      T0 + H + 50,
    ],
    "lock, then more attempts after the window and a second lock": [
      ...Array.from({ length: 10 }, (_, i) => T0 + i),
      ...Array.from({ length: 10 }, (_, i) => T0 + 2 * H + i),
    ],
    "lock expires after 15 minutes: one attempt, then locked again": [
      ...Array.from({ length: 10 }, (_, i) => T0 + i),
      T0 + 9 + LOCK_MS - 1, // still locked: refused
      T0 + 9 + LOCK_MS, // the lock has just ended: counted, and it locks again (11 >= 10)
      T0 + 9 + LOCK_MS + 1, // refused
    ],
  };
  let s = 12345;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
  for (let n = 0; n < 40; n++) {
    let t = T0;
    cases[`random sequence ${n}`] = Array.from({ length: 30 }, () => {
      t += Math.floor(rnd() < 0.1 ? rnd() * 1.5 * H : rnd() * 5000);
      return t;
    });
  }

  for (const [name, times] of Object.entries(cases)) {
    it(`same row, same refusals: ${name}`, async () => {
      const k = `acct:eq-${name.replace(/\W+/g, "-")}`;
      let expected: Row | null = null;
      let refused = 0;
      for (const at of times) {
        const model = reserveAttempt(expected, at);
        const got = await reserve(k, at);
        if (model.allowed) {
          expect(got.returned).toEqual({ failures: model.row.failures, locked_until: model.row.lockedUntil });
          expect(got.row).toEqual(model.row);
          expected = model.row;
        } else {
          refused++;
          expect(got.returned, "locked: no row comes back").toBeUndefined();
          expect(got.row, "locked: nothing is written").toEqual(expected);
        }
      }
      if (name.startsWith("11 attempts") || name.startsWith("lock expires"))
        expect(refused).toBeGreaterThan(0);
    });
  }

  it("a locked row: no row returned and no write, whatever the other bound values", async () => {
    const k = "acct:eq-locked";
    await seed(k, 10, T0, T0 + LOCK_MS);
    const got = await reserve(k, T0 + 1000);
    expect(got.returned).toBeUndefined();
    expect(got.row).toEqual({ windowStart: T0, failures: 10, lockedUntil: T0 + LOCK_MS });
  });

  it("with lock-after = 1 the very first attempt already locks, as in reserveAttempt", async () => {
    const k = "acct:eq-lock-after-1";
    const got = await reserve(k, T0, 1);
    const model = reserveAttempt(null, T0, 1);
    expect(model.allowed && model.lockStarted).toBe(true);
    expect(got.returned).toEqual({ failures: 1, locked_until: T0 + LOCK_MS });
    expect((await reserve(k, T0 + 1, 1)).returned).toBeUndefined(); // now locked
  });

  it("a blocked address (?6) counts and writes nothing; a free one doesn't matter", async () => {
    await seed("ip:blocked", 100, T0, T0 + LOCK_MS);
    const blocked = await reserve("acct:behind-blocked-ip", T0 + 10, LOCK_AFTER, "ip:blocked");
    expect(blocked.returned).toBeUndefined();
    expect(blocked.row).toBeNull();
    const free = await reserve("acct:behind-free-ip", T0 + 10, LOCK_AFTER, "ip:no-row");
    expect(free.returned).toEqual({ failures: 1, locked_until: null });
  });

  it("the model's lock start flag is exactly 'this attempt reached the limit'", () => {
    let a: Attempts | null = null;
    for (let i = 1; i <= 12; i++) {
      const r = reserveAttempt(a, T0 + i);
      if (!r.allowed) {
        expect(i).toBeGreaterThan(LOCK_AFTER);
        continue;
      }
      expect(r.lockStarted).toBe(r.row.failures >= LOCK_AFTER);
      expect(r.row).toEqual(recordFailure(a, T0 + i));
      a = r.row;
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("account lockout over HTTP [ADM-AUTH-06]", () => {
  it("10 wrong passwords lock /login: the 11th is 429 even with the right password", async () => {
    const e = await enrol("lock-pw@example.com");
    for (let i = 0; i < 10; i++)
      expect((await call("/auth/login", { body: { email: e.email, clientHash: hash() } })).status).toBe(401);
    const res = await call("/auth/login", { body: { email: e.email, clientHash: e.clientHash } });
    expect(res.status).toBe(429);
    expect(await bodyOf(res)).toEqual({
      error: { code: "locked", message: "Too many attempts. Try again in 15 minutes." },
    });
    expect((await attemptsRow(await accountKey(e.email)))?.failures).toBe(10);
  });

  it("10 wrong codes lock /totp, /recovery and step-up, even for the right code", async () => {
    const e = await enrol("lock-code@example.com");
    const id = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    for (let i = 0; i < 10; i++)
      expect((await call("/auth/totp", { body: { challenge, code: wrongCode(e.secret) } })).status).toBe(401);
    expect((await attemptsRow(codeKey(id)))?.failures).toBe(10);
    const sessions = await countOf("staff_sessions", "user_id = ?", id);

    const right = totpCode(e.secret, e.step + 1);
    expect((await call("/auth/totp", { body: { challenge, code: right } })).status).toBe(429);
    const recovery = await call("/auth/recovery", { body: { challenge, code: e.recoveryCodes[0] } });
    expect(recovery.status).toBe(429);
    const stepUp = await call("/auth/step-up", { body: { code: right }, cookie: e.cookie });
    expect(stepUp.status).toBe(429);
    expect(await countOf("staff_sessions", "user_id = ?", id)).toBe(sessions); // nothing was signed in
    // The recovery code was not used up by the refused request.
    expect(await countOf("staff_recovery_codes", "user_id = ? AND used_at IS NOT NULL", id)).toBe(0);
  });

  it("mixing wrong passwords and wrong codes: each kind has its own counter of 10", async () => {
    const e = await enrol("lock-mixed@example.com");
    const id = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash); // counts 1 password attempt
    for (let i = 0; i < 5; i++) await call("/auth/login", { body: { email: e.email, clientHash: hash() } });
    for (let i = 0; i < 5; i++) await call("/auth/totp", { body: { challenge, code: wrongCode(e.secret) } });
    expect((await attemptsRow(await accountKey(e.email)))?.failures).toBe(6);
    expect((await attemptsRow(codeKey(id)))?.failures).toBe(5);
    expect((await call("/auth/login", { body: { email: e.email, clientHash: e.clientHash } })).status).toBe(
      200,
    );
  });

  it("the lock lasts 15 minutes, then one verified attempt is allowed, then it is locked again", async () => {
    const e = await enrol("lock-expiry@example.com");
    const k = await accountKey(e.email);
    for (let i = 0; i < 10; i++) await call("/auth/login", { body: { email: e.email, clientHash: hash() } });
    expect((await call("/auth/login", { body: { email: e.email, clientHash: e.clientHash } })).status).toBe(
      429,
    );
    // The 15 minutes pass (the lock end moves into the past).
    await env.DB.prepare("UPDATE auth_attempts SET locked_until = ? WHERE key = ?")
      .bind(Date.now() - 1, k)
      .run();
    const once = await call("/auth/login", { body: { email: e.email, clientHash: e.clientHash } });
    expect(once.status).toBe(200); // verified: the right password gets its challenge
    expect((await attemptsRow(k))?.failures).toBe(11); // but the attempt was counted, and the lock is back
    expect((await call("/auth/login", { body: { email: e.email, clientHash: e.clientHash } })).status).toBe(
      429,
    );
    expect((await attemptsRow(k))?.locked_until).toBeGreaterThan(Date.now());
  });

  it("an unknown email locks like a real account: the 11th login is 429 with the same body", async () => {
    const email = "ghost-lock@example.com";
    for (let i = 0; i < 10; i++)
      expect((await call("/auth/login", { body: { email, clientHash: hash() } })).status).toBe(401);
    const ghost = await counting("/auth/login", { body: { email, clientHash: hash() } });
    expect(ghost.res.status).toBe(429);
    const real = await enrol("real-lock@example.com");
    for (let i = 0; i < 10; i++)
      await call("/auth/login", { body: { email: real.email, clientHash: hash() } });
    const locked = await counting("/auth/login", {
      body: { email: real.email, clientHash: real.clientHash },
    });
    expect(locked.res.status).toBe(429);
    expect(await bodyOf(ghost.res)).toEqual(await bodyOf(locked.res));
    expect(ghost.calls).toBe(locked.calls);
  });

  it("locked /totp is one batch plus the access row (2 calls), and writes no session", async () => {
    const e = await enrol("locked-totp@example.com");
    const id = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    await seed(codeKey(id), 10, Date.now(), Date.now() + LOCK_MS);
    const r = await counting("/auth/totp", { body: { challenge, code: totpCode(e.secret, e.step + 1) } });
    expect([r.res.status, r.calls]).toEqual([429, 2]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the per-address counter [ADM-AUTH-06]", () => {
  const from = (ip: string) => ({ "CF-Connecting-IP": ip });

  it("counts failures only, and 100 an hour block the address for 15 minutes", async () => {
    const ip = "198.51.100.7";
    const k = await ipKey(env.SALT_PEPPER, ip);
    const other = await sessionFor("staff", { password: true });
    await seed(k, IP_LOCK_AFTER - 1);
    // One more failure (any account, even an unknown one) reaches the limit.
    const wrong = await call("/auth/login", {
      body: { email: "nobody-ip@example.com", clientHash: hash() },
      headers: from(ip),
    });
    expect(wrong.status).toBe(401);
    const row = await attemptsRow(k);
    expect(row?.failures).toBe(IP_LOCK_AFTER);
    expect(row?.locked_until).toBeGreaterThan(Date.now() + IP_LOCK_MS - 5_000);

    // Now every request from that address is refused, even a correct password for another account, and writes nothing.
    const before = {
      attempts: await countOf("auth_attempts"),
      access: await countOf("access_log"),
      audit: await countOf("audit_log"),
    };
    const blocked = await counting("/auth/login", {
      body: { email: other.email, clientHash: other.clientHash },
      headers: from(ip),
    });
    expect([blocked.res.status, blocked.calls]).toEqual([429, 1]);
    expect(await bodyOf(blocked.res)).toEqual({
      error: { code: "locked", message: "Too many attempts. Try again in 15 minutes." },
    });
    expect({
      attempts: await countOf("auth_attempts"),
      access: await countOf("access_log"),
      audit: await countOf("audit_log"),
    }).toEqual(before);
    expect(await attemptsRow(await accountKey(other.email))).toBeNull(); // not even the account counter

    // Another address is unaffected.
    expect(
      (
        await call("/auth/login", {
          body: { email: other.email, clientHash: other.clientHash },
          headers: from("198.51.100.8"),
        })
      ).status,
    ).toBe(200);
  });

  it("a successful sign-in is not a failure for the address", async () => {
    const ip = "198.51.100.20";
    const u = await sessionFor("staff", { password: true });
    for (let i = 0; i < 3; i++) {
      const res = await call("/auth/login", {
        body: { email: u.email, clientHash: u.clientHash },
        headers: from(ip),
      });
      expect(res.status).toBe(200);
    }
    expect(await attemptsRow(await ipKey(env.SALT_PEPPER, ip))).toBeNull();
  });

  it("the address key is an HMAC: the raw address is stored nowhere in auth_attempts", async () => {
    const ip = "198.51.100.30";
    await call("/auth/login", { body: { email: "who@example.com", clientHash: hash() }, headers: from(ip) });
    const keys = (await rows<{ key: string }>("SELECT key FROM auth_attempts")).map((r) => r.key);
    expect(keys.some((x) => x.includes(ip))).toBe(false);
    expect(await ipKey(env.SALT_PEPPER, ip)).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(IP_WINDOW_MS).toBe(WINDOW_MS);
  });

  it("a blocked address is refused at /totp too, before anything is written", async () => {
    const ip = "198.51.100.40";
    const e = await enrol("ip-totp@example.com");
    const id = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    await seed(await ipKey(env.SALT_PEPPER, ip), 100, Date.now(), Date.now() + LOCK_MS);
    const r = await counting("/auth/totp", {
      body: { challenge, code: totpCode(e.secret, e.step + 1) },
      headers: from(ip),
    });
    expect([r.res.status, r.calls]).toEqual([429, 1]);
    expect(await attemptsRow(codeKey(id))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("parallel attempts can't slip past the lock (the M1.4 pre-read finding) [ADM-AUTH-06]", () => {
  const parallel = (n: number, run: (e: Env) => Promise<Response>) => {
    const e = withDb(barrierDb(env.DB, n));
    return Promise.all(Array.from({ length: n }, () => run(e)));
  };
  const statuses = (rs: Response[]) => rs.map((r) => r.status).sort();

  it("9 failures, then 5 parallel wrong /login: exactly 1 x 401 and 4 x 429, failures = 10, locked", async () => {
    const e = await enrol("race-login@example.com");
    const k = await accountKey(e.email);
    await seed(k, 9);
    const rs = await parallel(5, (env_) =>
      call("/auth/login", { body: { email: e.email, clientHash: hash() } }, env_),
    );
    expect(statuses(rs)).toEqual([401, 429, 429, 429, 429]);
    const row = await attemptsRow(k);
    expect(row?.failures).toBe(10);
    expect(row?.locked_until).toBeGreaterThan(Date.now());
  });

  it("9 failures, then 5 parallel wrong /totp: exactly 1 x 401 and 4 x 429, failures = 10, locked", async () => {
    const e = await enrol("race-totp@example.com");
    const id = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    await seed(codeKey(id), 9);
    await seed(await accountKey(e.email), 9); // what M1.4's /totp read; the new /totp doesn't look at it
    const rs = await parallel(5, (env_) =>
      call("/auth/totp", { body: { challenge, code: wrongCode(e.secret) } }, env_),
    );
    expect(statuses(rs)).toEqual([401, 429, 429, 429, 429]);
    const row = await attemptsRow(codeKey(id));
    expect(row?.failures).toBe(10);
    expect(row?.locked_until).toBeGreaterThan(Date.now());
  });

  it("10 parallel wrong logins add exactly 10 failures and lock the account (no lost update)", async () => {
    const e = await enrol("race-ten@example.com");
    const rs = await parallel(10, (env_) =>
      call("/auth/login", { body: { email: e.email, clientHash: hash() } }, env_),
    );
    expect(statuses(rs)).toEqual(Array(10).fill(401));
    const row = await attemptsRow(await accountKey(e.email));
    expect(row?.failures).toBe(10);
    expect(row?.locked_until).toBeGreaterThan(Date.now());
    expect((await call("/auth/login", { body: { email: e.email, clientHash: e.clientHash } })).status).toBe(
      429,
    );
  });

  it("the same code in two parallel /totp: one 200, one 401 with the same body; one session, one login row, no counter left", async () => {
    const e = await enrol("race-code@example.com");
    const id = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    const [sessions, logins] = [
      await countOf("staff_sessions", "user_id = ?", id),
      await countOf("audit_log", "action = 'auth.login' AND actor_id = ?", id),
    ];
    const rs = await parallel(2, (env_) =>
      call("/auth/totp", { body: { challenge, code: totpCode(e.secret, e.step + 1) } }, env_),
    );
    expect(statuses(rs)).toEqual([200, 401]);
    const lost = rs.find((r) => r.status === 401) as Response;
    expect(await bodyOf(lost)).toEqual({
      error: { code: "invalid_credentials", message: "Invalid email, password or code" },
    });
    expect(await countOf("staff_sessions", "user_id = ?", id)).toBe(sessions + 1);
    expect(await countOf("audit_log", "action = 'auth.login' AND actor_id = ?", id)).toBe(logins + 1);
    expect(await attemptsRow(codeKey(id))).toBeNull();
    expect(await attemptsRow(await accountKey(e.email))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("alert.lockout [ADM-AUTH-09]", () => {
  const alerts = (id: string) =>
    rows<{ summary: string; actor_type: string; actor_id: string | null }>(
      "SELECT summary, actor_type, actor_id FROM audit_log WHERE action = 'alert.lockout' AND entity_id = ?",
      id,
    );

  it("one alert row when a lock starts on a real account, none for an unknown email, none afterwards", async () => {
    const e = await enrol("alert-lock@example.com");
    const id = await userId(e.email);
    for (let i = 0; i < 9; i++) await call("/auth/login", { body: { email: e.email, clientHash: hash() } });
    expect(await alerts(id)).toHaveLength(0);
    const tenth = await counting("/auth/login", {
      body: { email: e.email, clientHash: hash() },
      headers: { "User-Agent": "TestAgent/1.0" },
    });
    expect([tenth.res.status, tenth.calls]).toEqual([401, 2]); // the alert rides in the same batch: no extra call
    const found = await alerts(id);
    expect(found).toHaveLength(1);
    expect(found[0]?.actor_type).toBe("system");
    expect(JSON.parse(found[0]?.summary as string)).toEqual({
      ua: "TestAgent/1.0",
      country: null,
      city: null,
    });
    await call("/auth/login", { body: { email: e.email, clientHash: hash() } }); // 429: nothing new
    expect(await alerts(id)).toHaveLength(1);

    const before = await countOf("audit_log", "action = 'alert.lockout'");
    const ghost = "ghost-alert@example.com";
    for (let i = 0; i < 11; i++) await call("/auth/login", { body: { email: ghost, clientHash: hash() } });
    expect(await countOf("audit_log", "action = 'alert.lockout'")).toBe(before);
  });

  it("a lock started by wrong codes raises one alert too, and never holds a secret", async () => {
    const e = await enrol("alert-code@example.com");
    const id = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    for (let i = 0; i < 10; i++) await call("/auth/totp", { body: { challenge, code: wrongCode(e.secret) } });
    const found = await alerts(id);
    expect(found).toHaveLength(1);
    const text = JSON.stringify(
      await rows("SELECT * FROM audit_log WHERE action LIKE 'alert.%' AND entity_id = ?", id),
    );
    for (const secret of [
      e.clientHash,
      challenge,
      e.cookie.split("=")[1] as string,
      e.recoveryCodes[0] as string,
    ])
      expect(text).not.toContain(secret);
  });
});
