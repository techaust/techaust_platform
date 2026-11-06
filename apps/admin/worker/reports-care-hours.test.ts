// M7.3 C4 (ADM-REP-05; run file I, L13): care plan hours for the billing period that starts in a month. The figures are the care list's (the same loader and core
// `carePeriodUsage`); a plan that starts later in the month has its first period from its start, and one that starts before its billing day has its short first
// period too (two rows that month, review 1 finding 2); a plan paused on the period's first day or not started is not a row;
// the billed state comes from `care_invoices` (the period's own invoice and the one that bills its overage); hours only, never an amount. Invented test data only.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeCursor } from "./keyset.ts";
import type { CareHoursPage } from "./report-delivery.ts";
import { longSession, mkLog, mkPlan } from "./test-care.ts";
import { insert, keysDeep } from "./test-clients.ts";
import { call, pinClock, type TestSession } from "./test-helpers.ts";

let owner: TestSession;
let staff: TestSession;
type Plan = { id: string; client: string };
const plans = {} as Record<"monthly" | "late" | "started" | "paused" | "future" | "short", Plan>;

const get = async (q: string, s: TestSession = owner) => {
  const res = await call(`/reports/care-hours?${q}`, { cookie: s.cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as CareHoursPage;
};
const allRows = async (month: string) => {
  const out: CareHoursPage["rows"] = [];
  let next: string | null = null;
  do {
    const p = await get(`month=${month}${next ? `&after=${next}` : ""}`);
    out.push(...p.rows);
    next = p.next;
  } while (next);
  return out;
};

beforeAll(async () => {
  pinClock(); // 2026-10-15, 12:00 IST
  owner = await longSession("owner");
  staff = await longSession("staff");
  plans.monthly = await mkPlan(owner.id, { start: "2026-01-01", billingDay: 1, included: 600 });
  await mkLog(staff.id, "2026-10-05", 300, { plan: plans.monthly.id });
  await mkLog(staff.id, "2026-10-06", 60, { plan: plans.monthly.id }, { billable: 0 });
  await mkLog(staff.id, "2026-09-30", 120, { plan: plans.monthly.id }); // the period before, not counted
  plans.late = await mkPlan(owner.id, { start: "2026-01-20", billingDay: 20, included: 600 });
  await mkLog(staff.id, "2026-09-25", 705, { plan: plans.late.id }); // its period 20 Sep to 19 Oct: 105 minutes over
  plans.started = await mkPlan(owner.id, { start: "2026-10-10", billingDay: 5, included: 120 });
  plans.paused = await mkPlan(owner.id, { start: "2026-01-01", billingDay: 1 });
  await insert("care_plan_status_log", {
    id: uuidv7(),
    care_plan_id: plans.paused.id,
    status: "paused",
    effective_on: "2026-09-01",
    created_by: owner.id,
    created_at: Date.now(),
  });
  await env.DB.prepare("UPDATE care_plans SET status = 'paused', paused_at = 1 WHERE id = ?1")
    .bind(plans.paused.id)
    .run();
  plans.future = await mkPlan(owner.id, { start: "2026-11-02", billingDay: 2 });
  // review 1 finding 2: started on 3 October with billing day 10, so October has two of its periods: 3 to 9 October (the short first one) and 10 October to 9 November
  plans.short = await mkPlan(owner.id, { start: "2026-10-03", billingDay: 10, included: 120 });
  await mkLog(staff.id, "2026-10-05", 45, { plan: plans.short.id });
  await mkLog(staff.id, "2026-10-12", 150, { plan: plans.short.id });
  // the late plan's October period had a care draft that was discarded: its row stays with the document cleared (early check 6)
  const lateTerms = await env.DB.prepare("SELECT id FROM care_plan_terms WHERE care_plan_id = ?1")
    .bind(plans.late.id)
    .first<{ id: string }>();
  await insert("care_invoices", {
    care_plan_id: plans.late.id,
    period_start: "2026-10-20",
    period_end: "2026-11-19",
    terms_id: lateTerms?.id,
    document_id: null,
    overage_period_start: null,
    overage_minutes: null,
  });

  // billed: October's own invoice of the monthly plan (a draft), and November's, which bills October's overage
  const terms = await env.DB.prepare("SELECT id FROM care_plan_terms WHERE care_plan_id = ?1")
    .bind(plans.monthly.id)
    .first<{ id: string }>();
  for (const [period, end, overage] of [
    ["2026-10-01", "2026-10-31", null],
    ["2026-11-01", "2026-11-30", "2026-10-01"],
  ] as const) {
    const doc = uuidv7();
    await insert("documents", {
      id: doc,
      type: "tax_invoice",
      status: "draft",
      client_id: plans.monthly.client,
      currency: "INR",
      care_plan_id: plans.monthly.id,
    });
    await insert("care_invoices", {
      care_plan_id: plans.monthly.id,
      period_start: period,
      period_end: end,
      terms_id: terms?.id,
      document_id: doc,
      overage_period_start: overage,
      overage_minutes: overage ? 0 : null,
    });
  }
});
afterAll(() => vi.useRealTimers());

describe("GET /reports/care-hours (C4) [ADM-REP-05]", () => {
  it("the periods that start in the month, active on their first day; not started and paused plans are not rows", async () => {
    const rows = await allRows("2026-10");
    const by = Object.fromEntries(rows.map((r) => [r.planId, r]));
    expect(by[plans.monthly.id]).toMatchObject({
      period: { start: "2026-10-01", end: "2026-10-31" },
      includedMinutes: 600,
      usedMinutes: 300,
      overageMinutes: 0,
      burnBp: 5_000,
      flag: "none",
    });
    expect(by[plans.late.id]).toMatchObject({
      period: { start: "2026-10-20", end: "2026-11-19" },
      usedMinutes: 0,
    });
    expect(by[plans.started.id]).toMatchObject({
      period: { start: "2026-10-10", end: "2026-11-04" },
      includedMinutes: 120,
    });
    expect(by[plans.paused.id]).toBeUndefined();
    expect(by[plans.future.id]).toBeUndefined();
    expect(keysDeep(rows).some((k) => /amount|price|rate|Minor$/i.test(k))).toBe(false);
  });

  it("in a plan's start month, a start before the billing day is two rows: the short first period, then the billing-day one (review 1 finding 2)", async () => {
    const rows = (await allRows("2026-10")).filter((r) => r.planId === plans.short.id);
    expect(rows.map((r) => r.period)).toEqual([
      { start: "2026-10-03", end: "2026-10-09" },
      { start: "2026-10-10", end: "2026-11-09" },
    ]);
    // each period's own minutes: 45 in the short one, 150 in the next (120 included, rollover none: 30 over)
    expect(rows[0]).toMatchObject({
      includedMinutes: 120,
      rolloverInMinutes: 0,
      usedMinutes: 45,
      overageMinutes: 0,
      burnBp: 3_750,
      flag: "none",
      billed: null,
      overageBilled: null,
    });
    expect(rows[1]).toMatchObject({
      includedMinutes: 120,
      usedMinutes: 150,
      overageMinutes: 30,
      flag: "reached",
    });
    // the second is the care list's current period (today is 15 October)
    const list = (await (await call("/care-plans?limit=50", { cookie: owner.cookie })).json()) as {
      carePlans: { id: string; usage: { period: { start: string }; used: number; overageMinutes: number } }[];
    };
    expect(list.carePlans.find((p) => p.id === plans.short.id)?.usage).toMatchObject({
      period: { start: "2026-10-10" },
      used: 150,
      overageMinutes: 30,
    });
    // September has none (the plan had not started)
    expect((await allRows("2026-09")).some((r) => r.planId === plans.short.id)).toBe(false);
    // a page can end between a plan's two periods: the cursor (its last row's day and plan id) continues with the second
    const after = await get(`month=2026-10&after=${encodeCursor({ k: "2026-10-03", id: plans.short.id })}`);
    expect(after.rows[0]).toMatchObject({ planId: plans.short.id, period: { start: "2026-10-10" } });
    const past = await get(`month=2026-10&after=${encodeCursor({ k: "2026-10-10", id: plans.short.id })}`);
    expect(past.rows.some((r) => r.planId === plans.short.id)).toBe(false);
  });

  it("the figures are the care list's for the current period", async () => {
    const list = (await (await call("/care-plans?limit=50", { cookie: owner.cookie })).json()) as {
      carePlans: {
        id: string;
        usage: {
          period: { start: string };
          used: number;
          included: number;
          overageMinutes: number;
          burnBp: number | null;
          flag: string;
        };
      }[];
    };
    const usageOf = (id: string) => list.carePlans.find((p) => p.id === id)?.usage;
    const oct = Object.fromEntries((await allRows("2026-10")).map((r) => [r.planId, r]));
    const sep = Object.fromEntries((await allRows("2026-09")).map((r) => [r.planId, r]));
    for (const [row, id] of [
      [oct[plans.monthly.id], plans.monthly.id],
      [sep[plans.late.id], plans.late.id],
    ] as const) {
      const u = usageOf(id);
      expect(row?.period.start).toBe(u?.period.start);
      expect({
        used: row?.usedMinutes,
        included: row?.includedMinutes,
        over: row?.overageMinutes,
        burn: row?.burnBp,
        flag: row?.flag,
      }).toEqual({
        used: u?.used,
        included: u?.included,
        over: u?.overageMinutes,
        burn: u?.burnBp,
        flag: u?.flag,
      });
    }
    expect(sep[plans.late.id]).toMatchObject({ usedMinutes: 705, overageMinutes: 105, flag: "reached" });
  });

  it("the billed state: the period's own care invoice and the one that bills its overage; not billed is null", async () => {
    const oct = Object.fromEntries((await allRows("2026-10")).map((r) => [r.planId, r]));
    expect(oct[plans.monthly.id]?.billed).toMatchObject({ number: null, issueDate: null, status: "draft" });
    expect(oct[plans.monthly.id]?.overageBilled).toMatchObject({ status: "draft" });
    expect(oct[plans.monthly.id]?.billed?.documentId).not.toBe(
      oct[plans.monthly.id]?.overageBilled?.documentId,
    );
    expect(oct[plans.late.id]?.billed).toEqual({
      documentId: null,
      number: null,
      issueDate: null,
      status: "discarded",
    });
    expect(oct[plans.late.id]?.overageBilled).toBeNull();
    expect(oct[plans.started.id]?.billed).toBeNull();
  });

  it("pages of 50 periods by plan id, then period start; a bad month or a tampered cursor is 400", async () => {
    for (let i = 0; i < 50; i++) await mkPlan(owner.id, { start: "2026-01-01", billingDay: 1 });
    const first = await get("month=2026-10");
    expect(first.rows).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const second = await get(`month=2026-10&after=${first.next}`);
    expect(second.next).toBeNull();
    // one row per plan and period (the short plan has two), each once, in (plan id, period start) order
    const keys = [...first.rows, ...second.rows].map((r) => `${r.planId}|${r.period.start}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(keys);
    expect(keys.filter((k) => k.startsWith(`${plans.short.id}|`))).toHaveLength(2);
    expect(keys).toHaveLength(55); // monthly, late, started, short twice, and the 50 new plans
    for (const q of [
      "month=2026-13",
      "month=2026-1",
      "month=2026-10&after=x",
      `month=2026-10&after=${encodeCursor({ k: "c", id: "a" })}`,
      // the cursor before review 1 finding 2 (`k: "p"`), a day outside the month and a malformed day
      `month=2026-10&after=${encodeCursor({ k: "p", id: plans.short.id })}`,
      `month=2026-10&after=${encodeCursor({ k: "2026-11-01", id: plans.short.id })}`,
      `month=2026-10&after=${encodeCursor({ k: "2026-10-32", id: plans.short.id })}`,
      `month=2026-10&after=${encodeCursor({ k: 5, id: plans.short.id })}`,
      `month=2026-10&after=${encodeCursor({ k: "2026-10-03", id: "bad id!" })}`,
    ]) {
      expect((await call(`/reports/care-hours?${q}`, { cookie: owner.cookie })).status, q).toBe(400);
    }
    // this month (October 2026 on the pinned clock) is the last one; a month after it is refused (early check 5)
    expect((await get("month=2026-10")).rows.length).toBeGreaterThan(0);
    for (const q of ["month=2026-11", "month=2030-01"]) {
      const res = await call(`/reports/care-hours?${q}`, { cookie: owner.cookie });
      expect(res.status, q).toBe(400);
      // the lead's approved staff line (review 1 finding 14, Q4), the same words as the SPA's `monthInvalid`
      expect((await res.json()) as { error: { code: string; message: string } }, q).toMatchObject({
        error: { code: "month_invalid", message: "Choose a month up to this one" },
      });
    }
  });
});
