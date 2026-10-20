import { env, exports } from "cloudflare:workers";
import {
  type Attempts,
  b64url,
  currentStep,
  enc,
  fromB64url,
  hex,
  LOCK_AFTER,
  LOCK_MS,
  newToken,
  randomBytes,
  recordFailure,
  secretFromBase32,
  sha256,
  signChallenge,
  tokenHash,
  totpCode,
  WINDOW_MS,
} from "@techaust/auth";
import { describe, expect, it, vi } from "vitest";
import { FAIL_SQL, LOGIN_READ, startSession, TOTP_READ } from "./auth.ts";
import app from "./index.ts";

const BASE = "https://admin.example/api/v1/auth";
const post = (path: string, body: unknown, cookie?: string) =>
  exports.default.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://admin.example",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const hash = () => b64url(randomBytes(32));

async function invite(email: string, role = "owner") {
  const token = newToken();
  await env.DB.prepare("INSERT INTO staff_invites (token_hash, email, role, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await tokenHash(token), email, role, Date.now() + 60_000)
    .run();
  return token;
}

/** Walk an invite through enrolment; returns the client hash, TOTP secret and the step used. */
async function enrol(email: string) {
  const token = await invite(email);
  const start = (await (await post("/invite/start", { token })).json()) as { email: string; salt: string };
  expect(start.email).toBe(email);
  const clientHash = hash();
  const finish = (await (await post("/invite/finish", { token, clientHash })).json()) as {
    secret: string;
    challenge: string;
    totpUri: string;
  };
  expect(finish.totpUri).toMatch(/^otpauth:\/\/totp\/TecHaust:/);
  const secret = secretFromBase32(finish.secret);
  const step = currentStep(Date.now());
  const res = await post("/invite/totp", { challenge: finish.challenge, code: totpCode(secret, step) });
  expect(res.status).toBe(200);
  expect(res.headers.get("Set-Cookie")).toMatch(
    /^__Host-ta_admin=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict/,
  );
  return { clientHash, secret, step, token };
}

async function login(email: string, clientHash: string, secret: Uint8Array, step: number) {
  const salt = await post("/salt", { email });
  expect(salt.status).toBe(200);
  const l = await post("/login", { email, clientHash });
  if (l.status !== 200) return { status: l.status, cookie: null };
  const { challenge } = (await l.json()) as { challenge: string };
  const t = await post("/totp", { challenge, code: totpCode(secret, step) });
  return { status: t.status, cookie: t.headers.get("Set-Cookie")?.split(";")[0] ?? null };
}

describe("staff login (docs/05 §6.1) [ADM-AUTH-01, -02, -05, -07]", () => {
  it("invite → password → TOTP → active owner with a session; the invite is single-use", async () => {
    const { token } = await enrol("owner@example.com");
    const user = await env.DB.prepare("SELECT status, role, totp_enabled_at FROM staff_users WHERE email = ?")
      .bind("owner@example.com")
      .first();
    expect(user).toMatchObject({ status: "active", role: "owner" });
    expect((await post("/invite/start", { token })).status).toBe(400);
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'auth.login'").first(),
    ).toEqual({ n: 1 });
  });

  it("logs in with the right hash and code, then /me and logout work", async () => {
    const { clientHash, secret, step } = await enrol("staff1@example.com");
    const ok = await login("staff1@example.com", clientHash, secret, step + 1);
    expect(ok.status).toBe(200);
    const me = await exports.default.fetch(`${BASE}/me`, { headers: { Cookie: ok.cookie as string } });
    expect(await me.json()).toEqual({
      user: { name: "staff1@example.com", email: "staff1@example.com", role: "owner" },
    });
    await post("/logout", {}, ok.cookie as string);
    const after = await exports.default.fetch(`${BASE}/me`, { headers: { Cookie: ok.cookie as string } });
    expect(after.status).toBe(401);
  });

  it("refuses a replayed TOTP code", async () => {
    const { clientHash, secret, step } = await enrol("staff2@example.com");
    expect((await login("staff2@example.com", clientHash, secret, step)).status).toBe(401); // used at enrolment
  });

  it("gives identical answers for unknown emails and wrong passwords (no enumeration)", async () => {
    const { secret, step } = await enrol("staff3@example.com");
    const unknown = await post("/salt", { email: "nobody@example.com" });
    const again = await post("/salt", { email: "nobody@example.com" });
    const a = (await unknown.json()) as { salt: string };
    expect(a).toEqual(await again.json());
    expect(a.salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const wrong = await login("staff3@example.com", hash(), secret, step + 1);
    const none = await login("nobody@example.com", hash(), secret, step + 1);
    expect([wrong.status, none.status]).toEqual([401, 401]);
  });

  it("locks an account after 10 failures in an hour", async () => {
    const { clientHash, secret, step } = await enrol("staff4@example.com");
    for (let i = 0; i < 10; i++)
      expect((await post("/login", { email: "staff4@example.com", clientHash: hash() })).status).toBe(401);
    expect((await post("/login", { email: "staff4@example.com", clientHash })).status).toBe(429);
    expect((await login("staff4@example.com", clientHash, secret, step + 1)).status).toBe(429);
  });

  it("rejects malformed, oversized and cross-site requests", async () => {
    expect((await post("/login", { email: "x" })).status).toBe(400);
    expect((await post("/login", { email: "a@b.co", clientHash: "x".repeat(20_000) })).status).toBe(413);
    const form = await exports.default.fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example" },
      body: "email=a@b.co",
    });
    expect(form.status).toBe(403);
    const res = await post("/totp", { challenge: "forged.challenge", code: "123456" });
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// M1.4 CPU tuning: D1 call budget per route, shared lockout, failure clearing, replay, challenge checks, log line.
// Every D1 call runs binding code inside the isolate, so the number of calls is what the Free plan's CPU budget
// tracks [ADM-AUTH-01, -02, -05].

type Counted = { env: Env; calls: () => number };

/** `env` with a DB whose first/run/all/raw/batch calls are counted (a batch counts once, as it does on D1). */
function counted(): Counted {
  let n = 0;
  class Stmt {
    constructor(readonly real: D1PreparedStatement) {}
    bind(...v: unknown[]) {
      return new Stmt(this.real.bind(...v));
    }
    first(...a: unknown[]) {
      n++;
      return (this.real.first as (...x: unknown[]) => unknown)(...a);
    }
    run() {
      n++;
      return this.real.run();
    }
    all() {
      n++;
      return this.real.all();
    }
    raw(...a: unknown[]) {
      n++;
      return (this.real.raw as (...x: unknown[]) => unknown)(...a);
    }
  }
  const db = {
    prepare: (q: string) => new Stmt(env.DB.prepare(q)),
    batch: (stmts: Stmt[]) => {
      n++;
      return env.DB.batch(stmts.map((x) => x.real));
    },
  } as unknown as D1Database;
  const wrapped = new Proxy(env, { get: (t, k) => (k === "DB" ? db : Reflect.get(t, k)) }) as Env;
  return { env: wrapped, calls: () => n };
}

type CallInit = { body?: unknown; cookie?: string; method?: string };
const call = (path: string, init: CallInit, e: Env = env) =>
  app.request(
    `https://admin.example/api/v1/auth${path}`,
    {
      method: init.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://admin.example",
        ...(init.cookie ? { Cookie: init.cookie } : {}),
      },
      body: init.body === undefined ? null : JSON.stringify(init.body),
    },
    e,
  );

/** One counted request: its response and how many D1 calls it made. */
async function counting(path: string, init: CallInit) {
  const c = counted();
  const res = await call(path, init, c.env);
  return { res, calls: c.calls() };
}

const key = async (email: string) => `acct:${hex(await sha256(enc.encode(email))).slice(0, 32)}`;
const attemptsRow = (k: string) =>
  env.DB.prepare("SELECT failures, locked_until FROM auth_attempts WHERE key = ?")
    .bind(k)
    .first<{ failures: number; locked_until: number | null }>();
const count = async (table: "staff_sessions" | "audit_log") =>
  ((await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()) as { n: number }).n;
const userId = async (email: string) =>
  ((await env.DB.prepare("SELECT id FROM staff_users WHERE email = ?").bind(email).first()) as { id: string })
    .id;

async function challengeFor(email: string, clientHash: string) {
  const res = await call("/login", { body: { email, clientHash } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { challenge: string }).challenge;
}

/** A 6-digit code that is valid for none of the steps the server would try. */
function wrongCode(secret: Uint8Array) {
  const now = currentStep(Date.now());
  const valid = new Set([-2, -1, 0, 1, 2].map((d) => totpCode(secret, now + d)));
  for (let i = 0; ; i++) {
    const c = String(i).padStart(6, "0");
    if (!valid.has(c)) return c;
  }
}

const INVALID_BODY = { error: { code: "invalid_credentials", message: "Invalid email, password or code" } };

describe("auth CPU tuning: D1 calls per route [ADM-AUTH-01, -02, -05]", () => {
  it("salt 1, login ok 1, login fail 2, totp wrong 2, totp ok 2, me 1, totp replay 2", async () => {
    const email = "budget@example.com";
    const { clientHash, secret, step } = await enrol(email);

    expect((await counting("/salt", { body: { email } })).calls).toBe(1);

    const badLogin = await counting("/login", { body: { email, clientHash: hash() } });
    expect([badLogin.res.status, badLogin.calls]).toEqual([401, 2]);

    const okLogin = await counting("/login", { body: { email, clientHash } });
    expect([okLogin.res.status, okLogin.calls]).toEqual([200, 1]);
    const { challenge } = (await okLogin.res.json()) as { challenge: string };

    const wrong = await counting("/totp", { body: { challenge, code: wrongCode(secret) } });
    expect([wrong.res.status, wrong.calls]).toEqual([401, 2]);

    const good = await counting("/totp", { body: { challenge, code: totpCode(secret, step + 1) } });
    expect([good.res.status, good.calls]).toEqual([200, 2]);
    const cookie = good.res.headers.get("Set-Cookie")?.split(";")[0] as string;

    const me = await counting("/me", { method: "GET", cookie });
    expect([me.res.status, me.calls]).toEqual([200, 1]);

    const replay = await counting("/totp", { body: { challenge, code: totpCode(secret, step + 1) } });
    expect([replay.res.status, replay.calls]).toEqual([401, 2]);
  });

  it("a locked login makes 1 call and answers 429", async () => {
    const email = "budget-locked@example.com";
    const { clientHash } = await enrol(email);
    for (let i = 0; i < 10; i++) await call("/login", { body: { email, clientHash: hash() } });
    const locked = await counting("/login", { body: { email, clientHash } });
    expect([locked.res.status, locked.calls]).toEqual([429, 1]);
  });

  it("unknown emails take the same 2 calls as a wrong password, with the same answer", async () => {
    const none = await counting("/login", { body: { email: "ghost@example.com", clientHash: hash() } });
    expect([none.res.status, none.calls]).toEqual([401, 2]);
    expect(await none.res.json()).toEqual(INVALID_BODY);
  });
});

describe("auth CPU tuning: lockout and counters [ADM-AUTH-02]", () => {
  it("10 failures mixing wrong passwords and wrong codes lock both /login and /totp", async () => {
    const email = "mixed@example.com";
    const { clientHash, secret, step } = await enrol(email);
    const challenge = await challengeFor(email, clientHash);
    for (let i = 0; i < 5; i++)
      expect((await call("/login", { body: { email, clientHash: hash() } })).status).toBe(401);
    for (let i = 0; i < 5; i++)
      expect((await call("/totp", { body: { challenge, code: wrongCode(secret) } })).status).toBe(401);
    expect((await attemptsRow(await key(email)))?.failures).toBe(10);
    expect((await call("/login", { body: { email, clientHash } })).status).toBe(429);
    // Even the right code is refused while locked, and no session is made.
    const sessions = await count("staff_sessions");
    expect((await call("/totp", { body: { challenge, code: totpCode(secret, step + 1) } })).status).toBe(429);
    expect(await count("staff_sessions")).toBe(sessions);
  });

  it("a successful /totp clears the failure counter", async () => {
    const email = "clears@example.com";
    const { clientHash, secret, step } = await enrol(email);
    for (let i = 0; i < 3; i++) await call("/login", { body: { email, clientHash: hash() } });
    expect((await attemptsRow(await key(email)))?.failures).toBe(3);
    const challenge = await challengeFor(email, clientHash);
    const res = await call("/totp", { body: { challenge, code: totpCode(secret, step + 1) } });
    expect(res.status).toBe(200);
    expect(await attemptsRow(await key(email))).toBeNull();
  });

  it("a replayed code is refused, adds one failure, and makes no session or audit row", async () => {
    const email = "replay@example.com";
    const { clientHash, secret, step } = await enrol(email); // `step` was used at enrolment
    const challenge = await challengeFor(email, clientHash);
    const [sessions, audits] = [await count("staff_sessions"), await count("audit_log")];
    const res = await call("/totp", { body: { challenge, code: totpCode(secret, step) } });
    expect(res.status).toBe(401);
    expect((await attemptsRow(await key(email)))?.failures).toBe(1);
    expect([await count("staff_sessions"), await count("audit_log")]).toEqual([sessions, audits]);
  });

  it("startSession clears the counter only when the replay guard moved (the changes() = 1 guard)", async () => {
    const email = "guard@example.com";
    const { step } = await enrol(email); // last step = `step`
    const id = await userId(email);
    const k = await key(email);
    const seed = () =>
      env.DB.prepare("INSERT OR REPLACE INTO auth_attempts (key, window_start, failures) VALUES (?, ?, 4)")
        .bind(k, Date.now())
        .run();
    const [sessions, audits] = [await count("staff_sessions"), await count("audit_log")];

    await seed();
    expect(await startSession(env.DB, id, null, null, step, k)()).toBeNull(); // a stale step: no session
    expect((await attemptsRow(k))?.failures).toBe(4);
    expect([await count("staff_sessions"), await count("audit_log")]).toEqual([sessions, audits]);

    expect(await startSession(env.DB, id, null, null, step + 1, k)()).not.toBeNull();
    expect(await attemptsRow(k)).toBeNull();
    expect([await count("staff_sessions"), await count("audit_log")]).toEqual([sessions + 1, audits + 1]);
  });
});

describe("auth CPU tuning: the signed challenge carries the lockout key [ADM-AUTH-01]", () => {
  const sign = (c: Parameters<typeof signChallenge>[1]) => signChallenge(env.SESSION_HMAC_KEY, c);

  it("a tampered, missing, malformed, expired or wrong-purpose claim is refused with 401", async () => {
    const email = "challenge@example.com";
    const { clientHash, secret, step } = await enrol(email);
    const sub = await userId(email);
    const ak = await key(email);
    const exp = Date.now() + 60_000;

    const real = await challengeFor(email, clientHash);
    const [body, mac] = real.split(".") as [string, string];
    const claim = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    expect(claim).toMatchObject({ purpose: "login_totp", sub, ak });
    const forged = b64url(enc.encode(JSON.stringify({ ...claim, ak: `acct:${"0".repeat(32)}` })));

    const sessions = await count("staff_sessions");
    for (const challenge of [
      `${forged}.${mac}`, // tampered ak, old signature
      await sign({ purpose: "login_totp", sub, exp }), // no ak
      await sign({ purpose: "login_totp", sub, exp, ak: "acct:xyz" }), // malformed ak
      await sign({ purpose: "login_totp", sub, exp, ak: ak.toUpperCase() }), // wrong shape
      await sign({ purpose: "login_totp", sub, exp: Date.now() - 1, ak }), // expired
      await sign({ purpose: "enrol_totp", sub, exp, ak }), // wrong purpose
    ]) {
      const res = await call("/totp", { body: { challenge, code: totpCode(secret, step + 1) } });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(INVALID_BODY);
    }
    expect(await count("staff_sessions")).toBe(sessions);
    // The real challenge still works afterwards (nothing was consumed or locked).
    expect(
      (await call("/totp", { body: { challenge: real, code: totpCode(secret, step + 1) } })).status,
    ).toBe(200);
  });
});

describe("auth CPU tuning: the diagnostic log line [ADM-AUTH-01]", () => {
  it("logs exactly ev, r, s, iso, n per auth request, with no personal data", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      lines.push(String(a[0]));
    });
    try {
      const email = "logline@example.com";
      await call("/login", { body: { email, clientHash: hash() } });
      await call("/salt", { body: { email } });
      await call("/nope", { body: {} });
    } finally {
      spy.mockRestore();
    }
    const logged = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.ev === "auth");
    expect(logged).toHaveLength(3);
    for (const l of logged) expect(Object.keys(l).sort()).toEqual(["ev", "iso", "n", "r", "s"]);
    expect(logged.map((l) => [l.r, l.s])).toEqual([
      ["login", 401],
      ["salt", 200],
      ["other", 404],
    ]);
    expect(new Set(logged.map((l) => l.iso)).size).toBe(1);
    expect(logged[0]?.iso).toMatch(/^[0-9a-f]{6}$/);
    const ns = logged.map((l) => l.n as number);
    expect(ns[1]).toBe((ns[0] as number) + 1);
    expect(ns[2]).toBe((ns[0] as number) + 2);
    expect(lines.join("\n")).not.toContain("logline@example.com");
  });
});

