// M7.3 (ADM-REP-03, -05; run file docs/runs/m7.3-reports.md C3, C4, L10, L12, L13): the pipeline and win rate (Owner, Sales) and care plan hours (Owner, Staff), on the
// API Worker with the leads and care plans. Read only. The pipeline answers counts and page paths only, never a lead's name, email or company (DPDP minimisation, RB-31
// pattern), over at most 366 days starting no earlier than 12 months before today (leads are deleted 12 months after their last activity: Researched 2026-10-28
// (08-C RB-10); Q3 A). USD offers are shown in USD (Q1 A: an offer has no exchange rate until it is invoiced). Care hours give hours only, never an amount (L13: the
// care draft prices the overage, M5.4), from the shared care loader, so they are the care list's figures.
import { addDays, istDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import type { Currency } from "@techaust/core/money";
import {
  type CareBilled,
  type CareHoursRow,
  carePeriodDay,
  monthBounds,
  type PipelineReport,
  pipelineEarliest,
  pipelineRange,
  rate,
  TIME_TO_WIN_BANDS,
} from "@techaust/core/reports";
import { assembleCare, careStatements, currentUsage } from "@techaust/db/care";
import {
  CARE_HOURS_BILLED_SQL,
  CARE_HOURS_PAGE_SQL,
  type CareBilledSqlRow,
  LEAD_COHORT_SQL,
  OFFERS_DECIDED_SQL,
  OFFERS_SENT_SQL,
  type OffersDecidedSqlRow,
  OPEN_TREND_SQL,
  REPORT_PAGE_SIZE,
  SQL_LEAD_SOURCES,
  SQL_LEAD_STAGES,
  SQL_LOST_REASONS,
  TIME_TO_WIN_MEDIAN_SQL,
} from "@techaust/db/reports";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type ApiError, type AppEnv, BAD_REQUEST, type Ctx, err } from "./context.ts";
import { isoDate, query } from "./http.ts";
import { decodeCursor, encodeCursor } from "./keyset.ts";

const RANGE_ERRORS: Record<string, ApiError> = {
  range_invalid: { code: "range_invalid", message: "Choose a start date on or before the end date" },
  range_too_long: { code: "range_too_long", message: "Choose a period of up to 366 days" },
  range_too_old: {
    code: "range_too_old",
    message: "Leads are deleted 12 months after their last activity, so older periods are not shown.",
  },
};
const MONTH_INVALID: ApiError = { code: "month_invalid", message: "Choose a month" };

/** The query schemas (module top level; B2's warm-up parses one sample of each). */
export const pipelineQuery = z.object({ from: isoDate, to: isoDate });
export const careHoursQuery = z.object({
  month: z.string().check(z.regex(/^\d{4}-(0[1-9]|1[0-2])$/)),
  after: z.optional(z.string().check(z.maxLength(400))),
});

const todayIst = () => toIsoDate(istDate(Date.now()));
const ID = /^[A-Za-z0-9_-]{1,64}$/;
type Rows = { results?: unknown[] } | undefined;
const rowsOf = <T>(r: Rows): T[] => (r?.results ?? []) as T[];

/** C3: the pipeline report of a range, or the refusal's code. */
export async function pipelineReport(
  c: Ctx,
  q: z.infer<typeof pipelineQuery>,
): Promise<PipelineReport | keyof typeof RANGE_ERRORS> {
  const today = todayIst();
  const r = pipelineRange(q.from, q.to, today);
  if (typeof r === "string") return r;
  const db = c.env.DB;
  const [cohort, trend, sent, decided, median] = await db.batch([
    db.prepare(LEAD_COHORT_SQL).bind(r.fromMs, r.toMs),
    db.prepare(OPEN_TREND_SQL).bind(r.from, r.to),
    db.prepare(OFFERS_SENT_SQL).bind(r.fromMs, r.toMs),
    db.prepare(OFFERS_DECIDED_SQL).bind(r.fromMs, r.toMs, r.from, r.to),
    db.prepare(TIME_TO_WIN_MEDIAN_SQL).bind(r.fromMs, r.toMs),
  ]);
  const paths = rowsOf<Record<string, number | string | null>>(cohort);
  const top = paths[0];
  const all = (name: string): number => (top ? Number(top[`all_${name}`] ?? 0) : 0);
  const created = all("created");
  const won = all("st_won");
  const d = rowsOf<OffersDecidedSqlRow>(decided)[0] ?? {
    rejected: 0,
    expired: 0,
    accepted: 0,
    d0_7: 0,
    d8_30: 0,
    d31_90: 0,
    d90_plus: 0,
  };
  return {
    from: r.from,
    to: r.to,
    earliest: pipelineEarliest(today),
    leads: {
      created,
      byStage: Object.fromEntries(SQL_LEAD_STAGES.map((s) => [s, all(`st_${s}`)])),
      lostByReason: Object.fromEntries(SQL_LOST_REASONS.map((s) => [s, all(`lr_${s}`)])),
      bySource: Object.fromEntries(SQL_LEAD_SOURCES.map((s) => [s, all(`src_${s}`)])),
      won,
      conversionBp: rate(won, created),
      topPaths: paths.map((p) => ({
        path: (p.path as string | null) ?? null,
        created: Number(p.created),
        won: Number(p.won),
      })),
    },
    openTrend: rowsOf<{ date: string; open: number }>(trend).map((t) => ({ date: t.date, open: t.open })),
    offers: {
      sent: rowsOf<{ status: string; currency: Currency; n: number; taxable: number }>(sent).map((s) => ({
        status: s.status,
        currency: s.currency,
        count: s.n,
        taxableMinor: s.taxable,
      })),
      accepted: d.accepted,
      rejected: d.rejected,
      expired: d.expired,
      winRateBp: rate(d.accepted, d.accepted + d.rejected + d.expired),
      timeToWin: {
        count: d.accepted,
        medianDays: rowsOf<{ days: number }>(median)[0]?.days ?? null,
        bands: Object.fromEntries(
          TIME_TO_WIN_BANDS.map((b) => [b, d[b]]),
        ) as PipelineReport["offers"]["timeToWin"]["bands"],
      },
    },
  };
}

