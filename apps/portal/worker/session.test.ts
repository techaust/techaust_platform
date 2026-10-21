// The signed-in session [POR-02, POR-03, NFR-9]: the guard's one read, expiry, the 15-minute touch, sign out, sign out
// of all devices, and a session that ends the moment its contact's access does.
import { env } from "cloudflare:workers";
import { PORTAL_ABS_MS, PORTAL_IDLE_MS, TOUCH_EVERY_MS } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import {
  bodyOf,
  call,
  cookieOf,
  counting,
  countOf,
  extraContact,
  one,
  rows,
  sessionFor,
  setCookieLine,
  writes,
} from "./test-helpers.ts";

const UNAUTH = { error: { code: "unauthenticated", message: "Sign in" } };
const DAY = 86_400_000;

describe("GET /me [POR-02, POR-03]", () => {
  it("answers for the session's contact and organisation only; 1 guard read + 1 access write", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const { res, calls } = await counting("/me", { cookie: s.cookie });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({
      contact: { name: f.a.plain.name, email: f.a.plain.email },
      organisation: { displayName: f.a.name },
      canSeeFinance: false,
    });
    expect(calls).toBe(2);
    const fin = await call("/me", { cookie: (await sessionFor(f.a.finance)).cookie });
    expect(((await fin.json()) as { canSeeFinance: boolean }).canSeeFinance).toBe(true);
  });

  it("no cookie: 401 with NO D1 call and no access row", async () => {
    const before = await countOf("access_log");
    const { res, calls } = await counting("/me");
    expect(res.status).toBe(401);
    expect(await bodyOf(res)).toEqual(UNAUTH);
    expect(calls).toBe(0);
    expect(await countOf("access_log")).toBe(before);
  });

  it("a junk cookie, an unknown session and an empty cookie: 401, ONE call (the read), no access row", async () => {
    const before = await countOf("access_log");
    for (const cookie of ["__Host-ta_portal=junk", `__Host-ta_portal=${"A".repeat(43)}`]) {
      const { res, calls } = await counting("/me", { cookie });
      expect(res.status).toBe(401);
      expect(await bodyOf(res)).toEqual(UNAUTH);
      expect(calls).toBe(1);
    }
    const empty = await counting("/me", { cookie: "__Host-ta_portal=" });
    expect(empty.res.status).toBe(401);
    expect(empty.calls).toBe(0);
    expect(await countOf("access_log")).toBe(before);
  });

  it("the access row names the contact, the route pattern and the status, in realm portal", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.b.plain);
    await call("/me", {
      cookie: s.cookie,
      headers: { "cf-ray": "ray-me-1", "User-Agent": "me-agent" },
      ip: "192.0.2.61",
    });
    expect(
      await rows(
        "SELECT realm, actor_id, method, route, status, ip, user_agent FROM access_log WHERE request_id = 'ray-me-1'",
      ),
    ).toEqual([
      {
        realm: "portal",
        actor_id: f.b.plain.id,
        method: "GET",
        route: "/api/v1/me",
        status: 200,
        ip: "192.0.2.61",
        user_agent: "me-agent",
      },
    ]);
  });
});

describe("expiry [POR-02]", () => {
  it("idle: just under 30 days of idleness is fine, 30 days is a 401", async () => {
    const f = await fixtures();
    const ok = await sessionFor(f.a.plain, { idleExpires: Date.now() + 5_000 });
    const gone = await sessionFor(f.a.plain, { idleExpires: Date.now() - 1 });
    expect((await call("/me", { cookie: ok.cookie })).status).toBe(200);
    expect((await call("/me", { cookie: gone.cookie })).status).toBe(401);
  });

  it("absolute: 90 days is a 401 even with activity that keeps the idle window open", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain, { idleExpires: Date.now() + 29 * DAY, absExpires: Date.now() - 1 });
    expect((await call("/me", { cookie: s.cookie })).status).toBe(401);
    const alive = await sessionFor(f.a.plain, { absExpires: Date.now() + 5_000 });
    expect((await call("/me", { cookie: alive.cookie })).status).toBe(200);
  });

  it("a revoked session is a 401", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain, { revoked: Date.now() - 10 });
    expect((await call("/me", { cookie: s.cookie })).status).toBe(401);
  });

  it("the numbers: 30 days idle, 90 days absolute, a touch at most every 15 minutes", () => {
    expect(PORTAL_IDLE_MS).toBe(30 * DAY);
    expect(PORTAL_ABS_MS).toBe(90 * DAY);
    expect(TOUCH_EVERY_MS).toBe(15 * 60_000);
  });
});

