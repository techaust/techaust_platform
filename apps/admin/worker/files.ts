// The file vault (M3.4, ADM-PRJ-04): files on a client or one of its projects, kept in the private R2 bucket `FILES`. There is no public
// bucket and no signed URL: an upload and a download both pass through this Worker with a signed-in session, so the access check
// and the audit/access row are the Worker's own.
//
// Upload (raw body, never multipart): `Content-Length` is required and checked against 25 MiB before a byte is read; the first
// 512 bytes are read and matched against the allow-list by their signature (`sniffFileType`); the rest is piped straight into R2
// through a `FixedLengthStream`, so the Worker never holds the file. R2 verifies the SHA-256 the browser sent (`X-File-Sha256`).
// The row, its audit entry and the access row are one D1 batch written after the object; if that fails the object is deleted again.
// Nothing here logs or audits a filename or file bytes: ids, sizes, MIME types and the R2 key (`files/<clientId>/<fileId>`) only.
import {
  contentDisposition,
  extOf,
  fileKey,
  isAllowedExtension,
  MAX_UPLOAD_BYTES,
  SNIFF_BYTES,
  sanitiseFilename,
  sniffFileType,
} from "@techaust/core/file-types";
import { uuidv7 } from "@techaust/core/ids";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import {
  type ApiError,
  type AppEnv,
  actor,
  BAD_REQUEST,
  type Ctx,
  err,
  mutate,
  NOT_FOUND,
} from "./context.ts";
import { body, idParam, limitOf, param } from "./http.ts";
import { decodeCursor, keysetSql, pageOf } from "./keyset.ts";
import type { Scope } from "./notes.ts";

const LENGTH_REQUIRED: ApiError = { code: "length_required", message: "The file's length is required" };
const FILE_TOO_LARGE: ApiError = { code: "file_too_large", message: "The file is larger than 25 MB" };
const EMPTY_FILE: ApiError = { code: "empty_file", message: "The file is empty" };
const TYPE_NOT_ALLOWED: ApiError = {
  code: "file_type_not_allowed",
  message: "This type of file isn't allowed",
};
const TYPE_MISMATCH: ApiError = { code: "file_type_mismatch", message: "The file isn't what its name says" };
const CHECKSUM: ApiError = { code: "checksum_mismatch", message: "The file arrived damaged. Try again" };
const LENGTH_MISMATCH: ApiError = {
  code: "length_mismatch",
  message: "The file's length doesn't match what was sent",
};

export const fileListQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});
const patchFile = z.strictObject({ shared: z.boolean() });

export type FileRow = {
  id: string;
  client_id: string;
  project_id: string | null;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  shared: number;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: number;
};
export const FILE_COLS =
  "f.id, f.client_id, f.project_id, f.filename, f.mime, f.size, f.sha256, f.shared, f.uploaded_by, (SELECT name FROM staff_users WHERE id = f.uploaded_by) AS uploaded_by_name, f.created_at";
/** The shape sent to the screens: never the R2 key. */
export const fileView = (r: FileRow) => ({
  id: r.id,
  clientId: r.client_id,
  projectId: r.project_id,
  filename: r.filename,
  mime: r.mime,
  size: r.size,
  sha256: r.sha256,
  shared: r.shared === 1,
  uploadedBy: r.uploaded_by,
  uploadedByName: r.uploaded_by_name,
  createdAt: r.created_at,
});

/** One page of a scope's files, newest first. Exported so a test can EXPLAIN it. */
export function fileListSql(scope: Scope["kind"], withCursor: boolean, limit: number) {
  const col = scope === "project" ? "f.project_id" : "f.client_id";
  const order = keysetSql("f.created_at", "f.id", false, "after", 2);
  return `SELECT ${FILE_COLS} FROM files f WHERE ${col} = ?1${withCursor ? ` AND ${order.where}` : ""} ORDER BY ${order.order} LIMIT ${limit + 1}`;
}

