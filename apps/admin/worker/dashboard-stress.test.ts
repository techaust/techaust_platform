// The dashboard on a stress fixture [ADM-DASH-01, NFR-2]: 1,000 leads, 200 projects, 400 milestones, 50 care plans with 60 days of time
// each, and 5,000 audit rows of which 80 % are sign-in and bell noise. D1 charges for rows read, so the sum of `meta.rows_read` of the
// one batch is measured per role and held under 6,300 on a pinned worst day (6,000 until FX-3 counted the 50 Planned projects too); every statement of the batch must be served by an index. The wall times are a
// local upper bound (workerd, not the Free plan's metered CPU): the real reading is the staging `cpuTimeMs` at integration.
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { longSession, mkLog, today } from "./test-care.ts";
import { call, pinClock, withDb } from "./test-helpers.ts";

/**
 * One pinned clock for the fixture and the dashboard. The rows read grow with the day of the month (each care plan's current period
 * gets longer until its billing day), so a real clock let the count drift with the date (CI failed on 30 October). The pinned day is
 * the worst one measured for this fixture: the 1st of a month after two 31-day months (1 September, 1 February), when every plan's
 * current and previous periods are longest. Owner 6,299 rows and 7,869 in the worst case, against 6,255 on 1 August, 6,271 on
 * 2 September, 6,261 on 31 August, 6,115 on 30 October and 5,965 on 28 August (2026-10-30). It is in the past, so no future-date
 * rule refuses the data.
 */
const PINNED_MS = Date.parse("2025-09-01T06:30:00Z"); // 12:00 IST
const NOW = String(PINNED_MS);
/** The same instant as SQL text (UTC), for the fixture's `date(…)` calls. */
const SQL_NOW = "'2025-09-01 06:30:00'";
// M6.1: +20 for the ledger reads of the finance tile ("Collected" this FY and this month in one pass through `payments_confirmed`, the Owner's pending
// count through `payments_pending`); on this fixture they read one row per seeded payment (early check 2, finding 6).
const ROWS_READ_LIMIT = 6_320;
const WORST_CASE_LIMIT = 8_000;
/** Set to true to print the per-statement numbers (the test then fails on purpose, which is the only way vitest shows them). */
const SHOW_REPORT = false;

const run = (sql: string) => env.DB.prepare(sql).run();
const RECURSIVE = (n: number) =>
  `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n})`;

