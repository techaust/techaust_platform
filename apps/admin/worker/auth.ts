// Staff login API (docs/05 §6.1; ADM-AUTH-01, -02, -05, -07). M1.4 scope: salt → login → TOTP → session,
// invite acceptance (used for the first Owner and the CPU benchmark), me and logout. Raw D1 statements keep
// these hot paths cheap; every response uses the same generic errors so nothing reveals which accounts exist.
import { sValidator } from "@hono/standard-validator";
import {
  type Attempts,
  base32,
  CHALLENGE_TTL_MS,
  checkSession,
  clearCookie,
  DEFAULT_PARAMS,
  enc,
  fakeSalt,
  hex,
  inviteFinishRequest,
  inviteStartRequest,
  isAttemptKey,
  isLocked,
  loginRequest,
  newSession,
  newTotpSecret,
  openTotpSecret,
  passwordHmac,
  readCookie,
  recordFailure,
  saltRequest,
  sealTotpSecret,
  sessionCookie,
  sha256,
  signChallenge,
  tokenHash,
  totpRequest,
  totpUri,
  verifyChallenge,
  verifyPassword,
  verifyTotp,
} from "@techaust/auth";
import { uuidv7 } from "@techaust/core";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";

type AppEnv = { Bindings: Env };
type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  totp_secret_enc: string | null;
  totp_last_step: number | null;
};
/** The lockout columns of a LEFT JOINed `auth_attempts` row: all null when there is no row. */
type AttemptCols = { window_start: number | null; failures: number | null; locked_until: number | null };

const INVALID = {
  error: { code: "invalid_credentials", message: "Invalid email, password or code" },
} as const;
const LOCKED = { error: { code: "locked", message: "Too many attempts. Try again in 15 minutes." } } as const;
const BAD_REQUEST = { error: { code: "bad_request", message: "Check the form and try again" } } as const;
const INVITE_INVALID = {
  error: { code: "invite_invalid", message: "This invite link is invalid or has expired" },
} as const;

const json = <S extends z.ZodType>(schema: S) =>
  sValidator("json", schema, (result, c) => (result.success ? undefined : c.json(BAD_REQUEST, 400)));

const now = () => Date.now();

/** Lockout is keyed by a hash of the email, so unknown emails behave exactly like real ones. */
const attemptKey = async (email: string) => `acct:${hex(await sha256(enc.encode(email))).slice(0, 32)}`;

const attemptsOf = (row: AttemptCols): Attempts | null =>
  row.window_start === null || row.failures === null
    ? null
    : { windowStart: row.window_start, failures: row.failures, lockedUntil: row.locked_until };

async function fail(db: D1Database, key: string, before: Attempts | null) {
  const a = recordFailure(before, now());
  await db
    .prepare(
      "INSERT INTO auth_attempts (key, window_start, failures, locked_until) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET window_start = ?2, failures = ?3, locked_until = ?4",
    )
    .bind(key, a.windowStart, a.failures, a.lockedUntil)
    .run();
}

const userByEmail = (db: D1Database, email: string) =>
  db.prepare("SELECT * FROM staff_users WHERE email = ?").bind(email).first<UserRow>();
// (Used by the invite routes only; the hot login routes read exactly the columns they need.)

const inviteSalt = async (saltPepper: string, hash: string) => fakeSalt(saltPepper, `invite:${hash}`);

async function liveInvite(db: D1Database, token: string) {
  const hash = await tokenHash(token);
  const invite = await db
    .prepare(
      "SELECT token_hash, email, role FROM staff_invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
    )
    .bind(hash, now())
    .first<{ token_hash: string; email: string; role: string }>();
  return invite;
}

/**
 * Creates the session in one batch. With `attemptKey` (the password + code login) the failure counter is cleared
 * as the last statement, and only when the replay guard moved `totp_last_step`: `changes() = 1` still refers to
 * the audit insert, which itself runs only after the guard succeeded, so a replayed code never clears failures.
 */
