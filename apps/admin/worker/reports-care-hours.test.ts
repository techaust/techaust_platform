// M7.3 C4 (ADM-REP-05; run file I, L13): care plan hours for the billing period that starts in a month. The figures are the care list's (the same loader and core
// `carePeriodUsage`); a plan that starts later in the month has its first period from its start; a plan paused on the period's first day or not started is not a row;
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
const plans = {} as Record<"monthly" | "late" | "started" | "paused" | "future", Plan>;

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
    expect(oct[plans.late.id]?.billed).toBeNull();
    expect(oct[plans.late.id]?.overageBilled).toBeNull();
  });

  it("pages of 50 plans by id; a bad month or a tampered cursor is 400", async () => {
    for (let i = 0; i < 50; i++) await mkPlan(owner.id, { start: "2026-01-01", billingDay: 1 });
    const first = await get("month=2026-10");
    expect(first.rows).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const second = await get(`month=2026-10&after=${first.next}`);
    expect(second.next).toBeNull();
    const ids = [...first.rows, ...second.rows].map((r) => r.planId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    for (const q of [
      "month=2026-13",
      "month=2026-1",
      "month=2026-10&after=x",
      `month=2026-10&after=${encodeCursor({ k: "c", id: "a" })}`,
    ]) {
      expect((await call(`/reports/care-hours?${q}`, { cookie: owner.cookie })).status, q).toBe(400);
    }
    expect((await get("month=2030-01")).rows.length).toBeGreaterThan(0); // a future month: the periods have not started, used 0
  });
});