async function fixture() {
  await run(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES ('st-stress', 'stress@example.test', 'Stress Person', 'staff', 'active')",
  );
  await run(
    "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES ('cl-stress', 'CSTRESS', 'Stress Co', 'Stress Co', 'business', 'IN', 'unregistered', '19', 'INR')",
  );
  await run(`${RECURSIVE(1_000)}
    INSERT INTO leads (id, ref, stage, source, contact_name, contact_email, created_at, last_activity_at, next_action_at)
    SELECT 'ld-' || i, 'L-S' || printf('%04d', i), CASE i % 4 WHEN 0 THEN 'new' WHEN 1 THEN 'qualified' WHEN 2 THEN 'proposal_sent' ELSE 'won' END,
           'manual', 'Person ' || i, 'p' || i || '@example.test', ${NOW} - i * 3600000, ${NOW} - i * 60000,
           CASE WHEN i % 5 = 0 THEN ${NOW} - i * 3600000 ELSE NULL END FROM n`);
  await run(`${RECURSIVE(200)}
    INSERT INTO projects (id, code, client_id, name, status, currency, created_at, updated_at)
    SELECT 'pj-' || i, 'PRJ-S' || printf('%04d', i), 'cl-stress', 'Project ' || i, CASE i % 4 WHEN 0 THEN 'active' WHEN 1 THEN 'on_hold' WHEN 2 THEN 'planned' ELSE 'completed' END,
           'INR', ${NOW} - i * 1000, ${NOW} - i * 1000 FROM n`);
  await run(`${RECURSIVE(400)}
    INSERT INTO milestones (id, project_id, position, title, amount_minor, due_date, status)
    SELECT 'ms-' || i, 'pj-' || ((i - 1) % 200 + 1), (i - 1) / 200 + 1, 'Milestone ' || i, 1000, date(${SQL_NOW}, '+' || (i % 30) || ' days'),
           CASE i % 3 WHEN 0 THEN 'pending' WHEN 1 THEN 'ready_to_bill' ELSE 'invoiced' END FROM n`);
  await run(`${RECURSIVE(50)}
    INSERT INTO care_plans (id, client_id, tier, currency, price_minor, included_minutes, start_date, billing_day, status, rollover, overage_rate_minor, created_at, updated_at)
    SELECT 'cp-' || i, 'cl-stress', CASE WHEN i % 2 = 0 THEN 'growth' ELSE 'essential' END, 'INR', 2499900, CASE WHEN i % 2 = 0 THEN 600 ELSE 120 END, date(${SQL_NOW}, '-100 days'), 1 + (i % 28), 'active', CASE WHEN i % 2 = 0 THEN 'one_month' ELSE 'none' END, 150000, ${NOW} - i * 1000, ${NOW} - i * 1000 FROM n`);
  await run(`${RECURSIVE(50)}
    INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, overage_rate_minor, rollover, created_by)
    SELECT 'ct-' || i, 'cp-' || i, date(${SQL_NOW}, '-100 days'), CASE WHEN i % 2 = 0 THEN 'growth' ELSE 'essential' END, 2499900, CASE WHEN i % 2 = 0 THEN 600 ELSE 120 END, 150000, CASE WHEN i % 2 = 0 THEN 'one_month' ELSE 'none' END, 'st-stress' FROM n`);
  await run(`${RECURSIVE(50)}
    INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by)
    SELECT 'cs-' || i, 'cp-' || i, 'active', date(${SQL_NOW}, '-100 days'), 'st-stress' FROM n`);
  // 50 plans x 60 days, one 15-minute entry each: 750 minutes a day for the one person, under the 24-hour cap
  await run(`WITH RECURSIVE p(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM p WHERE i < 50), d(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM d WHERE k < 59)
    INSERT INTO time_logs (id, user_id, work_date, minutes, care_plan_id, billable, created_at, updated_at)
    SELECT 'tl-' || p.i || '-' || d.k, 'st-stress', date(${SQL_NOW}, '+5 hours', '+30 minutes', '-' || d.k || ' days'), 15, 'cp-' || p.i, 1, ${NOW}, ${NOW} FROM p, d`);
  // M6.1 (early check 2, finding 6): the ledger tiles read real rows here too: 5 confirmed payments in this FY (one on the pinned day, so the month has
  // one) and 3 waiting for the Owner's check (one row read each). This fixture has no invoices; the 2,000-document case (one payment per invoice) is in
  // dashboard-finance.test.ts, where "Collected" is measured at one row per payment of the FY.
  await run(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES ('ow-stress', 'owner-stress@example.test', 'Stress Owner', 'owner', 'active')",
  );
  await run(`${RECURSIVE(5)}
    INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, reference_norm, recorded_by, recorded_at, verified_by, verified_at)
    SELECT 'pc-' || i, 'cl-stress', 'payment', 'manual', 'confirmed', 'INR', 100000 + i, date(${SQL_NOW}, '-' || ((i - 1) * 15) || ' days'), 'neft', 'UTRSTRESS' || i,
           'ow-stress', ${NOW} - i * 1000, 'ow-stress', ${NOW} - i * 1000 FROM n`);
  await run(`${RECURSIVE(3)}
    INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, reference_norm, recorded_by, recorded_at)
    SELECT 'pp-' || i, 'cl-stress', 'payment', 'manual', 'pending_verification', 'INR', 5000 + i, date(${SQL_NOW}, '-' || i || ' days'), 'upi', 'UTRSTRESSP' || i,
           'st-stress', ${NOW} - i * 1000 FROM n`);
  await run(`${RECURSIVE(5_000)}
    INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id, at)
    SELECT 'au-' || i, 'staff', 'st-stress', 'staff',
           CASE i % 5 WHEN 0 THEN 'lead.update' WHEN 1 THEN 'auth.login' WHEN 2 THEN 'auth.step_up' WHEN 3 THEN 'notification.read' ELSE 'notification.read_all' END,
           'lead', 'ld-' || (i % 1000 + 1), ${NOW} - i * 1000 FROM n`);
}

type Seen = { sql: string; vals: unknown[]; rows: number };
/** A D1 that records every statement (with its values) and the rows each batch read. */
function recording(): { db: D1Database; seen: Seen[]; rowsRead: () => number } {
  const seen: Seen[] = [];
  let read = 0;
  class Rec {
    constructor(
      readonly real: D1PreparedStatement,
      readonly sql: string,
      readonly vals: unknown[] = [],
    ) {}
    bind(...v: unknown[]) {
      return new Rec(this.real.bind(...v), this.sql, v);
    }
    first(...a: unknown[]) {
      return (this.real.first as (...x: unknown[]) => Promise<unknown>)(...a);
    }
    run() {
      return this.real.run();
    }
    all() {
      return this.real.all();
    }
  }
  const db = {
    prepare: (q: string) => new Rec(env.DB.prepare(q), q),
    batch: async (stmts: Rec[]) => {
      const results = await env.DB.batch(stmts.map((s) => s.real));
      for (const [i, s] of stmts.entries()) {
        seen.push({ sql: s.sql, vals: s.vals, rows: results[i]?.meta.rows_read ?? 0 });
        read += results[i]?.meta.rows_read ?? 0;
      }
      return results;
    },
  } as unknown as D1Database;
  return { db, seen, rowsRead: () => read };
}

