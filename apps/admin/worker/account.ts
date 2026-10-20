// The signed-in member's own account [ADM-AUTH-04, -05, -08]: who am I, step-up, my sessions, recovery codes.
// Every route here is behind the guard (`account.own`, or `account.recoveryCodes` which needs a fresh step-up).
import { sValidator } from "@hono/standard-validator";
import {
  clearCookie,
  codeKey,
  formatRecoveryCode,
  LOCK_AFTER,
  LOCK_MS,
  newRecoveryCodes,
  openTotpSecret,
  recoveryCodeHash,
  STEP_UP_MS,
  sessionIdParam,
  stepUpRequest,
  verifyTotp,
  WINDOW_MS,
} from "@techaust/auth";
import { Hono } from "hono/tiny";
import { alertStmt, lockoutAlert } from "./alerts.ts";
import { insertRecoveryCodes, json, RESERVE_SQL } from "./auth.ts";
import {
  type ApiError,
  type AppEnv,
  actor,
  BAD_REQUEST,
  type Ctx,
  err,
  logBatch,
  mutate,
  NOT_FOUND,
} from "./context.ts";

const LOCKED: ApiError = { code: "locked", message: "Too many attempts. Try again in 15 minutes." };
/** 400, not 401: a wrong step-up code must not look like an expired session to the browser. */
const INVALID_CODE: ApiError = {
  code: "invalid_code",
  message: "That code didn't work. Wait for the next one.",
};

const now = () => Date.now();

