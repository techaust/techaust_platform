// Staff management [ADM-AUTH-07] and its effect on sessions and alerts [ADM-AUTH-05, -09].
import { env } from "cloudflare:workers";
import { INVITE_TTL_MS, tokenHash } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import { createInviteStatements } from "../../../scripts/create-invite-sql.mjs";
import {
  auditReadBackSql,
  breakGlassStatements,
  checkBreakGlass,
  normaliseEmail,
  RESET_ROW_MARGIN_MS,
  readBackProblem,
  reinviteExpected,
  reinviteStatements,
  resetStatements,
} from "../../../scripts/reset-2fa-sql.mjs";
import {
  accept,
  bodyOf,
  call,
  challengeFor,
  counting,
  countOf,
  enrol,
  enrolCode,
  extraSession,
  finishOnly,
  invite,
  login,
  one,
  rows,
  sessionFor,
  signIn,
  tokenOfLink,
  userId,
} from "./test-helpers.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const newEmail = () => `person-${Math.random().toString(36).slice(2, 10)}@example.com`;
const LINK = /^https:\/\/admin\.example\/invite#t=[A-Za-z0-9_-]{43}$/;

async function inviteVia(o: { cookie: string }, email = newEmail(), role = "staff") {
  const res = await call("/users/invites", { body: { email, role }, cookie: o.cookie });
  return { res, email, body: (await res.clone().json()) as { link: string; expires_at: number } };
}

describe("inviting [ADM-AUTH-07]", () => {
  it("returns a one-time link, stores only its hash, expires in 48 hours, in 2 calls", async () => {
    const o = await owner();
    const email = newEmail();
    const t0 = Date.now();
    const r = await counting("/users/invites", { body: { email, role: "sales" }, cookie: o.cookie });
    expect([r.res.status, r.calls]).toEqual([201, 2]);
    const body = (await r.res.json()) as { link: string; expires_at: number };
    expect(body.link).toMatch(LINK);
    const hash = await tokenHash(tokenOfLink(body.link));
    const row = await one<{
      email: string;
      role: string;
      invited_by: string;
      expires_at: number;
      used_at: number | null;
    }>("SELECT email, role, invited_by, expires_at, used_at FROM staff_invites WHERE token_hash = ?", hash);
    expect(row).toMatchObject({ email, role: "sales", invited_by: o.id, used_at: null });
    expect(row?.expires_at).toBeGreaterThanOrEqual(t0 + INVITE_TTL_MS);
    expect(row?.expires_at).toBeLessThan(t0 + INVITE_TTL_MS + 10_000);
    expect(body.expires_at).toBe(row?.expires_at);
    expect(INVITE_TTL_MS).toBe(48 * 3_600_000);
    expect(JSON.stringify(await rows("SELECT * FROM staff_invites WHERE email = ?", email))).not.toContain(
      tokenOfLink(body.link),
    );
    expect(
      await countOf("audit_log", "action = 'user.invite' AND actor_id = ? AND entity_id = ?", o.id, hash),
    ).toBe(1);
    // L3: the audit summary holds the role only; the address stays in the erasable invite row.
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'user.invite' AND entity_id = ?",
      hash,
    );
    expect(JSON.parse(audit?.summary as string)).toEqual({ role: "sales" });
    expect(audit?.summary).not.toContain(email);
    expect(JSON.stringify(await rows("SELECT * FROM audit_log WHERE entity_id = ?", hash))).not.toContain(
      email,
    );
  });

  it("the link works once, end to end: name, password, code → an active member of that role", async () => {
    const o = await owner();
    const { email, body } = await inviteVia(o, newEmail(), "accountant");
    const e = await accept(tokenOfLink(body.link), "Asha Verma");
    expect(e.email).toBe(email);
    expect(await one("SELECT name, role, status FROM staff_users WHERE email = ?", email)).toEqual({
      name: "Asha Verma",
      role: "accountant",
      status: "active",
    });
    expect((await call("/auth/invite/start", { body: { token: tokenOfLink(body.link) } })).status).toBe(400);
    expect((await call("/auth/me", { cookie: e.cookie })).status).toBe(200);
  });

  it("an expired invite (48 hours later) is refused", async () => {
    const o = await owner();
    const { body } = await inviteVia(o);
    const hash = await tokenHash(tokenOfLink(body.link));
    await env.DB.prepare("UPDATE staff_invites SET expires_at = ? WHERE token_hash = ?")
      .bind(Date.now() - 1, hash)
      .run();
    expect((await call("/auth/invite/start", { body: { token: tokenOfLink(body.link) } })).status).toBe(400);
  });

  it("a revoked invite is refused and kept; revoking twice or a made-up hash is 404", async () => {
    const o = await owner();
    const { body } = await inviteVia(o);
    const hash = await tokenHash(tokenOfLink(body.link));
    const r = await counting(`/users/invites/${hash}/revoke`, { method: "POST", cookie: o.cookie });
    expect([r.res.status, r.calls]).toEqual([200, 2]);
    expect((await call("/auth/invite/start", { body: { token: tokenOfLink(body.link) } })).status).toBe(400);
    expect(await countOf("staff_invites", "token_hash = ?", hash)).toBe(1); // never deleted
    expect((await call(`/users/invites/${hash}/revoke`, { method: "POST", cookie: o.cookie })).status).toBe(
      404,
    );
    expect(
      (await call(`/users/invites/${"0".repeat(64)}/revoke`, { method: "POST", cookie: o.cookie })).status,
    ).toBe(404);
    expect((await call("/users/invites/xyz/revoke", { method: "POST", cookie: o.cookie })).status).toBe(400);
    expect(await countOf("audit_log", "action = 'user.invite_revoke' AND entity_id = ?", hash)).toBe(1);
  });

  it("a new invite for the same email expires the older pending ones", async () => {
    const o = await owner();
    const email = newEmail();
    const first = await inviteVia(o, email);
    const second = await inviteVia(o, email, "sales");
    expect((await call("/auth/invite/start", { body: { token: tokenOfLink(first.body.link) } })).status).toBe(
      400,
    );
    expect(
      (await call("/auth/invite/start", { body: { token: tokenOfLink(second.body.link) } })).status,
    ).toBe(200);
    const list = (await (await call("/users/invites", { cookie: o.cookie })).json()) as {
      invites: { email: string }[];
    };
    expect(list.invites.filter((i) => i.email === email)).toHaveLength(1);
  });

  it("an email that already belongs to a member is 409 user_exists, and writes nothing", async () => {
    const o = await owner();
    const existing = await sessionFor("staff");
    const before = await countOf("staff_invites");
    const res = await call("/users/invites", {
      body: { email: existing.email, role: "staff" },
      cookie: o.cookie,
    });
    expect(res.status).toBe(409);
    expect(await bodyOf(res)).toEqual({
      error: { code: "user_exists", message: "That email already belongs to a staff member" },
    });
    expect(await countOf("staff_invites")).toBe(before);
    // upper-case spelling of the same email is the same email
    const upper = await call("/users/invites", {
      body: { email: existing.email.toUpperCase(), role: "staff" },
      cookie: o.cookie,
    });
    expect(upper.status).toBe(409);
  });

  it("rejects a bad email or role with 400", async () => {
    const o = await owner();
    for (const body of [
      { email: "nope", role: "staff" },
      { email: newEmail(), role: "god" },
      { email: newEmail() },
    ]) {
      expect((await call("/users/invites", { body, cookie: o.cookie })).status).toBe(400);
    }
  });
});