const billedOf = (r: CareBilledSqlRow | undefined): CareBilled | null =>
  r
    ? {
        documentId: r.document_id,
        number: r.number_display,
        issueDate: r.issue_date,
        status: r.voided_at !== null ? "void" : r.status,
      }
    : null;

export type CareHoursPage = { month: string; today: string; rows: CareHoursRow[]; next: string | null };

/** C4: one page of care plan hours for the billing periods that start in `month`, or the refusal. */
export async function careHoursPage(
  c: Ctx,
  q: z.infer<typeof careHoursQuery>,
): Promise<CareHoursPage | "month" | "cursor"> {
  const bounds = monthBounds(q.month);
  if (!bounds) return "month";
  let after: string | null = null;
  if (q.after !== undefined) {
    const cur = decodeCursor(q.after);
    if (cur?.k !== "p" || !ID.test(cur.id)) return "cursor";
    after = cur.id;
  }
  const db = c.env.DB;
  const today = todayIst();
  const { results } = await db
    .prepare(CARE_HOURS_PAGE_SQL(after !== null))
    .bind(...(after === null ? [q.month, bounds.to] : [q.month, bounds.to, after]))
    .all<{ id: string; day: string }>();
  const page = results.slice(0, REPORT_PAGE_SIZE);
  const last = page.at(-1);
  const next = results.length > REPORT_PAGE_SIZE && last ? encodeCursor({ k: "p", id: last.id }) : null;
  if (page.length === 0) return { month: q.month, today, rows: [], next: null };
  // The minutes up to the month's last day plus 28 days (every plan's period that starts in the month has ended by then), never past today; two periods back
  // from there reach the period that starts in the month and the one before it (whose unused hours may carry in).
  const end = toIsoDate(addDays(parseIsoDate(bounds.to) as NonNullable<ReturnType<typeof parseIsoDate>>, 28));
  const to = today < end ? today : end;
  const ids = page.map((p) => p.id);
  const lateFrom = toIsoDate(
    addDays(parseIsoDate(bounds.to) as NonNullable<ReturnType<typeof parseIsoDate>>, 62),
  );
  const [plans, terms, status, usage, billed] = await db.batch<Record<string, unknown>>([
    ...careStatements(db, { ids }, { to, periodsBack: 2 }),
    db.prepare(CARE_HOURS_BILLED_SQL).bind(JSON.stringify(ids), bounds.from, lateFrom),
  ]);
  const data = assembleCare({
    plans: rowsOf(plans),
    terms: rowsOf(terms),
    status: rowsOf(status),
    usage: rowsOf(usage),
  }).plans;
  const bills = rowsOf<CareBilledSqlRow>(billed);
  const rows: CareHoursRow[] = [];
  for (const p of page) {
    const d = data.get(p.id);
    if (!d) continue;
    const day = carePeriodDay(q.month, d.plan.billing_day, d.plan.start_date);
    const u = day === null ? null : currentUsage(d, day);
    if (!u) continue;
    const mine = bills.filter((b) => b.care_plan_id === p.id);
    rows.push({
      planId: p.id,
      // an anonymised client's display name is already "Anonymised client" (0036), as on the care list
      client: { id: d.plan.client_id, code: d.plan.client_code, name: d.plan.client_name },
      period: u.period,
      includedMinutes: u.included,
      rolloverInMinutes: u.rolloverIn,
      availableMinutes: u.available,
      usedMinutes: u.used,
      overageMinutes: u.overageMinutes,
      burnBp: u.burnBp,
      flag: u.flag,
      billed: billedOf(mine.find((b) => b.period_start === u.period.start)),
      overageBilled: billedOf(mine.find((b) => b.overage_period_start === u.period.start)),
    });
  }
  return { month: q.month, today, rows, next };
}

export const deliveryReports = new Hono<AppEnv>()
  .get("/pipeline", query(pipelineQuery), async (c) => {
    const r = await pipelineReport(c, c.req.valid("query"));
    return typeof r === "string" ? err(c, RANGE_ERRORS[r] ?? BAD_REQUEST, 400) : c.json(r);
  })
  .get("/care-hours", query(careHoursQuery), async (c) => {
    const r = await careHoursPage(c, c.req.valid("query"));
    if (r === "month") return err(c, MONTH_INVALID, 400);
    if (r === "cursor") return err(c, BAD_REQUEST, 400);
    return c.json(r);
  });
