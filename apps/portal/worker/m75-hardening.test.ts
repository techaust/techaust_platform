// M7.5 hardening of the portal Worker (docs/runs/m7.5-hardening.md, B1): Rate Limiting per address on the sign-in and emailed-link rows (C2) and per
// session (L2), each before any D1 work and before Turnstile's siteverify; the API policy on every answer without its own (C3a, L11); the GET refusal by
// Sec-Fetch-Site (L3: a cross-site navigation can't write `viewed_at`). Every case is a failure path first. All data is made up.
import { env } from "cloudflare:workers";
import type { Limiter } from "@techaust/auth";
import { API_CSP } from "@techaust/core/file-types";
import { describe, expect, it, vi } from "vitest";
import { fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import { mkOffer } from "./offer-fixtures.ts";
import { addressBindingOf } from "./rate-limit.ts";
import { bodyOf, call, counted, countOf, sessionFor, siteverify, withEnv } from "./test-helpers.ts";

const RATE_LIMITED_BODY = { code: "rate_limited", message: "Too many requests. Please try again later." };

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

const LIMITED = ROUTES.filter((r) => r.method === "POST" && addressBindingOf(r.path) !== null);

describe("C2: the sign-in and emailed-link rows are limited per address, before any D1 work and before Turnstile [ASVS 2.4.1]", () => {
  it("covers both sign-in rows, the sign-out, every /t/* row and the PayPal return (full audit AU13), and nothing else", () => {
    expect(LIMITED.map((r) => r.path).sort()).toEqual(
      ROUTES.filter(
        (r) =>
          r.path === "/api/v1/auth/magic" ||
          r.path === "/api/v1/auth/magic/verify" ||
          r.path === "/api/v1/auth/logout" ||
          r.path === "/api/v1/pay/paypal/return" ||
          r.path.startsWith("/api/v1/t/"),
      )
        .map((r) => r.path)
        .sort(),
    );
    expect(LIMITED.length).toBeGreaterThanOrEqual(12);
    expect(addressBindingOf("/api/v1/auth/magic")).toBe("RL_SIGNIN");
    expect(addressBindingOf("/api/v1/auth/logout")).toBe("RL_SIGNIN");
    expect(addressBindingOf("/api/v1/t/offer/accept")).toBe("RL_LINKS");
    expect(addressBindingOf("/api/v1/pay/paypal/return")).toBe("RL_LINKS");
    // every public POST row that is not limited per address touches no D1 before its own checks: today, none is left
    expect(
      ROUTES.filter(
        (r) => r.method === "POST" && r.access === "public" && addressBindingOf(r.path) === null,
      ).map((r) => r.path),
    ).toEqual([]);
  });

  for (const row of LIMITED) {
    it(`${row.path} over the limit: 429 rate_limited, Retry-After; no D1 call, no siteverify, no row anywhere`, async () => {
      const binding = addressBindingOf(row.path) as string;
      const c = counted();
      const refusing = limiter(false);
      const before = { access: await countOf("access_log"), attempts: await countOf("auth_attempts") };
      const res = await call(
        row.path.replace("/api/v1", ""),
        { body: { email: "nobody@example.com", token: "x".repeat(43) }, ip: "203.0.113.88" },
        withEnv(c.env, { [binding]: refusing.l }),
      );
      expect(res.status).toBe(429);
      expect((await bodyOf(res)).error).toEqual(RATE_LIMITED_BODY);
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(res.headers.get("Content-Security-Policy")).toBe(API_CSP);
      expect(c.calls()).toBe(0);
      expect(siteverify.calls).toHaveLength(0);
      expect(await countOf("access_log")).toBe(before.access);
      expect(await countOf("auth_attempts")).toBe(before.attempts);
      expect(refusing.keys).toHaveLength(1);
      expect(refusing.keys[0]).not.toContain("203.0.113");
    });
  }

  it("keys: per route and per address (an IPv6 /64 is one address); a failing limiter lets the request through", async () => {
    const allowing = limiter(true);
    const e = withEnv(env, { RL_SIGNIN: allowing.l });
    let n = 0;
    const magic = (ip: string) => call("/auth/magic", { body: { email: `rl-${++n}@example.com` }, ip }, e);
    await magic("203.0.113.5");
    await magic("203.0.113.5");
    await magic("203.0.113.6");
    await magic("2001:db8:7:7::1");
    await magic("2001:db8:7:7::2");
    const [k1, k2, k3, v6a, v6b] = allowing.keys;
    expect(k1).toBe(k2);
    expect(k3).not.toBe(k1);
    expect(v6a).toBe(v6b);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken: Limiter = {
      limit: async () => {
        throw new Error("down");
      },
    };
    const res = await call(
      "/auth/magic",
      { body: { email: "rl-broken@example.com" } },
      withEnv(env, { RL_SIGNIN: broken }),
    );
    expect(res.status).toBe(200);
    expect(error.mock.calls.some((x) => String(x[0]).includes('"portal.RL_SIGNIN"'))).toBe(true);
  });
});

describe("L2: every signed-in request is limited per session, before any D1 work", () => {
  it("over the limit: 429, no D1 call, no access row; the key is an HMAC of the session id", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const c = counted();
    const refusing = limiter(false);
    const before = await countOf("access_log");
    const res = await call("/me", { cookie: s.cookie }, withEnv(c.env, { RL_SESSION: refusing.l }));
    expect(res.status).toBe(429);
    expect((await bodyOf(res)).error).toEqual(RATE_LIMITED_BODY);
    expect(c.calls()).toBe(0);
    expect(await countOf("access_log")).toBe(before);
    expect(refusing.keys[0]).toMatch(/^s:[0-9a-f]{32}$/);
    expect(refusing.keys[0]).not.toContain(s.sessionId.slice(0, 32));
  });

  it("within the limit the request goes on; no cookie: the limiter is not asked", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const allowing = limiter(true);
    const e = withEnv(env, { RL_SESSION: allowing.l });
    expect((await call("/me", { cookie: s.cookie }, e)).status).toBe(200);
    expect((await call("/me", {}, e)).status).toBe(401);
    expect(allowing.keys).toHaveLength(1);
  });
});

