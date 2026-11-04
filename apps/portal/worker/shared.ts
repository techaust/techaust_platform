// Notes shared with the client (M7.1; POR-04, POR-08, ADM-PRJ-03; run file C, L6, L7): `GET /notes?project=&after=&limit=`, and the list helpers the other
// M7.1 lists share (keyset pages of at most 50, newest first, cursor `<created_at>:<id>`). Only notes staff marked `shared`, only the session's organisation's:
// every statement is a `@techaust/db/portal-shared` one bound with the session's client as `?1`. A `project` that is not the organisation's is the plain 404.
// The body is the Markdown as written; the SPA renders it with `parseNoteMarkdown` (FX-3 finding 8) and names the author "TecHaust" (L6: no staff table here).
import { sharedNotesFor, sharedNotesForProject } from "@techaust/db/portal-shared";
import { Hono } from "hono/tiny";
import { type AppEnv, BAD_REQUEST, type Ctx, err, NOT_FOUND } from "./context.ts";
import { bound } from "./offer-core.ts";
import { scope } from "./scope.ts";

/** `limit` (1 to 50) and the cursor from the previous page (`<created_at ms>:<id>`). */
const LIMIT = /^\d{1,2}$/;
const AFTER = /^\d{1,15}:[A-Za-z0-9_-]{1,64}$/;
/** An id the database could hold (a project's, a file's). */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export type ListPage = { take: number; after: { createdAt: number; id: string } | undefined };

/** The list's query string, or null for a malformed one (400). */
export function pageOf(c: Ctx): ListPage | null {
  const rawLimit = c.req.query("limit");
  const rawAfter = c.req.query("after");
  if (rawLimit !== undefined && !LIMIT.test(rawLimit)) return null;
  if (rawAfter !== undefined && !AFTER.test(rawAfter)) return null;
  const take = Math.min(Math.max(rawLimit === undefined ? 50 : Number(rawLimit), 1), 50);
  if (rawAfter === undefined) return { take, after: undefined };
  const at = rawAfter.indexOf(":");
  return { take, after: { createdAt: Number(rawAfter.slice(0, at)), id: rawAfter.slice(at + 1) } };
}

/**
 * The cursor of the next page: the last row's `<created_at>:<id>` when the page is full (the portal-shared statements cap a page at 50, so a full page may be
 * followed by an empty one), else null.
 */
export function nextOf(rows: readonly { created_at: number; id: string }[], take: number): string | null {
  const last = rows[rows.length - 1];
  return rows.length >= take && last ? `${last.created_at}:${last.id}` : null;
}

/** The `project` filter: absent, or an id the database could hold (anything else is a 400). */
export function projectFilterOf(c: Ctx): string | undefined | null {
  const p = c.req.query("project");
  if (p === undefined) return undefined;
  return ID.test(p) ? p : null;
}

/** One project of this organisation (`?1` client, `?2` project): the existence check before its shared items are listed. */
export const PROJECT_OF_SQL = "SELECT p.id FROM projects p WHERE p.client_id = ?1 AND p.id = ?2";

export type NoteRow = {
  id: string;
  project_id: string | null;
  body_md: string;
  created_at: number;
  updated_at: number;
};
export type FileRow = {
  id: string;
  project_id: string | null;
  filename: string;
  mime: string;
  size: number;
  created_at: number;
};

/** A shared note as the client sees it (no author: "TecHaust", L6). */
export const noteOf = (r: NoteRow) => ({
  id: r.id,
  projectId: r.project_id,
  bodyMd: r.body_md,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
/** A shared file as the client sees it: never its R2 key (the download reads it again, bound to the client). */
export const fileOf = (r: FileRow) => ({
  id: r.id,
  projectId: r.project_id,
  filename: r.filename,
  mime: r.mime,
  size: r.size,
  createdAt: r.created_at,
});

/**
 * A page of the organisation's shared items, the whole organisation's or one project's. With a project, one batch: the project check and the page; a project
 * that isn't this organisation's is the 404 (the page would be empty anyway: `sharedProjectSql` joins the project to the client).
 */
export async function sharedPage<R extends { created_at: number; id: string }>(
  c: Ctx,
  all: (db: D1Database, clientId: string, limit: number, after?: ListPage["after"]) => D1PreparedStatement,
  inProject: (
    db: D1Database,
    clientId: string,
    projectId: string,
    limit: number,
    after?: ListPage["after"],
  ) => D1PreparedStatement,
): Promise<Response | { rows: R[]; take: number }> {
  const s = scope(c);
  const page = pageOf(c);
  const project = projectFilterOf(c);
  if (!page || project === null) return err(c, BAD_REQUEST, 400);
  const db = c.env.DB;
  if (project === undefined)
    return { rows: (await all(db, s.clientId, page.take, page.after).all<R>()).results, take: page.take };
  const [found, items] = await db.batch([
    bound(db, PROJECT_OF_SQL, [s.clientId, project]),
    inProject(db, s.clientId, project, page.take, page.after),
  ]);
  if (!found?.results[0]) return err(c, NOT_FOUND, 404);
  return { rows: (items?.results ?? []) as R[], take: page.take };
}

export const notes = new Hono<AppEnv>().get("/", async (c) => {
  const r = await sharedPage<NoteRow>(c, sharedNotesFor, sharedNotesForProject);
  if (r instanceof Response) return r;
  return c.json({ notes: r.rows.map(noteOf), next: nextOf(r.rows, r.take) });
});
