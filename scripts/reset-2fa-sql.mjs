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
// M7.5 (C5; M1.5 follow-up; ASVS 5.0 V6): the only-owner rule is in the SQL too, so a reset of the last active owner changes no row (and so nothing after it)
// rather than relying on the trigger alone; the break-glass invite needs the lost owner to be STILL the only active owner when it runs. After either run the
// script reads its audit rows back (`auditReadBackSql`, `readBackProblem`) and says so if one is missing.

/** The number of active owners, as an SQL expression (the only-owner guards). */
const ACTIVE_OWNERS = "(SELECT count(*) FROM staff_users WHERE role = 'owner' AND status = 'active')";

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
    `UPDATE staff_users SET status = 'invited', pw_salt = NULL, pw_hmac = NULL, pw_params = NULL, totp_secret_enc = NULL, totp_last_step = NULL, totp_enabled_at = NULL, updated_at = ${now} WHERE email = ${e} AND status = 'active' AND (role <> 'owner' OR ${ACTIVE_OWNERS} > 1);`,
    `DELETE FROM staff_recovery_codes WHERE user_id IN (${target});`,
    `DELETE FROM staff_known_devices WHERE user_id IN (${target});`,
    `UPDATE staff_sessions SET revoked_at = ${now} WHERE revoked_at IS NULL AND user_id IN (${target});`,
    `UPDATE staff_invites SET expires_at = ${now} WHERE email = ${e} AND used_at IS NULL AND expires_at > ${now} AND EXISTS (${target});`,
    `INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) SELECT ${q(tokenHash)}, email, role, NULL, ${expiresAt} FROM staff_users WHERE email = ${e} AND ${fresh};`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(auditId)}, 'system', NULL, 'user.reset_2fa', 'staff_user', id, '{"via":"cli"}' FROM staff_users WHERE email = ${e} AND ${fresh};`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(alertId)}, 'system', NULL, 'alert.2fa_change', 'staff_user', id, '{"via":"cli","change":"reset_by_owner"}' FROM staff_users WHERE email = ${e} AND ${fresh};`,
  ];
}

/**
 * M7.5 (L36, the early check's F6): how far before a member's `updated_at` its reset's `user.reset_2fa` row may be dated and still count as that reset's. The
 * CLI's `updated_at` comes from the clock of the PC that ran it, the audit row's `at` from D1's; the margin absorbs the difference between the two.
 */
export const RESET_ROW_MARGIN_MS = 5 * 60_000;

/**
 * A member who is ALREADY "invited" (a reset was done earlier and the link was lost): a fresh invite only, without
 * touching `staff_users`. Older pending invites stop working; the audit log gets `user.invite` (actor "system").
 *
 * M7.5 (L36): a run of `resetStatements` cut short after its first UPDATE leaves the member "invited" with no `user.reset_2fa` and no `alert.2fa_change`; the
 * next run takes this path. So when the member carries the reset's own mark (invited, no password, no authenticator) and no `user.reset_2fa` row is dated
 * since its `updated_at` (less `RESET_ROW_MARGIN_MS`), both rows are written now (`resetAuditId`, then `alertId` guarded on it), as `resetStatements` would
 * have. A member who already has the row, or who has set a password since (an enrolment begun), gets neither.
 * @param {{ email: string, tokenHash: string, now: number, expiresAt: number, auditId: string, resetAuditId: string, alertId: string }} p
 * @returns {string[]}
 */
export function reinviteStatements({ email, tokenHash, now, expiresAt, auditId, resetAuditId, alertId }) {
  const e = q(email);
  const invited = `SELECT 1 FROM staff_users WHERE email = ${e} AND status = 'invited'`;
  const unrecorded = `email = ${e} AND status = 'invited' AND pw_hmac IS NULL AND totp_secret_enc IS NULL AND totp_enabled_at IS NULL AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.action = 'user.reset_2fa' AND a.entity_type = 'staff_user' AND a.entity_id = staff_users.id AND a.at >= staff_users.updated_at - ${RESET_ROW_MARGIN_MS})`;
  return [
    `UPDATE staff_invites SET expires_at = ${now} WHERE email = ${e} AND used_at IS NULL AND expires_at > ${now} AND EXISTS (${invited});`,
    `INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) SELECT ${q(tokenHash)}, email, role, NULL, ${expiresAt} FROM staff_users WHERE email = ${e} AND status = 'invited';`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(auditId)}, 'system', NULL, 'user.invite', 'staff_invite', ${q(tokenHash)}, '{"via":"cli"}' FROM staff_users WHERE email = ${e} AND status = 'invited';`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(resetAuditId)}, 'system', NULL, 'user.reset_2fa', 'staff_user', id, '{"via":"cli","resumed":true}' FROM staff_users WHERE ${unrecorded};`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(alertId)}, 'system', NULL, 'alert.2fa_change', 'staff_user', entity_id, '{"via":"cli","change":"reset_by_owner"}' FROM audit_log WHERE id = ${q(resetAuditId)} AND action = 'user.reset_2fa';`,
  ];
}

/**
 * M7.5 (L36): the audit rows a re-issue must show, by what its read-back found: always the `user.invite` row; and the alert when the run recorded the reset
 * (the two are written together or not at all).
 * @param {{ found: string[], auditId: string, resetAuditId: string, alertId: string }} p
 * @returns {{ expected: string[], recordedReset: boolean }}
 */
export function reinviteExpected({ found, auditId, resetAuditId, alertId }) {
  const recordedReset = found.includes(resetAuditId);
  return { expected: recordedReset ? [auditId, resetAuditId, alertId] : [auditId], recordedReset };
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
    `${ACTIVE_OWNERS} = 1`,
    `NOT EXISTS (SELECT 1 FROM staff_users WHERE email = ${e})`,
    `NOT EXISTS (SELECT 1 FROM staff_invites WHERE email = ${e} AND used_at IS NULL AND expires_at > ${now})`,
  ].join(" AND ");
  return [
    `INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) SELECT ${q(tokenHash)}, ${e}, 'owner', NULL, ${expiresAt} WHERE ${guard};`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(auditId)}, 'system', NULL, 'user.invite', 'staff_invite', ${q(tokenHash)}, ${q(summary)} WHERE EXISTS (SELECT 1 FROM staff_invites WHERE token_hash = ${q(tokenHash)} AND email = ${e});`,
  ];
}

/**
 * M7.5 (C5): the read-back of a run's audit rows (`ids`, one per line of the run that writes one).
 * @param {string[]} ids
 * @returns {string}
 */
export function auditReadBackSql(ids) {
  return `SELECT id FROM audit_log WHERE id IN (${ids.map(q).join(", ")})`;
}

/**
 * M7.5 (C5): what is wrong after a run, by its read-back: `null` when every expected audit row is there; else the sentence the script stops with. The run is
 * a single file of guarded statements, so a missing row means the guard held (nothing else happened) or the run was cut short: either way the person must
 * check before acting on the link.
 * @param {{ found: string[], expected: string[] }} p
 * @returns {string | null}
 */
export function readBackProblem({ found, expected }) {
  const missing = expected.filter((id) => !found.includes(id));
  if (missing.length === 0) return null;
  return `The audit log does not show this run (${missing.length} of ${expected.length} audit rows missing): do not use the link. Check Staff and invites, then run the command again.`;
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
