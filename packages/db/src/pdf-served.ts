// Rebuild PDF (JOB-PDF-02; run file docs/runs/rebuild-pdf.md, L3): the stored PDF every reader serves, resolved at the R2 read by the key its row records.
// Import-free on purpose (not even the Workers runtime's global types), so the portal and the jobs email consumer take it without the rest of `pdf-repairs.ts`
// (core's invoice and PDF-job lists); `@techaust/db/pdf-repairs` re-exports `SERVED_PDF_SQL` and `ServedRow` from here, so there is one copy.
//
// The rule (one copy for the admin downloads, the portal's `streamPdf` and the jobs email attachment): the newest rebuilt object of the original key, read by
// the partial index `pdf_repair_results_served`; when there is no rebuild, or the rebuilt object itself is gone (early check change 1), the original. Nothing
// stores the served key or derives another key from it.

/** The readers' lookup (`?1` the original key): the newest rebuilt object, by the partial index `pdf_repair_results_served`. No row: serve the original. */
export const SERVED_PDF_SQL =
  "SELECT new_key, new_sha256, completed_at FROM pdf_repair_results WHERE original_key = ?1 AND outcome = 'rebuilt' ORDER BY n DESC LIMIT 1";

export type ServedRow = { new_key: string; new_sha256: string; completed_at: number };

/**
 * What a reader serves for `originalKey`: `key` (the R2 key read), `sha256` (the rebuilt file's SHA-256; null when the original is served, whose hash is the
 * row's), `object` (null: missing) and `fellBack` (a rebuild is recorded but its object is gone, so the original was read; the caller logs it, with its
 * request id only).
 */
export type ServedObject<O> = {
  key: string;
  sha256: string | null;
  object: O | null;
  fellBack: boolean;
};

/**
 * The two bindings, structurally (a `D1Database` and an `R2Bucket` fit; `O` is then `R2ObjectBody`): no Workers global is named, because this module also
 * reaches the package's Node typecheck through `pdf-repairs.ts` and the trigger generator.
 */
type ServedDb = { prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } } };
type ServedBucket<O> = { get(key: string): Promise<O | null> };

/** One indexed D1 read, then one R2 read (two when a recorded rebuild's object is gone and the original is read instead). */
export async function servedObject<O>(
  db: ServedDb,
  docs: ServedBucket<O>,
  originalKey: string,
): Promise<ServedObject<O>> {
  const row = await db.prepare(SERVED_PDF_SQL).bind(originalKey).first<ServedRow>();
  if (row) {
    const object = await docs.get(row.new_key);
    if (object) return { key: row.new_key, sha256: row.new_sha256, object, fellBack: false };
  }
  return { key: originalKey, sha256: null, object: await docs.get(originalKey), fellBack: row !== null };
}
