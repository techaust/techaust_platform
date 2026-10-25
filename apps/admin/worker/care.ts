// Care plans (M3.5, ADM-CARE-01, -03; ADM-CARE-02 is the interface M5.4 will use). Every route is a row of ROUTES (guard.ts); every change
// is ONE batch through `mutate`, audit row first. The rules live in SQL conditions (the version, the current status, the client's
// state), not in a read before a write, so two staff members cannot both win.
//
// History: a plan's terms and status are appended to `care_plan_terms` and `care_plan_status_log` (append-only triggers); the
// columns of `care_plans` mirror the newest rows (a trigger refuses drift). A past period, and the list and the dashboard, read
// the history through the shared loader (`@techaust/db/care`), never the mirror.
//
// Owner's answers (2026-10-25, docs/13): a price or hours change takes effect from the NEXT billing period (Q1); Staff may set any
// terms at creation, later price changes and cancelling are the owner's (Q6). VERIFY WITH CA/LEGAL: notice for terms changes, GST on
// overage (M5.4), cancellation takes effect at once and issues no credit note until ADM-CARE-04.
// Audit rows hold ids, field names, dates, statuses and the new terms (money is not personal data), never a client name.
import {
  CARE_STATUSES,
  CARE_STEP_MINUTES,
  CARE_TIERS,
  type CareStatus,
  type CareTier,
  canMoveCare,
  careSourcesOf,
  MAX_BILLING_DAY,
  ROLLOVER_RULES,
  statusEffectiveOn,
  termsEffectiveFrom,
  termsOn,
} from "@techaust/core/care";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { can } from "@techaust/core/permissions";
import {
  assembleCare,
  type CarePlanData,
  careStatements,
  currentUsage,
  type PlanRaw,
  pastUsage,
} from "@techaust/db/care";
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
import { body, idParam, isoDate, limitOf, param, query, STALE_VERSION } from "./http.ts";
import { type Direction, decodeCursor, keysetSql, pageOf } from "./keyset.ts";

const PLAN_CANCELLED: ApiError = {
  code: "plan_cancelled",
  message: "A cancelled care plan can't be changed",
};
const INVALID_TRANSITION: ApiError = {
  code: "invalid_transition",
  message: "A care plan can't move to that status from where it is",
};

const MAX_MINOR = 10 ** 13;
const MAX_INCLUDED_MINUTES = 120_000;

// ---- schemas (module top level) ---------------------------------------------------------------------------------------------

const money = z.int().check(z.gte(0), z.lte(MAX_MINOR));
const included = z.int().check(
  z.gte(0),
  z.lte(MAX_INCLUDED_MINUTES),
  z.refine((m) => m % CARE_STEP_MINUTES === 0),
);
const tier = z.enum(CARE_TIERS);
const rollover = z.enum(ROLLOVER_RULES);
/** A plan starts between 2000 and 2100 (a typing slip, not a plan). */
const startDate = isoDate.check(z.refine((s) => s >= "2000-01-01" && s <= "2100-12-31"));

const createBody = z.strictObject({
  clientId: z.string().check(z.minLength(1), z.maxLength(64)),
  tier,
  priceMinor: money,
  includedMinutes: included,
  aiOpsMinor: z.optional(z.nullable(money)),
  overageRateMinor: z.optional(z.nullable(money)),
  rollover,
  startDate,
  billingDay: z.int().check(z.gte(1), z.lte(MAX_BILLING_DAY)),
});
const termsBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  tier: z.optional(tier),
  priceMinor: z.optional(money),
  includedMinutes: z.optional(included),
  aiOpsMinor: z.optional(z.nullable(money)),
  overageRateMinor: z.optional(z.nullable(money)),
  rollover: z.optional(rollover),
});
const statusBody = z.strictObject({ to: z.enum(CARE_STATUSES), expectedUpdatedAt: z.int() });
const listQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  status: z.optional(z.enum(CARE_STATUSES)),
  clientId: z.optional(z.string().check(z.maxLength(64))),
  after: z.optional(z.string().check(z.maxLength(400))),
  before: z.optional(z.string().check(z.maxLength(400))),
});
const defaultsQuery = z.object({ clientId: z.string().check(z.minLength(1), z.maxLength(64)) });