describe("C3a, L11: the API policy on every answer without its own; downloads keep the sandbox", () => {
  it("JSON, 401, 404 and a bad request carry default-src 'none'; frame-ancestors 'none'", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    for (const res of [
      await call("/me", { cookie: s.cookie }),
      await call("/me"),
      await call("/no-such-route"),
      await call("/auth/magic", { body: { email: 1 }, bare: true }),
    ]) {
      expect(res.headers.get("Content-Security-Policy")).toBe(API_CSP);
    }
  });

  it("an offer PDF keeps default-src 'none'; sandbox (offer-routes.test.ts holds the rest of its headers)", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const res = await call(`/offers/${o.id}/pdf`, { cookie: (await sessionFor(f.a.finance)).cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    await res.arrayBuffer();
  });
});

describe("L3: a GET under /api/ the browser marks as not from the portal's own pages is refused, so a link elsewhere can't write", () => {
  for (const site of ["cross-site", "same-site", "none"]) {
    it(`Sec-Fetch-Site: ${site} → 403 with no D1 call: the invoice's first view is not written`, async () => {
      const f = await fixtures();
      const s = await sessionFor(f.a.finance);
      const id = f.a.docs.issued;
      await env.DB.prepare("UPDATE documents SET viewed_at = NULL WHERE id = ?1").bind(id).run();
      const c = counted();
      const res = await call(
        `/invoices/${id}`,
        { cookie: s.cookie, headers: { "Sec-Fetch-Site": site } },
        c.env,
      );
      expect(res.status).toBe(403);
      expect((await bodyOf(res)).error).toEqual({ code: "forbidden", message: "Request refused" });
      expect(c.calls()).toBe(0);
      expect(await countOf("documents", "id = ?1 AND viewed_at IS NULL", id)).toBe(1);
    });
  }

  it("the SPA's own fetch (same-origin) is served and writes the first view, as before", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const id = f.a.docs.issued;
    await env.DB.prepare("UPDATE documents SET viewed_at = NULL WHERE id = ?1").bind(id).run();
    const res = await call(`/invoices/${id}`, {
      cookie: s.cookie,
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(res.status).toBe(200);
    expect(await countOf("documents", "id = ?1 AND viewed_at IS NOT NULL", id)).toBe(1);
  });
});