describe("auth CPU tuning: lockout for unknown emails and the query plans [ADM-AUTH-02, -05]", () => {
  it("an unknown email locks like a real account: the 11th login is 429 with the same body, in 1 call", async () => {
    const email = "ghost2@example.com";
    for (let i = 0; i < 10; i++)
      expect((await call("/login", { body: { email, clientHash: hash() } })).status).toBe(401);
    expect((await attemptsRow(await key(email)))?.failures).toBe(10);
    const ghost = await counting("/login", { body: { email, clientHash: hash() } });
    expect([ghost.res.status, ghost.calls]).toEqual([429, 1]);
    const ghostBody = await ghost.res.json();

    const real = "locked-real@example.com";
    const { clientHash } = await enrol(real);
    for (let i = 0; i < 10; i++) await call("/login", { body: { email: real, clientHash: hash() } });
    const locked = await counting("/login", { body: { email: real, clientHash } });
    expect([locked.res.status, locked.calls]).toEqual([429, 1]);
    expect(ghostBody).toEqual(await locked.res.json());
  });

  /** The plan lines of one query: how each table is reached. */
  const plan = async (sql: string, ...binds: unknown[]) =>
    (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...binds)
        .all<{ detail: string }>()
    ).results.map((r) => r.detail);

  it("the /login and /totp reads reach staff_users and auth_attempts by index, never a scan", async () => {
    const k = await key("plan@example.com");
    const reads = {
      login: await plan(LOGIN_READ, "plan@example.com", k),
      totp: await plan(TOTP_READ, "some-user-id", k),
    };
    for (const [name, lines] of Object.entries(reads)) {
      for (const table of ["staff_users", "auth_attempts"]) {
        const mine = lines.filter((l) => l.includes(table));
        expect(mine.length, `${name}: ${table} is in the plan: ${lines.join(" | ")}`).toBeGreaterThan(0);
        for (const l of mine)
          expect(l, `${name}: ${l}`).toMatch(
            /^SEARCH .*(USING (COVERING )?INDEX|PRIMARY KEY|INTEGER PRIMARY KEY)/,
          );
      }
      expect(lines.filter((l) => /^SCAN (staff_users|auth_attempts)\b/.test(l))).toEqual([]);
    }
  });
});

