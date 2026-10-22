// FRM-02, second layer: the exact limits per address, counted in D1 (`auth_attempts`, keys `f:10m:<ipHash>` and
// `f:day:<ipHash>`). The first layer (2 per 60 s) is the Rate Limiting binding on the web Worker. A submission over
// either limit creates no lead and sends no email.
export const WINDOW_10M_MS = 10 * 60_000;
export const WINDOW_DAY_MS = 24 * 3_600_000;
export const LIMIT_10M = 5;
export const LIMIT_DAY = 50;

/** One atomic upsert that counts this submission and returns the count in its window (a window restarts at 1). */
const COUNT_SQL = `INSERT INTO auth_attempts (key, window_start, failures) VALUES (?1, ?2, 1)
ON CONFLICT(key) DO UPDATE SET
  window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END,
  failures = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END
RETURNING failures`;

/** The two counting statements for `ipHash`, for a caller that puts them in its own `db.batch()` (see leads.ts). */
export const countStatements = (db: D1Database, ipHash: string, now: number): D1PreparedStatement[] => [
  db.prepare(COUNT_SQL).bind(`f:10m:${ipHash}`, now, WINDOW_10M_MS),
  db.prepare(COUNT_SQL).bind(`f:day:${ipHash}`, now, WINDOW_DAY_MS),
];

/**
 * SQL condition (true when both counters, just moved in the same batch, are within their limits). `?a` and `?b` are the
 * numbers of the parameters holding the two counter keys, see `limitKeys`.
 */
export const withinLimitsSql = (a: number, b: number): string =>
  `(SELECT failures FROM auth_attempts WHERE key = ?${a}) <= ${LIMIT_10M} AND (SELECT failures FROM auth_attempts WHERE key = ?${b}) <= ${LIMIT_DAY}`;

export const limitKeys = (ipHash: string): [string, string] => [`f:10m:${ipHash}`, `f:day:${ipHash}`];

/** Counts one submission for `ipHash` in both windows (one `db.batch()`), true when it is within both limits. */
export async function countSubmission(db: D1Database, ipHash: string, now: number): Promise<boolean> {
  const [short, day] = await db.batch<{ failures: number }>(countStatements(db, ipHash, now));
  const a = short?.results[0]?.failures ?? Number.POSITIVE_INFINITY;
  const b = day?.results[0]?.failures ?? Number.POSITIVE_INFINITY;
  return a <= LIMIT_10M && b <= LIMIT_DAY;
}