export const account = new Hono<AppEnv>()
  // Who am I. `stepUpUntil`: when the current step-up ends (null / past: none), so the screen knows to ask.
  .get("/me", (c) => {
    const u = actor(c);
    return c.json({
      user: { name: u.name, email: u.email, role: u.role },
      stepUpUntil: u.stepUpUntil && u.stepUpUntil > now() ? u.stepUpUntil : null,
    });
  })

  // Step-up [ADM-AUTH-08]: a FRESH code (a later 30-second step than the sign-in used) opens the sensitive routes
  // for ten minutes on this session. Wrong codes count on the same `code:` counter as sign-in.
  .post("/step-up", json(stepUpRequest), async (c) => {
    const { code } = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const t = now();
    const key = codeKey(u.id);
    const [reserved, read] = await db.batch([
      db.prepare(RESERVE_SQL).bind(key, t, WINDOW_MS, LOCK_AFTER, LOCK_MS, null),
      db.prepare("SELECT totp_secret_enc, totp_last_step FROM staff_users WHERE id = ?1").bind(u.id),
    ]);
    const counted = reserved?.results[0] as { failures: number } | undefined;
    if (!counted) return err(c, LOCKED, 429); // the access row is written on the way out
    const alerts = counted.failures >= LOCK_AFTER ? [lockoutAlert(c, u.id, u.role)] : [];
    const user = read?.results[0] as
      | { totp_secret_enc: string | null; totp_last_step: number | null }
      | undefined;
    const result = user?.totp_secret_enc
      ? verifyTotp(
          await openTotpSecret(c.env.TOTP_ENC_KEY, u.id, user.totp_secret_enc),
          code,
          t,
          user.totp_last_step,
        )
      : ({ ok: false } as const);
    const refuse = async () => {
      await logBatch(c, 400, alerts);
      return err(c, INVALID_CODE, 400);
    };
    if (!result.ok) return refuse();
    const until = t + STEP_UP_MS;
    const done = await mutate(c, {
      // The replay guard moves first; the session's step-up end and the audit row only follow if it did.
      main: [
        db
          .prepare(
            "UPDATE staff_users SET totp_last_step = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'active' AND (totp_last_step IS NULL OR totp_last_step < ?2)",
          )
          .bind(u.id, result.step, t),
        db
          .prepare("UPDATE staff_sessions SET step_up_until = ?2 WHERE id = ?1 AND changes() = 1")
          .bind(u.sessionId, until),
      ],
      action: "auth.step_up",
      entityType: "staff_user",
      entityId: u.id,
      summary: { until },
      side: (g) => [
        db.prepare(`DELETE FROM auth_attempts WHERE key = ?1 AND ${g.sql(2)}`).bind(key, ...g.params),
      ],
    });
    if (!done) return refuse(); // a replayed code: the guard moved nothing
    return c.json({ ok: true, stepUpUntil: until });
  })

  // My live sessions (the id is the token's SHA-256, not a credential) and how many recovery codes are left.
  .get("/sessions", async (c) => {
    const u = actor(c);
    const db = c.env.DB;
    const t = now();
    const [sessions, codes] = await db.batch([
      db
        .prepare(
          "SELECT id, created_at, last_seen_at, ip, user_agent FROM staff_sessions WHERE user_id = ?1 AND revoked_at IS NULL AND idle_expires_at > ?2 AND abs_expires_at > ?2 ORDER BY created_at DESC, id LIMIT 50",
        )
        .bind(u.id, t),
      db
        .prepare("SELECT count(*) AS n FROM staff_recovery_codes WHERE user_id = ?1 AND used_at IS NULL")
        .bind(u.id),
    ]);
    return c.json({
      sessions: ((sessions?.results ?? []) as { id: string }[]).map((s) => ({
        ...s,
        current: s.id === u.sessionId,
      })),
      recovery_codes_remaining: (codes?.results[0] as { n: number } | undefined)?.n ?? 0,
    });
  })

  .delete(
    "/sessions/:id",
    sValidator("param", sessionIdParam, (r, c) => (r.success ? undefined : err(c as Ctx, BAD_REQUEST, 400))),
    async (c) => {
      const u = actor(c);
      const { id } = c.req.valid("param");
      const done = await mutate(c, {
        // Scoped by user_id: someone else's session id matches nothing (404, never a hint it exists).
        main: c.env.DB.prepare(
          "UPDATE staff_sessions SET revoked_at = ?3 WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL",
        ).bind(id, u.id, now()),
        action: "auth.session_revoke",
        entityType: "staff_session",
        entityId: id,
        summary: { current: id === u.sessionId },
      });
      if (!done) return err(c, NOT_FOUND, 404);
      if (id === u.sessionId) c.header("Set-Cookie", clearCookie(), { append: true });
      return c.json({ ok: true });
    },
  )

  // Sign out everywhere, this browser included.
  .post("/sessions/revoke-all", async (c) => {
    const u = actor(c);
    const t = now();
    await mutate(c, {
      action: "auth.session_revoke_all",
      entityType: "staff_user",
      entityId: u.id,
      side: (g) => [
        c.env.DB.prepare(
          `UPDATE staff_sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL AND ${g.sql(3)}`,
        ).bind(t, u.id, ...g.params),
      ],
    });
    c.header("Set-Cookie", clearCookie(), { append: true });
    return c.json({ ok: true });
  })

  // New recovery codes (needs a fresh step-up): the old ones, used or not, stop working. Shown once.
  .post("/recovery/regenerate", async (c) => {
    const u = actor(c);
    const db = c.env.DB;
    const codes = newRecoveryCodes();
    const hashes = await Promise.all(codes.map((x) => recoveryCodeHash(x)));
    await mutate(c, {
      action: "auth.recovery_regenerate",
      entityType: "staff_user",
      entityId: u.id,
      side: (g, auditId) => [
        db
          .prepare(`DELETE FROM staff_recovery_codes WHERE user_id = ?1 AND ${g.sql(2)}`)
          .bind(u.id, ...g.params),
        insertRecoveryCodes(db, u.id, hashes, g),
        alertStmt(c, "alert.2fa_change", { userId: u.id, role: u.role }, { auditId }),
      ],
    });
    return c.json({ recoveryCodes: codes.map(formatRecoveryCode) });
  });
