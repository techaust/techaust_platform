// A payment's proof and a FEMA extension's bank letter (M6.1; ADM-INV-17, Q60, L10, L11): a raw body streamed into the private R2 bucket `DOCS`, write-once,
// never into the file vault (anonymising deletes vault files, and these are finance records: 08-C RA-25). The same steps as the vault (files.ts): the length
// is required and checked before a byte is read (here at most 5 MB); the first 512 bytes are sniffed against the name's extension (PDF, JPEG or PNG only);
// the rest is piped through a `FixedLengthStream`; R2 checks the SHA-256 the browser sent (`X-File-Sha256`), and the key carries it
// (`<prefix>-<sha256>`), so a retry of the same bytes lands on the same key. The put is conditional (`If-None-Match: *`): an object already there is never
// replaced. Nothing here logs a file name or bytes: keys, sizes and MIME types only.
import { extOf, SNIFF_BYTES, sniffFileType } from "@techaust/core/file-types";
import { type ApiError, BAD_REQUEST, type Ctx, err } from "./context.ts";
import { PROOF_TOO_LARGE, PROOF_TYPE_NOT_ALLOWED } from "./payment-messages.ts";

/** L10: proofs and bank letters are at most 5 MB. */
export const DOC_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** L10: PDF, JPEG or PNG (the `payments` triggers hold the same MIME list). */
const ALLOWED = new Set(["pdf", "jpg", "jpeg", "png"]);

const LENGTH_REQUIRED: ApiError = { code: "length_required", message: "The file's length is required" };
const EMPTY_FILE: ApiError = { code: "empty_file", message: "The file is empty" };
const TYPE_MISMATCH: ApiError = { code: "file_type_mismatch", message: "The file isn't what its name says" };
const CHECKSUM: ApiError = { code: "checksum_mismatch", message: "The file arrived damaged. Try again" };
const LENGTH_MISMATCH: ApiError = {
  code: "length_mismatch",
  message: "The file's length doesn't match what was sent",
};

/** What the headers say, checked before anything is read: the length, the extension of the name and the browser's SHA-256. */
export type UploadHead = { len: number; ext: string; sha: string };

/** The headers of an upload (`Content-Length`, `X-File-Name`, `X-File-Sha256`), or the refusal to answer with. */
export function uploadHead(c: Ctx): UploadHead | Response {
  const declared = c.req.header("Content-Length");
  if (declared === undefined) return err(c, LENGTH_REQUIRED, 411);
  if (!/^\d{1,12}$/.test(declared)) return err(c, BAD_REQUEST, 400);
  const len = Number(declared);
  if (len > DOC_UPLOAD_MAX_BYTES) return err(c, PROOF_TOO_LARGE, 413);
  if (len === 0) return err(c, EMPTY_FILE, 400);
  const rawName = c.req.header("X-File-Name");
  const sha = c.req.header("X-File-Sha256")?.toLowerCase();
  if (!rawName || rawName.length > 4000 || !sha || !/^[0-9a-f]{64}$/.test(sha))
    return err(c, BAD_REQUEST, 400);
  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    return err(c, BAD_REQUEST, 400);
  }
  const ext = extOf(name);
  if (!ALLOWED.has(ext)) return err(c, PROOF_TYPE_NOT_ALLOWED, 415);
  if (!c.req.raw.body) return err(c, EMPTY_FILE, 400);
  return { len, ext, sha };
}

const concat = (parts: Uint8Array[], total: number) => {
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};

/** The stored object: its key, MIME type, and whether this request created it (false: the same bytes were already there under the same key). */
export type Stored = { key: string; mime: string; created: boolean };

/**
 * Sniffs and streams the body into `DOCS` at `<keyPrefix>-<sha256>`, write-once. Returns the stored object, or the refusal to answer with (nothing is left
 * behind on a refusal: an object this call created is deleted again).
 */
