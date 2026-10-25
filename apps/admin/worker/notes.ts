// Notes on projects and clients (M3.4, ADM-PRJ-03). A note belongs to a client and, optionally, one of that client's projects (the
// database refuses any other mix: trigger `notes_scope_*`). Visibility is `internal` (staff only) or `shared` (the portal shows it:
// `sharedNotesFor` in @techaust/db/portal-shared, M7.1). The body is Markdown text, stored as typed and parsed in the browser
// (`parseMarkdown` in core): nothing here renders it. Audit rows hold ids and field names, never the body.
import { uuidv7 } from "@techaust/core/ids";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientLiveSql, refuseAnonymised } from "./anonymised.ts";
import { type AppEnv, actor, BAD_REQUEST, type Ctx, err, FORBIDDEN, mutate, NOT_FOUND } from "./context.ts";
import { body, idParam, limitOf, param, STALE_VERSION, text } from "./http.ts";
import { type Direction, decodeCursor, keysetSql, pageOf } from "./keyset.ts";

export const NOTE_MAX_CHARS = 10_000;
const visibility = z.enum(["internal", "shared"]);

export const createNoteBody = z.strictObject({
  bodyMd: text(NOTE_MAX_CHARS),
  visibility: z.optional(visibility),
});
const patchNoteBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  bodyMd: z.optional(text(NOTE_MAX_CHARS)),
  visibility: z.optional(visibility),
});
export const noteListQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
  visibility: z.optional(visibility),
});

