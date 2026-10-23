// Staff sign-in API (docs/05 §6.1; ADM-AUTH-01, -02, -04, -05, -06, -07, -09): salt → login → code (TOTP or recovery
// code) → session, invite acceptance, logout. Raw D1 statements keep these hot paths cheap (the Free plan's 10 ms CPU
// budget counts every D1 call); every refusal uses the same generic bodies, so nothing reveals which accounts exist.
//
// Lockout (LD1, ADM-AUTH-06): an attempt is COUNTED FIRST, atomically (`RESERVE_SQL`), then verified. Passwords count
// on `acct:<hash of email>`, codes on `code:<user id>`; a full sign-in deletes both. A per-IP failure counter
// (`ip:`) blocks an address after 100 failures an hour; a request from a blocked address writes nothing at all.
//
// Turnstile (M2.4b, ADM-AUTH-06): only /login, and only from the 4th failure of an hour on. The token (if any) is checked
// BEFORE the reservation; the reservation (`RESERVE_GATED_SQL`) counts a request without a verified token only while fewer
// than 3 failures stand. A refused request does not move the ACCOUNT counter, so a script without a token can never lock a
// staff account; it does count one failure for its own ADDRESS (`ip:`), so it cannot write access rows without end.
import { sValidator } from "@hono/standard-validator";
import {
  ATTEMPT_READ,
  accountKey,
  base32,
  CHALLENGE_TTL_MS,
  clearCookie,
  codeKey,
  DEFAULT_PARAMS,
  DEVICE_COOKIE,
  deviceCookie,
  deviceFor,
  FAIL_SQL,
  fakeSalt,
  formatRecoveryCode,
  IP_LOCK_AFTER,
  IP_LOCK_MS,
  IP_READ,
  IP_WINDOW_MS,
  inviteFinishRequest,
  inviteStartRequest,
  ipKey,
  isAttemptKey,
  isRecoveryCode,
  LOCK_AFTER,
  LOCK_MS,
  loginRequest,
  newRecoveryCodes,
  newSession,
  newTotpSecret,
  normaliseRecoveryCode,
  openTotpSecret,
  passwordHmac,
  RESERVE_GATED_SQL,
  RESERVE_SQL,
  readCookie,
  recoveryCodeHash,
  recoveryRequest,
  saltRequest,
  sealTotpSecret,
  sessionCookie,
  signChallenge,
  TURNSTILE_AFTER,
  tokenHash,
  totpRequest,
  totpUri,
  verifyChallenge,
  verifyPassword,
  verifyTotp,
  verifyTurnstile,
  WINDOW_MS,
} from "@techaust/auth";
import { uuidv7 } from "@techaust/core/ids";
import type { Role } from "@techaust/core/permissions";
import { accessStmt, auditStmt, type GuardSql } from "@techaust/db/log";
import { Hono } from "hono/tiny";
import { type Alert, alertStmt, lockoutAlert, queueAlerts } from "./alerts.ts";
import {
  type ApiError,
  type AppEnv,
  accessEntry,
  BAD_REQUEST,
  type Ctx,
  err,
  logBatch,
  requestInfo,
} from "./context.ts";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  totp_secret_enc: string | null;
  totp_last_step: number | null;
};

const INVALID: ApiError = { code: "invalid_credentials", message: "Invalid email, password or code" };
const LOCKED: ApiError = { code: "locked", message: "Too many attempts. Try again in 15 minutes." };
/** 401 with its own code: the SPA shows the widget and sends the same client hash again with a token. */
export const TURNSTILE_REQUIRED: ApiError = {
  code: "turnstile_required",
  message: "Verification required",
};
const INVITE_INVALID: ApiError = {
  code: "invite_invalid",
  message: "This invite link is invalid or has expired",
};

export const json = <S extends Parameters<typeof sValidator>[1]>(schema: S) =>
  sValidator("json", schema, (result, c) => (result.success ? undefined : err(c as Ctx, BAD_REQUEST, 400)));

