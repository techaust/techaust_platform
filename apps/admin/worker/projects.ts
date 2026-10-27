// Projects and milestones (M3.4, ADM-PRJ-01, -02, -05). Every route is a row of ROUTES (guard.ts); every change is ONE batch through
// `mutate`. The rules live in SQL conditions (the current status, `updated_at`), not in a read before a write, so two staff members
// cannot both win. Money is integer minor units; a milestone is a fixed amount or a percentage of the budget.
// Audit rows hold ids, codes, field names and statuses, never a project name, a note or a filename.
import { parseIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import {
  canMoveMilestone,
  canMoveProject,
  type MilestoneStatus,
  milestoneTotals,
  PROJECT_STATUSES,
  type ProjectStatus,
} from "@techaust/core/projects";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import {
  clientGone,
  clientGoneSql,
  clientLiveSql,
  projectClientGone,
  refuseAnonymised,
} from "./anonymised.ts";
import { type ApiError, type AppEnv, BAD_REQUEST, type Ctx, err, mutate, NOT_FOUND } from "./context.ts";
import { type FileRow, fileListQuery, fileView, listFiles, uploadFile } from "./files.ts";
import { body, idParam, isUnique, limitOf, param, query, refusedWith, STALE_VERSION, text } from "./http.ts";
import { type Direction, decodeCursor, keysetSql, PREFIX_END, pageOf } from "./keyset.ts";
import { createNote, createNoteBody, listNotes, type NoteRow, noteListQuery, noteView } from "./notes.ts";

const INVALID_TRANSITION: ApiError = {
  code: "invalid_transition",
  message: "A project can't move to that status from where it is",
};
const MILESTONE_INVALID_TRANSITION: ApiError = {
  code: "milestone_invalid_transition",
  message: "A milestone can't move to that status from where it is",
};
const BUDGET_LOCKED: ApiError = {
  code: "budget_locked",
  message: "The budget can't change while a percentage milestone is invoiced or paid",
};
const ARRIVES_WITH_INVOICING: ApiError = {
  code: "arrives_with_invoicing",
  message: "Invoiced and paid are set by invoicing, not by hand",
};
const MILESTONE_LOCKED: ApiError = {
  code: "milestone_locked",
  message: "This milestone is already invoiced or paid, or has a document",
};
const MILESTONE_LIMIT: ApiError = {
  code: "milestone_limit",
  message: "A project has at most 100 milestones",
};
const CURRENCY_MISMATCH: ApiError = {
  code: "currency_mismatch",
  message: "A project uses its client's currency",
};
const DATES_ORDER: ApiError = {
  code: "dates_order",
  message: "The target date can't be before the start date",
};
const BAD_OWNER: ApiError = { code: "bad_owner", message: "Choose an active member of staff" };
const ORDER_MISMATCH: ApiError = {
  code: "order_mismatch",
  message: "The list must contain every milestone of the project exactly once",
};

export const MAX_MILESTONES = 100;
const MAX_MINOR = 10 ** 13;

// ---- schemas (module top level) ----------------------------------------------------------------------------------------

const isoDate = z.string().check(
  z.regex(/^\d{4}-\d{2}-\d{2}$/),
  z.refine((s) => parseIsoDate(s) !== null),
);
const amount = z.int().check(z.gte(0), z.lte(MAX_MINOR));
const currencyCode = z.enum(["INR", "USD"]);
const projectStatus = z.enum(PROJECT_STATUSES);

const createProject = z.strictObject({
  clientId: text(64),
  name: text(200),
  startDate: z.optional(z.nullable(isoDate)),
  targetDate: z.optional(z.nullable(isoDate)),
  ownerId: z.optional(z.nullable(text(64))),
  budgetMinor: z.optional(z.nullable(amount)),
  currency: z.optional(currencyCode),
});
const patchProject = z.strictObject({
  expectedUpdatedAt: z.int(),
  name: z.optional(text(200)),
  startDate: z.optional(z.nullable(isoDate)),
  targetDate: z.optional(z.nullable(isoDate)),
  ownerId: z.optional(z.nullable(text(64))),
  budgetMinor: z.optional(z.nullable(amount)),
});
const statusBody = z.strictObject({ to: projectStatus });
const listQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  q: z.optional(z.string().check(z.maxLength(100))),
  status: z.optional(projectStatus),
  clientId: z.optional(z.string().check(z.maxLength(64))),
  ownerId: z.optional(z.string().check(z.maxLength(64))),
  after: z.optional(z.string().check(z.maxLength(400))),
  before: z.optional(z.string().check(z.maxLength(400))),
});

