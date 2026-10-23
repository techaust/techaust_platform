// The SQL statements behind every counter in `auth_attempts` (docs/05 §5.2): staff login (M1.5: `acct:`, `code:`,
// `ip:`) and portal sign-in (M1.6: `p:req:`, `p:mail:`, `p:fail:`). Moved here verbatim from the admin Worker so both
// Workers share one tested implementation; `reserveAttempt` / `recordFailure` in lockout.ts are their pure twins and
// the admin tests prove the two agree.

/**
 * One atomic upsert for a failed attempt, so parallel failures each add one (no read-modify-write). It mirrors
 * `recordFailure` exactly: a missing row or one whose window is >= WINDOW_MS old starts again at 1 failure
 * (window_start = now); otherwise failures + 1 with the window kept; the lock (now + LOCK_MS) is set when the new
 * count is >= LOCK_AFTER, else locked_until is left as it was (also across a window reset, as in recordFailure).
 * ?1 key, ?2 now, ?3 window ms, ?4 lock-after count, ?5 lock ms. In SQLite's DO UPDATE every right-hand side reads
 * the old row, so the repeated CASE is consistent. Used as is for the per-IP counter.
 */
export const FAIL_SQL = `INSERT INTO auth_attempts (key, window_start, failures, locked_until)
VALUES (?1, ?2, 1, CASE WHEN 1 >= ?4 THEN ?2 + ?5 ELSE NULL END)
ON CONFLICT(key) DO UPDATE SET
  window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END,
  failures = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END,
  locked_until = CASE WHEN (CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END) >= ?4
                      THEN ?2 + ?5 ELSE locked_until END`;

/**
 * `reserveAttempt` in SQL (LD1): count the attempt now, unless the lock is in force. A row comes back (RETURNING)
 * exactly when the attempt was counted, even when this very reservation set the lock; NO row means locked, and
 * nothing was written. ?1-?5 as FAIL_SQL, ?6 the caller's `ip:` key: while that address is blocked nothing is
 * counted either (a blocked address writes nothing). Bind ?6 to NULL to skip the address check.
 */
export const RESERVE_SQL = `INSERT INTO auth_attempts (key, window_start, failures, locked_until)
SELECT ?1, ?2, 1, CASE WHEN 1 >= ?4 THEN ?2 + ?5 ELSE NULL END
WHERE NOT EXISTS (SELECT 1 FROM auth_attempts WHERE key = ?6 AND locked_until > ?2)
ON CONFLICT(key) DO UPDATE SET
  window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END,
  failures = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END,
  locked_until = CASE WHEN (CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END) >= ?4
                      THEN ?2 + ?5 ELSE locked_until END
WHERE locked_until IS NULL OR locked_until <= ?2
RETURNING failures, locked_until`;

/**
 * `RESERVE_SQL` for the staff password counter once Turnstile applies (M2.4b, ADM-AUTH-06): the same upsert, with two
 * more binds. ?7 is 1 when this request carried a Turnstile token that Cloudflare confirmed (else 0); ?8 is
 * `TURNSTILE_AFTER` (3). The INSERT (no row yet) always counts. An existing row counts only when its lock is over AND
 * (the request is verified, OR its window has run out and the count restarts at 1, OR it has fewer than ?8 failures).
 * So the first three wrong passwords of an hour need no token; from the fourth on, a request without a verified token
 * counts nothing and returns no row. It is `reserveAttemptGated` in SQL (the admin tests prove the two agree).
 * `RESERVE_SQL` itself is unchanged and still serves every counter that has no Turnstile step.
 */
export const RESERVE_GATED_SQL = `INSERT INTO auth_attempts (key, window_start, failures, locked_until)
SELECT ?1, ?2, 1, CASE WHEN 1 >= ?4 THEN ?2 + ?5 ELSE NULL END
WHERE NOT EXISTS (SELECT 1 FROM auth_attempts WHERE key = ?6 AND locked_until > ?2)
ON CONFLICT(key) DO UPDATE SET
  window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END,
  failures = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END,
  locked_until = CASE WHEN (CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END) >= ?4
                      THEN ?2 + ?5 ELSE locked_until END
WHERE (locked_until IS NULL OR locked_until <= ?2)
  AND (?7 = 1 OR ?2 - window_start >= ?3 OR failures < ?8)
RETURNING failures, locked_until`;

/** The pre-read that tells a refused gated reservation apart: a lock in force (429) or a missing token (401). */
export const ATTEMPT_READ = "SELECT window_start, failures, locked_until FROM auth_attempts WHERE key = ?1";

/** The block read: is this counter's lock in force? (?1 key.) */
export const IP_READ = "SELECT locked_until FROM auth_attempts WHERE key = ?1";