export async function listFiles(c: Ctx, s: Scope, q: z.infer<typeof fileListQuery>) {
  const limit = limitOf(q.limit);
  const cur = q.after === undefined ? null : decodeCursor(q.after);
  if (q.after !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
  const { results } = await c.env.DB.prepare(fileListSql(s.kind, cur !== null, limit))
    .bind(s.id, ...(cur ? [cur.k, cur.id] : []))
    .all<FileRow>();
  if (results.length === 0) {
    const t = s.kind === "project" ? "projects" : "clients";
    if (!(await c.env.DB.prepare(`SELECT 1 AS x FROM ${t} WHERE id = ?1`).bind(s.id).first()))
      return err(c, NOT_FOUND, 404);
  }
  const page = pageOf(results, limit, "after", cur !== null, (r) => ({ k: r.created_at, id: r.id }));
  return c.json({ files: page.items.map(fileView), next: page.next });
}

/** Cleanup of a stored object: best effort, and the log line carries the key only (never a filename). */
async function dropObject(env: Env, key: string, why: string) {
  try {
    await env.FILES.delete(key);
  } catch {
    console.error(JSON.stringify({ level: "error", message: `r2 delete failed (${why})`, key }));
  }
}

/** Deletes R2 objects after a database change; a failure leaves an orphan whose key is logged (the M7.4 clean-up lists them). */
export async function dropObjects(env: Env, keys: string[], why: string) {
  for (let i = 0; i < keys.length; i += 1000) {
    const part = keys.slice(i, i + 1000);
    try {
      await env.FILES.delete(part);
    } catch {
      for (const key of part)
        console.error(JSON.stringify({ level: "error", message: `r2 delete failed (${why})`, key }));
    }
  }
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

export async function uploadFile(c: Ctx, s: Scope) {
  const user = actor(c);
  // 1. Headers, before anything is read.
  const declared = c.req.header("Content-Length");
  if (declared === undefined) return err(c, LENGTH_REQUIRED, 411);
  if (!/^\d{1,12}$/.test(declared)) return err(c, BAD_REQUEST, 400);
  const len = Number(declared);
  if (len > MAX_UPLOAD_BYTES) return err(c, FILE_TOO_LARGE, 413);
  if (len === 0) return err(c, EMPTY_FILE, 400);
  const rawName = c.req.header("X-File-Name");
  const sha = c.req.header("X-File-Sha256")?.toLowerCase();
  if (!rawName || rawName.length > 4000 || !sha || !/^[0-9a-f]{64}$/.test(sha))
    return err(c, BAD_REQUEST, 400);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    return err(c, BAD_REQUEST, 400);
  }
  const filename = sanitiseFilename(decoded);
  if (!c.req.raw.body) return err(c, EMPTY_FILE, 400);

  // 2. The target and its client.
  const target =
    s.kind === "project"
      ? await c.env.DB.prepare("SELECT client_id FROM projects WHERE id = ?1")
          .bind(s.id)
          .first<{ client_id: string }>()
      : await c.env.DB.prepare("SELECT id AS client_id FROM clients WHERE id = ?1")
          .bind(s.id)
          .first<{ client_id: string }>();
  if (!target) return err(c, NOT_FOUND, 404);
  const ext = extOf(filename);
  if (!isAllowedExtension(ext)) return err(c, TYPE_NOT_ALLOWED, 415);

  // 3. The first bytes: enough to match the signature.
  const stream = c.req.raw.body;
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
      : refuse(sniffed.reason === "type_not_allowed" ? TYPE_NOT_ALLOWED : TYPE_MISMATCH, 415);

  // 4. Into R2: the bytes already read, then the rest of the body, through a stream that must carry exactly `len` bytes.
  const id = uuidv7();
  const key = fileKey(target.client_id, id);
  reader.releaseLock();
  const fixed = new FixedLengthStream(len);
  const stored = c.env.FILES.put(key, fixed.readable, {
    sha256: sha,
    httpMetadata: { contentType: sniffed.mime },
  }).then(
    () => null,
    (e: unknown) => e ?? new Error("put failed"),
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
  const putError = await stored;
  if (putError || feedError) {
    await dropObject(c.env, key, "upload failed");
    const text = String(putError) + String((putError as Error | null)?.cause ?? "");
    if (/checksum|10037/i.test(text)) return err(c, CHECKSUM, 400);
    // The stream refusing a body of the wrong size is the client's fault (a length that lies), not a server error.
    if (feedError || /FixedLengthStream|too many bytes|expected bytes/i.test(text))
      return err(c, LENGTH_MISMATCH, 400);
    throw putError;
  }

  // 5. The row, its audit entry and the access row: one batch. If it does not happen, the object goes again.
  const t = Date.now();
  const from =
    s.kind === "project"
      ? "SELECT ?1, p.client_id, p.id, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9 FROM projects p WHERE p.id = ?2"
      : "SELECT ?1, c.id, NULL, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9 FROM clients c WHERE c.id = ?2";
  let done: boolean;
  try {
    done = await mutate(c, {
      main: c.env.DB.prepare(
        `INSERT INTO files (id, client_id, project_id, r2_key, filename, mime, size, sha256, shared, uploaded_by, created_at) ${from}`,
      ).bind(id, s.id, key, filename, sniffed.mime, len, sha, user.id, t),
      action: "file.upload",
      entityType: "file",
      entityId: id,
      summary: {
        fileId: id,
        clientId: target.client_id,
        ...(s.kind === "project" ? { projectId: s.id } : {}),
        size: len,
        mime: sniffed.mime,
      },
      status: 201,
    });
  } catch (e) {
    await dropObject(c.env, key, "row not written");
    throw e;
  }
  if (!done) {
    await dropObject(c.env, key, "row not written");
    return err(c, NOT_FOUND, 404);
  }
  return c.json({ id, filename, mime: sniffed.mime, size: len, sha256: sha, createdAt: t }, 201);
}

export const files = new Hono<AppEnv>()
  .patch("/:id", param(idParam), body(patchFile), async (c) => {
    const { id } = c.req.valid("param");
    const { shared } = c.req.valid("json");
    const row = await c.env.DB.prepare("SELECT client_id, project_id, shared FROM files WHERE id = ?1")
      .bind(id)
      .first<{ client_id: string; project_id: string | null; shared: number }>();
    if (!row) return err(c, NOT_FOUND, 404);
    if ((row.shared === 1) === shared) return c.json({ ok: true, changed: false, shared });
    const done = await mutate(c, {
      main: c.env.DB.prepare("UPDATE files SET shared = ?2 WHERE id = ?1 AND shared <> ?2").bind(
        id,
        shared ? 1 : 0,
      ),
      action: "file.share",
      entityType: "file",
      entityId: id,
      summary: {
        fileId: id,
        ...(row.project_id ? { projectId: row.project_id } : { clientId: row.client_id }),
        shared,
      },
    });
    return done ? c.json({ ok: true, changed: true, shared }) : c.json({ ok: true, changed: false, shared });
  })

  // The row goes first (with its audit entry, one batch); the object after it. A failed R2 delete leaves an orphan object, never a
  // row that points at nothing, and its key is logged for the M7.4 clean-up.
  .delete("/:id", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const row = await c.env.DB.prepare("SELECT r2_key, client_id, project_id FROM files WHERE id = ?1")
      .bind(id)
      .first<{ r2_key: string; client_id: string; project_id: string | null }>();
    if (!row) return err(c, NOT_FOUND, 404);
    const done = await mutate(c, {
      main: c.env.DB.prepare("DELETE FROM files WHERE id = ?1").bind(id),
      action: "file.delete",
      entityType: "file",
      entityId: id,
      summary: {
        fileId: id,
        ...(row.project_id ? { projectId: row.project_id } : { clientId: row.client_id }),
      },
    });
    if (!done) return err(c, NOT_FOUND, 404);
    c.executionCtx.waitUntil(dropObject(c.env, row.r2_key, "file deleted"));
    return c.json({ ok: true });
  })

  // Streamed through the session check: an attachment, never rendered by the browser, never cached, never sniffed.
  .get("/:id/download", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const row = await c.env.DB.prepare("SELECT r2_key, filename, mime, size FROM files WHERE id = ?1")
      .bind(id)
      .first<{ r2_key: string; filename: string; mime: string; size: number }>();
    if (!row) return err(c, NOT_FOUND, 404);
    const obj = await c.env.FILES.get(row.r2_key);
    if (!obj) {
      console.error(JSON.stringify({ level: "error", message: "r2 object missing", key: row.r2_key }));
      return err(c, NOT_FOUND, 404);
    }
    return new Response(obj.body, {
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(obj.size),
        "Content-Disposition": contentDisposition(row.filename),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "no-store",
      },
    });
  });
