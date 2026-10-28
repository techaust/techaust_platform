// The statements of `pnpm invite` (scripts/create-invite.mjs), kept free of Node imports so the Worker tests can run
// exactly this SQL against a test database. They mirror the API's `POST /users/invites` (apps/admin/worker/users.ts):
// older pending invites for the address stop working, an address that already has an account other than "invited"
// is refused (nothing is written), the invite is stored, and the audit log gets `user.invite` (actor "system": it was
// done from the command line). The audit summary carries the role only, never the email: the address stays in the
// erasable `staff_invites` row (retention is Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11)).
//
// ONE STATEMENT PER LINE (D1's `exec` and `wrangler d1 execute --file` run a file line by line). Every statement is
// guarded in SQL on the address having no account but an "invited" one; the audit row is written only if the invite
// row exists, so a refused invite leaves no trace and no older invite is expired.

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

/**
 * @param {{ email: string, role: string, tokenHash: string, now: number, expiresAt: number, auditId: string }} p
 * @returns {string[]} the statements, in order
 */
export function createInviteStatements({ email, role, tokenHash, now, expiresAt, auditId }) {
  const e = q(email);
  const noAccount = `NOT EXISTS (SELECT 1 FROM staff_users WHERE email = ${e} AND status <> 'invited')`;
  const summary = JSON.stringify({ via: "cli", role });
  return [
    `UPDATE staff_invites SET expires_at = ${now} WHERE email = ${e} AND used_at IS NULL AND expires_at > ${now} AND ${noAccount};`,
    `INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) SELECT ${q(tokenHash)}, ${e}, ${q(role)}, NULL, ${expiresAt} WHERE ${noAccount};`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(auditId)}, 'system', NULL, 'user.invite', 'staff_invite', ${q(tokenHash)}, ${q(summary)} WHERE EXISTS (SELECT 1 FROM staff_invites WHERE token_hash = ${q(tokenHash)} AND email = ${e});`,
  ];
}
