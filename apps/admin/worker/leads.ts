// Leads API (M3.2, ADM-LEAD-01..06). Every route is a row of ROUTES (guard.ts) with its matrix action and audit action; every
// mutation is ONE batch through `mutate` (the change, its audit row and access row together).
//
// Personal data and the audit log (analyst early check, M3.2; Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11)): `audit_log` is append-only and kept for years,
// so a lead's audit row holds the lead reference, ids, field NAMES and stage codes, never a name, an email address, a phone number,
// a note or a message. What changed in a lead's contact fields (before and after) goes on the lead's timeline (`lead_activities`),
// which is deleted with the lead by the retention clean-up.
import { emailAddress } from "@techaust/auth";
import { clientTaxCheck } from "@techaust/core/clients";
import { isBudgetBand, isCountryCode, isTimeline } from "@techaust/core/form-labels";
import { uuidv7 } from "@techaust/core/ids";
import {
  deleteAfterSql,
  LEAD_DELETABLE_SQL,
  LEAD_DUPLICATE_WINDOW_MS,
  LEAD_PURGE_NOTICE_DAYS,
  LEAD_STAGES,
  type LeadStage,
  LOST_REASONS,
  normaliseEmail,
  touchLeadSql,
} from "@techaust/core/lead-lifecycle";
import { generateLeadRef } from "@techaust/core/lead-ref";
import type { Currency } from "@techaust/core/money";
import { decide, ROLES } from "@techaust/core/permissions";
import {
  fillReplyTemplate,
  hasUnfilledGap,
  LEAD_REPLIES_PER_HOUR,
  REPLY_TEMPLATES,
  replyTemplateById,
} from "@techaust/core/reply-templates";
import { nameOrLegal } from "@techaust/core/text";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { insertClientStmt, taxError, taxWarnings } from "./clients.ts";
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
import { buildNewDraft, newDraftStatements } from "./document-draft.ts";
import { decisionOf, LEAD_DECISION_SQL } from "./document-offer.ts";
import { body, idParam, isUnique, optText, param, query, STALE_VERSION, text } from "./http.ts";
import { type Direction, decodeCursor, keysetSql, PREFIX_END, pageOf } from "./keyset.ts";
import { queueEmail } from "./mail.ts";
import {
  ITEM_COLS,
  type ItemRow,
  NEWEST_TERMS,
  readSettings,
  SETTINGS_READ,
  todayIst,
} from "./quote-model.ts";

// ---- errors, validators ---------------------------------------------------------------------------------------------

const ALREADY_CONVERTED: ApiError = { code: "already_converted", message: "That lead is already a client" };
const GSTIN_IN_USE: ApiError = { code: "gstin_in_use", message: "A client with that GSTIN already exists" };
const OWNER_INVALID: ApiError = { code: "owner_invalid", message: "Choose an active member of staff" };
const ANSWERS_FIXED: ApiError = {
  code: "lead_answers_fixed",
  message: "The website form's answers can't be changed",
};
/** The quote form's answers on a lead: only a manual lead's can be changed (`PATCH /leads/:id`). */
const QUOTE_ANSWER_COLUMNS: readonly string[] = ["currency", "budget_band", "timeline"];
const LOST_REASON_REQUIRED: ApiError = {
  code: "lost_reason_required",
  message: "Choose why the lead was lost",
};
const UNFILLED_GAP: ApiError = {
  code: "unfilled_gap",
  message: "Fill in the part in square brackets before sending",
};
const RATE_LIMITED: ApiError = {
  code: "rate_limited",
  message: "You have sent a lot of replies this hour. Try again later",
};

const country = z.string().check(z.regex(/^[A-Z]{2}$/));
/** The code a lead carries when the visitor did not know which service. Every other code is a row of `catalogue_items` (M4.1). */
const NOT_SURE = "not-sure";
/** The catalogue name of the lead's service code, read in the same statement as the lead (no seed import, M4.1). */
const SERVICE_NAME_SQL = "(SELECT name FROM catalogue_items WHERE code = l.service_code)";

/** The service the lead asked for, as the words a person reads ("and", never "&"); `name` is the catalogue's current name. */
function serviceTitle(code: string | null, name: string | null): string | null {
  if (!code) return null;
  if (code === NOT_SURE) return "Not sure yet";
  return (name ?? code).replaceAll(" & ", " and ");
}

/** The same row, written only while the request's audit row exists (the side statements of `mutate`). */
const guardedActivity = (
  db: D1Database,
  g: { sql: (at: number) => string; params: readonly unknown[] },
  leadId: string,
  kind: string,
  bodyText: string | null,
  actorId: string | null,
  t: number,
  id = uuidv7(),
) =>
  db
    .prepare(
      `INSERT INTO lead_activities (id, lead_id, kind, body, actor_id, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE ${g.sql(7)}`,
    )
    .bind(id, leadId, kind, bodyText, actorId, t, ...g.params);

/** Who the lead notifies and who may own one (members who may read leads), derived from the matrix. */
const LEAD_READERS = ROLES.filter((r) => decide(r, "leads.read") !== "deny");

/** An active member who can read leads (the roles are code constants, so they are safe in the SQL text). */
const activeStaff = async (db: D1Database, id: string) =>
  (await db
    .prepare(
      `SELECT 1 AS x FROM staff_users WHERE id = ?1 AND status = 'active' AND role IN (${LEAD_READERS.map((r) => `'${r}'`).join(", ")})`,
    )
    .bind(id)
    .first()) !== null;

// ---- the list (ADM-LEAD-02) -----------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const SORTS = { created: "created_at", activity: "last_activity_at", next_action: "next_action_at" } as const;

const listQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  stage: z.optional(z.enum(LEAD_STAGES)),
  owner: z.optional(z.string().check(z.maxLength(64))),
  source: z.optional(z.enum(["web", "manual"])),
  service: z.optional(z.string().check(z.maxLength(20))),
  overdue: z.optional(z.enum(["1"])),
  deletion: z.optional(z.enum(["1"])),
  sort: z.optional(z.enum(["created", "activity", "next_action"])),
  dir: z.optional(z.enum(["asc", "desc"])),
  q: z.optional(z.string().check(z.maxLength(100))),
  after: z.optional(z.string().check(z.maxLength(400))),
  before: z.optional(z.string().check(z.maxLength(400))),
});

type ListRow = {
  id: string;
  ref: string;
  stage: string;
  lost_reason: string | null;
  source: string;
  service_code: string | null;
  service_name: string | null;
  contact_name: string;
  contact_email: string;
  contact_company: string | null;
  owner_id: string | null;
  owner_name: string | null;
  next_action_at: number | null;
  next_action_note: string | null;
  client_id: string | null;
  duplicate_of: string | null;
  last_activity_at: number | null;
  delete_after: number | null;
  legal_hold: number;
  created_at: number;
  k: number;
};

const LIST_COLUMNS = `l.id, l.ref, l.stage, l.lost_reason, l.source, l.service_code, ${SERVICE_NAME_SQL} AS service_name, l.contact_name, l.contact_email, l.contact_company, l.owner_id, (SELECT name FROM staff_users WHERE id = l.owner_id) AS owner_name, l.next_action_at, l.next_action_note, l.client_id, l.duplicate_of, l.last_activity_at, l.delete_after, l.legal_hold, l.created_at`;

const listItem = (r: ListRow, now: number) => ({
  id: r.id,
  ref: r.ref,
  stage: r.stage,
  lostReason: r.lost_reason,
  source: r.source,
  serviceCode: r.service_code,
  serviceName: serviceTitle(r.service_code, r.service_name),
  name: r.contact_name,
  email: r.contact_email,
  company: r.contact_company,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  nextActionAt: r.next_action_at,
  nextActionNote: r.next_action_note,
  nextActionOverdue:
    r.next_action_at !== null && r.next_action_at < now && r.stage !== "won" && r.stage !== "lost",
  clientId: r.client_id,
  duplicateOf: r.duplicate_of,
  lastActivityAt: r.last_activity_at,
  deleteAfter: r.delete_after,
  scheduledForDeletion:
    r.client_id === null &&
    !r.legal_hold &&
    r.delete_after !== null &&
    r.delete_after <= now + LEAD_PURGE_NOTICE_DAYS * DAY_MS,
  legalHold: Boolean(r.legal_hold),
  createdAt: r.created_at,
});

/** The prefix match on four indexed columns; each branch is its own index range (ref, email, name and company, the last two without case). */
function searchSql(q: string, bind: unknown[]): string {
  const at = bind.length + 1;
  const ref = q.toUpperCase();
  const lower = q.toLowerCase();
  bind.push(ref, `${ref}${PREFIX_END}`, lower, `${lower}${PREFIX_END}`, q, `${q}${PREFIX_END}`);
  return `l.id IN (
    SELECT id FROM leads WHERE ref >= ?${at} AND ref < ?${at + 1}
    UNION SELECT id FROM leads WHERE contact_email >= ?${at + 2} AND contact_email < ?${at + 3}
    UNION SELECT id FROM leads WHERE contact_name COLLATE NOCASE >= ?${at + 4} AND contact_name COLLATE NOCASE < ?${at + 5}
    UNION SELECT id FROM leads WHERE contact_company COLLATE NOCASE >= ?${at + 4} AND contact_company COLLATE NOCASE < ?${at + 5})`;
}

async function runList(c: Ctx, f: z.infer<typeof listQuery>) {
  const now = Date.now();
  const limit = f.limit === "50" ? 50 : 25;
  const dir: Direction = f.before ? "before" : "after";
  const raw = f.before ?? f.after;
  const cur = raw === undefined ? null : decodeCursor(raw);
  if (raw !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);

  const where: string[] = [];
  const bind: unknown[] = [];
  const add = (sql: (n: number) => string, ...v: unknown[]) => {
    where.push(sql(bind.length + 1));
    bind.push(...v);
  };
  if (f.stage) add((n) => `l.stage = ?${n}`, f.stage);
  if (f.owner === "none") where.push("l.owner_id IS NULL");
  else if (f.owner) add((n) => `l.owner_id = ?${n}`, f.owner === "me" ? actor(c).id : f.owner);
  if (f.source) add((n) => `l.source = ?${n}`, f.source);
  if (f.service) add((n) => `l.service_code = ?${n}`, f.service);
  if (f.overdue) add((n) => `l.next_action_at < ?${n} AND l.stage NOT IN ('won', 'lost')`, now);
  const deletion = Boolean(f.deletion);
  if (deletion) {
    // The 14-day view (it is also the dry-run report): leads the clean-up may delete that are due within the notice period.
    where.push(
      LEAD_DELETABLE_SQL.replaceAll("client_id", "l.client_id").replaceAll("legal_hold", "l.legal_hold"),
    );
    add((n) => `l.delete_after <= ?${n}`, now + LEAD_PURGE_NOTICE_DAYS * DAY_MS);
  }
  const q = f.q?.trim();
  if (q && q.length >= 2) where.push(searchSql(q, bind));

  // Sort: the scheduled-for-deletion view is always by deletion date (soonest first); otherwise created (default), last activity
  // or next action. Leads with no next action are not in the next-action order (the keyset needs a value).
  const sort = f.sort ?? "created";
  const col = deletion ? "l.delete_after" : `l.${SORTS[sort]}`;
  const asc = deletion ? true : f.dir ? f.dir === "asc" : sort === "next_action";
  if (!deletion && sort === "next_action") where.push("l.next_action_at IS NOT NULL");
  if (!deletion && sort === "activity") where.push("l.last_activity_at IS NOT NULL");
  const order = keysetSql(col, "l.id", asc, dir, bind.length + 1);
  if (cur) {
    where.push(order.where);
    bind.push(cur.k, cur.id);
  }
  const from = deletion ? "leads AS l INDEXED BY leads_delete_due" : "leads AS l";
  const sql = `SELECT ${LIST_COLUMNS}, ${col} AS k FROM ${from}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order.order} LIMIT ${limit + 1}`;
  const { results } = await c.env.DB.prepare(sql)
    .bind(...bind)
    .all<ListRow>();
  const page = pageOf(results, limit, dir, cur !== null, (r) => ({ k: r.k, id: r.id }));
  const items = { leads: page.items.map((r) => listItem(r, now)), next: page.next, prev: page.prev };
  // The deletion view says whether the clean-up only lists (owner, 2026-10-24); anything but "live" is a dry run, as in jobs.
  if (deletion)
    return c.json({
      ...items,
      purgeMode: (c.env.LEAD_PURGE_MODE as string | undefined) === "live" ? "live" : "dry_run",
    });
  return c.json(items);
}

