// POST /api/v1/auth/magic/verify: using a sign-in link [POR-01, POR-02, NFR-9]. One batch decides: the address block,
// the single use, the session, its audit row and its access row.
import { env } from "cloudflare:workers";
import { PORTAL_ABS_MS, PORTAL_FAIL_LIMIT, PORTAL_IDLE_MS, portalFailKey, tokenHash } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import { NEW_SESSION_SQL, USE_LINK_SQL } from "./auth.ts";
import { fixtures } from "./fixtures.ts";
import app from "./index.ts";
import {
  attemptsRow,
  barrierDb,
  bodyOf,
  call,
  callerFor,
  counting,
  countOf,
  extraContact,
  linkFor,
  one,
  rows,
  setCookieLine,
  verify,
  withDb,
  writes,
} from "./test-helpers.ts";

const LINK_INVALID = {
  error: { code: "link_invalid", message: "This link has expired or was already used. Request a new link." },
};

describe("a link makes a session [POR-01, POR-02]", () => {
  it("200 {ok:true} with exactly the agreed cookie, in ONE D1 call", async () => {
    const f = await fixtures();
    const token = await linkFor(f.a.finance.id);
    const { res, calls } = await counting("/auth/magic/verify", { body: { token } });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ ok: true });
    expect(calls).toBe(1);
    const line = setCookieLine(res) as string;
    expect(line).toMatch(
      /^__Host-ta_portal=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000$/,
    );
    expect(line).not.toMatch(/Domain/i);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("the session belongs to that contact and that organisation; its token is stored only as SHA-256; 30 days idle, 90 absolute", async () => {
    const f = await fixtures();
    const token = await linkFor(f.a.plain.id);
    const t0 = Date.now();
    const { res, cookie } = await verify(token, {
      ip: "192.0.2.19",
      headers: { "User-Agent": "session-agent" },
    });
    expect(res.status).toBe(200);
    const raw = (cookie as string).split("=")[1] as string;
    const s = await one<Record<string, number | string | null>>(
      "SELECT * FROM client_sessions WHERE id = ?",
      await tokenHash(raw),
    );
    expect(s).toMatchObject({ contact_id: f.a.plain.id, client_id: f.a.id, revoked_at: null });
    // data minimisation (LD15): the session keeps neither address nor agent; the sign-in's access row has both
    expect(s).toMatchObject({ ip: null, user_agent: null });
    expect((s?.idle_expires_at as number) - (s?.last_seen_at as number)).toBe(PORTAL_IDLE_MS);
    expect((s?.abs_expires_at as number) - (s?.last_seen_at as number)).toBe(PORTAL_ABS_MS);
    expect(PORTAL_IDLE_MS).toBe(30 * 86_400_000);
    expect(PORTAL_ABS_MS).toBe(90 * 86_400_000);
    expect(Math.abs((s?.last_seen_at as number) - t0)).toBeLessThan(5_000);
    expect(JSON.stringify(await rows("SELECT * FROM client_sessions"))).not.toContain(raw);
  });

  it("the cookie works: GET /me answers for that contact", async () => {
    const f = await fixtures();
    const { cookie } = await verify(await linkFor(f.a.finance.id));
    const me = await call("/me", { cookie: cookie as string });
    expect(me.status).toBe(200);
    expect(await bodyOf(me)).toEqual({
      contact: { name: f.a.finance.name, email: f.a.finance.email },
      organisation: { displayName: f.a.name },
      canSeeFinance: true,
    });
  });

  it("every sign-in is a NEW session id", async () => {
    const f = await fixtures();
    const who = await extraContact(f.a.id);
    const first = await verify(await linkFor(who.id));
    const second = await verify(await linkFor(who.id));
    expect(first.cookie).not.toBe(second.cookie);
    expect(await countOf("client_sessions", "contact_id = ?", who.id)).toBe(2);
  });

  it("audit: exactly one portal.login row (actor contact, with request id, ip, agent); the access row names the contact", async () => {
    const f = await fixtures();
    const who = await extraContact(f.b.id);
    const token = await linkFor(who.id);
    const res = await call("/auth/magic/verify", {
      body: { token },
      ip: "192.0.2.44",
      headers: { "cf-ray": "ray-verify-ok", "User-Agent": "verify-agent" },
    });
    expect(res.status).toBe(200);
    const audit = await rows<Record<string, unknown>>(
      "SELECT actor_type, actor_id, role, action, entity_type, ip, user_agent, request_id, summary FROM audit_log WHERE request_id = 'ray-verify-ok'",
    );
    expect(audit).toEqual([
      {
        actor_type: "contact",
        actor_id: who.id,
        role: null,
        action: "portal.login",
        entity_type: "client_session",
        ip: "192.0.2.44",
        user_agent: "verify-agent",
        request_id: "ray-verify-ok",
        summary: '{"via":"magic_link"}',
      },
    ]);
    const access = await rows<Record<string, unknown>>(
      "SELECT realm, actor_id, method, route, status FROM access_log WHERE request_id = 'ray-verify-ok'",
    );
    expect(access).toEqual([
      { realm: "portal", actor_id: who.id, method: "POST", route: "/api/v1/auth/magic/verify", status: 200 },
    ]);
  });
});

