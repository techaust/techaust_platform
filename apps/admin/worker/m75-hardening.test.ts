// M7.5 hardening of the admin Workers (docs/runs/m7.5-hardening.md, B1): Rate Limiting (C2, L2, L5), the API policy (C3a, L11) and the shared download
// headers (L12), the GET refusal by Sec-Fetch-Site (L3), the single-use login challenge (L4), the /invite/totp counter (L5), the enrolment fixes (L9, M1.5
// L1 and L3) and the TOTP key rotation (L23). Every case is a failure path first. All addresses, names and emails are made-up test data.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  CHALLENGE_TTL_MS,
  codeKey,
  currentStep,
  type Limiter,
  LOCK_AFTER,
  newRecoveryCodes,
  openTotpSecret,
  recoveryCodeHash,
  sealTotpSecret,
  signChallenge,
  totpCode,
} from "@techaust/auth";
import { API_CSP } from "@techaust/core/file-types";
import { uuidv7 } from "@techaust/core/ids";
import { afterEach, describe, expect, it, vi } from "vitest";
import api from "./api.ts";
import { enrolCodesGuard, insertRecoveryCodes } from "./auth.ts";
import front from "./index.ts";
import { ADDRESS_LIMITED } from "./rate-limit.ts";
import {
  attemptsRow,
  bodyOf,
  call,
  challengeFor,
  counted,
  countOf,
  finishOnly,
  invite,
  ORIGIN,
  one,
  sessionFor,
  signIn,
  userId,
  withEnv,
  wrongCode,
} from "./test-helpers.ts";

afterEach(() => vi.restoreAllMocks());

const TEST_KEY = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));
const RATE_LIMITED_BODY = { code: "rate_limited", message: "Too many requests. Please try again later." };

/** A limiter that records each key and answers `success`. */
function limiter(success: boolean) {
  const keys: string[] = [];
  const l: Limiter = {
    limit: async ({ key }) => {
      keys.push(key);
      return { success };
    },
  };
  return { l, keys };
}