/** The list's own SQL for a test to EXPLAIN (search over four prefix ranges). */
export const SEARCH_PLAN_SQL = (q: string) => {
  const bind: unknown[] = [];
  return { sql: `SELECT l.id FROM leads AS l WHERE ${searchSql(q, bind)}`, bind };
};

// ---- the lead page (ADM-LEAD-03) ----------------------------------------------------------------------------------

type DetailRow = ListRow & {
  request_type: string | null;
  plan: string | null;
  budget_band: string | null;
  timeline: string | null;
  currency: string | null;
  message: string | null;
  tools: string | null;
  contact_phone: string | null;
  contact_country: string | null;
  call_window: string | null;
  utm: string | null;
  source_page: string | null;
  referrer_host: string | null;
  consent: string | null;
  proposal_id: string | null;
  updated_at: number;
  client_code: string | null;
  client_name: string | null;
  proposal_status: string | null;
};

type ActivityRow = {
  id: string;
  kind: string;
  body: string | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: number;
};

const ACTIVITY_SQL =
  "SELECT a.id, a.kind, a.body, a.actor_id, (SELECT name FROM staff_users WHERE id = a.actor_id) AS actor_name, a.created_at FROM lead_activities a WHERE a.lead_id = ?1";
const activityJson = (r: ActivityRow) => ({
  id: r.id,
  kind: r.kind,
  body: r.body,
  actorId: r.actor_id,
  actorName: r.actor_name,
  createdAt: r.created_at,
});

const timelineQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});

async function timelinePage(
  c: Ctx,
  leadId: string,
  limitText: string | undefined,
  after: string | undefined,
) {
  const limit = limitText === "50" ? 50 : 25;
  const cur = after === undefined ? null : decodeCursor(after);
  if (after !== undefined && (!cur || typeof cur.k !== "number")) return null;
  const order = keysetSql("a.created_at", "a.id", false, "after", 2);
  const { results } = await c.env.DB.prepare(
    `${ACTIVITY_SQL}${cur ? ` AND ${order.where}` : ""} ORDER BY ${order.order} LIMIT ${limit + 1}`,
  )
    .bind(...(cur ? [leadId, cur.k, cur.id] : [leadId]))
    .all<ActivityRow>();
  return pageOf(results, limit, "after", cur !== null, (r) => ({ k: r.created_at, id: r.id }));
}

// ---- conversion (ADM-LEAD-04) -----------------------------------------------------------------------------------------

/** The client fields the lead does not carry; the rest are pre-filled from the lead. */
export const convertRequest = z.object({
  type: z.enum(["business", "individual"]),
  country,
  gstStatus: z.enum(["registered", "unregistered", "overseas"]),
  gstin: z.optional(text(20)),
  /** Required for unregistered Indian clients (owner Q1, 2026-10-25); a registered client's defaults to the GSTIN's. Researched 2026-10-28, Rule 46 CGST Rules (08-C RA-05). */
  stateCode: z.optional(z.string().check(z.regex(/^\d{2}$/))),
  /** The lead becomes the client's billing contact, who by default may see finance (M3.2 carry-in). */
  billingContact: z.optional(z.boolean()),
  currency: z.enum(["INR", "USD"]),
  legalName: z.optional(text(200)),
  displayName: z.optional(text(120)),
});

type LeadRow = {
  id: string;
  ref: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  contact_company: string | null;
  service_code: string | null;
  service_name: string | null;
  message: string | null;
  client_id: string | null;
  consent: string | null;
};

// ---- the routes -----------------------------------------------------------------------------------------------------

const createRequest = z.object({
  name: text(100),
  email: emailAddress,
  phone: z.optional(optText(40)),
  company: z.optional(optText(120)),
  country: z.optional(z.nullable(country)),
  serviceCode: z.optional(z.nullable(z.string().check(z.maxLength(20)))),
  message: z.optional(optText(2000)),
  ownerId: z.optional(z.nullable(z.string().check(z.maxLength(64)))),
  nextActionAt: z.optional(z.nullable(z.int().check(z.gte(0)))),
  nextActionNote: z.optional(optText(500)),
  // FX-3 (A3 8): the quote form's answers, given by hand. A budget band needs the currency it is a band of (core `isBudgetBand`); the
  // timeline is one of the form's (core `isTimeline`). The SPA shows them with core's labels (`budgetBandLabel`, `TIMELINE_LABELS`).
  currency: z.optional(z.nullable(z.enum(["INR", "USD"]))),
  budgetBand: z.optional(z.nullable(z.string().check(z.maxLength(20)))),
  timeline: z.optional(z.nullable(z.string().check(z.maxLength(20)))),
});

