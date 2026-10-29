// The nightly statistics [ADM-DASH-01 history, docs/05 section 1.2 rule 7]: the cron only enqueues (and reads no D1), one metric or one page of
// 50 plans per message, an idempotent upsert, a continuation for more than 50 plans, an unknown metric acknowledged and logged, a stats body
// that never becomes a lead, and a dead-lettered stats message acknowledged with no alert.
import { env as realEnv } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { MILESTONE_WINDOW_DAYS } from "@techaust/core/dashboard";
import { LEAD_STAGES } from "@techaust/core/lead-lifecycle";
import {
  isStatsMessage,
  STATS_METRICS,
  STATS_MILESTONE_DAYS,
  STATS_PLAN_PAGE,
  type StatsMessage,
  statsDateOf,
} from "@techaust/core/stats";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.ts";
import { PURGE_CRON } from "../src/purge.ts";
import { handleQueue } from "../src/queue.ts";
import { CARE_STATS_SQL, enqueueStats, GROUPED_METRICS, processStats, STATS_SQL } from "../src/stats.ts";

const SCHEDULED = Date.UTC(2026, 11, 1, 22, 0); // 2026-12-02 03:30 IST: the day that just ended is 2026-12-01
const DATE = "2026-11-30";
const SCHEDULED_FOR_DATE = Date.UTC(2026, 10, 30, 22, 0); // 2026-12-01 03:30 IST: the day that just ended is 2026-11-30
const NOW = 1_800_000_000_000;

type Call = { queue: string; bodies: unknown[] };
let calls: Call[] = [];
const sentBodies = () => calls.flatMap((c) => c.bodies);
const makeEnv = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    DB: realEnv.DB,
    PDF_QUEUE: { sendBatch: async () => undefined }, // the cron also enqueues the PDF sweep and the offer sweep (M4.4, M4.5)
    ENVIRONMENT: "local",
    LEAD_PURGE_MODE: "live",
    LEAD_ALERT_TO: "owner@example.test",
    ADMIN_URL: "https://admin.example/",
    LEADS_QUEUE: {
      sendBatch: async (items: { body: unknown }[]) => {
        calls.push({ queue: "leads", bodies: items.map((i) => i.body) });
      },
    },
    EMAIL_QUEUE: {
      sendBatch: async (items: { body: unknown }[]) => {
        calls.push({ queue: "email", bodies: items.map((i) => i.body) });
      },
    },
    ...over,
  }) as unknown as Env;

const logs: string[] = [];
const origLog = console.log;

const one = async <T>(sql: string, ...binds: unknown[]) =>
  realEnv.DB.prepare(sql)
    .bind(...binds)
    .first<T>();
const all = async <T>(sql: string, ...binds: unknown[]) =>
  (
    await realEnv.DB.prepare(sql)
      .bind(...binds)
      .all<T>()
  ).results;
const stat = (metric: string, date = DATE) =>
  all<{ dimension: string; value: number; updated_at: number }>(
    "SELECT dimension, value, updated_at FROM stats_daily WHERE date = ?1 AND metric = ?2 ORDER BY dimension",
    date,
    metric,
  );
const plain = (rows: { dimension: string; value: number }[]) =>
  Object.fromEntries(rows.map((r) => [r.dimension, r.value]));

let n = 0;
let tick = 1_700_000_000_000;
let staff = "";

async function reset() {
  await realEnv.DB.batch([
    realEnv.DB.prepare("DELETE FROM stats_daily"),
    realEnv.DB.prepare("DELETE FROM time_logs"),
    realEnv.DB.prepare("DELETE FROM milestones"),
    realEnv.DB.prepare("DELETE FROM projects"),
    realEnv.DB.prepare("DELETE FROM leads"),
  ]);
  // Plans cannot be deleted (history is append-only): earlier tests' plans are cancelled, by a status row that sorts after the rest and is in force on the test date.
  await realEnv.DB.batch([
    realEnv.DB.prepare(
      "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) SELECT lower(hex(randomblob(16))), id, 'cancelled', max('2026-11-29', coalesce((SELECT max(l.effective_on) FROM care_plan_status_log l WHERE l.care_plan_id = care_plans.id), '2026-11-29')), ?1, ?2 FROM care_plans WHERE status = 'active'",
    ).bind(staff, ++tick),
    realEnv.DB.prepare("UPDATE care_plans SET status = 'cancelled' WHERE status = 'active'"),
  ]);
}

