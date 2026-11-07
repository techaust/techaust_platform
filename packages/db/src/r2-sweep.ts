// The R2 sweeps' SQL (M7.4 B.7; T7 F2; Batch M3.4 follow-up; M4.4 follow-up L19; run file docs/runs/m7.4-data-protection.md D.5, L7). The jobs Worker lists one
// page of keys and asks which have no row: the private file vault (`FILES`), and the replaced signature images under `settings/signature-` in `DOCS`. Every
// other `DOCS` prefix is never listed: its objects go only through the outbox (`r2_deletions`, filled by triggers). An orphan is queued for deletion only in
// a live run, and only once older than the sweep's age (24 hours for files, 7 days for signatures), so an upload between its object and its row is never lost.

/** The most keys one sweep page checks (R2's list `limit`). */
export const SWEEP_PAGE_KEYS = 100;

/**
 * The keys of a listed page (`?1`, a JSON array of strings) that no `files` row names: one probe each through the unique index `files_r2_key`.
 */
export const ORPHAN_FILES_SQL =
  "SELECT j.value AS key FROM json_each(?1) j WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.r2_key = j.value)";

/**
 * Every signature image a record still needs (L19): the one in Settings › Company now, every frozen document's sealed issuer block, and the issuer of every
 * cached statement PDF (re-rendered within its 30 days). One scan of the frozen documents (about 2,000 rows a month at launch; run monthly).
 */
export const SIGNATURES_IN_USE_SQL = `SELECT json_extract(value, '$.signature.key') AS key FROM settings WHERE key = 'company' AND json_extract(value, '$.signature.key') IS NOT NULL
  UNION SELECT json_extract(issuer, '$.signature.key') FROM documents WHERE frozen_at IS NOT NULL AND json_extract(issuer, '$.signature.key') IS NOT NULL
  UNION SELECT json_extract(issuer, '$.signature.key') FROM statement_pdfs WHERE json_extract(issuer, '$.signature.key') IS NOT NULL`;

/** The prefix of the signature images in `DOCS`, the only `DOCS` prefix a sweep lists. */
export const SIGNATURE_PREFIX = "settings/signature-";

/** Queues the orphans of a page for deletion (live runs only): `?1` bucket, `?2` reason, `?3` a JSON array of keys. A key already queued is left as it is. */
export const QUEUE_ORPHANS_SQL =
  "INSERT OR IGNORE INTO r2_deletions (bucket, key, reason) SELECT ?1, j.value, ?2 FROM json_each(?3) j";

/** After 5 failed attempts a row stays and one `r2.stuck` bell rings per IST day (D.4); the drain no longer takes it, so it never blocks a page. */
export const DRAIN_MAX_ATTEMPTS = 5;
/** The drain's page (D.4): the oldest 100 queued objects still to try, by `(created_at, id)` through `r2_deletions_created`. */
export const DRAIN_PAGE_ROWS = 100;
export const DRAIN_PAGE_SQL = `SELECT id, bucket, key, attempts FROM r2_deletions WHERE attempts < ${DRAIN_MAX_ATTEMPTS} ORDER BY created_at, id LIMIT ${DRAIN_PAGE_ROWS}`;