describe("the touch rides in the access write, at most every 15 minutes [POR-02, NFR-2]", () => {
  const touches = (seen: { sql: string }[]) =>
    seen.filter((s) => s.sql.startsWith("UPDATE client_sessions SET last_seen_at"));

  it("a session seen 16 minutes ago is touched in the same call as the access row; last_seen and idle move", async () => {
    const f = await fixtures();
    const old = Date.now() - 16 * 60_000;
    const s = await sessionFor(f.a.plain, { lastSeen: old, idleExpires: old + PORTAL_IDLE_MS });
    const { res, calls, seen } = await counting("/me", { cookie: s.cookie });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(touches(seen)).toHaveLength(1);
    const row = await one<{ last_seen_at: number; idle_expires_at: number }>(
      "SELECT last_seen_at, idle_expires_at FROM client_sessions WHERE id = ?",
      s.sessionId,
    );
    expect(row?.last_seen_at).toBeGreaterThan(old + 15 * 60_000);
    expect(Math.abs((row?.idle_expires_at as number) - (Date.now() + PORTAL_IDLE_MS))).toBeLessThan(5_000);
  });

  it("not touched again within 15 minutes", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain, { lastSeen: Date.now() - 60 * 60_000 });
    await call("/me", { cookie: s.cookie }); // touches
    const { seen, calls } = await counting("/me", { cookie: s.cookie });
    expect(touches(seen)).toHaveLength(0);
    expect(calls).toBe(2);
  });

  it("a session seen 14 minutes ago is not touched", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain, { lastSeen: Date.now() - 14 * 60_000 });
    const { seen } = await counting("/me", { cookie: s.cookie });
    expect(touches(seen)).toHaveLength(0);
  });

  it("the idle window can never pass the absolute end", async () => {
    const f = await fixtures();
    const abs = Date.now() + 3 * DAY;
    const s = await sessionFor(f.a.plain, { lastSeen: Date.now() - 20 * 60_000, absExpires: abs });
    await call("/me", { cookie: s.cookie });
    const row = await one<{ idle_expires_at: number }>(
      "SELECT idle_expires_at FROM client_sessions WHERE id = ?",
      s.sessionId,
    );
    expect(row?.idle_expires_at).toBe(abs);
  });
});

describe("sign out [POR-02]", () => {
  it("clears the cookie, revokes the session in ONE call, and the old cookie is a 401", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const { res, calls } = await counting("/auth/logout", { method: "POST", cookie: s.cookie });
    expect(res.status).toBe(204);
    expect(calls).toBe(1);
    expect(setCookieLine(res)).toBe("__Host-ta_portal=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    expect((await call("/me", { cookie: s.cookie })).status).toBe(401);
    const row = await one<{ revoked_at: number | null }>(
      "SELECT revoked_at FROM client_sessions WHERE id = ?",
      s.sessionId,
    );
    expect(row?.revoked_at).not.toBeNull();
  });

  it("audit: exactly one portal.logout row (actor contact); a second sign-out writes none", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    await call("/auth/logout", {
      method: "POST",
      cookie: s.cookie,
      headers: { "cf-ray": "ray-out-1", "User-Agent": "out-agent" },
      ip: "192.0.2.71",
    });
    expect(
      await rows(
        "SELECT actor_type, actor_id, action, entity_type, ip, user_agent FROM audit_log WHERE request_id = 'ray-out-1'",
      ),
    ).toEqual([
      {
        actor_type: "contact",
        actor_id: f.a.finance.id,
        action: "portal.logout",
        entity_type: "client_session",
        ip: "192.0.2.71",
        user_agent: "out-agent",
      },
    ]);
    await call("/auth/logout", { method: "POST", cookie: s.cookie, headers: { "cf-ray": "ray-out-2" } });
    expect(await countOf("audit_log", "request_id = 'ray-out-2'")).toBe(0);
    // the sign-out that ended a live session is a sign-in event: one access row (204, the contact). The second
    // one ended nothing, so it writes no access row either.
    expect(
      await rows(
        "SELECT request_id, actor_id, route, status FROM access_log WHERE request_id IN ('ray-out-1', 'ray-out-2') ORDER BY at",
      ),
    ).toEqual([
      { request_id: "ray-out-1", actor_id: f.a.finance.id, route: "/api/v1/auth/logout", status: 204 },
    ]);
  });

  it("without a cookie: 204, the cookie is cleared, NO D1 call, no access row", async () => {
    const before = await writes();
    const { res, calls } = await counting("/auth/logout", { method: "POST" });
    expect(res.status).toBe(204);
    expect(calls).toBe(0);
    expect(setCookieLine(res)).toMatch(/Max-Age=0/);
    expect(await writes()).toEqual(before);
  });

  it("with a cookie that matches no live session (junk, unknown, already revoked): 204, ONE D1 call, nothing written at all", async () => {
    const f = await fixtures();
    const dead = await sessionFor(f.a.plain, { revoked: Date.now() - 1000 });
    for (const cookie of [`__Host-ta_portal=${"B".repeat(43)}`, "__Host-ta_portal=junk", dead.cookie]) {
      const before = await writes();
      const { res, calls } = await counting("/auth/logout", { method: "POST", cookie });
      expect(res.status, cookie).toBe(204);
      expect(setCookieLine(res)).toMatch(/Max-Age=0/);
      expect(calls).toBe(1);
      expect(await writes()).toEqual(before); // no audit row, no access row
    }
  });

  it("signing out one device leaves the contact's other session alone", async () => {
    const f = await fixtures();
    const phone = await sessionFor(f.a.plain);
    const laptop = await sessionFor(f.a.plain);
    await call("/auth/logout", { method: "POST", cookie: phone.cookie });
    expect((await call("/me", { cookie: laptop.cookie })).status).toBe(200);
  });
});

