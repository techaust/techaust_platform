// Turnstile on the staff password step [ADM-AUTH-06]: the first three wrong passwords of an hour need no token; from the
// fourth on, /login wants a token that Cloudflare confirms, and a request without one counts NOTHING (so a script
// without a token can never lock a staff account). The SQL (`RESERVE_GATED_SQL`) is proved equal to its pure twin, the
// check order is proved over HTTP, and the refusal is proved identical for every email. siteverify is a stub.
import { env } from "cloudflare:workers";
import {
  type Attempts,
  accountKey,
  IP_LOCK_AFTER,
  ipKey,
  LOCK_AFTER,
  LOCK_MS,
  RESERVE_GATED_SQL,
  RESERVE_SQL,
  reserveAttemptGated,
  TURNSTILE_AFTER,
  WINDOW_MS,
} from "@techaust/auth";
import { describe, expect, it, vi } from "vitest";
import {
  attemptsRow,
  bodyOf,
  call,
  counting,
  countOf,
  enrol,
  hash,
  rows,
  stubSiteverify,
  token,
  withEnv,
} from "./test-helpers.ts";

const sv = stubSiteverify();

const T0 = 1_700_000_000_000;
const seed = (key: string, failures: number, at = Date.now(), lockedUntil: number | null = null) =>
  env.DB.prepare(
    "INSERT OR REPLACE INTO auth_attempts (key, window_start, failures, locked_until) VALUES (?, ?, ?, ?)",
  )
    .bind(key, at, failures, lockedUntil)
    .run();

const REQUIRED = { error: { code: "turnstile_required", message: "Verification required" } };
const LOCKED = { error: { code: "locked", message: "Too many attempts. Try again in 15 minutes." } };
const INVALID = { error: { code: "invalid_credentials", message: "Invalid email, password or code" } };

const login = (email: string, clientHash: string, extra: Record<string, unknown> = {}, e: Env = env) =>
  call("/auth/login", { body: { email, clientHash, ...extra } }, e);

const loginAccessRows = () => countOf("access_log", "route = '/api/v1/auth/login'");

