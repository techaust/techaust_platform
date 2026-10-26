// M3.5 schema (0028, 0029) [ADM-CARE-01, ADM-CARE-03, ADM-TIME-01..03]: the history tables, the time-log triggers, the mirror guards,
// the SQL twin of the billing period, and the shared loader with its plans.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { periodOf, periodStartSql } from "@techaust/core/care";
import { describe, expect, it } from "vitest";
import {
  assembleCare,
  burnRankQuery,
  careQueries,
  careStatements,
  currentUsage,
  pastUsage,
} from "../src/care.ts";
import { all, first, insertClient, rejects, run } from "./helpers.ts";

let n = 0;
let tick = 1_700_000_000_000;
const next = () => ++tick;

async function mkStaff(): Promise<string> {
  const id = uuidv7();
  n++;
  await run(
    "INSERT INTO staff_users (id, email, name, role) VALUES (?, ?, 'Staff', 'staff')",
    id,
    `s${n}@example.test`,
  );
  return id;
}

type PlanOpts = {
  start?: string;
  billingDay?: number;
  included?: number;
  rate?: number | null;
  rollover?: "none" | "one_month";
  status?: "active" | "paused" | "cancelled";
};
/** A plan with its first terms row and an `active` status row on the start date (as the API writes them). */
async function mkPlan(by: string, o: PlanOpts = {}) {
  const id = uuidv7();
  const client = await insertClient(`C-M35-${++n}`);
  const start = o.start ?? "2026-11-01";
  await run(
    "INSERT INTO care_plans (id, client_id, tier, currency, price_minor, included_minutes, start_date, billing_day, status, rollover, overage_rate_minor) VALUES (?1, ?2, 'growth', 'INR', 2499900, ?3, ?4, ?5, 'active', ?6, ?7)",
    id,
    client,
    o.included ?? 600,
    start,
    o.billingDay ?? 1,
    o.rollover ?? "none",
    o.rate === undefined ? 150_000 : o.rate,
  );
  await run(
    "INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, overage_rate_minor, rollover, created_by, created_at) VALUES (?, ?, ?, 'growth', 2499900, ?, ?, ?, ?, ?)",
    uuidv7(),
    id,
    start,
    o.included ?? 600,
    o.rate === undefined ? 150_000 : o.rate,
    o.rollover ?? "none",
    by,
    next(),
  );
  await run(
    "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?, ?, 'active', ?, ?, ?)",
    uuidv7(),
    id,
    start,
    by,
    next(),
  );
  return { id, client };
}

const status = (plan: string, s: string, on: string, by: string, mirror = true) =>
  run(
    "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    uuidv7(),
    plan,
    s,
    on,
    by,
    next(),
  ).then(() => (mirror ? run("UPDATE care_plans SET status = ? WHERE id = ?", s, plan) : undefined));

async function mkProject(status = "active") {
  const id = uuidv7();
  n++;
  await run(
    "INSERT INTO projects (id, code, client_id, name, currency, status) VALUES (?, ?, ?, 'P', 'INR', ?)",
    id,
    `PRJ-M35-${n}`,
    await insertClient(`C-M35P-${n}`),
    status,
  );
  return id;
}

const log = (
  user: string,
  date: string,
  minutes: number,
  target: { project?: string; plan?: string },
  extra = "",
) =>
  run(
    `INSERT INTO time_logs (id, user_id, work_date, minutes, project_id, care_plan_id, billable, created_at, updated_at${extra ? ", note" : ""}) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?${extra ? ", ?" : ""})`,
    uuidv7(),
    user,
    date,
    minutes,
    target.project ?? null,
    target.plan ?? null,
    next(),
    tick,
    ...(extra ? [extra] : []),
  );