export type NoteRow = {
  id: string;
  client_id: string;
  project_id: string | null;
  visibility: "internal" | "shared";
  body_md: string;
  author_id: string | null;
  author_name: string | null;
  created_at: number;
  updated_at: number;
};
export const noteView = (r: NoteRow) => ({
  id: r.id,
  clientId: r.client_id,
  projectId: r.project_id,
  visibility: r.visibility,
  bodyMd: r.body_md,
  authorId: r.author_id,
  authorName: r.author_name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
export const NOTE_COLS =
  "n.id, n.client_id, n.project_id, n.visibility, n.body_md, n.author_id, (SELECT name FROM staff_users WHERE id = n.author_id) AS author_name, n.created_at, n.updated_at";

export type Scope = { kind: "project" | "client"; id: string };

/** One page of a scope's notes, newest first. Exported so a test can EXPLAIN it. */
export function noteListSql(
  scope: Scope["kind"],
  withVisibility: boolean,
  withCursor: boolean,
  limit: number,
) {
  const col = scope === "project" ? "n.project_id" : "n.client_id";
  const order = keysetSql("n.created_at", "n.id", false, "after", withVisibility ? 3 : 2);
  return `SELECT ${NOTE_COLS} FROM notes n WHERE ${col} = ?1${withVisibility ? " AND n.visibility = ?2" : ""}${withCursor ? ` AND ${order.where}` : ""} ORDER BY ${order.order} LIMIT ${limit + 1}`;
}

const scopeExists = async (c: Ctx, s: Scope) =>
  (await c.env.DB.prepare(`SELECT 1 AS x FROM ${s.kind === "project" ? "projects" : "clients"} WHERE id = ?1`)
    .bind(s.id)
    .first()) !== null;

export async function listNotes(c: Ctx, s: Scope, q: z.infer<typeof noteListQuery>) {
  const limit = limitOf(q.limit);
  const cur = q.after === undefined ? null : decodeCursor(q.after);
  if (q.after !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
  const dir: Direction = "after";
  const { results } = await c.env.DB.prepare(
    noteListSql(s.kind, q.visibility !== undefined, cur !== null, limit),
  )
    .bind(s.id, ...(q.visibility ? [q.visibility] : []), ...(cur ? [cur.k, cur.id] : []))
    .all<NoteRow>();
  if (results.length === 0 && !(await scopeExists(c, s))) return err(c, NOT_FOUND, 404);
  const page = pageOf(results, limit, dir, cur !== null, (r) => ({ k: r.created_at, id: r.id }));
  return c.json({ notes: page.items.map(noteView), next: page.next });
}

export async function createNote(c: Ctx, s: Scope, f: z.infer<typeof createNoteBody>) {
  const user = actor(c);
  const id = uuidv7();
  const t = Date.now();
  const vis = f.visibility ?? "internal";
  const from =
    s.kind === "project"
      ? `SELECT ?1, p.client_id, p.id, ?3, ?4, ?5, ?6, ?6 FROM projects p WHERE p.id = ?2 AND ${clientLiveSql("p.client_id")}`
      : `SELECT ?1, c.id, NULL, ?3, ?4, ?5, ?6, ?6 FROM clients c WHERE c.id = ?2 AND ${clientLiveSql("c.id")}`;
  const done = await mutate(c, {
    main: c.env.DB.prepare(
      `INSERT INTO notes (id, client_id, project_id, visibility, body_md, author_id, created_at, updated_at) ${from}`,
    ).bind(id, s.id, vis, f.bodyMd, user.id, t),
    action: "note.create",
    entityType: "note",
    entityId: id,
    summary: { noteId: id, [s.kind === "project" ? "projectId" : "clientId"]: s.id, visibility: vis },
    status: 201,
  });
  if (!done) {
    if (!(await scopeExists(c, s))) return err(c, NOT_FOUND, 404);
    return refuseAnonymised(c);
  }
  return c.json({ id, createdAt: t, updatedAt: t }, 201);
}

const noteRow = (c: Ctx, id: string) =>
  c.env.DB.prepare(
    "SELECT id, client_id, project_id, visibility, author_id, updated_at FROM notes WHERE id = ?1",
  )
    .bind(id)
    .first<{
      id: string;
      client_id: string;
      project_id: string | null;
      visibility: "internal" | "shared";
      author_id: string | null;
      updated_at: number;
    }>();

/** The author may change or delete a note, and so may the owner; nobody else. */
const MAY_TOUCH = "(author_id = ?AT OR ?ROLE = 'owner')";
const mayTouch = (at: number) => MAY_TOUCH.replace("?AT", `?${at}`).replace("?ROLE", `?${at + 1}`);

export const notes = new Hono<AppEnv>()
  .patch("/:id", param(idParam), body(patchNoteBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const user = actor(c);
    const row = await noteRow(c, id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.author_id !== user.id && user.role !== "owner") return err(c, FORBIDDEN, 403);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const changed: string[] = [];
    if (f.bodyMd !== undefined) {
      sets.push(`body_md = ?${vals.push(f.bodyMd) + 5}`);
      changed.push("bodyMd");
    }
    const shares = f.visibility !== undefined && f.visibility !== row.visibility;
    if (shares) {
      sets.push(`visibility = ?${vals.push(f.visibility) + 5}`);
      changed.push("visibility");
    }
    if (!sets.length) return c.json({ ok: true, changed: false, updatedAt: row.updated_at });
    const t = Date.now();
    const done = await mutate(c, {
      main: c.env.DB.prepare(
        `UPDATE notes SET ${sets.join(", ")}, updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND ${mayTouch(4)}`,
      ).bind(id, f.expectedUpdatedAt, Math.max(t, row.updated_at + 1), user.id, user.role, ...vals),
      action: shares ? "note.share" : "note.update",
      entityType: "note",
      entityId: id,
      summary: {
        noteId: id,
        ...(row.project_id ? { projectId: row.project_id } : { clientId: row.client_id }),
        changed,
        ...(shares ? { visibility: f.visibility } : {}),
      },
    });
    if (!done) {
      const again = await noteRow(c, id);
      return again ? err(c, STALE_VERSION, 409) : err(c, NOT_FOUND, 404);
    }
    return c.json({ ok: true, changed: true, updatedAt: Math.max(t, row.updated_at + 1) });
  })

  .delete("/:id", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const user = actor(c);
    const row = await noteRow(c, id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.author_id !== user.id && user.role !== "owner") return err(c, FORBIDDEN, 403);
    const done = await mutate(c, {
      main: c.env.DB.prepare(`DELETE FROM notes WHERE id = ?1 AND ${mayTouch(2)}`).bind(
        id,
        user.id,
        user.role,
      ),
      action: "note.delete",
      entityType: "note",
      entityId: id,
      summary: {
        noteId: id,
        ...(row.project_id ? { projectId: row.project_id } : { clientId: row.client_id }),
        visibility: row.visibility,
      },
    });
    return done ? c.json({ ok: true }) : err(c, NOT_FOUND, 404);
  });