describe("only the owner manages staff [ADM-AUTH-07, ADM-G-02]", () => {
  for (const role of ["staff", "sales", "accountant"] as const) {
    it(`${role} gets 403 on every /users route (even with a step-up)`, async () => {
      const s = await sessionFor(role, { stepUp: true });
      const target = await sessionFor("staff");
      const hash = "a".repeat(64);
      const requests: [string, string, unknown?][] = [
        ["GET", "/users"],
        ["GET", "/users/invites"],
        ["POST", "/users/invites", { email: newEmail(), role: "staff" }],
        ["POST", `/users/invites/${hash}/revoke`],
        ["POST", "/users/sessions/revoke-all"],
        ["PATCH", `/users/${target.id}`, { role: "owner" }],
        ["POST", `/users/${target.id}/deactivate`],
        ["POST", `/users/${target.id}/reset-2fa`],
      ];
      for (const [method, path, body] of requests) {
        const res = await call(path, {
          method,
          body: body ?? (method === "GET" ? undefined : {}),
          cookie: s.cookie,
        });
        expect(res.status, `${method} ${path}`).toBe(403);
      }
      // nothing happened to the target
      expect(await one("SELECT role, status FROM staff_users WHERE id = ?", target.id)).toEqual({
        role: "staff",
        status: "active",
      });
    });
  }

  it("the owner without a step-up can read but not write", async () => {
    const o = await sessionFor("owner");
    expect((await call("/users", { cookie: o.cookie })).status).toBe(200);
    expect(
      (await call("/users/invites", { body: { email: newEmail(), role: "staff" }, cookie: o.cookie })).status,
    ).toBe(403);
  });

  it("the list shows members without any secret, in 2 calls + the access row", async () => {
    const o = await owner();
    await sessionFor("sales", { password: true });
    const r = await counting("/users", { cookie: o.cookie });
    expect([r.res.status, r.calls]).toEqual([200, 3]);
    const body = (await r.res.json()) as { users: Record<string, unknown>[] };
    expect(body.users.length).toBeGreaterThan(1);
    for (const u of body.users)
      expect(Object.keys(u).sort()).toEqual([
        "created_at",
        "email",
        "id",
        "last_login_at",
        "name",
        "role",
        "status",
      ]);
    expect(JSON.stringify(body)).not.toMatch(/pw_|totp|hmac|secret/i);
    const denied = await counting("/users", { cookie: (await sessionFor("staff")).cookie });
    expect([denied.res.status, denied.calls]).toEqual([403, 2]);
  });
});

describe("changing a role [ADM-AUTH-07, ADM-AUTH-05]", () => {
  it("changes the role, ends the target's sessions, writes one audit row, in 2 calls", async () => {
    const o = await owner();
    const t = await sessionFor("staff");
    const t2 = await extraSession(t);
    const r = await counting(`/users/${t.id}`, {
      method: "PATCH",
      body: { role: "sales" },
      cookie: o.cookie,
    });
    expect([r.res.status, r.calls]).toEqual([200, 2]);
    expect(await r.res.json()).toEqual({ ok: true, changed: true });
    expect((await one<{ role: string }>("SELECT role FROM staff_users WHERE id = ?", t.id))?.role).toBe(
      "sales",
    );
    expect((await call("/auth/me", { cookie: t.cookie })).status).toBe(401);
    expect((await call("/auth/me", { cookie: t2.cookie })).status).toBe(401);
    const audit = await rows<{ summary: string; role: string }>(
      "SELECT summary, role FROM audit_log WHERE action = 'user.role_change' AND entity_id = ?",
      t.id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.role).toBe("owner");
    expect(JSON.parse(audit[0]?.summary as string)).toEqual({ role: { before: "staff", after: "sales" } });
  });

  it("the same role is a harmless no-op; an unknown, deactivated or malformed target is refused", async () => {
    const o = await owner();
    const t = await sessionFor("staff");
    const same = await call(`/users/${t.id}`, { method: "PATCH", body: { role: "staff" }, cookie: o.cookie });
    expect(await same.json()).toEqual({ ok: true, changed: false });
    expect(await countOf("audit_log", "action = 'user.role_change' AND entity_id = ?", t.id)).toBe(0);
    expect(
      (await call("/users/no-such-user", { method: "PATCH", body: { role: "staff" }, cookie: o.cookie }))
        .status,
    ).toBe(404);
    const gone = await sessionFor("staff");
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(gone.id).run();
    expect(
      (await call(`/users/${gone.id}`, { method: "PATCH", body: { role: "sales" }, cookie: o.cookie }))
        .status,
    ).toBe(404);
    expect(
      (await call(`/users/${t.id}`, { method: "PATCH", body: { role: "root" }, cookie: o.cookie })).status,
    ).toBe(400);
  });
});

describe("deactivating [ADM-AUTH-07, ADM-AUTH-05]", () => {
  it("ends every session at once (/me is 401), writes one audit row, in 2 calls", async () => {
    const o = await owner();
    const t = await sessionFor("sales");
    const r = await counting(`/users/${t.id}/deactivate`, { method: "POST", cookie: o.cookie });
    expect([r.res.status, r.calls]).toEqual([200, 2]);
    expect((await call("/auth/me", { cookie: t.cookie })).status).toBe(401);
    expect((await one<{ status: string }>("SELECT status FROM staff_users WHERE id = ?", t.id))?.status).toBe(
      "deactivated",
    );
    expect(await countOf("audit_log", "action = 'user.deactivate' AND entity_id = ?", t.id)).toBe(1);
    expect((await call(`/users/${t.id}/deactivate`, { method: "POST", cookie: o.cookie })).status).toBe(404); // already
    expect((await call("/users/no-such-user/deactivate", { method: "POST", cookie: o.cookie })).status).toBe(
      404,
    );
  });

  it("a deactivated member can't sign in again", async () => {
    const o = await owner();
    const e = await enrol(newEmail(), "staff");
    await call(`/users/${await userId(e.email)}/deactivate`, { method: "POST", cookie: o.cookie });
    const attempt = await login(e.email, e.clientHash, e.secret, e.step + 1);
    expect(attempt.status).toBe(401);
  });

  it("everyone else's sessions end with 'sign out all staff', the owner's own stays", async () => {
    const o = await owner();
    const a = await sessionFor("staff");
    const b = await sessionFor("sales");
    const r = await counting("/users/sessions/revoke-all", { method: "POST", cookie: o.cookie });
    expect([r.res.status, r.calls]).toEqual([200, 2]);
    for (const x of [a, b]) expect((await call("/auth/me", { cookie: x.cookie })).status).toBe(401);
    expect((await call("/auth/me", { cookie: o.cookie })).status).toBe(200);
    expect(await countOf("audit_log", "action = 'user.sessions_revoke_all' AND actor_id = ?", o.id)).toBe(1);
  });
});

describe("the last active owner [ADM-AUTH-07]", () => {
  /** Leaves exactly one active owner (the one returned); others are deactivated by SQL while it stays active. */
  async function soleOwner() {
    const o = await sessionFor("owner", { stepUp: true });
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE role = 'owner' AND id <> ?")
      .bind(o.id)
      .run();
    return o;
  }
  const LAST = { error: { code: "last_owner", message: "There must always be one active owner" } };

  it("the API refuses to demote or deactivate the last owner (409), and nothing changes", async () => {
    const o = await soleOwner();
    const demote = await call(`/users/${o.id}`, {
      method: "PATCH",
      body: { role: "staff" },
      cookie: o.cookie,
    });
    expect(demote.status).toBe(409);
    expect(await bodyOf(demote)).toEqual(LAST);
    const off = await call(`/users/${o.id}/deactivate`, { method: "POST", cookie: o.cookie });
    expect(off.status).toBe(409);
    expect(await bodyOf(off)).toEqual(LAST);
    expect(await one("SELECT role, status FROM staff_users WHERE id = ?", o.id)).toEqual({
      role: "owner",
      status: "active",
    });
    expect((await call("/auth/me", { cookie: o.cookie })).status).toBe(200); // the owner's sessions were not touched
    expect(
      await countOf("audit_log", "action IN ('user.role_change', 'user.deactivate') AND entity_id = ?", o.id),
    ).toBe(0);
  });

  it("a second owner makes it possible, and then the remaining one is protected", async () => {
    const o = await soleOwner();
    const b = await sessionFor("owner");
    expect(
      (await call(`/users/${b.id}`, { method: "PATCH", body: { role: "staff" }, cookie: o.cookie })).status,
    ).toBe(200);
    expect(
      (await call(`/users/${o.id}`, { method: "PATCH", body: { role: "staff" }, cookie: o.cookie })).status,
    ).toBe(409);
  });

  it("the database refuses it too: deactivate, demote and reset by raw SQL abort", async () => {
    const o = await soleOwner();
    for (const sql of [
      "UPDATE staff_users SET status = 'deactivated' WHERE id = ?",
      "UPDATE staff_users SET role = 'staff' WHERE id = ?",
      "UPDATE staff_users SET status = 'invited', pw_hmac = NULL, totp_secret_enc = NULL, totp_enabled_at = NULL WHERE id = ?",
    ]) {
      await expect(env.DB.prepare(sql).bind(o.id).run()).rejects.toThrow(/at least one active owner/);
    }
  });

  it("an owner can't reset themselves (409 self_reset), whatever the owner count", async () => {
    const o = await owner();
    await sessionFor("owner"); // a second owner exists
    const res = await call(`/users/${o.id}/reset-2fa`, { method: "POST", cookie: o.cookie });
    expect(res.status).toBe(409);
    expect(await bodyOf(res)).toEqual({
      error: { code: "self_reset", message: "You can't reset your own two-step sign-in" },
    });
  });
});