const now = () => Date.now();

// ---- lockout SQL --------------------------------------------------------------------------------------------

// FAIL_SQL, RESERVE_SQL and IP_READ moved to @techaust/auth in M1.6 (the portal reuses them); re-exported under the same names.
export { FAIL_SQL, IP_READ, RESERVE_SQL };

/** The reads of /login (?1 email), /totp and /recovery (?1 user id); tests EXPLAIN them. */
export const LOGIN_READ =
  "SELECT id, status, role, pw_salt, pw_hmac, totp_enabled_at FROM staff_users WHERE email = ?1";
export const TOTP_READ =
  "SELECT id, email, name, role, totp_secret_enc, totp_last_step FROM staff_users WHERE id = ?1 AND status = 'active'";
export const RECOVERY_USER_READ =
  "SELECT id, email, name, role FROM staff_users WHERE id = ?1 AND status = 'active'";
export const RECOVERY_CODE_READ =
  "SELECT 1 AS ok FROM staff_recovery_codes WHERE user_id = ?1 AND code_hash = ?2 AND used_at IS NULL";

type Counted = { failures: number; locked_until: number | null };

/**
 * The first call of /login, /totp and /recovery: [ip lock read, reservation, ...reads] in one batch. When the
 * address is blocked the reservation is skipped by its own SQL, so nothing was written.
 */
async function attempt(c: Ctx, key: string, reads: D1PreparedStatement[], gate?: { verified: boolean }) {
  const db = c.env.DB;
  const t = now();
  const ipk = c.var.ip ? await ipKey(c.env.SALT_PEPPER, c.var.ip) : null;
  // With a `gate` (the password counter, M2.4b) the batch also reads the counter BEFORE the reservation, so a refusal can
  // be told apart: a lock in force (429) or a missing Turnstile token (401). Nothing is written in either case.
  const guard = gate
    ? [
        db.prepare(ATTEMPT_READ).bind(key),
        db
          .prepare(RESERVE_GATED_SQL)
          .bind(key, t, WINDOW_MS, LOCK_AFTER, LOCK_MS, ipk, gate.verified ? 1 : 0, TURNSTILE_AFTER),
      ]
    : [db.prepare(RESERVE_SQL).bind(key, t, WINDOW_MS, LOCK_AFTER, LOCK_MS, ipk)];
  const results = await db.batch([db.prepare(IP_READ).bind(ipk), ...guard, ...reads]);
  const ip = results[0]?.results[0] as { locked_until: number | null } | undefined;
  const before = gate ? (results[1]?.results[0] as { locked_until: number | null } | undefined) : undefined;
  const first = gate ? 3 : 2;
  return {
    t,
    ipk,
    ipLocked: !!ip?.locked_until && ip.locked_until > t,
    /** The account counter's lock was in force before this request (only with a `gate`). */
    accountLocked: !!before?.locked_until && before.locked_until > t,
    reserved: results[first - 1]?.results[0] as Counted | undefined,
    reads: results.slice(first).map((r) => r.results[0]),
  };
}

/** Failed attempt: the address's failure count (+ any alert) and the access row, in one call; then the generic 401. */
type Attempt = { ipk: string | null; t: number; ipLocked: boolean };

/** The address's failure count, as a statement for the caller's single log batch (none without an address). */
const ipFail = (c: Ctx, a: Pick<Attempt, "ipk" | "t">) =>
  a.ipk ? [c.env.DB.prepare(FAIL_SQL).bind(a.ipk, a.t, IP_WINDOW_MS, IP_LOCK_AFTER, IP_LOCK_MS)] : [];

async function refuse(c: Ctx, a: Pick<Attempt, "ipk" | "t">, alerts: Alert[] = []) {
  await logBatch(c, 401, [...ipFail(c, a), ...alerts.map((x) => x.stmt)]);
  queueAlerts(
    c,
    alerts.map((x) => x.id),
  );
  return err(c, INVALID, 401);
}