async function mkStaff() {
  const id = uuidv7();
  await realEnv.DB.prepare("INSERT INTO staff_users (id, email, name, role) VALUES (?, ?, 'Staff', 'staff')")
    .bind(id, `st${++n}@example.test`)
    .run();
  return id;
}
async function mkClient() {
  const id = uuidv7();
  n++;
  await realEnv.DB.prepare(
    "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?, ?, 'Example Traders', 'Example', 'business', 'IN', 'unregistered', '19', 'INR')",
  )
    .bind(id, `C-ST${String(n).padStart(4, "0")}`)
    .run();
  return id;
}
async function mkPlan(o: {
  start: string;
  included?: number;
  rollover?: string;
  billingDay?: number;
  at?: number;
}) {
  const id = uuidv7();
  const client = await mkClient();
  const rollover = o.rollover ?? "none";
  await realEnv.DB.prepare(
    "INSERT INTO care_plans (id, client_id, tier, currency, price_minor, included_minutes, start_date, billing_day, status, rollover, overage_rate_minor, created_at, updated_at) VALUES (?1, ?2, 'growth', 'INR', 2499900, ?3, ?4, ?5, 'active', ?6, 150000, ?7, ?7)",
  )
    .bind(id, client, o.included ?? 600, o.start, o.billingDay ?? 1, rollover, o.at ?? ++tick)
    .run();
  await realEnv.DB.batch([
    realEnv.DB.prepare(
      "INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, overage_rate_minor, rollover, created_by, created_at) VALUES (?, ?, ?, 'growth', 2499900, ?, 150000, ?, ?, ?)",
    ).bind(uuidv7(), id, o.start, o.included ?? 600, rollover, staff, ++tick),
    realEnv.DB.prepare(
      "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?, ?, 'active', ?, ?, ?)",
    ).bind(uuidv7(), id, o.start, staff, ++tick),
  ]);
  return id;
}
const logTime = (date: string, minutes: number, target: { project?: string; plan?: string }, billable = 1) =>
  realEnv.DB.prepare(
    "INSERT INTO time_logs (id, user_id, work_date, minutes, project_id, care_plan_id, billable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(uuidv7(), staff, date, minutes, target.project ?? null, target.plan ?? null, billable, ++tick, tick)
    .run();
async function mkProject(status: string) {
  const id = uuidv7();
  n++;
  await realEnv.DB.prepare(
    "INSERT INTO projects (id, code, client_id, name, currency, status) VALUES (?, ?, ?, 'P', 'INR', ?)",
  )
    .bind(id, `PRJ-ST${n}`, await mkClient(), status)
    .run();
  return id;
}
const mkMilestone = (project: string, pos: number, due: string, status: string) =>
  realEnv.DB.prepare(
    "INSERT INTO milestones (id, project_id, position, title, amount_minor, due_date, status) VALUES (?, ?, ?, 'M', 100, ?, ?)",
  )
    .bind(uuidv7(), project, pos, due, status)
    .run();
const mkLead = (stage: string) =>
  realEnv.DB.prepare(
    `INSERT INTO leads (id, ref, source, contact_name, contact_email, stage, lost_reason, last_activity_at, created_at)
     VALUES (?1, ?2, 'web', 'Asha Rao', ?3, ?4, ?5, ?6, ?6)`,
  )
    .bind(
      uuidv7(),
      `L-S${String(++n).padStart(4, "0")}`.slice(0, 7),
      `s${n}@example.com`,
      stage,
      stage === "lost" ? "price" : null,
      NOW,
    )
    .run();

beforeEach(async () => {
  calls = [];
  logs.length = 0;
  console.log = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  };
  staff ||= await mkStaff();
  await reset();
  return () => {
    console.log = origLog;
  };
});