describe("GET /dashboard on the stress fixture", () => {
  beforeAll(() => {
    pinClock(PINNED_MS);
  });
  afterAll(() => vi.useRealTimers());

  it("reads at most 6,300 rows per call for every role on the worst day, every statement from an index", async () => {
    await fixture();
    const roles = ["owner", "staff", "sales", "accountant"] as const;
    const report: string[] = [];
    for (const role of roles) {
      const s = await longSession(role);
      if (role === "staff") await mkLog(s.id, today(), 60, { plan: "cp-1" });
      const rec = recording();
      const t0 = performance.now();
      const res = await call("/dashboard", { cookie: s.cookie }, withDb(rec.db));
      const ms = performance.now() - t0;
      expect(res.status, role).toBe(200);
      const body = (await res.json()) as { tiles: Record<string, unknown> };
      report.push(
        `${role}: rows_read ${rec.rowsRead()} (${rec.seen.length} statements, ${ms.toFixed(1)} ms wall, tiles ${Object.keys(body.tiles).join("/")})`,
      );
      for (const q of rec.seen) report.push(`   ${q.rows}  ${q.sql.replace(/\s+/g, " ").slice(0, 100)}`);
      for (const q of rec.seen) {
        const plan = (
          await env.DB.prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
            .bind(...q.vals)
            .all<{ detail: string }>()
        ).results
          .map((r) => r.detail)
          .join("\n");
        if (q.rows > 1_000) report.push(`   plan: ${plan.split("\n").join(" | ")}`);
        expect(plan, `${role}: ${q.sql.slice(0, 80)}`).not.toMatch(
          /SCAN (leads|projects|milestones|audit_log|care_plans|care_plan_terms|care_plan_status_log|time_logs|staff_users|clients)\b/,
        );
      }
      expect(rec.rowsRead(), `${role} read ${rec.rowsRead()} rows`).toBeLessThanOrEqual(ROWS_READ_LIMIT);
    }
    // The worst case: every plan has had a one-month rollover rule, so every plan also reads its previous period. Reported, and held
    // under a looser ceiling (a plan that carries hours in needs last period's hours; real data is a handful of plans).
    await run(`${RECURSIVE(50)}
      INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, overage_rate_minor, rollover, created_by)
      SELECT 'cw-' || i, 'cp-' || i, date(${SQL_NOW}, '-99 days'), 'growth', 2499900, 600, 150000, 'one_month', 'st-stress' FROM n WHERE i % 2 = 1`);
    const worst = recording();
    const owner = await longSession("owner");
    expect((await call("/dashboard", { cookie: owner.cookie }, withDb(worst.db))).status).toBe(200);
    report.push(`owner, every plan carries hours over: rows_read ${worst.rowsRead()}`);
    expect(worst.rowsRead()).toBeLessThanOrEqual(WORST_CASE_LIMIT);
    if (SHOW_REPORT) throw new Error(["DASHBOARD STRESS", ...report].join("\n"));
  });

  it("the care-plan burn of 50 plans equals the plan page for a sample, and nothing is dropped", async () => {
    const s = await longSession("owner");
    const body = (await (await call("/dashboard", { cookie: s.cookie })).json()) as {
      tiles: {
        careBurn: {
          counts: { active: number };
          truncated: boolean;
          rows: { planId: string; used: number; available: number; burnBp: number }[];
        };
      };
    };
    const tile = body.tiles.careBurn;
    expect(tile.counts.active).toBe(50);
    expect(tile.truncated).toBe(false);
    expect(tile.rows).toHaveLength(20);
    for (const r of tile.rows.slice(0, 3)) {
      const page = (await (await call(`/care-plans/${r.planId}`, { cookie: s.cookie })).json()) as {
        usage: { used: number; available: number; burnBp: number };
      };
      expect(page.usage).toMatchObject({ used: r.used, available: r.available, burnBp: r.burnBp });
    }
  });

  it("local CPU proxy: wall time of the dashboard, a plan page, a time entry and the plan list", async () => {
    const s = await longSession("owner");
    const timed = async (name: string, f: () => Promise<Response>) => {
      await f(); // the first call warms the isolate
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const r = await f();
        runs.push(performance.now() - t0);
        expect(r.status, name).toBeLessThan(300);
      }
      runs.sort((a, b) => a - b);
      return `${name}: median ${runs[2]?.toFixed(1)} ms, max ${runs[4]?.toFixed(1)} ms`;
    };
    let day = 0;
    const lines = [
      await timed("GET /dashboard", () => call("/dashboard", { cookie: s.cookie })),
      await timed("GET /care-plans/:id", () => call("/care-plans/cp-1", { cookie: s.cookie })),
      await timed("GET /care-plans", () => call("/care-plans?limit=50", { cookie: s.cookie })),
      await timed("POST /time", () =>
        call("/time", {
          cookie: s.cookie,
          body: {
            // August 2025: before the pinned day, so the entry is not in the future
            workDate: `2025-08-${String(1 + (day++ % 28)).padStart(2, "0")}`,
            minutes: 15,
            projectId: "pj-1",
            billable: true,
          },
        }),
      ),
    ];
    if (SHOW_REPORT) throw new Error(["LOCAL CPU PROXY (wall, upper bound)", ...lines].join("\n"));
  });
});