describe("a link works once, and only while it lives [POR-01]", () => {
  it("single use: the second use is a 401 with the same body", async () => {
    const f = await fixtures();
    const token = await linkFor(f.a.finance.id);
    expect((await verify(token)).res.status).toBe(200);
    const again = await verify(token);
    expect(again.res.status).toBe(401);
    expect(await bodyOf(again.res)).toEqual(LINK_INVALID);
    expect(again.cookie).toBeNull();
  });

  it("expiry: a link with a minute left works; one that ended a minute ago does not (and a request makes it live 15 minutes)", async () => {
    const f = await fixtures();
    const live = await linkFor(f.a.finance.id, { expiresIn: 60_000 });
    const dead = await linkFor(f.a.finance.id, { expiresIn: -60_000 });
    expect((await verify(live)).res.status).toBe(200);
    const late = await verify(dead);
    expect(late.res.status).toBe(401);
    expect(await bodyOf(late.res)).toEqual(LINK_INVALID);
  });

  it("expired, used, unknown, malformed and 'contact lost access' are ONE answer (status, body) with the same 2 calls", async () => {
    const f = await fixtures();
    const lost = await extraContact(f.a.id);
    const lostToken = await linkFor(lost.id);
    await env.DB.prepare("UPDATE contacts SET portal_access = 0 WHERE id = ?").bind(lost.id).run();
    const anon = await extraContact(f.a.id);
    const anonToken = await linkFor(anon.id);
    await env.DB.prepare("UPDATE contacts SET anonymised_at = ? WHERE id = ?")
      .bind(Date.now(), anon.id)
      .run();
    const cases: [string, string][] = [
      ["expired", await linkFor(f.a.finance.id, { expiresIn: -1000 })],
      ["used", await linkFor(f.a.finance.id, { usedAt: Date.now() - 1000 })],
      ["unknown", "A".repeat(43)],
      ["malformed (short)", "abc"],
      ["malformed (symbols)", "!@#$%^&*()".repeat(5)],
      ["empty", ""],
      ["too long but allowed", "x".repeat(256)],
      ["lost portal access", lostToken],
      ["anonymised", anonToken],
    ];
    const seen = [];
    for (const [name, token] of cases) {
      const { res, calls } = await counting("/auth/magic/verify", { body: { token } });
      expect(res.status, name).toBe(401);
      expect(await bodyOf(res), name).toEqual(LINK_INVALID);
      expect(calls, name).toBe(2);
      expect(res.headers.getSetCookie(), name).toEqual([]);
      seen.push(name);
    }
    expect(seen).toHaveLength(cases.length);
  });

  it("a contact who lost access after the link was issued gets no session, and the link is spent", async () => {
    const f = await fixtures();
    const who = await extraContact(f.b.id);
    const token = await linkFor(who.id);
    await env.DB.prepare("UPDATE contacts SET portal_access = 0 WHERE id = ?").bind(who.id).run();
    const sessionsBefore = await countOf("client_sessions");
    const res = await verify(token);
    expect(res.res.status).toBe(401);
    expect(await countOf("client_sessions")).toBe(sessionsBefore);
    const row = await one<{ used_at: number | null }>(
      "SELECT used_at FROM magic_link_tokens WHERE token_hash = ?",
      await tokenHash(token),
    );
    expect(row?.used_at).not.toBeNull(); // that token stays used
    await env.DB.prepare("UPDATE contacts SET portal_access = 1 WHERE id = ?").bind(who.id).run();
    expect((await verify(token)).res.status).toBe(401); // even after access returns
  });

  it("a bad body (no token, not a string) is a 400 with no D1 call", async () => {
    for (const body of [{}, { token: 5 }, { token: null }, { token: "x".repeat(257) }]) {
      const { res, calls } = await counting("/auth/magic/verify", { body });
      expect(res.status).toBe(400);
      expect(calls).toBe(0);
    }
  });

  it("extra body fields are ignored (a client_id or contact_id changes nothing)", async () => {
    const f = await fixtures();
    const token = await linkFor(f.a.plain.id);
    const ok = await call("/auth/magic/verify", {
      body: { token, client_id: f.b.id, contact_id: f.b.finance.id },
    });
    expect(ok.status).toBe(200);
    const raw = (ok.headers.getSetCookie()[0] as string).split(";")[0]?.split("=")[1] as string;
    const s = await one<{ contact_id: string; client_id: string }>(
      "SELECT contact_id, client_id FROM client_sessions WHERE id = ?",
      await tokenHash(raw),
    );
    expect(s).toEqual({ contact_id: f.a.plain.id, client_id: f.a.id });
  });
});