const createMilestone = z.strictObject({
  title: text(200),
  amountMinor: z.optional(z.nullable(amount)),
  pctBp: z.optional(z.nullable(z.int().check(z.gte(0), z.lte(10_000)))),
  dueDate: z.optional(z.nullable(isoDate)),
});
const patchMilestone = z.strictObject({
  expectedUpdatedAt: z.int(),
  title: z.optional(text(200)),
  amountMinor: z.optional(z.nullable(amount)),
  pctBp: z.optional(z.nullable(z.int().check(z.gte(0), z.lte(10_000)))),
  dueDate: z.optional(z.nullable(isoDate)),
});
const milestoneStatusBody = z.strictObject({ to: z.enum(["pending", "ready_to_bill", "invoiced", "paid"]) });
const orderBody = z.strictObject({
  ids: z.array(text(64)).check(z.minLength(1), z.maxLength(MAX_MILESTONES)),
});

// ---- rows and views -----------------------------------------------------------------------------------------------------

type ProjectRow = {
  id: string;
  code: string;
  client_id: string;
  client_code: string;
  client_name: string;
  source_document_id: string | null;
  name: string;
  status: ProjectStatus;
  start_date: string | null;
  target_date: string | null;
  owner_id: string | null;
  owner_name: string | null;
  currency: string;
  budget_minor: number | null;
  created_at: number;
  updated_at: number;
};
/** The hours logged on a project: totals only, served by `time_logs_project_date` (exported so a test can EXPLAIN it). */
export const PROJECT_HOURS_SQL =
  "SELECT coalesce(sum(minutes), 0) AS total, coalesce(sum(CASE WHEN billable = 1 THEN minutes END), 0) AS billable FROM time_logs WHERE project_id = ?1";

const PROJECT_COLS =
  "p.id, p.code, p.client_id, c.code AS client_code, c.display_name AS client_name, p.source_document_id, p.name, p.status, p.start_date, p.target_date, p.owner_id, (SELECT name FROM staff_users WHERE id = p.owner_id) AS owner_name, p.currency, p.budget_minor, p.created_at, p.updated_at";