/** The terms fields a request may change, with their column. */
const TERM_FIELDS = [
  ["tier", "tier"],
  ["priceMinor", "price_minor"],
  ["includedMinutes", "included_minutes"],
  ["aiOpsMinor", "ai_ops_minor"],
  ["overageRateMinor", "overage_rate_minor"],
  ["rollover", "rollover"],
] as const;

/** Start-up warm-up (worker/warm.ts): parse one sample of each body and query once, so the first request builds no schema. */
export function warmCare(): number {
  const t = performance.now();
  createBody.safeParse({
    clientId: "x",
    tier: "essential",
    priceMinor: 1,
    includedMinutes: 120,
    aiOpsMinor: null,
    overageRateMinor: 1,
    rollover: "none",
    startDate: "2026-01-01",
    billingDay: 1,
  });
  termsBody.safeParse({ expectedUpdatedAt: 1, priceMinor: 1, aiOpsMinor: null });
  statusBody.safeParse({ to: "paused", expectedUpdatedAt: 1 });
  listQuery.safeParse({ limit: "25", status: "active" });
  defaultsQuery.safeParse({ clientId: "x" });
  return performance.now() - t;
}

// ---- views --------------------------------------------------------------------------------------------------------------------

const istToday = () => toIsoDate(istDate(Date.now()));

const termsView = (t: ReturnType<typeof termsOn>) =>
  t && {
    effectiveFrom: t.effectiveFrom,
    tier: t.tier,
    priceMinor: t.priceMinor,
    includedMinutes: t.includedMinutes,
    aiOpsMinor: t.aiOpsMinor,
    overageRateMinor: t.overageRateMinor,
    rollover: t.rollover,
    createdAt: t.createdAt,
  };

/** The terms in force today (or on the start date, for a plan that has not started) and the newest row still to come. */
function termsSummary(d: CarePlanData, today: string) {
  const ref = today < d.plan.start_date ? d.plan.start_date : today;
  const pending = d.terms.filter((t) => t.effectiveFrom > ref).at(-1);
  return { current: termsView(termsOn(d.terms, ref)) ?? null, pending: termsView(pending) ?? null };
}

const planBase = (p: PlanRaw) => ({
  id: p.id,
  clientId: p.client_id,
  clientCode: p.client_code,
  clientName: p.client_name,
  currency: p.currency,
  startDate: p.start_date,
  billingDay: p.billing_day,
  status: p.status,
  pausedAt: p.paused_at,
  cancelledAt: p.cancelled_at,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});

/** One row of the list: the plan, its terms now and the one coming, and this period's hours. */
export const planRow = (d: CarePlanData, today: string) => ({
  ...planBase(d.plan),
  terms: termsSummary(d, today),
  usage: currentUsage(d, today),
});

/** This period and the one before it (whose unused hours may carry in). */
export const LIST_PERIODS_BACK = 1;
/** Twelve periods and the one before the oldest. */
const DETAIL_PERIODS_BACK = 13;

/** The loader's usage window for a call made `today`. */
export const usageWindow = (today: string, periodsBack: number) => ({ to: today, periodsBack });

// ---- the list -----------------------------------------------------------------------------------------------------------------

type ListFilter = { status?: string | undefined; clientId?: string | undefined };

/** The page of plan ids and its values, one place for the route and for the plan test. */
export function carePlanPageSql(
  f: ListFilter,
  cursor: { k: number; id: string } | null,
  dir: Direction,
  limit: number,
) {
  const where: string[] = [];
  const bind: unknown[] = [];
  if (f.status) where.push(`p.status = ?${bind.push(f.status)}`);
  if (f.clientId) where.push(`p.client_id = ?${bind.push(f.clientId)}`);
  const order = keysetSql("p.created_at", "p.id", false, dir, bind.length + 1);
  if (cursor) {
    where.push(order.where);
    bind.push(cursor.k, cursor.id);
  }
  return {
    sql: `SELECT p.id, p.created_at FROM care_plans p${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order.order} LIMIT ${limit + 1}`,
    bind,
  };
}