describe("the M3.5 tables (0028)", () => {
  it("terms are checked: 15-minute steps, no negatives, a real date, a known tier and rule", async () => {
    const by = await mkStaff();
    const { id } = await mkPlan(by);
    const ins = (over: Record<string, unknown>) => {
      const row = {
        effective_from: "2026-12-01",
        tier: "growth",
        price_minor: 1,
        included_minutes: 600,
        ai_ops_minor: null,
        overage_rate_minor: null,
        rollover: "none",
        ...over,
      };
      return run(
        "INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, ai_ops_minor, overage_rate_minor, rollover, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        uuidv7(),
        id,
        row.effective_from,
        row.tier,
        row.price_minor,
        row.included_minutes,
        row.ai_ops_minor,
        row.overage_rate_minor,
        row.rollover,
        by,
      );
    };
    await ins({});
    await rejects(ins({ included_minutes: 610 }), /care_plan_terms_included/);
    await rejects(ins({ included_minutes: -15 }), /care_plan_terms_included/);
    await rejects(ins({ price_minor: -1 }), /care_plan_terms_price/);
    await rejects(ins({ ai_ops_minor: -1 }), /care_plan_terms_ai_ops/);
    await rejects(ins({ overage_rate_minor: -1 }), /care_plan_terms_rate/);
    await rejects(ins({ tier: "gold" }), /care_plan_terms_tier/);
    await rejects(ins({ rollover: "two_months" }), /care_plan_terms_rollover/);
    for (const bad of ["2026-02-30", "not a date", "2026-1-1", "20261201"])
      await rejects(ins({ effective_from: bad }), /care_plan_terms_date/);
    await ins({ included_minutes: 0, overage_rate_minor: 0, ai_ops_minor: 0 });
  });

  it("status rows are checked, and stats_daily takes integers on real dates, once per key", async () => {
    const by = await mkStaff();
    const { id } = await mkPlan(by);
    await rejects(status(id, "frozen", "2026-12-01", by, false), /care_plan_status_log_status/);
    await rejects(status(id, "paused", "2026-12-32", by, false), /care_plan_status_log_date/);
    await run(
      "INSERT INTO stats_daily (date, metric, dimension, value) VALUES ('2026-11-30', 'leads.open', 'new', 4)",
    );
    await run("INSERT INTO stats_daily (date, metric, value) VALUES ('2026-11-30', 'milestones.due_14d', 2)");
    await rejects(
      run(
        "INSERT INTO stats_daily (date, metric, dimension, value) VALUES ('2026-11-30', 'leads.open', 'new', 5)",
      ),
      /UNIQUE|PRIMARY/,
    );
    await rejects(
      run("INSERT INTO stats_daily (date, metric, value) VALUES ('2026-11-31', 'x', 1)"),
      /stats_daily_date/,
    );
    await rejects(
      run("INSERT INTO stats_daily (date, metric, value) VALUES ('2026-11-30', 'y', 'many')"),
      /stats_daily_value/,
    );
    await rejects(
      run("INSERT INTO stats_daily (date, metric, value) VALUES ('2026-11-30', 'z', 1.5)"),
      /stats_daily_value/,
    );
    expect(
      (
        await first<{ dimension: string }>(
          "SELECT dimension FROM stats_daily WHERE metric = 'milestones.due_14d'",
        )
      )?.dimension,
    ).toBe("");
    await run(
      "INSERT INTO stats_daily (date, metric, dimension, value) VALUES ('2026-11-30', 'leads.open', 'new', 9) ON CONFLICT(date, metric, dimension) DO UPDATE SET value = excluded.value",
    );
    expect(
      (await first<{ value: number }>("SELECT value FROM stats_daily WHERE metric = 'leads.open'"))?.value,
    ).toBe(9);
  });

  it("has the indexes the lists and the dashboard use", async () => {
    const names = async (t: string) =>
      (await all<{ name: string }>(`SELECT name FROM pragma_index_list('${t}')`)).map((i) => i.name);
    expect(await names("time_logs")).toEqual(
      expect.arrayContaining([
        "time_logs_date",
        "time_logs_care_usage",
        "time_logs_user_date",
        "time_logs_project_date",
      ]),
    );
    // dropped by 0030: time_logs_care_usage starts with the same two columns (early check L5)
    expect(await names("time_logs")).not.toContain("time_logs_care_plan_date");
    expect(await names("care_plans")).toEqual(
      expect.arrayContaining(["care_plans_created", "care_plans_status_created"]),
    );
    expect(await names("care_plan_terms")).toContain("care_plan_terms_plan");
    expect(await names("care_plan_status_log")).toContain("care_plan_status_log_plan");
    expect(await names("stats_daily")).toContain("stats_daily_metric");
  });
});