describe("parallel uses of one link make exactly one session [POR-01]", () => {
  it("two parallel verifies: one 200, one 401, one session, one portal.login", async () => {
    const f = await fixtures();
    const who = await extraContact(f.a.id);
    const token = await linkFor(who.id);
    const racing = withDb(barrierDb(env.DB, 2));
    const [x, y] = await Promise.all([
      callerFor(app)("/auth/magic/verify", { body: { token } }, racing),
      callerFor(app)("/auth/magic/verify", { body: { token } }, racing),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 401]);
    expect(await countOf("client_sessions", "contact_id = ?", who.id)).toBe(1);
    expect(await countOf("audit_log", "action = 'portal.login' AND actor_id = ?", who.id)).toBe(1);
    const loser = x.status === 401 ? x : y;
    expect(await bodyOf(loser)).toEqual(LINK_INVALID);
  });

  it("changes() = 1 is what stops a second use in the SAME millisecond: the same two batches, same `now`, two session ids", async () => {
    // Two requests that read the clock in the same millisecond bind the same `now`. `used_at = now` alone then also
    // matches the row the FIRST batch just marked, so only `changes() = 1` (the UPDATE of THIS batch changed a row)
    // keeps the second batch from making a second session. This test fails if that condition is removed.
    const f = await fixtures();
    const who = await extraContact(f.a.id);
    const token = await linkFor(who.id);
    const hash = await tokenHash(token);
    const now = Date.now();
    const failKey = "p:fail:same-ms-test";
    const batch = (sessionId: string) =>
      env.DB.batch([
        env.DB.prepare(USE_LINK_SQL).bind(hash, now, failKey),
        env.DB.prepare(NEW_SESSION_SQL).bind(hash, sessionId, now, now + 1000, now + 2000),
      ]);
    const [used1, made1] = await batch("same-ms-session-1");
    expect([used1?.meta.changes, made1?.meta.changes]).toEqual([1, 1]);
    const [used2, made2] = await batch("same-ms-session-2");
    expect(used2?.meta.changes).toBe(0); // the link is spent
    expect(made2?.meta.changes).toBe(0); // and so no second session, though used_at = now still matches the row
    expect(await countOf("client_sessions", "contact_id = ?", who.id)).toBe(1);
    const spent = await one<{ used_at: number }>(
      "SELECT used_at FROM magic_link_tokens WHERE token_hash = ?",
      hash,
    );
    expect(spent?.used_at).toBe(now); // the premise: the second batch's `used_at = ?now` would have matched
    expect(NEW_SESSION_SQL).toContain("changes() = 1");
  });

  it("five parallel verifies of one link: still exactly one session", async () => {
    const f = await fixtures();
    const who = await extraContact(f.b.id);
    const token = await linkFor(who.id);
    const racing = withDb(barrierDb(env.DB, 5));
    const all = await Promise.all(
      Array.from({ length: 5 }, () => callerFor(app)("/auth/magic/verify", { body: { token } }, racing)),
    );
    expect(all.filter((r) => r.status === 200)).toHaveLength(1);
    expect(all.filter((r) => r.status === 401)).toHaveLength(4);
    expect(await countOf("client_sessions", "contact_id = ?", who.id)).toBe(1);
  });
});