describe("two-step reset, then a fresh invite [ADM-AUTH-07, ADM-AUTH-01, ADM-AUTH-09]", () => {
  it("clears everything, ends the sessions, returns a link and raises alert.2fa_change, in 2 calls", async () => {
    const o = await owner();
    const e = await enrol(newEmail(), "staff");
    const id = await userId(e.email);
    const second = await extraSession({ id } as never);
    const before = await countOf("access_log", "actor_id = ?", o.id);
    const r = await counting(`/users/${id}/reset-2fa`, { method: "POST", cookie: o.cookie });
    expect([r.res.status, r.calls]).toEqual([200, 2]);
    const { link } = (await r.res.json()) as { link: string };
    expect(link).toMatch(LINK);

    // the old cookies are dead (ADM-AUTH-01), the password and authenticator are gone, the status is "invited"
    for (const c of [e.cookie, second.cookie])
      expect((await call("/auth/me", { cookie: c })).status).toBe(401);
    expect(
      await one(
        "SELECT status, pw_salt, pw_hmac, pw_params, totp_secret_enc, totp_last_step, totp_enabled_at FROM staff_users WHERE id = ?",
        id,
      ),
    ).toEqual({
      status: "invited",
      pw_salt: null,
      pw_hmac: null,
      pw_params: null,
      totp_secret_enc: null,
      totp_last_step: null,
      totp_enabled_at: null,
    });
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(0);
    expect((await login(e.email, e.clientHash, e.secret, e.step + 1)).status).toBe(401);

    // one audit row for the reset (actor: the owner), one alert about the member, one access row
    expect(
      await countOf("audit_log", "action = 'user.reset_2fa' AND entity_id = ? AND actor_id = ?", id, o.id),
    ).toBe(1);
    expect(
      await countOf("audit_log", "action = 'alert.2fa_change' AND entity_id = ?", id),
    ).toBeGreaterThanOrEqual(1);
    expect(await countOf("access_log", "actor_id = ?", o.id)).toBe(before + 1);
  });

  it("the member re-enrols through the link: new password, new authenticator, new recovery codes", async () => {
    const o = await owner();
    const old = await enrol(newEmail(), "sales");
    const id = await userId(old.email);
    const res = await call(`/users/${id}/reset-2fa`, { method: "POST", cookie: o.cookie });
    const { link } = (await res.json()) as { link: string };

    const fresh = await accept(tokenOfLink(link), "Renamed Person");
    expect(fresh.email).toBe(old.email);
    expect(await one("SELECT id, name, role, status FROM staff_users WHERE email = ?", old.email)).toEqual({
      id,
      name: "Renamed Person",
      role: "sales",
      status: "active",
    });
    expect(fresh.recoveryCodes).toHaveLength(10);
    expect(fresh.recoveryCodes.some((c) => old.recoveryCodes.includes(c))).toBe(false);
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(10);
    expect((await call("/auth/me", { cookie: fresh.cookie })).status).toBe(200);
    // the old password and the old authenticator don't work any more; the new ones do
    expect(
      (await call("/auth/login", { body: { email: old.email, clientHash: old.clientHash } })).status,
    ).toBe(401);
    expect((await login(old.email, fresh.clientHash, old.secret, fresh.step + 1)).status).toBe(401);
    expect((await login(fresh.email, fresh.clientHash, fresh.secret, fresh.step + 1)).status).toBe(200);
    // and the link was single use
    expect((await call("/auth/invite/start", { body: { token: tokenOfLink(link) } })).status).toBe(400);
  });

  it("only an active member can be reset; older pending invites for them stop working", async () => {
    const o = await owner();
    const t = await sessionFor("staff");
    const pending = await invite(t.email, "staff", 3_600_000); // an older invite for the same email
    expect((await call(`/users/${t.id}/reset-2fa`, { method: "POST", cookie: o.cookie })).status).toBe(200);
    expect((await call("/auth/invite/start", { body: { token: pending } })).status).toBe(400);
    expect((await call(`/users/${t.id}/reset-2fa`, { method: "POST", cookie: o.cookie })).status).toBe(404); // already invited
    expect((await call("/users/no-such-user/reset-2fa", { method: "POST", cookie: o.cookie })).status).toBe(
      404,
    );
    const gone = await sessionFor("staff");
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(gone.id).run();
    expect((await call(`/users/${gone.id}/reset-2fa`, { method: "POST", cookie: o.cookie })).status).toBe(
      404,
    );
  });
});

describe("an invite must still be live when enrolment finishes [ADM-AUTH-07, ADM-AUTH-01]", () => {
  const untouched = async (email: string) => {
    const id = await userId(email);
    expect(await one("SELECT status FROM staff_users WHERE id = ?", id)).toEqual({ status: "invited" });
    expect(await countOf("staff_sessions", "user_id = ?", id)).toBe(0);
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(0);
  };

  it("a revoked invite can't be completed, even inside the enrolment window: 401, still invited, no session, no codes", async () => {
    const o = await owner();
    const email = newEmail();
    const { body } = await inviteVia(o, email, "staff");
    const token = tokenOfLink(body.link);
    const f = await finishOnly(token);
    const hash = await tokenHash(token);
    expect((await call(`/users/invites/${hash}/revoke`, { method: "POST", cookie: o.cookie })).status).toBe(
      200,
    );
    const res = await enrolCode(f.challenge, f.secret);
    expect(res.status).toBe(401);
    expect(await bodyOf(res)).toEqual({
      error: { code: "invalid_credentials", message: "Invalid email, password or code" },
    });
    await untouched(email);
    expect((await call("/auth/login", { body: { email, clientHash: f.clientHash } })).status).toBe(401);
  });

  it("an expired invite can't be completed; one that is still live a moment longer can", async () => {
    const o = await owner();
    const gone = await inviteVia(o, newEmail(), "staff");
    const fGone = await finishOnly(tokenOfLink(gone.body.link));
    await env.DB.prepare("UPDATE staff_invites SET expires_at = ? WHERE token_hash = ?")
      .bind(Date.now() - 1, await tokenHash(tokenOfLink(gone.body.link)))
      .run();
    expect((await enrolCode(fGone.challenge, fGone.secret)).status).toBe(401);
    await untouched(gone.email);

    const ok = await inviteVia(o, newEmail(), "staff");
    const fOk = await finishOnly(tokenOfLink(ok.body.link));
    await env.DB.prepare("UPDATE staff_invites SET expires_at = ? WHERE token_hash = ?")
      .bind(Date.now() + 60_000, await tokenHash(tokenOfLink(ok.body.link)))
      .run();
    expect((await enrolCode(fOk.challenge, fOk.secret)).status).toBe(200);
  });

  it("a replaced invite (a newer one for the same email) can't be completed; the newer one can", async () => {
    const o = await owner();
    const email = newEmail();
    const first = await inviteVia(o, email, "staff");
    const f = await finishOnly(tokenOfLink(first.body.link));
    const second = await inviteVia(o, email, "sales");
    expect((await enrolCode(f.challenge, f.secret)).status).toBe(401);
    await untouched(email);
    const fresh = await accept(tokenOfLink(second.body.link), "Second Try");
    expect(fresh.email).toBe(email);
  });

  it("the invite is consumed by the activation: used_at set once, not by a refused attempt", async () => {
    const o = await owner();
    const { body, email } = await inviteVia(o, newEmail(), "staff");
    const token = tokenOfLink(body.link);
    const hash = await tokenHash(token);
    const f = await finishOnly(token);
    expect((await one("SELECT used_at FROM staff_invites WHERE token_hash = ?", hash))?.used_at).toBeNull();
    const wrong = await call("/auth/invite/totp", { body: { challenge: f.challenge, code: "000000" } });
    expect(wrong.status).toBe(401);
    expect((await one("SELECT used_at FROM staff_invites WHERE token_hash = ?", hash))?.used_at).toBeNull();
    expect((await enrolCode(f.challenge, f.secret)).status).toBe(200);
    expect(
      (await one("SELECT used_at FROM staff_invites WHERE token_hash = ?", hash))?.used_at,
    ).not.toBeNull();
    expect((await enrolCode(f.challenge, f.secret)).status).toBe(401); // the member is active now
    expect(await one("SELECT status FROM staff_users WHERE email = ?", email)).toEqual({ status: "active" });
  });
});

