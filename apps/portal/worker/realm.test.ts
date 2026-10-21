// Realm separation, portal side [POR-02; M1.6]: a valid STAFF token sent as the portal cookie is a portal 401, and the
// staff session tables are never consulted. (The admin side is apps/admin/worker/realm.test.ts.)
import { env } from "cloudflare:workers";
import { ADMIN_COOKIE, newToken, PORTAL_COOKIE, tokenHash } from "@techaust/auth";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import app from "./index.ts";
import { bodyOf, call, counted, sessionFor } from "./test-helpers.ts";

/** A live staff session (owner) written straight to the database: the token and the cookie as the admin would set it. */
async function staffSession() {
  const id = uuidv7();
  const token = newToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_users (id, email, name, role, status, totp_enabled_at) VALUES (?1, ?2, 'Realm Owner', 'owner', 'active', ?3)",
    ).bind(id, `realm-${id.slice(-8)}@example.com`, now),
    env.DB.prepare(
      "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(await tokenHash(token), id, now, now + 43_200_000, now + 604_800_000),
  ]);
  return { token, id };
}

describe("a staff token is not a portal token [POR-02]", () => {
  it("a valid staff token sent as the portal cookie is a portal 401 (one read, no write)", async () => {
    const staff = await staffSession();
    const c = counted();
    const res = await app.request(
      "https://portal.example/api/v1/me",
      { headers: { Cookie: `${PORTAL_COOKIE}=${staff.token}`, Origin: "https://portal.example" } },
      c.env,
    );
    expect(res.status).toBe(401);
    expect(await bodyOf(res)).toEqual({ error: { code: "unauthenticated", message: "Sign in" } });
    expect(c.calls()).toBe(1);
  });

  it("the staff cookie under its own name is invisible to the portal (no D1 call at all)", async () => {
    const staff = await staffSession();
    const c = counted();
    const res = await app.request(
      "https://portal.example/api/v1/me",
      { headers: { Cookie: `${ADMIN_COOKIE}=${staff.token}`, Origin: "https://portal.example" } },
      c.env,
    );
    expect(res.status).toBe(401);
    expect(c.calls()).toBe(0);
  });

  it("with both cookies the portal reads only its own; swapped tokens are refused", async () => {
    const f = await fixtures();
    const staff = await staffSession();
    const mine = await sessionFor(f.a.plain);
    const both = `${ADMIN_COOKIE}=${staff.token}; ${mine.cookie}`;
    expect((await call("/me", { cookie: both })).status).toBe(200);
    const swapped = `${ADMIN_COOKIE}=${mine.token}; ${PORTAL_COOKIE}=${staff.token}`;
    expect((await call("/me", { cookie: swapped })).status).toBe(401);
  });

  it("no portal route consults a staff table: the staff session id is not found among client sessions", async () => {
    const staff = await staffSession();
    expect(
      await env.DB.prepare("SELECT 1 AS x FROM client_sessions WHERE id = ?")
        .bind(await tokenHash(staff.token))
        .first(),
    ).toBeNull();
  });
});
