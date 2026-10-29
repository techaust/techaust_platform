// The dashboard (M3.5, ADM-DASH-01, the CRM tiles): ONE `db.batch` (a second only for the care tile, past 100 active plans), live figures from indexed reads (docs/05 section 1.2 rule 7: `stats_daily`
// is the nightly history, not what this reads). `tilesFor(role)` decides which tiles are built; a tile the role may not see is ABSENT from
// the answer (never an "unavailable" stub), and its statements are never run. The finance tile arrives with M5/M6, the usage tile with
// M7.5; the pipeline-value tile is live since M4.3. The activity feed lists exact action names per role (core/dashboard.ts) and never carries the
// audit summary, the IP address or the user agent.
import { CARE_NEAR_BP, CARE_REACHED_BP, termsOn } from "@techaust/core/care";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_DAYS,
  ACTIVITY_LIMIT,
  ACTIVITY_OWN_ONLY,
  MILESTONE_WINDOW_DAYS,
  type TileKey,
  tilesFor,
} from "@techaust/core/dashboard";
import { addDays, daysBetween, fyOfDate, istDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { realisationParamsFromStoredTax } from "@techaust/core/invoices";
import { LEAD_STAGES } from "@techaust/core/lead-lifecycle";
import { DAY_MS, weekOf } from "@techaust/core/time";
import {
  assembleCare,
  type BurnRankRow,
  burnRankQuery,
  careStatements,
  currentUsage,
  type PlanRaw,
  type StatusRaw,
  type TermsRaw,
  type UsageRaw,
} from "@techaust/db/care";
import {
  EXPORT_NEXT_SQL,
  EXPORT_STAGE_COUNTS_SQL,
  INVOICED_SQL,
  OVERDUE_OLDEST_SQL,
  OWED_SQL,
  PROFORMAS_AWAITING_SQL,
  SETTINGS_TAX_SQL,
} from "@techaust/db/reports";
import { Hono } from "hono/tiny";
import { LIST_PERIODS_BACK, usageWindow } from "./care.ts";
import { type AppEnv, actor } from "./context.ts";

type InvoicedRow = {
  currency: string;
  fy_documents: number;
  fy_taxable: number;
  fy_total: number;
  fy_inr_taxable: number | null;
  month_documents: number;
  month_taxable: number;
  month_total: number;
  month_inr_taxable: number | null;
};

const OPEN_STAGES = LEAD_STAGES.filter((s) => s !== "won" && s !== "lost");
const STAGE_LIST = OPEN_STAGES.map((s) => `'${s}'`).join(", ");
const CARE_PLAN_CAP = 100;
const CARE_ROWS = 20;

/**
 * The activity statement, exported so a test can EXPLAIN it. Most roles see frequent actions, so `INDEXED BY audit_log_at` keeps the
 * newest-first scan that stops at the limit. The Accountant sees only the finance events, which are rare among the sign-in noise: a
 * newest-first scan would read the whole 30 days to find none, so that role reads them through `audit_log_action` (a seek per action).
 */
export const ACTIVITY_SQL = (ownOnly: boolean, byAction: boolean) =>
  `SELECT a.id, a.at, (SELECT name FROM staff_users WHERE id = a.actor_id) AS actor_name, a.action, a.entity_type, a.entity_id,
          coalesce(l.ref, cl.code, pr.code, ccl.code, d.number_display) AS ref
   FROM audit_log a INDEXED BY ${byAction ? "audit_log_action" : "audit_log_at"}
   LEFT JOIN leads l ON a.entity_type = 'lead' AND l.id = a.entity_id
   LEFT JOIN clients cl ON a.entity_type = 'client' AND cl.id = a.entity_id
   LEFT JOIN projects pr ON a.entity_type = 'project' AND pr.id = a.entity_id
   LEFT JOIN documents d ON a.entity_type = 'document' AND d.id = a.entity_id
   LEFT JOIN care_plans cpl ON a.entity_type = 'care_plan' AND cpl.id = a.entity_id
   LEFT JOIN clients ccl ON ccl.id = cpl.client_id
   WHERE a.at >= ?1 AND a.action IN (SELECT value FROM json_each(?2))${ownOnly ? " AND (a.action NOT IN (SELECT value FROM json_each(?3)) OR a.actor_id = ?4)" : ""}
   ORDER BY a.at DESC, a.rowid DESC LIMIT ${ACTIVITY_LIMIT}`;

/**
 * The pipeline value (M4.3, ADM-DASH-01, a lead call: before tax): the offers out and still acceptable, by currency. A document is out while it is
 * `sent` or `viewed` and its `valid_until` (IST date) is today or later. No "latest version" probe is needed: sending version n moves the sent
 * versions before it to `revised` in the same batch, so at most one version of a group is ever sent or viewed. Both offer types count. The
 * index is `documents_status_valid_until`; the unary plus keeps the type test from tempting the planner away from it.
 */
export const PIPELINE_SQL =
  "SELECT currency, count(*) AS n, coalesce(sum(taxable_minor), 0) AS taxable FROM documents INDEXED BY documents_status_valid_until WHERE status IN ('sent', 'viewed') AND valid_until >= ?1 AND +type IN ('proposal', 'estimate') GROUP BY currency ORDER BY currency";

/** Active plans that have started and that have not (past 100 active plans, where the loaded ones are not all of them), by `care_plans_status_created`. */
export const CARE_TOTALS_SQL =
  "SELECT sum(start_date <= ?1) AS started, sum(start_date > ?1) AS pending FROM care_plans WHERE status = 'active'";

export const dashboard = new Hono<AppEnv>().get("/", async (c) => {
  const me = actor(c);
  const db = c.env.DB;
  const tiles = new Set<TileKey>(tilesFor(me.role));
  const now = Date.now();
  const today = toIsoDate(istDate(now));
  const todayDate = parseIsoDate(today) as NonNullable<ReturnType<typeof parseIsoDate>>;
  const stmts: D1PreparedStatement[] = [];
  const slot: Record<string, number> = {};
  const add = (name: string, ...s: D1PreparedStatement[]) => {
    slot[name] = stmts.length;
    stmts.push(...s);
  };

  if (tiles.has("leads")) {
    add(
      "leads",
      db.prepare(`SELECT stage, count(*) AS n FROM leads WHERE stage IN (${STAGE_LIST}) GROUP BY stage`),
      db.prepare("SELECT count(*) AS n FROM leads WHERE created_at >= ?1").bind(now - 7 * DAY_MS),
      db
        .prepare(
          `SELECT count(*) AS n FROM leads INDEXED BY leads_next_action WHERE next_action_at IS NOT NULL AND next_action_at < ?1 AND stage IN (${STAGE_LIST})`,
        )
        .bind(now),
      db
        .prepare(
          `SELECT id, ref, contact_name, next_action_at FROM leads INDEXED BY leads_next_action WHERE next_action_at IS NOT NULL AND next_action_at < ?1 AND stage IN (${STAGE_LIST}) ORDER BY next_action_at, id LIMIT 5`,
        )
        .bind(now),
    );
  }
  if (tiles.has("pipelineValue")) add("pipeline", db.prepare(PIPELINE_SQL).bind(today));
  // M5.5b (LD80): the finance tile is live, in this same batch: invoiced (this financial year and this month), what clients owe and what is overdue, the proformas
  // that wait for payment, and the export invoices nearing a deadline. "Collected" and "payments to verify" arrive with payments (M6).
  const fy = fyOfDate(todayDate);
  const fyFrom = `${fy.startYear}-04-01`;
  const fyTo = `${fy.startYear + 1}-03-31`;
  const monthFrom = `${today.slice(0, 7)}-01`;
  if (tiles.has("finance")) {
    add(
      "finance",
      db.prepare(INVOICED_SQL).bind(fyFrom, fyTo, monthFrom),
      db.prepare(OWED_SQL).bind(today),
      db.prepare(OVERDUE_OLDEST_SQL).bind(today),
      db.prepare(PROFORMAS_AWAITING_SQL),
      db.prepare(SETTINGS_TAX_SQL),
      db.prepare(EXPORT_STAGE_COUNTS_SQL).bind(today),
      db.prepare(EXPORT_NEXT_SQL).bind(today),
    );
  }
  if (tiles.has("projects")) {
    add(
      "projects",
      db.prepare(
        "SELECT status, count(*) AS n FROM projects WHERE status IN ('planned', 'active', 'on_hold') GROUP BY status",
      ),
    );
  }
  if (tiles.has("milestones")) {
    const to = toIsoDate(addDays(todayDate, MILESTONE_WINDOW_DAYS));
    add(
      "milestones",
      db
        .prepare(
          "SELECT count(*) AS n FROM milestones WHERE status IN ('pending', 'ready_to_bill') AND due_date BETWEEN ?1 AND ?2",
        )
        .bind(today, to),
      db
        .prepare(
          `SELECT m.id, m.project_id, (SELECT code FROM projects WHERE id = m.project_id) AS project_code, m.title, m.due_date, m.status
           FROM milestones m WHERE m.status IN ('pending', 'ready_to_bill') AND m.due_date BETWEEN ?1 AND ?2 ORDER BY m.due_date, m.id LIMIT 10`,
        )
        .bind(today, to),
    );
  }
  if (tiles.has("careBurn")) {
    add("care", ...careStatements(db, { active: CARE_PLAN_CAP }, usageWindow(today, LIST_PERIODS_BACK)));
  }
  if (tiles.has("myTime")) {
    const week = weekOf(today);
    add(
      "myTime",
      db
        .prepare(
          `SELECT coalesce(sum(minutes), 0) AS week_minutes, coalesce(sum(CASE WHEN billable = 1 THEN minutes END), 0) AS week_billable,
                  coalesce(sum(CASE WHEN work_date = ?4 THEN minutes END), 0) AS today_minutes, coalesce(sum(CASE WHEN work_date = ?4 AND billable = 1 THEN minutes END), 0) AS today_billable
           FROM time_logs WHERE user_id = ?1 AND work_date BETWEEN ?2 AND ?3`,
        )
        .bind(me.id, week.start, week.end, today),
    );
  }
  if (tiles.has("activity")) {
    const own = ACTIVITY_OWN_ONLY[me.role];
    add(
      "activity",
      db
        .prepare(ACTIVITY_SQL(own.length > 0, me.role === "accountant"))
        .bind(
          now - ACTIVITY_DAYS * DAY_MS,
          JSON.stringify(ACTIVITY_ACTIONS[me.role]),
          ...(own.length ? [JSON.stringify(own), me.id] : []),
        ),
    );
  }

  const results = stmts.length ? await db.batch<Record<string, unknown>>(stmts) : [];
  const rows = <T>(name: string, offset = 0): T[] =>
    (results[(slot[name] ?? 0) + offset]?.results ?? []) as T[];
  const count = (name: string, offset = 0) => rows<{ n: number }>(name, offset)[0]?.n ?? 0;

  const out: Record<string, unknown> = {};
  if (tiles.has("leads")) {
    const byStage = Object.fromEntries(OPEN_STAGES.map((s) => [s, 0]));
    for (const r of rows<{ stage: string; n: number }>("leads")) byStage[r.stage] = r.n;
    out.leads = {
      openByStage: byStage,
      open: Object.values(byStage).reduce((a, b) => a + b, 0),
      newLast7Days: count("leads", 1),
      overdue: {
        count: count("leads", 2),
        oldest: rows<{ id: string; ref: string; contact_name: string; next_action_at: number }>(
          "leads",
          3,
        ).map((r) => ({
          id: r.id,
          ref: r.ref,
          contactName: r.contact_name,
          dueAt: r.next_action_at,
        })),
      },
    };
  }
  if (tiles.has("pipelineValue")) {
    out.pipelineValue = {
      asOf: today,
      byCurrency: rows<{ currency: string; n: number; taxable: number }>("pipeline").map((r) => ({
        currency: r.currency,
        count: r.n,
        taxableMinor: r.taxable,
      })),
    };
  }
  if (tiles.has("finance")) {
    type Owed = { currency: string; n: number; balance: number; overdue_n: number; overdue_balance: number };
    const owed = rows<Owed>("finance", 1);
    const byCur = (name: string, at: number) =>
      rows<{ currency: string; n: number; balance: number }>(name, at).map((r) => ({
        currency: r.currency,
        count: r.n,
        balanceMinor: r.balance,
      }));
    const stored = rows<{ value: string }>("finance", 4)[0]?.value;
    let taxJson: unknown = {};
    try {
      taxJson = stored === undefined ? {} : JSON.parse(stored);
    } catch {
      taxJson = null;
    }
    // The export statements read the tax row's own values in SQL; if the row is not valid (the no-zod reader says so) their figures are withheld, never guessed.
    const rulesOk = taxJson !== null && realisationParamsFromStoredTax(taxJson).ok;
    const stageCount = new Map(rows<{ stage: string; n: number }>("finance", 5).map((r) => [r.stage, r.n]));
    out.finance = {
      today,
      month: {
        from: monthFrom,
        to: toIsoDate(
          addDays(
            {
              year: todayDate.month === 12 ? todayDate.year + 1 : todayDate.year,
              month: todayDate.month === 12 ? 1 : todayDate.month + 1,
              day: 1,
            },
            -1,
          ),
        ),
      },
      fy: { label: fy.label, from: fyFrom, to: fyTo },
      invoiced: {
        month: rows<InvoicedRow>("finance", 0)
          .filter((r) => r.month_documents > 0)
          .map((r) => ({
            currency: r.currency,
            documents: r.month_documents,
            taxableMinor: r.month_taxable,
            totalMinor: r.month_total,
            inrTaxableMinor: r.month_inr_taxable,
          })),
        fy: rows<InvoicedRow>("finance", 0).map((r) => ({
          currency: r.currency,
          documents: r.fy_documents,
          taxableMinor: r.fy_taxable,
          totalMinor: r.fy_total,
          inrTaxableMinor: r.fy_inr_taxable,
        })),
      },
      outstanding: owed.map((r) => ({ currency: r.currency, count: r.n, balanceMinor: r.balance })),
      overdue: {
        byCurrency: owed
          .filter((r) => r.overdue_n > 0)
          .map((r) => ({ currency: r.currency, count: r.overdue_n, balanceMinor: r.overdue_balance })),
        oldest: rows<{
          id: string;
          number_display: string;
          due_date: string;
          currency: string;
          balance_minor: number;
          client_code: string;
          client_name: string;
        }>("finance", 2).map((r) => ({
          id: r.id,
          number: r.number_display,
          clientCode: r.client_code,
          clientName: r.client_name,
          dueDate: r.due_date,
          currency: r.currency,
          balanceMinor: r.balance_minor,
          daysOverdue: daysBetween(
            parseIsoDate(r.due_date) as NonNullable<ReturnType<typeof parseIsoDate>>,
            todayDate,
          ),
        })),
      },
      proformasAwaiting: byCur("finance", 3),
      exports: rulesOk
        ? {
            counts: {
              femaApproaching: stageCount.get("fema_approaching") ?? 0,
              femaOverdue: stageCount.get("fema_overdue") ?? 0,
              gstApproaching: stageCount.get("gst_approaching") ?? 0,
              gstOverdue: stageCount.get("gst_overdue") ?? 0,
            },
            next: rows<{
              id: string;
              number_display: string;
              client_code: string;
              currency: string;
              balance_minor: number;
              stage: string;
              due: string;
            }>("finance", 6).map((r) => ({
              id: r.id,
              number: r.number_display,
              clientCode: r.client_code,
              currency: r.currency,
              outstandingMinor: r.balance_minor,
              stage: r.stage,
              dueDate: r.due,
            })),
          }
        : { available: false, reason: "settings_invalid" },
      collected: { available: false, arrivesWith: "payments" },
      paymentsToVerify: { available: false, arrivesWith: "payments" },
    };
  }
  if (tiles.has("projects")) {
    const by = Object.fromEntries(
      rows<{ status: string; n: number }>("projects").map((r) => [r.status, r.n]),
    );
    // FX-3 (A3 10): Planned projects count too (work agreed, not started).
    out.projects = { planned: by.planned ?? 0, active: by.active ?? 0, onHold: by.on_hold ?? 0 };
  }
  if (tiles.has("milestones")) {
    out.milestones = {
      windowDays: MILESTONE_WINDOW_DAYS,
      count: count("milestones"),
      next: rows<{
        id: string;
        project_id: string;
        project_code: string | null;
        title: string;
        due_date: string;
        status: string;
      }>("milestones", 1).map((r) => ({
        id: r.id,
        projectId: r.project_id,
        projectCode: r.project_code,
        title: r.title,
        dueDate: r.due_date,
        status: r.status,
      })),
    };
  }
  if (tiles.has("careBurn")) {
    const first = assembleCare(
      {
        plans: rows("care", 0),
        terms: rows("care", 1),
        status: rows("care", 2),
        usage: rows("care", 3),
      },
      CARE_PLAN_CAP,
    );
    let plans = first.plans;
    const truncated = first.truncated;
    // More active plans than the tile loads (the 101st exists): the 100 OLDEST are not the ones to show. Two more calls, only past 100 active
    // plans: ONE statement ranks the started plans by burn (`burnRankQuery`: the 100 highest, the totals of every plan at or past the near and
    // reached thresholds, worked out once, not inside each of the loader's statements) and counts the started and not-yet-started plans
    // (`CARE_TOTALS_SQL`); then the loader reads exactly those 100 by id. A plan over its hours is never missed because it is new.
    let totals: { started: number; pending: number } | null = null;
    // The plans past the loaded 100 that are near or at their hours by the ranking's own figure (it ignores rolled-over hours, so for a plan that
    // carries hours in it is an upper bound; exact for the rest). Added to the exact flags of the loaded plans.
    let beyond = { near: 0, reached: 0 };
    if (truncated) {
      const rank = burnRankQuery(CARE_PLAN_CAP, today);
      const [r, t] = await db.batch<Record<string, unknown>>([
        db.prepare(rank.sql).bind(...rank.bind),
        db.prepare(CARE_TOTALS_SQL).bind(today),
      ]);
      const ranked = (r?.results ?? []) as BurnRankRow[];
      const row = t?.results[0] as { started: number | null; pending: number | null } | undefined;
      totals = { started: row?.started ?? 0, pending: row?.pending ?? 0 };
      if (ranked.length > 0) {
        const [a, b, s, u] = await db.batch(
          careStatements(db, { ids: ranked.map((x) => x.id) }, usageWindow(today, LIST_PERIODS_BACK)),
        );
        plans = assembleCare(
          {
            plans: (a?.results ?? []) as PlanRaw[],
            terms: (b?.results ?? []) as TermsRaw[],
            status: (s?.results ?? []) as StatusRaw[],
            usage: (u?.results ?? []) as UsageRaw[],
          },
          CARE_PLAN_CAP,
        ).plans;
        const first = ranked[0] as BurnRankRow;
        const loadedReached = ranked.filter((x) => x.k >= CARE_REACHED_BP).length;
        const loadedNear = ranked.filter((x) => x.k >= CARE_NEAR_BP && x.k < CARE_REACHED_BP).length;
        beyond = {
          reached: Math.max(0, first.reached - loadedReached),
          near: Math.max(0, first.near_or_reached - first.reached - loadedNear),
        };
      } else plans = new Map();
    }
    const burn = [...plans.values()].flatMap((d) => {
      const u = currentUsage(d, today);
      return u ? [{ d, u }] : [];
    });
    // Reached first (a plan over its hours, even with none available), then near, then the rest; each by burn, then id.
    const FLAG_ORDER = { reached: 0, near: 1, none: 2 } as const;
    burn.sort(
      (a, b) =>
        FLAG_ORDER[a.u.flag] - FLAG_ORDER[b.u.flag] ||
        (b.u.burnBp ?? -1) - (a.u.burnBp ?? -1) ||
        a.d.plan.id.localeCompare(b.d.plan.id),
    );
    out.careBurn = {
      counts: {
        /** Plans with a current period; a plan whose start date hasn't come is counted apart (`notStarted`), never in the burn. */
        active: totals ? totals.started : burn.length,
        notStarted: totals ? totals.pending : plans.size - burn.length,
        near: burn.filter((b) => b.u.flag === "near").length + beyond.near,
        reached: burn.filter((b) => b.u.flag === "reached").length + beyond.reached,
      },
      truncated,
      rows: burn.slice(0, CARE_ROWS).map(({ d, u }) => ({
        planId: d.plan.id,
        clientCode: d.plan.client_code,
        clientName: d.plan.client_name,
        tier: termsOn(d.terms, u.period.start)?.tier ?? d.plan.tier,
        period: u.period,
        used: u.used,
        available: u.available,
        burnBp: u.burnBp,
        flag: u.flag,
        overageMinutes: u.overageMinutes,
      })),
    };
  }
  if (tiles.has("myTime")) {
    const r = rows<{
      week_minutes: number;
      week_billable: number;
      today_minutes: number;
      today_billable: number;
    }>("myTime")[0];
    out.myTime = {
      week: { minutes: r?.week_minutes ?? 0, billableMinutes: r?.week_billable ?? 0, ...weekOf(today) },
      today: { minutes: r?.today_minutes ?? 0, billableMinutes: r?.today_billable ?? 0, date: today },
    };
  }
  if (tiles.has("activity")) {
    out.activity = {
      days: ACTIVITY_DAYS,
      items: rows<{
        id: string;
        at: number;
        actor_name: string | null;
        action: string;
        entity_type: string;
        entity_id: string | null;
        ref: string | null;
      }>("activity").map((r) => ({
        id: r.id,
        at: r.at,
        actor: r.actor_name ?? "System",
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        ref: r.ref,
      })),
    };
  }
  return c.json({ asOf: now, today, tiles: out });
});