describe("the date and the cron [item 6]", () => {
  it("records the IST day that just ended: the cron runs at 22:00 UTC = 03:30 IST the next morning", () => {
    expect(statsDateOf(SCHEDULED_FOR_DATE)).toBe("2026-11-30");
    expect(statsDateOf(SCHEDULED)).toBe("2026-12-01");
    expect(statsDateOf(Date.UTC(2026, 11, 31, 22, 0))).toBe("2026-12-31"); // across a year end it is still the day before 03:30 IST
    expect(statsDateOf(Date.UTC(2027, 2, 1, 22, 0))).toBe("2027-03-01");
  });

  it("enqueueStats sends one batch with one message per metric and reads no D1", async () => {
    const dead = new Proxy({}, { get: () => () => Promise.reject(new Error("D1 must not be read")) });
    const date = await enqueueStats(makeEnv({ DB: dead }), SCHEDULED_FOR_DATE);
    expect(date).toBe(DATE);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.queue).toBe("leads");
    expect(calls[0]?.bodies).toEqual(
      STATS_METRICS.map((metric) => ({ kind: "stats.metric", metric, date: DATE })),
    );
    for (const b of calls[0]?.bodies ?? []) expect(isStatsMessage(b)).toBe(true);
  });

  it("the scheduled handler sends the purge messages plus one stats batch, only for its own cron", async () => {
    await realEnv.DB.prepare(
      `INSERT INTO leads (id, ref, source, contact_name, contact_email, delete_after, last_activity_at, created_at) VALUES ('due-1', 'L-S0001', 'web', 'Asha', 'a@example.com', ?1, ?2, ?2)`,
    )
      .bind(NOW - 86_400_000, NOW - 400 * 86_400_000)
      .run();
    await worker.scheduled?.(
      { cron: "5 4 * * *", scheduledTime: NOW } as ScheduledController,
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(calls).toHaveLength(0);
    await worker.scheduled?.(
      { cron: PURGE_CRON, scheduledTime: NOW } as ScheduledController,
      makeEnv(),
      {} as ExecutionContext,
    );
    // the stats batch (since FX-1, A6 6, it also carries the clean-up's first scan: the cron reads no D1) and (M5.5b) the statement cache clean-up message
    expect(calls).toHaveLength(2);
    expect(
      calls.filter((c) => c.bodies.some((b) => (b as { kind?: string }).kind === "statement.purge")),
    ).toHaveLength(1);
    const stats = calls.find((c) => c.bodies.some((b) => (b as { kind?: string }).kind === "stats.metric"));
    // one message per metric, the daily expiry message (M4.3) and the clean-up scan (FX-1), in the one batch (the LUT check moved to the 09:00 IST alerts in M5.4, LD61)
    expect(stats?.bodies).toHaveLength(STATS_METRICS.length + 2);
    expect(stats?.bodies.filter((b) => (b as { kind?: string }).kind === "lead.purge.scan")).toEqual([
      { kind: "lead.purge.scan", asOf: NOW },
    ]);
    expect(calls.flatMap((c) => c.bodies).some((b) => (b as { kind?: string }).kind === "lead.purge")).toBe(
      false,
    );
    expect(stats?.bodies.filter((b) => (b as { kind?: string }).kind === "documents.expire")).toHaveLength(1);
    expect(stats?.bodies.filter((b) => (b as { kind?: string }).kind === "lut.check")).toHaveLength(0);
    expect(await one<{ n: number }>("SELECT count(*) AS n FROM stats_daily")).toEqual({ n: 0 }); // the cron wrote nothing
  });

  it("one half failing does not stop the other, and the run still fails", async () => {
    const env = makeEnv({
      LEADS_QUEUE: {
        sendBatch: async (items: { body: unknown }[]) => {
          calls.push({ queue: "leads", bodies: items.map((i) => i.body) });
          if (items.some((i) => (i.body as { kind?: string }).kind === "statement.purge"))
            throw new Error("queue down");
        },
      },
    });
    await realEnv.DB.prepare(
      `INSERT INTO leads (id, ref, source, contact_name, contact_email, delete_after, last_activity_at, created_at) VALUES ('due-2', 'L-S0002', 'web', 'Asha', 'b@example.com', ?1, ?2, ?2)`,
    )
      .bind(NOW - 86_400_000, NOW - 400 * 86_400_000)
      .run();
    await expect(
      worker.scheduled?.(
        { cron: PURGE_CRON, scheduledTime: NOW } as ScheduledController,
        env,
        {} as ExecutionContext,
      ),
    ).rejects.toThrow("queue down");
    expect(calls.some((c) => c.bodies.some((b) => (b as { kind?: string }).kind === "stats.metric"))).toBe(
      true,
    );
  });
});