describe("failed uses are counted per address; a blocked address writes nothing [POR-01]", () => {
  const ip = "192.0.2.201";
  it("20 failed uses in an hour block the address for 15 minutes: a VALID link then gets a 429, is not used up, nothing is written", async () => {
    const f = await fixtures();
    const token = await linkFor(f.a.finance.id);
    for (let i = 1; i <= PORTAL_FAIL_LIMIT; i++) {
      const { res } = await counting("/auth/magic/verify", { body: { token: `bad-${i}` }, ip });
      expect(res.status, `failure ${i}`).toBe(401);
    }
    const key = await portalFailKey(env.PORTAL_KEY_PEPPER, ip);
    expect((await attemptsRow(key))?.locked_until).toBeGreaterThan(Date.now());
    const counters = JSON.stringify(await rows("SELECT * FROM auth_attempts ORDER BY key"));
    const before = await writes();
    const { res, calls } = await counting("/auth/magic/verify", { body: { token }, ip });
    expect(res.status).toBe(429);
    expect(await bodyOf(res)).toEqual({
      error: { code: "rate_limited", message: "Too many requests. Please try again later." },
    });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(res.headers.get("Retry-After"))).toBeLessThanOrEqual(900);
    expect(calls).toBe(1);
    expect(await writes()).toEqual(before);
    expect(JSON.stringify(await rows("SELECT * FROM auth_attempts ORDER BY key"))).toBe(counters);
    expect(
      (
        await one<{ used_at: number | null }>(
          "SELECT used_at FROM magic_link_tokens WHERE token_hash = ?",
          await tokenHash(token),
        )
      )?.used_at,
    ).toBeNull();
    // another address still works, with the very same link
    expect((await verify(token, { ip: "192.0.2.202" })).res.status).toBe(200);
  });

  it("when the block ends the address works again", async () => {
    const f = await fixtures();
    const there = "192.0.2.211";
    for (let i = 0; i < PORTAL_FAIL_LIMIT; i++)
      await call("/auth/magic/verify", { body: { token: "nope" }, ip: there });
    const key = await portalFailKey(env.PORTAL_KEY_PEPPER, there);
    expect((await call("/auth/magic/verify", { body: { token: "nope" }, ip: there })).status).toBe(429);
    await env.DB.prepare("UPDATE auth_attempts SET locked_until = ? WHERE key = ?")
      .bind(Date.now() - 1, key)
      .run();
    expect((await verify(await linkFor(f.a.finance.id), { ip: there })).res.status).toBe(200);
  });

  it("a failed use is 2 calls and writes its counter and one access row (actor null, 401); no audit row", async () => {
    const before = await countOf("audit_log");
    const res = await call("/auth/magic/verify", {
      body: { token: "z".repeat(43) },
      ip: "192.0.2.221",
      headers: { "cf-ray": "ray-verify-bad" },
    });
    expect(res.status).toBe(401);
    expect(await countOf("audit_log")).toBe(before);
    expect(
      await rows("SELECT realm, actor_id, route, status FROM access_log WHERE request_id = 'ray-verify-bad'"),
    ).toEqual([{ realm: "portal", actor_id: null, route: "/api/v1/auth/magic/verify", status: 401 }]);
    const key = await portalFailKey(env.PORTAL_KEY_PEPPER, "192.0.2.221");
    expect((await attemptsRow(key))?.failures).toBe(1);
  });

  it("a request that is blocked writes no access row either", async () => {
    const there = "192.0.2.231";
    for (let i = 0; i < PORTAL_FAIL_LIMIT; i++)
      await call("/auth/magic/verify", { body: { token: "nope" }, ip: there });
    const before = await countOf("access_log");
    const res = await call("/auth/magic/verify", {
      body: { token: "nope" },
      ip: there,
      headers: { "cf-ray": "ray-blocked" },
    });
    expect(res.status).toBe(429);
    expect(await countOf("access_log")).toBe(before);
    expect(await countOf("access_log", "request_id = 'ray-blocked'")).toBe(0);
  });
});