export const projectView = (r: ProjectRow) => ({
  id: r.id,
  code: r.code,
  clientId: r.client_id,
  clientCode: r.client_code,
  clientName: r.client_name,
  sourceDocumentId: r.source_document_id,
  name: r.name,
  status: r.status,
  startDate: r.start_date,
  targetDate: r.target_date,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  currency: r.currency,
  budgetMinor: r.budget_minor,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

type MilestoneRow = {
  id: string;
  project_id: string;
  position: number;
  title: string;
  amount_minor: number | null;
  pct_bp: number | null;
  due_date: string | null;
  status: MilestoneStatus;
  delivered_at: number | null;
  document_id: string | null;
  is_advance: number;
  created_at: number;
  updated_at: number;
};
const MILESTONE_COLS =
  "id, project_id, position, title, amount_minor, pct_bp, due_date, status, delivered_at, document_id, is_advance, created_at, updated_at";
const milestoneView = (r: MilestoneRow, budget: number | null) => ({
  id: r.id,
  projectId: r.project_id,
  position: r.position,
  title: r.title,
  amountMinor: r.amount_minor,
  pctBp: r.pct_bp,
  /** What the line comes to in minor units: the amount, or the percentage of the budget (half up). Null: a percentage with no budget. */
  resolvedMinor:
    r.amount_minor !== null
      ? r.amount_minor
      : budget === null
        ? null
        : milestoneTotals(budget, [{ amountMinor: null, pctBp: r.pct_bp }]).totalMinor,
  dueDate: r.due_date,
  status: r.status,
  deliveredAt: r.delivered_at,
  documentId: r.document_id,
  isAdvance: r.is_advance === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Code or name prefix, both on indexes (`projects_code`, `projects_name_nocase`). */
export const PROJECT_SEARCH_SQL = (at: number) =>
  `p.id IN (SELECT id FROM projects WHERE code >= ?${at} AND code < ?${at + 1} UNION SELECT id FROM projects WHERE name COLLATE NOCASE >= ?${at + 2} AND name COLLATE NOCASE < ?${at + 3})`;

type ListFilter = {
  status?: string | undefined;
  clientId?: string | undefined;
  ownerId?: string | undefined;
  q?: string | undefined;
};
/** The list statement and its values, one place for the route and for the plan test. */
export function projectListSql(
  f: ListFilter,
  cursor: { k: number; id: string } | null,
  dir: Direction,
  limit: number,
) {
  const where: string[] = [];
  const bind: unknown[] = [];
  if (f.status) where.push(`p.status = ?${bind.push(f.status)}`);
  if (f.clientId) where.push(`p.client_id = ?${bind.push(f.clientId)}`);
  if (f.ownerId) where.push(`p.owner_id = ?${bind.push(f.ownerId)}`);
  const q = f.q?.trim();
  if (q && q.length >= 2) {
    const at = bind.length + 1;
    where.push(PROJECT_SEARCH_SQL(at));
    bind.push(q.toUpperCase(), `${q.toUpperCase()}${PREFIX_END}`, q, `${q}${PREFIX_END}`);
  }
  const order = keysetSql("p.created_at", "p.id", false, dir, bind.length + 1);
  if (cursor) {
    where.push(order.where);
    bind.push(cursor.k, cursor.id);
  }
  return {
    sql: `SELECT ${PROJECT_COLS} FROM projects p JOIN clients c ON c.id = p.client_id${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order.order} LIMIT ${limit + 1}`,
    bind,
  };
}

async function listProjects(c: Ctx, f: z.infer<typeof listQuery>) {
  const limit = limitOf(f.limit);
  const dir: Direction = f.before ? "before" : "after";
  const raw = f.before ?? f.after;
  const cur = raw === undefined ? null : decodeCursor(raw);
  if (raw !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
  const { sql, bind } = projectListSql(f, cur && { k: cur.k as number, id: cur.id }, dir, limit);
  const { results } = await c.env.DB.prepare(sql)
    .bind(...bind)
    .all<ProjectRow>();
  const page = pageOf(results, limit, dir, cur !== null, (r) => ({ k: r.created_at, id: r.id }));
  return c.json({ projects: page.items.map(projectView), next: page.next, prev: page.prev });
}

/** The projects of one client (the client page's Projects tab). */
export async function listClientProjects(
  c: Ctx,
  clientId: string,
  after: string | undefined,
  limitText?: string,
) {
  const limit = limitOf(limitText);
  const cur = after === undefined ? null : decodeCursor(after);
  if (after !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
  const { sql, bind } = projectListSql(
    { clientId },
    cur && { k: cur.k as number, id: cur.id },
    "after",
    limit,
  );
  const { results } = await c.env.DB.prepare(sql)
    .bind(...bind)
    .all<ProjectRow>();
  if (
    results.length === 0 &&
    !(await c.env.DB.prepare("SELECT 1 AS x FROM clients WHERE id = ?1").bind(clientId).first())
  )
    return err(c, NOT_FOUND, 404);
  const page = pageOf(results, limit, "after", cur !== null, (r) => ({ k: r.created_at, id: r.id }));
  return c.json({ projects: page.items.map(projectView), next: page.next });
}

const projectRow = (c: Ctx, id: string) =>
  c.env.DB.prepare(
    `SELECT ${PROJECT_COLS} FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?1`,
  )
    .bind(id)
    .first<ProjectRow>();

/** The code is taken inside the INSERT (the next number after the highest), so two creates cannot read the same one. */
const PCT_LOCKED =
  "EXISTS (SELECT 1 FROM milestones m WHERE m.project_id = ?1 AND m.pct_bp IS NOT NULL AND (m.status IN ('invoiced', 'paid') OR m.document_id IS NOT NULL))";

const NEXT_CODE = "printf('PRJ-%04d', coalesce(max(cast(substr(code, 5) AS integer)), 0) + 1)";

export const projects = new Hono<AppEnv>()
  .get("/", query(listQuery), (c) => listProjects(c, c.req.valid("query")))

  .post("/", body(createProject), async (c) => {
    const f = c.req.valid("json");
    const db = c.env.DB;
    if (f.startDate && f.targetDate && f.targetDate < f.startDate) return err(c, DATES_ORDER, 400);
    const client = await db
      .prepare("SELECT currency FROM clients WHERE id = ?1")
      .bind(f.clientId)
      .first<{ currency: string }>();
    if (!client) return err(c, NOT_FOUND, 404);
    if (f.currency !== undefined && f.currency !== client.currency) return err(c, CURRENCY_MISMATCH, 400);
    const id = uuidv7();
    const t = Date.now();
    for (let attempt = 0; ; attempt++) {
      try {
        const done = await mutate(c, {
          main: db
            .prepare(
              `INSERT INTO projects (id, code, client_id, name, status, start_date, target_date, owner_id, currency, budget_minor, created_at, updated_at)
               SELECT ?1, (SELECT ${NEXT_CODE} FROM projects), c.id, ?3, 'planned', ?4, ?5, ?6, c.currency, ?7, ?8, ?8
               FROM clients c WHERE c.id = ?2 AND ${clientLiveSql("c.id")} AND (?6 IS NULL OR EXISTS (SELECT 1 FROM staff_users WHERE id = ?6 AND status = 'active'))`,
            )
            .bind(
              id,
              f.clientId,
              f.name,
              f.startDate ?? null,
              f.targetDate ?? null,
              f.ownerId ?? null,
              f.budgetMinor ?? null,
              t,
            ),
          action: "project.create",
          entityType: "project",
          entityId: id,
          summary: { projectId: id, clientId: f.clientId },
          status: 201,
        });
        if (!done) return (await clientGone(c, f.clientId)) ? refuseAnonymised(c) : err(c, BAD_OWNER, 400);
        break;
      } catch (e) {
        if (isUnique(e, "projects.code") && attempt < 2) continue;
        throw e;
      }
    }
    const made = await db
      .prepare("SELECT code FROM projects WHERE id = ?1")
      .bind(id)
      .first<{ code: string }>();
    return c.json({ id, code: made?.code ?? "", updatedAt: t }, 201);
  })

  .get("/:id", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const [p, ms, ns, fs, gone, hrs] = await db.batch<Record<string, unknown>>([
      db
        .prepare(
          `SELECT ${PROJECT_COLS} FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?1`,
        )
        .bind(id),
      db
        .prepare(
          `SELECT ${MILESTONE_COLS} FROM milestones WHERE project_id = ?1 ORDER BY position LIMIT ${MAX_MILESTONES}`,
        )
        .bind(id),
      db
        .prepare(
          `SELECT n.id, n.client_id, n.project_id, n.visibility, n.body_md, n.author_id, (SELECT name FROM staff_users WHERE id = n.author_id) AS author_name, n.created_at, n.updated_at
           FROM notes n WHERE n.project_id = ?1 ORDER BY n.created_at DESC, n.id DESC LIMIT 5`,
        )
        .bind(id),
      db
        .prepare(
          `SELECT f.id, f.client_id, f.project_id, f.filename, f.mime, f.size, f.sha256, f.shared, f.uploaded_by, (SELECT name FROM staff_users WHERE id = f.uploaded_by) AS uploaded_by_name, f.created_at
           FROM files f WHERE f.project_id = ?1 ORDER BY f.created_at DESC, f.id DESC LIMIT 5`,
        )
        .bind(id),
      db.prepare(`SELECT ${clientGoneSql("p.client_id")} AS gone FROM projects p WHERE p.id = ?1`).bind(id),
      // The hours logged on the project (M3.5, ADM-PRJ-05): totals only, never a person or a note, so every role that reads a project
      // sees the same figure. Served by `time_logs_project_date`; a project has a handful of entries a day at most.
      db.prepare(PROJECT_HOURS_SQL).bind(id),
    ]);
    const row = p?.results[0] as ProjectRow | undefined;
    if (!row) return err(c, NOT_FOUND, 404);
    const hours = hrs?.results[0] as { total: number; billable: number } | undefined;
    const milestones = (ms?.results ?? []) as MilestoneRow[];
    return c.json({
      project: projectView(row),
      /** The client is an anonymised individual: the screens are read-only (client_anonymised). */
      clientAnonymised: (gone?.results[0] as { gone: number } | undefined)?.gone === 1,
      milestones: milestones.map((m) => milestoneView(m, row.budget_minor)),
      milestoneTotals: milestoneTotals(
        row.budget_minor,
        milestones.map((m) => ({ amountMinor: m.amount_minor, pctBp: m.pct_bp })),
      ),
      recentNotes: ((ns?.results ?? []) as NoteRow[]).map(noteView),
      recentFiles: ((fs?.results ?? []) as FileRow[]).map(fileView),
      // Billed against paid needs invoices and says so, instead of showing a zero: the screens print "arrives with ...".
      figures: {
        billedVsPaid: { available: false, arrivesWith: "invoicing" },
        hours: { available: true, totalMinutes: hours?.total ?? 0, billableMinutes: hours?.billable ?? 0 },
      },
    });
  })

  .patch("/:id", param(idParam), body(patchProject), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const row = await projectRow(c, id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    const wanted: [string, string, string | number | null | undefined][] = [
      ["name", "name", f.name],
      ["startDate", "start_date", f.startDate],
      ["targetDate", "target_date", f.targetDate],
      ["ownerId", "owner_id", f.ownerId],
      ["budgetMinor", "budget_minor", f.budgetMinor],
    ];
    const changes = wanted.filter(
      (w): w is [string, string, string | number | null] =>
        w[2] !== undefined && w[2] !== (row as unknown as Record<string, unknown>)[w[1]],
    );
    if (!changes.length) return c.json({ ok: true, changed: false, updatedAt: row.updated_at });
    const start = f.startDate === undefined ? row.start_date : f.startDate;
    const target = f.targetDate === undefined ? row.target_date : f.targetDate;
    if (start && target && target < start) return err(c, DATES_ORDER, 400);
    const ownerAt = changes.findIndex(([name]) => name === "ownerId");
    const ownerCheck =
      ownerAt >= 0 && changes[ownerAt]?.[2] !== null
        ? ` AND EXISTS (SELECT 1 FROM staff_users WHERE id = ?${ownerAt + 4} AND status = 'active')`
        : "";
    // A percentage milestone that is invoiced, paid or on a document has its amount fixed by the budget: it cannot move (M3.4 review).
    const budgetCheck = changes.some(([name]) => name === "budgetMinor") ? ` AND NOT ${PCT_LOCKED}` : "";
    const t = Math.max(Date.now(), row.updated_at + 1);
    const done = await mutate(c, {
      main: db
        .prepare(
          `UPDATE projects SET ${changes.map(([, col], i) => `${col} = ?${i + 4}`).join(", ")}, updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND ${clientLiveSql("projects.client_id")}${ownerCheck}${budgetCheck}`,
        )
        .bind(id, f.expectedUpdatedAt, t, ...changes.map((ch) => ch[2])),
      action: "project.update",
      entityType: "project",
      entityId: id,
      summary: { projectId: id, projectCode: row.code, changed: changes.map(([name]) => name) },
    });
    if (!done) {
      // One read says why: the version, the client's state and the budget lock together.
      const why = await db
        .prepare(
          `SELECT updated_at, ${clientGoneSql("client_id")} AS gone, ${PCT_LOCKED} AS locked FROM projects WHERE id = ?1`,
        )
        .bind(id)
        .first<{ updated_at: number; gone: number; locked: number }>();
      if (!why) return err(c, NOT_FOUND, 404);
      if (why.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
      if (why.gone === 1) return refuseAnonymised(c);
      if (why.locked === 1 && changes.some(([name]) => name === "budgetMinor"))
        return err(c, BUDGET_LOCKED, 409);
      return err(c, BAD_OWNER, 400);
    }
    return c.json({ ok: true, changed: true, updatedAt: t });
  })

  .post("/:id/status", param(idParam), body(statusBody), async (c) => {
    const { id } = c.req.valid("param");
    const { to } = c.req.valid("json");
    const row = await c.env.DB.prepare("SELECT code, status, updated_at FROM projects WHERE id = ?1")
      .bind(id)
      .first<{ code: string; status: ProjectStatus; updated_at: number }>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (!canMoveProject(row.status, to)) return err(c, INVALID_TRANSITION, 409);
    // The version always moves, even inside the same millisecond as the last change.
    const t = Math.max(Date.now(), row.updated_at + 1);
    const done = await mutate(c, {
      main: c.env.DB.prepare(
        `UPDATE projects SET status = ?2, updated_at = ?3 WHERE id = ?1 AND status = ?4 AND updated_at = ?5 AND ${clientLiveSql("projects.client_id")}`,
      ).bind(id, to, t, row.status, row.updated_at),
      action: "project.status",
      entityType: "project",
      entityId: id,
      summary: { projectId: id, projectCode: row.code, from: row.status, to },
    });
    if (done) return c.json({ ok: true, status: to, updatedAt: t });
    // Nothing written: the client is anonymised, someone else edited the project (stale), or its status moved first.
    if (await projectClientGone(c, id)) return refuseAnonymised(c);
    const now = await c.env.DB.prepare("SELECT status FROM projects WHERE id = ?1")
      .bind(id)
      .first<{ status: ProjectStatus }>();
    return now?.status === row.status ? err(c, STALE_VERSION, 409) : err(c, INVALID_TRANSITION, 409);
  })

  // ---- milestones of a project ----
  .post("/:id/milestones", param(idParam), body(createMilestone), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const hasAmount = f.amountMinor !== undefined && f.amountMinor !== null;
    const hasPct = f.pctBp !== undefined && f.pctBp !== null;
    if (hasAmount === hasPct) return err(c, BAD_REQUEST, 400); // exactly one of the two
    const mid = uuidv7();
    const t = Date.now();
    const done = await mutate(c, {
      main: c.env.DB.prepare(
        `INSERT INTO milestones (id, project_id, position, title, amount_minor, pct_bp, due_date, status, created_at, updated_at)
         SELECT ?1, p.id, coalesce((SELECT max(position) FROM milestones WHERE project_id = p.id), 0) + 1, ?3, ?4, ?5, ?6, 'pending', ?7, ?7
         FROM projects p WHERE p.id = ?2 AND ${clientLiveSql("p.client_id")} AND (SELECT count(*) FROM milestones WHERE project_id = p.id) < ${MAX_MILESTONES}`,
      ).bind(mid, id, f.title, f.amountMinor ?? null, f.pctBp ?? null, f.dueDate ?? null, t),
      action: "milestone.create",
      entityType: "milestone",
      entityId: mid,
      summary: { milestoneId: mid, projectId: id },
      status: 201,
    });
    if (done) return c.json({ id: mid, updatedAt: t }, 201);
    const exists = await c.env.DB.prepare("SELECT 1 AS x FROM projects WHERE id = ?1").bind(id).first();
    if (!exists) return err(c, NOT_FOUND, 404);
    return (await projectClientGone(c, id)) ? refuseAnonymised(c) : err(c, MILESTONE_LIMIT, 409);
  })

  // The new order in one statement: every milestone of the project, once. The positions are unique per project, so the statement
  // first moves them out of the way (a fixed offset) and then sets the final ones; both only run when the list is exactly the project's.
  .post("/:id/milestones/order", param(idParam), body(orderBody), async (c) => {
    const { id } = c.req.valid("param");
    const { ids } = c.req.valid("json");
    if (new Set(ids).size !== ids.length) return err(c, ORDER_MISMATCH, 400);
    const list = JSON.stringify(ids);
    const exact = `${clientLiveSql("(SELECT client_id FROM projects WHERE id = ?1)")} AND (SELECT count(*) FROM milestones WHERE project_id = ?1) = json_array_length(?2) AND NOT EXISTS (SELECT 1 FROM milestones WHERE project_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2)))`;
    const t = Date.now();
    const done = await mutate(c, {
      main: [
        c.env.DB.prepare(
          `UPDATE milestones SET position = position + 1000000 WHERE project_id = ?1 AND ${exact}`,
        ).bind(id, list),
        c.env.DB.prepare(
          "UPDATE milestones SET position = (SELECT key + 1 FROM json_each(?2) WHERE value = milestones.id), updated_at = ?3 WHERE project_id = ?1 AND position >= 1000000",
        ).bind(id, list, t),
      ],
      action: "milestone.reorder",
      entityType: "project",
      entityId: id,
      summary: { projectId: id, count: ids.length },
    });
    if (done) return c.json({ ok: true });
    return (await projectClientGone(c, id)) ? refuseAnonymised(c) : err(c, ORDER_MISMATCH, 409);
  })

  // ---- notes and files of a project ----
  .get("/:id/notes", param(idParam), query(noteListQuery), (c) =>
    listNotes(c, { kind: "project", id: c.req.valid("param").id }, c.req.valid("query")),
  )
  .post("/:id/notes", param(idParam), body(createNoteBody), (c) =>
    createNote(c, { kind: "project", id: c.req.valid("param").id }, c.req.valid("json")),
  )
  .get("/:id/files", param(idParam), query(fileListQuery), (c) =>
    listFiles(c, { kind: "project", id: c.req.valid("param").id }, c.req.valid("query")),
  )
  .post("/:id/files", param(idParam), (c) => uploadFile(c, { kind: "project", id: c.req.valid("param").id }));

// ---- one milestone ---------------------------------------------------------------------------------------------------------

const milestoneRow = (c: Ctx, id: string) =>
  c.env.DB.prepare(`SELECT ${MILESTONE_COLS} FROM milestones WHERE id = ?1`).bind(id).first<MilestoneRow>();
/** Open for change: pending or ready to bill, and not yet on a document. */
const OPEN = "status IN ('pending', 'ready_to_bill') AND document_id IS NULL";
/** The milestone's client is not an anonymised individual (M3.4 review, finding 4). */
const MILESTONE_CLIENT_LIVE = clientLiveSql(
  "(SELECT client_id FROM projects WHERE id = milestones.project_id)",
);
const milestoneClientGone = async (c: Ctx, id: string) =>
  (
    await c.env.DB.prepare(
      `SELECT ${clientGoneSql("(SELECT client_id FROM projects WHERE id = m.project_id)")} AS gone FROM milestones m WHERE m.id = ?1`,
    )
      .bind(id)
      .first<{ gone: number }>()
  )?.gone === 1;

export const milestones = new Hono<AppEnv>()
  .patch("/:id", param(idParam), body(patchMilestone), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const row = await milestoneRow(c, id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (row.status === "invoiced" || row.status === "paid" || row.document_id !== null)
      return err(c, MILESTONE_LOCKED, 409);
    // An amount and a percentage replace each other: setting one clears the other; sending both with values is an error.
    const amountValue = f.amountMinor ?? null;
    const pctValue = f.pctBp ?? null;
    if (amountValue !== null && pctValue !== null) return err(c, BAD_REQUEST, 400);
    const sets: [string, string | number | null][] = [];
    const changed: string[] = [];
    if (f.title !== undefined && f.title !== row.title) {
      sets.push(["title", f.title]);
      changed.push("title");
    }
    if (f.dueDate !== undefined && f.dueDate !== row.due_date) {
      sets.push(["due_date", f.dueDate]);
      changed.push("dueDate");
    }
    if (amountValue !== null || pctValue !== null) {
      const newAmount = amountValue !== null ? amountValue : null;
      const newPct = pctValue !== null ? pctValue : null;
      if (newAmount !== row.amount_minor) {
        sets.push(["amount_minor", newAmount]);
        changed.push("amountMinor");
      }
      if (newPct !== row.pct_bp) {
        sets.push(["pct_bp", newPct]);
        changed.push("pctBp");
      }
    } else if (f.amountMinor === null || f.pctBp === null) {
      // clearing the only value would leave the line with neither
      return err(c, BAD_REQUEST, 400);
    }
    if (!sets.length) return c.json({ ok: true, changed: false, updatedAt: row.updated_at });
    const t = Math.max(Date.now(), row.updated_at + 1);
    let done: boolean;
    try {
      done = await mutate(c, {
        main: c.env.DB.prepare(
          `UPDATE milestones SET ${sets.map(([col], i) => `${col} = ?${i + 4}`).join(", ")}, updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND ${OPEN} AND ${MILESTONE_CLIENT_LIVE}`,
        ).bind(id, f.expectedUpdatedAt, t, ...sets.map((s) => s[1])),
        action: "milestone.update",
        entityType: "milestone",
        entityId: id,
        summary: { milestoneId: id, projectId: row.project_id, changed },
      });
    } catch (e) {
      if (refusedWith(e, /not both|not negative/)) return err(c, BAD_REQUEST, 400);
      throw e;
    }
    if (!done) {
      const again = await milestoneRow(c, id);
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
      return (await milestoneClientGone(c, id)) ? refuseAnonymised(c) : err(c, MILESTONE_LOCKED, 409);
    }
    return c.json({ ok: true, changed: true, updatedAt: t });
  })

  // Pending and ready to bill, both ways. Invoiced and paid are set by invoicing (M4.x): asked for here, they are a clear 409.
  .post("/:id/status", param(idParam), body(milestoneStatusBody), async (c) => {
    const { id } = c.req.valid("param");
    const { to } = c.req.valid("json");
    const row = await milestoneRow(c, id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (to === "invoiced" || to === "paid") return err(c, ARRIVES_WITH_INVOICING, 409);
    if (!canMoveMilestone(row.status, to)) return err(c, MILESTONE_INVALID_TRANSITION, 409);
    const t = Math.max(Date.now(), row.updated_at + 1);
    const done = await mutate(c, {
      main: c.env.DB.prepare(
        // M5.1 (LD12): the move to Ready to bill is when the work was delivered (the date of supply the 30-day invoice rule and the 25-day alert count
        // from); it is kept when the milestone is invoiced, and kept if it goes back to pending and returns.
        `UPDATE milestones SET status = ?2, updated_at = ?3${to === "ready_to_bill" ? ", delivered_at = coalesce(delivered_at, ?3)" : ""} WHERE id = ?1 AND status = ?4 AND document_id IS NULL AND ${MILESTONE_CLIENT_LIVE}`,
      ).bind(id, to, t, row.status),
      action: "milestone.status",
      entityType: "milestone",
      entityId: id,
      summary: { milestoneId: id, projectId: row.project_id, from: row.status, to },
    });
    if (done) return c.json({ ok: true, status: to, updatedAt: t });
    return (await milestoneClientGone(c, id))
      ? refuseAnonymised(c)
      : err(c, MILESTONE_INVALID_TRANSITION, 409);
  })

  // Only a pending milestone that is on no document can go.
  .delete("/:id", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const row = await milestoneRow(c, id);
    if (!row) return err(c, NOT_FOUND, 404);
    const done = await mutate(c, {
      main: c.env.DB.prepare(
        `DELETE FROM milestones WHERE id = ?1 AND status = 'pending' AND document_id IS NULL AND ${MILESTONE_CLIENT_LIVE}`,
      ).bind(id),
      action: "milestone.delete",
      entityType: "milestone",
      entityId: id,
      summary: { milestoneId: id, projectId: row.project_id },
    });
    if (done) return c.json({ ok: true });
    return (await milestoneClientGone(c, id)) ? refuseAnonymised(c) : err(c, MILESTONE_LOCKED, 409);
  });