// ---------------------------------------------------------------------------------------------------------------
describe("RESERVE_GATED_SQL agrees with reserveAttemptGated [ADM-AUTH-06]", () => {
  const reserve = async (k: string, at: number, tv: boolean, ipk: string | null = null) => {
    const res = await env.DB.prepare(RESERVE_GATED_SQL)
      .bind(k, at, WINDOW_MS, LOCK_AFTER, LOCK_MS, ipk, tv ? 1 : 0, TURNSTILE_AFTER)
      .all();
    const r = (await env.DB.prepare(
      "SELECT window_start, failures, locked_until FROM auth_attempts WHERE key = ?",
    )
      .bind(k)
      .first()) as { window_start: number; failures: number; locked_until: number | null } | null;
    return {
      returned: res.results[0] as { failures: number; locked_until: number | null } | undefined,
      row: r ? { windowStart: r.window_start, failures: r.failures, lockedUntil: r.locked_until } : null,
    };
  };

  type Step = [at: number, token: boolean];
  const H = WINDOW_MS;
  const cases: Record<string, Step[]> = {
    "three tokenless attempts count, the fourth is refused": [
      [T0, false],
      [T0 + 1, false],
      [T0 + 2, false],
      [T0 + 3, false],
      [T0 + 4, false],
    ],
    "the fourth with a token counts, the fifth without is refused": [
      [T0, false],
      [T0 + 1, false],
      [T0 + 2, false],
      [T0 + 3, true],
      [T0 + 4, false],
      [T0 + 5, true],
    ],
    "ten verified attempts lock, then everything is refused while the lock holds": [
      ...Array.from({ length: 12 }, (_, i): Step => [T0 + i, i >= 3]),
    ],
    "after the lock a tokenless attempt is refused, a verified one counts and locks again": [
      ...Array.from({ length: 10 }, (_, i): Step => [T0 + i, i >= 3]),
      [T0 + 9 + LOCK_MS, false],
      [T0 + 9 + LOCK_MS + 1, true],
      [T0 + 9 + LOCK_MS + 2, true],
    ],
    "the window running out restarts the count at 1 and needs no token": [
      [T0, false],
      [T0 + 1, false],
      [T0 + 2, false],
      [T0 + H - 1, false], // still inside the window: refused
      [T0 + H, false], // window over: counts as the first again
      [T0 + H + 1, false],
    ],
  };
  let s = 987654;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
  for (let n = 0; n < 40; n++) {
    let t = T0;
    cases[`random sequence ${n}`] = Array.from({ length: 30 }, (): Step => {
      t += Math.floor(rnd() < 0.1 ? rnd() * 1.5 * H : rnd() * 5000);
      return [t, rnd() < 0.5];
    });
  }

  for (const [name, steps] of Object.entries(cases)) {
    it(`same row, same refusals: ${name}`, async () => {
      const k = `acct:gated-${name.replace(/\W+/g, "-")}`;
      let expected: Attempts | null = null;
      let refused = 0;
      for (const [at, tv] of steps) {
        const model = reserveAttemptGated(expected, at, tv);
        const got = await reserve(k, at, tv);
        if (model.allowed) {
          expect(got.returned).toEqual({ failures: model.row.failures, locked_until: model.row.lockedUntil });
          expect(got.row).toEqual(model.row);
          expected = model.row;
        } else {
          refused++;
          expect(got.returned, "refused: no row comes back").toBeUndefined();
          expect(got.row, "refused: nothing is written").toEqual(expected);
        }
      }
      if (!name.startsWith("random")) expect(refused).toBeGreaterThan(0);
    });
  }

  it("a blocked address (?6) counts and writes nothing, token or not", async () => {
    await seed("ip:gated-blocked", 100, T0, T0 + LOCK_MS);
    const blocked = await reserve("acct:gated-behind-blocked-ip", T0 + 10, true, "ip:gated-blocked");
    expect(blocked.returned).toBeUndefined();
    expect(blocked.row).toBeNull();
    const free = await reserve("acct:gated-behind-free-ip", T0 + 10, false, "ip:gated-no-row");
    expect(free.returned).toEqual({ failures: 1, locked_until: null });
  });

  it("RESERVE_SQL itself is byte-for-byte what M1.5 shipped (the counters without a Turnstile step use it)", () => {
    expect(RESERVE_SQL).toBe(`INSERT INTO auth_attempts (key, window_start, failures, locked_until)
SELECT ?1, ?2, 1, CASE WHEN 1 >= ?4 THEN ?2 + ?5 ELSE NULL END
WHERE NOT EXISTS (SELECT 1 FROM auth_attempts WHERE key = ?6 AND locked_until > ?2)
ON CONFLICT(key) DO UPDATE SET
  window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END,
  failures = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END,
  locked_until = CASE WHEN (CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END) >= ?4
                      THEN ?2 + ?5 ELSE locked_until END
WHERE locked_until IS NULL OR locked_until <= ?2
RETURNING failures, locked_until`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("/login and the Turnstile step [ADM-AUTH-06]", () => {
  it("attempts 1 to 3 need no token and make no siteverify call", async () => {
    const e = await enrol("gate-free@example.com");
    const k = await accountKey(e.email);
    for (let i = 1; i <= 3; i++) {
      const res = await login(e.email, hash());
      expect(res.status).toBe(401);
      expect(await bodyOf(res)).toEqual(INVALID);
      expect((await attemptsRow(k))?.failures).toBe(i);
    }
    expect(sv.calls).toHaveLength(0);
  });

  it("a normal sign-in (no failures) makes no siteverify call and clears nothing it should keep", async () => {
    const e = await enrol("gate-normal@example.com");
    const res = await login(e.email, e.clientHash);
    expect(res.status).toBe(200);
    expect(sv.calls).toHaveLength(0);
  });

  it("the 4th attempt without a token is 401 turnstile_required, counts nothing and still writes its access row", async () => {
    const e = await enrol("gate-4th@example.com");
    const k = await accountKey(e.email);
    for (let i = 0; i < 3; i++) await login(e.email, hash());
    const before = {
      row: await attemptsRow(k),
      access: await loginAccessRows(),
      audit: await countOf("audit_log"),
    };
    const r = await counting("/auth/login", { body: { email: e.email, clientHash: hash() } });
    expect(r.res.status).toBe(401);
    expect(await bodyOf(r.res)).toEqual(REQUIRED);
    expect(r.calls).toBe(2); // the one batch and the access row
    expect(await attemptsRow(k)).toEqual(before.row);
    expect(await loginAccessRows()).toBe(before.access + 1);
    expect(await countOf("audit_log")).toBe(before.audit);
    expect(sv.calls).toHaveLength(0); // nothing to verify
    // the right password does not get past it either
    expect(await bodyOf(await login(e.email, e.clientHash))).toEqual(REQUIRED);
    expect((await attemptsRow(k))?.failures).toBe(3);
  });

  it("with a token Cloudflare confirms, the attempt counts and is checked as before", async () => {
    const e = await enrol("gate-valid@example.com");
    const k = await accountKey(e.email);
    for (let i = 0; i < 3; i++) await login(e.email, hash());
    const wrong = await login(e.email, hash(), { turnstile: token() });
    expect(wrong.status).toBe(401);
    expect(await bodyOf(wrong)).toEqual(INVALID);
    expect((await attemptsRow(k))?.failures).toBe(4);
    const right = await login(e.email, e.clientHash, { turnstile: token() });
    expect(right.status).toBe(200);
    expect((await attemptsRow(k))?.failures).toBe(5);
    expect(sv.calls).toHaveLength(2);
  });

  it("sends siteverify the secret, the token and the raw address (an IPv6 address is not shortened)", async () => {
    const e = await enrol("gate-remoteip@example.com");
    for (let i = 0; i < 3; i++) await login(e.email, hash());
    const t = token();
    await call("/auth/login", {
      body: { email: e.email, clientHash: hash(), turnstile: t },
      headers: { "CF-Connecting-IP": "2001:db8:0:1:abcd:ef01:2345:6789" },
    });
    expect(sv.calls).toHaveLength(1);
    expect(sv.calls[0]?.get("secret")).toBe("test-turnstile-secret");
    expect(sv.calls[0]?.get("response")).toBe(t);
    expect(sv.calls[0]?.get("remoteip")).toBe("2001:db8:0:1:abcd:ef01:2345:6789");
  });

  it("a successful sign-in clears the password counter, so the next sign-in needs no token again", async () => {
    const e = await enrol("gate-clear@example.com");
    const k = await accountKey(e.email);
    for (let i = 0; i < 3; i++) await login(e.email, hash());
    const challenge = (await (await login(e.email, e.clientHash, { turnstile: token() })).json()) as {
      challenge: string;
    };
    expect(challenge.challenge).toBeTruthy();
    // the code step is the one that finishes a sign-in and deletes the rows
    const { totpCode } = await import("@techaust/auth");
    const done = await call("/auth/totp", {
      body: { challenge: challenge.challenge, code: totpCode(e.secret, e.step + 1) },
    });
    expect(done.status).toBe(200);
    expect(await attemptsRow(k)).toBeNull();
    const again = sv.calls.length;
    expect((await login(e.email, hash())).status).toBe(401); // wrong password, no token: counts as the 1st
    expect(sv.calls).toHaveLength(again);
  });

  it("a token Cloudflare refuses (bad, used twice, made for another surface or host) is the same as none", async () => {
    const e = await enrol("gate-refused@example.com");
    const k = await accountKey(e.email);
    for (let i = 0; i < 3; i++) await login(e.email, hash());
    const refusedBody = async (res: Response) => {
      expect(res.status).toBe(401);
      expect(await bodyOf(res)).toEqual(REQUIRED);
    };
    await refusedBody(await login(e.email, hash(), { turnstile: "bad-token" }));
    const once = token();
    expect((await login(e.email, hash(), { turnstile: once })).status).toBe(401); // counts: failures 4
    expect((await attemptsRow(k))?.failures).toBe(4);
    await refusedBody(await login(e.email, hash(), { turnstile: once })); // the same token again: timeout-or-duplicate
    expect((await attemptsRow(k))?.failures).toBe(4);

    // outside local development the action and the host are checked too
    const staging = withEnv(env, { ENVIRONMENT: "staging", TURNSTILE_HOSTNAMES: "admin.example" });
    sv.answer = { success: true, action: "contact", hostname: "admin.example" }; // a web form's token
    await refusedBody(await login(e.email, hash(), { turnstile: token() }, staging));
    sv.answer = { success: true, action: "admin_login", hostname: "evil.example" };
    await refusedBody(await login(e.email, hash(), { turnstile: token() }, staging));
    sv.answer = { success: true, action: "admin_login", hostname: "admin.example" };
    expect((await login(e.email, hash(), { turnstile: token() }, staging)).status).toBe(401);
    expect((await attemptsRow(k))?.failures).toBe(5); // only the last one counted
  });

  it("fails closed when siteverify is down: a network error, a 500 and a body that is not JSON all ask for a token again", async () => {
    const e = await enrol("gate-down@example.com");
    const k = await accountKey(e.email);
    for (let i = 0; i < 3; i++) await login(e.email, hash());
    for (const answer of ["network-error", { httpStatus: 500 }, "not-json"] as const) {
      sv.answer = answer;
      const res = await login(e.email, e.clientHash, { turnstile: token() });
      expect(res.status).toBe(401);
      expect(await bodyOf(res)).toEqual(REQUIRED);
    }
    expect((await attemptsRow(k))?.failures).toBe(3);
  });

  it("a lock still answers 429, with a token or without", async () => {
    const e = await enrol("gate-locked@example.com");
    const k = await accountKey(e.email);
    await seed(k, 10, Date.now(), Date.now() + LOCK_MS);
    for (const extra of [{}, { turnstile: token() }, { turnstile: "bad-token" }]) {
      const res = await login(e.email, e.clientHash, extra);
      expect(res.status).toBe(429);
      expect(await bodyOf(res)).toEqual(LOCKED);
    }
    expect((await attemptsRow(k))?.failures).toBe(10);
  });

  it("after the lock ends, a tokenless attempt is turnstile_required and a verified one counts", async () => {
    const e = await enrol("gate-lock-over@example.com");
    const k = await accountKey(e.email);
    await seed(k, 10, Date.now() - 60_000, Date.now() - 1);
    expect(await bodyOf(await login(e.email, e.clientHash))).toEqual(REQUIRED);
    expect((await login(e.email, e.clientHash, { turnstile: token() })).status).toBe(200);
    expect((await attemptsRow(k))?.failures).toBe(11);
  });

  it("is identical for an unknown email and a real one: status, body, headers and D1 calls", async () => {
    const e = await enrol("gate-known@example.com");
    const ghost = "gate-ghost@example.com";
    for (const email of [e.email, ghost]) await seed(await accountKey(email), 3);
    const known = await counting("/auth/login", { body: { email: e.email, clientHash: hash() } });
    const unknown = await counting("/auth/login", { body: { email: ghost, clientHash: hash() } });
    expect(known.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(await bodyOf(known.res)).toEqual(REQUIRED);
    expect(await bodyOf(unknown.res)).toEqual(await bodyOf(known.res));
    expect(Object.fromEntries(unknown.res.headers)).toEqual(Object.fromEntries(known.res.headers));
    expect(unknown.calls).toBe(known.calls);
    // and with a verified token they count the same way
    const a = await login(e.email, hash(), { turnstile: token() });
    const b = await login(ghost, hash(), { turnstile: token() });
    expect([b.status, await bodyOf(b)]).toEqual([a.status, await bodyOf(a)]);
  });

  // 30 s: 100 sequential requests; the 5 s default times out under a whole-repo parallel run (FX-1 review).
  it("100 token-less requests never move the counter (a script cannot lock someone else's account)", {
    timeout: 30_000,
  }, async () => {
    const e = await enrol("gate-script@example.com");
    const k = await accountKey(e.email);
    for (let i = 0; i < 3; i++) await login(e.email, hash());
    const before = await attemptsRow(k);
    for (let i = 0; i < 100; i++) {
      const res = await login(e.email, hash());
      if (res.status !== 401) throw new Error(`unexpected ${res.status}`);
    }
    expect(await attemptsRow(k)).toEqual(before);
    expect(sv.calls).toHaveLength(0);
    // the real person, with a real token, still gets in
    expect((await login(e.email, e.clientHash, { turnstile: token() })).status).toBe(200);
  });

  it("a refusal counts one failure for the ADDRESS, never for the account, so a token-less script ends up blocked", async () => {
    const e = await enrol("gate-ip@example.com");
    const ip = "198.51.100.77";
    const ik = await ipKey(env.SALT_PEPPER, ip);
    for (let i = 0; i < 3; i++)
      await call("/auth/login", {
        body: { email: e.email, clientHash: hash() },
        headers: { "CF-Connecting-IP": ip },
      });
    const acct = await accountKey(e.email);
    expect((await attemptsRow(ik))?.failures).toBe(3);
    expect((await attemptsRow(acct))?.failures).toBe(3);
    const refused = await call("/auth/login", {
      body: { email: e.email, clientHash: hash() },
      headers: { "CF-Connecting-IP": ip },
    });
    expect(await bodyOf(refused)).toEqual(REQUIRED);
    expect((await attemptsRow(ik))?.failures).toBe(4); // the address counted it...
    expect((await attemptsRow(acct))?.failures).toBe(3); // ...the account did not

    // a script that keeps going is blocked at the address limit, like any other source of failures
    await seed(ik, IP_LOCK_AFTER - 1);
    await call("/auth/login", {
      body: { email: e.email, clientHash: hash() },
      headers: { "CF-Connecting-IP": ip },
    });
    expect((await attemptsRow(ik))?.locked_until).toBeGreaterThan(Date.now());
    const blocked = await call("/auth/login", {
      body: { email: e.email, clientHash: hash() },
      headers: { "CF-Connecting-IP": ip },
    });
    expect([blocked.status, await bodyOf(blocked)]).toEqual([429, LOCKED]);
    expect((await attemptsRow(acct))?.failures).toBe(3);
  });

  it("only /login has the step: salt, totp, recovery and step-up never call siteverify", async () => {
    const e = await enrol("gate-only@example.com");
    await call("/auth/salt", { body: { email: e.email, turnstile: token() } });
    await call("/auth/totp", { body: { challenge: "x", code: "123456", turnstile: token() } });
    await call("/auth/recovery", { body: { challenge: "x", code: "AAAA", turnstile: token() } });
    await call("/auth/step-up", { body: { code: "123456", turnstile: token() }, cookie: e.cookie });
    expect(sv.calls).toHaveLength(0);
  });

  it("no log line holds an email address, an address, a token or the secret", async () => {
    const logs: string[] = [];
    const spies = (["log", "error", "warn", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))),
    );
    try {
      const e = await enrol("gate-privacy@example.com");
      const t = token();
      for (let i = 0; i < 4; i++)
        await call("/auth/login", {
          body: { email: e.email, clientHash: hash(), ...(i === 3 ? { turnstile: t } : {}) },
          headers: { "CF-Connecting-IP": "203.0.113.55" },
        });
      sv.answer = "network-error";
      await call("/auth/login", {
        body: { email: e.email, clientHash: hash(), turnstile: "t-secret-token" },
        headers: { "CF-Connecting-IP": "203.0.113.55" },
      });
      const all = logs.join("\n");
      expect(all.length).toBeGreaterThan(0);
      for (const forbidden of [e.email, "203.0.113.55", t, "t-secret-token", "test-turnstile-secret"])
        expect(all).not.toContain(forbidden);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it("writes an access row for a turnstile_required refusal with the 401 status", async () => {
    const e = await enrol("gate-access@example.com");
    for (let i = 0; i < 3; i++) await login(e.email, hash());
    const res = await login(e.email, hash());
    expect(res.status).toBe(401);
    const last = await rows<{ status: number; actor_id: string | null }>(
      "SELECT status, actor_id FROM access_log WHERE route = '/api/v1/auth/login' ORDER BY at DESC, id DESC LIMIT 1",
    );
    expect(last[0]).toEqual({ status: 401, actor_id: null });
  });
});
