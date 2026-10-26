// Time logs (M3.5, ADM-TIME-01..03). Every route is a row of ROUTES (guard.ts); every change is ONE batch through `mutate`, audit row
// first, with every condition of the write in the WHERE of that row: the 24-hour day, the target being open, the care plan being
// active on the work date, the author's 7-day lock and the version. The triggers of migration 0029 are the backstop.
//
// Rules (docs/runs/m3.5-care-time.md, lead decisions): time is refused when the plan is not active on the work date (entries dated
// before a pause are still accepted), before the plan starts, on a cancelled project and for an anonymised individual's projects and
// plans; nobody logs a future date; a date more than 7 days back is the owner's (`time.writeAny`); the author edits for 7 days from
// `created_at`, then it is locked and only the owner may change it (the audit row says `lockOverride`); an entry's person never changes.
// Staff time logs are staff personal data (DPDP; retention is VERIFY WITH CA/LEGAL). Audit rows hold ids, dates, minutes and field names, never
// the note. Local-time dates are IST.

import { addDays, daysBetween, istDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { can, ROLES } from "@techaust/core/permissions";
import {
  authorLocked,
  DAY_CAP,
  DAY_MS,
  entryDateCheck,
  LOCK_DAYS,
  validMinutes,
  weekOf,
} from "@techaust/core/time";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql, clientLiveSql, refuseAnonymised } from "./anonymised.ts";
import { auditFirstRow } from "./audit-row.ts";
import {
  type ApiError,
  type AppEnv,
  actor,
  BAD_REQUEST,
  type Ctx,
  err,
  FORBIDDEN,
  mutate,
  NOT_FOUND,
} from "./context.ts";
import { body, idParam, isoDate, limitOf, param, query, refusedWith, STALE_VERSION } from "./http.ts";
import { type Direction, decodeCursor, keysetSql, PREFIX_END, pageOf } from "./keyset.ts";

/** The roles that log time (`time.writeOwn`), as an SQL list: the people an entry can be logged for. */
const TIME_ROLES_SQL = ROLES.filter((r) => can(r, "time.writeOwn"))
  .map((r) => `'${r}'`)
  .join(", ");

const DAY_CAP_ERROR: ApiError = {
  code: "day_cap",
  message: "That would pass 24 hours for this person on that day",
};
const PLAN_NOT_ACTIVE: ApiError = {
  code: "plan_not_active",
  message: "The care plan isn't active on that date, so no time can be logged on it",
};
const PROJECT_CLOSED: ApiError = {
  code: "project_closed",
  message: "The project is cancelled, so no time can be logged on it",
};
const TIME_LOCKED: ApiError = {
  code: "time_locked",
  message: "This entry is locked: only the owner can change it after 7 days",
};
const OWNER_ONLY_DATE: ApiError = {
  code: "owner_only_date",
  message: "Only the owner can log or move time to a date more than 7 days back",
};
const FUTURE_DATE: ApiError = {
  code: "future_date",
  message: "Time can't be logged on a date that hasn't come",
};
const BAD_USER: ApiError = { code: "bad_user", message: "Choose an active member of staff" };
const CONFLICT: ApiError = {
  code: "conflict",
  message: "The entry could not be saved. Reload and try again",
};

// ---- schemas (module top level) ---------------------------------------------------------------------------------------------

const minutes = z.int().check(z.refine(validMinutes));
const noteText = z.nullable(z.string().check(z.trim(), z.maxLength(1000)));
const id64 = z.string().check(z.minLength(1), z.maxLength(64));

const createBody = z.strictObject({
  userId: z.optional(id64),
  workDate: isoDate,
  minutes,
  projectId: z.optional(z.nullable(id64)),
  carePlanId: z.optional(z.nullable(id64)),
  note: z.optional(noteText),
  billable: z.boolean(),
});
const patchBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  workDate: z.optional(isoDate),
  minutes: z.optional(minutes),
  projectId: z.optional(z.nullable(id64)),
  carePlanId: z.optional(z.nullable(id64)),
  note: z.optional(noteText),
  billable: z.optional(z.boolean()),
});
const deleteQuery = z.object({ expectedUpdatedAt: z.string().check(z.regex(/^\d{1,16}$/)) });
const flag = z.optional(z.enum(["1", "0"]));
const listQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  from: z.optional(isoDate),
  to: z.optional(isoDate),
  userId: z.optional(id64),
  projectId: z.optional(id64),
  carePlanId: z.optional(id64),
  billable: flag,
  after: z.optional(z.string().check(z.maxLength(400))),
  before: z.optional(z.string().check(z.maxLength(400))),
});
const weekQuery = z.object({
  start: z.optional(isoDate),
  userId: z.optional(id64),
  projectId: z.optional(id64),
  carePlanId: z.optional(id64),
});
const targetsQuery = z.object({
  q: z.optional(z.string().check(z.maxLength(100))),
  workDate: z.optional(isoDate),
});