/**
 * A password attempt that needs Turnstile and has no verified token. Answered the same for every email (the counter is
 * keyed by a hash, so unknown emails behave exactly like real ones). The account counter does not move; the caller's
 * address counts one failure, in the same single call that writes the access row (as for a locked account), so a script
 * without tokens ends up blocked. The request carried a token or not: a bad one is no different from none.
 */
async function turnstileRequired(c: Ctx, a: Pick<Attempt, "ipk" | "t">) {
  await logBatch(c, 401, ipFail(c, a));
  return err(c, TURNSTILE_REQUIRED, 401);
}

/**
 * The 429. From a blocked address nothing at all is written. For a locked account the attempt still counts as a
 * failure for the address (so hammering a locked account can't go on writing access rows for ever), in the same
 * single call that writes the access row.
 */
async function locked(c: Ctx, a: Attempt) {
  if (a.ipLocked) c.set("accessDone", true);
  else await logBatch(c, 429, ipFail(c, a));
  return err(c, LOCKED, 429);
}

// ---- sessions -----------------------------------------------------------------------------------------------

export type SessionStart = {
  user: { id: string; role: Role };
  /** Runs first; the session exists only if it changed one row (the TOTP replay guard, the recovery code's use). */
  guard: D1PreparedStatement;
  via: "totp" | "recovery" | "invite";
  /** Lockout counters a full sign-in deletes. */
  clear?: string[];
};

/**
 * Creates the session in ONE batch of about eight statements. Everything after the session insert is guarded on
 * the session row existing, so a lost race (a replayed code, a recovery code used twice) writes nothing but is
 * visible as `null`. Also in the batch: the `auth.login` audit row, the known-device bookkeeping and its alert
 * (not at enrolment), the 2FA-change alert (recovery code used), the lockout rows' deletion and the access row.
 */