describe("the metrics [item 6]", () => {
  const run = (metric: StatsMessage["metric"], after?: string) =>
    processStats(makeEnv(), { kind: "stats.metric", metric, date: DATE, ...(after ? { after } : {}) }, NOW);

  it("leads.open counts the open leads by stage; won and lost are not counted; the stage list is the dashboard's", async () => {
    for (const s of ["new", "new", "qualified", "proposal_sent", "won", "lost"]) await mkLead(s);
    expect((await run("leads.open")).rows).toBe(3);
    expect(plain(await stat("leads.open"))).toEqual({ new: 2, qualified: 1, proposal_sent: 1 });
    expect(["new", "qualified", "proposal_sent"]).toEqual(
      LEAD_STAGES.filter((s) => s !== "won" && s !== "lost"),
    );
  });

  it("projects.status counts every status", async () => {
    for (const s of ["planned", "active", "active", "on_hold", "completed", "cancelled"]) await mkProject(s);
    await run("projects.status");
    expect(plain(await stat("projects.status"))).toEqual({
      planned: 1,
      active: 2,
      on_hold: 1,
      completed: 1,
      cancelled: 1,
    });
  });

  it("milestones.due_14d counts pending and ready-to-bill milestones due from the date to 14 days after it", async () => {
    expect(STATS_MILESTONE_DAYS).toBe(MILESTONE_WINDOW_DAYS);
    const p = await mkProject("active");
    await mkMilestone(p, 1, "2026-11-29", "pending"); // before
    await mkMilestone(p, 2, "2026-11-30", "pending"); // in (the date itself)
    await mkMilestone(p, 3, "2026-12-14", "ready_to_bill"); // in (the 14th day)
    await mkMilestone(p, 4, "2026-12-15", "pending"); // after
    await run("milestones.due_14d");
    expect(plain(await stat("milestones.due_14d"))).toEqual({ "": 2 });
  });

  it("milestones.due_14d and time.minutes_prev_day write a zero when there is nothing", async () => {
    await run("milestones.due_14d");
    await run("time.minutes_prev_day");
    expect(plain(await stat("milestones.due_14d"))).toEqual({ "": 0 });
    expect(plain(await stat("time.minutes_prev_day"))).toEqual({ "": 0 });
  });

  it("time.minutes_prev_day is that date's minutes, billable or not, of everyone", async () => {
    const p = await mkProject("active");
    const plan = await mkPlan({ start: "2026-10-01" });
    await logTime("2026-11-29", 120, { project: p });
    await logTime("2026-11-30", 60, { project: p });
    await logTime("2026-11-30", 45, { plan }, 0);
    await logTime("2026-12-01", 30, { project: p });
    await run("time.minutes_prev_day");
    expect(plain(await stat("time.minutes_prev_day"))).toEqual({ "": 105 });
  });

  it("the care figures are as of the date, per plan: billable minutes used, and the hours available with what carried over", async () => {
    const a = await mkPlan({ start: "2026-11-01", rollover: "one_month" }); // Nov: 300 billable used; 60 non-billable and the December minute are not counted
    await logTime("2026-11-10", 300, { plan: a });
    await logTime("2026-11-12", 60, { plan: a }, 0);
    await logTime("2026-12-01", 510, { plan: a });
    const c = await mkPlan({ start: "2026-10-01", rollover: "one_month" }); // Oct used 480 of 600: 120 carried into Nov; Nov used 105
    await logTime("2026-10-05", 480, { plan: c });
    await logTime("2026-11-05", 105, { plan: c });
    await mkPlan({ start: "2026-12-15" }); // not started on the date: no figure
    await run("care.used_minutes");
    await run("care.available_minutes");
    expect(plain(await stat("care.used_minutes"))).toEqual({ [a]: 300, [c]: 105 });
    expect(plain(await stat("care.available_minutes"))).toEqual({ [a]: 600, [c]: 720 });
  });

  it("a rerun and a redelivery write the same rows: no duplicates, the values replaced", async () => {
    await mkLead("new");
    const plan = await mkPlan({ start: "2026-11-01" });
    await logTime("2026-11-10", 90, { plan });
    for (const m of STATS_METRICS) await run(m);
    const before = await all(
      "SELECT date, metric, dimension, value FROM stats_daily ORDER BY metric, dimension",
    );
    await logTime("2026-11-11", 15, { plan });
    await mkLead("new");
    for (const m of STATS_METRICS)
      await processStats(makeEnv(), { kind: "stats.metric", metric: m, date: DATE }, NOW + 1);
    const after = await all<{ metric: string; dimension: string; value: number }>(
      "SELECT date, metric, dimension, value FROM stats_daily ORDER BY metric, dimension",
    );
    expect(after).toHaveLength(before.length);
    expect(after.find((r) => r.metric === "leads.open")?.value).toBe(2);
    expect(after.find((r) => r.metric === "care.used_minutes")?.value).toBe(105);
    expect(await stat("leads.open")).toMatchObject([{ updated_at: NOW + 1 }]);
    // the same date again, unchanged data: byte-identical
    for (const m of STATS_METRICS)
      await processStats(makeEnv(), { kind: "stats.metric", metric: m, date: DATE }, NOW + 2);
    expect(
      await all("SELECT date, metric, dimension, value FROM stats_daily ORDER BY metric, dimension"),
    ).toEqual(after);
  });

  it("other dates are separate rows", async () => {
    await mkLead("new");
    await processStats(makeEnv(), { kind: "stats.metric", metric: "leads.open", date: "2026-11-29" }, NOW);
    await processStats(makeEnv(), { kind: "stats.metric", metric: "leads.open", date: DATE }, NOW);
    expect(await one("SELECT count(*) AS n FROM stats_daily WHERE metric = 'leads.open'")).toEqual({ n: 2 });
  });

  it("more than 50 active plans: a page of 50, a continuation message after the last one, then the rest; nothing twice", async () => {
    const ids: string[] = [];
    for (let i = 0; i < STATS_PLAN_PAGE + 2; i++)
      ids.push(await mkPlan({ start: "2026-11-01", at: 1_700_000_000_000 + i }));
    await logTime("2026-11-10", 15, { plan: ids[0] as string });
    const first = await run("care.used_minutes");
    expect(first).toEqual({ rows: STATS_PLAN_PAGE, continued: true });
    const next = sentBodies().at(-1) as StatsMessage;
    expect(next).toEqual({
      kind: "stats.metric",
      metric: "care.used_minutes",
      date: DATE,
      after: ids[STATS_PLAN_PAGE - 1],
    });
    expect(isStatsMessage(next)).toBe(true);
    expect((await stat("care.used_minutes")).length).toBe(STATS_PLAN_PAGE);
    calls = [];
    const second = await run("care.used_minutes", next.after);
    expect(second).toEqual({ rows: 2, continued: false });
    expect(calls).toHaveLength(0);
    const rows = await stat("care.used_minutes");
    expect(rows.map((r) => r.dimension).sort()).toEqual([...ids].sort());
    expect(plain(rows)[ids[0] as string]).toBe(15);
  });

  it("exactly 50 plans is one page with no continuation", async () => {
    for (let i = 0; i < STATS_PLAN_PAGE; i++)
      await mkPlan({ start: "2026-11-01", at: 1_700_000_000_000 + i });
    expect(await run("care.available_minutes")).toEqual({ rows: STATS_PLAN_PAGE, continued: false });
    expect(sentBodies()).toHaveLength(0);
  });

  it("a paused or cancelled plan is not in the active list", async () => {
    const live = await mkPlan({ start: "2026-11-01" });
    const gone = await mkPlan({ start: "2026-11-01" });
    await realEnv.DB.batch([
      realEnv.DB.prepare(
        "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?, ?, 'cancelled', '2026-11-20', ?, ?)",
      ).bind(uuidv7(), gone, staff, ++tick),
    ]);
    await realEnv.DB.prepare("UPDATE care_plans SET status = 'cancelled' WHERE id = ?").bind(gone).run();
    await run("care.used_minutes");
    expect(Object.keys(plain(await stat("care.used_minutes")))).toEqual([live]);
  });

  it("a plan paused after the recorded date keeps that date's row on a rerun (the status on the date decides, not today's) [review fix 6]", async () => {
    const D2 = "2026-08-05"; // before every other plan in this file started
    const rowOf = async (id: string, date = D2) => plain(await stat("care.used_minutes", date))[id];
    const p = await mkPlan({ start: "2026-08-01" });
    await logTime("2026-08-03", 120, { plan: p });
    const msg = { kind: "stats.metric", metric: "care.used_minutes", date: D2 } as const;
    await processStats(makeEnv(), msg, NOW);
    expect(await rowOf(p)).toBe(120);
    // paused the day after the recorded date; the mirror column says paused today
    await realEnv.DB.batch([
      realEnv.DB.prepare(
        "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?, ?, 'paused', '2026-08-06', ?, ?)",
      ).bind(uuidv7(), p, staff, ++tick),
      realEnv.DB.prepare("UPDATE care_plans SET status = 'paused' WHERE id = ?").bind(p),
    ]);
    await processStats(makeEnv(), msg, NOW + 1);
    expect(await rowOf(p)).toBe(120);
    // a date after the pause no longer includes it
    await processStats(makeEnv(), { ...msg, date: "2026-08-07" }, NOW + 2);
    expect(await rowOf(p, "2026-08-07")).toBeUndefined();
  });

  it("a grouped metric clears a dimension that fell to zero since an earlier run [review fix 6]", async () => {
    await mkLead("new");
    await mkLead("qualified");
    await run("leads.open");
    expect(plain(await stat("leads.open"))).toEqual({ new: 1, qualified: 1 });
    await realEnv.DB.prepare("UPDATE leads SET stage = 'won' WHERE stage = 'qualified'").run();
    await run("leads.open");
    expect(plain(await stat("leads.open"))).toEqual({ new: 1 });
    await mkProject("active");
    await run("projects.status");
    await realEnv.DB.prepare("DELETE FROM projects").run();
    expect((await run("projects.status")).rows).toBe(0);
    expect(await stat("projects.status")).toEqual([]);
    // other dates and other metrics are left alone
    await mkLead("new");
    await run("leads.open");
    await processStats(makeEnv(), { kind: "stats.metric", metric: "leads.open", date: "2026-11-29" }, NOW);
    await run("leads.open");
    expect((await stat("leads.open", "2026-11-29")).length).toBeGreaterThan(0);
  });

  it("every statement is served by an index (EXPLAIN)", async () => {
    const plan = async (sql: string, ...binds: unknown[]) =>
      (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...binds)).map((r) => r.detail).join("\n");
    const lead = await plan(STATS_SQL["leads.open"], DATE, NOW);
    expect(lead).toMatch(/SEARCH leads USING (COVERING )?INDEX leads_stage_activity/);
    expect(lead).not.toMatch(/SCAN leads/);
    expect(await plan(STATS_SQL["projects.status"], DATE, NOW)).toMatch(
      /SCAN projects USING COVERING INDEX|SEARCH projects USING/,
    );
    expect(await plan(STATS_SQL["milestones.due_14d"], DATE, NOW, "2026-12-14")).toMatch(
      /milestones USING (COVERING )?INDEX milestones_status_due/,
    );
    expect(await plan(STATS_SQL["time.minutes_prev_day"], DATE, NOW)).toMatch(
      /SEARCH time_logs USING INDEX time_logs_date/,
    );
    expect(await plan(CARE_STATS_SQL, DATE, "care.used_minutes", NOW, "[]")).not.toMatch(
      /SCAN (stats_daily|care_plans|time_logs)/,
    );
  });

  it("every metric with a GROUP BY is cleared before it is written again (GROUPED_METRICS)", () => {
    for (const [metric, sql] of Object.entries(STATS_SQL))
      expect(GROUPED_METRICS.has(metric as keyof typeof STATS_SQL), metric).toBe(/\bGROUP BY\b/.test(sql));
  });

  it("the INSERT statements are exactly one statement per metric (the upsert target is the primary key)", () => {
    for (const [metric, sql] of Object.entries(STATS_SQL)) {
      expect(sql, metric).toContain(
        "ON CONFLICT(date, metric, dimension) DO UPDATE SET value = excluded.value",
      );
      expect(sql.match(/INSERT INTO/g), metric).toHaveLength(1);
    }
  });
});

