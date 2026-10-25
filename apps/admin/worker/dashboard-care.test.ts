// The dashboard's care tile past 100 active plans [ADM-DASH-01, ADM-CARE-03; M4.3 review, found in M3.5]: the tile loads at most 100 plans, and they
// are no longer the 100 OLDEST. With more than 100 active plans a second call picks the 100 started plans with the highest burn in SQL, so a plan
// over its hours is never missed because it is new, and the counts of started and not-yet-started plans stay exact.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CARE_TOTALS_SQL } from "./dashboard.ts";
import { longSession, today } from "./test-care.ts";
import { call, withDb } from "./test-helpers.ts";

const NOW = "(cast(unixepoch('subsec') * 1000 as integer))";
const run = (sql: string, ...v: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...v)
    .run();
const RECURSIVE = (n: number) =>
  `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n})`;

type Tile = {
  counts: { active: number; notStarted: number; near: number; reached: number };
  truncated: boolean;
  rows: { planId: string; flag: string; used: number; available: number; burnBp: number | null }[];
};
const tile = async (cookie: string, env2?: Env) =>
  (
    (await (await call("/dashboard", { cookie }, env2)).json()) as {
      tiles: { careBurn: Tile };
    }
  ).tiles.careBurn;

async function plans(
  prefix: string,
  count: number,
  o: { start: string; created: string; included?: number },
) {
  await run(`${RECURSIVE(count)}
    INSERT INTO care_plans (id, client_id, tier, currency, price_minor, included_minutes, start_date, billing_day, status, rollover, overage_rate_minor, created_at, updated_at)
    SELECT '${prefix}-' || i, 'cl-dcare', 'growth', 'INR', 2499900, ${o.included ?? 600}, '${o.start}', 1, 'active', 'none', 150000, ${o.created} + i, ${o.created} + i FROM n`);
  await run(`${RECURSIVE(count)}
    INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, overage_rate_minor, rollover, created_by)
    SELECT 'ct-${prefix}-' || i, '${prefix}-' || i, '${o.start}', 'growth', 2499900, ${o.included ?? 600}, 150000, 'none', 'st-dcare' FROM n`);
  await run(`${RECURSIVE(count)}
    INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by)
    SELECT 'cs-${prefix}-' || i, '${prefix}-' || i, 'active', '${o.start}', 'st-dcare' FROM n`);
}

describe("the care tile with more than 100 active plans", () => {
  it("shows the newest plan when it is over its hours, counts every plan, and says it is truncated", async () => {
    await run(
      "INSERT INTO staff_users (id, email, name, role, status) VALUES ('st-dcare', 'dcare@example.test', 'Care Person', 'staff', 'active')",
    );
    await run(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES ('cl-dcare', 'CDCARE', 'Care Co', 'Care Co', 'business', 'IN', 'unregistered', '19', 'INR')",
    );
    const start = "2026-01-01";
    // 104 older plans (the first 40 with 15 minutes used; the day is capped at 24 hours for one person), then 2 that have not started, then the NEWEST: over its hours.
    await plans("old", 104, { start, created: `${NOW} - 100000000` });
    await plans("late", 2, { start: "2099-01-01", created: `${NOW} - 50000000` });
    await plans("new", 1, { start, created: `${NOW} - 1000` });
    const day = today();
    await run(`${RECURSIVE(40)}
      INSERT INTO time_logs (id, user_id, work_date, minutes, care_plan_id, billable, created_at, updated_at)
      SELECT 'tl-old-' || i, 'st-dcare', '${day}', 15, 'old-' || i, 1, ${NOW}, ${NOW} FROM n`);
    // 7 entries of 105 minutes on one plan of 600 included: 735 used, over by 135
    await run(`${RECURSIVE(7)}
      INSERT INTO time_logs (id, user_id, work_date, minutes, care_plan_id, billable, created_at, updated_at)
      SELECT 'tl-new-' || i, 'st-dcare', '${day}', 105, 'new-1', 1, ${NOW}, ${NOW} FROM n`);

    const s = await longSession("owner");
    const t = await tile(s.cookie);
    expect(t.truncated).toBe(true);
    // the plan that was not among the 100 oldest is the first row, at 735 of 600 (12,250 bp), reached
    expect(t.rows[0]).toMatchObject({
      planId: "new-1",
      flag: "reached",
      used: 735,
      available: 600,
      burnBp: 12_250,
    });
    expect(t.counts.reached).toBe(1);
    expect(t.counts.near).toBe(0);
    // every started plan is counted (104 old + 1 new), and the two that have not started apart
    expect(t.counts.active).toBe(105);
    expect(t.counts.notStarted).toBe(2);
    expect(t.rows).toHaveLength(20);
  });

  it("is served by indexes: the totals and the ranking never scan the care tables", async () => {
    const seen: string[] = [];
    const db = {
      prepare: (q: string) => {
        seen.push(q);
        return env.DB.prepare(q);
      },
      batch: (stmts: D1PreparedStatement[]) => env.DB.batch(stmts),
    } as unknown as D1Database;
    const s = await longSession("owner");
    await tile(s.cookie, withDb(db));
    const burn = seen.filter((q) => q.includes("1000000000"));
    expect(burn).toHaveLength(4); // the four statements of the loader, each with the ranked id list
    for (const q of [...burn, CARE_TOTALS_SQL]) {
      const plan = (
        await env.DB.prepare(`EXPLAIN QUERY PLAN ${q}`)
          .bind(...(q === CARE_TOTALS_SQL ? [today()] : q.includes("?2") ? [today(), today()] : [today()]))
          .all<{ detail: string }>()
      ).results
        .map((r) => r.detail)
        .join("\n");
      expect(plan, q.slice(0, 80)).not.toMatch(
        /SCAN (care_plans|care_plan_terms|care_plan_status_log|time_logs|clients)\b/,
      );
    }
    expect(seen).toContain(CARE_TOTALS_SQL);
  });
});