describe("the role comes from the invite that is accepted [ADM-AUTH-07, ADM-AUTH-01]", () => {
  it("an owner invite is revoked and the member re-invited as staff: the member becomes staff, never an owner", async () => {
    const o = await owner();
    const email = newEmail();
    const asOwner = await inviteVia(o, email, "owner");
    const f = await finishOnly(tokenOfLink(asOwner.body.link)); // the member got as far as the password
    expect(await one("SELECT role, status FROM staff_users WHERE email = ?", email)).toEqual({
      role: "owner",
      status: "invited",
    });
    await call(`/users/invites/${await tokenHash(tokenOfLink(asOwner.body.link))}/revoke`, {
      method: "POST",
      cookie: o.cookie,
    });
    const asStaff = await inviteVia(o, email, "staff");
    expect((await enrolCode(f.challenge, f.secret)).status).toBe(401); // the old walk-through is dead
    const done = await accept(tokenOfLink(asStaff.body.link));
    expect(await one("SELECT role, status FROM staff_users WHERE email = ?", email)).toEqual({
      role: "staff",
      status: "active",
    });
    const me = (await (await call("/auth/me", { cookie: done.cookie })).json()) as { user: { role: string } };
    expect(me.user.role).toBe("staff");
  });

  it("an owner is reset (with a second owner) and re-invited as sales: the member becomes sales", async () => {
    const o = await owner();
    const other = await enrol(newEmail(), "owner"); // a second active owner
    const id = await userId(other.email);
    const reset = await call(`/users/${id}/reset-2fa`, { method: "POST", cookie: o.cookie });
    expect(reset.status).toBe(200);
    const asSales = await inviteVia(o, other.email, "sales");
    expect(asSales.res.status).toBe(201);
    const done = await accept(tokenOfLink(asSales.body.link));
    expect(done.email).toBe(other.email);
    expect(await one("SELECT role, status FROM staff_users WHERE id = ?", id)).toEqual({
      role: "sales",
      status: "active",
    });
    expect(
      ((await (await call("/users", { cookie: done.cookie })).json()) as { error: { code: string } }).error
        .code,
    ).toBe("forbidden");
  });

  it("a plain accepted invite keeps its own role", async () => {
    const o = await owner();
    for (const role of ["owner", "staff", "sales", "accountant"]) {
      const { body, email } = await inviteVia(o, newEmail(), role);
      await accept(tokenOfLink(body.link));
      expect((await one("SELECT role FROM staff_users WHERE email = ?", email))?.role).toBe(role);
    }
  });
});

describe("reset also forgets the member's devices [ADM-AUTH-09]", () => {
  it("known devices are deleted by the API reset, so the next sign-in is a new device", async () => {
    const o = await owner();
    const u = await sessionFor("staff", { password: true });
    const first = await signIn(u);
    expect(first.res.status).toBe(200);
    expect(await countOf("staff_known_devices", "user_id = ?", u.id)).toBe(1);
    expect((await call(`/users/${u.id}/reset-2fa`, { method: "POST", cookie: o.cookie })).status).toBe(200);
    expect(await countOf("staff_known_devices", "user_id = ?", u.id)).toBe(0);
  });
});

