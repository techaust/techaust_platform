// Rebuild PDF (JOB-PDF-02; run file docs/runs/rebuild-pdf.md, L3): the stored PDF an admin download serves, resolved at the R2 read by the key the row records.
// The rule is `servedObject` (`@techaust/db/pdf-served`, shared with the portal and the jobs email consumer): one indexed query (`SERVED_PDF_SQL`, the
// partial index `pdf_repair_results_served`), the newest rebuilt object, else the original; and the original again when a recorded rebuild's object is gone
// (early check change 1: a lost rebuilt file never leaves a download answering "not ready" forever). Reader SQL and the hot routes' warm fixtures stay
// unchanged; nothing stores the served key or derives another key from it. Used by the API and invoices Workers' downloads.
import { type ServedObject, servedObject } from "@techaust/db/pdf-served";

type ServedEnv = { DB: D1Database; DOCS: R2Bucket };

/**
 * The served object (null: missing), with its key and, when a rebuilt file is served, its SHA-256 (the ETag; null: the original, whose hash is the row's).
 * A recorded rebuild whose object is gone is logged (`rebuilt pdf object missing`, the request id only) and the original is served.
 */
export async function servedPdf(env: ServedEnv, originalKey: string, rid: string): Promise<ServedObject> {
  const served = await servedObject(env.DB, env.DOCS, originalKey);
  if (served.fellBack)
    console.error(JSON.stringify({ level: "error", message: "rebuilt pdf object missing", rid }));
  return served;
}