export function startSession(
  db: D1Database,
  userId: string,
  ip: string | null,
  ua: string | null,
  step: number,
  attemptKey?: string,
) {
  return async () => {
    const s = await newSession(now());
    const statements = [
      // Atomic replay guard: only one request can move totp_last_step past this step.
      db
        .prepare(
          "UPDATE staff_users SET totp_last_step = ?2, last_login_at = ?3, updated_at = ?3 WHERE id = ?1 AND (totp_last_step IS NULL OR totp_last_step < ?2)",
        )
        .bind(userId, step, now()),
      db
        .prepare(
          "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at, ip, user_agent) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE changes() = 1",
        )
        .bind(s.id, userId, s.lastSeenAt, s.idleExpiresAt, s.absExpiresAt, ip, ua),
      db
        .prepare(
          "INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, ip, user_agent) SELECT ?1, 'staff', ?2, 'auth.login', 'staff_user', ?2, ?3, ?4 WHERE changes() = 1",
        )
        .bind(uuidv7(), userId, ip, ua),
    ];
    if (attemptKey) {
      statements.push(
        db.prepare("DELETE FROM auth_attempts WHERE key = ?1 AND changes() = 1").bind(attemptKey),
      );
    }
    const results = await db.batch(statements);
    return results[1]?.meta.changes === 1 ? s : null;
  };
}