describe("time-log triggers (0029)", () => {
  it("an entry has exactly one target, on insert and on update", async () => {
    const u = await mkStaff();
    const p = await mkProject();
    const { id: plan } = await mkPlan(u);
    await rejects(log(u, "2026-11-10", 60, {}), /time_logs_one_target_insert/);
    await rejects(log(u, "2026-11-10", 60, { project: p, plan }), /time_logs_one_target_insert/);
    await log(u, "2026-11-10", 60, { project: p });
    const e = (await first<{ id: string }>("SELECT id FROM time_logs WHERE user_id = ?", u))?.id;
    await rejects(
      run("UPDATE time_logs SET care_plan_id = ? WHERE id = ?", plan, e),
      /time_logs_one_target_update/,
    );
    await rejects(
      run("UPDATE time_logs SET project_id = NULL WHERE id = ?", e),
      /time_logs_one_target_update/,
    );
    await run("UPDATE time_logs SET project_id = NULL, care_plan_id = ? WHERE id = ?", plan, e);
  });

  it("a person logs at most 1,440 minutes a day: insert, raising an entry, and moving one onto a full day", async () => {
    const u = await mkStaff();
    const other = await mkStaff();
    const p = await mkProject();
    await log(u, "2026-11-10", 720, { project: p });
    await log(u, "2026-11-10", 720, { project: p });
    await rejects(log(u, "2026-11-10", 15, { project: p }), /time_logs_day_cap_insert/);
    await log(other, "2026-11-10", 1_440, { project: p }); // another person's day is their own
    await log(u, "2026-11-11", 60, { project: p });
    const second = (
      await first<{ id: string }>(
        "SELECT id FROM time_logs WHERE user_id = ? AND work_date = '2026-11-11'",
        u,
      )
    )?.id;
    await rejects(
      run("UPDATE time_logs SET work_date = '2026-11-10' WHERE id = ?", second),
      /time_logs_day_cap_update/,
    );
    const full = (
      await first<{ id: string }>(
        "SELECT id FROM time_logs WHERE user_id = ? AND work_date = '2026-11-10'",
        u,
      )
    )?.id;
    await run("UPDATE time_logs SET minutes = 705 WHERE id = ?", full); // down is fine
    await run("UPDATE time_logs SET minutes = 720 WHERE id = ?", full); // back to the cap is fine
    await rejects(run("UPDATE time_logs SET minutes = 735 WHERE id = ?", full), /time_logs_day_cap_update/);
    await rejects(log(u, "2026-11-12", 1_455, { project: p }), /time_logs_day_cap_insert|time_logs_minutes/);
    await rejects(log(u, "2026-11-12", 10, { project: p }), /time_logs_minutes/);
    await run("UPDATE time_logs SET note = 'x' WHERE id = ?", full); // a note change never meets the cap
  });

  it("the work date is a real date", async () => {
    const u = await mkStaff();
    const p = await mkProject();
    for (const bad of ["2026-02-30", "2026-13-01", "tomorrow", "2026-1-5", "20261105"])
      await rejects(log(u, bad, 60, { project: p }), /time_logs_date_valid_insert/);
    await log(u, "2026-11-05", 60, { project: p });
    const e = (await first<{ id: string }>("SELECT id FROM time_logs WHERE user_id = ?", u))?.id;
    await rejects(
      run("UPDATE time_logs SET work_date = '2026-02-30' WHERE id = ?", e),
      /time_logs_date_valid_update/,
    );
  });

  it("a care-plan entry needs the plan to be active on that date: pause, resume, start date, cancel", async () => {
    const by = await mkStaff();
    const u = await mkStaff();
    const { id: plan } = await mkPlan(by, { start: "2026-11-01" });
    await rejects(log(u, "2026-10-31", 60, { plan }), /time_logs_plan_active_insert/); // before the start
    await log(u, "2026-11-01", 60, { plan });
    await status(plan, "paused", "2026-11-20", by);
    await log(u, "2026-11-19", 60, { plan }); // the day before the pause
    await rejects(log(u, "2026-11-20", 60, { plan }), /time_logs_plan_active_insert/);
    await rejects(log(u, "2026-11-22", 60, { plan }), /time_logs_plan_active_insert/);
    await status(plan, "active", "2026-11-25", by);
    await rejects(log(u, "2026-11-24", 60, { plan }), /time_logs_plan_active_insert/); // still paused that day
    await log(u, "2026-11-25", 60, { plan });
    // pause and resume on the same day: that day is active (the later row wins)
    await status(plan, "paused", "2026-12-05", by);
    await status(plan, "active", "2026-12-05", by);
    await log(u, "2026-12-05", 60, { plan });
    // moving an entry onto a paused date is refused; editing its minutes is not
    const e = (
      await first<{ id: string }>(
        "SELECT id FROM time_logs WHERE user_id = ? AND work_date = '2026-11-19'",
        u,
      )
    )?.id;
    await rejects(
      run("UPDATE time_logs SET work_date = '2026-11-22' WHERE id = ?", e),
      /time_logs_plan_active_update/,
    );
    await run("UPDATE time_logs SET minutes = 120 WHERE id = ?", e);
    // cancelled: nothing from the cancellation day on, earlier entries stay
    await status(plan, "cancelled", "2026-12-10", by);
    await log(u, "2026-12-09", 60, { plan });
    await rejects(log(u, "2026-12-10", 60, { plan }), /time_logs_plan_active_insert/);
    await run("UPDATE time_logs SET minutes = 90 WHERE id = ?", e);
  });

  it("a pause before the start date takes effect on the start date, and a plan with no history refuses time", async () => {
    const by = await mkStaff();
    const u = await mkStaff();
    const { id: plan } = await mkPlan(by, { start: "2026-12-01" });
    await status(plan, "paused", "2026-12-01", by); // asked for on 2026-11-20: effective on the start date
    await rejects(log(u, "2026-12-01", 60, { plan }), /time_logs_plan_active_insert/);
    await rejects(log(u, "2026-11-30", 60, { plan }), /time_logs_plan_active_insert/);
    const bare = uuidv7();
    await run(
      "INSERT INTO care_plans (id, client_id, tier, currency, price_minor, included_minutes, start_date, billing_day) VALUES (?, ?, 'custom', 'INR', 0, 0, '2026-01-01', 1)",
      bare,
      await insertClient(`C-M35-bare-${++n}`),
    );
    await rejects(log(u, "2026-02-01", 60, { plan: bare }), /time_logs_plan_active_insert/);
  });

  it("nothing is logged on a cancelled project; a completed one still takes time", async () => {
    const u = await mkStaff();
    const open = await mkProject("active");
    const done = await mkProject("completed");
    const dead = await mkProject("cancelled");
    await log(u, "2026-11-10", 60, { project: open });
    await log(u, "2026-11-10", 60, { project: done });
    await rejects(log(u, "2026-11-10", 60, { project: dead }), /time_logs_project_open_insert/);
    const e = (await first<{ id: string }>("SELECT id FROM time_logs WHERE project_id = ?", open))?.id;
    await rejects(
      run("UPDATE time_logs SET project_id = ? WHERE id = ?", dead, e),
      /time_logs_project_open_update/,
    );
    await run("UPDATE projects SET status = 'cancelled' WHERE id = ?", open);
    await run("UPDATE time_logs SET minutes = 90 WHERE id = ?", e); // an old entry on a project cancelled since can still be edited
  });

  it("an entry's person never changes", async () => {
    const a = await mkStaff();
    const b = await mkStaff();
    const p = await mkProject();
    await log(a, "2026-11-10", 60, { project: p });
    const e = (await first<{ id: string }>("SELECT id FROM time_logs WHERE user_id = ?", a))?.id;
    await rejects(run("UPDATE time_logs SET user_id = ? WHERE id = ?", b, e), /time_logs_user_fixed/);
    await run("UPDATE time_logs SET user_id = ? WHERE id = ?", a, e);
  });
});

