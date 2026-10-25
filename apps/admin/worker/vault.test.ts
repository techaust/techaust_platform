// The file vault [ADM-PRJ-04]: uploads checked by their bytes, streamed into private R2, downloads streamed back through the session,
// hard delete, the M3.3 erase interplay, the portal-ready queries, and the CSRF/body-limit regressions around the upload exception.
import { env } from "cloudflare:workers";
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { sharedFileFor, sharedFilesFor, sharedNotesFor } from "@techaust/db/portal-shared";
import { describe, expect, it, vi } from "vitest";
import { fileListSql } from "./files.ts";
import { mkClient, mkContact } from "./test-clients.ts";
import { bodyOf, call, countOf, ORIGIN, one, rows, send, sessionFor, withEnv } from "./test-helpers.ts";
import {
  mkFile,
  mkNote,
  mkProject,
  objectExists,
  PDF_BYTES,
  PNG_BYTES,
  pdfOfSize,
  sha256Hex,
  text,
  upload,
  ZIP_BYTES,
} from "./test-projects.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)) as { error: { code: string } }).error.code;
const fileCount = () => countOf("files");
const objectCount = async () => (await env.FILES.list()).objects.length;

/** Everything an upload that failed must NOT have left behind. */
async function expectNothingStored(run: () => Promise<Response>, status: number, errCode: string) {
  const files = await fileCount();
  const objects = await objectCount();
  const audits = await countOf("audit_log", "action = 'file.upload'");
  const res = await run();
  expect(res.status, await res.clone().text()).toBe(status);
  expect(await code(res)).toBe(errCode);
  expect(await fileCount()).toBe(files);
  expect(await objectCount()).toBe(objects);
  expect(await countOf("audit_log", "action = 'file.upload'")).toBe(audits);
}