async function listPlans(c: Ctx, f: z.infer<typeof listQuery>, afterOnly = false) {
  const limit = limitOf(f.limit);
  const dir: Direction = !afterOnly && f.before ? "before" : "after";
  if (!afterOnly && f.before && f.after) return err(c, BAD_REQUEST, 400);
  const raw = dir === "before" ? f.before : f.after;
  const cur = raw === undefined ? null : decodeCursor(raw);
  if (raw !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
  const { sql, bind } = carePlanPageSql(f, cur && { k: cur.k as number, id: cur.id }, dir, limit);
  const db = c.env.DB;
  const { results } = await db
    .prepare(sql)
    .bind(...bind)
    .all<{ id: string; created_at: number }>();
  const page = pageOf(results, limit, dir, cur !== null, (r) => ({ k: r.created_at, id: r.id }));
  const today = istToday();
  const data = new Map<string, CarePlanData>();
  if (page.items.length) {
    const [plans, terms, status, usage] = await db.batch<Record<string, unknown>>(
      careStatements(db, { ids: page.items.map((r) => r.id) }, usageWindow(today, LIST_PERIODS_BACK)),
    );
    const assembled = assembleCare({
      plans: (plans?.results ?? []) as never,
      terms: (terms?.results ?? []) as never,
      status: (status?.results ?? []) as never,
      usage: (usage?.results ?? []) as never,
    });
    for (const [id, d] of assembled.plans) data.set(id, d);
  }
  const carePlans = page.items.flatMap((r) => {
    const d = data.get(r.id);
    return d ? [planRow(d, today)] : [];
  });
  return c.json({ today, carePlans, next: page.next, prev: page.prev });
}

/** The care plans of one client (the client page's Care plans tab). */
export async function listClientCarePlans(
  c: Ctx,
  clientId: string,
  after: string | undefined,
  limitText?: string,
) {
  const exists = await c.env.DB.prepare("SELECT 1 AS x FROM clients WHERE id = ?1").bind(clientId).first();
  if (!exists) return err(c, NOT_FOUND, 404);
  const f: z.infer<typeof listQuery> = { clientId };
  if (limitText === "25" || limitText === "50") f.limit = limitText;
  if (after !== undefined) f.after = after;
  return listPlans(c, f, true);
}

// ---- defaults -----------------------------------------------------------------------------------------------------------------

type DefaultLine = { description?: string; rateInrMinor?: number | null; rateUsdMinor?: number | null };
type CatalogueRow = {
  code: string;
  price_inr_minor: number | null;
  price_usd_minor: number | null;
  default_lines: string | null;
};

/** Included minutes by tier: only Essential has one (120 minutes, docs/07). The rest are the owner's to choose, so they are null. */
const DEFAULT_INCLUDED: Record<CareTier, number | null> = {
  essential: 120,
  growth: null,
  scale: null,
  dev_subscription: null,
  custom: null,
};
/** Rollover by tier (docs/07 section 4.14): Essential none, Growth and Scale one month; a prefill, the person may change it. */
const DEFAULT_ROLLOVER: Record<CareTier, "none" | "one_month"> = {
  essential: "none",
  growth: "one_month",
  scale: "one_month",
  dev_subscription: "none",
  custom: "none",
};

// ---- routes -------------------------------------------------------------------------------------------------------------------

export const carePlans = new Hono<AppEnv>()
  .get("/", query(listQuery), (c) => listPlans(c, c.req.valid("query")))

  // Prefill for the new-plan form: the client's currency and the catalogue's prices (S16 lines by tier, S18, S17). Nothing is invented:
  // what the owner has not decided (hours for the larger tiers, the overage rate) is null and the screen leaves it empty.
  .get("/defaults", query(defaultsQuery), async (c) => {
    const { clientId } = c.req.valid("query");
    const db = c.env.DB;
    const [client, catalogue] = await db.batch<Record<string, unknown>>([
      db.prepare("SELECT currency, anonymised_at FROM clients WHERE id = ?1").bind(clientId),
      db.prepare(
        "SELECT code, price_inr_minor, price_usd_minor, default_lines FROM catalogue_items WHERE code IN ('S16', 'S17', 'S18')",
      ),
    ]);
    const row = client?.results[0] as { currency: "INR" | "USD"; anonymised_at: number | null } | undefined;
    if (!row) return err(c, NOT_FOUND, 404);
    const items = new Map(((catalogue?.results ?? []) as CatalogueRow[]).map((r) => [r.code, r]));
    const price = (code: string): number | null => {
      const r = items.get(code);
      return r ? (row.currency === "INR" ? r.price_inr_minor : r.price_usd_minor) : null;
    };
    const lines: DefaultLine[] = (() => {
      try {
        return JSON.parse(items.get("S16")?.default_lines ?? "[]") as DefaultLine[];
      } catch {
        return [];
      }
    })();
    const linePrice = (name: string): number | null => {
      const l = lines.find((x) => x.description?.toLowerCase() === name);
      return l ? ((row.currency === "INR" ? l.rateInrMinor : l.rateUsdMinor) ?? null) : null;
    };
    const priceByTier: Record<CareTier, number | null> = {
      essential: linePrice("essential"),
      growth: linePrice("growth"),
      scale: linePrice("scale"),
      dev_subscription: price("S18"),
      custom: null,
    };
    return c.json({
      currency: row.currency,
      clientAnonymised: row.anonymised_at !== null,
      tiers: Object.fromEntries(
        CARE_TIERS.map((t) => [
          t,
          { priceMinor: priceByTier[t], includedMinutes: DEFAULT_INCLUDED[t], rollover: DEFAULT_ROLLOVER[t] },
        ]),
      ),
      aiOpsMinor: price("S17"),
      overageRateMinor: null,
      // What is not decided yet (the screen says so instead of showing a number): hours for the larger tiers and the overage rate.
      undecided: ["includedMinutes", "overageRateMinor"],
    });
  })

  .post("/", body(createBody), async (c) => {
    const f = c.req.valid("json");
    const db = c.env.DB;
    const me = actor(c);
    const id = uuidv7();
    const t = Date.now();
    const done = await mutate(c, {
      // Three statements in this order; the last one decides (it only writes if the plan row is there).
      main: [
        db
          .prepare(
            `INSERT INTO care_plans (id, client_id, tier, currency, price_minor, included_minutes, ai_ops_minor, start_date, billing_day, status, rollover, overage_rate_minor, created_at, updated_at)
             SELECT ?1, c.id, ?3, c.currency, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?10, ?11, ?11 FROM clients c WHERE c.id = ?2 AND ${clientLiveSql("c.id")}`,
          )
          .bind(
            id,
            f.clientId,
            f.tier,
            f.priceMinor,
            f.includedMinutes,
            f.aiOpsMinor ?? null,
            f.startDate,
            f.billingDay,
            f.rollover,
            f.overageRateMinor ?? null,
            t,
          ),
        db
          .prepare(
            `INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, ai_ops_minor, overage_rate_minor, rollover, created_by, created_at)
             SELECT ?1, p.id, p.start_date, p.tier, p.price_minor, p.included_minutes, p.ai_ops_minor, p.overage_rate_minor, p.rollover, ?3, p.created_at FROM care_plans p WHERE p.id = ?2`,
          )
          .bind(uuidv7(), id, me.id),
        db
          .prepare(
            `INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at)
             SELECT ?1, p.id, 'active', p.start_date, ?3, p.created_at FROM care_plans p WHERE p.id = ?2`,
          )
          .bind(uuidv7(), id, me.id),
      ],
      action: "care_plan.create",
      entityType: "care_plan",
      entityId: id,
      summary: {
        carePlanId: id,
        clientId: f.clientId,
        tier: f.tier,
        priceMinor: f.priceMinor,
        includedMinutes: f.includedMinutes,
        startDate: f.startDate,
        billingDay: f.billingDay,
      },
      status: 201,
    });
    if (done) return c.json({ id, updatedAt: t }, 201);
    const known = await db.prepare("SELECT 1 AS x FROM clients WHERE id = ?1").bind(f.clientId).first();
    if (!known) return err(c, NOT_FOUND, 404);
    return refuseAnonymised(c);
  })

  .get("/:id", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const today = istToday();
    const [plans, terms, status, usage, gone] = await db.batch<Record<string, unknown>>([
      ...careStatements(db, { ids: [id] }, usageWindow(today, DETAIL_PERIODS_BACK)),
      db.prepare(`SELECT ${clientGoneSql("p.client_id")} AS gone FROM care_plans p WHERE p.id = ?1`).bind(id),
    ]);
    const { plans: loaded } = assembleCare({
      plans: (plans?.results ?? []) as never,
      terms: (terms?.results ?? []) as never,
      status: (status?.results ?? []) as never,
      usage: (usage?.results ?? []) as never,
    });
    const d = loaded.get(id);
    if (!d) return err(c, NOT_FOUND, 404);
    return c.json({
      today,
      plan: planBase(d.plan),
      terms: termsSummary(d, today),
      /** The newest ten status rows, newest first (past periods read the whole history; this is for the page). */
      statusLog: d.statuses
        .slice(-10)
        .reverse()
        .map((s) => ({ status: s.status, effectiveOn: s.effectiveOn, createdAt: s.createdAt })),
      usage: currentUsage(d, today),
      periods: pastUsage(d, today, 12),
      clientAnonymised: (gone?.results[0] as { gone: number } | undefined)?.gone === 1,
      overage: { addToInvoice: { available: false, arrivesWith: "recurring_invoices" } },
    });
  })

  // New terms: effective from the next billing period (Q1), or the start date if the plan has not started. The new row is the
  // newest terms row with the changed fields laid over it; the plan's mirror columns are then set from that row.
  .post("/:id/terms", param(idParam), body(termsBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const me = actor(c);
    const sent = TERM_FIELDS.filter(([key]) => f[key] !== undefined);
    if (!sent.length) return err(c, BAD_REQUEST, 400);
    const row = await db
      .prepare(
        "SELECT start_date, billing_day, status, updated_at, tier, price_minor, included_minutes, ai_ops_minor, overage_rate_minor, rollover FROM care_plans WHERE id = ?1",
      )
      .bind(id)
      .first<Record<string, string | number | null>>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.status === "cancelled") return err(c, PLAN_CANCELLED, 409);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    const changed = sent.filter(([key, col]) => f[key] !== row[col]);
    if (!changed.length) return c.json({ ok: true, changed: false, updatedAt: row.updated_at });
    const effectiveFrom = termsEffectiveFrom(istToday(), {
      billingDay: row.billing_day as number,
      startDate: row.start_date as string,
    });
    const t = Math.max(Date.now(), (row.updated_at as number) + 1);
    const termsId = uuidv7();
    const flags = TERM_FIELDS.flatMap(([key]) => [f[key] !== undefined ? 1 : 0, f[key] ?? null]);
    const done = await mutate(c, {
      action: "care_plan.terms",
      entityType: "care_plan",
      entityId: id,
      auditFirst: (auditId, who) =>
        auditFirstRow(db, auditId, who, {
          action: "care_plan.terms",
          entityType: "care_plan",
          entityExpr: "p.id",
          summaryExpr:
            "json_object('carePlanId', p.id, 'clientId', p.client_id, 'effectiveFrom', ?9, 'changed', json(?10))",
          from: `FROM care_plans p WHERE p.id = ?7 AND p.updated_at = ?8 AND p.status <> 'cancelled' AND ${clientLiveSql("p.client_id")}`,
          // The new values of the changed fields (money and hours are business records, not personal data; the accountant reads them).
          params: [
            id,
            f.expectedUpdatedAt,
            effectiveFrom,
            JSON.stringify(Object.fromEntries(changed.map(([key]) => [key, f[key]]))),
          ],
        }),
      after: (g) => [
        db
          .prepare(
            `INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, ai_ops_minor, overage_rate_minor, rollover, created_by, created_at)
             SELECT ?3, p.id, ?4, CASE WHEN ?5 = 1 THEN ?6 ELSE n.tier END, CASE WHEN ?7 = 1 THEN ?8 ELSE n.price_minor END, CASE WHEN ?9 = 1 THEN ?10 ELSE n.included_minutes END,
                    CASE WHEN ?11 = 1 THEN ?12 ELSE n.ai_ops_minor END, CASE WHEN ?13 = 1 THEN ?14 ELSE n.overage_rate_minor END, CASE WHEN ?15 = 1 THEN ?16 ELSE n.rollover END, ?17, ?18
             FROM care_plans p JOIN care_plan_terms n ON n.id = (SELECT id FROM care_plan_terms WHERE care_plan_id = p.id ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1)
             WHERE p.id = ?1 AND p.updated_at = ?2 AND ${g.sql(19)}`,
          )
          .bind(id, f.expectedUpdatedAt, termsId, effectiveFrom, ...flags, me.id, t, ...g.params),
        db
          .prepare(
            `UPDATE care_plans SET tier = n.tier, price_minor = n.price_minor, included_minutes = n.included_minutes, ai_ops_minor = n.ai_ops_minor, overage_rate_minor = n.overage_rate_minor, rollover = n.rollover, updated_at = ?3
             FROM care_plan_terms n WHERE n.id = ?4 AND care_plans.id = ?1 AND care_plans.updated_at = ?2 AND ${g.sql(5)}`,
          )
          .bind(id, f.expectedUpdatedAt, t, termsId, ...g.params),
      ],
    });
    if (done) return c.json({ ok: true, changed: true, updatedAt: t, effectiveFrom });
    const again = await db
      .prepare(
        `SELECT status, updated_at, ${clientGoneSql("client_id")} AS gone FROM care_plans WHERE id = ?1`,
      )
      .bind(id)
      .first<{ status: CareStatus; updated_at: number; gone: number }>();
    if (!again) return err(c, NOT_FOUND, 404);
    if (again.status === "cancelled") return err(c, PLAN_CANCELLED, 409);
    if (again.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    return again.gone === 1 ? refuseAnonymised(c) : err(c, STALE_VERSION, 409);
  })

  // Pause, resume, cancel. A change takes effect today (IST), or on the start date if that is later. Cancelling is the owner's.
  .post("/:id/status", param(idParam), body(statusBody), async (c) => {
    const { id } = c.req.valid("param");
    const { to, expectedUpdatedAt } = c.req.valid("json");
    const db = c.env.DB;
    const me = actor(c);
    if (to === "cancelled" && !can(me.role, "carePlans.changePrice")) return err(c, FORBIDDEN, 403);
    const today = istToday();
    const sources = careSourcesOf(to);
    if (!sources.length) return err(c, INVALID_TRANSITION, 409);
    const logId = uuidv7();
    // The moment of the change is also this plan's new version: the write only happens at `updated_at = expectedUpdatedAt`, so the
    // new version is later than that, even inside the same millisecond, and the history rows keep their order.
    const at = Math.max(Date.now(), expectedUpdatedAt + 1);
    const done = await mutate(c, {
      action: "care_plan.status",
      entityType: "care_plan",
      entityId: id,
      auditFirst: (auditId, who) =>
        auditFirstRow(db, auditId, who, {
          action: "care_plan.status",
          entityType: "care_plan",
          entityExpr: "p.id",
          summaryExpr:
            "json_object('carePlanId', p.id, 'clientId', p.client_id, 'from', p.status, 'to', ?10, 'effectiveOn', max(?9, p.start_date))",
          // Cancelling is allowed for an anonymised client (wind-down); nothing else is.
          from: `FROM care_plans p WHERE p.id = ?7 AND p.updated_at = ?8 AND p.status IN (${sources.map((s) => `'${s}'`).join(", ")}) AND (?10 = 'cancelled' OR ${clientLiveSql("p.client_id")})`,
          params: [id, expectedUpdatedAt, today, to],
        }),
      after: (g) => [
        db
          .prepare(
            `INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at)
             SELECT ?3, p.id, ?4, max(?5, p.start_date), ?6, ?7 FROM care_plans p WHERE p.id = ?1 AND p.updated_at = ?2 AND ${g.sql(8)}`,
          )
          .bind(id, expectedUpdatedAt, logId, to, today, me.id, at, ...g.params),
        db
          .prepare(
            `UPDATE care_plans SET status = ?3, paused_at = CASE WHEN ?3 = 'paused' THEN ?4 WHEN ?3 = 'active' THEN NULL ELSE paused_at END, cancelled_at = CASE WHEN ?3 = 'cancelled' THEN ?4 ELSE cancelled_at END, updated_at = ?4
             WHERE id = ?1 AND updated_at = ?2 AND ${g.sql(5)}`,
          )
          .bind(id, expectedUpdatedAt, to, at, ...g.params),
      ],
    });
    if (done) {
      const plan = await db
        .prepare("SELECT start_date, billing_day FROM care_plans WHERE id = ?1")
        .bind(id)
        .first<{ start_date: string; billing_day: number }>();
      const effectiveOn = plan
        ? statusEffectiveOn(today, { billingDay: plan.billing_day, startDate: plan.start_date })
        : today;
      return c.json({ ok: true, status: to, effectiveOn, updatedAt: at });
    }
    const again = await db
      .prepare(
        `SELECT status, updated_at, ${clientGoneSql("client_id")} AS gone FROM care_plans WHERE id = ?1`,
      )
      .bind(id)
      .first<{ status: CareStatus; updated_at: number; gone: number }>();
    if (!again) return err(c, NOT_FOUND, 404);
    if (again.updated_at !== expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (!canMoveCare(again.status, to)) return err(c, INVALID_TRANSITION, 409);
    return again.gone === 1 ? refuseAnonymised(c) : err(c, STALE_VERSION, 409);
  });