describe("break-glass: pnpm admin:reset-2fa [ADM-AUTH-07, docs/08 §3.2]", () => {
  it("also deletes the member's known devices, and a re-issue for an already-invited member leaves staff_users alone", async () => {
    const u = await sessionFor("staff", { password: true });
    await signIn(u);
    await sessionFor("owner");
    expect(await countOf("staff_known_devices", "user_id = ?", u.id)).toBe(1);
    // Back-dated by a second: the re-issue below ends the older invite at `later`, and the Worker compares that with the
    // real clock. With `now = Date.now()` a fast run reached /invite/start inside those 5 ms and the old link still worked.
    const now = Date.now() - 1000;
    const exec = (sql: string[]) => env.DB.exec(sql.join("\n"));
    await exec(
      resetStatements({
        email: u.email,
        tokenHash: await tokenHash("a".repeat(43)),
        now,
        expiresAt: now + INVITE_TTL_MS,
        auditId: crypto.randomUUID(),
        alertId: crypto.randomUUID(),
      }),
    );
    expect(await countOf("staff_known_devices", "user_id = ?", u.id)).toBe(0);

    // The link was lost: re-issue. staff_users is not written (updated_at stays), the older invite stops working.
    const before = await one("SELECT status, updated_at FROM staff_users WHERE id = ?", u.id);
    const later = now + 5;
    await exec(
      reinviteStatements({
        email: u.email,
        tokenHash: await tokenHash("b".repeat(43)),
        now: later,
        expiresAt: later + INVITE_TTL_MS,
        auditId: crypto.randomUUID(),
        resetAuditId: crypto.randomUUID(),
        alertId: crypto.randomUUID(),
      }),
    );
    // L36: the reset was recorded by its own run, so the re-issue writes no second user.reset_2fa or alert.2fa_change
    expect(await countOf("audit_log", "action = 'user.reset_2fa' AND entity_id = ?", u.id)).toBe(1);
    expect(await countOf("audit_log", "action = 'alert.2fa_change' AND entity_id = ?", u.id)).toBe(1);
    expect(await one("SELECT status, updated_at FROM staff_users WHERE id = ?", u.id)).toEqual(before);
    expect((await call("/auth/invite/start", { body: { token: "a".repeat(43) } })).status).toBe(400);
    expect((await call("/auth/invite/start", { body: { token: "b".repeat(43) } })).status).toBe(200);
    expect(
      await countOf(
        "audit_log",
        "action = 'user.invite' AND actor_type = 'system' AND entity_id = ?",
        await tokenHash("b".repeat(43)),
      ),
    ).toBe(1);
  });

  it("a re-issue does nothing for an active or unknown email (guarded on 'invited')", async () => {
    const active = await sessionFor("staff");
    const before = { invites: await countOf("staff_invites"), audits: await countOf("audit_log") };
    const now = Date.now();
    for (const email of [active.email, "nobody-at-all@example.com"])
      await env.DB.exec(
        reinviteStatements({
          email,
          tokenHash: await tokenHash("c".repeat(43)),
          now,
          expiresAt: now + INVITE_TTL_MS,
          auditId: crypto.randomUUID(),
          resetAuditId: crypto.randomUUID(),
          alertId: crypto.randomUUID(),
        }).join("\n"),
      );
    expect({ invites: await countOf("staff_invites"), audits: await countOf("audit_log") }).toEqual(before);
  });

  const run = async (email: string, token: string) => {
    const now = Date.now();
    const sql = resetStatements({
      email,
      tokenHash: await tokenHash(token),
      now,
      expiresAt: now + INVITE_TTL_MS,
      auditId: crypto.randomUUID(),
      alertId: crypto.randomUUID(),
    });
    expect(sql.every((s) => !s.includes("\n"))).toBe(true); // one statement per line
    await env.DB.exec(sql.join("\n"));
  };

  it("does the same as the API's reset: invited, nothing left, sessions ended, a working one-time link", async () => {
    const e = await enrol(newEmail(), "staff");
    const id = await userId(e.email);
    await sessionFor("owner"); // keep an owner around
    const token = `${crypto.randomUUID().replaceAll("-", "")}${"x".repeat(11)}`; // 43 URL-safe characters
    await run(e.email, token);
    expect((await call("/auth/me", { cookie: e.cookie })).status).toBe(401);
    expect(await one("SELECT status, pw_hmac, totp_secret_enc FROM staff_users WHERE id = ?", id)).toEqual({
      status: "invited",
      pw_hmac: null,
      totp_secret_enc: null,
    });
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(0);
    expect(
      await countOf("audit_log", "action = 'user.reset_2fa' AND entity_id = ? AND actor_type = 'system'", id),
    ).toBe(1);
    expect(
      await countOf(
        "audit_log",
        "action = 'alert.2fa_change' AND entity_id = ? AND actor_type = 'system'",
        id,
      ),
    ).toBe(1);
    expect(
      await one("SELECT summary FROM audit_log WHERE action = 'alert.2fa_change' AND entity_id = ?", id),
    ).toEqual({ summary: '{"via":"cli","change":"reset_by_owner"}' });
    const fresh = await accept(token, "Back Again");
    expect(fresh.email).toBe(e.email);
    expect((await call("/auth/me", { cookie: fresh.cookie })).status).toBe(200);
  });

  it("does nothing for an invited or unknown member (every statement is guarded on the first)", async () => {
    const pending = await sessionFor("staff");
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(pending.id).run();
    const before = { audits: await countOf("audit_log"), invites: await countOf("staff_invites") };
    await run(pending.email, "t".repeat(43));
    await run("nobody@example.com", "u".repeat(43));
    expect({ audits: await countOf("audit_log"), invites: await countOf("staff_invites") }).toEqual(before);
    expect(
      (await one<{ status: string }>("SELECT status FROM staff_users WHERE id = ?", pending.id))?.status,
    ).toBe("deactivated");
  });

  it("M7.5 C5: for the only active owner the SQL itself changes nothing (the trigger stays as the second line): no audit row, no invite, no session ended", async () => {
    const o = await sessionFor("owner");
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE role = 'owner' AND id <> ?")
      .bind(o.id)
      .run();
    const before = {
      audits: await countOf("audit_log"),
      invites: await countOf("staff_invites"),
      live: await countOf("staff_sessions", "user_id = ? AND revoked_at IS NULL", o.id),
    };
    await run(o.email, "v".repeat(43));
    expect((await one<{ status: string }>("SELECT status FROM staff_users WHERE id = ?", o.id))?.status).toBe(
      "active",
    );
    expect({
      audits: await countOf("audit_log"),
      invites: await countOf("staff_invites"),
      live: await countOf("staff_sessions", "user_id = ? AND revoked_at IS NULL", o.id),
    }).toEqual(before);
    // the trigger is still there behind the guard: a direct update of the last owner is refused
    await expect(
      env.DB.prepare("UPDATE staff_users SET status = 'invited' WHERE id = ?").bind(o.id).run(),
    ).rejects.toThrow(/at least one active owner/);
  });

  it("M7.5 C5: the script reads its audit rows back; a run that wrote them passes, one whose guard held is reported", async () => {
    await sessionFor("owner"); // keep an owner around
    const e = await enrol(newEmail(), "staff");
    const now = Date.now();
    const ids = { auditId: crypto.randomUUID(), alertId: crypto.randomUUID() };
    await env.DB.exec(
      resetStatements({
        email: e.email,
        tokenHash: await tokenHash("r".repeat(43)),
        now,
        expiresAt: now + INVITE_TTL_MS,
        ...ids,
      }).join("\n"),
    );
    const expected = [ids.auditId, ids.alertId];
    const found = async (want: string[]) =>
      (await env.DB.prepare(auditReadBackSql(want)).all<{ id: string }>()).results.map((r) => r.id);
    expect(readBackProblem({ found: await found(expected), expected })).toBeNull();
    // the same member again (now invited): the guard holds, nothing is written, the read-back says so
    const again = { auditId: crypto.randomUUID(), alertId: crypto.randomUUID() };
    await env.DB.exec(
      resetStatements({
        email: e.email,
        tokenHash: await tokenHash("s".repeat(43)),
        now: now + 1,
        expiresAt: now + INVITE_TTL_MS,
        ...again,
      }).join("\n"),
    );
    const want = [again.auditId, again.alertId];
    expect(readBackProblem({ found: await found(want), expected: want })).toMatch(
      /2 of 2 audit rows missing.*do not use the link/,
    );
    expect(readBackProblem({ found: [ids.auditId], expected })).toMatch(/1 of 2 audit rows missing/);
    expect(auditReadBackSql(["a'b", "c"])).toBe("SELECT id FROM audit_log WHERE id IN ('a''b', 'c')");
  });
});