export const auth = new Hono<AppEnv>()
  .use(bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json(BAD_REQUEST, 413) }))
  .use(async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  })

  // 1. Salt for an email (a deterministic fake one when there's no account).
  .post("/salt", json(saltRequest), async (c) => {
    const { email } = c.req.valid("json");
    const user = await c.env.DB.prepare("SELECT status, pw_salt, pw_params FROM staff_users WHERE email = ?")
      .bind(email)
      .first<{ status: string; pw_salt: string | null; pw_params: string | null }>();
    const real = user?.status === "active" && user.pw_salt;
    return c.json({
      salt: real ? user.pw_salt : await fakeSalt(c.env.SALT_PEPPER, email),
      params: real && user.pw_params ? JSON.parse(user.pw_params) : DEFAULT_PARAMS,
    });
  })

  // 2. Client hash → a short-lived challenge for the TOTP step (no session yet).
  .post("/login", json(loginRequest), async (c) => {
    const { email, clientHash } = c.req.valid("json");
    const key = await attemptKey(email);
    // One read that always returns one row (the subquery); user and lockout columns are null when absent.
    const row = await c.env.DB.prepare(
      "SELECT u.id, u.status, u.pw_salt, u.pw_hmac, u.totp_enabled_at, a.window_start, a.failures, a.locked_until FROM (SELECT ?1 AS email, ?2 AS akey) q LEFT JOIN staff_users u ON u.email = q.email LEFT JOIN auth_attempts a ON a.key = q.akey",
    )
      .bind(email, key)
      .first<
        AttemptCols & {
          id: string | null;
          status: string | null;
          pw_salt: string | null;
          pw_hmac: string | null;
          totp_enabled_at: number | null;
        }
      >();
    if (!row) throw new Error("login read returned no row");
    const attempts = attemptsOf(row);
    if (isLocked(attempts, now())) return c.json(LOCKED, 429);
    const usable = row.id !== null && row.status === "active" && row.totp_enabled_at !== null;
    const salt = usable && row.pw_salt ? row.pw_salt : await fakeSalt(c.env.SALT_PEPPER, email);
    const ok = await verifyPassword(c.env.PASSWORD_PEPPER, salt, clientHash, usable ? row.pw_hmac : null);
    if (!ok || row.id === null) {
      await fail(c.env.DB, key, attempts);
      return c.json(INVALID, 401);
    }
    const challenge = await signChallenge(c.env.SESSION_HMAC_KEY, {
      purpose: "login_totp",
      sub: row.id,
      exp: now() + CHALLENGE_TTL_MS,
      ak: key,
    });
    return c.json({ next: "totp", challenge });
  })

  // 3. TOTP → session cookie.
  .post("/totp", json(totpRequest), async (c) => {
    const { challenge, code } = c.req.valid("json");
    const claim = await verifyChallenge(c.env.SESSION_HMAC_KEY, challenge, "login_totp", now());
    // The lockout key comes from the signed challenge (set at login), so no second read is needed.
    if (!claim || !isAttemptKey(claim.ak)) return c.json(INVALID, 401);
    const key = claim.ak;
    const user = await c.env.DB.prepare(
      "SELECT u.id, u.email, u.name, u.role, u.totp_secret_enc, u.totp_last_step, a.window_start, a.failures, a.locked_until FROM staff_users u LEFT JOIN auth_attempts a ON a.key = ?2 WHERE u.id = ?1 AND u.status = 'active'",
    )
      .bind(claim.sub, key)
      .first<
        AttemptCols & Pick<UserRow, "id" | "email" | "name" | "role" | "totp_secret_enc" | "totp_last_step">
      >();
    if (!user?.totp_secret_enc) return c.json(INVALID, 401);
    const attempts = attemptsOf(user);
    if (isLocked(attempts, now())) return c.json(LOCKED, 429);
    const secret = await openTotpSecret(c.env.TOTP_ENC_KEY, user.id, user.totp_secret_enc);
    const result = verifyTotp(secret, code, now(), user.totp_last_step);
    const session = result.ok
      ? await startSession(
          c.env.DB,
          user.id,
          c.req.header("CF-Connecting-IP") ?? null,
          c.req.header("User-Agent") ?? null,
          result.step,
          key,
        )()
      : null;
    if (!session) {
      await fail(c.env.DB, key, attempts);
      return c.json(INVALID, 401);
    }
    c.header("Set-Cookie", sessionCookie(session.token, Math.floor((session.absExpiresAt - now()) / 1000)));
    return c.json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
  })

  .get("/me", async (c) => {
    const token = readCookie(c.req.header("Cookie"));
    if (!token) return c.json({ error: { code: "unauthenticated", message: "Sign in" } }, 401);
    const id = await tokenHash(token);
    const row = await c.env.DB.prepare(
      "SELECT s.last_seen_at, s.idle_expires_at, s.abs_expires_at, s.revoked_at, u.name, u.email, u.role FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id WHERE s.id = ? AND u.status = 'active'",
    )
      .bind(id)
      .first<{
        last_seen_at: number;
        idle_expires_at: number;
        abs_expires_at: number;
        revoked_at: number | null;
        name: string;
        email: string;
        role: string;
      }>();
    const state = row
      ? checkSession(
          {
            lastSeenAt: row.last_seen_at,
            idleExpiresAt: row.idle_expires_at,
            absExpiresAt: row.abs_expires_at,
            revokedAt: row.revoked_at,
          },
          now(),
        )
      : { valid: false, touch: false };
    if (!row || !state.valid) return c.json({ error: { code: "unauthenticated", message: "Sign in" } }, 401);
    if (state.touch) {
      const t = now();
      await c.env.DB.prepare(
        "UPDATE staff_sessions SET last_seen_at = ?2, idle_expires_at = min(?3, abs_expires_at) WHERE id = ?1",
      )
        .bind(id, t, t + 12 * 60 * 60 * 1000)
        .run();
    }
    return c.json({ user: { name: row.name, email: row.email, role: row.role } });
  })

  .post("/logout", async (c) => {
    const token = readCookie(c.req.header("Cookie"));
    if (token) {
      await c.env.DB.prepare("UPDATE staff_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
        .bind(now(), await tokenHash(token))
        .run();
    }
    c.header("Set-Cookie", clearCookie());
    return c.json({ ok: true });
  })

  // Invite acceptance [ADM-AUTH-07]: start → set password → enrol TOTP → active + session.
  .post("/invite/start", json(inviteStartRequest), async (c) => {
    const invite = await liveInvite(c.env.DB, c.req.valid("json").token);
    if (!invite) return c.json(INVITE_INVALID, 400);
    return c.json({
      email: invite.email,
      salt: await inviteSalt(c.env.SALT_PEPPER, invite.token_hash),
      params: DEFAULT_PARAMS,
    });
  })

  .post("/invite/finish", json(inviteFinishRequest), async (c) => {
    const { token, clientHash } = c.req.valid("json");
    const invite = await liveInvite(c.env.DB, token);
    if (!invite) return c.json(INVITE_INVALID, 400);
    const existing = await userByEmail(c.env.DB, invite.email);
    if (existing && existing.status !== "invited") return c.json(INVITE_INVALID, 400);
    const userId = existing?.id ?? uuidv7();
    const salt = await inviteSalt(c.env.SALT_PEPPER, invite.token_hash);
    const secret = newTotpSecret();
    const values = [
      await passwordHmac(c.env.PASSWORD_PEPPER, salt, clientHash),
      JSON.stringify(DEFAULT_PARAMS),
      await sealTotpSecret(c.env.TOTP_ENC_KEY, userId, secret),
    ];
    await c.env.DB.prepare(
      `INSERT INTO staff_users (id, email, name, role, status, pw_salt, pw_hmac, pw_params, totp_secret_enc)
       VALUES (?1, ?2, ?2, ?3, 'invited', ?4, ?5, ?6, ?7)
       ON CONFLICT(email) DO UPDATE SET pw_salt = ?4, pw_hmac = ?5, pw_params = ?6, totp_secret_enc = ?7, updated_at = ?8
       WHERE status = 'invited'`,
    )
      .bind(userId, invite.email, invite.role, salt, ...values, now())
      .run();
    const challenge = await signChallenge(c.env.SESSION_HMAC_KEY, {
      purpose: "enrol_totp",
      sub: `${userId}|${invite.token_hash}`,
      exp: now() + CHALLENGE_TTL_MS * 2,
    });
    return c.json({ totpUri: totpUri(invite.email, secret), secret: base32(secret), challenge });
  })

  .post("/invite/totp", json(totpRequest), async (c) => {
    const { challenge, code } = c.req.valid("json");
    const claim = await verifyChallenge(c.env.SESSION_HMAC_KEY, challenge, "enrol_totp", now());
    const [userId, inviteHash] = claim ? claim.sub.split("|") : [];
    if (!userId || !inviteHash) return c.json(INVALID, 401);
    const user = await c.env.DB.prepare("SELECT * FROM staff_users WHERE id = ? AND status = 'invited'")
      .bind(userId)
      .first<UserRow>();
    if (!user?.totp_secret_enc) return c.json(INVALID, 401);
    const secret = await openTotpSecret(c.env.TOTP_ENC_KEY, user.id, user.totp_secret_enc);
    const result = verifyTotp(secret, code, now(), user.totp_last_step);
    if (!result.ok) return c.json(INVALID, 401);
    const t = now();
    const [activated] = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE staff_users SET status = 'active', totp_enabled_at = ?2, updated_at = ?2 WHERE id = ?1 AND status = 'invited'",
      ).bind(user.id, t),
      c.env.DB.prepare(
        "UPDATE staff_invites SET used_at = ?2 WHERE token_hash = ?1 AND used_at IS NULL",
      ).bind(inviteHash, t),
    ]);
    if (activated?.meta.changes !== 1) return c.json(INVALID, 401);
    const session = await startSession(
      c.env.DB,
      user.id,
      c.req.header("CF-Connecting-IP") ?? null,
      c.req.header("User-Agent") ?? null,
      result.step,
    )();
    if (!session) return c.json(INVALID, 401);
    c.header("Set-Cookie", sessionCookie(session.token, Math.floor((session.absExpiresAt - t) / 1000)));
    return c.json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
  });