export async function startSession(c: Ctx, o: SessionStart) {
  const db = c.env.DB;
  const t = now();
  const s = await newSession(t);
  const device = await deviceFor(readCookie(c.req.header("Cookie"), DEVICE_COOKIE));
  const uid = o.user.id;
  const live = (at: number) => `EXISTS (SELECT 1 FROM staff_sessions WHERE id = ?${at})`;
  const info = requestInfo(c);
  // Alerts ride in the same batch; the ones whose statement changed a row go to the email queue afterwards.
  const alerts: { at: number; id: string }[] = [];
  const addAlert = (a: Alert) => {
    alerts.push({ at: stmts.length, id: a.id });
    stmts.push(a.stmt);
  };
  const stmts: D1PreparedStatement[] = [
    o.guard,
    db
      .prepare(
        "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at, ip, user_agent) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE changes() = 1",
      )
      .bind(s.id, uid, s.lastSeenAt, s.idleExpiresAt, s.absExpiresAt, info.ip, info.ua),
    auditStmt(
      db,
      {
        ...info,
        actorId: uid,
        role: o.user.role,
        action: "auth.login",
        entityType: "staff_user",
        entityId: uid,
        summary: { via: o.via },
      },
      s.id,
    ),
  ];
  if (o.via === "recovery") {
    stmts.push(
      db
        .prepare(`UPDATE staff_users SET last_login_at = ?2, updated_at = ?2 WHERE id = ?1 AND ${live(3)}`)
        .bind(uid, t, s.id),
    );
    addAlert(
      alertStmt(
        c,
        "alert.2fa_change",
        { userId: uid, role: o.user.role, change: "recovery_code_used" },
        s.id,
      ),
    );
  }
  if (o.via !== "invite") {
    // A new device raises an alert; this runs BEFORE the device row is stored, so a known device is skipped.
    addAlert(
      alertStmt(
        c,
        "alert.new_device",
        { userId: uid, role: o.user.role },
        {
          sql: (at) =>
            `${live(at)} AND NOT EXISTS (SELECT 1 FROM staff_known_devices WHERE user_id = ?${at + 1} AND device_hash = ?${at + 2})`,
          params: [s.id, uid, device.hash],
        },
      ),
    );
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO staff_known_devices (user_id, device_hash, user_agent) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM staff_sessions WHERE id = ?4) ON CONFLICT(user_id, device_hash) DO NOTHING`,
      )
      .bind(uid, device.hash, info.ua, s.id),
  );
  if (o.clear?.length) {
    stmts.push(
      db
        .prepare(
          `DELETE FROM auth_attempts WHERE key IN (${o.clear.map((_, i) => `?${i + 1}`).join(", ")}) AND ${live(o.clear.length + 1)}`,
        )
        .bind(...o.clear, s.id),
    );
  }
  stmts.push(accessStmt(db, accessEntry(c, 200, uid), s.id));
  const results = await db.batch(stmts);
  if (results[1]?.meta.changes !== 1) return null;
  c.set("accessDone", true);
  c.header("Set-Cookie", sessionCookie(s.token, Math.floor((s.absExpiresAt - t) / 1000)), { append: true });
  c.header("Set-Cookie", deviceCookie(device.token), { append: true });
  // A new device means the guarded insert ran (a new browser, never the enrolment); a 2FA alert means the recovery code
  // was used. Only an alert whose row exists is queued.
  queueAlerts(
    c,
    alerts.filter((x) => results[x.at]?.meta.changes === 1).map((x) => x.id),
  );
  return s;
}

const inviteSalt = async (saltPepper: string, hash: string) => fakeSalt(saltPepper, `invite:${hash}`);

async function liveInvite(db: D1Database, token: string) {
  const hash = await tokenHash(token);
  const invite = await db
    .prepare(
      "SELECT token_hash, email, role FROM staff_invites WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2",
    )
    .bind(hash, now())
    .first<{ token_hash: string; email: string; role: string }>();
  return invite;
}

/** Ten recovery-code rows in one statement (30 bound values; D1 allows 100), only if `guardSql` holds. */
export function insertRecoveryCodes(db: D1Database, userId: string, hashes: string[], guard: GuardSql) {
  const values = hashes.map((_, i) => `(?${i * 3 + 1}, ?${i * 3 + 2}, ?${i * 3 + 3})`).join(", ");
  return db
    .prepare(
      `INSERT INTO staff_recovery_codes (id, user_id, code_hash) SELECT column1, column2, column3 FROM (VALUES ${values}) WHERE ${guard.sql(hashes.length * 3 + 1)}`,
    )
    .bind(...hashes.flatMap((h) => [uuidv7(), userId, h]), ...guard.params);
}

export const auth = new Hono<AppEnv>()
  // 1. Salt for an email (a deterministic fake one when there's no usable account). A lookup, not an attempt.
  .post("/salt", json(saltRequest), async (c) => {
    const { email } = c.req.valid("json");
    const user = await c.env.DB.prepare("SELECT status, pw_salt, pw_params FROM staff_users WHERE email = ?1")
      .bind(email)
      .first<{ status: string; pw_salt: string | null; pw_params: string | null }>();
    const real = user?.status === "active" && user.pw_salt;
    return c.json({
      salt: real ? user.pw_salt : await fakeSalt(c.env.SALT_PEPPER, email),
      params: real && user.pw_params ? JSON.parse(user.pw_params) : DEFAULT_PARAMS,
    });
  })

  // 2. Client hash → a short-lived challenge for the code step (no session yet). One batch: the address's lock,
  //    the reservation (counts the attempt), the user.
  .post("/login", json(loginRequest), async (c) => {
    const { email, clientHash, turnstile } = c.req.valid("json");
    const key = await accountKey(email);
    const db = c.env.DB;
    // Checked BEFORE any counter moves. A normal sign-in carries no token and makes no siteverify call.
    const verified = turnstile
      ? await verifyTurnstile({
          secret: c.env.TURNSTILE_SECRET,
          token: turnstile,
          remoteip: c.var.ip ?? "",
          action: "admin_login",
          hostnames: c.env.TURNSTILE_HOSTNAMES,
          // the generated Env type comes from the staging config, so the literal is widened before the comparison
          local: (c.env.ENVIRONMENT as string) === "local",
        })
      : false;
    const a = await attempt(c, key, [db.prepare(LOGIN_READ).bind(email)], { verified });
    if (a.ipLocked) return locked(c, a);
    // Nothing reserved: the account is locked (429) or this attempt needs a verified token (401). Nothing was counted.
    if (!a.reserved) return a.accountLocked ? locked(c, a) : turnstileRequired(c, a);
    const row = a.reads[0] as
      | {
          id: string;
          status: string;
          role: Role;
          pw_salt: string | null;
          pw_hmac: string | null;
          totp_enabled_at: number | null;
        }
      | undefined;
    const usable = !!row && row.status === "active" && row.totp_enabled_at !== null;
    const salt = usable && row.pw_salt ? row.pw_salt : await fakeSalt(c.env.SALT_PEPPER, email);
    const ok = await verifyPassword(c.env.PASSWORD_PEPPER, salt, clientHash, usable ? row.pw_hmac : null);
    // A lock that started with THIS attempt on a real account raises an alert (unknown emails get none).
    const alerts = row && a.reserved.failures >= LOCK_AFTER ? [lockoutAlert(c, row.id, row.role)] : [];
    if (!ok || !row) return refuse(c, a, alerts);
    const challenge = await signChallenge(c.env.SESSION_HMAC_KEY, {
      purpose: "login_totp",
      sub: row.id,
      exp: now() + CHALLENGE_TTL_MS,
      ak: key,
    });
    if (alerts.length) {
      await logBatch(
        c,
        200,
        alerts.map((x) => x.stmt),
      );
      queueAlerts(
        c,
        alerts.map((x) => x.id),
      );
    }
    return c.json({ next: "totp", challenge });
  })

  // 3. Authenticator code → session cookie. The code counter is reserved first; the check is the replay guard.
  .post("/totp", json(totpRequest), async (c) => {
    const { challenge, code } = c.req.valid("json");
    const claim = await verifyChallenge(c.env.SESSION_HMAC_KEY, challenge, "login_totp", now());
    // The password counter's key comes from the signed challenge (set at login), so no second read is needed.
    if (!claim || !isAttemptKey(claim.ak)) return err(c, INVALID, 401);
    const db = c.env.DB;
    const key = codeKey(claim.sub);
    const a = await attempt(c, key, [db.prepare(TOTP_READ).bind(claim.sub)]);
    if (a.ipLocked) return locked(c, a);
    if (!a.reserved) return locked(c, a);
    const user = a.reads[0] as UserRow | undefined;
    const alerts = user && a.reserved.failures >= LOCK_AFTER ? [lockoutAlert(c, user.id, user.role)] : [];
    if (!user?.totp_secret_enc) return refuse(c, a, alerts);
    const secret = await openTotpSecret(c.env.TOTP_ENC_KEY, user.id, user.totp_secret_enc);
    const result = verifyTotp(secret, code, a.t, user.totp_last_step);
    if (!result.ok) return refuse(c, a, alerts);
    const session = await startSession(c, {
      user,
      guard: db
        .prepare(
          "UPDATE staff_users SET totp_last_step = ?2, last_login_at = ?3, updated_at = ?3 WHERE id = ?1 AND status = 'active' AND (totp_last_step IS NULL OR totp_last_step < ?2)",
        )
        .bind(user.id, result.step, now()),
      via: "totp",
      clear: [claim.ak, key],
    });
    if (!session) return refuse(c, a, alerts);
    return c.json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
  })

  // 3b. A recovery code instead of the authenticator code [ADM-AUTH-04]: same challenge, same counter, single use.
  .post("/recovery", json(recoveryRequest), async (c) => {
    const { challenge, code } = c.req.valid("json");
    const claim = await verifyChallenge(c.env.SESSION_HMAC_KEY, challenge, "login_totp", now());
    if (!claim || !isAttemptKey(claim.ak)) return err(c, INVALID, 401);
    const db = c.env.DB;
    const key = codeKey(claim.sub);
    const hash = await recoveryCodeHash(code);
    const a = await attempt(c, key, [
      db.prepare(RECOVERY_USER_READ).bind(claim.sub),
      db.prepare(RECOVERY_CODE_READ).bind(claim.sub, hash),
    ]);
    if (a.ipLocked) return locked(c, a);
    if (!a.reserved) return locked(c, a);
    const user = a.reads[0] as Pick<UserRow, "id" | "email" | "name" | "role"> | undefined;
    const alerts = user && a.reserved.failures >= LOCK_AFTER ? [lockoutAlert(c, user.id, user.role)] : [];
    const matches = !!a.reads[1] && isRecoveryCode(normaliseRecoveryCode(code));
    if (!user || !matches) return refuse(c, a, alerts);
    const session = await startSession(c, {
      user,
      // The code's single use IS the guard: of two requests with the same code only one changes a row.
      guard: db
        .prepare(
          "UPDATE staff_recovery_codes SET used_at = ?3 WHERE user_id = ?1 AND code_hash = ?2 AND used_at IS NULL",
        )
        .bind(user.id, hash, now()),
      via: "recovery",
      clear: [claim.ak, key],
    });
    if (!session) return refuse(c, a, alerts);
    return c.json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
  })

  // Sign out (public: it works with whatever cookie it gets, and always clears it).
  .post("/logout", async (c) => {
    const token = readCookie(c.req.header("Cookie"));
    if (token) {
      const t = now();
      const id = await tokenHash(token);
      const db = c.env.DB;
      const info = requestInfo(c);
      await db.batch([
        db
          .prepare("UPDATE staff_sessions SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL")
          .bind(id, t),
        db
          .prepare(
            "INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id, ip, user_agent, request_id) SELECT ?1, 'staff', s.user_id, u.role, 'auth.logout', 'staff_user', s.user_id, ?2, ?3, ?4 FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id WHERE s.id = ?5 AND s.revoked_at = ?6",
          )
          .bind(uuidv7(), info.ip, info.ua, info.requestId, id, t),
      ]);
    }
    c.header("Set-Cookie", clearCookie(), { append: true });
    return c.json({ ok: true });
  })

  // Invite acceptance [ADM-AUTH-07]: start → name + password → enrol TOTP → active + session + recovery codes.
  .post("/invite/start", json(inviteStartRequest), async (c) => {
    const invite = await liveInvite(c.env.DB, c.req.valid("json").token);
    if (!invite) return err(c, INVITE_INVALID, 400);
    return c.json({
      email: invite.email,
      salt: await inviteSalt(c.env.SALT_PEPPER, invite.token_hash),
      params: DEFAULT_PARAMS,
    });
  })

  .post("/invite/finish", json(inviteFinishRequest), async (c) => {
    const { token, clientHash, name } = c.req.valid("json");
    const db = c.env.DB;
    const invite = await liveInvite(db, token);
    if (!invite) return err(c, INVITE_INVALID, 400);
    const existing = await db
      .prepare("SELECT id, status FROM staff_users WHERE email = ?1")
      .bind(invite.email)
      .first<{ id: string; status: string }>();
    if (existing && existing.status !== "invited") return err(c, INVITE_INVALID, 400);
    const userId = existing?.id ?? uuidv7();
    const salt = await inviteSalt(c.env.SALT_PEPPER, invite.token_hash);
    const secret = newTotpSecret();
    await db
      .prepare(
        `INSERT INTO staff_users (id, email, name, role, status, pw_salt, pw_hmac, pw_params, totp_secret_enc)
         VALUES (?1, ?2, ?9, ?3, 'invited', ?4, ?5, ?6, ?7)
         ON CONFLICT(email) DO UPDATE SET name = ?9, role = ?3, pw_salt = ?4, pw_hmac = ?5, pw_params = ?6, totp_secret_enc = ?7, updated_at = ?8
         WHERE status = 'invited'`,
      )
      .bind(
        userId,
        invite.email,
        invite.role,
        salt,
        await passwordHmac(c.env.PASSWORD_PEPPER, salt, clientHash),
        JSON.stringify(DEFAULT_PARAMS),
        await sealTotpSecret(c.env.TOTP_ENC_KEY, userId, secret),
        now(),
        name,
      )
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
    if (!userId || !inviteHash) return err(c, INVALID, 401);
    const db = c.env.DB;
    // The member being enrolled, with the role of the invite that is still live for them (none live: refused).
    const row = await db
      .prepare(
        "SELECT u.id, u.email, u.name, i.role AS role, u.totp_secret_enc, u.totp_last_step FROM staff_users u JOIN staff_invites i ON i.token_hash = ?2 AND i.email = u.email AND i.used_at IS NULL AND i.expires_at > ?3 WHERE u.id = ?1 AND u.status = 'invited'",
      )
      .bind(userId, inviteHash, now())
      .first<UserRow>();
    if (!row?.totp_secret_enc) return err(c, INVALID, 401);
    const user = row;
    const secret = await openTotpSecret(c.env.TOTP_ENC_KEY, user.id, user.totp_secret_enc as string);
    const result = verifyTotp(secret, code, now(), user.totp_last_step);
    if (!result.ok) return err(c, INVALID, 401);
    const t = now();
    const codes = newRecoveryCodes();
    const active: GuardSql = {
      sql: (at) =>
        `EXISTS (SELECT 1 FROM staff_users WHERE id = ?${at} AND status = 'active' AND totp_enabled_at = ?${at + 1})`,
      params: [user.id, t],
    };
    // The invite is consumed FIRST, only if it is still live (not revoked, expired or replaced) and belongs to this
    // member; the member is activated, with the role of THAT invite, only if it was consumed (`changes()` right
    // after it); the recovery codes only if the member is active. A revoked invite therefore can't be completed.
    const [consumed, activated] = await db.batch([
      db
        .prepare(
          "UPDATE staff_invites SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1 AND email = (SELECT email FROM staff_users WHERE id = ?3 AND status = 'invited')",
        )
        .bind(t, inviteHash, user.id),
      db
        .prepare(
          "UPDATE staff_users SET status = 'active', role = (SELECT role FROM staff_invites WHERE token_hash = ?2), totp_enabled_at = ?1, updated_at = ?1 WHERE id = ?3 AND status = 'invited' AND changes() = 1",
        )
        .bind(t, inviteHash, user.id),
      insertRecoveryCodes(db, user.id, await Promise.all(codes.map((x) => recoveryCodeHash(x))), active),
    ]);
    if (consumed?.meta.changes !== 1 || activated?.meta.changes !== 1) return err(c, INVALID, 401);
    const session = await startSession(c, {
      user,
      guard: db
        .prepare(
          "UPDATE staff_users SET totp_last_step = ?2, last_login_at = ?3, updated_at = ?3 WHERE id = ?1 AND status = 'active' AND (totp_last_step IS NULL OR totp_last_step < ?2)",
        )
        .bind(user.id, result.step, now()),
      via: "invite",
    });
    if (!session) return err(c, INVALID, 401);
    return c.json({
      ok: true,
      user: { name: user.name, email: user.email, role: user.role },
      recoveryCodes: codes.map(formatRecoveryCode),
    });
  });