describe("M7.5 L36: a re-issue after a reset cut short records the reset [ADM-AUTH-07, docs/08 §3.2]", () => {
  const reissue = async (email: string, now = Date.now()) => {
    const ids = {
      auditId: crypto.randomUUID(),
      resetAuditId: crypto.randomUUID(),
      alertId: crypto.randomUUID(),
    };
    const token = `${crypto.randomUUID().replaceAll("-", "")}${"y".repeat(11)}`; // 43 URL-safe characters
    const sql = reinviteStatements({
      email,
      tokenHash: await tokenHash(token),
      now,
      expiresAt: now + INVITE_TTL_MS,
      ...ids,
    });
    expect(sql.every((s) => !s.includes("\n"))).toBe(true); // one statement per line
    await env.DB.exec(sql.join("\n"));
    const found = (
      await env.DB.prepare(auditReadBackSql(Object.values(ids))).all<{ id: string }>()
    ).results.map((r) => r.id);
    return { ids, found, token, ...reinviteExpected({ found, ...ids }) };
  };
  /** What a reset leaves of a member: its row, its recovery codes, known devices and sessions (with when each ended). */
  const footprint = async (id: string) => ({
    user: await one("SELECT * FROM staff_users WHERE id = ?", id),
    codes: await rows("SELECT id, used_at FROM staff_recovery_codes WHERE user_id = ? ORDER BY id", id),
    devices: await rows(
      "SELECT device_hash FROM staff_known_devices WHERE user_id = ? ORDER BY device_hash",
      id,
    ),
    sessions: await rows("SELECT id, revoked_at FROM staff_sessions WHERE user_id = ? ORDER BY id", id),
  });
  /** A reset run that stopped after its first statement: the member is invited, nothing else ran. */
  const cutShort = async (email: string, now = Date.now()) => {
    const [first] = resetStatements({
      email,
      tokenHash: await tokenHash("z".repeat(43)),
      now,
      expiresAt: now + INVITE_TTL_MS,
      auditId: crypto.randomUUID(),
      alertId: crypto.randomUUID(),
    });
    await env.DB.exec(first as string);
  };
  const resetRows = (id: string) => countOf("audit_log", "action = 'user.reset_2fa' AND entity_id = ?", id);
  const alertRows = (id: string) => countOf("audit_log", "action = 'alert.2fa_change' AND entity_id = ?", id);

  it("a run cut short after its first UPDATE: the re-issue writes user.reset_2fa and alert.2fa_change (actor system), and the read-back expects both", async () => {
    await sessionFor("owner"); // keep an owner around
    const e = await enrol(newEmail(), "staff");
    const id = await userId(e.email);
    await cutShort(e.email);
    expect((await one<{ status: string }>("SELECT status FROM staff_users WHERE id = ?", id))?.status).toBe(
      "invited",
    );
    expect(await resetRows(id)).toBe(0);
    const r = await reissue(e.email);
    expect(r.recordedReset).toBe(true);
    expect(r.expected).toEqual([r.ids.auditId, r.ids.resetAuditId, r.ids.alertId]);
    expect(readBackProblem({ found: r.found, expected: r.expected })).toBeNull();
    expect(
      await one(
        "SELECT actor_type, actor_id, entity_type, entity_id, summary FROM audit_log WHERE id = ?",
        r.ids.resetAuditId,
      ),
    ).toEqual({
      actor_type: "system",
      actor_id: null,
      entity_type: "staff_user",
      entity_id: id,
      summary: '{"via":"cli","resumed":true}',
    });
    expect(
      await one(
        "SELECT actor_type, entity_type, entity_id, summary FROM audit_log WHERE id = ?",
        r.ids.alertId,
      ),
    ).toEqual({
      actor_type: "system",
      entity_type: "staff_user",
      entity_id: id,
      summary: '{"via":"cli","change":"reset_by_owner"}',
    });
    // a second re-issue finds the row now: nothing more
    const again = await reissue(e.email);
    expect(again.recordedReset).toBe(false);
    expect(again.expected).toEqual([again.ids.auditId]);
    expect(readBackProblem({ found: again.found, expected: again.expected })).toBeNull();
    expect(await resetRows(id)).toBe(1);
    expect(await alertRows(id)).toBe(1);
  });

  it("a reset recorded by its own run, with the PC's clock ahead of D1's by up to the margin: no second row", async () => {
    await sessionFor("owner");
    const e = await enrol(newEmail(), "staff");
    const id = await userId(e.email);
    const ahead = Date.now() + RESET_ROW_MARGIN_MS - 30_000;
    await env.DB.exec(
      resetStatements({
        email: e.email,
        tokenHash: await tokenHash("w".repeat(43)),
        now: ahead,
        expiresAt: ahead + INVITE_TTL_MS,
        auditId: crypto.randomUUID(),
        alertId: crypto.randomUUID(),
      }).join("\n"),
    );
    expect(await resetRows(id)).toBe(1);
    expect((await reissue(e.email)).recordedReset).toBe(false);
    expect(await resetRows(id)).toBe(1);
    expect(await alertRows(id)).toBe(1);
  });

  it("an enrolment begun since (a password set) or a reset recorded by the API: no row", async () => {
    const o = await owner();
    const begun = await enrol(newEmail(), "staff");
    const begunId = await userId(begun.email);
    await cutShort(begun.email);
    await env.DB.prepare("UPDATE staff_users SET pw_hmac = 'made-up', pw_salt = 'made-up' WHERE id = ?")
      .bind(begunId)
      .run();
    expect((await reissue(begun.email)).recordedReset).toBe(false);
    expect(await resetRows(begunId)).toBe(0);

    const viaApi = await sessionFor("staff");
    expect((await call(`/users/${viaApi.id}/reset-2fa`, { method: "POST", cookie: o.cookie })).status).toBe(
      200,
    );
    expect(await resetRows(viaApi.id)).toBe(1);
    const alerts = await alertRows(viaApi.id);
    expect((await reissue(viaApi.email)).recordedReset).toBe(false);
    expect(await resetRows(viaApi.id)).toBe(1);
    expect(await alertRows(viaApi.id)).toBe(alerts);
  });

  it("L44: a run cut short, then re-issued: codes, devices and sessions are cleared, and after re-enrolment no old recovery code works", async () => {
    await sessionFor("owner");
    const e = await enrol(newEmail(), "staff");
    const id = await userId(e.email);
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(10);
    expect(await countOf("staff_known_devices", "user_id = ?", id)).toBe(1);
    expect(await countOf("staff_sessions", "user_id = ? AND revoked_at IS NULL", id)).toBe(1);
    await cutShort(e.email);
    // what the cut-short run left behind
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(10);
    const r = await reissue(e.email);
    expect(r.recordedReset).toBe(true);
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(0);
    expect(await countOf("staff_known_devices", "user_id = ?", id)).toBe(0);
    expect(await countOf("staff_sessions", "user_id = ? AND revoked_at IS NULL", id)).toBe(0);
    // the member enrols again through the new link
    const back = await accept(r.token, "Back Again");
    expect(back.email).toBe(e.email);
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(10);
    const old = await call("/auth/recovery", {
      body: { challenge: await challengeFor(e.email, back.clientHash), code: e.recoveryCodes[0] },
    });
    expect(old.status).toBe(401);
    const fresh = await call("/auth/recovery", {
      body: { challenge: await challengeFor(e.email, back.clientHash), code: back.recoveryCodes[0] },
    });
    expect(fresh.status).toBe(200);
  });

  it("L44: a re-issue after a reset that ran in full changes nothing of the member (row, codes, devices, sessions)", async () => {
    await sessionFor("owner");
    const e = await enrol(newEmail(), "staff");
    const id = await userId(e.email);
    const now = Date.now() - 1_000;
    await env.DB.exec(
      resetStatements({
        email: e.email,
        tokenHash: await tokenHash(`l44${crypto.randomUUID().replaceAll("-", "")}${"k".repeat(8)}`),
        now,
        expiresAt: now + INVITE_TTL_MS,
        auditId: crypto.randomUUID(),
        alertId: crypto.randomUUID(),
      }).join("\n"),
    );
    const before = await footprint(id);
    expect(before.sessions.length).toBeGreaterThan(0);
    expect((await reissue(e.email)).recordedReset).toBe(false);
    expect(await footprint(id)).toEqual(before);
  });

  it("L46: a member who began enrolment through an older live invite after a cut-short run is cleaned up on re-issue; an active member is untouched", async () => {
    await sessionFor("owner");
    const e = await enrol(newEmail(), "staff");
    const id = await userId(e.email);
    const older = await invite(e.email, "staff"); // a live invite the cut-short run never expired
    await cutShort(e.email);
    await finishOnly(older); // enrolment begun: a password and a secret set, still invited, the old codes kept
    expect(await one("SELECT status, pw_hmac IS NOT NULL AS pw FROM staff_users WHERE id = ?", id)).toEqual({
      status: "invited",
      pw: 1,
    });
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(10);
    const active = await enrol(newEmail(), "staff");
    const activeId = await userId(active.email);
    const beforeActive = await footprint(activeId);
    const r = await reissue(e.email);
    await reissue(active.email);
    // the audit rows keep the full reset-state check: no row for a member with a password set
    expect(r.recordedReset).toBe(false);
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(0);
    expect(await countOf("staff_known_devices", "user_id = ?", id)).toBe(0);
    expect(await countOf("staff_sessions", "user_id = ? AND revoked_at IS NULL", id)).toBe(0);
    expect(await footprint(activeId)).toEqual(beforeActive);
    // enrolment through the new link: no old recovery code works
    const back = await accept(r.token, "Back Again");
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(10);
    const old = await call("/auth/recovery", {
      body: { challenge: await challengeFor(e.email, back.clientHash), code: e.recoveryCodes[0] },
    });
    expect(old.status).toBe(401);
  });

  it("L44: an active or deactivated member is untouched (codes, devices and sessions stay)", async () => {
    await sessionFor("owner");
    const active = await enrol(newEmail(), "staff");
    const activeId = await userId(active.email);
    const gone = await enrol(newEmail(), "staff");
    const goneId = await userId(gone.email);
    await env.DB.prepare(
      "UPDATE staff_users SET status = 'deactivated', pw_hmac = NULL, totp_secret_enc = NULL, totp_enabled_at = NULL WHERE id = ?",
    )
      .bind(goneId)
      .run();
    const beforeActive = await footprint(activeId);
    const beforeGone = await footprint(goneId);
    expect(beforeActive.codes).toHaveLength(10);
    await reissue(active.email);
    await reissue(gone.email);
    expect(await footprint(activeId)).toEqual(beforeActive);
    expect(await footprint(goneId)).toEqual(beforeGone);
  });

  it("an active, deactivated or unknown member: nothing at all", async () => {
    const active = await sessionFor("staff");
    const gone = await sessionFor("staff");
    await env.DB.prepare(
      "UPDATE staff_users SET status = 'deactivated', pw_hmac = NULL, totp_secret_enc = NULL, totp_enabled_at = NULL WHERE id = ?",
    )
      .bind(gone.id)
      .run();
    const before = await countOf("audit_log");
    for (const email of [active.email, gone.email, "nobody-l36@example.com"]) {
      const r = await reissue(email);
      expect(r.found).toEqual([]);
    }
    expect(await countOf("audit_log")).toBe(before);
  });
});