const patchRequest = z.object({
  /** The `updatedAt` the page was loaded with; a different value is a 409 `stale_version`. */
  expectedUpdatedAt: z.int(),
  ownerId: z.optional(z.nullable(z.string().check(z.maxLength(64)))),
  nextActionAt: z.optional(z.nullable(z.int().check(z.gte(0)))),
  nextActionNote: z.optional(optText(500)),
  name: z.optional(text(100)),
  email: z.optional(emailAddress),
  phone: z.optional(optText(40)),
  company: z.optional(optText(120)),
  country: z.optional(z.nullable(country)),
  // FX-3 round 2 (docs/13 2026-10-29): a manual lead's quote answers can be changed later, with the creation checks on the values the lead
  // ends up with (a band needs its own currency). A website lead's answers are the visitor's own words: 409 `lead_answers_fixed`.
  currency: z.optional(z.nullable(z.enum(["INR", "USD"]))),
  budgetBand: z.optional(z.nullable(z.string().check(z.maxLength(20)))),
  timeline: z.optional(z.nullable(z.string().check(z.maxLength(20)))),
});

const noteRequest = z.object({ body: text(2000) });
const stageRequest = z.object({
  stage: z.enum(LEAD_STAGES),
  lostReason: z.optional(z.enum(LOST_REASONS)),
});
const replyRequest = z.object({
  subject: text(200),
  body: text(4000),
  templateId: z.optional(z.string().check(z.maxLength(40))),
});

/** Replies one member may send per hour (shared with the reply screen). */
export const REPLIES_PER_HOUR = LEAD_REPLIES_PER_HOUR;

const norm = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