/** Runs a request through a Worker entry with its own execution context, waiting for every `waitUntil`. */
async function run(
  app: { fetch: (r: Request, e: Env, c: ExecutionContext) => Response | Promise<Response> },
  req: Request,
  e: Env,
) {
  const ctx = createExecutionContext();
  const res = await app.fetch(req, e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const get = (path: string, cookie?: string, extra: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/v1${path}`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...extra } });

// ---- C2, L5: per-address limits on the public sign-in rows ------------------------------------------------------------------------------------------

describe("C2, L5: the public sign-in rows are limited per address, before any D1 work [ASVS 2.4.1]", () => {
  for (const [path, binding] of Object.entries(ADDRESS_LIMITED)) {
    it(`${path} over the limit: 429 rate_limited, Retry-After, the API policy; no D1 call, no counter row, no access row`, async () => {
      const c = counted();
      const refusing = limiter(false);
      const accessBefore = await countOf("access_log");
      const attemptsBefore = await countOf("auth_attempts");
      const res = await call(
        path.replace("/api/v1", ""),
        // An empty body: the limit is checked before the body is read or validated (and before Turnstile on /login).
        { body: {}, headers: { "CF-Connecting-IP": "203.0.113.77" } },
        withEnv(c.env, { [binding]: refusing.l }),
      );
      expect(res.status).toBe(429);
      expect((await bodyOf(res)).error).toEqual(RATE_LIMITED_BODY);
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(res.headers.get("Content-Security-Policy")).toBe(API_CSP);
      expect(c.calls()).toBe(0);
      expect(await countOf("access_log")).toBe(accessBefore);
      expect(await countOf("auth_attempts")).toBe(attemptsBefore);
      expect(refusing.keys).toHaveLength(1);
      expect(refusing.keys[0]).not.toContain("203.0.113");
    });
  }

  it("keys: one per route and per address (an IPv6 address counts as its /64), and the other binding is never asked", async () => {
    const signin = limiter(true);
    const inviteL = limiter(true);
    const e = withEnv(env, { RL_SIGNIN: signin.l, RL_INVITE: inviteL.l });
    const salt = (ip: string) =>
      call("/auth/salt", { body: { email: "nobody@example.com" }, headers: { "CF-Connecting-IP": ip } }, e);
    await salt("203.0.113.5");
    await salt("203.0.113.5");
    await salt("203.0.113.6");
    await salt("2001:db8:1:2::1");
    await salt("2001:db8:1:2::ffff");
    await call(
      "/auth/login",
      {
        body: { email: "nobody@example.com", clientHash: "x" },
        headers: { "CF-Connecting-IP": "203.0.113.5" },
      },
      e,
    );
    const [a, b, c2, v6a, v6b, login] = signin.keys as [string, string, string, string, string, string];
    expect(a).toBe(b);
    expect(a).not.toBe(c2);
    expect(v6a).toBe(v6b);
    expect(login).not.toBe(a); // the same address on another route: its own counter
    expect(inviteL.keys).toEqual([]);
  });

  it("a limiter that fails lets the sign-in through (logged, no value in the line); the exact counters still hold behind it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken: Limiter = {
      limit: async () => {
        throw new Error("limiter down");
      },
    };
    const res = await call(
      "/auth/salt",
      { body: { email: "nobody@example.com" } },
      withEnv(env, { RL_SIGNIN: broken }),
    );
    expect(res.status).toBe(200);
    const lines = error.mock.calls.map((x) => String(x[0]));
    expect(lines.some((l) => l.includes('"rate limiter failed"') && l.includes('"admin.RL_SIGNIN"'))).toBe(
      true,
    );
  });

  it("signed-in and other public rows are not limited per address", async () => {
    const signin = limiter(false);
    const res = await call("/health", {}, withEnv(env, { RL_SIGNIN: signin.l, RL_INVITE: signin.l }));
    expect(res.status).toBe(200);
    expect(signin.keys).toEqual([]);
  });
});

// ---- L2: per-session limits on the front ----------------------------------------------------------------------------------------------------------

describe("L2: every signed-in request is limited per session on the front, before any D1 work [ASVS 2.4.1]", () => {
  it("a front route over the limit: 429, no D1 call, no access row; the key is an HMAC of the session id", async () => {
    const o = await sessionFor("owner");
    const c = counted();
    const refusing = limiter(false);
    const accessBefore = await countOf("access_log");
    const res = await call("/auth/me", { cookie: o.cookie }, withEnv(c.env, { RL_SESSION: refusing.l }));
    expect(res.status).toBe(429);
    expect((await bodyOf(res)).error).toEqual(RATE_LIMITED_BODY);
    expect(c.calls()).toBe(0);
    expect(await countOf("access_log")).toBe(accessBefore);
    expect(refusing.keys).toHaveLength(1);
    expect(refusing.keys[0]).toMatch(/^s:[0-9a-f]{32}$/);
    expect(refusing.keys[0]).not.toContain(o.sessionId.slice(0, 32));
  });

  it("within the limit the request goes on; one session keeps one key, another session has its own", async () => {
    const a = await sessionFor("owner");
    const b = await sessionFor("owner");
    const allowing = limiter(true);
    const e = withEnv(env, { RL_SESSION: allowing.l });
    expect((await call("/auth/me", { cookie: a.cookie }, e)).status).toBe(200);
    expect((await call("/auth/me", { cookie: a.cookie }, e)).status).toBe(200);
    expect((await call("/auth/me", { cookie: b.cookie }, e)).status).toBe(200);
    const [k1, k2, k3] = allowing.keys;
    expect(k1).toBe(k2);
    expect(k3).not.toBe(k1);
  });

  it("no cookie: the limiter is not asked (the 401 costs no D1 read)", async () => {
    const allowing = limiter(true);
    const res = await call("/auth/me", {}, withEnv(env, { RL_SESSION: allowing.l }));
    expect(res.status).toBe(401);
    expect(allowing.keys).toEqual([]);
  });

  it("a forwarded request over the limit: 429 from the front, the Worker behind is never called; the 429 carries the API headers and an fwd line", async () => {
    const o = await sessionFor("owner");
    const refusing = limiter(false);
    const forwarded = vi.fn(async () => new Response("{}", { status: 200 }));
    const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const res = await run(
      front,
      get("/leads", o.cookie, { "cf-ray": "ray-l2" }),
      withEnv(env, { RL_SESSION: refusing.l, ADMIN_API: { fetch: forwarded } }),
    );
    expect(res.status).toBe(429);
    expect(forwarded).not.toHaveBeenCalled();
    expect(res.headers.get("Content-Security-Policy")).toBe(API_CSP);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({ error: RATE_LIMITED_BODY, request_id: "ray-l2" });
    const line = logs.mock.calls.map((x) => JSON.parse(String(x[0]))).find((l) => l.ev === "fwd");
    expect(line).toMatchObject({ ev: "fwd", r: "/api/v1/leads", w: "api", s: 429, rid: "ray-l2" });
  });

  it("a forwarded request within the limit reaches the Worker behind; without a cookie the limiter is not asked", async () => {
    const o = await sessionFor("owner");
    const allowing = limiter(true);
    const forwarded = vi.fn(async () => new Response("{}", { status: 200 }));
    const e = withEnv(env, { RL_SESSION: allowing.l, ADMIN_API: { fetch: forwarded } });
    expect((await run(front, get("/leads", o.cookie), e)).status).toBe(200);
    expect((await run(front, get("/leads"), e)).status).toBe(200);
    expect(forwarded).toHaveBeenCalledTimes(2);
    expect(allowing.keys).toHaveLength(1);
  });

  it("the Workers behind the front never ask a limiter (the front counted the request; they don't hold its key)", async () => {
    const o = await sessionFor("owner");
    const refusing = limiter(false);
    const res = await run(
      api,
      get("/leads", o.cookie),
      withEnv(env, { RL_SESSION: refusing.l, SESSION_HMAC_KEY: undefined }),
    );
    expect(res.status).toBe(200);
    expect(refusing.keys).toEqual([]);
  });
});

// ---- C3a, L11, L12: policies ------------------------------------------------------------------------------------------------------------------------

describe("C3a, L11: every API answer without a policy of its own gets default-src 'none'; frame-ancestors 'none'", () => {
  it("JSON, 401, 404 and a validation error", async () => {
    const o = await sessionFor("owner");
    for (const res of [
      await call("/auth/me", { cookie: o.cookie }),
      await call("/auth/me"),
      await call("/no-such-route"),
      await call("/auth/salt", { body: { email: 1 } }),
    ]) {
      expect(res.headers.get("Content-Security-Policy")).toBe(API_CSP);
    }
  });

  it("the Workers behind the front set it too (createApp), and the front's 502 carries it", async () => {
    const o = await sessionFor("owner");
    expect((await run(api, get("/leads", o.cookie), env)).headers.get("Content-Security-Policy")).toBe(
      API_CSP,
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const throwing = {
      fetch: async () => {
        throw new TypeError("down");
      },
    };
    const res = await run(front, get("/leads", o.cookie), withEnv(env, { ADMIN_API: throwing }));
    expect(res.status).toBe(502);
    expect(res.headers.get("Content-Security-Policy")).toBe(API_CSP);
  });

  it("L12: every stored-object download in the admin and portal Workers is built by the one downloadHeaders helper", () => {
    const sources = {
      ...(import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as Record<
        string,
        string
      >),
      ...(import.meta.glob("../../portal/worker/*.ts", {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>),
    };
    const sites: string[] = [];
    for (const [f, text] of Object.entries(sources)) {
      if (f.endsWith(".test.ts") || f.includes("/test-") || f.startsWith("./test-")) continue;
      for (const m of text.matchAll(/new Response\(\s*\w+\.body,\s*\{([\s\S]*?)\}\s*\)/g)) {
        sites.push(f);
        expect(m[1], f).toMatch(/headers: downloadHeaders\(/);
      }
      expect(text, f).not.toMatch(/filename="\$\{/);
      expect(text, f).not.toMatch(/"Content-Security-Policy": "sandbox"/);
    }
    // the admin vault, proofs, PDFs, supplier copy, certificate, receipt, statement and signature; the portal's offer PDFs and files
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });
});

// ---- L3: GET refusal by Sec-Fetch-Site -----------------------------------------------------------------------------------------------------------

describe("L3: a GET under /api/ the browser marks as not from the admin's own pages is refused before any D1 work", () => {
  for (const site of ["cross-site", "same-site", "none"]) {
    it(`Sec-Fetch-Site: ${site} → 403 before the guard: no session read; only the refusal's access row (the admin logs every refusal, Q2)`, async () => {
      const o = await sessionFor("owner");
      const c = counted();
      const before = await countOf("access_log", "status = 403 AND route = '/api/v1/auth/me'");
      const res = await call("/auth/me", { cookie: o.cookie, headers: { "Sec-Fetch-Site": site } }, c.env);
      expect(res.status).toBe(403);
      expect((await bodyOf(res)).error).toEqual({ code: "forbidden", message: "Request refused" });
      expect(c.calls()).toBe(1);
      expect(await countOf("access_log", "status = 403 AND route = '/api/v1/auth/me'")).toBe(before + 1);
    });
  }

  it("the SPA's own fetch (same-origin) and a request without the header are served", async () => {
    const o = await sessionFor("owner");
    expect(
      (await call("/auth/me", { cookie: o.cookie, headers: { "Sec-Fetch-Site": "same-origin" } })).status,
    ).toBe(200);
    expect((await call("/auth/me", { cookie: o.cookie })).status).toBe(200);
  });

  it("the front refuses a cross-site GET of a forwarded row too (the Worker behind runs the same check)", async () => {
    const o = await sessionFor("owner");
    const res = await run(api, get("/leads", o.cookie, { "Sec-Fetch-Site": "cross-site" }), env);
    expect(res.status).toBe(403);
  });
});