describe("break-glass for the only owner: a second owner is invited [ADM-AUTH-07, docs/08 §3.2]", () => {
  const sealed = (token: string) => "s".repeat(43 - token.length) + token; // a 43-character token for the tests
  const onlyOwner = async () => {
    const o = await sessionFor("owner");
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE role = 'owner' AND id <> ?")
      .bind(o.id)
      .run();
    return o;
  };
  const params = async (
    lostOwnerId: string,
    newAddress: string,
    token = `${crypto.randomUUID().replaceAll("-", "")}${"x".repeat(11)}`,
  ) => {
    const now = Date.now();
    return {
      newEmail: newAddress,
      lostOwnerId,
      tokenHash: await tokenHash(token),
      now,
      expiresAt: now + 5 * 3_600_000,
      auditId: crypto.randomUUID(),
    };
  };
  const run = async (p: Awaited<ReturnType<typeof params>>) => {
    const sql = breakGlassStatements(p);
    expect(sql.every((s) => !s.includes("\n"))).toBe(true); // one statement per line
    await env.DB.exec(sql.join("\n"));
  };

  it("builds exactly two INSERT statements, with the quoting and guards in place", () => {
    expect(
      breakGlassStatements({
        newEmail: "second@example.com",
        lostOwnerId: "owner-1",
        tokenHash: "abc123",
        now: 1000,
        expiresAt: 5000,
        auditId: "audit-1",
      }),
    ).toEqual([
      "INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) SELECT 'abc123', 'second@example.com', 'owner', NULL, 5000 WHERE EXISTS (SELECT 1 FROM staff_users WHERE id = 'owner-1' AND role = 'owner' AND status = 'active') AND (SELECT count(*) FROM staff_users WHERE role = 'owner' AND status = 'active') = 1 AND NOT EXISTS (SELECT 1 FROM staff_users WHERE email = 'second@example.com') AND NOT EXISTS (SELECT 1 FROM staff_invites WHERE email = 'second@example.com' AND used_at IS NULL AND expires_at > 1000);",
      `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT 'audit-1', 'system', NULL, 'user.invite', 'staff_invite', 'abc123', '{"via":"cli","reason":"break-glass","lost_owner_id":"owner-1"}' WHERE EXISTS (SELECT 1 FROM staff_invites WHERE token_hash = 'abc123' AND email = 'second@example.com');`,
    ]);
  });

  it("M7.5 C5: not once a second owner is active (the lost owner is no longer the only one): no invite, no audit row", async () => {
    const o = await onlyOwner();
    await sessionFor("owner"); // a second active owner appears between the script's checks and the run
    const address = `second-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const p = await params(o.id, address);
    await run(p);
    expect(await countOf("staff_invites", "email = ?", address)).toBe(0);
    expect(await countOf("audit_log", "id = ?", p.auditId)).toBe(0);
    expect(readBackProblem({ found: [], expected: [p.auditId] })).toMatch(/do not use the link/);
  });

  it("stores an owner invite for the new address, with the expiry from --hours and a break-glass audit row", async () => {
    const o = await onlyOwner();
    const address = "second-owner@example.com";
    const p = await params(o.id, address);
    await run(p);
    expect(
      await one(
        "SELECT email, role, invited_by, expires_at, used_at FROM staff_invites WHERE token_hash = ?",
        p.tokenHash,
      ),
    ).toEqual({ email: address, role: "owner", invited_by: null, expires_at: p.expiresAt, used_at: null });
    expect(p.expiresAt - p.now).toBe(5 * 3_600_000);
    const audits = await rows<{
      actor_type: string;
      actor_id: string | null;
      entity_type: string;
      entity_id: string;
      summary: string;
    }>(
      "SELECT actor_type, actor_id, entity_type, entity_id, summary FROM audit_log WHERE action = 'user.invite' AND entity_id = ?",
      p.tokenHash,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_type: "system", actor_id: null, entity_type: "staff_invite" });
    const summary = JSON.parse(audits[0]?.summary ?? "{}") as Record<string, unknown>;
    expect(Object.keys(summary).sort()).toEqual(["lost_owner_id", "reason", "via"]);
    expect(summary).toEqual({ via: "cli", reason: "break-glass", lost_owner_id: o.id });
    expect(audits[0]?.summary).not.toContain(address);
    expect(audits[0]?.summary).not.toContain(o.email);
  });

  it("writes only to staff_invites and audit_log: the lost owner, sessions and recovery codes stay as they were", async () => {
    const o = await onlyOwner();
    await env.DB.prepare("INSERT INTO staff_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), o.id, "hash-of-a-code")
      .run();
    const snapshot = async () => ({
      user: await one("SELECT * FROM staff_users WHERE id = ?", o.id),
      sessions: await rows("SELECT * FROM staff_sessions WHERE user_id = ?", o.id),
      codes: await rows("SELECT * FROM staff_recovery_codes WHERE user_id = ?", o.id),
      users: await countOf("staff_users"),
    });
    const before = await snapshot();
    expect(before.sessions.length).toBeGreaterThan(0);
    expect(before.codes).toHaveLength(1);
    const p = await params(o.id, "another-owner@example.com");
    const sql = breakGlassStatements(p);
    expect(
      sql.every((s) => s.startsWith("INSERT INTO staff_invites ") || s.startsWith("INSERT INTO audit_log ")),
    ).toBe(true);
    expect(sql.join("\n")).not.toMatch(/\b(UPDATE|DELETE|DROP|ALTER|REPLACE)\b/i);
    await run(p);
    expect(await snapshot()).toEqual(before);
  });

  it("quotes a hostile address: it is stored as text and nothing else runs", async () => {
    const o = await onlyOwner();
    const hostile = "x'); DROP TABLE staff_users; --@example.com";
    expect(normaliseEmail(hostile)).toBeNull(); // the spaces make the script refuse it; the quoting still holds below
    const nospace = "o'brien'),(1)--@example.com";
    expect(normaliseEmail(nospace)).toBe(nospace);
    const users = await countOf("staff_users");
    for (const address of [hostile, nospace])
      await run(await params(o.id, address, sealed(address.length.toString())));
    expect(await countOf("staff_users")).toBe(users);
    expect(await countOf("staff_invites", "email = ?", nospace)).toBe(1);
    expect(await countOf("staff_invites", "email = ?", hostile)).toBe(1); // the SQL layer is safe even if a caller skipped the check
  });

  it("does nothing when the new address already has an account (any status), a live invite, or the owner is gone", async () => {
    const o = await onlyOwner();
    const taken = await sessionFor("staff");
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(taken.id).run();
    const liveFor = `live-${Math.random().toString(36).slice(2, 8)}@example.com`;
    await invite(liveFor, "staff");
    const before = { invites: await countOf("staff_invites"), audits: await countOf("audit_log") };
    await run(await params(o.id, taken.email, sealed("a"))); // a deactivated member's address
    await run(await params(o.id, liveFor, sealed("b"))); // a live unused invite
    await run(await params("no-such-owner", "free@example.com", sealed("c"))); // not an active owner
    expect({ invites: await countOf("staff_invites"), audits: await countOf("audit_log") }).toEqual(before);
    // An expired or used invite does not block a new one.
    const stale = `stale-${Math.random().toString(36).slice(2, 8)}@example.com`;
    await invite(stale, "staff", -1000);
    await run(await params(o.id, stale, sealed("d")));
    expect(await countOf("staff_invites", "email = ? AND role = 'owner'", stale)).toBe(1);
  });

  it("the link works: the new owner enrols, the lost owner is unchanged, and once two owners exist it can be deactivated", async () => {
    const o = await onlyOwner();
    const address = `second-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const token = `${crypto.randomUUID().replaceAll("-", "")}${"y".repeat(11)}`;
    await run(await params(o.id, address, token));
    // Still the only active owner: resetting the lost owner changes nothing (M7.5 C5: the SQL's own only-owner guard, before the trigger).
    const now = Date.now();
    await env.DB.exec(
      resetStatements({
        email: o.email,
        tokenHash: await tokenHash("z".repeat(43)),
        now,
        expiresAt: now + INVITE_TTL_MS,
        auditId: crypto.randomUUID(),
        alertId: crypto.randomUUID(),
      }).join("\n"),
    );
    expect((await one<{ status: string }>("SELECT status FROM staff_users WHERE id = ?", o.id))?.status).toBe(
      "active",
    );
    const second = await accept(token, "Second Owner");
    expect(second.email).toBe(address);
    expect(await one("SELECT role, status FROM staff_users WHERE email = ?", address)).toEqual({
      role: "owner",
      status: "active",
    });
    expect(await countOf("staff_users", "role = 'owner' AND status = 'active'")).toBe(2);
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(o.id).run();
    expect((await one<{ status: string }>("SELECT status FROM staff_users WHERE id = ?", o.id))?.status).toBe(
      "deactivated",
    );
  });

  describe("the script's checks (checkBreakGlass)", () => {
    const base = { email: "lost@example.com", existing: 0, liveInvites: 0 };
    it("returns the new address, trimmed and lower-cased", () => {
      expect(checkBreakGlass({ ...base, newEmail: "  Second@Example.COM " })).toBe("second@example.com");
    });
    it("refuses a missing --new-email, explaining the break-glass and showing the exact command", () => {
      for (const missing of [undefined, ""]) {
        const msg = (() => {
          try {
            checkBreakGlass({ ...base, newEmail: missing });
          } catch (e) {
            return (e as Error).message;
          }
          return "";
        })();
        expect(msg).toContain("only active owner");
        expect(msg).toContain(
          "pnpm admin:reset-2fa --email lost@example.com --new-email <another address you control>",
        );
        expect(msg).not.toContain("--staging");
      }
      expect(() => checkBreakGlass({ ...base, newEmail: undefined, staging: true })).toThrow(
        /--new-email .* --staging/,
      );
    });
    it("refuses an invalid address, the same address, an existing account and a live invite", () => {
      expect(() => checkBreakGlass({ ...base, newEmail: "not-an-address" })).toThrow(
        /must be an email address/,
      );
      expect(() => checkBreakGlass({ ...base, newEmail: "has space@example.com" })).toThrow(
        /must be an email/,
      );
      expect(() => checkBreakGlass({ ...base, newEmail: " LOST@example.com " })).toThrow(/different address/);
      expect(() => checkBreakGlass({ ...base, newEmail: "x@example.com", existing: 1 })).toThrow(
        /already belongs to a staff member/,
      );
      expect(() => checkBreakGlass({ ...base, newEmail: "x@example.com", liveInvites: 1 })).toThrow(
        /already has a live invite/,
      );
    });
  });
});

