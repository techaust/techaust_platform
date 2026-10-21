// Realm separation [POR-02, ADM-AUTH-05; M1.6]: staff and clients share one database but nothing else. A valid staff
// token sent as the portal cookie is a portal 401, and a valid portal token sent as the admin cookie is an admin 401.
// The portal's Worker code runs here with the portal's one secret passed in by the test.
import { env } from "cloudflare:workers";
import { ADMIN_COOKIE, newToken, PORTAL_COOKIE, tokenHash } from "@techaust/auth";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import portal from "../../portal/worker/index.ts";
import { bodyOf, call, sessionFor } from "./test-helpers.ts";

const PEPPER = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));
const portalEnv = new Proxy(env, {
  get: (t, k) => (k === "PORTAL_KEY_PEPPER" ? PEPPER : Reflect.get(t, k)),
}) as Env;

const portalCall = (path: string, cookie?: string) =>
  portal.request(
    `https://portal.example/api/v1${path}`,
    { headers: { Origin: "https://portal.example", ...(cookie ? { Cookie: cookie } : {}) } },
    portalEnv,
  );

/** A client, a contact with portal access and a live portal session, written straight to the database. */
async function portalSession() {
  const clientId = uuidv7();
  const contactId = uuidv7();
  const token = newToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency) VALUES (?1, ?2, 'Realm Test Pvt Ltd', 'Realm Test', 'business', 'IN', 'unregistered', 'INR')",
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

describe("a staff token is not a portal token, and the reverse [POR-02]", () => {
  it("the two cookies have different names", () => {
    expect(ADMIN_COOKIE).toBe("__Host-ta_admin");
    expect(PORTAL_COOKIE).toBe("__Host-ta_portal");
  });

  it("a valid staff token sent as the portal cookie is a portal 401", async () => {
    const staff = await sessionFor("owner", { stepUp: true });
    const staffToken = staff.cookie.split("=")[1] as string;
    expect((await call("/auth/me", { cookie: staff.cookie })).status).toBe(200); // it IS valid, for the admin
    const res = await portalCall("/me", `${PORTAL_COOKIE}=${staffToken}`);
    expect(res.status).toBe(401);
    expect(await bodyOf(res)).toEqual({ error: { code: "unauthenticated", message: "Sign in" } });
    // sent under its own name to the portal: no portal cookie at all
    expect((await portalCall("/me", staff.cookie)).status).toBe(401);
  });

  it("a valid portal token sent as the admin cookie is an admin 401", async () => {
    const p = await portalSession();
    expect((await portalCall("/me", `${PORTAL_COOKIE}=${p.token}`)).status).toBe(200); // it IS valid, for the portal
    const res = await call("/auth/me", { cookie: `${ADMIN_COOKIE}=${p.token}` });
    expect(res.status).toBe(401);
    expect(await bodyOf(res)).toEqual({ error: { code: "unauthenticated", message: "Sign in" } });
    expect((await call("/auth/me", { cookie: `${PORTAL_COOKIE}=${p.token}` })).status).toBe(401);
  });

  it("with both cookies the portal reads only its own and the admin only its own", async () => {
    const staff = await sessionFor("staff");
    const p = await portalSession();
    const both = `${staff.cookie}; ${PORTAL_COOKIE}=${p.token}`;
    expect((await portalCall("/me", both)).status).toBe(200);
    expect((await call("/auth/me", { cookie: both })).status).toBe(200);
    // swapped: each side gets the other realm's token under its own name
    const swapped = `${ADMIN_COOKIE}=${p.token}; ${PORTAL_COOKIE}=${staff.cookie.split("=")[1]}`;
    expect((await portalCall("/me", swapped)).status).toBe(401);
    expect((await call("/auth/me", { cookie: swapped })).status).toBe(401);
  });

  it("the session tables are separate: a staff session id is no portal session and the reverse", async () => {
    const staff = await sessionFor("owner");
    const p = await portalSession();
    const inPortal = await env.DB.prepare("SELECT 1 AS x FROM client_sessions WHERE id = ?")
      .bind(staff.sessionId)
      .first();
    const inStaff = await env.DB.prepare("SELECT 1 AS x FROM staff_sessions WHERE id = ?")
      .bind(await tokenHash(p.token))
      .first();
    expect(inPortal).toBeNull();
    expect(inStaff).toBeNull();
  });

  it("their cookies differ in SameSite: staff Strict, clients Lax (a link from an email must land signed in)", async () => {
    const { sessionCookie, portalSessionCookie } = await import("@techaust/auth");
    expect(sessionCookie("t", 1)).toContain("SameSite=Strict");
    expect(portalSessionCookie("t")).toContain("SameSite=Lax");
  });
});