// ---------------------------------------------------------------------------------------------------------------
describe("uploads [ADM-PRJ-04]", () => {
  it("stores a PDF for a project: the object under files/<client>/<id>, our MIME type, the row, one audit row, then downloads it back", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const p = await mkProject(clientId);
    const res = await upload(`/projects/${p.id}/files`, PDF_BYTES, {
      cookie: o.cookie,
      name: "Quote v2.pdf",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const made = await json(res);
    const row = await one<J>("SELECT * FROM files WHERE id = ?", made.id);
    expect(row).toMatchObject({
      client_id: clientId,
      project_id: p.id,
      r2_key: `files/${clientId}/${made.id}`,
      filename: "Quote v2.pdf",
      mime: "application/pdf",
      size: PDF_BYTES.byteLength,
      sha256: await sha256Hex(PDF_BYTES),
      shared: 0,
      uploaded_by: o.id,
    });
    const obj = await env.FILES.get(row?.r2_key);
    expect(new Uint8Array((await obj?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(PDF_BYTES);
    expect(obj?.httpMetadata?.contentType).toBe("application/pdf");
    const audit = await rows<{ action: string; entity_type: string; summary: string }>(
      "SELECT action, entity_type, summary FROM audit_log WHERE entity_id = ?",
      made.id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "file.upload", entity_type: "file" });
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({
      fileId: made.id,
      clientId,
      projectId: p.id,
      size: PDF_BYTES.byteLength,
      mime: "application/pdf",
    });
    const dl = await call(`/files/${made.id}/download`, { cookie: o.cookie });
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it("stores a file on the client itself; a project's client is the file's client", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const res = await upload(`/clients/${clientId}/files`, PNG_BYTES, { cookie: o.cookie, name: "logo.png" });
    expect(res.status).toBe(201);
    expect(
      await one("SELECT client_id, project_id, mime FROM files WHERE id = ?", (await json(res)).id),
    ).toEqual({
      client_id: clientId,
      project_id: null,
      mime: "image/png",
    });
  });

  it("refuses bytes that are not what the name says, by signature", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const up = (bytes: Uint8Array, name: string) => () =>
      upload(`/clients/${clientId}/files`, bytes, { cookie: o.cookie, name });
    await expectNothingStored(up(PNG_BYTES, "invoice.pdf"), 415, "file_type_mismatch");
    await expectNothingStored(up(PDF_BYTES, "photo.png"), 415, "file_type_mismatch");
    await expectNothingStored(
      up(text("<html><script>alert(1)</script></html>"), "pic.png"),
      415,
      "file_type_mismatch",
    );
    await expectNothingStored(up(text("<svg onload=alert(1)>"), "pic.jpg"), 415, "file_type_mismatch");
    await expectNothingStored(up(Uint8Array.from([0x61, 0, 0x62]), "notes.txt"), 415, "file_type_mismatch");
    await expectNothingStored(
      up(Uint8Array.from([0x61, 0xff, 0xfe, 0x62]), "data.csv"),
      415,
      "file_type_mismatch",
    );
    await expectNothingStored(up(PDF_BYTES, "notes.txt"), 415, "file_type_mismatch");
    await expectNothingStored(up(text("plain text"), "archive.zip"), 415, "file_type_mismatch");
    await expectNothingStored(up(ZIP_BYTES, "page.docx.png"), 415, "file_type_mismatch");
  });

  it("refuses types that are not on the allow-list, whatever their bytes", async () => {
    const o = await owner();
    const clientId = await mkClient();
    for (const name of [
      "logo.svg",
      "page.html",
      "setup.exe",
      "run.js",
      "noext",
      "x.php",
      "a.pdf.exe",
      "photo.gif",
      "doc.doc",
    ])
      await expectNothingStored(
        () => upload(`/clients/${clientId}/files`, PDF_BYTES, { cookie: o.cookie, name }),
        415,
        "file_type_not_allowed",
      );
  });

  it("accepts docx, xlsx and zip on the container signature, and text as UTF-8", async () => {
    const o = await owner();
    const clientId = await mkClient();
    for (const [name, bytes, mime] of [
      ["a.zip", ZIP_BYTES, "application/zip"],
      ["b.docx", ZIP_BYTES, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["c.xlsx", ZIP_BYTES, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["d.csv", text("name,amount\nRaj,₹100\n"), "text/csv"],
      ["e.txt", text("héllo wörld"), "text/plain"],
      ["f.JPEG", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]), "image/jpeg"],
      ["g.webp", Uint8Array.from([...text("RIFF"), 1, 2, 3, 4, ...text("WEBPVP8 ")]), "image/webp"],
    ] as const) {
      const res = await upload(`/clients/${clientId}/files`, bytes, { cookie: o.cookie, name });
      expect(res.status, name).toBe(201);
      expect(await one("SELECT mime FROM files WHERE id = ?", (await json(res)).id), name).toEqual({ mime });
    }
    // "docx bytes named .zip" is a zip: the same container, typed by the extension
    expect(await countOf("files", "client_id = ?", clientId)).toBe(7);
  });

  it("the stored MIME type is ours, never the browser's", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const res = await upload(`/clients/${clientId}/files`, PDF_BYTES, {
      cookie: o.cookie,
      headers: { "X-File-Type": "text/html" },
    });
    expect(await one("SELECT mime FROM files WHERE id = ?", (await json(res)).id)).toEqual({
      mime: "application/pdf",
    });
  });

  it("refuses an empty file, a missing length (411) and a length over 25 MiB before reading a byte (413)", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const path = `/clients/${clientId}/files`;
    await expectNothingStored(() => upload(path, new Uint8Array(0), { cookie: o.cookie }), 400, "empty_file");
    await expectNothingStored(
      () => upload(path, PDF_BYTES, { cookie: o.cookie, length: null }),
      411,
      "length_required",
    );
    await expectNothingStored(
      () => upload(path, PDF_BYTES, { cookie: o.cookie, length: "26214401" }),
      413,
      "file_too_large",
    );
    await expectNothingStored(
      () => upload(path, PDF_BYTES, { cookie: o.cookie, length: "99999999999" }),
      413,
      "file_too_large",
    );
    // nothing is read: a body that fails if anybody pulls from it
    let pulls = 0;
    const res = await send(
      `${ORIGIN}/api/v1${path}`,
      {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: o.cookie,
          "Content-Type": "application/octet-stream",
          "Content-Length": "26214401",
          "X-File-Name": "big.pdf",
          "X-File-Sha256": "a".repeat(64),
        },
        body: new ReadableStream({
          pull(c) {
            pulls++;
            c.enqueue(new Uint8Array(1024));
          },
        }),
      },
      env,
    );
    expect(res.status).toBe(413);
    expect(pulls).toBeLessThanOrEqual(1); // the runtime may prime one chunk; the handler never reads
    expect(await code(res)).toBe("file_too_large");
  });

  it("refuses a junk length, a missing name or checksum, and a name that is not valid percent-encoding", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const path = `/clients/${clientId}/files`;
    for (const opts of [
      { length: "abc" },
      { length: "-5" },
      { name: null },
      { sha: null },
      { sha: "xyz" },
      { sha: "a".repeat(63) },
    ])
      expect(
        (await upload(path, PDF_BYTES, { cookie: o.cookie, ...opts })).status,
        JSON.stringify(opts),
      ).toBe(400);
    expect(
      (
        await upload(path, PDF_BYTES, {
          cookie: o.cookie,
          headers: { "X-File-Name": "%E0%A4%A" },
          name: null,
        })
      ).status,
    ).toBe(400);
    expect(await countOf("files", "client_id = ?", clientId)).toBe(0);
  });

  it("a body that is longer or shorter than its declared length stores nothing", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const path = `/clients/${clientId}/files`;
    const big = pdfOfSize(2000);
    const sha = await sha256Hex(big);
    // declared 1000, sent 2000
    await expectNothingStored(
      () => upload(path, big.subarray(0, 1000), { cookie: o.cookie, body: big, sha }),
      400,
      "length_mismatch",
    );
    // declared 2000, sent 1000
    await expectNothingStored(
      () => upload(path, big, { cookie: o.cookie, body: big.subarray(0, 1000), sha }),
      400,
      "length_mismatch",
    );
    // shorter than the sniff window
    await expectNothingStored(
      () => upload(path, pdfOfSize(300), { cookie: o.cookie, body: pdfOfSize(100) }),
      400,
      "length_mismatch",
    );
    await expectNothingStored(
      () => upload(path, pdfOfSize(100), { cookie: o.cookie, body: pdfOfSize(300) }),
      400,
      "length_mismatch",
    );
  });

  it("a checksum that does not match what arrived stores nothing", async () => {
    const o = await owner();
    const clientId = await mkClient();
    await expectNothingStored(
      () => upload(`/clients/${clientId}/files`, PDF_BYTES, { cookie: o.cookie, sha: "0".repeat(64) }),
      400,
      "checksum_mismatch",
    );
    // and a large body (past the sniff window) is checked too
    const big = pdfOfSize(200_000);
    await expectNothingStored(
      () => upload(`/clients/${clientId}/files`, big, { cookie: o.cookie, sha: "1".repeat(64) }),
      400,
      "checksum_mismatch",
    );
  });

  it("a missing project or client is a 404 and stores nothing", async () => {
    const o = await owner();
    await expectNothingStored(
      () => upload("/projects/no-such/files", PDF_BYTES, { cookie: o.cookie }),
      404,
      "not_found",
    );
    await expectNothingStored(
      () => upload("/clients/no-such/files", PDF_BYTES, { cookie: o.cookie }),
      404,
      "not_found",
    );
  });

  it("if the row cannot be written the object is removed again", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const objects = await objectCount();
    const broken = withEnv(env, {
      DB: new Proxy(env.DB, {
        get: (t, k) =>
          k === "batch"
            ? async () => {
                throw new Error("D1 down");
              }
            : typeof Reflect.get(t, k) === "function"
              ? (Reflect.get(t, k) as (...a: unknown[]) => unknown).bind(t)
              : Reflect.get(t, k),
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await upload(`/clients/${clientId}/files`, PDF_BYTES, { cookie: o.cookie, env: broken });
    expect(res.status).toBe(500);
    expect(await objectCount()).toBe(objects);
    expect(await countOf("files", "client_id = ?", clientId)).toBe(0);
    vi.restoreAllMocks();
  });

  it("filenames: the path, bidi and control characters are dropped, device names and long names are made safe", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const name = async (n: string) => {
      const res = await upload(`/clients/${clientId}/files`, PDF_BYTES, { cookie: o.cookie, name: n });
      expect(res.status, n).toBe(201);
      const row = await one<J>("SELECT filename, r2_key FROM files WHERE id = ?", (await json(res)).id);
      expect(row?.r2_key).toMatch(new RegExp(`^files/${clientId}/[0-9a-f-]{36}$`)); // never the filename
      return row?.filename as string;
    };
    expect(await name("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(await name("C:\\Users\\x\\y.pdf")).toBe("y.pdf");
    expect(await name("CON.pdf")).toBe("_CON.pdf");
    expect(await name("a\u0001b\u0007.pdf")).toBe("ab.pdf");
    expect(await name(`${"é".repeat(300)}.pdf`)).toMatch(/^é{116}\.pdf$/);
    expect(await name(".pdf")).toBe("file.pdf");
    // a right-to-left override cannot make an executable look like a document: the real extension is checked
    await expectNothingStored(
      () =>
        upload(`/clients/${clientId}/files`, PDF_BYTES, { cookie: o.cookie, name: "invoice\u202efdp.exe" }),
      415,
      "file_type_not_allowed",
    );
  });

  it("uploads and downloads of exactly 25 MiB work (and report their time), one byte more does not", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const size = 25 * 1024 * 1024;
    const big = pdfOfSize(size);
    const t0 = performance.now();
    const res = await upload(`/clients/${clientId}/files`, big, { cookie: o.cookie, name: "big.pdf" });
    const upMs = performance.now() - t0;
    expect(res.status, await res.clone().text()).toBe(201);
    const made = await json(res);
    expect(made.size).toBe(size);
    const t1 = performance.now();
    const dl = await call(`/files/${made.id}/download`, { cookie: o.cookie });
    const buf = new Uint8Array(await dl.arrayBuffer());
    const downMs = performance.now() - t1;
    expect(buf.byteLength).toBe(size);
    expect(await sha256Hex(buf)).toBe(made.sha256);
    console.info(
      `[local proxy, wall time, upper bound] 25 MiB upload ${Math.round(upMs)} ms, download ${Math.round(downMs)} ms`,
    );
    await expectNothingStored(
      () => upload(`/clients/${clientId}/files`, pdfOfSize(size + 1), { cookie: o.cookie }),
      413,
      "file_too_large",
    );
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------------
describe("downloads [ADM-PRJ-04]", () => {
  it("stream through the session as a never-cached, never-sniffed, sandboxed attachment, with both filename forms", async () => {
    const s = await sessionFor("sales"); // Sales can download
    const clientId = await mkClient();
    const f = await mkFile(clientId, { filename: "Prüfung ₹ 'v2' (final).pdf", body: PDF_BYTES });
    const res = await call(`/files/${f.id}/download`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="Pr_fung _ 'v2' (final).pdf"; filename*=UTF-8''Pr%C3%BCfung%20%E2%82%B9%20%27v2%27%20%28final%29.pdf`,
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-length")).toBe(String(PDF_BYTES.byteLength));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF_BYTES);
    // a download is an access-log row, not an audit row
    const access = await rows<{ route: string; status: number; actor_id: string }>(
      "SELECT route, status, actor_id FROM access_log WHERE route = '/api/v1/files/:id/download' AND actor_id = ?",
      s.id,
    );
    expect(access).toEqual([{ route: "/api/v1/files/:id/download", status: 200, actor_id: s.id }]);
    expect(await countOf("audit_log", "entity_id = ?", f.id)).toBe(0);
  });

  it("need a session and the right role; an unknown file or a lost object is a 404", async () => {
    const clientId = await mkClient();
    const f = await mkFile(clientId);
    expect((await call(`/files/${f.id}/download`)).status).toBe(401);
    expect(
      (await call(`/files/${f.id}/download`, { cookie: (await sessionFor("accountant")).cookie })).status,
    ).toBe(403);
    const o = await owner();
    expect((await call("/files/no-such/download", { cookie: o.cookie })).status).toBe(404);
    await env.FILES.delete(f.key);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call(`/files/${f.id}/download`, { cookie: o.cookie })).status).toBe(404);
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("share, list and delete [ADM-PRJ-04]", () => {
  it("shares and unshares with one audit row each; repeating the same value changes nothing", async () => {
    const o = await owner();
    const f = await mkFile(await mkClient());
    const patch = (shared: boolean) =>
      call(`/files/${f.id}`, { method: "PATCH", cookie: o.cookie, body: { shared } });
    expect(await json(await patch(true))).toMatchObject({ changed: true, shared: true });
    expect(await json(await patch(true))).toMatchObject({ changed: false });
    expect((await patch(false)).status).toBe(200);
    expect(await countOf("audit_log", "action = 'file.share' AND entity_id = ?", f.id)).toBe(2);
    expect(
      (await call("/files/no-such", { method: "PATCH", cookie: o.cookie, body: { shared: true } })).status,
    ).toBe(404);
    expect(
      (await call(`/files/${f.id}`, { method: "PATCH", cookie: o.cookie, body: { shared: "yes" } })).status,
    ).toBe(400);
    expect(
      (
        await call(`/files/${f.id}`, {
          method: "PATCH",
          cookie: o.cookie,
          body: { shared: true, filename: "x" },
        })
      ).status,
    ).toBe(400);
  });

  it("lists a project's and a client's files newest first in pages, never exposing the R2 key", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const p = await mkProject(clientId);
    for (let i = 0; i < 27; i++) await mkFile(clientId, i < 26 ? { projectId: p.id } : {});
    const first = await json(await call(`/projects/${p.id}/files`, { cookie: o.cookie }));
    expect(first.files).toHaveLength(25);
    expect(first.next).toBeTruthy();
    expect(JSON.stringify(first)).not.toMatch(/r2|files\//);
    const second = await json(
      await call(`/projects/${p.id}/files?after=${first.next}`, { cookie: o.cookie }),
    );
    expect(second.files).toHaveLength(1);
    const all = await json(await call(`/clients/${clientId}/files?limit=50`, { cookie: o.cookie }));
    expect(all.files).toHaveLength(27);
    expect((await call("/projects/no-such/files", { cookie: o.cookie })).status).toBe(404);
    expect((await call("/clients/no-such/files", { cookie: o.cookie })).status).toBe(404);
    expect((await call(`/clients/${clientId}/files?after=junk`, { cookie: o.cookie })).status).toBe(400);
  });

  it("delete removes the row and the object; the audit row names the file id, not its name", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const f = await mkFile(clientId, { filename: "ZZ-SECRET-FILENAME.pdf" });
    expect((await call(`/files/${f.id}`, { method: "DELETE", cookie: o.cookie })).status).toBe(200);
    expect(await countOf("files", "id = ?", f.id)).toBe(0);
    expect(await objectExists(f.key)).toBe(false);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'file.delete' AND entity_id = ?",
      f.id,
    );
    expect(audit?.summary).not.toMatch(/ZZ-SECRET/);
    expect((await call(`/files/${f.id}`, { method: "DELETE", cookie: o.cookie })).status).toBe(404);
  });

  it("a failed object delete leaves no row, an orphan whose KEY is logged and no filename", async () => {
    const o = await owner();
    const f = await mkFile(await mkClient(), { filename: "ZZ-SECRET-FILENAME.pdf" });
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
    const failing = withEnv(env, {
      FILES: new Proxy(env.FILES, {
        get: (t, k) =>
          k === "delete"
            ? async () => {
                throw new Error("R2 down ZZ-SECRET-FILENAME.pdf");
              }
            : ((Reflect.get(t, k) as { bind?: (x: unknown) => unknown }).bind?.(t) ?? Reflect.get(t, k)),
      }),
    });
    const res = await call(`/files/${f.id}`, { method: "DELETE", cookie: o.cookie }, failing);
    expect(res.status).toBe(200);
    vi.restoreAllMocks();
    expect(await countOf("files", "id = ?", f.id)).toBe(0);
    expect(await objectExists(f.key)).toBe(true); // the orphan
    expect(logs.join("\n")).toContain(f.key);
    expect(logs.join("\n")).not.toMatch(/ZZ-SECRET/);
  });

  it("writes need projects.write: Sales and the Accountant cannot upload, share or delete", async () => {
    const f = await mkFile(await mkClient());
    for (const role of ["sales", "accountant"] as const) {
      const s = await sessionFor(role);
      expect(
        (await call(`/files/${f.id}`, { method: "PATCH", cookie: s.cookie, body: { shared: true } })).status,
      ).toBe(403);
      expect((await call(`/files/${f.id}`, { method: "DELETE", cookie: s.cookie })).status).toBe(403);
      expect((await upload("/clients/x/files", PDF_BYTES, { cookie: s.cookie })).status).toBe(403);
    }
    expect(await countOf("files", "id = ?", f.id)).toBe(1);
    expect(await objectExists(f.key)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the upload exception stays narrow [05 §7.1]", () => {
  it("every other route is still JSON-only (415) and 16 KB at most (413)", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const asText = await send(
      `${ORIGIN}/api/v1/projects`,
      {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: o.cookie, "Content-Type": "application/octet-stream" },
        body: "{}",
      },
      env,
    );
    expect(asText.status).toBe(415);
    const big = await call("/projects", {
      cookie: o.cookie,
      body: { clientId, name: "x".repeat(17 * 1024) },
    });
    expect(big.status).toBe(413);
    const multipart = await send(
      `${ORIGIN}/api/v1/projects`,
      {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: o.cookie, "Content-Type": "multipart/form-data; boundary=x" },
        body: "--x--",
      },
      env,
    );
    expect(multipart.status).toBe(415);
  });

  it("an upload route refuses JSON, multipart and a cross-site origin, and stores nothing", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const base = {
      Cookie: o.cookie,
      "X-File-Name": "a.pdf",
      "X-File-Sha256": await sha256Hex(PDF_BYTES),
      "Content-Length": String(PDF_BYTES.byteLength),
    };
    const post = (headers: Record<string, string>) =>
      send(
        `${ORIGIN}/api/v1/clients/${clientId}/files`,
        { method: "POST", headers: { ...base, ...headers }, body: PDF_BYTES },
        env,
      );
    expect((await post({ Origin: ORIGIN, "Content-Type": "application/json" })).status).toBe(415);
    expect((await post({ Origin: ORIGIN, "Content-Type": "multipart/form-data; boundary=x" })).status).toBe(
      415,
    );
    expect((await post({ Origin: ORIGIN })).status).toBe(415); // a body with no type
    expect(
      (await post({ Origin: "https://evil.example", "Content-Type": "application/octet-stream" })).status,
    ).toBe(403);
    expect(
      (await post({ "Sec-Fetch-Site": "cross-site", "Content-Type": "application/octet-stream" })).status,
    ).toBe(403);
    expect(await countOf("files", "client_id = ?", clientId)).toBe(0);
    expect((await post({ Origin: ORIGIN, "Content-Type": "application/octet-stream" })).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("a client's notes and files go with its last contact [owner 2026-10-25, VERIFY WITH CA/LEGAL]", () => {
  const erase = (cookie: string, id: string, mode: string) =>
    call(`/contacts/${id}/erase`, { cookie, body: { mode, reason: "requested" } });
  const settle = async (keys: string[]) => {
    for (let i = 0; i < 50; i++) {
      if (!(await Promise.all(keys.map(objectExists))).some(Boolean)) return;
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  it("an individual client's last contact: notes and files rows and R2 objects are deleted, in both modes; the client record is anonymised", async () => {
    const o = await owner();
    for (const mode of ["erase", "anonymise"] as const) {
      const ind = await mkClient({
        type: "individual",
        display_name: "Pat Private",
        legal_name: "Pat Private",
      });
      const other = await mkClient({ type: "individual" });
      const a = await mkContact(ind);
      const b = await mkContact(ind);
      const p = await mkProject(ind);
      await mkNote(ind);
      await mkNote(ind, { project_id: p.id, visibility: "shared" });
      const f1 = await mkFile(ind);
      const f2 = await mkFile(ind, { projectId: p.id, shared: true });
      const keep = await mkFile(other);
      await mkNote(other);
      // not the last live contact: nothing is deleted yet
      expect((await erase(o.cookie, a.id, mode)).status).toBe(200);
      expect(await countOf("notes", "client_id = ?", ind)).toBe(2);
      expect(await countOf("files", "client_id = ?", ind)).toBe(2);
      expect(await objectExists(f1.key)).toBe(true);
      // the last one
      expect((await erase(o.cookie, b.id, mode)).status).toBe(200);
      await settle([f1.key, f2.key]);
      expect(await countOf("notes", "client_id = ?", ind), mode).toBe(0);
      expect(await countOf("files", "client_id = ?", ind), mode).toBe(0);
      expect(await objectExists(f1.key)).toBe(false);
      expect(await objectExists(f2.key)).toBe(false);
      expect(await one("SELECT display_name FROM clients WHERE id = ?", ind)).toEqual({
        display_name: ANONYMISED_CLIENT,
      });
      // another client's are untouched, and the project row (no personal text in a code) stays
      expect(await countOf("notes", "client_id = ?", other)).toBe(1);
      expect(await countOf("files", "client_id = ?", other)).toBe(1);
      expect(await objectExists(keep.key)).toBe(true);
      expect(await countOf("projects", "id = ?", p.id)).toBe(1);
    }
  });

  it("a business client's notes and files are never touched", async () => {
    const o = await owner();
    const biz = await mkClient({ type: "business" });
    const c = await mkContact(biz);
    await mkNote(biz);
    const f = await mkFile(biz);
    expect((await erase(o.cookie, c.id, "erase")).status).toBe(200);
    expect(await countOf("notes", "client_id = ?", biz)).toBe(1);
    expect(await countOf("files", "client_id = ?", biz)).toBe(1);
    expect(await objectExists(f.key)).toBe(true);
  });

  it("a held client or contact writes nothing: no rows deleted, no objects deleted", async () => {
    const o = await owner();
    const held = await mkClient({ type: "individual", legal_hold: 1 });
    const c = await mkContact(held);
    await mkNote(held);
    const f = await mkFile(held);
    const res = await erase(o.cookie, c.id, "anonymise");
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("legal_hold");
    expect(await countOf("notes", "client_id = ?", held)).toBe(1);
    expect(await countOf("files", "client_id = ?", held)).toBe(1);
    expect(await objectExists(f.key)).toBe(true);
  });

  it("if deleting an object fails the rows are still gone and the keys are logged without a filename", async () => {
    const o = await owner();
    const ind = await mkClient({ type: "individual" });
    const c = await mkContact(ind);
    const f = await mkFile(ind, { filename: "ZZ-SECRET-FILENAME.pdf" });
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
    const failing = withEnv(env, {
      FILES: new Proxy(env.FILES, {
        get: (t, k) =>
          k === "delete"
            ? async () => {
                throw new Error("R2 down");
              }
            : ((Reflect.get(t, k) as { bind?: (x: unknown) => unknown }).bind?.(t) ?? Reflect.get(t, k)),
      }),
    });
    const res = await call(
      `/contacts/${c.id}/erase`,
      { cookie: o.cookie, body: { mode: "erase", reason: "requested" } },
      failing,
    );
    expect(res.status).toBe(200);
    vi.restoreAllMocks();
    expect(await countOf("files", "client_id = ?", ind)).toBe(0);
    expect(logs.join("\n")).toContain(f.key);
    expect(logs.join("\n")).not.toMatch(/ZZ-SECRET/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("portal-ready queries: a client sees only its own shared notes and files [ADM-PRJ-03, -04]", () => {
  it("never an internal note, an unshared file, or another client's", async () => {
    const a = await mkClient();
    const b = await mkClient();
    const p = await mkProject(a);
    const shared = await mkNote(a, { visibility: "shared", body_md: "for A" });
    await mkNote(a, { visibility: "internal", body_md: "internal A" });
    await mkNote(a, { project_id: p.id, visibility: "shared", body_md: "project shared A" });
    await mkNote(b, { visibility: "shared", body_md: "for B" });
    const fa = await mkFile(a, { shared: true });
    const hidden = await mkFile(a, { shared: false });
    const fb = await mkFile(b, { shared: true });

    const notes = (await sharedNotesFor(env.DB, a).all<J>()).results;
    expect(notes.map((n) => n.body_md).sort()).toEqual(["for A", "project shared A"]);
    expect(Object.keys(notes[0] ?? {}).sort()).toEqual([
      "body_md",
      "created_at",
      "id",
      "project_id",
      "updated_at",
    ]);
    expect(notes.map((n) => n.id)).toContain(shared.id);
    const files = (await sharedFilesFor(env.DB, a).all<J>()).results;
    expect(files.map((f) => f.id)).toEqual([fa.id]);
    expect(JSON.stringify(files)).not.toContain("r2_key");
    expect((await sharedFilesFor(env.DB, b).all<J>()).results.map((f) => f.id)).toEqual([fb.id]);

    expect((await sharedFileFor(env.DB, a, fa.id).first<J>())?.r2_key).toBe(fa.key);
    expect(await sharedFileFor(env.DB, a, hidden.id).first()).toBeNull(); // not shared
    expect(await sharedFileFor(env.DB, a, fb.id).first()).toBeNull(); // another client's
    expect(await sharedFileFor(env.DB, b, fa.id).first()).toBeNull();
    expect(await sharedFileFor(env.DB, a, "no-such").first()).toBeNull();
  });

  it("pages by cursor, at most 50 a page, and runs on the (client, shared/visibility, created) indexes", async () => {
    const a = await mkClient();
    for (let i = 0; i < 4; i++) await mkNote(a, { visibility: "shared", created_at: 5_000_000 + i });
    const page1 = (await sharedNotesFor(env.DB, a, 3).all<J>()).results;
    expect(page1.map((n) => n.created_at)).toEqual([5_000_003, 5_000_002, 5_000_001]);
    const last = page1.at(-1) as J;
    const page2 = (await sharedNotesFor(env.DB, a, 3, { createdAt: last.created_at, id: last.id }).all<J>())
      .results;
    expect(page2.map((n) => n.created_at)).toEqual([5_000_000]);
    expect((await sharedNotesFor(env.DB, a, 9999).all<J>()).results.length).toBeLessThanOrEqual(50);
    const plan = async (sql: string, ...p: unknown[]) =>
      (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...p)).map((r) => r.detail).join("\n");
    expect(
      await plan(
        "SELECT id FROM notes WHERE client_id = ?1 AND visibility = 'shared' ORDER BY created_at DESC, id DESC LIMIT 25",
        "c",
      ),
    ).toMatch(/notes_client_visibility/);
    expect(
      await plan(
        "SELECT id FROM files WHERE client_id = ?1 AND shared = 1 ORDER BY created_at DESC, id DESC LIMIT 25",
        "c",
      ),
    ).toMatch(/files_client_shared/);
    expect(await plan(fileListSql("client", true, 25), "c", 1, "x")).toMatch(/files_client/);
    expect(await plan(fileListSql("project", false, 25), "c")).toMatch(/files_project/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("audit hygiene for uploads", () => {
  it("a filename and file contents never reach audit_log, access_log or the console", async () => {
    const logs: string[] = [];
    const spy = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    const orig = [console.log, console.error, console.info];
    console.log = spy;
    console.error = spy;
    console.info = spy;
    try {
      const o = await owner();
      const clientId = await mkClient();
      const bytes = text("%PDF-1.7 ZZ-SECRET-CONTENT");
      const res = await upload(`/clients/${clientId}/files`, bytes, {
        cookie: o.cookie,
        name: "ZZ-SECRET-FILENAME.pdf",
      });
      expect(res.status).toBe(201);
      const made = await json(res);
      await call(`/files/${made.id}`, { method: "PATCH", cookie: o.cookie, body: { shared: true } });
      await call(`/files/${made.id}/download`, { cookie: o.cookie });
      await upload(`/clients/${clientId}/files`, bytes, { cookie: o.cookie, name: "ZZ-SECRET-OTHER.exe" });
      await call(`/files/${made.id}`, { method: "DELETE", cookie: o.cookie });
    } finally {
      [console.log, console.error, console.info] = orig as [
        typeof console.log,
        typeof console.error,
        typeof console.info,
      ];
    }
    const dump = JSON.stringify([
      await rows("SELECT * FROM audit_log"),
      await rows("SELECT * FROM access_log"),
      logs,
    ]);
    expect(dump).not.toMatch(/ZZ-SECRET/);
  });
});
