// The statements of the owner's break-glass reset (docs/08 §3.2, `pnpm admin:reset-2fa`), kept free of Node imports so
// the Worker tests can run exactly this SQL against a test database. It mirrors the API's `POST /users/:id/reset-2fa`:
// the member goes back to "invited" with no password, no authenticator and no recovery codes, every session ends, older
// pending invites for that email stop working, a fresh 48-hour invite is stored (the link is printed by the script)
// and the audit log gets `user.reset_2fa` plus `alert.2fa_change` (actor "system": it was done from the command line).
//
// ONE STATEMENT PER LINE (D1's `exec` and `wrangler d1 execute --file` run a file line by line). Every statement after the
// first is guarded on the member being freshly reset (`status = 'invited' AND updated_at = <now>`), so if the first
// one is refused (no such active member, or the database's last-owner trigger) nothing else happens.

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
    `UPDATE staff_sessions SET revoked_at = ${now} WHERE revoked_at IS NULL AND user_id IN (${target});`,
    `UPDATE staff_invites SET expires_at = ${now} WHERE email = ${e} AND used_at IS NULL AND expires_at > ${now} AND EXISTS (${target});`,
    `INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) SELECT ${q(tokenHash)}, email, role, NULL, ${expiresAt} FROM staff_users WHERE email = ${e} AND ${fresh};`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(auditId)}, 'system', NULL, 'user.reset_2fa', 'staff_user', id, '{"via":"cli"}' FROM staff_users WHERE email = ${e} AND ${fresh};`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(alertId)}, 'system', NULL, 'alert.2fa_change', 'staff_user', id, '{"via":"cli"}' FROM staff_users WHERE email = ${e} AND ${fresh};`,
  ];
}
