// Sessions [ADM-AUTH-05] and known devices [ADM-AUTH-09]: expiry, the 15-minute touch, my sessions, signing out,
// cookie attributes, and the new-device alert.
import { env } from "cloudflare:workers";
import { currentStep, DEVICE_MAX_AGE_S, tokenHash, totpCode } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import {
  call,
  cookieOf,
  counting,
  countOf,
  enrol,
  extraSession,
  login,
  one,
  rows,
  sessionFor,
  signIn,
  userId,
} from "./test-helpers.ts";

const MIN = 60_000;
const setSession = (sessionId: string, sql: string, ...params: unknown[]) =>
  env.DB.prepare(`UPDATE staff_sessions SET ${sql} WHERE id = ?`)
    .bind(...params, sessionId)
    .run();
const me = (cookie: string) => call("/auth/me", { cookie });

describe("session lifetime [ADM-AUTH-05]", () => {
  it("a live session works; idle expiry, absolute expiry and revocation each end it", async () => {
    const s = await sessionFor("staff");
    expect((await me(s.cookie)).status).toBe(200);

    const idle = await sessionFor("staff");
    await setSession(idle.sessionId, "idle_expires_at = ?", Date.now() - 1);
    expect((await me(idle.cookie)).status).toBe(401);

    const abs = await sessionFor("staff");
    await setSession(abs.sessionId, "abs_expires_at = ?", Date.now() - 1);
    expect((await me(abs.cookie)).status).toBe(401);

    const revoked = await sessionFor("staff");
    await setSession(revoked.sessionId, "revoked_at = ?", Date.now());
    expect((await me(revoked.cookie)).status).toBe(401);
  });

  it("a deactivated member's sessions stop working at once", async () => {
    const s = await sessionFor("staff");
    expect((await me(s.cookie)).status).toBe(200);
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(s.id).run();
    expect((await me(s.cookie)).status).toBe(401);
  });

  it("a member who has not finished enrolling never gets a session (no TOTP, no access)", async () => {
    const s = await sessionFor("staff");
    await env.DB.prepare("UPDATE staff_users SET totp_enabled_at = NULL WHERE id = ?").bind(s.id).run();
    expect((await me(s.cookie)).status).toBe(401);
  });

  it("an unknown or malformed cookie is 401", async () => {
    for (const cookie of ["__Host-ta_admin=nonsense", "__Host-ta_admin=", "other=1"]) {
      expect((await me(cookie)).status).toBe(401);
    }
  });

  it("last_seen_at is refreshed at most every 15 minutes", async () => {
    const s = await sessionFor("staff");
    const lastSeen = async () =>
      (
        await one<{ last_seen_at: number }>(
          "SELECT last_seen_at FROM staff_sessions WHERE id = ?",
          s.sessionId,
        )
      )?.last_seen_at as number;
    const created = await lastSeen();
    await me(s.cookie);
    expect(await lastSeen()).toBe(created); // just made: no write

    await setSession(s.sessionId, "last_seen_at = ?", Date.now() - 14 * MIN);
    const before = await lastSeen();
    await me(s.cookie);
    expect(await lastSeen()).toBe(before); // 14 minutes: still no write

    await setSession(s.sessionId, "last_seen_at = ?", Date.now() - 16 * MIN);
    const old = await lastSeen();
    const r = await counting("/auth/me", { cookie: s.cookie });
    expect(r.calls).toBe(2); // the touch shares the access row's call: no extra
    const after = await lastSeen();
    expect(after).toBeGreaterThan(old);
    expect(after).toBeGreaterThan(Date.now() - 5_000);
  });

  it("the idle window is pushed forward by a touch, but never past the absolute end", async () => {
    const s = await sessionFor("staff");
    await setSession(
      s.sessionId,
      "last_seen_at = ?, idle_expires_at = ?, abs_expires_at = ?",
      Date.now() - 20 * MIN,
      Date.now() + 60 * MIN,
      Date.now() + 90 * MIN,
    );
    await me(s.cookie);
    const row = await one<{ idle_expires_at: number; abs_expires_at: number }>(
      "SELECT idle_expires_at, abs_expires_at FROM staff_sessions WHERE id = ?",
      s.sessionId,
    );
    expect(row?.idle_expires_at).toBe(row?.abs_expires_at); // 12 h would pass the 90-minute absolute end
  });
});

