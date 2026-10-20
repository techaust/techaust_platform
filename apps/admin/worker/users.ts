// Staff management by the owner [ADM-AUTH-07, ADM-AUTH-05, ADM-AUTH-09]: list, invite, revoke an invite, change a
// role, deactivate, reset two-step sign-in, sign everyone out. All writes need a fresh step-up (`users.manage`).
// Each write is ONE batch after the guard's read: the conditional statement, its audit row and access row, and the
// side effects (revoking the target's sessions, inserting the new invite) that only happen if it applied.
import { sValidator } from "@hono/standard-validator";
import { INVITE_TTL_MS, newToken, tokenHash } from "@techaust/auth";
import { ROLES } from "@techaust/core";
import { Hono } from "hono";
import { z } from "zod";
import { alertStmt } from "./alerts.ts";
import { json } from "./auth.ts";
import {
  type ApiError,
  type AppEnv,
  actor,
  BAD_REQUEST,
  type Ctx,
  err,
  mutate,
  NOT_FOUND,
} from "./context.ts";

const USER_EXISTS: ApiError = {
  code: "user_exists",
  message: "That email already belongs to a staff member",
};
const LAST_OWNER: ApiError = { code: "last_owner", message: "There must always be one active owner" };
const SELF_RESET: ApiError = { code: "self_reset", message: "You can't reset your own two-step sign-in" };

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const inviteRequest = z.object({ email, role: z.enum(ROLES) });
const roleRequest = z.object({ role: z.enum(ROLES) });
const idParam = z.object({ id: z.string().min(1).max(64) });
const hashParam = z.object({ tokenHash: z.string().regex(/^[0-9a-f]{64}$/) });
const param = <S extends z.ZodType>(schema: S) =>
  sValidator("param", schema, (r, c) => (r.success ? undefined : err(c as Ctx, BAD_REQUEST, 400)));

/** The owner count check as a SQL condition: the last active owner can't be demoted, deactivated or reset. */
const NOT_LAST_OWNER =
  "(role <> 'owner' OR (SELECT count(*) FROM staff_users WHERE role = 'owner' AND status = 'active') > 1)";
const ABORT_LAST_OWNER = /at least one active owner/;

const now = () => Date.now();

/** Why a conditional write matched nothing: no such active member (404) or the last-owner rule (409). */
async function whyNot(c: Ctx, id: string) {
  const row = await c.env.DB.prepare("SELECT role, status FROM staff_users WHERE id = ?")
    .bind(id)
    .first<{ role: string; status: string }>();
  if (row?.status !== "active") return err(c, NOT_FOUND, 404);
  return err(c, LAST_OWNER, 409);
}

/** `mutate`, with the owner trigger's refusal (a race the SQL condition should already prevent) as 409. */
async function guarded(c: Ctx, run: () => Promise<boolean>): Promise<boolean | Response> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Error && ABORT_LAST_OWNER.test(`${e.message} ${String(e.cause ?? "")}`))
      return err(c, LAST_OWNER, 409);
    throw e;
  }
}

const revokeSessionsOf =
  (c: Ctx, userId: string, t: number) => (g: { sql: string; params: readonly unknown[] }) =>
    c.env.DB.prepare(
      `UPDATE staff_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND ${g.sql}`,
    ).bind(t, userId, ...g.params);