// ---- L4: single-use login challenge ----------------------------------------------------------------------------------------------------------------

describe("L4: a login challenge works once [ASVS 6.6.2]", () => {
  it("a second /totp with the same challenge and a fresh code is 401, and no second session is made", async () => {
    const s = await sessionFor("staff", { password: true });
    const first = await signIn(s);
    expect(first.res.status).toBe(200);
    const sessions = await countOf("staff_sessions", "user_id = ?1", s.id);
    const again = await call("/auth/totp", {
      body: { challenge: first.challenge, code: totpCode(s.secret, currentStep(Date.now()) + 1) },
    });
    expect(again.status).toBe(401);
    expect(await countOf("staff_sessions", "user_id = ?1", s.id)).toBe(sessions);
  });

  it("a challenge issued before a finished sign-in can't be used after it, even with a recovery code", async () => {
    const s = await sessionFor("staff", { password: true });
    const stale = await challengeFor(s.email, s.clientHash);
    const code = newRecoveryCodes()[0] as string;
    await env.DB.prepare("INSERT INTO staff_recovery_codes (id, user_id, code_hash) VALUES (?1, ?2, ?3)")
      .bind(uuidv7(), s.id, await recoveryCodeHash(code))
      .run();
    expect((await signIn(s)).res.status).toBe(200); // a newer sign-in finishes first
    const res = await call("/auth/recovery", { body: { challenge: stale, code } });
    expect(res.status).toBe(401);
    // the recovery code was not spent
    expect(
      (await one("SELECT used_at FROM staff_recovery_codes WHERE user_id = ?1", s.id))?.used_at,
    ).toBeNull();
  });

  it("the challenge carries a signed iat", async () => {
    const s = await sessionFor("staff", { password: true });
    const before = Date.now();
    const challenge = await challengeFor(s.email, s.clientHash);
    const claim = JSON.parse(atob((challenge.split(".")[0] as string).replace(/-/g, "+").replace(/_/g, "/")));
    expect(claim.iat).toBeGreaterThanOrEqual(before);
    expect(claim.exp).toBe(claim.iat + CHALLENGE_TTL_MS);
  });
});

