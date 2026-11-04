// The organisation's projects (M7.1; POR-08, ADM-PRJ-03/-04 portal side; run file C, L7): `GET /projects` (every project of the organisation, every status, a
// keyset page of at most 50, newest first) and `GET /projects/:id` (the project, its milestones and the first page of its shared notes and files, ONE batch of
// four statements). Every statement says `client_id = ?1` (the session's organisation); milestones are reached only through their project (scope.ts's rule for
// tables without `client_id`). Money is finance-only IN THE SQL: a contact without "can see finance" runs the milestone statement that selects no amount and
// no invoice, so neither can reach the answer. A milestone's invoice is named only when the client may open it itself (frozen, not void, an open status and
// type: `CLIENT_INVOICE_STATUSES`). The project's budget is never shown.
import { sharedFilesForProject, sharedNotesForProject } from "@techaust/db/portal-shared";
import { Hono } from "hono/tiny";
import { type AppEnv, BAD_REQUEST, type Ctx, err, NOT_FOUND } from "./context.ts";
import { STATUSES_SQL, TYPES_SQL } from "./invoice-summary.ts";
import { bound } from "./offer-core.ts";
import { scope } from "./scope.ts";
import { type FileRow, fileOf, type NoteRow, nextOf, noteOf, pageOf } from "./shared.ts";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** The first page of a project's shared notes and of its files on the project page (the lists page on with `GET /notes?project=` and `/files?project=`). */
export const PROJECT_PAGE_ITEMS = 25;

const PROJECT_COLS = "p.id, p.code, p.name, p.status, p.start_date, p.target_date, p.created_at";
/** ?1 client, ?2 the page size plus one. Newest first, on `projects_client_created`. */
export const PROJECTS_SQL = `SELECT ${PROJECT_COLS} FROM projects p INDEXED BY projects_client_created
   WHERE p.client_id = ?1 ORDER BY p.created_at DESC, p.id DESC LIMIT ?2`;
/** ?1 client, ?2 and ?3 the last row's created_at and id, ?4 the page size plus one. */
export const PROJECTS_AFTER_SQL = `SELECT ${PROJECT_COLS} FROM projects p INDEXED BY projects_client_created
   WHERE p.client_id = ?1 AND (p.created_at, p.id) < (?2, ?3) ORDER BY p.created_at DESC, p.id DESC LIMIT ?4`;
/** ?1 client, ?2 project. */
export const PROJECT_SQL = `SELECT ${PROJECT_COLS} FROM projects p WHERE p.client_id = ?1 AND p.id = ?2`;

/** A project's milestones for a contact WITHOUT finance (?1 client, ?2 project): no amount, no invoice. */
export const MILESTONES_SQL = `SELECT m.id, m.position, m.title, m.status, m.due_date FROM milestones m JOIN projects p ON p.id = m.project_id
   WHERE p.client_id = ?1 AND m.project_id = ?2 ORDER BY m.position LIMIT 100`;
/** The same for a contact WITH finance: the amount, and the invoice only when the client may open it itself (bound to the same client). */
export const MILESTONES_FINANCE_SQL = `SELECT m.id, m.position, m.title, m.status, m.due_date, m.amount_minor, p.currency, d.id AS invoice_id, d.number_display AS invoice_number
   FROM milestones m JOIN projects p ON p.id = m.project_id
     LEFT JOIN documents d ON d.id = m.document_id AND d.client_id = ?1 AND d.frozen_at IS NOT NULL AND d.voided_at IS NULL
       AND d.status IN (${STATUSES_SQL}) AND d.type IN (${TYPES_SQL})
   WHERE p.client_id = ?1 AND m.project_id = ?2 ORDER BY m.position LIMIT 100`;

export type ProjectRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  start_date: string | null;
  target_date: string | null;
  created_at: number;
};
type MilestoneRow = {
  id: string;
  position: number;
  title: string;
  status: string;
  due_date: string | null;
  amount_minor?: number | null;
  currency?: string;
  invoice_id?: string | null;
  invoice_number?: string | null;
};

/** A project as the client sees it (C6, C8): its status code, start and target dates. */
export const projectOf = (r: ProjectRow) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  status: r.status,
  startDate: r.start_date,
  targetDate: r.target_date,
});

/** A milestone (C7, C8): `amountMinor`, `currency` and `invoice` exist only on a finance contact's answer (the keys are absent otherwise). */
export function milestoneOf(r: MilestoneRow, finance: boolean) {
  const base = { id: r.id, position: r.position, title: r.title, status: r.status, dueDate: r.due_date };
  if (!finance) return base;
  return {
    ...base,
    amountMinor: r.amount_minor ?? null,
    currency: r.currency ?? null,
    invoice: r.invoice_id && r.invoice_number ? { id: r.invoice_id, numberDisplay: r.invoice_number } : null,
  };
}

const idOf = (c: Ctx): string | null => {
  const id = c.req.param("id") ?? "";
  return ID.test(id) ? id : null;
};

export const projects = new Hono<AppEnv>()
  .get("/", async (c) => {
    const s = scope(c);
    const page = pageOf(c);
    if (!page) return err(c, BAD_REQUEST, 400);
    const rows = (
      await (page.after
        ? bound(c.env.DB, PROJECTS_AFTER_SQL, [
            s.clientId,
            page.after.createdAt,
            page.after.id,
            page.take + 1,
          ])
        : bound(c.env.DB, PROJECTS_SQL, [s.clientId, page.take + 1])
      ).all<ProjectRow>()
    ).results;
    const shown = rows.slice(0, page.take);
    const last = shown[shown.length - 1];
    return c.json({
      projects: shown.map(projectOf),
      next: rows.length > page.take && last ? `${last.created_at}:${last.id}` : null,
    });
  })
  .get("/:id", async (c) => {
    const s = scope(c);
    const id = idOf(c);
    if (!id) return err(c, NOT_FOUND, 404);
    const db = c.env.DB;
    const [project, milestones, notes, files] = await db.batch([
      bound(db, PROJECT_SQL, [s.clientId, id]),
      bound(db, s.canSeeFinance ? MILESTONES_FINANCE_SQL : MILESTONES_SQL, [s.clientId, id]),
      sharedNotesForProject(db, s.clientId, id, PROJECT_PAGE_ITEMS),
      sharedFilesForProject(db, s.clientId, id, PROJECT_PAGE_ITEMS),
    ]);
    const p = project?.results[0] as ProjectRow | undefined;
    if (!p) return err(c, NOT_FOUND, 404);
    const noteRows = (notes?.results ?? []) as NoteRow[];
    const fileRows = (files?.results ?? []) as FileRow[];
    return c.json({
      project: projectOf(p),
      milestones: ((milestones?.results ?? []) as MilestoneRow[]).map((m) => milestoneOf(m, s.canSeeFinance)),
      notes: noteRows.map(noteOf),
      notesNext: nextOf(noteRows, PROJECT_PAGE_ITEMS),
      files: fileRows.map(fileOf),
      filesNext: nextOf(fileRows, PROJECT_PAGE_ITEMS),
    });
  });