/** Start-up warm-up (worker/warm.ts): parse one sample of each body and query once, so the first request builds no schema. */
export function warmTime(): number {
  const t = performance.now();
  createBody.safeParse({ workDate: "2026-01-01", minutes: 60, projectId: "x", note: "n", billable: true });
  patchBody.safeParse({ expectedUpdatedAt: 1, minutes: 30, note: null });
  deleteQuery.safeParse({ expectedUpdatedAt: "1" });
  listQuery.safeParse({ limit: "25", from: "2026-01-01", to: "2026-01-31", billable: "1" });
  weekQuery.safeParse({ start: "2026-01-05" });
  targetsQuery.safeParse({ q: "ab", workDate: "2026-01-01" });
  return performance.now() - t;
}

// ---- helpers ------------------------------------------------------------------------------------------------------------------

const istToday = (now = Date.now()) => toIsoDate(istDate(now));
/** A date a schema has already checked. */
const calendar = (iso: string) => parseIsoDate(iso) as NonNullable<ReturnType<typeof parseIsoDate>>;
const MAX_RANGE_DAYS = 366;
const WEEK_GROUP_CAP = 500;
const LOCK_MS = LOCK_DAYS * DAY_MS;

/** The status of a care plan on a date (SQL): its newest status row on or before it. */
const PLAN_STATUS_ON = (plan: string, date: string) =>
  `(SELECT status FROM care_plan_status_log WHERE care_plan_id = ${plan} AND effective_on <= ${date} ORDER BY effective_on DESC, created_at DESC, id DESC LIMIT 1)`;
/**
 * The tier of a care plan in force on a date (SQL): its newest terms row effective on or before it. The `tier` column of `care_plans` is
 * the NEWEST row, which may be a change booked for the next billing period, so it is not what is in force today (early check L1).
 */
const TIER_ON = (plan: string, date: string) =>
  `(SELECT tier FROM care_plan_terms WHERE care_plan_id = ${plan} AND effective_from <= ${date} ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1)`;
/** The day total of a person, optionally without one entry (SQL). */
const DAY_TOTAL = (user: string, date: string, except?: string) =>
  `(SELECT coalesce(sum(minutes), 0) FROM time_logs WHERE user_id = ${user} AND work_date = ${date}${except ? ` AND id <> ${except}` : ""})`;

const entryCols = (a = "t") =>
  `${a}.id, ${a}.user_id, ${a}.work_date, ${a}.minutes, ${a}.project_id, ${a}.care_plan_id, ${a}.note, ${a}.billable, ${a}.created_at, ${a}.updated_at`;

type EntryRow = {
  id: string;
  user_id: string;
  work_date: string;
  minutes: number;
  project_id: string | null;
  care_plan_id: string | null;
  note: string | null;
  billable: number;
  created_at: number;
  updated_at: number;
};

/** What a trigger said when it refused (the SQL conditions normally catch these first). */
function refusal(e: unknown): ApiError | null {
  if (refusedWith(e, /time_logs_day_cap/)) return DAY_CAP_ERROR;
  if (refusedWith(e, /time_logs_plan_active/)) return PLAN_NOT_ACTIVE;
  if (refusedWith(e, /time_logs_project_open/)) return PROJECT_CLOSED;
  if (refusedWith(e, /time_logs_one_target|time_logs_date_valid|time_logs_minutes/)) return BAD_REQUEST;
  return null;
}

/** The SQL condition for a target (project or care plan) that takes new time on a date; `?n` placeholders are the caller's. */
const targetOpen = (project: string, plan: string, date: string) =>
  `(${project} IS NULL OR EXISTS (SELECT 1 FROM projects pr WHERE pr.id = ${project} AND pr.status <> 'cancelled' AND ${clientLiveSql("pr.client_id")})) AND (${plan} IS NULL OR (EXISTS (SELECT 1 FROM care_plans cp WHERE cp.id = ${plan} AND ${clientLiveSql("cp.client_id")}) AND ${PLAN_STATUS_ON(plan, date)} = 'active'))`;