// ---- L5, L9: the invite's authenticator step ---------------------------------------------------------------------------------------------------------

describe("L5: /invite/totp counts failures on the member's code counter and locks after 10", () => {
  it("each wrong code counts; the 10th locks; a locked counter refuses even the right code", async () => {
    const f = await finishOnly(await invite(`invite-lock-${uuidv7()}@example.com`, "staff"));
    const id = (
      JSON.parse(atob((f.challenge.split(".")[0] as string).replace(/-/g, "+").replace(/_/g, "/")))
        .sub as string
    ).split("|")[0] as string;
    for (let i = 1; i <= LOCK_AFTER; i++) {
      const res = await call("/auth/invite/totp", {
        body: { challenge: f.challenge, code: wrongCode(f.secret) },
      });
      expect(res.status).toBe(401);
      expect((await attemptsRow(codeKey(id)))?.failures).toBe(i);
    }
    const right = await call("/auth/invite/totp", {
      body: { challenge: f.challenge, code: totpCode(f.secret, currentStep(Date.now())) },
    });
    expect(right.status).toBe(429);
    expect((await one("SELECT status FROM staff_users WHERE id = ?1", id))?.status).toBe("invited");
  });

  it("a right code clears the counter, and the member has exactly 10 recovery codes", async () => {
    const email = `invite-ok-${uuidv7()}@example.com`;
    const f = await finishOnly(await invite(email, "staff"));
    expect(
      (await call("/auth/invite/totp", { body: { challenge: f.challenge, code: wrongCode(f.secret) } }))
        .status,
    ).toBe(401);
    const ok = await call("/auth/invite/totp", {
      body: { challenge: f.challenge, code: totpCode(f.secret, currentStep(Date.now())) },
    });
    expect(ok.status).toBe(200);
    const id = await userId(email);
    expect(await attemptsRow(codeKey(id))).toBeNull();
    expect(await countOf("staff_recovery_codes", "user_id = ?1", id)).toBe(10);
  });
});