describe("my sessions [ADM-AUTH-05]", () => {
  it("lists my live sessions only, marks the current one and shows no credential", async () => {
    const s = await sessionFor("staff");
    const other = await extraSession(s);
    const dead = await extraSession(s);
    await setSession(dead.sessionId, "revoked_at = ?", Date.now());
    const someoneElse = await sessionFor("sales");

    const res = await call("/auth/sessions", { cookie: s.cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: {
        id: string;
        current: boolean;
        created_at: number;
        last_seen_at: number;
        ip: unknown;
        user_agent: unknown;
      }[];
    };
    const ids = body.sessions.map((x) => x.id);
    expect(ids.sort()).toEqual([s.sessionId, other.sessionId].sort());
    expect(ids).not.toContain(dead.sessionId);
    expect(ids).not.toContain(someoneElse.sessionId);
    expect(body.sessions.find((x) => x.current)?.id).toBe(s.sessionId);
    expect(body.sessions.filter((x) => x.current)).toHaveLength(1);
    for (const x of body.sessions)
      expect(Object.keys(x).sort()).toEqual([
        "created_at",
        "current",
        "id",
        "ip",
        "last_seen_at",
        "user_agent",
      ]);
    expect(JSON.stringify(body)).not.toContain(s.cookie.split("=")[1] as string); // the id is a hash, not the token
  });

  it("D1 calls: sessions 2 + the access row", async () => {
    const s = await sessionFor("staff");
    const r = await counting("/auth/sessions", { cookie: s.cookie });
    expect([r.res.status, r.calls]).toEqual([200, 3]);
  });

  it("signing out one other session ends it and leaves mine", async () => {
    const s = await sessionFor("staff");
    const other = await extraSession(s);
    const r = await counting(`/auth/sessions/${other.sessionId}`, { method: "DELETE", cookie: s.cookie });
    expect([r.res.status, r.calls]).toEqual([200, 2]);
    expect((await me(other.cookie)).status).toBe(401);
    expect((await me(s.cookie)).status).toBe(200);
    expect(await countOf("audit_log", "action = 'auth.session_revoke' AND actor_id = ?", s.id)).toBe(1);
  });

  it("deleting someone else's session is 404 and does nothing to it", async () => {
    const s = await sessionFor("staff");
    const victim = await sessionFor("staff");
    const res = await call(`/auth/sessions/${victim.sessionId}`, { method: "DELETE", cookie: s.cookie });
    expect(res.status).toBe(404);
    expect((await me(victim.cookie)).status).toBe(200);
    expect(await countOf("audit_log", "action = 'auth.session_revoke' AND actor_id = ?", s.id)).toBe(0);
    // an id that does not exist at all looks exactly the same
    const ghost = await call(`/auth/sessions/${await tokenHash("no-such-session")}`, {
      method: "DELETE",
      cookie: s.cookie,
    });
    expect(ghost.status).toBe(404);
    expect(await ghost.json()).toMatchObject({ error: { code: "not_found" } });
    expect((await call("/auth/sessions/not-a-hash", { method: "DELETE", cookie: s.cookie })).status).toBe(
      400,
    );
  });

  it("signing out this session clears the cookie", async () => {
    const s = await sessionFor("staff");
    const res = await call(`/auth/sessions/${s.sessionId}`, { method: "DELETE", cookie: s.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join("\n")).toMatch(/__Host-ta_admin=; .*Max-Age=0/);
    expect((await me(s.cookie)).status).toBe(401);
  });

  it("sign out everywhere ends every session of mine, this one too, and nobody else's", async () => {
    const s = await sessionFor("staff");
    const a = await extraSession(s);
    const b = await extraSession(s);
    const bystander = await sessionFor("staff");
    const r = await counting("/auth/sessions/revoke-all", { method: "POST", cookie: s.cookie });
    expect([r.res.status, r.calls]).toEqual([200, 2]);
    expect(r.res.headers.getSetCookie().join("\n")).toMatch(/__Host-ta_admin=; .*Max-Age=0/);
    for (const c of [s.cookie, a.cookie, b.cookie]) expect((await me(c)).status).toBe(401);
    expect((await me(bystander.cookie)).status).toBe(200);
    expect(await countOf("audit_log", "action = 'auth.session_revoke_all' AND actor_id = ?", s.id)).toBe(1);
  });
});

describe("cookie attributes [ADM-AUTH-05, -09]", () => {
  it("the session cookie is __Host-, HttpOnly, Secure, SameSite=Strict, Path=/, up to 7 days", async () => {
    const e = await enrol("cookie-attrs@example.com");
    const u = await userId(e.email);
    const res = await call("/auth/login", { body: { email: e.email, clientHash: e.clientHash } });
    const { challenge } = (await res.json()) as { challenge: string };
    await env.DB.prepare("UPDATE staff_users SET totp_last_step = NULL WHERE id = ?").bind(u).run();
    const t = await call("/auth/totp", {
      body: { challenge, code: totpCode(e.secret, currentStep(Date.now())) },
    });
    const cookies = t.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("__Host-ta_admin=")) as string;
    expect(session).toMatch(
      /^__Host-ta_admin=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=\d+$/,
    );
    const maxAge = Number(/Max-Age=(\d+)/.exec(session)?.[1]);
    expect(maxAge).toBeLessThanOrEqual(7 * 24 * 3600);
    expect(maxAge).toBeGreaterThan(7 * 24 * 3600 - 60);
    const device = cookies.find((c) => c.startsWith("__Host-ta_device=")) as string;
    expect(device).toBe(
      `${device.split(";")[0]}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DEVICE_MAX_AGE_S}`,
    );
    expect(device).toMatch(/^__Host-ta_device=[A-Za-z0-9_-]{43};/);
    expect(DEVICE_MAX_AGE_S).toBe(34_560_000);
  });
});

describe("known devices and alert.new_device [ADM-AUTH-09]", () => {
  const newDeviceAlerts = (id: string) =>
    rows<{ summary: string; actor_type: string; action: string }>(
      "SELECT summary, actor_type, action FROM audit_log WHERE action = 'alert.new_device' AND entity_id = ?",
      id,
    );

  it("enrolment stores the device and raises no alert; the same device later raises none either", async () => {
    const e = await enrol("dev-known@example.com");
    const id = await userId(e.email);
    expect(e.deviceCookie).toMatch(/^__Host-ta_device=/);
    expect(await countOf("staff_known_devices", "user_id = ?", id)).toBe(1);
    expect(await newDeviceAlerts(id)).toHaveLength(0);

    const again = await login(e.email, e.clientHash, e.secret, e.step + 1, e.deviceCookie as string);
    expect(again.status).toBe(200);
    expect(await newDeviceAlerts(id)).toHaveLength(0);
    expect(await countOf("staff_known_devices", "user_id = ?", id)).toBe(1);
    expect(again.device).toBe(e.deviceCookie); // the same token is kept and its life renewed
  });

  it("a sign-in with no device cookie (or a bad one) raises one alert and stores a new device", async () => {
    const u = await sessionFor("staff", { password: true });
    const first = await signIn(u, undefined); // new browser
    expect(first.res.status).toBe(200);
    expect(await newDeviceAlerts(u.id)).toHaveLength(1);
    expect(await countOf("staff_known_devices", "user_id = ?", u.id)).toBe(1);

    const second = await signIn(u, first.device as string); // the same browser again
    expect(second.res.status).toBe(200);
    expect(await newDeviceAlerts(u.id)).toHaveLength(1);

    const bad = await signIn(u, "__Host-ta_device=not-a-token"); // garbage counts as a new device
    expect(bad.res.status).toBe(200);
    expect(await newDeviceAlerts(u.id)).toHaveLength(2);
    expect(bad.device).not.toBe(first.device);
    expect(await countOf("staff_known_devices", "user_id = ?", u.id)).toBe(2);
  });

  it("a device token known for one member is new for another", async () => {
    const a = await sessionFor("staff", { password: true });
    const b = await sessionFor("staff", { password: true });
    const first = await signIn(a);
    const asB = await signIn(b, first.device as string);
    expect(asB.res.status).toBe(200);
    expect(await newDeviceAlerts(b.id)).toHaveLength(1);
  });

  it("the alert says where it came from and holds no secret", async () => {
    const u = await sessionFor("staff", { password: true });
    const res = await signIn(u);
    expect(res.res.status).toBe(200);
    const [alert] = await newDeviceAlerts(u.id);
    expect(alert?.actor_type).toBe("staff");
    expect(Object.keys(JSON.parse(alert?.summary as string)).sort()).toEqual(["city", "country", "ua"]);
    const everything = JSON.stringify(await rows("SELECT * FROM audit_log WHERE action LIKE 'alert.%'"));
    for (const secret of [u.clientHash, res.cookie as string, res.device as string, res.challenge])
      expect(everything).not.toContain(secret.split("=").at(-1) as string);
  });

  it("cookieOf finds the cookie by name (the helper the tests rely on)", async () => {
    const u = await sessionFor("staff", { password: true });
    const r = await signIn(u);
    expect(cookieOf(r.res)).toMatch(/^__Host-ta_admin=/);
    expect(cookieOf(r.res, "__Host-ta_device")).toMatch(/^__Host-ta_device=/);
    expect(cookieOf(r.res, "nope")).toBeNull();
  });
});
