import { env, exports } from "cloudflare:workers";
import {
  accountKey,
  b64url,
  currentStep,
  enc,
  fromB64url,
  ipKey,
  newToken,
  signChallenge,
  tokenHash,
  totpCode,
} from "@techaust/auth";
import { describe, expect, it } from "vitest";
import { LOGIN_READ, RECOVERY_CODE_READ, RECOVERY_USER_READ, RESERVE_SQL, TOTP_READ } from "./auth.ts";
import { SESSION_READ } from "./guard.ts";
import {
  attemptsRow,
  bodyOf,
  call,
  challengeFor,
  cookieOf,
  counting,
  countOf,
  enrol,
  hash,
  invite,
  login,
  one,
  rows,
  sessionFor,
  signIn,
  userId,
  wrongCode,
} from "./test-helpers.ts";

const INVALID_BODY = { error: { code: "invalid_credentials", message: "Invalid email, password or code" } };
const post = (path: string, body: unknown, cookie?: string) =>
  exports.default.fetch(`https://admin.example/api/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://admin.example",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

describe("staff login (docs/05 §6.1) [ADM-AUTH-01, -02, -05, -07]", () => {
  it("invite → name + password → code → active owner with a session; the invite is single-use", async () => {
    const e = await enrol("owner@example.com", "owner", "Rupak Sarkar");
    const user = await one(
      "SELECT status, role, name, totp_enabled_at FROM staff_users WHERE email = ?",
      e.email,
    );
    expect(user).toMatchObject({ status: "active", role: "owner", name: "Rupak Sarkar" });
    expect((await call("/auth/invite/start", { body: { token: e.inviteToken } })).status).toBe(400);
    expect(await countOf("audit_log", "action = 'auth.login'")).toBe(1);
    expect(e.cookie).toMatch(/^__Host-ta_admin=[A-Za-z0-9_-]{43}$/);
  });

  it("an invite without a name is refused (the invitee types their own)", async () => {
    const token = await invite("noname@example.com", "staff");
    const res = await call("/auth/invite/finish", { body: { token, clientHash: hash() } });
    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({
      error: { code: "bad_request", message: "Check the form and try again" },
    });
  });

  it("logs in with the right hash and code, then /me and logout work", async () => {
    const e = await enrol("staff1@example.com");
    const ok = await login(e.email, e.clientHash, e.secret, e.step + 1);
    expect(ok.status).toBe(200);
    const me = await call("/auth/me", { cookie: ok.cookie as string });
    expect(await me.json()).toEqual({
      user: { name: "Test Person", email: "staff1@example.com", role: "owner" },
      stepUpUntil: null,
    });
    await post("/auth/logout", {}, ok.cookie as string);
    expect((await call("/auth/me", { cookie: ok.cookie as string })).status).toBe(401);
    expect(await countOf("audit_log", "action = 'auth.logout'")).toBe(1);
  });

  it("refuses a replayed TOTP code", async () => {
    const e = await enrol("staff2@example.com");
    expect((await login(e.email, e.clientHash, e.secret, e.step)).status).toBe(401); // used at enrolment
  });

  it("an invited user (no authenticator yet) never gets a session", async () => {
    const token = await invite("pending@example.com", "staff");
    const clientHash = hash();
    const fin = await call("/auth/invite/finish", { body: { token, clientHash, name: "Pending" } });
    expect(fin.status).toBe(200);
    expect((await call("/auth/login", { body: { email: "pending@example.com", clientHash } })).status).toBe(
      401,
    );
    expect(await countOf("staff_sessions", "user_id = ?", await userId("pending@example.com"))).toBe(0);
  });

  it("rejects malformed, oversized and cross-site requests", async () => {
    expect((await call("/auth/login", { body: { email: "x" } })).status).toBe(400);
    expect(
      (await call("/auth/login", { body: { email: "a@b.co", clientHash: "x".repeat(20_000) } })).status,
    ).toBe(413);
    const form = await exports.default.fetch("https://admin.example/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example" },
      body: "email=a@b.co",
    });
    expect(form.status).toBe(403);
    const res = await call("/auth/totp", { body: { challenge: "forged.challenge", code: "123456" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const err = (await res.json()) as { request_id: string };
    expect(err.request_id).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// ADM-AUTH-02: nothing tells an attacker which accounts exist: the same status, body (apart from the request ID)
// and number of D1 calls for an unknown email, an invited account, a deactivated one and a wrong password.

describe("no enumeration of accounts [ADM-AUTH-02]", () => {
  async function accounts() {
    const active = await sessionFor("staff", { password: true });
    const deactivated = await sessionFor("staff", { password: true });
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?")
      .bind(deactivated.id)
      .run();
    const token = await invite("invited-only@example.com", "staff");
    const invitedHash = hash();
    await call("/auth/invite/finish", { body: { token, clientHash: invitedHash, name: "Invited" } });
    return { active, deactivated, invited: { email: "invited-only@example.com", clientHash: invitedHash } };
  }

  it("/salt answers unknown, invited and deactivated emails with the same shape and call count", async () => {
    const a = await accounts();
    const seen: unknown[] = [];
    for (const email of ["nobody@example.com", a.invited.email, a.deactivated.email]) {
      const r = await counting("/auth/salt", { body: { email } });
      const body = (await r.res.json()) as { salt: string; params: unknown };
      seen.push({ status: r.res.status, calls: r.calls, salt: body.salt.length, params: body.params });
    }
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
    expect(seen[0]).toMatchObject({ status: 200, calls: 1 });
  });

  it("/login answers unknown, invited, deactivated and wrong-password alike", async () => {
    const a = await accounts();
    const tries = [
      { email: "ghost@example.com", clientHash: hash() },
      { email: a.invited.email, clientHash: a.invited.clientHash }, // the right password, but not enrolled
      { email: a.deactivated.email, clientHash: a.deactivated.clientHash }, // the right password, deactivated
      { email: a.active.email, clientHash: hash() }, // a wrong password
    ];
    const outcomes = [];
    for (const t of tries) {
      const r = await counting("/auth/login", { body: t });
      outcomes.push({ status: r.res.status, body: await bodyOf(r.res), calls: r.calls });
    }
    for (const o of outcomes) expect(o).toEqual({ status: 401, body: INVALID_BODY, calls: 2 });
  });

  it("/recovery answers a code for an unknown, invited or deactivated account like a wrong code", async () => {
    const a = await accounts();
    const invitedId = await userId(a.invited.email);
    const sign = (sub: string) =>
      signChallenge(env.SESSION_HMAC_KEY, {
        purpose: "login_totp",
        sub,
        exp: Date.now() + 60_000,
        ak: `acct:${"0".repeat(32)}`,
      });
    const outcomes = [];
    for (const sub of [crypto.randomUUID(), invitedId, a.deactivated.id, a.active.id]) {
      const r = await counting("/auth/recovery", {
        body: { challenge: await sign(sub), code: "AAAA-BBBB-CCCC-DDDD" },
      });
      outcomes.push({ status: r.res.status, body: await bodyOf(r.res), calls: r.calls });
    }
    for (const o of outcomes) expect(o).toEqual({ status: 401, body: INVALID_BODY, calls: 2 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// M1.4 CPU tuning kept: the D1 call budget per route [NFR-2]. Every D1 call runs binding code inside the isolate,
// so the number of calls is what the Free plan's CPU budget tracks. "+L" = the access-log write (one call).

describe("D1 calls per route [NFR-2]", () => {
  it("salt 1; login ok 1+L, wrong 1+L; totp ok 2, wrong 1+L, replay 1+L; me 1+L", async () => {
    const email = "budget@example.com";
    const e = await enrol(email);

    expect((await counting("/auth/salt", { body: { email } })).calls).toBe(1);

    const bad = await counting("/auth/login", { body: { email, clientHash: hash() } });
    expect([bad.res.status, bad.calls]).toEqual([401, 2]);

    const ok = await counting("/auth/login", { body: { email, clientHash: e.clientHash } });
    expect([ok.res.status, ok.calls]).toEqual([200, 2]);
    const { challenge } = (await ok.res.json()) as { challenge: string };

    const wrong = await counting("/auth/totp", { body: { challenge, code: wrongCode(e.secret) } });
    expect([wrong.res.status, wrong.calls]).toEqual([401, 2]);

    const good = await counting("/auth/totp", { body: { challenge, code: totpCode(e.secret, e.step + 1) } });
    expect([good.res.status, good.calls]).toEqual([200, 2]);
    const cookie = cookieOf(good.res) as string;

    const me = await counting("/auth/me", { cookie });
    expect([me.res.status, me.calls]).toEqual([200, 2]);

    const replay = await counting("/auth/totp", {
      body: { challenge, code: totpCode(e.secret, e.step + 1) },
    });
    expect([replay.res.status, replay.calls]).toEqual([401, 2]);
  });

  it("an unknown email costs the same 2 calls as a wrong password, with the same answer", async () => {
    const none = await counting("/auth/login", { body: { email: "ghost@example.com", clientHash: hash() } });
    expect([none.res.status, none.calls]).toEqual([401, 2]);
    expect(await bodyOf(none.res)).toEqual(INVALID_BODY);
  });

  it("a locked login is 1 batch + the access row, and answers 429", async () => {
    const email = "budget-locked@example.com";
    const e = await enrol(email);
    for (let i = 0; i < 10; i++) await call("/auth/login", { body: { email, clientHash: hash() } });
    const locked = await counting("/auth/login", { body: { email, clientHash: e.clientHash } });
    expect([locked.res.status, locked.calls]).toEqual([429, 2]);
  });

  it("a missing cookie is 401 with no session read: only the access row is written", async () => {
    const r = await counting("/auth/me");
    expect([r.res.status, r.calls]).toEqual([401, 1]);
  });
});

describe("the signed challenge carries the password counter's key [ADM-AUTH-01]", () => {
  const sign = (c: Parameters<typeof signChallenge>[1]) => signChallenge(env.SESSION_HMAC_KEY, c);

  it("a tampered, missing, malformed, expired or wrong-purpose claim is refused with 401", async () => {
    const email = "challenge@example.com";
    const e = await enrol(email);
    const sub = await userId(email);
    const ak = `acct:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(email)))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32)}`;
    const exp = Date.now() + 60_000;

    const real = await challengeFor(email, e.clientHash);
    const [body, mac] = real.split(".") as [string, string];
    const claim = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    expect(claim).toMatchObject({ purpose: "login_totp", sub, ak });
    const forged = b64url(enc.encode(JSON.stringify({ ...claim, ak: `acct:${"0".repeat(32)}` })));

    const sessions = await countOf("staff_sessions");
    for (const challenge of [
      `${forged}.${mac}`, // tampered ak, old signature
      await sign({ purpose: "login_totp", sub, exp }), // no ak
      await sign({ purpose: "login_totp", sub, exp, ak: "acct:xyz" }), // malformed ak
      await sign({ purpose: "login_totp", sub, exp, ak: ak.toUpperCase() }), // wrong shape
      await sign({ purpose: "login_totp", sub, exp: Date.now() - 1, ak }), // expired
      await sign({ purpose: "enrol_totp", sub, exp, ak }), // wrong purpose
    ]) {
      const res = await call("/auth/totp", { body: { challenge, code: totpCode(e.secret, e.step + 1) } });
      expect(res.status).toBe(401);
      expect(await bodyOf(res)).toEqual(INVALID_BODY);
    }
    expect(await countOf("staff_sessions")).toBe(sessions);
    // The real challenge still works afterwards (nothing was consumed or locked).
    expect(
      (await call("/auth/totp", { body: { challenge: real, code: totpCode(e.secret, e.step + 1) } })).status,
    ).toBe(200);
  });

  it("a challenge issued before this release (no change in its format) keeps working", async () => {
    const e = await enrol("oldchallenge@example.com");
    const sub = await userId("oldchallenge@example.com");
    // Exactly what M1.4's /login signed: purpose, sub, exp, ak.
    const challenge = await signChallenge(env.SESSION_HMAC_KEY, {
      purpose: "login_totp",
      sub,
      exp: Date.now() + 60_000,
      ak: `acct:${"1".repeat(32)}`,
    });
    expect(
      (await call("/auth/totp", { body: { challenge, code: totpCode(e.secret, e.step + 1) } })).status,
    ).toBe(200);
  });
});

describe("query plans: every guard and login read uses an index [NFR-2]", () => {
  const plan = async (sql: string, ...binds: unknown[]) =>
    (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...binds)
        .all<{ detail: string }>()
    ).results.map((r) => r.detail);

  it("no read scans staff_users, staff_sessions, auth_attempts or staff_recovery_codes", async () => {
    const reads: Record<string, string[]> = {
      login: await plan(LOGIN_READ, "plan@example.com"),
      totp: await plan(TOTP_READ, "some-user-id"),
      recoveryUser: await plan(RECOVERY_USER_READ, "some-user-id"),
      recoveryCode: await plan(RECOVERY_CODE_READ, "some-user-id", "hash"),
      guard: await plan(SESSION_READ, "some-session-id"),
      reserve: await plan(RESERVE_SQL, "acct:x", 1, 3_600_000, 10, 900_000, "ip:x"),
    };
    for (const [name, lines] of Object.entries(reads)) {
      expect(
        lines.filter((l) =>
          /^SCAN (staff_users|staff_sessions|auth_attempts|staff_recovery_codes)\b/.test(l),
        ),
        `${name}: ${lines.join(" | ")}`,
      ).toEqual([]);
    }
  });
});

describe("a new session id for every sign-in [ADM-AUTH-05]", () => {
  it("two sign-ins make two sessions with different cookies", async () => {
    const u = await sessionFor("staff", { password: true });
    const a = await signIn(u);
    const b = await signIn(u);
    expect(a.res.status).toBe(200);
    expect(b.res.status).toBe(200);
    expect(a.cookie).not.toBe(b.cookie);
    expect(await countOf("staff_sessions", "user_id = ?", u.id)).toBe(3); // the helper's own + two sign-ins
    const ids = await rows<{ id: string }>("SELECT id FROM staff_sessions WHERE user_id = ?", u.id);
    expect(new Set(ids.map((r) => r.id)).size).toBe(3);
    expect(ids.map((r) => r.id)).toContain(await tokenHash((a.cookie as string).split("=")[1] as string));
  });
});

describe("the failure counter and the session batch [ADM-AUTH-05, -06]", () => {
  it("a successful sign-in clears the password and code counters but not the address counter", async () => {
    const u = await sessionFor("staff", { password: true });
    await call("/auth/login", {
      body: { email: u.email, clientHash: hash() },
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });
    const ak = await accountKey(u.email);
    const ik = await ipKey(env.SALT_PEPPER, "203.0.113.9");
    expect((await attemptsRow(ak))?.failures).toBe(1);
    expect((await attemptsRow(ik))?.failures).toBe(1); // the failure counted at the address
    expect((await signIn(u)).res.status).toBe(200);
    expect(await attemptsRow(ak)).toBeNull();
    expect(await attemptsRow(`code:${u.id}`)).toBeNull();
    expect((await attemptsRow(ik))?.failures).toBe(1); // a success does not clear the address counter
  });

  it("a replayed code is refused, counts once, and makes no session or login audit row", async () => {
    const e = await enrol("replay@example.com");
    const challenge = await challengeFor(e.email, e.clientHash);
    const id = await userId(e.email);
    const [sessions, audits] = [
      await countOf("staff_sessions"),
      await countOf("audit_log", "action = 'auth.login'"),
    ];
    const res = await call("/auth/totp", { body: { challenge, code: totpCode(e.secret, e.step) } }); // used at enrolment
    expect(res.status).toBe(401);
    expect((await attemptsRow(`code:${id}`))?.failures).toBe(1);
    expect([await countOf("staff_sessions"), await countOf("audit_log", "action = 'auth.login'")]).toEqual([
      sessions,
      audits,
    ]);
  });

  it("the TOTP step and the clock: only the current step or one either side is accepted", async () => {
    const e = await enrol("steps@example.com");
    const challenge = await challengeFor(e.email, e.clientHash);
    const now = currentStep(Date.now());
    for (const bad of [now - 2, now + 2]) {
      expect((await call("/auth/totp", { body: { challenge, code: totpCode(e.secret, bad) } })).status).toBe(
        401,
      );
    }
    expect(
      (await call("/auth/totp", { body: { challenge, code: totpCode(e.secret, now + 1) } })).status,
    ).toBe(200);
  });

  it("every token the API makes is 32 random bytes and unique", () => {
    expect(new Set(Array.from({ length: 50 }, () => newToken())).size).toBe(50);
  });
});
