// The care tile's near and reached counts cover EVERY plan, not only the 100 that are loaded [ADM-DASH-01, ADM-CARE-03; M4.3 re-check,
// candidate 4], and the ranking behind them is worked out once, in one statement (candidate 5). Fixture: 144 started active plans (120 over
// their hours, 9 exactly at them, 12 at 80 %, 3 barely used) and 3 that have not started; one person per plan keeps every entry under the
// 24-hour day cap.
import { env } from "cloudflare:workers";
import { burnRankQuery } from "@techaust/db/care";
import { describe, expect, it } from "vitest";
import { longSession, today } from "./test-care.ts";
import { call, withDb } from "./test-helpers.ts";

const NOW = "(cast(unixepoch('subsec') * 1000 as integer))";
const RECURSIVE = (n: number) =>
  `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n})`;
const run = (sql: string, ...v: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...v)
    .run();
/** Set to true to print the rows read and the wall time (the test then fails on purpose, which is the only way vitest shows them). */
const SHOW_REPORT = false;

type Tile = {
  counts: { active: number; notStarted: number; near: number; reached: number };
  truncated: boolean;
  rows: { planId: string; flag: string; used: number; available: number }[];
};

/** The minutes a plan used this period, by its number: 1-120 over (705 of 600), 121-129 at the hours, 130-141 at 80 %, 142-144 barely. */
const USED = `CASE WHEN i <= 120 THEN 705 WHEN i <= 129 THEN 600 WHEN i <= 141 THEN 480 ELSE 60 END`;

async function fixture() {
  await run(
    "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES ('cl-cc', 'CCC', 'Counts Co', 'Counts Co', 'business', 'IN', 'unregistered', '19', 'INR')",
  );
  await run(`${RECURSIVE(144)}
    INSERT INTO staff_users (id, email, name, role, status) SELECT 'st-cc-' || i, 'cc' || i || '@example.test', 'Person ' || i, 'staff', 'active' FROM n`);
  await run(`${RECURSIVE(147)}
    INSERT INTO care_plans (id, client_id, tier, currency, price_minor, included_minutes, start_date, billing_day, status, rollover, overage_rate_minor, created_at, updated_at)
    SELECT 'cc-' || i, 'cl-cc', 'growth', 'INR', 2499900, 600, CASE WHEN i <= 144 THEN '2026-01-01' ELSE '2099-01-01' END, 1, 'active', 'none', 150000, ${NOW} - 1000000 + i, ${NOW} - 1000000 + i FROM n`);
  await run(`${RECURSIVE(147)}
    INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, overage_rate_minor, rollover, created_by)
    SELECT 'cct-' || i, 'cc-' || i, CASE WHEN i <= 144 THEN '2026-01-01' ELSE '2099-01-01' END, 'growth', 2499900, 600, 150000, 'none', 'st-cc-1' FROM n`);
  await run(`${RECURSIVE(147)}
    INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by)
    SELECT 'ccs-' || i, 'cc-' || i, 'active', CASE WHEN i <= 144 THEN '2026-01-01' ELSE '2099-01-01' END, 'st-cc-1' FROM n`);
  await run(`${RECURSIVE(144)}
    INSERT INTO time_logs (id, user_id, work_date, minutes, care_plan_id, billable, created_at, updated_at)
    SELECT 'ccl-' || i, 'st-cc-' || i, '${today()}', ${USED}, 'cc-' || i, 1, ${NOW}, ${NOW} FROM n`);
}

type Rec = { rows: number; sql: string };
/** A D1 that adds up the rows each batch read and keeps the statements. */
function recording() {
  const seen: Rec[] = [];
  let batches = 0;
  class S {
    constructor(
      readonly real: D1PreparedStatement,
      readonly sql: string,
    ) {}
    bind(...v: unknown[]) {
      return new S(this.real.bind(...v), this.sql);
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
    prepare: (q: string) => new S(env.DB.prepare(q), q),
    batch: async (stmts: S[]) => {
      batches++;
      const results = await env.DB.batch(stmts.map((s) => s.real));
      for (const [i, s] of stmts.entries()) seen.push({ rows: results[i]?.meta.rows_read ?? 0, sql: s.sql });
      return results;
    },
  } as unknown as D1Database;
  return { db, seen, batches: () => batches, rows: () => seen.reduce((n, r) => n + r.rows, 0) };
}

describe("the care tile past 100 active plans", () => {
  it("counts near and reached over every plan, ranks once, and loads the 100 highest by burn", async () => {
    await fixture();
    const s = await longSession("owner");
    const rec = recording();
    const t0 = performance.now();
    const res = await call("/dashboard", { cookie: s.cookie }, withDb(rec.db));
    const ms = performance.now() - t0;
    expect(res.status).toBe(200);
    const t = ((await res.json()) as { tiles: { careBurn: Tile } }).tiles.careBurn;

    expect(t.truncated).toBe(true);
    // every started plan is counted, and the three that have not started apart
    expect(t.counts.active).toBe(144);
    expect(t.counts.notStarted).toBe(3);
    // 120 + 9 at or over their hours, 12 at 80 %: all of them, though only 100 plans are loaded
    expect(t.counts.reached).toBe(129);
    expect(t.counts.near).toBe(12);
    // the rows shown are the highest burn first (705 of 600 is 11,750 bp)
    expect(t.rows).toHaveLength(20);
    expect(t.rows.every((r) => r.flag === "reached" && r.used === 705 && r.available === 600)).toBe(true);

    // the ranking is one statement: the pick of the 100 highest and the totals come from it, and the loader's four statements only read ids
    const ranking = rec.seen.filter((r) => r.sql.includes("1000000000"));
    expect(ranking).toHaveLength(1);
    const loader = rec.seen.filter(
      (r) => /FROM care_plan(s|_terms|_status_log)? /.test(r.sql) && r.sql.includes("json_each"),
    );
    expect(loader.length).toBeGreaterThanOrEqual(3);
    // three D1 calls in all (the dashboard batch, the ranking and totals, the loader), well inside the M3.5 budget of 8,000 rows read
    expect(rec.batches()).toBe(3);
    expect(rec.rows()).toBeLessThanOrEqual(8_000);
    if (SHOW_REPORT)
      throw new Error(
        [
          `rows_read ${rec.rows()} in ${rec.batches()} batches, ${ms.toFixed(1)} ms wall`,
          ...rec.seen.map((r) => `  ${r.rows}  ${r.sql.replace(/\s+/g, " ").slice(0, 110)}`),
        ].join("\n"),
      );
  });

  it("the ranking statement is served by indexes and gives the whole-set totals on every row", async () => {
    const q = burnRankQuery(100, today());
    const plan = (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
        .bind(...q.bind)
        .all<{ detail: string }>()
    ).results
      .map((r) => r.detail)
      .join("\n");
    expect(plan).not.toMatch(/SCAN (care_plans|care_plan_terms|care_plan_status_log|time_logs|clients)\b/);
    const rows = (
      await env.DB.prepare(q.sql)
        .bind(...q.bind)
        .all<{ id: string; k: number; near_or_reached: number; reached: number }>()
    ).results;
    expect(rows).toHaveLength(100);
    expect(rows.every((r) => r.k === 11_750)).toBe(true);
    expect(new Set(rows.map((r) => `${r.near_or_reached}/${r.reached}`))).toEqual(new Set(["141/129"]));
    expect(() => burnRankQuery(0, today())).toThrow(RangeError);
    expect(() => burnRankQuery(101, today())).toThrow(RangeError);
  });
});