describe("care plan guards (0029)", () => {
  it("terms and status history are append-only", async () => {
    const by = await mkStaff();
    const { id } = await mkPlan(by);
    for (const t of ["care_plan_terms", "care_plan_status_log"] as const) {
      await rejects(
        run(`UPDATE ${t} SET created_by = ? WHERE care_plan_id = ?`, by, id),
        new RegExp(`${t}_no_update`),
      );
      await rejects(run(`DELETE FROM ${t} WHERE care_plan_id = ?`, id), new RegExp(`${t}_no_delete`));
    }
  });

  it("a plan's client, currency, billing day and start date never change", async () => {
    const by = await mkStaff();
    const { id } = await mkPlan(by);
    const other = await insertClient(`C-M35-other-${++n}`);
    await rejects(run("UPDATE care_plans SET client_id = ? WHERE id = ?", other, id), /care_plans_fixed/);
    await rejects(run("UPDATE care_plans SET currency = 'USD' WHERE id = ?", id), /care_plans_fixed/);
    await rejects(run("UPDATE care_plans SET billing_day = 5 WHERE id = ?", id), /care_plans_fixed/);
    await rejects(
      run("UPDATE care_plans SET start_date = '2026-12-01' WHERE id = ?", id),
      /care_plans_fixed/,
    );
    await run("UPDATE care_plans SET billing_day = 1, updated_at = 5 WHERE id = ?", id); // the same value is fine
  });

  it("the price, hours, rate, rollover and tier follow the newest terms row", async () => {
    const by = await mkStaff();
    const { id } = await mkPlan(by);
    await rejects(run("UPDATE care_plans SET price_minor = 1 WHERE id = ?", id), /care_plans_terms_match/);
    await rejects(
      run("UPDATE care_plans SET included_minutes = 900 WHERE id = ?", id),
      /care_plans_terms_match/,
    );
    await rejects(
      run("UPDATE care_plans SET rollover = 'one_month' WHERE id = ?", id),
      /care_plans_terms_match/,
    );
    await rejects(
      run("UPDATE care_plans SET overage_rate_minor = 1 WHERE id = ?", id),
      /care_plans_terms_match/,
    );
    await rejects(run("UPDATE care_plans SET ai_ops_minor = 1 WHERE id = ?", id), /care_plans_terms_match/);
    await rejects(run("UPDATE care_plans SET tier = 'scale' WHERE id = ?", id), /care_plans_terms_match/);
    await run(
      "INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, ai_ops_minor, overage_rate_minor, rollover, created_by) VALUES (?, ?, '2027-01-01', 'scale', 5000000, 900, 2000000, 200000, 'one_month', ?)",
      uuidv7(),
      id,
      by,
    );
    await run(
      "UPDATE care_plans SET tier = 'scale', price_minor = 5000000, included_minutes = 900, ai_ops_minor = 2000000, overage_rate_minor = 200000, rollover = 'one_month' WHERE id = ?",
      id,
    );
    await rejects(
      run("UPDATE care_plans SET price_minor = 5000001 WHERE id = ?", id),
      /care_plans_terms_match/,
    );
    // a NULL rate or add-on in the newest row is matched as NULL
    await run(
      "INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, rollover, created_by, created_at) VALUES (?, ?, '2027-01-01', 'scale', 5000000, 900, 'one_month', ?, ?)",
      uuidv7(),
      id,
      by,
      Date.now() + 60_000,
    );
    await rejects(
      run("UPDATE care_plans SET overage_rate_minor = 200000 WHERE id = ?", id),
      /care_plans_terms_match/,
    );
    await run("UPDATE care_plans SET overage_rate_minor = NULL, ai_ops_minor = NULL WHERE id = ?", id);
  });

  it("the status follows the newest status row", async () => {
    const by = await mkStaff();
    const { id } = await mkPlan(by);
    await rejects(run("UPDATE care_plans SET status = 'paused' WHERE id = ?", id), /care_plans_status_match/);
    await rejects(
      run("UPDATE care_plans SET status = 'cancelled' WHERE id = ?", id),
      /care_plans_status_match/,
    );
    await status(id, "paused", "2026-12-01", by);
    expect((await first<{ status: string }>("SELECT status FROM care_plans WHERE id = ?", id))?.status).toBe(
      "paused",
    );
    await rejects(run("UPDATE care_plans SET status = 'active' WHERE id = ?", id), /care_plans_status_match/);
    await run("UPDATE care_plans SET paused_at = 5, updated_at = 6 WHERE id = ?", id); // other columns are free
  });
});

