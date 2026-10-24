// Realm separation, admin side [POR-02, ADM-AUTH-05; M1.6]: staff and clients share one database but nothing else. A
// valid portal token sent as the admin cookie is an admin 401 (the portal side, a staff token as the portal cookie, is
// apps/portal/worker/realm.test.ts: each Worker's tests exercise that Worker's own code only).
import { env } from "cloudflare:workers";
import {
  ADMIN_COOKIE,
  newToken,
  PORTAL_COOKIE,
  portalSessionCookie,
  sessionCookie,
  tokenHash,
} from "@techaust/auth";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { bodyOf, call, sessionFor } from "./test-helpers.ts";

/** A client, a contact with portal access and a live portal session, written straight to the database. */
async function portalSession() {
  const clientId = uuidv7();
  const contactId = uuidv7();
  const token = newToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, 'Realm Test Pvt Ltd', 'Realm Test', 'business', 'IN', 'unregistered', '19', 'INR')",
    ).bind(clientId, `RT-${clientId.slice(-8)}`),
    env.DB.prepare(
      "INSERT INTO contacts (id, client_id, name, email, portal_access) VALUES (?1, ?2, 'Realm Contact', ?3, 1)",
    ).bind(contactId, clientId, `realm-${contactId.slice(-8)}@example.test`),
    env.DB.prepare(
      "INSERT INTO client_sessions (id, contact_id, client_id, last_seen_at, idle_expires_at, abs_expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    ).bind(await tokenHash(token), contactId, clientId, now, now + 86_400_000, now + 2 * 86_400_000),
  ]);
  return { token };
}

describe("a portal token is not a staff token [POR-02]", () => {
  it("the two cookies have different names and different SameSite (staff Strict, clients Lax)", () => {
    expect(ADMIN_COOKIE).toBe("__Host-ta_admin");
    expect(PORTAL_COOKIE).toBe("__Host-ta_portal");
    expect(sessionCookie("t", 1)).toContain("SameSite=Strict");
    expect(portalSessionCookie("t")).toContain("SameSite=Lax");
  });

  it("a valid portal token sent as the admin cookie is an admin 401", async () => {
    const p = await portalSession();
    const res = await call("/auth/me", { cookie: `${ADMIN_COOKIE}=${p.token}` });
    expect(res.status).toBe(401);
    expect(await bodyOf(res)).toEqual({ error: { code: "unauthenticated", message: "Sign in" } });
    // under its own name the admin doesn't even look at it
    expect((await call("/auth/me", { cookie: `${PORTAL_COOKIE}=${p.token}` })).status).toBe(401);
  });

  it("a staff session still works for the admin (the token above would be the only difference)", async () => {
    const staff = await sessionFor("owner");
    expect((await call("/auth/me", { cookie: staff.cookie })).status).toBe(200);
  });

  it("with both cookies the admin reads only its own; swapped tokens are refused", async () => {
    const staff = await sessionFor("staff");
    const p = await portalSession();
    expect((await call("/auth/me", { cookie: `${staff.cookie}; ${PORTAL_COOKIE}=${p.token}` })).status).toBe(
      200,
    );
    const swapped = `${ADMIN_COOKIE}=${p.token}; ${PORTAL_COOKIE}=${staff.cookie.split("=")[1]}`;
    expect((await call("/auth/me", { cookie: swapped })).status).toBe(401);
  });

  it("the session tables are separate: a portal session id is no staff session, and the reverse", async () => {
    const staff = await sessionFor("owner");
    const p = await portalSession();
    expect(
      await env.DB.prepare("SELECT 1 AS x FROM client_sessions WHERE id = ?").bind(staff.sessionId).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT 1 AS x FROM staff_sessions WHERE id = ?")
        .bind(await tokenHash(p.token))
        .first(),
    ).toBeNull();
  });
});
