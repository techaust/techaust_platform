// Files shared with the client (M7.1; POR-04, POR-08, ADM-PRJ-04; run file C, L5): `GET /files?project=&after=&limit=` (the list, never an R2 key) and
// `GET /files/:id/download`. A download reads the file again through `SHARED_FILE_SQL` bound with the session's client (`client_id = ?1 AND shared = 1`), so
// another organisation's file, an unshared one, or one unshared between the list and the click is the plain 404. The object is streamed from the private
// `FILES` bucket through this session-checked Worker (never a signed URL, lead 2026-10-25): an attachment, never rendered, never cached, never sniffed. A
// missing object is a 404 and one error line (an incident: the row says the file exists). One access row per download, no audit row (L5).
import { contentDisposition } from "@techaust/core/file-types";
import { SHARED_FILE_SQL, sharedFilesFor, sharedFilesForProject } from "@techaust/db/portal-shared";
import { Hono } from "hono/tiny";
import { type AppEnv, err, NOT_FOUND } from "./context.ts";
import { bound } from "./offer-core.ts";
import { scope } from "./scope.ts";
import { type FileRow, fileOf, nextOf, sharedPage } from "./shared.ts";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

type DownloadRow = { id: string; r2_key: string; filename: string; mime: string; size: number };

export const files = new Hono<AppEnv>()
  .get("/", async (c) => {
    const r = await sharedPage<FileRow>(c, sharedFilesFor, sharedFilesForProject);
    if (r instanceof Response) return r;
    return c.json({ files: r.rows.map(fileOf), next: nextOf(r.rows, r.take) });
  })
  .get("/:id/download", async (c) => {
    const s = scope(c);
    const id = c.req.param("id");
    if (!ID.test(id)) return err(c, NOT_FOUND, 404);
    const row = await bound(c.env.DB, SHARED_FILE_SQL, [s.clientId, id]).first<DownloadRow>();
    if (!row) return err(c, NOT_FOUND, 404);
    const object = await c.env.FILES.get(row.r2_key);
    if (!object) {
      // The route pattern and the file's opaque id only (never its name, the key or anything about the person).
      console.error(
        JSON.stringify({
          level: "error",
          route: c.var.route?.path ?? "other",
          message: "shared file missing in storage",
          rid: c.var.rid,
          file: row.id,
        }),
      );
      return err(c, NOT_FOUND, 404);
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(object.size),
        "Content-Disposition": contentDisposition(row.filename),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