describe("L9 (M1.5 L1, L3): the enrolment's last step", () => {
  it("M1.5 L1: the codes ride only on THIS batch's activation (changes() = 1): a second activation in the same millisecond inserts none", async () => {
    const id = uuidv7();
    const t = Date.now();
    await env.DB.prepare(
      "INSERT INTO staff_users (id, email, name, role, status, totp_enabled_at) VALUES (?1, ?2, 'Racer', 'staff', 'active', ?3)",
    )
      .bind(id, `race-${id}@example.com`, t)
      .run();
    // The second request's activation changes no row (already active); its codes must not follow, though `totp_enabled_at = t` holds.
    const hashes = await Promise.all(newRecoveryCodes().map((x) => recoveryCodeHash(x)));
    await env.DB.batch([
      env.DB.prepare("UPDATE staff_users SET status = 'active' WHERE id = ?1 AND status = 'invited'").bind(
        id,
      ),
      insertRecoveryCodes(env.DB, id, hashes, enrolCodesGuard(id, t)),
    ]);
    expect(await countOf("staff_recovery_codes", "user_id = ?1", id)).toBe(0);
    // the first request's own activation (one row changed) does carry them
    await env.DB.prepare("UPDATE staff_users SET status = 'invited' WHERE id = ?1").bind(id).run();
    await env.DB.batch([
      env.DB.prepare("UPDATE staff_users SET status = 'active' WHERE id = ?1 AND status = 'invited'").bind(
        id,
      ),
      insertRecoveryCodes(env.DB, id, hashes, enrolCodesGuard(id, t)),
    ]);
    expect(await countOf("staff_recovery_codes", "user_id = ?1", id)).toBe(10);
  });

  it("M1.5 L3: a genuine enrolment challenge past its window answers enrolment_expired; a forged or wrong one stays the generic 401", async () => {
    const f = await finishOnly(await invite(`invite-late-${uuidv7()}@example.com`, "staff"));
    const sub = JSON.parse(atob((f.challenge.split(".")[0] as string).replace(/-/g, "+").replace(/_/g, "/")))
      .sub as string;
    const late = await signChallenge(env.SESSION_HMAC_KEY, {
      purpose: "enrol_totp",
      sub,
      exp: Date.now() - 1,
    });
    const code = totpCode(f.secret, currentStep(Date.now()));
    const res = await call("/auth/invite/totp", { body: { challenge: late, code } });
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error).toMatchObject({ code: "enrolment_expired" });
    const forged = await signChallenge(TEST_KEY(99), { purpose: "enrol_totp", sub, exp: Date.now() - 1 });
    const bad = await call("/auth/invite/totp", { body: { challenge: forged, code } });
    expect((await bodyOf(bad)).error).toMatchObject({ code: "invalid_credentials" });
  });
});