export async function streamToDocs(c: Ctx, head: UploadHead, keyPrefix: string): Promise<Stored | Response> {
  const { len, ext, sha } = head;
  const stream = c.req.raw.body as ReadableStream<Uint8Array>;
  const reader = stream.getReader();
  const prefix: Uint8Array[] = [];
  let got = 0;
  let ended = false;
  try {
    while (got < Math.min(SNIFF_BYTES, len)) {
      const r = await reader.read();
      if (r.done) {
        ended = true;
        break;
      }
      prefix.push(r.value);
      got += r.value.byteLength;
    }
  } catch {
    return err(c, LENGTH_MISMATCH, 400);
  }
  const refuse = async (e: ApiError, status: 400 | 415) => {
    await reader.cancel().catch(() => {});
    return err(c, e, status);
  };
  if (got > len || (ended && got !== len)) return refuse(LENGTH_MISMATCH, 400);
  const sniffed = sniffFileType(concat(prefix, got).subarray(0, SNIFF_BYTES), ext);
  if (!sniffed.ok)
    return sniffed.reason === "empty"
      ? refuse(EMPTY_FILE, 400)
      : refuse(sniffed.reason === "type_not_allowed" ? PROOF_TYPE_NOT_ALLOWED : TYPE_MISMATCH, 415);

  const key = `${keyPrefix}-${sha}`;
  // The same bytes already stored under this key (a retry after a lost answer): nothing to write, the row step decides.
  if ((await c.env.DOCS.head(key)) !== null) {
    await reader.cancel().catch(() => {});
    return { key, mime: sniffed.mime, created: false };
  }
  reader.releaseLock();
  const fixed = new FixedLengthStream(len);
  const put = c.env.DOCS.put(key, fixed.readable, {
    sha256: sha,
    httpMetadata: { contentType: sniffed.mime },
    onlyIf: { etagDoesNotMatch: "*" },
  }).then(
    (o) => ({ ok: true as const, created: o !== null }),
    (e: unknown) => ({ ok: false as const, error: e ?? new Error("put failed") }),
  );
  let feedError: unknown = null;
  try {
    const writer = fixed.writable.getWriter();
    for (const part of prefix) await writer.write(part);
    writer.releaseLock();
    if (ended) await fixed.writable.close();
    else await stream.pipeTo(fixed.writable);
  } catch (e) {
    feedError = e ?? new Error("feed failed");
  }
  const result = await put;
  // Another request stored the same key between the `head` and the put: R2 refused ours, and what is there is the same bytes (the key is their SHA-256).
  if (result.ok && !result.created) return { key, mime: sniffed.mime, created: false };
  if (!result.ok || feedError) {
    // A refused conditional put created nothing; a failed one may have: only an object this call wrote is removed (never one that was already there).
    if (result.ok && result.created) await dropDoc(c.env, key, "upload failed");
    const text = result.ok ? "" : String(result.error) + String((result.error as Error | null)?.cause ?? "");
    if (/checksum|10037/i.test(text)) return err(c, CHECKSUM, 400);
    if (feedError || /FixedLengthStream|too many bytes|expected bytes/i.test(text))
      return err(c, LENGTH_MISMATCH, 400);
    throw result.ok ? feedError : result.error;
  }
  return { key, mime: sniffed.mime, created: result.created };
}

/** Removes an object this request created when its row was not written: best effort; the log line carries the key only. */
export async function dropDoc(env: Env, key: string, why: string) {
  try {
    await env.DOCS.delete(key);
  } catch {
    console.error(JSON.stringify({ level: "error", message: `r2 delete failed (${why})`, key }));
  }
}

/** Streams a stored proof or letter back through the session: an attachment, never rendered, never cached, never sniffed. */
export async function docDownload(
  c: Ctx,
  key: string,
  mime: string,
  filename: string,
): Promise<Response | null> {
  const obj = await c.env.DOCS.get(key);
  if (!obj) {
    console.error(JSON.stringify({ level: "error", message: "r2 object missing", key }));
    return null;
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(obj.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "no-store",
    },
  });
}

/** The file extension of a stored MIME type (for the download's name). */
export const extOfMime = (mime: string): string =>
  mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