export const users = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT id, email, name, role, status, last_login_at, created_at FROM staff_users ORDER BY created_at, id LIMIT 50",
    ).all();
    return c.json({ users: results });
  })

  .get("/invites", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT token_hash, email, role, invited_by, expires_at, created_at FROM staff_invites WHERE used_at IS NULL AND expires_at > ?1 ORDER BY created_at DESC, token_hash LIMIT 50",
    )
      .bind(now())
      .all();
    return c.json({ invites: results });
  })

  // Invite: the link is returned ONCE (it stands in for the email until M2.4); only its hash is stored.
  .post("/invites", json(inviteRequest), async (c) => {
    const { email, role } = c.req.valid("json");
    const u = actor(c);
    const token = newToken();
    const hash = await tokenHash(token);
    const t = now();
    const db = c.env.DB;
    const done = await mutate(c, {
      main: db
        .prepare(
          "INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS (SELECT 1 FROM staff_users WHERE email = ?2 AND status <> 'invited')",
        )
        .bind(hash, email, role, u.id, t + INVITE_TTL_MS),
      action: "user.invite",
      entityType: "staff_invite",
      entityId: hash,
      summary: { email, role },
      status: 201,
      // Older pending invites for the same email stop working (never deleted).
      side: (g) => [
        db
          .prepare(
            `UPDATE staff_invites SET expires_at = ?1 WHERE email = ?2 AND token_hash <> ?3 AND used_at IS NULL AND expires_at > ?1 AND ${g.sql}`,
          )
          .bind(t, email, hash, ...g.params),
      ],
    });
    if (!done) return err(c, USER_EXISTS, 409);
    return c.json(
      { link: `${new URL(c.req.url).origin}/invite#t=${token}`, expires_at: t + INVITE_TTL_MS },
      201,
    );
  })

  .post("/invites/:tokenHash/revoke", param(hashParam), async (c) => {
    const { tokenHash: hash } = c.req.valid("param");
    const t = now();
    const done = await mutate(c, {
      main: c.env.DB.prepare(
        "UPDATE staff_invites SET expires_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1",
      ).bind(t, hash),
      action: "user.invite_revoke",
      entityType: "staff_invite",
      entityId: hash,
    });
    return done ? c.json({ ok: true }) : err(c, NOT_FOUND, 404);
  })

  // Everyone's sessions end, except the one the owner is using (so they can carry on).
  .post("/sessions/revoke-all", async (c) => {
    const u = actor(c);
    const t = now();
    await mutate(c, {
      action: "user.sessions_revoke_all",
      entityType: "staff_user",
      entityId: null,
      side: (g) => [
        c.env.DB.prepare(
          `UPDATE staff_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND id <> ? AND ${g.sql}`,
        ).bind(t, u.sessionId, ...g.params),
      ],
    });
    return c.json({ ok: true });
  })

  .patch("/:id", param(idParam), json(roleRequest), async (c) => {
    const { id } = c.req.valid("param");
    const { role } = c.req.valid("json");
    const t = now();
    const result = await guarded(c, () =>
      mutate(c, {
        main: c.env.DB.prepare(
          `UPDATE staff_users SET role = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'active' AND role <> ?1 AND ${NOT_LAST_OWNER}`,
        ).bind(role, t, id),
        action: "user.role_change",
        entityType: "staff_user",
        entityId: id,
        summary: { role: { after: role } },
        side: (g) => [revokeSessionsOf(c, id, t)(g)],
      }),
    );
    if (result instanceof Response) return result;
    if (result) return c.json({ ok: true, changed: true });
    // Nothing changed: the same role already (fine), no such active member, or the last owner.
    const row = await c.env.DB.prepare("SELECT role, status FROM staff_users WHERE id = ?")
      .bind(id)
      .first<{ role: string; status: string }>();
    if (row?.status === "active" && row.role === role) return c.json({ ok: true, changed: false });
    return whyNot(c, id);
  })

  .post("/:id/deactivate", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const t = now();
    const result = await guarded(c, () =>
      mutate(c, {
        main: c.env.DB.prepare(
          `UPDATE staff_users SET status = 'deactivated', updated_at = ?1 WHERE id = ?2 AND status = 'active' AND ${NOT_LAST_OWNER}`,
        ).bind(t, id),
        action: "user.deactivate",
        entityType: "staff_user",
        entityId: id,
        summary: { status: { before: "active", after: "deactivated" } },
        side: (g) => [revokeSessionsOf(c, id, t)(g)],
      }),
    );
    if (result instanceof Response) return result;
    return result ? c.json({ ok: true }) : whyNot(c, id);
  })

  // Two-step reset (also the owner-started password reset): the person goes back to "invited" with no password,
  // no authenticator and no recovery codes, all their sessions end, and a fresh 48-hour link is returned once.
  .post("/:id/reset-2fa", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const u = actor(c);
    if (id === u.id) return err(c, SELF_RESET, 409);
    const t = now();
    const db = c.env.DB;
    const token = newToken();
    const hash = await tokenHash(token);
    const result = await guarded(c, () =>
      mutate(c, {
        main: db
          .prepare(
            `UPDATE staff_users SET status = 'invited', pw_salt = NULL, pw_hmac = NULL, pw_params = NULL, totp_secret_enc = NULL, totp_last_step = NULL, totp_enabled_at = NULL, updated_at = ?1 WHERE id = ?2 AND status = 'active' AND ${NOT_LAST_OWNER}`,
          )
          .bind(t, id),
        action: "user.reset_2fa",
        entityType: "staff_user",
        entityId: id,
        summary: { status: { before: "active", after: "invited" } },
        side: (g, auditId) => [
          db.prepare(`DELETE FROM staff_recovery_codes WHERE user_id = ? AND ${g.sql}`).bind(id, ...g.params),
          revokeSessionsOf(c, id, t)(g),
          db
            .prepare(
              `UPDATE staff_invites SET expires_at = ?1 WHERE email = (SELECT email FROM staff_users WHERE id = ?2) AND used_at IS NULL AND expires_at > ?1 AND ${g.sql}`,
            )
            .bind(t, id, ...g.params),
          db
            .prepare(
              `INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) SELECT ?1, email, role, ?2, ?3 FROM staff_users WHERE id = ?4 AND ${g.sql}`,
            )
            .bind(hash, u.id, t + INVITE_TTL_MS, id, ...g.params),
          alertStmt(
            c,
            "alert.2fa_change",
            { userId: id, role: u.role, actor: { type: "staff", id: u.id } },
            { auditId },
          ),
        ],
      }),
    );
    if (result instanceof Response) return result;
    if (!result) return whyNot(c, id);
    return c.json({ link: `${new URL(c.req.url).origin}/invite#t=${token}`, expires_at: t + INVITE_TTL_MS });
  });
