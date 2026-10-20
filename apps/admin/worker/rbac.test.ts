// Deny by default [ADM-G-02], the guard [ADM-AUTH-01], audit and access logs [ADM-G-06, ADM-AUD-01, NFR-9], CSRF
// (docs/05 §7.1) and request IDs (LD7).
import { env } from "cloudflare:workers";
import { currentStep, ipKey, tokenHash, totpCode } from "@techaust/auth";
import { ACTIONS, decide, ROLES } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./guard.ts";
import app, { createApp } from "./index.ts";
import {
  accept,
  bodyOf,
  call,
  counting,
  countOf,
  enrol,
  extraSession,
  hash,
  invite,
  nextCode,
  ORIGIN,
  one,
  rows,
  sampleRequest,
  sessionFor,
  tokenOfLink,
  userId,
} from "./test-helpers.ts";

const newEmail = () => `rbac-${Math.random().toString(36).slice(2, 10)}@example.com`;
const PUBLIC = ROUTES.filter((r) => r.access === "public");
const GUARDED = ROUTES.filter((r) => r.access !== "public");

// ---------------------------------------------------------------------------------------------------------------
describe("every guarded route needs a session [ADM-AUTH-01]", () => {
  for (const route of GUARDED) {
    it(`${route.method} ${route.path}: no cookie, a junk cookie and a dead session are all 401`, async () => {
      const { path, init } = sampleRequest(route);
      const none = await call(path, init);
      expect(none.status).toBe(401);
      expect(await bodyOf(none)).toEqual({ error: { code: "unauthenticated", message: "Sign in" } });
      expect((await call(path, { ...init, cookie: "__Host-ta_admin=junk" })).status).toBe(401);
      const dead = await sessionFor("owner", { stepUp: true });
      await env.DB.prepare("UPDATE staff_sessions SET revoked_at = ? WHERE id = ?")
        .bind(Date.now(), dead.sessionId)
        .run();
      expect((await call(path, { ...init, cookie: dead.cookie })).status).toBe(401);
    });
  }

  it("the public routes are exactly the sign-in routes and the health check", () => {
    expect(PUBLIC.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      [
        "GET /api/v1/health",
        "POST /api/v1/auth/salt",
        "POST /api/v1/auth/login",
        "POST /api/v1/auth/totp",
        "POST /api/v1/auth/recovery",
        "POST /api/v1/auth/logout",
        "POST /api/v1/auth/invite/start",
        "POST /api/v1/auth/invite/finish",
        "POST /api/v1/auth/invite/totp",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("route coverage: deny by default [ADM-G-02]", () => {
  it("every registered route is in the route table, and every table row is a registered route", () => {
    // A route with validators registers once per handler, so compare the distinct method + path pairs.
    const registered = [
      ...new Set(app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`)),
    ].sort();
    const declared = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(registered).toEqual(declared);
    expect(new Set(declared).size).toBe(declared.length); // no duplicates
  });

  it("every table row names a real action or 'public'", () => {
    for (const r of ROUTES)
      expect(r.access === "public" || (ACTIONS as string[]).includes(r.access), r.path).toBe(true);
  });

  for (const route of GUARDED) {
    for (const role of ROLES) {
      it(`${route.method} ${route.path} as ${role} follows decide(): ${route.access.toString()}`, async () => {
        const s = await sessionFor(role, { stepUp: true });
        const { path, init } = sampleRequest(route);
        const res = await call(path, { ...init, cookie: s.cookie });
        if (decide(role, route.access as never) === "deny") {
          expect(res.status).toBe(403);
          expect(await bodyOf(res)).toEqual({ error: { code: "forbidden", message: "You can't do that" } });
        } else {
          expect([401, 403]).not.toContain(res.status);
        }
      });
    }
  }

  it("a route that isn't in the table is 404 at runtime, even for the owner, and writes no access row", async () => {
    const extra = createApp(); // before its first request, so a route can still be added to it
    extra.get("/v1/_undeclared", (c) => c.json({ leaked: true }));
    const o = await sessionFor("owner", { stepUp: true });
    const before = await countOf("access_log");
    const res = await extra.request(
      `${ORIGIN}/api/v1/_undeclared`,
      { headers: { Origin: ORIGIN, Cookie: o.cookie } },
      env,
    );
    expect(res.status).toBe(404);
    expect(await bodyOf(res)).toEqual({ error: { code: "not_found", message: "Not found" } });
    expect((await call("/no/such/route", { cookie: o.cookie })).status).toBe(404);
    expect(await countOf("access_log")).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("every successful mutation writes exactly one audit row [ADM-G-06, ADM-AUD-01]", () => {
  const IP = "203.0.113.55";
  const headers = (rid: string) => ({ "cf-ray": rid, "CF-Connecting-IP": IP, "User-Agent": "RbacTest/1.0" });
  const owner = () => sessionFor("owner", { stepUp: true });

  type Scenario = () => Promise<{ res: Response; rid: string; actor: { id: string; role: string } }>;
  const scenarios: Record<string, Scenario> = {
    "POST /api/v1/auth/step-up": async () => {
      const s = await sessionFor("owner");
      const rid = `ray-${crypto.randomUUID()}`;
      const { code } = await nextCode(s);
      return {
        res: await call("/auth/step-up", { body: { code }, cookie: s.cookie, headers: headers(rid) }),
        rid,
        actor: s,
      };
    },
    "DELETE /api/v1/auth/sessions/:id": async () => {
      const s = await owner();
      const other = await extraSession(s);
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/auth/sessions/${other.sessionId}`, {
          method: "DELETE",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/auth/sessions/revoke-all": async () => {
      const s = await owner();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call("/auth/sessions/revoke-all", {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/auth/recovery/regenerate": async () => {
      const s = await owner();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call("/auth/recovery/regenerate", {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/auth/logout": async () => {
      const s = await sessionFor("sales");
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call("/auth/logout", { method: "POST", cookie: s.cookie, headers: headers(rid) }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/users/invites": async () => {
      const s = await owner();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call("/users/invites", {
          body: { email: newEmail(), role: "staff" },
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/users/invites/:tokenHash/revoke": async () => {
      const s = await owner();
      const made = await call("/users/invites", {
        body: { email: newEmail(), role: "staff" },
        cookie: s.cookie,
      });
      const { link } = (await made.json()) as { link: string };
      const hash = await tokenHash(tokenOfLink(link));
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/users/invites/${hash}/revoke`, {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/users/sessions/revoke-all": async () => {
      const s = await owner();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call("/users/sessions/revoke-all", {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "PATCH /api/v1/users/:id": async () => {
      const s = await owner();
      const t = await sessionFor("staff");
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/users/${t.id}`, {
          method: "PATCH",
          body: { role: "sales" },
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/users/:id/deactivate": async () => {
      const s = await owner();
      const t = await sessionFor("staff");
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/users/${t.id}/deactivate`, {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/users/:id/reset-2fa": async () => {
      const s = await owner();
      const t = await sessionFor("staff");
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/users/${t.id}/reset-2fa`, {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
  };

  it("there is a scenario for every route that declares an audit action", () => {
    const audited = ROUTES.filter((r) => r.audit).map((r) => `${r.method} ${r.path}`);
    expect(Object.keys(scenarios).sort()).toEqual(audited.sort());
  });

  for (const route of ROUTES.filter((r) => r.audit)) {
    it(`${route.method} ${route.path} → one ${route.audit} row with actor, role, request_id, ip and user agent`, async () => {
      const run = scenarios[`${route.method} ${route.path}`] as Scenario;
      const { res, rid, actor } = await run();
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      const audit = await rows<{
        action: string;
        actor_id: string;
        role: string;
        actor_type: string;
        ip: string;
        user_agent: string;
        request_id: string;
      }>(
        "SELECT action, actor_id, role, actor_type, ip, user_agent, request_id FROM audit_log WHERE request_id = ? AND action NOT LIKE 'alert.%'",
        rid,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]).toEqual({
        action: route.audit,
        actor_id: actor.id,
        role: actor.role,
        actor_type: "staff",
        ip: IP,
        user_agent: "RbacTest/1.0",
        request_id: rid,
      });
    });
  }

  it("a refused mutation writes no audit row", async () => {
    const s = await sessionFor("staff", { stepUp: true });
    const rid = "ray-refused";
    const res = await call("/users/invites", {
      body: { email: newEmail(), role: "staff" },
      cookie: s.cookie,
      headers: headers(rid),
    });
    expect(res.status).toBe(403);
    expect(await countOf("audit_log", "request_id = ?", rid)).toBe(0);
    const o = await owner();
    const nope = await call("/users/no-such-user/deactivate", {
      method: "POST",
      cookie: o.cookie,
      headers: headers("ray-404"),
    });
    expect(nope.status).toBe(404);
    expect(await countOf("audit_log", "request_id = 'ray-404'")).toBe(0);
  });

  it("each sign-in route writes exactly one auth.login row", async () => {
    const e = await enrol(newEmail(), "staff");
    const id = await userId(e.email);
    expect(await countOf("audit_log", "action = 'auth.login' AND actor_id = ?", id)).toBe(1); // invite/totp
    const login = await call("/auth/login", { body: { email: e.email, clientHash: e.clientHash } });
    const { challenge } = (await login.json()) as { challenge: string };
    const rid = "ray-recovery-login";
    const rec = await call("/auth/recovery", {
      body: { challenge, code: e.recoveryCodes[0] },
      headers: headers(rid),
    });
    expect(rec.status).toBe(200);
    const sameRequest = await rows(
      "SELECT action FROM audit_log WHERE request_id = ? AND action NOT LIKE 'alert.%'",
      rid,
    );
    expect(sameRequest).toEqual([{ action: "auth.login" }]);
    await env.DB.prepare("UPDATE staff_users SET totp_last_step = NULL WHERE id = ?").bind(id).run();
    const ridTotp = "ray-totp-login";
    const t = await call("/auth/totp", {
      body: { challenge, code: totpCode(e.secret, currentStep(Date.now())) },
      headers: headers(ridTotp),
    });
    expect(t.status).toBe(200);
    expect(
      await rows("SELECT action FROM audit_log WHERE request_id = ? AND action NOT LIKE 'alert.%'", ridTotp),
    ).toEqual([{ action: "auth.login" }]);
  });

  it("summaries hold no credential, and audit_log and access_log refuse UPDATE (audit also DELETE)", async () => {
    const all = await rows<{ summary: string | null }>(
      "SELECT summary FROM audit_log WHERE summary IS NOT NULL",
    );
    expect(all.length).toBeGreaterThan(5);
    for (const { summary } of all) {
      expect(() => JSON.parse(summary as string)).not.toThrow();
      expect(summary).not.toMatch(/token|secret|password|cookie|hmac|"code"/i);
    }
    const audit = await one<{ id: string }>("SELECT id FROM audit_log LIMIT 1");
    await expect(
      env.DB.prepare("UPDATE audit_log SET action = 'x' WHERE id = ?").bind(audit?.id).run(),
    ).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM audit_log WHERE id = ?").bind(audit?.id).run()).rejects.toThrow(
      /append-only/,
    );
    const access = await one<{ id: string }>("SELECT id FROM access_log LIMIT 1");
    await expect(
      env.DB.prepare("UPDATE access_log SET status = 1 WHERE id = ?").bind(access?.id).run(),
    ).rejects.toThrow(/append-only/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the access log [NFR-9, Q2]", () => {
  const rid = () => `ray-${crypto.randomUUID()}`;
  const accessOf = (id: string) =>
    rows<{
      method: string;
      route: string;
      status: number;
      actor_id: string | null;
      ip: string | null;
      user_agent: string | null;
      realm: string;
    }>(
      "SELECT method, route, status, actor_id, ip, user_agent, realm FROM access_log WHERE request_id = ?",
      id,
    );

  it("a read by a signed-in member is logged with the route pattern, status, actor and request id", async () => {
    const s = await sessionFor("accountant");
    const id = rid();
    const res = await call("/auth/me", {
      cookie: s.cookie,
      headers: { "cf-ray": id, "CF-Connecting-IP": "203.0.113.7", "User-Agent": "AccessTest/2.0" },
    });
    expect(res.status).toBe(200);
    expect(await accessOf(id)).toEqual([
      {
        method: "GET",
        route: "/api/v1/auth/me",
        status: 200,
        actor_id: s.id,
        ip: "203.0.113.7",
        user_agent: "AccessTest/2.0",
        realm: "admin",
      },
    ]);
  });

  it("the route is the PATTERN: ids in the path never reach the log", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const t = await sessionFor("staff");
    const id = rid();
    await call(`/users/${t.id}/deactivate`, { method: "POST", cookie: o.cookie, headers: { "cf-ray": id } });
    const [row] = await accessOf(id);
    expect(row?.route).toBe("/api/v1/users/:id/deactivate");
    const dump = JSON.stringify(await rows("SELECT route FROM access_log"));
    expect(dump).not.toContain(t.id);
    expect(dump).not.toContain(t.sessionId);
  });

  it("refusals are logged: no cookie (actor null, 401), no permission (actor set, 403), a bad request (400)", async () => {
    const a = rid();
    await call("/auth/me", { headers: { "cf-ray": a } });
    expect(await accessOf(a)).toMatchObject([{ status: 401, actor_id: null, route: "/api/v1/auth/me" }]);
    const s = await sessionFor("sales");
    const b = rid();
    await call("/users", { cookie: s.cookie, headers: { "cf-ray": b } });
    expect(await accessOf(b)).toMatchObject([{ status: 403, actor_id: s.id, route: "/api/v1/users" }]);
    const c = rid();
    await call("/auth/login", { body: { email: "bad" }, headers: { "cf-ray": c } });
    expect(await accessOf(c)).toMatchObject([{ status: 400, actor_id: null, route: "/api/v1/auth/login" }]);
  });

  it("sign-in attempts are logged with no actor until they succeed, and never with the email", async () => {
    const e = await enrol(newEmail(), "staff");
    const wrong = rid();
    await call("/auth/login", {
      body: { email: e.email, clientHash: hash() },
      headers: { "cf-ray": wrong },
    });
    expect(await accessOf(wrong)).toMatchObject([
      { status: 401, actor_id: null, route: "/api/v1/auth/login" },
    ]);
    const ok = rid();
    const login = await call("/auth/login", {
      body: { email: e.email, clientHash: e.clientHash },
      headers: { "cf-ray": ok },
    });
    const { challenge } = (await login.json()) as { challenge: string };
    expect(await accessOf(ok)).toMatchObject([{ status: 200, actor_id: null }]);
    const signed = rid();
    await env.DB.prepare("UPDATE staff_users SET totp_last_step = NULL WHERE id = ?")
      .bind(await userId(e.email))
      .run();
    await call("/auth/totp", {
      body: { challenge, code: totpCode(e.secret, currentStep(Date.now())) },
      headers: { "cf-ray": signed },
    });
    expect(await accessOf(signed)).toMatchObject([
      { status: 200, actor_id: await userId(e.email), route: "/api/v1/auth/totp" },
    ]);
    expect(JSON.stringify(await rows("SELECT * FROM access_log"))).not.toContain(e.email);
  });

  it("lookups (health, salt, invite start) and undeclared paths write no row", async () => {
    const before = await countOf("access_log");
    await call("/health");
    await call("/auth/salt", { body: { email: "someone@example.com" } });
    await call("/auth/invite/start", { body: { token: "a".repeat(43) } });
    await call("/does/not/exist");
    expect(await countOf("access_log")).toBe(before);
  });

  it("one row per request, also when a mutation succeeds (it rides in the mutation's batch)", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const id = rid();
    const res = await call("/auth/sessions/revoke-all", {
      method: "POST",
      cookie: o.cookie,
      headers: { "cf-ray": id },
    });
    expect(res.status).toBe(200);
    expect(await accessOf(id)).toHaveLength(1);
  });

  it("a blocked address writes no access row either (it must cost the database nothing)", async () => {
    const ip = "203.0.113.200";
    await env.DB.prepare(
      "INSERT INTO auth_attempts (key, window_start, failures, locked_until) VALUES (?, ?, 100, ?)",
    )
      .bind(await ipKey(env.SALT_PEPPER, ip), Date.now(), Date.now() + 60_000)
      .run();
    const id = rid();
    const res = await call("/auth/login", {
      body: { email: "a@example.com", clientHash: hash() },
      headers: { "cf-ray": id, "CF-Connecting-IP": ip },
    });
    expect(res.status).toBe(429);
    expect(await accessOf(id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("CSRF: JSON only, from our own origin (docs/05 §7.1) [ADM-G-02]", () => {
  const s = () => sessionFor("owner", { stepUp: true });
  const raw = (path: string, init: RequestInit) => app.request(`${ORIGIN}/api/v1${path}`, init, env);
  const json = { "Content-Type": "application/json" };

  it("a cross-origin JSON POST or DELETE is 403, and does nothing", async () => {
    const o = await s();
    const other = await extraSession(o);
    const post = await raw("/users/invites", {
      method: "POST",
      headers: { ...json, Origin: "https://evil.example", Cookie: o.cookie },
      body: JSON.stringify({ email: newEmail(), role: "staff" }),
    });
    expect(post.status).toBe(403);
    const del = await raw(`/auth/sessions/${other.sessionId}`, {
      method: "DELETE",
      headers: { Origin: "https://evil.example", Cookie: o.cookie },
    });
    expect(del.status).toBe(403);
    expect((await call("/auth/me", { cookie: other.cookie })).status).toBe(200); // the session survived
    expect(await bodyOf(post)).toEqual({ error: { code: "forbidden", message: "Request refused" } });
  });

  it("same origin passes; so does no Origin with Sec-Fetch-Site: same-origin", async () => {
    const o = await s();
    const ok = await raw("/users/invites", {
      method: "POST",
      headers: { ...json, Origin: ORIGIN, Cookie: o.cookie },
      body: JSON.stringify({ email: newEmail(), role: "staff" }),
    });
    expect(ok.status).toBe(201);
    const fetchMeta = await raw("/users/invites", {
      method: "POST",
      headers: { ...json, "Sec-Fetch-Site": "same-origin", Cookie: o.cookie },
      body: JSON.stringify({ email: newEmail(), role: "staff" }),
    });
    expect(fetchMeta.status).toBe(201);
  });

  it("no Origin and no same-origin proof is refused; so are 'null', same-site and cross-site", async () => {
    const o = await s();
    const body = JSON.stringify({ email: newEmail(), role: "staff" });
    for (const headers of [
      { ...json, Cookie: o.cookie },
      { ...json, Origin: "null", Cookie: o.cookie },
      { ...json, "Sec-Fetch-Site": "same-site", Cookie: o.cookie },
      { ...json, "Sec-Fetch-Site": "cross-site", Cookie: o.cookie },
      { ...json, Origin: `${ORIGIN}.evil.example`, Cookie: o.cookie },
    ]) {
      expect((await raw("/users/invites", { method: "POST", headers, body })).status).toBe(403);
    }
  });

  it("a body that isn't JSON is 415, even from our own origin; a bodiless POST is fine", async () => {
    const o = await s();
    for (const type of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
    ]) {
      const res = await raw("/users/invites", {
        method: "POST",
        headers: { "Content-Type": type, Origin: ORIGIN, Cookie: o.cookie },
        body: "email=a@b.co",
      });
      expect(res.status, type).toBe(415);
      expect(await bodyOf(res)).toEqual({ error: { code: "unsupported_media_type", message: "Send JSON" } });
    }
    const noType = await raw("/users/invites", {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: o.cookie },
      body: "{}",
    });
    expect(noType.status).toBe(415);
    const empty = await raw("/auth/sessions/revoke-all", {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: o.cookie },
    });
    expect(empty.status).toBe(200);
    const charset = await raw("/users/invites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Origin: ORIGIN,
        Cookie: (await s()).cookie,
      },
      body: JSON.stringify({ email: newEmail(), role: "staff" }),
    });
    expect(charset.status).toBe(201);
  });

  it("safe methods are not checked (a cross-origin GET reaches the guard)", async () => {
    const o = await s();
    const res = await raw("/auth/me", { headers: { Origin: "https://evil.example", Cookie: o.cookie } });
    expect(res.status).toBe(200);
  });

  it("refusals by CSRF are logged like any refusal", async () => {
    const o = await s();
    const id = "ray-csrf";
    await raw("/users/invites", {
      method: "POST",
      headers: { ...json, Origin: "https://evil.example", Cookie: o.cookie, "cf-ray": id },
      body: "{}",
    });
    expect(await rows("SELECT status, route FROM access_log WHERE request_id = ?", id)).toEqual([
      { status: 403, route: "/api/v1/users/invites" },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("request ids and response headers (LD7, docs/05 §7.1)", () => {
  it("cf-ray is the request id; without it a 16-hex id is made; every error body carries it", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const staff = await sessionFor("staff");
    const cases: [string, Parameters<typeof call>[1]][] = [
      ["/auth/login", { body: { email: "nope" } }], // 400
      ["/auth/me", {}], // 401
      ["/users", { cookie: staff.cookie }], // 403
      ["/nothing/here", {}], // 404
      ["/users/invites", { body: { email: staff.email, role: "staff" }, cookie: o.cookie }], // 409
      ["/auth/login", { body: { email: "a@b.co", clientHash: "x".repeat(20_000) } }], // 413
    ];
    for (const [path, init] of cases) {
      const withRay = await call(path, { ...init, headers: { "cf-ray": "8f0c1a2b3c4d5e6f-BOM" } });
      expect(withRay.status).toBeGreaterThanOrEqual(400);
      expect(((await withRay.json()) as { request_id: string }).request_id).toBe("8f0c1a2b3c4d5e6f-BOM");
      const without = await call(path, init);
      expect(((await without.json()) as { request_id: string }).request_id).toMatch(/^[0-9a-f]{16}$/);
    }
    const wrongType = await app.request(
      `${ORIGIN}/api/v1/users/invites`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain", Origin: ORIGIN, Cookie: o.cookie },
        body: "x",
      },
      env,
    );
    expect(((await wrongType.json()) as { request_id: string }).request_id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("two requests get different ids", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++)
      ids.add(((await (await call("/auth/me")).json()) as { request_id: string }).request_id);
    expect(ids.size).toBe(5);
  });

  it("every /api response is no-store, success or error", async () => {
    const s = await sessionFor("staff");
    for (const [path, init] of [
      ["/health", {}],
      ["/auth/me", { cookie: s.cookie }],
      ["/auth/me", {}],
      ["/users", { cookie: s.cookie }],
      ["/nothing", {}],
      ["/auth/salt", { body: { email: "a@b.co" } }],
    ] as [string, Parameters<typeof call>[1]][]) {
      expect((await call(path, init)).headers.get("Cache-Control"), path).toBe("no-store");
    }
  });

  it("D1 calls: a refusal by the guard is 1 read + the access row; an allowed read adds its own", async () => {
    const s = await sessionFor("staff");
    const denied = await counting("/users", { cookie: s.cookie });
    expect([denied.res.status, denied.calls]).toEqual([403, 2]);
    const o = await sessionFor("owner");
    const read = await counting("/users", { cookie: o.cookie });
    expect([read.res.status, read.calls]).toEqual([200, 3]);
  });

  it("the invite helper and accept helper agree with the table (smoke)", async () => {
    const token = await invite(newEmail(), "staff");
    const e = await accept(token);
    expect((await call("/auth/me", { cookie: e.cookie })).status).toBe(200);
  });
});