/** Only the client condition of a target: a note edit on a cancelled project or a paused plan is still allowed, an erased client's is not. */
const targetLive = (project: string, plan: string) =>
  `(${project} IS NULL OR EXISTS (SELECT 1 FROM projects pr WHERE pr.id = ${project} AND ${clientLiveSql("pr.client_id")})) AND (${plan} IS NULL OR EXISTS (SELECT 1 FROM care_plans cp WHERE cp.id = ${plan} AND ${clientLiveSql("cp.client_id")}))`;

/** Why a target refuses time on `date`, in one read (the write found its conditions false and changed nothing). */
async function whyTargetRefuses(
  c: Ctx,
  t: {
    /** The person; `checkUser` also asks whether they are an active member. */
    userId: string;
    checkUser: boolean;
    projectId: string | null;
    carePlanId: string | null;
    date: string;
    minutes: number;
    /** An entry that is being changed: it is not counted in the day total. */
    except?: string;
    /** A note-only edit: only an anonymised client (or a missing target) refuses it. */
    liveOnly?: boolean;
  },
): Promise<Response | null> {
  const r = await c.env.DB.prepare(
    `SELECT (SELECT status FROM staff_users WHERE id = ?1 AND role IN (${TIME_ROLES_SQL})) AS user_status,
            (SELECT status FROM projects WHERE id = ?2) AS project_status,
            (SELECT ${clientGoneSql("pr.client_id")} FROM projects pr WHERE pr.id = ?2) AS project_gone,
            (SELECT 1 FROM care_plans WHERE id = ?3) AS plan_exists,
            (SELECT ${clientGoneSql("cp.client_id")} FROM care_plans cp WHERE cp.id = ?3) AS plan_gone,
            ${PLAN_STATUS_ON("?3", "?4")} AS plan_status,
            ${DAY_TOTAL("?1", "?4", t.except ? "?5" : undefined)} AS day_total`,
  )
    .bind(t.userId, t.projectId, t.carePlanId, t.date, ...(t.except ? [t.except] : []))
    .first<{
      user_status: string | null;
      project_status: string | null;
      project_gone: number | null;
      plan_exists: number | null;
      plan_gone: number | null;
      plan_status: string | null;
      day_total: number;
    }>();
  if (!r) return null;
  if (t.checkUser && r.user_status !== "active") return err(c, BAD_USER, 400);
  if (t.projectId !== null) {
    if (r.project_status === null) return err(c, NOT_FOUND, 404);
    if (r.project_gone === 1) return refuseAnonymised(c);
    if (!t.liveOnly && r.project_status === "cancelled") return err(c, PROJECT_CLOSED, 409);
  }
  if (t.carePlanId !== null) {
    if (r.plan_exists === null) return err(c, NOT_FOUND, 404);
    if (r.plan_gone === 1) return refuseAnonymised(c);
    if (!t.liveOnly && r.plan_status !== "active") return err(c, PLAN_NOT_ACTIVE, 409);
  }
  if (t.liveOnly) return null;
  if (r.day_total + t.minutes > DAY_CAP) return err(c, DAY_CAP_ERROR, 409);
  return null;
}

// ---- routes -------------------------------------------------------------------------------------------------------------------

