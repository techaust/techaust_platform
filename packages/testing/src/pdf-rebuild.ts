// Rebuild PDF (JOB-PDF-02; run file docs/runs/rebuild-pdf.md "Done-test"): the fixture both halves of the done-test share (the admin route in
// apps/admin/worker/pdf-rebuild.test.ts and the jobs consumer in apps/jobs/test/pdf-rebuild.test.ts): the bytes of an original, a damaged and a rebuilt PDF,
// their SHA-256, and the frozen row read whole so "before and after" compare every column. No bare imports (the apps import this file by path), invented
// data only.

const enc = (s: string) => new TextEncoder().encode(s);

/** The parts of D1 and R2 this file uses (structural, so the package needs no Workers types). */
type Db = { prepare(q: string): { bind(...v: unknown[]): { first(): Promise<unknown> } } };
type Bucket = {
  put(
    key: string,
    value: Uint8Array,
    o: { httpMetadata: { contentType: string }; sha256: string },
  ): Promise<unknown>;
};

/** A stored original PDF (made-up bytes; what a first render stored). */
export const ORIGINAL_PDF = enc("%PDF-1.7\n% sample original\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
/** The same file damaged in storage (other bytes under the same key: a test put without `onlyIf`). */
export const DAMAGED_PDF = enc("%PDF-1.7\n% sample damaged\n%%EOF\n");
/** What the admin half stores at the new key to stand in for the jobs Worker's rebuilt file. */
export const REBUILT_PDF = enc("%PDF-1.7\n% sample rebuilt\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

/** Lower-case hex SHA-256 of some bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Every column of one row as JSON text (`SELECT *`), for the "the frozen row is unchanged" check. */
export async function wholeRow(
  db: Db,
  table: "documents" | "deeds" | "acceptance_certificates",
  where: string,
  id: string,
) {
  const row = await db.prepare(`SELECT * FROM ${table} WHERE ${where} = ?1`).bind(id).first();
  if (!row) throw new Error(`no ${table} row ${id}`);
  return JSON.stringify(row);
}

/** Puts an object the way the jobs Worker stores a PDF (with its SHA-256, so R2 records the checksum), and returns that hash. */
export async function putWithSha(docs: Bucket, key: string, bytes: Uint8Array): Promise<string> {
  const sha256 = await sha256Hex(bytes);
  await docs.put(key, bytes, { httpMetadata: { contentType: "application/pdf" }, sha256 });
  return sha256;
}