export const leads = new Hono<AppEnv>()
  // ---- list and board ----
  .get("/", query(listQuery), (c) => runList(c, c.req.valid("query")))

  .get("/board", async (c) => {
    const now = Date.now();
    const db = c.env.DB;
    const per = 25;
    const [counts, ...pages] = await db.batch<ListRow & { n: number }>([
      db.prepare("SELECT stage, count(*) AS n FROM leads GROUP BY stage"),
      ...LEAD_STAGES.map((stage) =>
        db
          .prepare(
            `SELECT ${LIST_COLUMNS}, l.last_activity_at AS k FROM leads AS l WHERE l.stage = ?1 ORDER BY l.last_activity_at DESC, l.id DESC LIMIT ${per + 1}`,
          )
          .bind(stage),
      ),
    ]);
    const countOf = new Map((counts?.results ?? []).map((r) => [r.stage, r.n]));
    return c.json({
      stages: LEAD_STAGES.map((stage, i) => {
        const page = pageOf(pages[i]?.results ?? [], per, "after", false, (r) => ({ k: r.k ?? 0, id: r.id }));
        return {
          stage,
          count: countOf.get(stage) ?? 0,
          leads: page.items.map((r) => listItem(r, now)),
          // continue with GET /leads?stage=…&sort=activity&after=…
          next: page.next,
        };
      }),
    });
  })

  // ---- who a lead can be assigned to: active members whose role works leads (the owner picker and filter), and the caller ----
  .get("/assignees", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, name FROM staff_users WHERE status = 'active' AND role IN (${LEAD_READERS.map((_, i) => `?${i + 1}`).join(", ")}) ORDER BY name COLLATE NOCASE, id`,
    )
      .bind(...LEAD_READERS)
      .all<{ id: string; name: string }>();
    return c.json({ me: actor(c).id, assignees: results });
  })

  // ---- create by hand (ADM-LEAD-01) ----
  .post("/", body(createRequest), async (c) => {
    const u = actor(c);
    const f = c.req.valid("json");
    const db = c.env.DB;
    if (f.country && !isCountryCode(f.country)) return err(c, BAD_REQUEST, 400);
    const currency = f.currency ?? null;
    const band = f.budgetBand ?? null;
    const timeline = f.timeline ?? null;
    if (band !== null && (currency === null || !isBudgetBand(currency, band)))
      return err(c, BAD_REQUEST, 400);
    if (timeline !== null && !isTimeline(timeline)) return err(c, BAD_REQUEST, 400);
    const service = f.serviceCode ?? null;
    let serviceName: string | null = null;
    if (service !== null && service !== NOT_SURE) {
      serviceName =
        (
          await db
            // A retired service (inactive) cannot start a new lead; the write below checks it again.
            .prepare("SELECT name FROM catalogue_items WHERE code = ?1 AND active = 1")
            .bind(service)
            .first<{ name: string }>()
        )?.name ?? null;
      if (serviceName === null) return err(c, BAD_REQUEST, 400);
    }
    const owner = f.ownerId ?? null;
    if (owner !== null && !(await activeStaff(db, owner))) return err(c, OWNER_INVALID, 400);

    const t = Date.now();
    const id = uuidv7();
    const email = normaliseEmail(f.email);
    const title = `New lead: ${f.name}, ${serviceTitle(service, serviceName) ?? "General enquiry"}`.slice(
      0,
      200,
    );
    const roles = LEAD_READERS.map((_, i) => `?${i + 5}`).join(", ");
    let ref = generateLeadRef();
    for (let attempt = 0; ; attempt++) {
      try {
        const done = await mutate(c, {
          main: db
            .prepare(
              `INSERT INTO leads (id, ref, source, service_code, message, contact_name, contact_email, contact_phone, contact_company,
                 contact_country, owner_id, next_action_at, next_action_note, duplicate_of, last_activity_at, delete_after, currency, budget_band, timeline)
               SELECT ?1, ?2, 'manual', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                 (SELECT id FROM leads WHERE contact_email = ?6 AND created_at >= ?14 AND created_at <= ?13 ORDER BY created_at DESC LIMIT 1),
                 ?13, ${deleteAfterSql("?13")}, ?16, ?17, ?18
               WHERE ?3 IS NULL OR ?3 = ?15 OR EXISTS (SELECT 1 FROM catalogue_items WHERE code = ?3 AND active = 1)`,
            )
            .bind(
              id,
              ref,
              service,
              norm(f.message),
              f.name,
              email,
              norm(f.phone),
              norm(f.company),
              f.country ?? null,
              owner,
              f.nextActionAt ?? null,
              norm(f.nextActionNote),
              t,
              t - LEAD_DUPLICATE_WINDOW_MS,
              NOT_SURE,
              currency,
              band,
              timeline,
            ),
          action: "lead.create",
          entityType: "lead",
          entityId: id,
          summary: { ref },
          status: 201,
          side: (g) => [
            guardedActivity(db, g, id, "created", "Added by hand", u.id, t),
            // The bell (ADM-G-09): everyone who may read leads, except the person who made it.
            db
              .prepare(
                `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
                 SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'lead.new', 'lead', ?1, ?2, ?3 FROM staff_users u
                 WHERE u.status = 'active' AND u.id <> ?4 AND u.role IN (${roles}) AND ${g.sql(5 + LEAD_READERS.length)}`,
              )
              .bind(id, title, `/leads/${id}`, u.id, ...LEAD_READERS, ...g.params),
          ],
        });
        if (!done) return err(c, BAD_REQUEST, 400);
        break;
      } catch (e) {
        if (isUnique(e, "leads.ref") && attempt < 5) {
          ref = generateLeadRef();
          continue;
        }
        throw e;
      }
    }
    return c.json({ id, ref }, 201);
  })

  // ---- one lead ----
  .get("/:id", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const order = keysetSql("a.created_at", "a.id", false, "after", 2);
    const [lead, dups, activities, decisionR] = await db.batch<DetailRow & ActivityRow & ListRow>([
      db
        .prepare(
          `SELECT ${LIST_COLUMNS}, l.request_type, l.plan, l.budget_band, l.timeline, l.currency, l.message, l.tools, l.contact_phone, l.contact_country,
             l.call_window, l.utm, l.source_page, l.referrer_host, l.consent, l.proposal_id, l.updated_at,
             (SELECT code FROM clients WHERE id = l.client_id) AS client_code, (SELECT display_name FROM clients WHERE id = l.client_id) AS client_name,
             (SELECT status FROM documents WHERE id = l.proposal_id) AS proposal_status, 0 AS k
           FROM leads l WHERE l.id = ?1`,
        )
        .bind(id),
      // The earlier lead this one repeats, and the later leads that repeat this one (linked, never merged).
      db
        .prepare(
          `SELECT d.id, d.ref, d.stage, d.created_at, 'earlier' AS rel FROM leads d WHERE d.id = (SELECT duplicate_of FROM leads WHERE id = ?1)
           UNION ALL SELECT d.id, d.ref, d.stage, d.created_at, 'later' AS rel FROM leads d WHERE d.duplicate_of = ?1 LIMIT 10`,
        )
        .bind(id),
      db.prepare(`${ACTIVITY_SQL} ORDER BY ${order.order} LIMIT 26`).bind(id),
      // M4.5: how the client answered the proposal (accepted or declined), if they did.
      db.prepare(LEAD_DECISION_SQL).bind(id),
    ]);
    const r = lead?.results[0] as DetailRow | undefined;
    if (!r) return err(c, NOT_FOUND, 404);
    const now = Date.now();
    const acts = pageOf((activities?.results ?? []) as ActivityRow[], 25, "after", false, (a) => ({
      k: a.created_at,
      id: a.id,
    }));
    return c.json({
      lead: {
        ...listItem(r, now),
        requestType: r.request_type,
        plan: r.plan,
        budgetBand: r.budget_band,
        timeline: r.timeline,
        currency: r.currency,
        message: r.message,
        tools: r.tools ? JSON.parse(r.tools) : null,
        phone: r.contact_phone,
        country: r.contact_country,
        callWindow: r.call_window,
        utm: r.utm ? JSON.parse(r.utm) : null,
        sourcePage: r.source_page,
        referrerHost: r.referrer_host,
        consent: r.consent ? JSON.parse(r.consent) : null,
        proposalId: r.proposal_id,
        /** Send this back as `expectedUpdatedAt` with the next PATCH. */
        updatedAt: r.updated_at,
      },
      client: r.client_id ? { id: r.client_id, code: r.client_code, name: r.client_name } : null,
      proposal: r.proposal_id ? { id: r.proposal_id, status: r.proposal_status } : null,
      /** Additive (M4.5): the client's answer to the proposal, or null. A decline also moves the lead to lost with the reason (stage automation). */
      decision: decisionOf((decisionR?.results[0] ?? undefined) as Record<string, unknown> | undefined),
      duplicates: ((dups?.results ?? []) as unknown as Record<string, unknown>[]).map((d) => ({
        id: d.id,
        ref: d.ref,
        stage: d.stage,
        createdAt: d.created_at,
        relation: d.rel,
      })),
      timeline: { items: acts.items.map(activityJson), next: acts.next },
    });
  })

  .get("/:id/activities", param(idParam), query(timelineQuery), async (c) => {
    const { id } = c.req.valid("param");
    const q = c.req.valid("query");
    const exists = await c.env.DB.prepare("SELECT 1 AS x FROM leads WHERE id = ?1").bind(id).first();
    if (!exists) return err(c, NOT_FOUND, 404);
    const page = await timelinePage(c, id, q.limit, q.after);
    if (!page) return err(c, BAD_REQUEST, 400);
    return c.json({ items: page.items.map(activityJson), next: page.next });
  })

  // ---- edit the fields a person owns (owner, next action, contact; a manual lead's quote answers) ----
  .patch("/:id", param(idParam), body(patchRequest), async (c) => {
    const u = actor(c);
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const lead = await db
      .prepare(
        "SELECT ref, source, owner_id, next_action_at, next_action_note, contact_name, contact_email, contact_phone, contact_company, contact_country, currency, budget_band, timeline, updated_at FROM leads WHERE id = ?1",
      )
      .bind(id)
      .first<Record<string, string | number | null>>();
    if (!lead) return err(c, NOT_FOUND, 404);
    if (lead.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (f.country && !isCountryCode(f.country)) return err(c, BAD_REQUEST, 400);
    // The quote answers as the lead will hold them, checked as at creation: a band is one of its own currency's, the timeline the form's.
    // The UPDATE below runs only on this same version of the row (`updated_at`), so what is checked here is what it changes.
    const nextCurrency = f.currency !== undefined ? f.currency : (lead.currency as Currency | null);
    const nextBand = f.budgetBand !== undefined ? f.budgetBand : (lead.budget_band as string | null);
    const nextTimeline = f.timeline !== undefined ? f.timeline : (lead.timeline as string | null);
    if (nextBand !== null && (nextCurrency === null || !isBudgetBand(nextCurrency, nextBand)))
      return err(c, BAD_REQUEST, 400);
    if (nextTimeline !== null && !isTimeline(nextTimeline)) return err(c, BAD_REQUEST, 400);
    if (f.ownerId && !(await activeStaff(db, f.ownerId))) return err(c, OWNER_INVALID, 400);

    // field name (as the timeline names it), column, wanted value
    const wanted: [string, string, string | number | null | undefined][] = [
      ["owner", "owner_id", f.ownerId],
      ["next_action_at", "next_action_at", f.nextActionAt],
      [
        "next_action_note",
        "next_action_note",
        f.nextActionNote === undefined ? undefined : norm(f.nextActionNote),
      ],
      ["name", "contact_name", f.name],
      ["email", "contact_email", f.email === undefined ? undefined : normaliseEmail(f.email)],
      ["phone", "contact_phone", f.phone === undefined ? undefined : norm(f.phone)],
      ["company", "contact_company", f.company === undefined ? undefined : norm(f.company)],
      ["country", "contact_country", f.country],
      ["currency", "currency", f.currency],
      ["budget_band", "budget_band", f.budgetBand],
      ["timeline", "timeline", f.timeline],
    ];
    const changes = wanted.filter(
      (w): w is [string, string, string | number | null] => w[2] !== undefined && w[2] !== lead[w[1]],
    );
    if (!changes.length) return c.json({ ok: true, changed: false, updatedAt: lead.updated_at });
    if (lead.source !== "manual" && changes.some(([, col]) => QUOTE_ANSWER_COLUMNS.includes(col)))
      return err(c, ANSWERS_FIXED, 409);

    const t = Date.now();
    const sets = changes.map(([, col], i) => `${col} = ?${i + 4}`);
    const ref = lead.ref as string;
    const done = await mutate(c, {
      main: db
        .prepare(
          `UPDATE leads SET ${sets.join(", ")}, updated_at = ?3, ${touchLeadSql("?3")} WHERE id = ?1 AND updated_at = ?2`,
        )
        .bind(id, f.expectedUpdatedAt, t, ...changes.map((ch) => ch[2])),
      action: "lead.update",
      entityType: "lead",
      entityId: id,
      // Field NAMES only: the values (a name, an email address, a phone number) stay on the timeline, which the retention
      // clean-up deletes with the lead. The audit log is append-only and outlives it.
      summary: { ref, changed: changes.map(([name]) => name) },
      side: (g) => [
        guardedActivity(
          db,
          g,
          id,
          "updated",
          JSON.stringify({
            changes: changes.map(([field, col, to]) => ({ field, from: lead[col] ?? null, to })),
          }),
          u.id,
          t,
        ),
      ],
    });
    if (!done) return err(c, STALE_VERSION, 409);
    return c.json({ ok: true, changed: true, updatedAt: t });
  })

  // ---- notes ----
  .post("/:id/notes", param(idParam), body(noteRequest), async (c) => {
    const u = actor(c);
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const lead = await db.prepare("SELECT ref FROM leads WHERE id = ?1").bind(id).first<{ ref: string }>();
    if (!lead) return err(c, NOT_FOUND, 404);
    const t = Date.now();
    const activityId = uuidv7();
    const done = await mutate(c, {
      main: db.prepare(`UPDATE leads SET ${touchLeadSql("?2")} WHERE id = ?1`).bind(id, t),
      action: "lead.note",
      entityType: "lead",
      entityId: id,
      summary: { ref: lead.ref },
      status: 201,
      side: (g) => [guardedActivity(db, g, id, "note", f.body, u.id, t, activityId)],
    });
    if (!done) return err(c, NOT_FOUND, 404);
    return c.json({ id: activityId }, 201);
  })

  // ---- stage ----
  .post("/:id/stage", param(idParam), body(stageRequest), async (c) => {
    const u = actor(c);
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    if (f.stage === "lost" && !f.lostReason) return err(c, LOST_REASON_REQUIRED, 400);
    if (f.stage !== "lost" && f.lostReason) return err(c, BAD_REQUEST, 400);
    const lead = await db
      .prepare("SELECT ref, stage, lost_reason, updated_at FROM leads WHERE id = ?1")
      .bind(id)
      .first<{ ref: string; stage: LeadStage; lost_reason: string | null; updated_at: number }>();
    if (!lead) return err(c, NOT_FOUND, 404);
    const reason = f.stage === "lost" ? (f.lostReason ?? null) : null;
    if (lead.stage === f.stage && lead.lost_reason === reason)
      return c.json({ ok: true, changed: false, updatedAt: lead.updated_at });
    const t = Date.now();
    const done = await mutate(c, {
      main: db
        .prepare(
          `UPDATE leads SET stage = ?2, lost_reason = ?3, updated_at = ?4, ${touchLeadSql("?4")} WHERE id = ?1 AND stage = ?5`,
        )
        .bind(id, f.stage, reason, t, lead.stage),
      action: "lead.stage",
      entityType: "lead",
      entityId: id,
      summary: { ref: lead.ref, from: lead.stage, to: f.stage, ...(reason ? { lostReason: reason } : {}) },
      side: (g) => [
        guardedActivity(
          db,
          g,
          id,
          "stage",
          `Stage changed from ${lead.stage} to ${f.stage}${reason ? ` (${reason})` : ""}`,
          u.id,
          t,
        ),
      ],
    });
    if (!done) return err(c, STALE_VERSION, 409);
    return c.json({ ok: true, changed: true, updatedAt: t });
  })

  // ---- reply (ADM-LEAD-06) ----
  .get("/:id/reply-templates", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const lead = await c.env.DB.prepare(
      `SELECT ref, contact_name, service_code, ${SERVICE_NAME_SQL} AS service_name, request_type FROM leads AS l WHERE id = ?1`,
    )
      .bind(id)
      .first<{
        ref: string;
        contact_name: string;
        service_code: string | null;
        service_name: string | null;
        request_type: string | null;
      }>();
    if (!lead) return err(c, NOT_FOUND, 404);
    const vars = {
      first_name: lead.contact_name.trim().split(/\s+/)[0] ?? lead.contact_name,
      service_or_request:
        serviceTitle(lead.service_code, lead.service_name) ??
        lead.request_type?.replaceAll("-", " ") ??
        "General enquiry",
      sender_name: actor(c).name,
      ref: lead.ref,
    };
    return c.json({
      templates: REPLY_TEMPLATES.map((t) => ({ id: t.id, label: t.label, ...fillReplyTemplate(t, vars) })),
    });
  })

  .post("/:id/reply", param(idParam), body(replyRequest), async (c) => {
    const u = actor(c);
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    // A subject is one line; a template's [gap] must be filled before anything is sent.
    if (/[\r\n]/.test(f.subject)) return err(c, BAD_REQUEST, 400);
    if (f.templateId !== undefined && !replyTemplateById(f.templateId)) return err(c, BAD_REQUEST, 400);
    if (hasUnfilledGap(f.subject, f.body)) return err(c, UNFILLED_GAP, 400);
    const lead = await db
      .prepare("SELECT ref, contact_email FROM leads WHERE id = ?1")
      .bind(id)
      .first<{ ref: string; contact_email: string }>();
    if (!lead) return err(c, NOT_FOUND, 404);

    const t = Date.now();
    const replyId = uuidv7();
    const done = await mutate(c, {
      // The per-member limit is part of the conditional write, so two replies at once cannot both pass the last slot.
      main: db
        .prepare(
          `UPDATE leads SET ${touchLeadSql("?2")} WHERE id = ?1 AND (SELECT count(*) FROM audit_log WHERE actor_id = ?3 AND action = 'lead.reply' AND at > ?4) < ${REPLIES_PER_HOUR}`,
        )
        .bind(id, t, u.id, t - 3_600_000),
      action: "lead.reply",
      entityType: "lead",
      entityId: id,
      summary: { ref: lead.ref, ...(f.templateId ? { templateId: f.templateId } : {}) },
      status: 202,
      side: (g) => [
        guardedActivity(
          db,
          g,
          id,
          "reply",
          JSON.stringify({ subject: f.subject, excerpt: f.body.slice(0, 160) }),
          u.id,
          t,
          replyId,
        ),
      ],
    });
    if (!done) {
      // Nothing matched: the member is over the limit, or the lead was deleted since the read above.
      const still = await db.prepare("SELECT 1 AS x FROM leads WHERE id = ?1").bind(id).first();
      return still ? err(c, RATE_LIMITED, 429) : err(c, NOT_FOUND, 404);
    }
    // Through the email queue and `email_log` like every other email: from hello@, Reply-To hello@ (the template `lead.reply`).
    // One email per reply: its entity is this reply's timeline row, not the lead.
    queueEmail(c, {
      template: "lead.reply",
      to: lead.contact_email,
      data: { subject: f.subject, body: f.body },
      entity: { type: "lead_reply", id: replyId },
    });
    return c.json({ ok: true, queued: true, id: replyId }, 202);
  })

  // ---- convert (ADM-LEAD-04) ----
  .post("/:id/convert", param(idParam), body(convertRequest), async (c) => {
    const u = actor(c);
    // The route's matrix action is clients.write; the draft proposal also needs proposals.draft (docs/04 §9).
    if (decide(u.role, "proposals.draft") === "deny") return err(c, FORBIDDEN, 403);
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;

    // The tax identity as one rule (core): India for registered and unregistered, a state code, a GSTIN exactly when registered.
    // Researched 2026-10-28, s.12 IGST Act (08-C RA-12): the place-of-supply treatment is decided at proposal and invoice time (M4).
    const tax = clientTaxCheck(f);
    if (!tax.ok) return taxError(c, tax);
    const { gstin, stateCode } = tax;

    const lead = await db
      .prepare(
        `SELECT id, ref, contact_name, contact_email, contact_phone, contact_company, service_code, ${SERVICE_NAME_SQL} AS service_name, message, client_id, consent FROM leads AS l WHERE id = ?1`,
      )
      .bind(id)
      .first<LeadRow>();
    if (!lead) return err(c, NOT_FOUND, 404);
    if (lead.client_id) return err(c, ALREADY_CONVERTED, 409);

    const t = Date.now();
    const clientId = uuidv7();
    const contactId = uuidv7();
    const proposalId = uuidv7();
    // The company, or the person's name when the company is missing, empty or only spaces (the shared rule, M4.3 re-check 2).
    const fromLead = nameOrLegal(lead.contact_company, lead.contact_name);
    const legalName = f.legalName ?? fromLead;
    const displayName = f.displayName ?? fromLead;
    // Marketing consent travels only while it still stands (not withdrawn).
    const consent = lead.consent
      ? (JSON.parse(lead.consent) as { marketing?: boolean; at?: number; withdrawnAt?: number | null })
      : null;
    const marketing =
      consent?.marketing && !consent.withdrawnAt
        ? JSON.stringify({ granted: true, at: consent.at ?? t, source: `lead:${lead.ref}` })
        : null;
    const title = serviceTitle(lead.service_code, lead.service_name);
    const scopeBody = lead.message ? lead.message.slice(0, 2000) : null;
    const unconverted = "EXISTS (SELECT 1 FROM leads WHERE id = ?13 AND client_id IS NULL)";

    // The draft proposal is the full draft of M4.3 (ADM-LEAD-04): its version group, the template sections of the service, the service's
    // lines and schedule, the newest terms. It is built by the same builder as the create route, before the batch, from the catalogue and
    // the settings; the batch only writes it. A lead with no known service gets the three sections every proposal has (and its message).
    const code = lead.service_code && lead.service_code !== NOT_SURE ? lead.service_code : null;
    const [itemR, settingsR, termsR, templateR] = await db.batch([
      db.prepare(`SELECT ${ITEM_COLS} FROM catalogue_items WHERE code = ?1`).bind(code ?? ""),
      db.prepare(SETTINGS_READ),
      db.prepare(NEWEST_TERMS),
      db
        .prepare(
          "SELECT body FROM templates WHERE kind = 'proposal' AND category = (SELECT category FROM catalogue_items WHERE code = ?1) ORDER BY version DESC LIMIT 1",
        )
        .bind(code ?? ""),
    ]);
    const item = (itemR?.results[0] as ItemRow | undefined) ?? null;
    const built = await buildNewDraft({
      id: proposalId,
      type: "proposal",
      client: {
        id: clientId,
        displayName,
        currency: f.currency,
        tax: { gstStatus: f.gstStatus, country: f.country, gstin, stateCode },
      },
      contact: { id: contactId, name: lead.contact_name },
      title,
      // An inactive service is not offered again; the lead still gets its sections.
      services: item && item.active === 1 ? [{ item }] : [],
      template: (templateR?.results[0] as { body: string } | undefined)?.body ?? null,
      settings: readSettings((settingsR?.results ?? []) as { key: string; value: string; version: number }[]),
      newestTermsId: (termsR?.results[0] as { id: string } | undefined)?.id ?? null,
      today: todayIst(t),
      lenientLines: true,
      leadMessage: scopeBody,
    });
    if (!built.ok) return err(c, built.error, built.status);

    // One batch: the client (next free code), its primary contact, the draft proposal (no number: numbers come only at issue),
    // the service as a section of the draft, then the lead's own update LAST (the audit row follows only if that changed a row).
    // Every statement depends on the one before it, so a lead converted in the meantime changes nothing at all.
    const build = () => [
      insertClientStmt(
        db,
        {
          id: clientId,
          legalName,
          displayName,
          type: f.type,
          country: f.country,
          gstStatus: f.gstStatus,
          gstin,
          stateCode,
          currency: f.currency,
        },
        { sql: unconverted, params: [id] },
      ),
      db
        .prepare(
          `INSERT INTO contacts (id, client_id, name, email, phone, is_primary, is_billing, can_see_finance, marketing_consent)
           SELECT ?1, ?2, ?3, ?4, ?5, 1, ?7, ?7, ?6 WHERE EXISTS (SELECT 1 FROM clients WHERE id = ?2)`,
        )
        .bind(
          contactId,
          clientId,
          lead.contact_name,
          normaliseEmail(lead.contact_email),
          lead.contact_phone,
          marketing,
          f.billingContact ? 1 : 0,
        ),
      ...(() => {
        const draft = newDraftStatements(
          db,
          built.state,
          built.computation,
          { groupId: proposalId, version: 1, createdBy: u.id, now: t },
          { sql: (at) => `EXISTS (SELECT 1 FROM clients WHERE id = ?${at})`, params: [clientId] },
        );
        return [
          draft.main,
          ...draft.children({
            sql: (at) => `EXISTS (SELECT 1 FROM documents WHERE id = ?${at})`,
            params: [proposalId],
          }),
        ];
      })(),
      db
        .prepare(
          `UPDATE leads SET client_id = ?2, proposal_id = ?3, contact_id = (SELECT id FROM contacts WHERE id = ?5), ${touchLeadSql("?4")}, updated_at = ?4
           WHERE id = ?1 AND client_id IS NULL AND EXISTS (SELECT 1 FROM clients WHERE id = ?2) AND EXISTS (SELECT 1 FROM documents WHERE id = ?3)`,
        )
        .bind(id, clientId, proposalId, t, contactId),
    ];

    let done = false;
    for (let attempt = 0; ; attempt++) {
      try {
        done = await mutate(c, {
          main: build(),
          action: "lead.convert",
          entityType: "lead",
          entityId: id,
          // References only: no name, email or phone in the append-only log.
          summary: { ref: lead.ref, clientId, proposalId },
          status: 201,
          side: (g) => [
            db
              .prepare(
                `INSERT INTO lead_activities (id, lead_id, kind, body, actor_id, created_at)
                 SELECT ?1, ?2, 'converted', 'Converted to client ' || code, ?3, ?4 FROM clients WHERE id = ?5 AND ${g.sql(6)}`,
              )
              .bind(uuidv7(), id, u.id, t, clientId, ...g.params),
          ],
        });
        break;
      } catch (e) {
        // Two conversions picked the same next code at once: the unique index refused the second; take the next one.
        if (isUnique(e, "clients.code") && attempt < 2) continue;
        if (isUnique(e, "clients.gstin")) return err(c, GSTIN_IN_USE, 409);
        throw e;
      }
    }
    if (!done) {
      const again = await db
        .prepare("SELECT client_id FROM leads WHERE id = ?1")
        .bind(id)
        .first<{ client_id: string | null }>();
      return again ? err(c, ALREADY_CONVERTED, 409) : err(c, NOT_FOUND, 404);
    }
    const made = await db
      .prepare("SELECT code FROM clients WHERE id = ?1")
      .bind(clientId)
      .first<{ code: string }>();
    return c.json(
      { clientId, clientCode: made?.code ?? "", contactId, proposalId, warnings: taxWarnings(tax) },
      201,
    );
  });
