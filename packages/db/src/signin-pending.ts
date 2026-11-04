// M7.2 (Q3 A, owner 2026-11-01; run file docs/runs/m7.2-notifications.md, "Lead triage of the early check"): the unfinished staff sign-in marker. Tier A ground
// (staff auth). One row per `login_totp` challenge, keyed by the challenge's signed `jti`:
//   - the admin `/login` inserts it with ONE awaited statement, only after `verifyPassword` passed (an unknown email or a wrong password never reaches it);
//   - the session batch of `/totp` and `/recovery` deletes the row of the challenge it finishes, guarded on the session row (a lost race deletes nothing);
//   - the jobs `signin.unfinished` consumer (hourly tick, enqueue only) reads at most 50 rows that are not yet notified and older than the challenge's lifetime,
//     queues one email per active member and clock hour and the owners' bells, THEN marks them notified; notified rows older than a day are deleted.
// No address, IP, user agent, hash or secret is stored. Pure SQL text and statement builders; no schema import (the jobs bundle stays free of drizzle).

type Db = Pick<D1Database, "prepare">;

/** `/login` after the password check (`?1` the challenge's jti, `?2` the member, `?3` now). */
export const SIGNIN_PENDING_INSERT_SQL =
  "INSERT INTO staff_signin_pending (id, user_id, at) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO NOTHING";

/**
 * The finished sign-in's delete (`?1` the jti, `?2` its member, `?{at}` the new session's id): inside `startSession`'s batch, only once the session row exists,
 * and only the row of THIS challenge for THIS member.
 */
export const signinPendingDoneSql = (at: number): string =>
  `DELETE FROM staff_signin_pending WHERE id = ?1 AND user_id = ?2 AND EXISTS (SELECT 1 FROM staff_sessions WHERE id = ?${at})`;

/** At most this many rows a scan (Free plan: one bounded unit of work). */
export const SIGNIN_SCAN_LIMIT = 50;
/** Notified rows are kept a day (so the owners' bell and the email log can be matched), then deleted by the next scan. */
export const SIGNIN_KEEP_MS = 86_400_000;

/** One row the scan reads, with its member. */
export type SigninPendingRow = {
  id: string;
  user_id: string;
  at: number;
  email: string;
  name: string;
  role: string;
  status: string;
};

/**
 * The scan's read (`?1` the cut-off: now minus the challenge's lifetime, so a challenge that could still be finished is never reported), oldest first, on the
 * index `staff_signin_pending_scan (notified_at, at)`; then the delete of notified rows older than a day (`?2`). One batch.
 */
export function signinScanStatements(db: Db, now: number, ttlMs: number): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `SELECT p.id, p.user_id, p.at, u.email, u.name, u.role, u.status
         FROM staff_signin_pending p JOIN staff_users u ON u.id = p.user_id
         WHERE p.notified_at IS NULL AND p.at < ?1 ORDER BY p.at, p.id LIMIT ${SIGNIN_SCAN_LIMIT}`,
      )
      .bind(now - ttlMs),
    db
      .prepare("DELETE FROM staff_signin_pending WHERE notified_at IS NOT NULL AND notified_at < ?1")
      .bind(now - SIGNIN_KEEP_MS),
  ];
}

/**
 * After the emails are queued: the owners' bells (one per owner and bell key, `INSERT OR IGNORE` on the unique `(user_id, kind, entity_id)`), then the rows
 * marked notified (only those still unnotified). `bells` are the active members' keys (`<userId>:<IST hour>`) with the bell's title; `ids` every row read
 * (an inactive member's rows are marked too, so they are never read again; they get no email and no bell).
 */
export function signinNotifiedStatements(
  db: Db,
  now: number,
  ids: readonly string[],
  bells: readonly { key: string; title: string }[],
): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = bells.map((b) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
         SELECT 'n_' || lower(hex(randomblob(16))), o.id, 'signin.unfinished', 'staff_user', ?1, ?2, '/settings/users'
         FROM staff_users o WHERE o.role = 'owner' AND o.status = 'active'`,
      )
      .bind(b.key, b.title),
  );
  if (ids.length > 0)
    out.push(
      db
        .prepare(
          `UPDATE staff_signin_pending SET notified_at = ?1 WHERE notified_at IS NULL AND id IN (SELECT j.value FROM json_each(?2) j)`,
        )
        .bind(now, JSON.stringify(ids)),
    );
  return out;
}
