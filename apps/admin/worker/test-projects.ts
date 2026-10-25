// Fixtures of the projects, notes and files tests (M3.4): rows written straight to the test database, byte builders for uploads, and
// the upload request. Project codes use `PRJ-T####` so the `PRJ-####` sequence the API hands out is not disturbed.
import { env } from "cloudflare:workers";
import { fileKey } from "@techaust/core/file-types";
import { uuidv7 } from "@techaust/core/ids";
import { insert } from "./test-clients.ts";
import { ORIGIN, send } from "./test-helpers.ts";

let seq = 0;

export async function mkProject(clientId: string, over: Record<string, unknown> = {}) {
  const id = uuidv7();
  const n = ++seq;
  const updatedAt = Date.now() - 1000;
  await insert("projects", {
    id,
    code: `PRJ-T${String(n).padStart(4, "0")}`,
    client_id: clientId,
    name: `Project ${n}`,
    currency: "INR",
    created_at: updatedAt,
    updated_at: updatedAt,
    ...over,
  });
  return { id, updatedAt: (over.updated_at as number | undefined) ?? updatedAt };
}

export async function mkMilestone(projectId: string, over: Record<string, unknown> = {}) {
  const id = uuidv7();
  const updatedAt = Date.now() - 1000;
  await insert("milestones", {
    id,
    project_id: projectId,
    position: ++seq + 1000,
    title: "Milestone",
    amount_minor: 100_00,
    created_at: updatedAt,
    updated_at: updatedAt,
    ...over,
  });
  return { id, updatedAt: (over.updated_at as number | undefined) ?? updatedAt };
}

export async function mkNote(clientId: string, over: Record<string, unknown> = {}) {
  const id = uuidv7();
  const updatedAt = Date.now() - 1000;
  await insert("notes", {
    id,
    client_id: clientId,
    body_md: `Note ${++seq}`,
    created_at: updatedAt,
    updated_at: updatedAt,
    ...over,
  });
  return { id, updatedAt: (over.updated_at as number | undefined) ?? updatedAt };
}

// ---- bytes -------------------------------------------------------------------------------------------------------------

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
export const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);
export const ZIP_BYTES = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 8, 0]);
export const text = (s: string) => new TextEncoder().encode(s);
/** A PDF of exactly `n` bytes (the signature, then padding). */
export function pdfOfSize(n: number): Uint8Array {
  const out = new Uint8Array(n);
  out.set(PDF_BYTES.subarray(0, Math.min(PDF_BYTES.length, n)));
  for (let i = PDF_BYTES.length; i < n; i++) out[i] = 0x20 + (i % 90);
  return out;
}
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type UploadOpts = {
  cookie: string | undefined;
  name?: string | null;
  sha?: string | null;
  /** Override the Content-Length the request declares (a string, to send junk); null: send none (the body is then a stream). */
  length?: string | null;
  headers?: Record<string, string>;
  /** Send this body instead of `bytes` (the declared length still comes from `bytes`): for a body that lies about its size. */
  body?: Uint8Array;
  env?: Env;
};

/** POST a file to `/projects/:id/files` or `/clients/:id/files` the way the SPA does. */
export async function upload(path: string, bytes: Uint8Array, o: UploadOpts) {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    "Content-Type": "application/octet-stream",
    ...(o.cookie ? { Cookie: o.cookie } : {}),
    ...o.headers,
  };
  if (o.name !== null) headers["X-File-Name"] = encodeURIComponent(o.name ?? "report.pdf");
  if (o.sha !== null) headers["X-File-Sha256"] = o.sha ?? (await sha256Hex(bytes));
  if (o.length !== null) headers["Content-Length"] = o.length ?? String(bytes.byteLength);
  const sent = o.body ?? bytes;
  const body =
    o.length === null
      ? new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(sent);
            c.close();
          },
        })
      : sent;
  return send(`${ORIGIN}/api/v1${path}`, { method: "POST", headers, body }, o.env ?? env);
}

/** A stored file written straight to the database and to R2 (as an upload would leave it). */
export async function mkFile(
  clientId: string,
  over: { projectId?: string; shared?: boolean; filename?: string; body?: Uint8Array; mime?: string } = {},
) {
  const id = uuidv7();
  const body = over.body ?? PDF_BYTES;
  const key = fileKey(clientId, id);
  await env.FILES.put(key, body);
  await insert("files", {
    id,
    client_id: clientId,
    project_id: over.projectId ?? null,
    r2_key: key,
    filename: over.filename ?? "report.pdf",
    mime: over.mime ?? "application/pdf",
    size: body.byteLength,
    sha256: await sha256Hex(body),
    shared: over.shared ? 1 : 0,
    created_at: Date.now() - 1000,
  });
  return { id, key };
}

export const objectExists = async (key: string) => (await env.FILES.head(key)) !== null;
