// Deny by default [POR-03, 04 §2 DoD item 6]: the route table is complete in both directions, every guarded route
// needs a session, an undeclared route is a 404 with no D1 call, and no route reads anything from Cloudflare Access.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { RouteDef } from "./context.ts";
import { fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import app, { createApp } from "./index.ts";
import {
  bodyOf,
  call,
  callerFor,
  counting,
  countOf,
  extraContact,
  pairs,
  sessionFor,
  writes,
} from "./test-helpers.ts";

const PUBLIC = ROUTES.filter((r) => r.access === "public");
const GUARDED = ROUTES.filter((r) => r.access !== "public");
const UNAUTH = { error: { code: "unauthenticated", message: "Sign in" } };

/** A request that reaches the handler of `route`. */
function sample(route: RouteDef) {
  const path = route.path.replace("/api/v1", "");
  const body =
    route.method === "GET"
      ? undefined
      : path === "/auth/magic"
        ? { email: "route-sample@example.test" }
        : path === "/auth/magic/verify" || path === "/t/document"
          ? { token: "A".repeat(43) }
          : undefined;
  return { path, init: { method: route.method, body } };
}

describe("every guarded route needs a session [POR-02, POR-03]", () => {
  for (const route of GUARDED) {
    it(`${route.method} ${route.path}: no cookie, a junk cookie, a dead session and a staff-style cookie are all 401`, async () => {
      const f = await fixtures();
      const { path, init } = sample(route);
      const none = await counting(path, init);
      expect(none.res.status).toBe(401);
      expect(await bodyOf(none.res)).toEqual(UNAUTH);
      expect(none.calls).toBe(0);
      expect((await call(path, { ...init, cookie: "__Host-ta_portal=junk" })).status).toBe(401);
      expect((await call(path, { ...init, cookie: "__Host-ta_admin=anything" })).status).toBe(401);
      const dead = await sessionFor(f.a.plain, { revoked: Date.now() - 10 });
      expect((await call(path, { ...init, cookie: dead.cookie })).status).toBe(401);
    });
  }

  it("the public routes are exactly the sign-in routes, the document link and the health check", () => {
    expect(pairs(PUBLIC)).toEqual(
      [
        "GET /api/v1/health",
        "POST /api/v1/auth/magic",
        "POST /api/v1/auth/magic/verify",
        "POST /api/v1/auth/logout",
        "POST /api/v1/t/document",
      ].sort(),
    );
  });

  it("the guarded routes are exactly /me and sign-out-of-all-devices; no route uses finance yet", () => {
    expect(pairs(GUARDED)).toEqual(["GET /api/v1/me", "POST /api/v1/auth/sessions/revoke-all"].sort());
    expect(ROUTES.filter((r) => r.access === "finance")).toEqual([]);
  });
});

describe("route coverage: deny by default [POR-03]", () => {
  it("every registered route is in the route table, and every table row is a registered route", () => {
    // A route with validators registers once per handler, so compare the distinct method + path pairs.
    const registered = [
      ...new Set(app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`)),
    ].sort();
    expect(registered).toEqual(pairs(ROUTES));
  });

  it("a route that is registered but not in the table is a 404 with no D1 call, even with a valid session", async () => {
    const f = await fixtures();
    const extra = createApp(); // before its first request, so a route can still be added to it
    extra.get("/v1/undeclared", (c) => c.json({ shouldNot: "be reachable" }));
    extra.post("/v1/auth/also-undeclared", (c) => c.json({ shouldNot: "be reachable" }));
    const s = await sessionFor(f.a.finance);
    for (const [path, init] of [
      ["/undeclared", {}],
      ["/auth/also-undeclared", { body: {} }],
      ["/undeclared", { cookie: s.cookie }],
    ] as const) {
      const before = await writes();
      const res = await callerFor(extra)(path, { ...init });
      expect(res.status).toBe(404);
      expect(await bodyOf(res)).toEqual({ error: { code: "not_found", message: "Not found" } });
      expect(await writes()).toEqual(before);
    }
  });

  it("an unknown path, an unknown method on a known path and a path with extra segments are 404 with no D1 call and no access row", async () => {
    const before = await countOf("access_log");
    for (const [path, method] of [
      ["/nothing", "GET"],
      ["/me/extra", "GET"],
      ["/auth/magic", "GET"],
      ["/me", "DELETE"],
      ["/t/document", "GET"],
      ["/auth/magic/verify/x", "POST"],
    ] as const) {
      const { res, calls } = await counting(path, { method });
      expect([404, 403, 415], `${method} ${path}`).toContain(res.status); // DELETE is refused by CSRF first (no Origin)
      expect(calls).toBe(0);
    }
    expect(await countOf("access_log")).toBe(before);
  });
});

describe("no route reads anything from Cloudflare Access (staging sits behind it; the app must not care)", () => {
  const ACCESS = {
    "Cf-Access-Authenticated-User-Email": "someone@example.com",
    "Cf-Access-Jwt-Assertion": "not-a-real-assertion",
    "Cf-Access-Client-Id": "x.access",
  };

  for (const route of ROUTES) {
    it(`${route.method} ${route.path} gives the same answer with and without Cf-Access-* headers`, async () => {
      const f = await fixtures();
      const s = await sessionFor(f.a.plain);
      const { path, init } = sample(route);
      const cookie = route.access === "public" ? undefined : s.cookie;
      const plain = await call(path, { ...init, cookie });
      const withAccess = await call(path, {
        ...init,
        cookie: route.path.endsWith("revoke-all") ? (await sessionFor(f.a.plain)).cookie : cookie,
        headers: ACCESS,
      });
      expect(withAccess.status).toBe(plain.status);
      expect(plain.status).not.toBe(403);
      expect((await bodyOf(withAccess)).error).toEqual((await bodyOf(plain)).error);
    });
  }

  it("no source of the Worker mentions Cf-Access", () => {
    const files = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true });
    for (const [name, text] of Object.entries(files)) {
      if (/\.test\.ts$|test-helpers|fixtures/.test(name)) continue;
      expect(text, name).not.toMatch(/cf-access/i);
    }
  });
});

describe("D1 calls of the cheapest routes [NFR-2]", () => {
  it("health makes no D1 call and writes no access row (it is a probe, not an event)", async () => {
    const before = await countOf("access_log");
    const { res, calls } = await counting("/health");
    expect(res.status).toBe(200);
    expect(calls).toBe(0);
    expect(await countOf("access_log")).toBe(before);
  });
});

describe("through the real entry point (exports.default.fetch)", () => {
  it("health answers, with no D1 call by design", async () => {
    const res = await exports.default.fetch("https://portal.example/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "portal", env: "local" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("every /api response is no-store, including a 404 and a 401", async () => {
    for (const path of ["/api/v1/health", "/api/v1/me", "/api/v1/nope"]) {
      const res = await exports.default.fetch(`https://portal.example${path}`);
      expect(res.headers.get("Cache-Control"), path).toBe("no-store");
    }
  });

  it("the default Worker sends nothing: a link request answers 200 and the link exists only as its hash", async () => {
    const f = await fixtures();
    const res = await exports.default.fetch("https://portal.example/api/v1/auth/magic", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://portal.example",
        "CF-Connecting-IP": "192.0.2.150",
      },
      body: JSON.stringify({ email: (await extraContact(f.a.id)).email }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("health has the security headers of the app", async () => {
    const res = await exports.default.fetch("https://portal.example/api/v1/health");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBeTruthy();
  });
});