describe("periodStartSql is periodOf (billing days 1 to 28, 2026-01-01 to 2029-12-31)", () => {
  it("agrees on every date, in one recursive query", async () => {
    const rows = await all<{ b: number; d: string; ps: string }>(
      `WITH RECURSIVE d(x) AS (SELECT '2026-01-01' UNION ALL SELECT date(x, '+1 day') FROM d WHERE x < '2029-12-31'),
         b(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM b WHERE n < 28)
       SELECT b.n AS b, d.x AS d, ${periodStartSql("d.x", "b.n")} AS ps FROM d, b`,
    );
    expect(rows).toHaveLength(28 * 1_461);
    const wrong = rows.filter((r) => periodOf(r.d, r.b).start !== r.ps);
    expect(wrong.slice(0, 5)).toEqual([]);
  });
});

describe("the shared loader", () => {
  const usageOf = async (plan: string, to: string, periodsBack: number) => {
    const [a, b, c, d] = careStatements(env.DB, { ids: [plan] }, { to, periodsBack });
    const [plans, terms, st, usage] = await env.DB.batch([a, b, c, d]);
    return assembleCare({
      plans: plans?.results as never,
      terms: terms?.results as never,
      status: st?.results as never,
      usage: usage?.results as never,
    });
  };

  it("loads a plan, its history and the minutes by period, and the assembler gets the hand-computed overage", async () => {
    const by = await mkStaff();
    const u = await mkStaff();
    const { id: plan } = await mkPlan(by, { start: "2026-09-01", rollover: "one_month" });
    // October used 480 billable (120 carried), November 780 billable and 60 not billable
    await run(
      "INSERT INTO time_logs (id, user_id, work_date, minutes, care_plan_id, billable, created_at, updated_at) VALUES (?, ?, '2026-10-12', 480, ?, 1, ?, ?)",
      uuidv7(),
      u,
      plan,
      next(),
      tick,
    );
    await run(
      "INSERT INTO time_logs (id, user_id, work_date, minutes, care_plan_id, billable, created_at, updated_at) VALUES (?, ?, '2026-11-03', 780, ?, 1, ?, ?)",
      uuidv7(),
      u,
      plan,
      next(),
      tick,
    );
    await run(
      "INSERT INTO time_logs (id, user_id, work_date, minutes, care_plan_id, billable, created_at, updated_at) VALUES (?, ?, '2026-11-04', 60, ?, 0, ?, ?)",
      uuidv7(),
      u,
      plan,
      next(),
      tick,
    );
    const { plans, truncated } = await usageOf(plan, "2026-11-30", 3);
    expect(truncated).toBe(false);
    const data = plans.get(plan);
    expect(data?.terms).toHaveLength(1);
    expect(data?.statuses).toHaveLength(1);
    expect([...(data?.usage.keys() ?? [])].sort()).toEqual(["2026-10-01", "2026-11-01"]);
    const now = currentUsage(data as never, "2026-11-20");
    expect(now).toMatchObject({
      included: 600,
      rolloverIn: 120,
      available: 720,
      used: 780,
      nonBillable: 60,
      overageMinutes: 60,
      overageMinor: 150_000,
      burnBp: 10_833,
      flag: "reached",
    });
    // the short window (this period and the one before) gives the same current period as the long one
    const short = (await usageOf(plan, "2026-11-20", 1)).plans.get(plan);
    expect([...(short?.usage.keys() ?? [])].sort()).toEqual(["2026-10-01", "2026-11-01"]);
    expect(currentUsage(short as never, "2026-11-20")).toEqual(now);
    const past = pastUsage(data as never, "2026-11-20", 12);
    expect(past.map((p) => p.period.start)).toEqual(["2026-11-01", "2026-10-01", "2026-09-01"]);
    expect(past[1]).toMatchObject({ used: 480, overageMinutes: 0 });
  });

  it("the active source keeps a cap and says when there were more", async () => {
    const by = await mkStaff();
    const ids = [] as string[];
    for (let i = 0; i < 3; i++) ids.push((await mkPlan(by)).id);
    const [a, b, c, d] = careStatements(env.DB, { active: 2 }, { to: "2026-12-31", periodsBack: 1 });
    const res = await env.DB.batch([a, b, c, d]);
    const out = assembleCare(
      {
        plans: res[0]?.results as never,
        terms: res[1]?.results as never,
        status: res[2]?.results as never,
        usage: res[3]?.results as never,
      },
      2,
    );
    expect(out.plans.size).toBe(2);
    expect(out.truncated).toBe(true);
    for (const data of out.plans.values()) expect(data.terms.length).toBeGreaterThan(0);
  });

  it("the active source pages with `after`: every active plan once, in (created_at, id) order, and an unknown plan id gives an empty page", async () => {
    const by = await mkStaff();
    for (let i = 0; i < 5; i++) await mkPlan(by);
    const everyone = (
      await all<{ id: string }>("SELECT id FROM care_plans WHERE status = 'active' ORDER BY created_at, id")
    ).map((r) => r.id);
    expect(everyone.length).toBeGreaterThanOrEqual(5);
    const pageOf = async (after?: string) => {
      const source = after === undefined ? { active: 2 } : { active: 2, after };
      const res = await env.DB.batch(careStatements(env.DB, source, { to: "2026-12-31", periodsBack: 1 }));
      return assembleCare(
        {
          plans: res[0]?.results as never,
          terms: res[1]?.results as never,
          status: res[2]?.results as never,
          usage: res[3]?.results as never,
        },
        2,
      );
    };
    const seen: string[] = [];
    let after: string | undefined;
    for (let guard = 0; guard < 50; guard++) {
      const page = await pageOf(after);
      const ids = [...page.plans.keys()];
      seen.push(...ids);
      if (!page.truncated) break;
      expect(ids).toHaveLength(2);
      after = ids.at(-1);
    }
    expect(seen).toEqual(everyone);
    expect((await pageOf("no-such-plan")).plans.size).toBe(0);
  });

  it("the burn ranking gives the started active plans with the largest used share of the hours in force, and the whole-set totals on every row (M4.3 re-check)", async () => {
    const by = await mkStaff();
    const today = "2030-06-15"; // period 1 June to 30 June (billing day 1); the plans of the other tests have no minutes then
    const mk = (o: PlanOpts) => mkPlan(by, { start: "2030-01-01", ...o });
    const a = await mk({ included: 600 }); // 300 of 600: 5,000 bp
    const b = await mk({ included: 600 }); // 540 of 600: 9,000 bp
    const c = await mk({ included: 0 }); // no hours, any billable time: first
    const d = await mk({ included: 600 }); // the terms in force from 1 June give 60 minutes: 45 of 60 is 7,500 bp
    const e = await mk({ included: 600 }); // minutes only in the previous period: nothing this period
    const f = await mk({ included: 600 }); // paused: never ranked
    const g = await mk({ start: "2031-01-01", included: 600 }); // not started: never ranked
    const h = await mk({ start: "2030-06-10", included: 600 }); // began MID-period: its first terms start on 10 June, after the natural 1 June
    await run(
      "INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, overage_rate_minor, rollover, created_by, created_at) VALUES (?, ?, '2030-06-01', 'growth', 2499900, 60, 150000, 'none', ?, ?)",
      uuidv7(),
      d.id,
      by,
      next(),
    );
    await log(by, "2030-06-10", 300, { plan: a.id });
    await log(by, "2030-06-10", 540, { plan: b.id });
    await log(by, "2030-06-10", 15, { plan: c.id });
    await log(by, "2030-06-10", 45, { plan: d.id });
    await log(by, "2030-05-20", 600, { plan: e.id });
    await log(by, "2030-06-05", 600, { plan: f.id });
    await status(f.id, "paused", "2030-06-12", by);
    await log(by, "2030-06-12", 600, { plan: h.id }); // 600 of 600: reached (the FULL hours for the partial first period)
    const ranked = async (n: number) => {
      const q = burnRankQuery(n, today);
      return all<{ id: string; k: number; near_or_reached: number; reached: number }>(q.sql, ...q.bind);
    };
    // the plans of the earlier tests in this file have no minutes in June 2030 (k is 0 or -1), so the top of the ranking is these plans only
    const top = await ranked(100);
    const byId = new Map(top.map((r) => [r.id, r]));
    expect(byId.get(c.id)?.k).toBe(1_000_000_000);
    expect(byId.get(h.id)?.k).toBe(10_000); // before the fix: no terms row on or before 1 June gave NULL, and the plan ranked as 1,000,000,000
    expect(byId.get(b.id)?.k).toBe(9_000);
    expect(byId.get(d.id)?.k).toBe(7_500);
    expect(byId.get(a.id)?.k).toBe(5_000);
    expect(byId.get(e.id)?.k).toBe(0);
    expect(byId.has(f.id)).toBe(false);
    expect(byId.has(g.id)).toBe(false);
    // order: the no-hours plan first, then 10,000, 9,000, 7,500, 5,000
    expect(top.slice(0, 5).map((r) => r.id)).toEqual([c.id, h.id, b.id, d.id, a.id]);
    // the totals over the WHOLE set are on every row: at or past 80 %: c, h, b (d is 75 %); at or past 100 %: c, h
    expect(new Set(top.map((r) => `${r.near_or_reached}/${r.reached}`))).toEqual(new Set(["3/2"]));
    // a cap cuts the rows, never the totals
    const two = await ranked(2);
    expect(two.map((r) => r.id)).toEqual([c.id, h.id]);
    expect(two.every((r) => r.near_or_reached === 3 && r.reached === 2)).toBe(true);
    // the loader reads exactly the ids picked, with their usage and terms, and the exact burn is the pure function's
    const res = await env.DB.batch(
      careStatements(env.DB, { ids: two.map((r) => r.id) }, { to: today, periodsBack: 1 }),
    );
    const loaded = assembleCare(
      {
        plans: res[0]?.results as never,
        terms: res[1]?.results as never,
        status: res[2]?.results as never,
        usage: res[3]?.results as never,
      },
      2,
    );
    expect([...loaded.plans.keys()].sort()).toEqual([c.id, h.id].sort());
    expect(currentUsage(loaded.plans.get(h.id) as never, today)).toMatchObject({
      used: 600,
      available: 600,
      flag: "reached",
    });
    expect(currentUsage(loaded.plans.get(c.id) as never, today)).toMatchObject({ used: 15, flag: "reached" });
  });

  it("the burn ranking is served by indexes (EXPLAIN QUERY PLAN)", async () => {
    const q = burnRankQuery(100, "2030-06-15");
    const text = (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${q.sql}`, ...q.bind))
      .map((p) => p.detail)
      .join("\n");
    expect(text, q.sql).not.toMatch(
      /SCAN (care_plans|care_plan_terms|care_plan_status_log|time_logs|clients)\b/,
    );
    expect(text).toMatch(/SEARCH p USING (COVERING )?INDEX care_plans_status_/);
    expect(text).toMatch(/SEARCH r USING (COVERING )?INDEX care_plan_terms_plan/);
    expect(text).toMatch(/SEARCH t USING COVERING INDEX time_logs_care_usage/);
  });

  it("refuses more than 100 plans and an odd cap", () => {
    const w = { to: "2026-01-31", periodsBack: 1 };
    expect(() => careQueries({ ids: Array.from({ length: 101 }, (_, i) => String(i)) }, w)).toThrow(
      RangeError,
    );
    expect(() => careQueries({ active: 0 }, w)).toThrow(RangeError);
    expect(() => careQueries({ active: 101 }, w)).toThrow(RangeError);
    expect(() => burnRankQuery(0, "2030-06-15")).toThrow(RangeError);
    expect(() => burnRankQuery(101, "2030-06-15")).toThrow(RangeError);
  });

  it("every statement is served by an index (EXPLAIN QUERY PLAN)", async () => {
    for (const source of [{ ids: ["a", "b"] }, { active: 100 }, { active: 50, after: "a" }] as const) {
      for (const q of careQueries(source, { to: "2026-12-31", periodsBack: 1 })) {
        const plan = await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${q.sql}`, ...q.bind);
        const text = plan.map((p) => p.detail).join("\n");
        expect(text, q.sql).not.toMatch(
          /SCAN (care_plans|care_plan_terms|care_plan_status_log|time_logs|clients)\b/,
        );
        expect(text, q.sql).toMatch(/SEARCH/);
      }
    }
  });

  it("the plans active on a date walk care_plans_created and look the status up by index (EXPLAIN QUERY PLAN)", async () => {
    for (const source of [
      { active: 50, on: "2026-11-30" },
      { active: 50, after: "a", on: "2026-11-30" },
    ] as const) {
      const [plans] = careQueries(source, { to: "2026-12-31", periodsBack: 1 });
      const text = (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${plans.sql}`, ...plans.bind))
        .map((p) => p.detail)
        .join("\n");
      // The walk is in keyset order on the index and stops at the page size; each plan costs one status-log search.
      expect(text, plans.sql).toMatch(/care_plans USING (COVERING )?INDEX care_plans_created/);
      expect(text, plans.sql).toMatch(
        /SEARCH care_plan_status_log USING (COVERING )?INDEX care_plan_status_log_plan/,
      );
      expect(text, plans.sql).not.toMatch(/SCAN care_plan_status_log\b/);
    }
  });
});
