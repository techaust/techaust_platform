// The statements of the owner's break-glass reset (docs/08 §3.2, `pnpm admin:reset-2fa`), kept free of Node imports so
// the Worker tests can run exactly this SQL against a test database. It mirrors the API's `POST /users/:id/reset-2fa`:
// the member goes back to "invited" with no password, no authenticator and no recovery codes, every session ends, older
// pending invites for that email stop working, a fresh 48-hour invite is stored (the link is printed by the script)
// and the audit log gets `user.reset_2fa` plus `alert.2fa_change` (actor "system": it was done from the command line).
//
// ONE STATEMENT PER LINE (D1's `exec` and `wrangler d1 execute --file` run a file line by line). Every statement after the
// first is guarded on the member being freshly reset (`status = 'invited' AND updated_at = <now>`), so if the first
// one is refused (no such active member, or the database's last-owner trigger) nothing else happens.
// The ONLY active owner cannot be reset (the trigger stays strict): `breakGlassStatements` below invites a second owner.

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

/**
 * @param {{ email: string, tokenHash: string, now: number, expiresAt: number, auditId: string, alertId: string }} p
 * @returns {string[]} the statements, in order
 */
export function resetStatements({ email, tokenHash, now, expiresAt, auditId, alertId }) {
  const e = q(email);
  const fresh = `status = 'invited' AND updated_at = ${now}`;
  const target = `SELECT id FROM staff_users WHERE email = ${e} AND ${fresh}`;
  return [
    `UPDATE staff_users SET status = 'invited', pw_salt = NULL, pw_hmac = NULL, pw_params = NULL, totp_secret_enc = NULL, totp_last_step = NULL, totp_enabled_at = NULL, updated_at = ${now} WHERE email = ${e} AND status = 'active';`,
    `DELETE FROM staff_recovery_codes WHERE user_id IN (${target});`,
    `DELETE FROM staff_known_devices WHERE user_id IN (${target});`,
    `UPDATE staff_sessions SET revoked_at = ${now} WHERE revoked_at IS NULL AND user_id IN (${target});`,
    `UPDATE staff_invites SET expires_at = ${now} WHERE email = ${e} AND used_at IS NULL AND expires_at > ${now} AND EXISTS (${target});`,
    `INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) SELECT ${q(tokenHash)}, email, role, NULL, ${expiresAt} FROM staff_users WHERE email = ${e} AND ${fresh};`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(auditId)}, 'system', NULL, 'user.reset_2fa', 'staff_user', id, '{"via":"cli"}' FROM staff_users WHERE email = ${e} AND ${fresh};`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(alertId)}, 'system', NULL, 'alert.2fa_change', 'staff_user', id, '{"via":"cli"}' FROM staff_users WHERE email = ${e} AND ${fresh};`,
  ];
}

/**
 * A member who is ALREADY "invited" (a reset was done earlier and the link was lost): a fresh invite only, without
 * touching `staff_users`. Older pending invites stop working; the audit log gets `user.invite` (actor "system").
 * @param {{ email: string, tokenHash: string, now: number, expiresAt: number, auditId: string }} p
 * @returns {string[]}
 */
export function reinviteStatements({ email, tokenHash, now, expiresAt, auditId }) {
  const e = q(email);
  const invited = `SELECT 1 FROM staff_users WHERE email = ${e} AND status = 'invited'`;
  return [
    `UPDATE staff_invites SET expires_at = ${now} WHERE email = ${e} AND used_at IS NULL AND expires_at > ${now} AND EXISTS (${invited});`,
    `INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) SELECT ${q(tokenHash)}, email, role, NULL, ${expiresAt} FROM staff_users WHERE email = ${e} AND status = 'invited';`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(auditId)}, 'system', NULL, 'user.invite', 'staff_invite', ${q(tokenHash)}, '{"via":"cli"}' FROM staff_users WHERE email = ${e} AND status = 'invited';`,
  ];
}

/**
 * The address check shared by `--email` and `--new-email`: trimmed, lower-cased, one `@`, no spaces.
 * @param {unknown} value
 * @returns {string | null} the normalised address, or null when it is not one
 */
export function normaliseEmail(value) {
  const e = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/**
 * Break-glass for the ONLY active owner (docs/08 §3.2). The last-owner trigger stays strict, so the lost owner's own row
 * is never touched. Instead a one-time OWNER invite for a second address the owner controls is stored, plus one audit
 * row (`user.invite`, actor "system"). The summary carries the lost owner's user id and no email or other personal data.
 * Every statement is guarded in SQL as well (the lost owner is still an active owner, nobody has the new address, no live
 * unused invite for it exists), so a race between the script's checks and the run cannot create a second invite. The
 * audit row exists only if the invite row was inserted. Statements only INSERT into `staff_invites` and `audit_log`:
 * `staff_users`, sessions and recovery codes are read-only here.
 * @param {{ newEmail: string, lostOwnerId: string, tokenHash: string, now: number, expiresAt: number, auditId: string }} p
 * @returns {string[]}
 */
export function breakGlassStatements({ newEmail, lostOwnerId, tokenHash, now, expiresAt, auditId }) {
  const e = q(newEmail);
  const summary = JSON.stringify({ via: "cli", reason: "break-glass", lost_owner_id: lostOwnerId });
  const guard = [
    `EXISTS (SELECT 1 FROM staff_users WHERE id = ${q(lostOwnerId)} AND role = 'owner' AND status = 'active')`,
    `NOT EXISTS (SELECT 1 FROM staff_users WHERE email = ${e})`,
    `NOT EXISTS (SELECT 1 FROM staff_invites WHERE email = ${e} AND used_at IS NULL AND expires_at > ${now})`,
  ].join(" AND ");
  return [
    `INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) SELECT ${q(tokenHash)}, ${e}, 'owner', NULL, ${expiresAt} WHERE ${guard};`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(auditId)}, 'system', NULL, 'user.invite', 'staff_invite', ${q(tokenHash)}, ${q(summary)} WHERE EXISTS (SELECT 1 FROM staff_invites WHERE token_hash = ${q(tokenHash)} AND email = ${e});`,
  ];
}

/**
 * The script's refusals for the only-owner case, as a pure function so the tests can call it. `existing` and `liveInvites`
 * are counts the script reads first: staff_users rows with the new address (any status) and live unused invites for it.
 * @param {{ email: string, newEmail: unknown, existing: number, liveInvites: number, staging?: boolean }} p
 * @returns {string} the normalised new address; throws an Error with the reason otherwise
 */
export function checkBreakGlass({ email, newEmail, existing, liveInvites, staging = false }) {
  if (newEmail === undefined || newEmail === "")
    throw new Error(
      `${email} is the only active owner, and the database refuses to reset the last owner, so there is no reset to run. ` +
        "Break-glass instead: issue a one-time owner invite for a SECOND address you control, enrol that account, then " +
        "reset or deactivate this one from Staff and invites (allowed once two owners exist). Run:\n" +
        `  pnpm admin:reset-2fa --email ${email} --new-email <another address you control>${staging ? " --staging" : ""}`,
    );
  const n = normaliseEmail(newEmail);
  if (!n) throw new Error("--new-email must be an email address.");
  if (n === email) throw new Error("--new-email must be a different address from --email.");
  if (existing > 0)
    throw new Error(`${n} already belongs to a staff member: use an address with no account.`);
  if (liveInvites > 0)
    throw new Error(
      `${n} already has a live invite: use it, revoke it in Staff and invites, or use another address.`,
    );
  return n;
}