// ---- L23: TOTP key rotation ------------------------------------------------------------------------------------------------------------------------

describe("L23: TOTP_ENC_KEY rotation through TOTP_ENC_KEY_PREVIOUS", () => {
  const NEW_KEY = TEST_KEY(8);

  it("a secret sealed under the old key signs in while _PREVIOUS is set, and comes back re-sealed under the new key", async () => {
    const s = await sessionFor("staff", { password: true });
    const rotating = withEnv(env, { TOTP_ENC_KEY: NEW_KEY, TOTP_ENC_KEY_PREVIOUS: env.TOTP_ENC_KEY });
    const was = (
      await one<{ totp_secret_enc: string }>("SELECT totp_secret_enc FROM staff_users WHERE id = ?1", s.id)
    )?.totp_secret_enc as string;
    expect((await signIn(s, undefined, rotating)).res.status).toBe(200);
    const now = (
      await one<{ totp_secret_enc: string }>("SELECT totp_secret_enc FROM staff_users WHERE id = ?1", s.id)
    )?.totp_secret_enc as string;
    expect(now).not.toBe(was);
    expect(now.startsWith("v1.")).toBe(true);
    expect(await openTotpSecret(NEW_KEY, s.id, now)).toEqual(s.secret);
    // once re-sealed, the new key alone is enough (`_PREVIOUS` can be removed)
    expect((await signIn(s, undefined, withEnv(env, { TOTP_ENC_KEY: NEW_KEY }))).res.status).toBe(200);
  });

  it("without _PREVIOUS an old seal fails closed: 401 (never a 500), counted, nothing re-sealed", async () => {
    const s = await sessionFor("staff", { password: true });
    const was = (await one("SELECT totp_secret_enc FROM staff_users WHERE id = ?1", s.id))?.totp_secret_enc;
    const res = await signIn(s, undefined, withEnv(env, { TOTP_ENC_KEY: NEW_KEY }));
    expect(res.res.status).toBe(401);
    expect((await attemptsRow(codeKey(s.id)))?.failures).toBe(1);
    expect((await one("SELECT totp_secret_enc FROM staff_users WHERE id = ?1", s.id))?.totp_secret_enc).toBe(
      was,
    );
  });

  it("an unversioned seal from before M7.5 still opens with the current key", async () => {
    const s = await sessionFor("staff", { password: true });
    const legacy = (await sealTotpSecret(env.TOTP_ENC_KEY, s.id, s.secret)).slice(3);
    await env.DB.prepare("UPDATE staff_users SET totp_secret_enc = ?1 WHERE id = ?2")
      .bind(legacy, s.id)
      .run();
    expect((await signIn(s)).res.status).toBe(200);
    // the current key opened it: no re-seal was needed
    expect((await one("SELECT totp_secret_enc FROM staff_users WHERE id = ?1", s.id))?.totp_secret_enc).toBe(
      legacy,
    );
  });

  it("a step-up re-seals too, in its own batch; a wrong code re-seals nothing", async () => {
    const s = await sessionFor("owner");
    const rotating = withEnv(env, { TOTP_ENC_KEY: NEW_KEY, TOTP_ENC_KEY_PREVIOUS: env.TOTP_ENC_KEY });
    const was = (await one("SELECT totp_secret_enc FROM staff_users WHERE id = ?1", s.id))?.totp_secret_enc;
    const wrong = await call(
      "/auth/step-up",
      { body: { code: wrongCode(s.secret) }, cookie: s.cookie },
      rotating,
    );
    expect(wrong.status).toBe(400);
    expect((await one("SELECT totp_secret_enc FROM staff_users WHERE id = ?1", s.id))?.totp_secret_enc).toBe(
      was,
    );
    const ok = await call(
      "/auth/step-up",
      { body: { code: totpCode(s.secret, currentStep(Date.now())) }, cookie: s.cookie },
      rotating,
    );
    expect(ok.status).toBe(200);
    const now = (
      await one<{ totp_secret_enc: string }>("SELECT totp_secret_enc FROM staff_users WHERE id = ?1", s.id)
    )?.totp_secret_enc as string;
    expect(await openTotpSecret(NEW_KEY, s.id, now)).toEqual(s.secret);
  });
});