describe("sign out of all devices [POR-02]", () => {
  it("revokes every live session of THIS contact; the same organisation's other contact and the other organisation keep theirs", async () => {
    const f = await fixtures();
    const mine = await extraContact(f.a.id);
    const me1 = await sessionFor(mine);
    const me2 = await sessionFor(mine);
    const colleague = await sessionFor(await extraContact(f.a.id));
    const other = await sessionFor(await extraContact(f.b.id));
    const already = await sessionFor(mine, { revoked: Date.now() - 1000 });
    const { res, calls } = await counting("/auth/sessions/revoke-all", {
      method: "POST",
      cookie: me1.cookie,
    });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ ok: true, revoked: 2 });
    expect(calls).toBe(2); // the guard read + one batch with the access row
    expect(setCookieLine(res)).toMatch(/Max-Age=0/);
    expect((await call("/me", { cookie: me1.cookie })).status).toBe(401);
    expect((await call("/me", { cookie: me2.cookie })).status).toBe(401);
    expect((await call("/me", { cookie: colleague.cookie })).status).toBe(200);
    expect((await call("/me", { cookie: other.cookie })).status).toBe(200);
    expect(
      (
        await one<{ revoked_at: number }>(
          "SELECT revoked_at FROM client_sessions WHERE id = ?",
          already.sessionId,
        )
      )?.revoked_at,
    ).toBeLessThan(Date.now() - 500);
  });

  it("audit: exactly one portal.sessions_revoke_all row, naming the contact", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.b.finance);
    await call("/auth/sessions/revoke-all", {
      method: "POST",
      cookie: s.cookie,
      headers: { "cf-ray": "ray-all-1" },
    });
    expect(
      await rows(
        "SELECT actor_type, actor_id, action, entity_type, entity_id FROM audit_log WHERE request_id = 'ray-all-1'",
      ),
    ).toEqual([
      {
        actor_type: "contact",
        actor_id: f.b.finance.id,
        action: "portal.sessions_revoke_all",
        entity_type: "contact",
        entity_id: f.b.finance.id,
      },
    ]);
    expect(
      await countOf(
        "access_log",
        "request_id = 'ray-all-1' AND actor_id = ? AND status = 200",
        f.b.finance.id,
      ),
    ).toBe(1);
  });

  it("needs a session: no cookie is a 401 and writes nothing", async () => {
    const before = await writes();
    const { res, calls } = await counting("/auth/sessions/revoke-all", { method: "POST" });
    expect(res.status).toBe(401);
    expect(calls).toBe(0);
    expect(await writes()).toEqual(before);
  });
});

describe("a session ends the moment its contact's access does, with no write [POR-02, POR-03]", () => {
  async function ends(change: (id: string, clientId: string) => Promise<void>) {
    const f = await fixtures();
    const who = await extraContact(f.a.id);
    const s = await sessionFor(who);
    expect((await call("/me", { cookie: s.cookie })).status).toBe(200);
    await change(who.id, f.b.id);
    const before = await writes();
    const { res, calls } = await counting("/me", { cookie: s.cookie });
    expect(res.status).toBe(401);
    expect(await bodyOf(res)).toEqual(UNAUTH);
    expect(calls).toBe(1);
    expect(await writes()).toEqual(before);
  }

  it("portal access turned off", () =>
    ends(async (id) => {
      await env.DB.prepare("UPDATE contacts SET portal_access = 0 WHERE id = ?").bind(id).run();
    }));
  it("the contact is anonymised", () =>
    ends(async (id) => {
      await env.DB.prepare("UPDATE contacts SET anonymised_at = ? WHERE id = ?").bind(Date.now(), id).run();
    }));
  it("the contact is moved to another client (the session stays tied to the organisation it was made for)", () =>
    ends(async (id, other) => {
      await env.DB.prepare("UPDATE contacts SET client_id = ? WHERE id = ?").bind(other, id).run();
    }));

  it("a session id with a cookie of another contact's is not accepted: the cookie IS the proof", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const stolenId = s.sessionId; // the database id (a hash), never the token
    expect((await call("/me", { cookie: `__Host-ta_portal=${stolenId}` })).status).toBe(401);
  });
});

describe("cookies [POR-02]", () => {
  it("a Set-Cookie of the portal app never carries Domain; a session cookie from verify has the full attribute set", async () => {
    const f = await fixtures();
    const { linkFor, verify } = await import("./test-helpers.ts");
    const { res } = await verify(await linkFor(f.a.plain.id));
    const line = setCookieLine(res) as string;
    for (const part of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=7776000"])
      expect(line).toContain(part);
    expect(line).not.toMatch(/Domain/i);
    expect(cookieOf(res)).toMatch(/^__Host-ta_portal=/);
  });
});