describe("auth CPU tuning: the atomic failure counter [ADM-AUTH-05]", () => {
  it("10 parallel wrong logins add exactly 10 failures and lock the account", async () => {
    const email = "parallel@example.com";
    const { clientHash } = await enrol(email);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => call("/login", { body: { email, clientHash: hash() } })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(401));
    const row = await attemptsRow(await key(email));
    expect(row?.failures).toBe(10);
    expect(row?.locked_until).toBeGreaterThan(Date.now());
    expect((await call("/login", { body: { email, clientHash } })).status).toBe(429);
  });

  it("a failure is still exactly 1 D1 call (the upsert)", async () => {
    const c = counted();
    await c.env.DB.prepare(FAIL_SQL)
      .bind("acct:call-budget", Date.now(), WINDOW_MS, LOCK_AFTER, LOCK_MS)
      .run();
    expect(c.calls()).toBe(1);
  });

  type Row = Attempts;
  const runSql = async (k: string, at: number, lockAfter = LOCK_AFTER): Promise<Row> => {
    await env.DB.prepare(FAIL_SQL).bind(k, at, WINDOW_MS, lockAfter, LOCK_MS).run();
    const r = (await env.DB.prepare(
      "SELECT window_start, failures, locked_until FROM auth_attempts WHERE key = ?",
    )
      .bind(k)
      .first()) as { window_start: number; failures: number; locked_until: number | null };
    return { windowStart: r.window_start, failures: r.failures, lockedUntil: r.locked_until };
  };
  // The same math as recordFailure, with a configurable lock-after count (the module's constant is fixed).
  const model = (a: Row | null, at: number, lockAfter: number): Row => {
    const fresh = !a || at - a.windowStart >= WINDOW_MS;
    const failures = fresh ? 1 : a.failures + 1;
    return {
      windowStart: fresh ? at : a.windowStart,
      failures,
      lockedUntil: failures >= lockAfter ? at + LOCK_MS : (a?.lockedUntil ?? null),
    };
  };

  const T0 = 1_700_000_000_000;
  const H = WINDOW_MS;
  const cases: Record<string, number[]> = {
    "first failure only": [T0],
    "9 then lock at the 10th": Array.from({ length: 10 }, (_, i) => T0 + i * 1000),
    "11 failures keep extending the lock": Array.from({ length: 11 }, (_, i) => T0 + i * 1000),
    "window expires exactly at WINDOW_MS (>=): restarts at 1": [T0, T0 + H],
    "one ms before the window ends: still counts": [T0, T0 + H - 1],
    "9 failures, window passes, then 9 more: no lock": [
      ...Array.from({ length: 9 }, (_, i) => T0 + i),
      ...Array.from({ length: 9 }, (_, i) => T0 + H + 10 + i),
    ],
    "lock, window passes, a fresh failure keeps the old locked_until": [
      ...Array.from({ length: 10 }, (_, i) => T0 + i),
      T0 + H + 50,
    ],
    "lock, then more failures after the window and a second lock": [
      ...Array.from({ length: 10 }, (_, i) => T0 + i),
      ...Array.from({ length: 10 }, (_, i) => T0 + 2 * H + i),
    ],
  };

  // Deterministic pseudo-random sequences (a fixed LCG), with gaps from 0 ms to 1.5 windows.
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  for (let s = 0; s < 40; s++) {
    let t = T0;
    cases[`random sequence ${s}`] = Array.from({ length: 30 }, () => {
      t += Math.floor(rnd() < 0.1 ? rnd() * 1.5 * H : rnd() * 5000);
      return t;
    });
  }

  for (const [name, times] of Object.entries(cases)) {
    it(`SQL and recordFailure give the same row: ${name}`, async () => {
      const k = `acct:eq-${name.replace(/\W+/g, "-")}`;
      let expected: Row | null = null;
      for (const at of times) {
        expected = recordFailure(expected, at);
        expect(await runSql(k, at)).toEqual(expected);
      }
    });
  }

  it("with LOCK_AFTER = 1 the very first insert is already locked, as in recordFailure", async () => {
    const k = "acct:eq-lock-after-1";
    const got = await runSql(k, T0, 1);
    expect(got).toEqual(model(null, T0, 1));
    expect(got.lockedUntil).toBe(T0 + LOCK_MS);
    expect(await runSql(k, T0 + H, 1)).toEqual(model(got, T0 + H, 1)); // a reset still locks at 1
  });

  it("the model used for LOCK_AFTER = 1 agrees with recordFailure at the real constant", () => {
    let a: Row | null = null;
    let b: Row | null = null;
    for (let i = 0; i < 25; i++) {
      a = recordFailure(a, T0 + i * 400_000);
      b = model(b, T0 + i * 400_000, LOCK_AFTER);
      expect(b).toEqual(a);
    }
  });
});
