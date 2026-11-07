// Rebuild PDF (JOB-PDF-02; run file docs/runs/rebuild-pdf.md, L3): the stored PDF a reader serves, resolved at the R2 read by the key the row records. One
// indexed query (`SERVED_PDF_SQL`, the partial index `pdf_repair_results_served`): the newest rebuilt object, else the original. Reader SQL and the hot
// routes' warm fixtures stay unchanged; nothing stores the served key or derives another key from it. Used by the API and invoices Workers' downloads.
import { SERVED_PDF_SQL, type ServedRow } from "@techaust/db/pdf-repairs";

type ServedEnv = { DB: D1Database; DOCS: R2Bucket };

/** The key served for an original key, and the rebuilt object's SHA-256 (null: the original, whose hash is the row's). */
export async function servedKey(
  env: Pick<ServedEnv, "DB">,
  originalKey: string,
): Promise<{ key: string; sha256: string | null }> {
  const row = await env.DB.prepare(SERVED_PDF_SQL).bind(originalKey).first<ServedRow>();
  return row ? { key: row.new_key, sha256: row.new_sha256 } : { key: originalKey, sha256: null };
}

/** The served object itself (null: missing), with its key and, when rebuilt, its SHA-256 (the ETag). */
export async function servedPdf(
  env: ServedEnv,
  originalKey: string,
): Promise<{ key: string; sha256: string | null; object: R2ObjectBody | null }> {
  const served = await servedKey(env, originalKey);
  return { ...served, object: await env.DOCS.get(served.key) };
}