export const timeLogs = new Hono<AppEnv>()
  .get("/", query(listQuery), async (c) => {
    const f = c.req.valid("query");
    const me = actor(c);
    const readAll = can(me.role, "time.readAll");
    if (f.userId !== undefined && f.userId !== me.id && !readAll) return err(c, FORBIDDEN, 403);
    const today = istToday();
    const to = f.to ?? today;
    const from = f.from ?? toIsoDate(addDays(calendar(to), -29));
    if (from > to || daysBetween(calendar(from), calendar(to)) > MAX_RANGE_DAYS)
      return err(c, BAD_REQUEST, 400);
    const limit = limitOf(f.limit);
    const dir: Direction = f.before ? "before" : "after";
    const raw = f.before ?? f.after;
    const cur = raw === undefined ? null : decodeCursor(raw);
    if ((f.before && f.after) || (raw !== undefined && (!cur || typeof cur.k !== "string")))
      return err(c, BAD_REQUEST, 400);
    const where: string[] = [];
    const bind: unknown[] = [];
    where.push(`t.work_date BETWEEN ?${bind.push(from)} AND ?${bind.push(to)}`);
    const scope = readAll ? f.userId : me.id;
    if (scope) where.push(`t.user_id = ?${bind.push(scope)}`);
    if (f.projectId) where.push(`t.project_id = ?${bind.push(f.projectId)}`);
    if (f.carePlanId) where.push(`t.care_plan_id = ?${bind.push(f.carePlanId)}`);
    if (f.billable) where.push(`t.billable = ?${bind.push(Number(f.billable))}`);
    const order = keysetSql("t.work_date", "t.id", false, dir, bind.length + 1);
    if (cur) {
      where.push(order.where);
      bind.push(cur.k, cur.id);
    }
    const { results } = await c.env.DB.prepare(listSql(where, order.order, limit, `?${bind.push(today)}`))
      .bind(...bind)
      .all<ListRow>();
    const page = pageOf(results, limit, dir, cur !== null, (r) => ({ k: r.work_date, id: r.id }));
    const now = Date.now();
    const canAny = can(me.role, "time.writeAny");
    return c.json({
      today,
      range: { from, to },
      entries: page.items.map((r) => ({
        id: r.id,
        userId: r.user_id,
        userName: r.user_name,
        workDate: r.work_date,
        minutes: r.minutes,
        billable: r.billable === 1,
        note: r.note,
        projectId: r.project_id,
        projectCode: r.project_code,
        carePlanId: r.care_plan_id,
        carePlanClientCode: r.client_code,
        carePlanTier: r.care_tier,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        /** Whether the viewer may change it now: the owner always; the author for 7 days, unless the entry is dated more than 7 days back. */
        canEdit:
          can(me.role, "time.writeOwn") &&
          (canAny ||
            (r.user_id === me.id &&
              !authorLocked(r.created_at, now) &&
              entryDateCheck({ today, workDate: r.work_date, canWriteAny: false }) !== "owner_only_date")),
      })),
      next: page.next,
      prev: page.prev,
    });
  })

  // The timesheet week, Monday to Sunday: one group per person, target and date, and the day totals.
  .get("/week", query(weekQuery), async (c) => {
    const f = c.req.valid("query");
    const me = actor(c);
    const readAll = can(me.role, "time.readAll");
    if (f.userId !== undefined && f.userId !== me.id && !readAll) return err(c, FORBIDDEN, 403);
    const today = istToday();
    const week = weekOf(f.start ?? today);
    if (f.start !== undefined && f.start !== week.start) return err(c, BAD_REQUEST, 400);
    const bind: unknown[] = [];
    const where = [`t.work_date BETWEEN ?${bind.push(week.start)} AND ?${bind.push(week.end)}`];
    const scope = readAll ? f.userId : me.id;
    if (scope) where.push(`t.user_id = ?${bind.push(scope)}`);
    if (f.projectId) where.push(`t.project_id = ?${bind.push(f.projectId)}`);
    if (f.carePlanId) where.push(`t.care_plan_id = ?${bind.push(f.carePlanId)}`);
    const db = c.env.DB;
    const sums =
      "sum(t.minutes) AS minutes, sum(CASE WHEN t.billable = 1 THEN t.minutes ELSE 0 END) AS billable_minutes, count(*) AS entries";
    const [groups, days] = await db.batch<Record<string, unknown>>([
      db
        .prepare(
          `SELECT t.user_id, (SELECT name FROM staff_users WHERE id = t.user_id) AS user_name, t.project_id, (SELECT code FROM projects WHERE id = t.project_id) AS project_code, t.care_plan_id,
                  (SELECT code FROM clients WHERE id = (SELECT client_id FROM care_plans WHERE id = t.care_plan_id)) AS client_code, t.work_date, ${sums}
           FROM time_logs t WHERE ${where.join(" AND ")} GROUP BY t.user_id, t.project_id, t.care_plan_id, t.work_date ORDER BY t.work_date, t.user_id, t.project_id, t.care_plan_id LIMIT ${WEEK_GROUP_CAP + 1}`,
        )
        .bind(...bind),
      db
        .prepare(
          `SELECT t.work_date, ${sums} FROM time_logs t WHERE ${where.join(" AND ")} GROUP BY t.work_date ORDER BY t.work_date`,
        )
        .bind(...bind),
    ]);
    const rows = (groups?.results ?? []) as {
      user_id: string;
      user_name: string | null;
      project_id: string | null;
      project_code: string | null;
      care_plan_id: string | null;
      client_code: string | null;
      work_date: string;
      minutes: number;
      billable_minutes: number;
      entries: number;
    }[];
    const totals = (days?.results ?? []) as {
      work_date: string;
      minutes: number;
      billable_minutes: number;
      entries: number;
    }[];
    return c.json({
      today,
      week,
      groups: rows.slice(0, WEEK_GROUP_CAP).map((r) => ({
        userId: r.user_id,
        userName: r.user_name,
        projectId: r.project_id,
        projectCode: r.project_code,
        carePlanId: r.care_plan_id,
        carePlanClientCode: r.client_code,
        workDate: r.work_date,
        minutes: r.minutes,
        billableMinutes: r.billable_minutes,
        entries: r.entries,
      })),
      truncated: rows.length > WEEK_GROUP_CAP,
      dayTotals: totals.map((r) => ({
        workDate: r.work_date,
        minutes: r.minutes,
        billableMinutes: r.billable_minutes,
        entries: r.entries,
      })),
      totalMinutes: totals.reduce((n, r) => n + r.minutes, 0),
    });
  })

  // What time can be logged on: projects that aren't cancelled, and care plans active on the work date (default today).
  .get("/targets", query(targetsQuery), async (c) => {
    const { q: rawQ, workDate } = c.req.valid("query");
    const q = rawQ?.trim() ?? "";
    const today = workDate ?? istToday();
    const db = c.env.DB;
    const searching = q.length >= 2;
    const projectsSql = searching
      ? `SELECT p.id, p.code, p.name, p.status, cl.code AS client_code FROM projects p JOIN clients cl ON cl.id = p.client_id
         WHERE p.status <> 'cancelled' AND ${clientLiveSql("p.client_id")} AND p.id IN (SELECT id FROM projects WHERE code >= ?1 AND code < ?2 UNION SELECT id FROM projects WHERE name COLLATE NOCASE >= ?3 AND name COLLATE NOCASE < ?4)
         ORDER BY p.created_at DESC, p.id DESC LIMIT 20`
      : `SELECT p.id, p.code, p.name, p.status, cl.code AS client_code FROM projects p JOIN clients cl ON cl.id = p.client_id
         WHERE p.status <> 'cancelled' AND ${clientLiveSql("p.client_id")} ORDER BY p.created_at DESC, p.id DESC LIMIT 20`;
    const plansSql = searching
      ? `SELECT cp.id, ${TIER_ON("cp.id", "?1")} AS tier, cl.code AS client_code, cl.display_name AS client_name FROM care_plans cp JOIN clients cl ON cl.id = cp.client_id
         WHERE cp.start_date <= ?1 AND ${PLAN_STATUS_ON("cp.id", "?1")} = 'active' AND ${clientLiveSql("cp.client_id")}
           AND cp.client_id IN (SELECT id FROM clients WHERE code >= ?2 AND code < ?3 UNION SELECT id FROM clients WHERE display_name COLLATE NOCASE >= ?4 AND display_name COLLATE NOCASE < ?5)
         ORDER BY cp.created_at DESC, cp.id DESC LIMIT 20`
      : `SELECT cp.id, ${TIER_ON("cp.id", "?1")} AS tier, cl.code AS client_code, cl.display_name AS client_name FROM care_plans cp JOIN clients cl ON cl.id = cp.client_id
         WHERE cp.start_date <= ?1 AND ${PLAN_STATUS_ON("cp.id", "?1")} = 'active' AND ${clientLiveSql("cp.client_id")} ORDER BY cp.created_at DESC, cp.id DESC LIMIT 20`;
    const upper = q.toUpperCase();
    const [projects, plans] = await db.batch<Record<string, unknown>>([
      db
        .prepare(projectsSql)
        .bind(...(searching ? [upper, `${upper}${PREFIX_END}`, q, `${q}${PREFIX_END}`] : [])),
      db
        .prepare(plansSql)
        .bind(...(searching ? [today, upper, `${upper}${PREFIX_END}`, q, `${q}${PREFIX_END}`] : [today])),
    ]);
    return c.json({
      projects: (
        (projects?.results ?? []) as {
          id: string;
          code: string;
          name: string;
          status: string;
          client_code: string;
        }[]
      ).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        status: r.status,
        clientCode: r.client_code,
      })),
      carePlans: (
        (plans?.results ?? []) as { id: string; tier: string; client_code: string; client_name: string }[]
      ).map((r) => ({
        id: r.id,
        tier: r.tier,
        clientCode: r.client_code,
        clientName: r.client_name,
      })),
    });
  })

  // Whose time the viewer may log or read: only themselves, unless they read everyone's or log for others.
  .get("/people", async (c) => {
    const me = actor(c);
    const wide = can(me.role, "time.readAll") || can(me.role, "time.writeAny");
    if (!wide) return c.json({ people: [{ id: me.id, name: me.name }] });
    // Only roles that log time: the accountant reads the timesheet but never logs, so is not offered as a person.
    const { results } = await c.env.DB.prepare(
      `SELECT id, name FROM staff_users WHERE status = 'active' AND role IN (${TIME_ROLES_SQL}) ORDER BY name COLLATE NOCASE, id LIMIT 100`,
    ).all<{ id: string; name: string }>();
    return c.json({ people: results });
  })

  .post("/", body(createBody), async (c) => {
    const f = c.req.valid("json");
    const db = c.env.DB;
    const me = actor(c);
    const canAny = can(me.role, "time.writeAny");
    const projectId = f.projectId ?? null;
    const carePlanId = f.carePlanId ?? null;
    if ((projectId === null) === (carePlanId === null)) return err(c, BAD_REQUEST, 400);
    const userId = f.userId ?? me.id;
    if (userId !== me.id && !canAny) return err(c, FORBIDDEN, 403);
    const check = entryDateCheck({ today: istToday(), workDate: f.workDate, canWriteAny: canAny });
    if (check === "future") return err(c, FUTURE_DATE, 400);
    if (check === "owner_only_date") return err(c, OWNER_ONLY_DATE, 403);
    const id = uuidv7();
    const t = Date.now();
    const note = f.note?.length ? f.note : null;
    const billable = f.billable ? 1 : 0;
    let done: boolean;
    try {
      done = await mutate(c, {
        action: "time.create",
        entityType: "time_log",
        entityId: id,
        status: 201,
        auditFirst: (auditId, who) =>
          auditFirstRow(db, auditId, who, {
            action: "time.create",
            entityType: "time_log",
            entityExpr: "?7",
            summaryExpr:
              "json_object('timeLogId', ?7, 'userId', ?8, 'workDate', ?9, 'minutes', ?10, 'billable', ?13, 'projectId', ?11, 'carePlanId', ?12)",
            from: `WHERE EXISTS (SELECT 1 FROM staff_users WHERE id = ?8 AND status = 'active' AND role IN (${TIME_ROLES_SQL})) AND ${targetOpen("?11", "?12", "?9")} AND ${DAY_TOTAL("?8", "?9")} + ?10 <= ${DAY_CAP}`,
            params: [id, userId, f.workDate, f.minutes, projectId, carePlanId, billable],
          }),
        after: (g) => [
          db
            .prepare(
              `INSERT INTO time_logs (id, user_id, work_date, minutes, project_id, care_plan_id, note, billable, created_at, updated_at)
               SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9 WHERE ${g.sql(10)}`,
            )
            .bind(id, userId, f.workDate, f.minutes, projectId, carePlanId, note, billable, t, ...g.params),
        ],
      });
    } catch (e) {
      const r = refusal(e);
      if (r) return err(c, r, r === BAD_REQUEST ? 400 : 409);
      throw e;
    }
    if (done) return c.json({ id, createdAt: t, updatedAt: t }, 201);
    return (
      (await whyTargetRefuses(c, {
        userId,
        checkUser: true,
        projectId,
        carePlanId,
        date: f.workDate,
        minutes: f.minutes,
      })) ?? err(c, CONFLICT, 409)
    );
  })

  .patch("/:id", param(idParam), body(patchBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const me = actor(c);
    const canAny = can(me.role, "time.writeAny");
    const row = await db
      .prepare(`SELECT ${entryCols()} FROM time_logs t WHERE t.id = ?1`)
      .bind(id)
      .first<EntryRow>();
    if (!row || (row.user_id !== me.id && !canAny)) return err(c, NOT_FOUND, 404);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    const now = Date.now();
    const locked = authorLocked(row.created_at, now);
    if (locked && !canAny) return err(c, TIME_LOCKED, 403);
    // An entry dated more than 7 days back is the owner's to change, whatever is being changed (minutes, note, target...): the date rule
    // is not only about moving an entry to an old date (M3.5 review, found with M4.3). The row's version guards this read.
    if (
      !canAny &&
      entryDateCheck({ today: istToday(now), workDate: row.work_date, canWriteAny: false }) ===
        "owner_only_date"
    )
      return err(c, OWNER_ONLY_DATE, 403);

    // The target: sending one of the two switches to it (the other is cleared); sending both or a null for the only one is an error.
    let projectId = row.project_id;
    let carePlanId = row.care_plan_id;
    const sentProject = f.projectId !== undefined;
    const sentPlan = f.carePlanId !== undefined;
    if (sentProject || sentPlan) {
      if ((f.projectId ?? null) !== null && (f.carePlanId ?? null) !== null) return err(c, BAD_REQUEST, 400);
      if ((f.projectId ?? null) === null && (f.carePlanId ?? null) === null) return err(c, BAD_REQUEST, 400);
      projectId = f.projectId ?? null;
      carePlanId = f.carePlanId ?? null;
    }
    const workDate = f.workDate ?? row.work_date;
    const newMinutes = f.minutes ?? row.minutes;
    const note = f.note === undefined ? row.note : f.note?.length ? f.note : null;
    const billable = f.billable === undefined ? row.billable : f.billable ? 1 : 0;
    if (workDate !== row.work_date) {
      const check = entryDateCheck({ today: istToday(now), workDate, canWriteAny: canAny });
      if (check === "future") return err(c, FUTURE_DATE, 400);
      if (check === "owner_only_date") return err(c, OWNER_ONLY_DATE, 403);
    }
    const sets: [string, string, string | number | null][] = [];
    const add = (key: string, col: string, now_: string | number | null, was: string | number | null) => {
      if (now_ !== was) sets.push([key, col, now_]);
    };
    add("workDate", "work_date", workDate, row.work_date);
    add("minutes", "minutes", newMinutes, row.minutes);
    add("projectId", "project_id", projectId, row.project_id);
    add("carePlanId", "care_plan_id", carePlanId, row.care_plan_id);
    add("note", "note", note, row.note);
    add("billable", "billable", billable, row.billable);
    if (!sets.length) return c.json({ ok: true, changed: false, updatedAt: row.updated_at });

    // Conditions for what changed. The resulting target's client is always checked, even for a note (it could write personal data back
    // after an erase). A change of minutes, billable flag, date or target needs the target open on the work date (a cancelled project
    // or a plan not active that day refuses it); only a note edit stays allowed there. The day total is checked when the date or the
    // minutes change.
    const timeChanged = sets.some(([k]) => k !== "note");
    const dayChanged = sets.some(([k]) => k === "workDate" || k === "minutes");
    const conds: string[] = [timeChanged ? targetOpen("?12", "?13", "?14") : targetLive("?12", "?13")];
    if (dayChanged) conds.push(`${DAY_TOTAL("t.user_id", "?14", "t.id")} + ?15 <= ${DAY_CAP}`);
    const at = Math.max(now, row.updated_at + 1);
    const lockOverride = locked && canAny;
    const done = await mutate(c, {
      action: "time.update",
      entityType: "time_log",
      entityId: id,
      auditFirst: (auditId, who) =>
        auditFirstRow(db, auditId, who, {
          action: "time.update",
          entityType: "time_log",
          entityExpr: "t.id",
          summaryExpr: `json_object('timeLogId', t.id, 'userId', t.user_id, 'changed', json(?16), 'workDate', ?14, 'minutes', ?15, 'projectId', ?12, 'carePlanId', ?13${lockOverride ? ", 'lockOverride', json('true')" : ""})`,
          from: `FROM time_logs t WHERE t.id = ?7 AND t.updated_at = ?8 AND (?9 = 1 OR (t.user_id = ?10 AND ?11 < t.created_at + ${LOCK_MS})) AND ${conds.join(" AND ")}`,
          params: [
            id,
            f.expectedUpdatedAt,
            canAny ? 1 : 0,
            me.id,
            now,
            projectId,
            carePlanId,
            workDate,
            newMinutes,
            JSON.stringify(sets.map(([k]) => k)),
          ],
        }),
      after: (g) => [
        db
          .prepare(
            `UPDATE time_logs SET ${sets.map(([, col], i) => `${col} = ?${i + 4}`).join(", ")}, updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND ${g.sql(sets.length + 4)}`,
          )
          .bind(id, f.expectedUpdatedAt, at, ...sets.map((s) => s[2]), ...g.params),
      ],
    }).catch((e: unknown) => {
      const r = refusal(e);
      if (r) return r;
      throw e;
    });
    if (done === true) return c.json({ ok: true, changed: true, updatedAt: at, lockOverride });
    if (done !== false) return err(c, done, done === BAD_REQUEST ? 400 : 409);
    const again = await db
      .prepare(`SELECT ${entryCols()} FROM time_logs t WHERE t.id = ?1`)
      .bind(id)
      .first<EntryRow>();
    if (!again || (again.user_id !== me.id && !canAny)) return err(c, NOT_FOUND, 404);
    if (again.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (authorLocked(again.created_at, Date.now()) && !canAny) return err(c, TIME_LOCKED, 403);
    return (
      (await whyTargetRefuses(c, {
        projectId,
        carePlanId,
        date: workDate,
        minutes: newMinutes,
        except: id,
        userId: again.user_id,
        checkUser: false,
        liveOnly: !timeChanged,
      })) ?? err(c, CONFLICT, 409)
    );
  })

  .delete("/:id", param(idParam), query(deleteQuery), async (c) => {
    const { id } = c.req.valid("param");
    const expected = Number(c.req.valid("query").expectedUpdatedAt);
    const db = c.env.DB;
    const me = actor(c);
    const canAny = can(me.role, "time.writeAny");
    const row = await db
      .prepare(`SELECT ${entryCols()} FROM time_logs t WHERE t.id = ?1`)
      .bind(id)
      .first<EntryRow>();
    if (!row || (row.user_id !== me.id && !canAny)) return err(c, NOT_FOUND, 404);
    if (row.updated_at !== expected) return err(c, STALE_VERSION, 409);
    const now = Date.now();
    const locked = authorLocked(row.created_at, now);
    if (locked && !canAny) return err(c, TIME_LOCKED, 403);
    // The same date rule as PATCH: an entry dated more than 7 days back is the owner's to remove (M4.3 re-check).
    if (
      !canAny &&
      entryDateCheck({ today: istToday(now), workDate: row.work_date, canWriteAny: false }) ===
        "owner_only_date"
    )
      return err(c, OWNER_ONLY_DATE, 403);
    const lockOverride = locked && canAny;
    const done = await mutate(c, {
      action: "time.delete",
      entityType: "time_log",
      entityId: id,
      auditFirst: (auditId, who) =>
        auditFirstRow(db, auditId, who, {
          action: "time.delete",
          entityType: "time_log",
          entityExpr: "t.id",
          summaryExpr: `json_object('timeLogId', t.id, 'userId', t.user_id, 'workDate', t.work_date, 'minutes', t.minutes, 'projectId', t.project_id, 'carePlanId', t.care_plan_id${lockOverride ? ", 'lockOverride', json('true')" : ""})`,
          from: `FROM time_logs t WHERE t.id = ?7 AND t.updated_at = ?8 AND (?9 = 1 OR (t.user_id = ?10 AND ?11 < t.created_at + ${LOCK_MS}))`,
          params: [id, expected, canAny ? 1 : 0, me.id, now],
        }),
      after: (g) => [
        db
          .prepare(`DELETE FROM time_logs WHERE id = ?1 AND updated_at = ?2 AND ${g.sql(3)}`)
          .bind(id, expected, ...g.params),
      ],
    });
    if (done) return c.json({ ok: true, lockOverride });
    const again = await db
      .prepare(`SELECT ${entryCols()} FROM time_logs t WHERE t.id = ?1`)
      .bind(id)
      .first<EntryRow>();
    if (!again || (again.user_id !== me.id && !canAny)) return err(c, NOT_FOUND, 404);
    if (again.updated_at !== expected) return err(c, STALE_VERSION, 409);
    return authorLocked(again.created_at, Date.now()) && !canAny
      ? err(c, TIME_LOCKED, 403)
      : err(c, CONFLICT, 409);
  });

type ListRow = EntryRow & {
  user_name: string | null;
  project_code: string | null;
  client_code: string | null;
  care_tier: string | null;
};

/** The list statement, exported so a test can EXPLAIN it. `today` is the placeholder that carries today's IST date (for the tier in force). */
export const listSql = (where: string[], order: string, limit: number, today: string) =>
  `SELECT ${entryCols()}, (SELECT name FROM staff_users WHERE id = t.user_id) AS user_name, (SELECT code FROM projects WHERE id = t.project_id) AS project_code,
          (SELECT code FROM clients WHERE id = cp.client_id) AS client_code, ${TIER_ON("cp.id", today)} AS care_tier
   FROM time_logs t LEFT JOIN care_plans cp ON cp.id = t.care_plan_id WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit + 1}`;