describe("the queue [item 6]", () => {
  type Msg = { body: unknown; attempts: number; ack: () => void; retry: () => void };
  const batch = (queue: string, bodies: unknown[]) => {
    const acked: unknown[] = [];
    const retried: unknown[] = [];
    const messages: Msg[] = bodies.map((body) => ({
      body,
      attempts: 1,
      ack: () => acked.push(body),
      retry: () => retried.push(body),
    }));
    return { b: { queue, messages } as unknown as MessageBatch<unknown>, acked, retried };
  };
  const leadCount = async () => (await one<{ n: number }>("SELECT count(*) AS n FROM leads"))?.n ?? 0;

  it("a stats message on the leads queue is processed and acknowledged, and never becomes a lead", async () => {
    await mkLead("new");
    const before = await leadCount();
    const { b, acked, retried } = batch("techaust-local-leads", [
      { kind: "stats.metric", metric: "leads.open", date: DATE },
    ]);
    await handleQueue(b, makeEnv());
    expect(acked).toHaveLength(1);
    expect(retried).toHaveLength(0);
    expect(await leadCount()).toBe(before);
    expect(plain(await stat("leads.open"))).toEqual({ new: 1 });
  });

  it("an unknown metric or a bad date is acknowledged and logged, writes nothing, and creates no lead", async () => {
    const bad = [
      { kind: "stats.metric", metric: "future.metric", date: DATE },
      { kind: "stats.metric", metric: "leads.open", date: "2026-02-31" },
      { kind: "stats.metric", date: DATE },
      { kind: "stats.metric" },
    ];
    const { b, acked, retried } = batch("techaust-local-leads", bad);
    await handleQueue(b, makeEnv());
    expect(acked).toHaveLength(bad.length);
    expect(retried).toHaveLength(0);
    expect(await leadCount()).toBe(0);
    expect(await one("SELECT count(*) AS n FROM stats_daily")).toEqual({ n: 0 });
    expect(logs.filter((l) => l.includes('"ev":"stats.unknown"'))).toHaveLength(bad.length);
    expect(logs.join("\n")).toContain("future.metric");
    expect(calls).toHaveLength(0); // no alert, no email
  });

  it("a dead-lettered stats message is acknowledged and logged, with no alert and no email", async () => {
    const { b, acked, retried } = batch("techaust-local-leads-dlq", [
      { kind: "stats.metric", metric: "leads.open", date: DATE },
      { kind: "stats.metric", metric: "nonsense", date: DATE },
    ]);
    await handleQueue(b, makeEnv());
    expect(acked).toHaveLength(2);
    expect(retried).toHaveLength(0);
    expect(logs.filter((l) => l.includes('"ev":"stats.dead_letter"'))).toHaveLength(2);
    expect(calls).toHaveLength(0);
    expect(await leadCount()).toBe(0);
  });

  it("the continuation of a care page works through the queue", async () => {
    const ids: string[] = [];
    for (let i = 0; i < STATS_PLAN_PAGE + 1; i++)
      ids.push(await mkPlan({ start: "2026-11-01", at: 1_700_000_000_000 + i }));
    const one1 = batch("techaust-local-leads", [
      { kind: "stats.metric", metric: "care.available_minutes", date: DATE },
    ]);
    await handleQueue(one1.b, makeEnv());
    const next = sentBodies().at(-1);
    const two = batch("techaust-local-leads", [next]);
    await handleQueue(two.b, makeEnv());
    expect(two.acked).toHaveLength(1);
    expect((await stat("care.available_minutes")).length).toBe(STATS_PLAN_PAGE + 1);
  });

  it("a database error is retried, not acknowledged", async () => {
    const broken = new Proxy(realEnv.DB, {
      get: (t, p) =>
        p === "prepare"
          ? () => ({ bind: () => ({ run: () => Promise.reject(new Error("boom")) }) })
          : Reflect.get(t, p),
    });
    const { b, acked, retried } = batch("techaust-local-leads", [
      { kind: "stats.metric", metric: "leads.open", date: DATE },
    ]);
    await handleQueue(b, makeEnv({ DB: broken }));
    expect(acked).toHaveLength(0);
    expect(retried).toHaveLength(1);
  });
});
