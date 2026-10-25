// The client page's Projects, Notes and Files tabs (M3.4, ADM-CLI-03): API only. Mounted next to the clients router on the same base
// path, so the guard rows read `/clients/:id/projects` and so on. The finance tabs of ADM-CLI-03 stay with M3.3.
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import type { AppEnv } from "./context.ts";
import { fileListQuery, listFiles, uploadFile } from "./files.ts";
import { body, idParam, param, query } from "./http.ts";
import { createNote, createNoteBody, listNotes, noteListQuery } from "./notes.ts";
import { listClientProjects } from "./projects.ts";

const projectsQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});

export const clientTabs = new Hono<AppEnv>()
  .get("/:id/projects", param(idParam), query(projectsQuery), (c) => {
    const q = c.req.valid("query");
    return listClientProjects(c, c.req.valid("param").id, q.after, q.limit);
  })
  .get("/:id/notes", param(idParam), query(noteListQuery), (c) =>
    listNotes(c, { kind: "client", id: c.req.valid("param").id }, c.req.valid("query")),
  )
  .post("/:id/notes", param(idParam), body(createNoteBody), (c) =>
    createNote(c, { kind: "client", id: c.req.valid("param").id }, c.req.valid("json")),
  )
  .get("/:id/files", param(idParam), query(fileListQuery), (c) =>
    listFiles(c, { kind: "client", id: c.req.valid("param").id }, c.req.valid("query")),
  )
  .post("/:id/files", param(idParam), (c) => uploadFile(c, { kind: "client", id: c.req.valid("param").id }));