describe("pnpm invite: the first owner and throwaway users [ADM-AUTH-07, audit L2]", () => {
  const statementsFor = async (email: string, token: string, role = "owner") => {
    const now = Date.now();
    const sql = createInviteStatements({
      email,
      role,
      tokenHash: await tokenHash(token),
      now,
      expiresAt: now + INVITE_TTL_MS,
      auditId: crypto.randomUUID(),
    });
    expect(sql.every((s) => !s.includes("\n"))).toBe(true); // one statement per line
    return sql.join("\n");
  };
  const tok = (c: string) => c.repeat(43);

  it("stores the invite (48 h, no inviter), writes `user.invite` by the system with the role only, and the link works once", async () => {
    const email = newEmail();
    await env.DB.exec(await statementsFor(email, tok("d")));
    const hash = await tokenHash(tok("d"));
    expect(
      await one("SELECT email, role, invited_by, used_at FROM staff_invites WHERE token_hash = ?", hash),
    ).toEqual({ email, role: "owner", invited_by: null, used_at: null });
    const audits = await rows<{
      actor_type: string;
      actor_id: string | null;
      entity_type: string;
      summary: string;
    }>(
      "SELECT actor_type, actor_id, entity_type, summary FROM audit_log WHERE action = 'user.invite' AND entity_id = ?",
      hash,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_type: "system", actor_id: null, entity_type: "staff_invite" });
    expect(JSON.parse(audits[0]?.summary as string)).toEqual({ via: "cli", role: "owner" });
    expect(audits[0]?.summary).not.toContain(email);
    const e = await accept(tok("d"), "First Owner");
    expect(e.email).toBe(email);
    expect((await call("/auth/me", { cookie: e.cookie })).status).toBe(200);
    expect((await call("/auth/invite/start", { body: { token: tok("d") } })).status).toBe(400);
  });

  it("an address with an apostrophe is stored as typed and nothing else runs", async () => {
    const email = `o'brien.${crypto.randomUUID().slice(0, 8)}@example.test`;
    await env.DB.exec(await statementsFor(email, tok("q"), "staff"));
    const hash = await tokenHash(tok("q"));
    expect(await one("SELECT email, role FROM staff_invites WHERE token_hash = ?", hash)).toEqual({
      email,
      role: "staff",
    });
    const audits = await rows<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'user.invite' AND entity_id = ?",
      hash,
    );
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0]?.summary as string)).toEqual({ via: "cli", role: "staff" });
  });

  it("a second invite for the same address expires the older pending one (never deleted)", async () => {
    const email = newEmail();
    await env.DB.exec(await statementsFor(email, tok("e"), "staff"));
    await env.DB.exec(await statementsFor(email, tok("f"), "sales"));
    expect((await call("/auth/invite/start", { body: { token: tok("e") } })).status).toBe(400);
    expect((await call("/auth/invite/start", { body: { token: tok("f") } })).status).toBe(200);
    expect(await countOf("staff_invites", "email = ?", email)).toBe(2);
    expect(
      await countOf("staff_invites", "email = ? AND used_at IS NULL AND expires_at > ?", email, Date.now()),
    ).toBe(1);
  });

  it("refuses an address that already has an active or deactivated account: nothing written, older invites untouched", async () => {
    const active = await sessionFor("staff");
    const gone = await sessionFor("staff");
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(gone.id).run();
    for (const email of [active.email, gone.email]) {
      await env.DB.prepare(
        "INSERT INTO staff_invites (token_hash, email, role, expires_at) VALUES (?, ?, 'staff', ?)",
      )
        .bind(await tokenHash(tok(email === active.email ? "g" : "h")), email, Date.now() + 60_000)
        .run();
    }
    const before = { invites: await countOf("staff_invites"), audits: await countOf("audit_log") };
    await env.DB.exec(await statementsFor(active.email, tok("i")));
    await env.DB.exec(await statementsFor(gone.email, tok("j")));
    expect({ invites: await countOf("staff_invites"), audits: await countOf("audit_log") }).toEqual(before);
    // The older pending invites still stand: the refused run expired nothing.
    expect(
      await countOf("staff_invites", "used_at IS NULL AND expires_at > ?", Date.now()),
    ).toBeGreaterThanOrEqual(2);
    expect((await call("/auth/invite/start", { body: { token: tok("g") } })).status).toBe(200);
  });

  it("an address whose member is still 'invited' (an earlier reset) gets a fresh invite", async () => {
    const e = await enrol(newEmail(), "staff");
    await sessionFor("owner");
    const now = Date.now();
    await env.DB.exec(
      resetStatements({
        email: e.email,
        tokenHash: await tokenHash(tok("k")),
        now,
        expiresAt: now + INVITE_TTL_MS,
        auditId: crypto.randomUUID(),
        alertId: crypto.randomUUID(),
      }).join("\n"),
    );
    await env.DB.exec(await statementsFor(e.email, tok("l"), "staff"));
    expect((await call("/auth/invite/start", { body: { token: tok("k") } })).status).toBe(400);
    expect((await call("/auth/invite/start", { body: { token: tok("l") } })).status).toBe(200);
  });
});
