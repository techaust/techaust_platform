// Full audit M6–M7 AU9, AU10, AU51 and AU53 [ADM-SET-09, NFR-9, JOB-CRON-01; run file docs/runs/full-audit-m6-m7.md]: a live run stops once the rows D1
// measured as written by its page batches (`written`, `meta.rows_written`) reach `RUN_WRITE_BUDGET` across all its families (a page that finds the budget
// spent does nothing, `capped`, and says "more tomorrow" when rows are due); a dry-run count that reached its cap says so (`capped`); the once-only marker
// bells are never deleted, and their titles become a neutral line after 12 months. Its own file: it needs tens of thousands of rows of one table. Invented
// data. `page` does what the jobs consumer does (`apps/jobs/src/retention.ts`): the batch, then its measured writes onto the family's row.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { cutoffsOf, type RetentionCutoff, type RetentionFamily } from "@techaust/core/retention";
import { describe, expect, it } from "vitest";
import {
  BELL_MARKER_KINDS,
  BELL_MARKER_SCRUBBED_TITLE,
  DRY_RUN_COUNT_CAP,
  FAMILY_TABLES,
  LIVE_PAGE_ROWS,
  LIVE_PAGE_WRITE_CEILING,
  RECORD_WRITTEN_SQL,
  RUN_WRITE_BUDGET,
  retentionStatements,
  rowsWrittenOf,
} from "../src/retention.ts";
import { triggerMigrationSql } from "../src/triggers.ts";
import { mkMember } from "./billing-helpers.ts";
import { all, db, first, rejects, run, switchRetention } from "./helpers.ts";

const figures = { emailLogMonths: 13, securityLogMonths: 13, requestsMonths: 36, consentProofMonths: 36 };
const DAY = 86_400_000;
/** D1's free-plan rows written a day, for the whole account. */
const D1_DAILY_WRITES = 100_000;

/** `n` per-plan statistics rows of 2020 (far past the 24-month cut-off), each its own plan. */
const oldStats = (n: number, prefix: string) =>
  run(
    `WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ?1)
     INSERT INTO stats_daily (date, metric, dimension, value) SELECT '2020-01-01', 'care.used_minutes', ?2 || i, 1 FROM k`,
    n,
    prefix,
  );
const openRun = async (mode: "live" | "dry_run") => {
  const runId = uuidv7();
  await run(
    "INSERT INTO retention_runs (id, as_of, mode, families) VALUES (?1, ?2, ?3, 11)",
    runId,
    Date.now(),
    mode,
  );
  return runId;
};
const countsOf = (runId: string, family: string) =>
  first<{ due: number; done: number; pages: number; capped: number; more_tomorrow: number }>(
    "SELECT due, done, pages, capped, more_tomorrow FROM retention_run_counts WHERE run_id = ?1 AND family = ?2",
    runId,
    family,
  );
const writtenOf = async (runId: string) =>
  (
    await first<{ n: number }>(
      "SELECT coalesce(sum(written), 0) AS n FROM retention_run_counts WHERE run_id = ?1",
      runId,
    )
  )?.n ?? 0;
/** One page as the consumer runs it: the batch, then the rows it wrote (as D1 measured them) added to the family's row. Returns those rows. */
async function page(
  family: RetentionFamily,
  mode: "live" | "dry_run",
  cut: RetentionCutoff,
  asOf: number,
  runId: string,
): Promise<number> {
  const results = await db().batch(retentionStatements(db(), family, mode, cut, asOf, runId));
  const written = rowsWrittenOf(results);
  if (written > 0) await run(RECORD_WRITTEN_SQL, runId, family, written);
  return written;
}
/** A run that already spent `written` rows tonight on another family. */
const spent = (runId: string, written: number) =>
  run(
    "INSERT INTO retention_run_counts (run_id, family, due, done, pages, written) VALUES (?1, 'email_log', 0, 1, 1, ?2)",
    runId,
    written,
  );

const statementsOf = (name: string) =>
  (env.TEST_MIGRATIONS.find((m) => m.name === name)?.queries ?? [])
    .map((q) => q.replace(/^--[^\n]*\n?/gm, "").trim())
    .filter((q) => q !== "");

describe("0085 and 0086", () => {
  it("0085 only adds the measured writes column (no table rebuilt, nothing dropped)", () => {
    expect(statementsOf("0085_audit_af3.sql")).toEqual([
      "ALTER TABLE `retention_run_counts` ADD `written` integer DEFAULT 0 NOT NULL;",
    ]);
  });
  it("0086 regenerates from the generator and only creates triggers", () => {
    const generated = triggerMigrationSql("audit_af3_triggers")
      .split("\n--> statement-breakpoint\n")
      .map((q) => q.replace(/^--[^\n]*\n?/gm, "").trim())
      .filter((q) => q !== "");
    const norm = (xs: string[]) => xs.map((q) => q.replace(/\s+/g, " ").trim().replace(/;$/, ""));
    const applied = norm(statementsOf("0086_audit_af3_triggers.sql"));
    expect(applied).toEqual(norm(generated));
    for (const q of applied) expect(q).toMatch(/^CREATE TRIGGER /);
  });
});

describe("AU9: the capped trial count", () => {
  it("the dry run of 10,000 or more due rows says capped; fewer is not capped", async () => {
    await oldStats(DRY_RUN_COUNT_CAP, "cap-");
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf).stats;
    const capped = await openRun("dry_run");
    await db().batch(retentionStatements(db(), "stats", "dry_run", cut, asOf, capped));
    expect(await countsOf(capped, "stats")).toEqual({
      due: DRY_RUN_COUNT_CAP,
      done: 1,
      pages: 0,
      capped: 1,
      more_tomorrow: 0,
    });
    await run("DELETE FROM stats_daily WHERE dimension = 'cap-1'");
    const under = await openRun("dry_run");
    await db().batch(retentionStatements(db(), "stats", "dry_run", cut, asOf, under));
    expect(await countsOf(under, "stats")).toMatchObject({ due: DRY_RUN_COUNT_CAP - 1, capped: 0 });
    await run("DELETE FROM stats_daily WHERE dimension GLOB 'cap-*'");
  });
});

describe("AU51: the nightly budget of rows written, as D1 measured them", () => {
  it("rowsWrittenOf adds each statement's meta.rows_written (a missing or odd figure counts 0)", () => {
    expect(
      rowsWrittenOf([{ meta: { rows_written: 3 } }, { meta: {} }, {}, { meta: { rows_written: 2.7 } }]),
    ).toBe(5);
    expect(rowsWrittenOf([{ meta: { rows_written: -4 } }])).toBe(0);
    expect(rowsWrittenOf([])).toBe(0);
  });

  it("a page within the budget acts and records what D1 measured; the next page finds the budget spent, acts on nothing and ends its family with more tomorrow; another family after it does nothing; the next night carries on", async () => {
    await switchRetention(true);
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf);
    const night1 = await openRun("live");
    // the run already spent all but one row of its budget tonight, on another family
    await spent(night1, RUN_WRITE_BUDGET - 1);
    await oldStats(LIVE_PAGE_ROWS + 7, "bud-");
    const left = async () =>
      (await first<{ n: number }>("SELECT count(*) AS n FROM stats_daily WHERE dimension GLOB 'bud-*'"))?.n;
    // still under the budget: a full page goes, and its measured writes are on the family's row
    const w1 = await page("stats", "live", cut.stats, asOf, night1);
    expect(w1).toBeGreaterThanOrEqual(LIVE_PAGE_ROWS);
    expect(await countsOf(night1, "stats")).toEqual({
      due: LIVE_PAGE_ROWS,
      done: 0,
      pages: 1,
      capped: 0,
      more_tomorrow: 0,
    });
    expect(await writtenOf(night1)).toBe(RUN_WRITE_BUDGET - 1 + w1);
    expect(await left()).toBe(7);
    // the next page of the family: the budget is spent, nothing counted or deleted, done with more tomorrow
    await page("stats", "live", cut.stats, asOf, night1);
    expect(await countsOf(night1, "stats")).toEqual({
      due: LIVE_PAGE_ROWS,
      done: 1,
      pages: 1,
      capped: 1,
      more_tomorrow: 1,
    });
    expect(await left()).toBe(7);
    // a family whose page comes after the budget: nothing counted or deleted, done, capped, and more tomorrow (an old run is due)
    const oldRun = uuidv7();
    await run(
      "INSERT INTO retention_runs (id, as_of, mode, started_at, families) VALUES (?1, 1, 'dry_run', ?2, 11)",
      oldRun,
      Date.now() - 500 * DAY,
    );
    await page("runs", "live", cut.runs, asOf, night1);
    expect(await countsOf(night1, "runs")).toEqual({
      due: 0,
      done: 1,
      pages: 0,
      capped: 1,
      more_tomorrow: 1,
    });
    expect(await first("SELECT id FROM retention_runs WHERE id = ?1", oldRun)).toEqual({ id: oldRun });
    await run("DELETE FROM retention_runs WHERE id = ?1", oldRun);
    // the next night: a fresh run takes the rest and is done without more tomorrow
    const night2 = await openRun("live");
    await page("stats", "live", cut.stats, asOf + DAY, night2);
    expect(await countsOf(night2, "stats")).toEqual({
      due: 7,
      done: 1,
      pages: 1,
      capped: 0,
      more_tomorrow: 0,
    });
    expect(await left()).toBe(0);
    expect(await writtenOf(night2)).toBeGreaterThanOrEqual(7);
    await switchRetention(false);
  });

  it("the worst night: a backlog far over the budget stops once the measured writes reach it, at most one page over, well inside D1's daily writes", async () => {
    await switchRetention(true);
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf);
    const night = await openRun("live");
    // more than one night can take: the budget in rows of this table at one write each, and half again
    const backlog = Math.ceil(RUN_WRITE_BUDGET * 1.5);
    await oldStats(backlog, "big-");
    const pages: number[] = [];
    for (let i = 0; i < Math.ceil(backlog / LIVE_PAGE_ROWS) + 2; i++) {
      pages.push(await page("stats", "live", cut.stats, asOf, night));
      if ((await countsOf(night, "stats"))?.done === 1) break;
    }
    const total = await writtenOf(night);
    const row = await countsOf(night, "stats");
    // it reached the budget, stopped there with rows left for tomorrow, and never went more than one page over
    expect(row).toMatchObject({ done: 1, capped: 1, more_tomorrow: 1 });
    expect(total).toBeGreaterThanOrEqual(RUN_WRITE_BUDGET);
    for (const w of pages) expect(w).toBeLessThanOrEqual(LIVE_PAGE_WRITE_CEILING);
    expect(total - Math.max(...pages)).toBeLessThan(RUN_WRITE_BUDGET);
    expect(total).toBeLessThanOrEqual(RUN_WRITE_BUDGET + LIVE_PAGE_WRITE_CEILING);
    expect(RUN_WRITE_BUDGET + LIVE_PAGE_WRITE_CEILING).toBeLessThanOrEqual(D1_DAILY_WRITES / 2);
    const left = (
      await first<{ n: number }>("SELECT count(*) AS n FROM stats_daily WHERE dimension GLOB 'big-*'")
    )?.n;
    expect(left).toBe(backlog - (row?.due ?? 0));
    expect(left).toBeGreaterThan(0);
    // every other family of the night does nothing now
    await page("counters", "live", cut.counters, asOf, night);
    expect(await countsOf(night, "counters")).toMatchObject({ due: 0, done: 1, pages: 0, capped: 1 });
    await run("DELETE FROM stats_daily WHERE dimension GLOB 'big-*'");
    await switchRetention(false);
  });

  it("a full page of the counters and the bells writes at most the page ceiling; every family's direct writes fit it too", async () => {
    await switchRetention(true);
    const owner = await mkMember("owner");
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf);
    const old = asOf - 400 * DAY;
    const fill = (sql: string, ...binds: unknown[]) =>
      run(
        `WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ${LIVE_PAGE_ROWS}) ${sql}`,
        ...binds,
      );
    await fill(
      "INSERT INTO auth_attempts (key, window_start) SELECT 'ceil:' || i, ?1 FROM k",
      asOf - 3 * DAY,
    );
    await fill("INSERT INTO pdf_asks (key, asked_at) SELECT 'ceil:' || i, ?1 FROM k", asOf - 3 * DAY);
    await fill(
      "INSERT INTO hook_failures (key, window_start) SELECT 'ceil:' || i, ?1 FROM k",
      asOf - 3 * DAY,
    );
    const r1 = await openRun("live");
    const counters = await page("counters", "live", cut.counters, asOf, r1);
    expect(await countsOf(r1, "counters")).toMatchObject({ due: 3 * LIVE_PAGE_ROWS, capped: 0 });
    expect(counters).toBeGreaterThanOrEqual(3 * LIVE_PAGE_ROWS);
    expect(counters).toBeLessThanOrEqual(LIVE_PAGE_WRITE_CEILING);
    // the bells: a full page of old bells to delete and a full page of old marker bells to scrub, in one page
    await fill(
      "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link, read_at, created_at) SELECT 'ceil-d-' || i, ?1, 'pdf.ready', 'document', 'e-' || i, 'Bell', '/', ?2, ?2 FROM k",
      owner,
      old,
    );
    await fill(
      "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link, created_at) SELECT 'ceil-m-' || i, ?1, 'milestone.unbilled', 'milestone', 'm-' || i, 'Milestone of Pat Example', '/', ?2 FROM k",
      owner,
      old,
    );
    const r2 = await openRun("live");
    const bells = await page("bells", "live", cut.bells, asOf, r2);
    expect(await countsOf(r2, "bells")).toMatchObject({ due: 2 * LIVE_PAGE_ROWS, capped: 0 });
    expect(bells).toBeGreaterThanOrEqual(2 * LIVE_PAGE_ROWS);
    expect(bells).toBeLessThanOrEqual(LIVE_PAGE_WRITE_CEILING);
    // every family: 500 rows of each of its tables, each with its table row and every index entry, fits the ceiling (cascades and triggers aside)
    for (const [family, tables] of Object.entries(FAMILY_TABLES)) {
      let direct = 0;
      for (const t of tables) {
        const idx = (
          await first<{ n: number }>(
            "SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1",
            t.table,
          )
        )?.n;
        direct += LIVE_PAGE_ROWS * (1 + (idx ?? 0));
      }
      expect(direct, family).toBeLessThanOrEqual(LIVE_PAGE_WRITE_CEILING);
    }
    await run("DELETE FROM notifications WHERE user_id = ?1", owner);
    await switchRetention(false);
  });

  it("a family that ends within the budget is done with no more tomorrow; a stopped page (switch off) never marks it", async () => {
    await switchRetention(true);
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf).stats;
    const r1 = await openRun("live");
    await oldStats(3, "small-");
    await page("stats", "live", cut, asOf, r1);
    expect(await countsOf(r1, "stats")).toEqual({ due: 3, done: 1, pages: 1, capped: 0, more_tomorrow: 0 });
    // the budget spent, on a page the switch stopped: done, nothing deleted, neither capped nor "more tomorrow"
    const r2 = await openRun("live");
    await spent(r2, RUN_WRITE_BUDGET);
    await oldStats(2, "stop-");
    await switchRetention(false);
    await page("stats", "live", cut, asOf, r2);
    expect(await countsOf(r2, "stats")).toMatchObject({ done: 1, pages: 0, capped: 0, more_tomorrow: 0 });
    expect(
      (await first<{ n: number }>("SELECT count(*) AS n FROM stats_daily WHERE dimension GLOB 'stop-*'"))?.n,
    ).toBe(2);
    await run("DELETE FROM stats_daily WHERE dimension GLOB 'stop-*'");
  });

  it("the measured total is a whole number that only goes up (audit_af3_triggers)", async () => {
    const r = await openRun("live");
    await spent(r, 10);
    await rejects(
      run("UPDATE retention_run_counts SET written = 9 WHERE run_id = ?1", r),
      /retention_run_counts_written_update/,
    );
    await rejects(
      run("UPDATE retention_run_counts SET written = 10.5 WHERE run_id = ?1", r),
      /retention_run_counts_written_update/,
    );
    await rejects(
      run("INSERT INTO retention_run_counts (run_id, family, written) VALUES (?1, 'bells', -1)", r),
      /retention_run_counts_written_insert/,
    );
    await run(RECORD_WRITTEN_SQL, r, "email_log", 5);
    // nothing to add writes nothing
    await run(RECORD_WRITTEN_SQL, r, "email_log", 0);
    expect(await writtenOf(r)).toBe(15);
  });
});

describe("AU10 and AU53: the once-only marker bells stay, and lose their titles after 12 months", () => {
  it("an old read bell goes; a marker kind of the same age stays with the neutral title, in the trial count and the live page; a young marker keeps its title", async () => {
    const owner = await mkMember("owner");
    const old = Date.now() - 400 * DAY;
    const bell = (kind: string, at = old, title = "Milestone 2 for Pat Example was delivered 30 days ago") =>
      run(
        "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link, read_at, created_at) VALUES (?1, ?2, ?3, 'milestone', ?4, ?6, '/', ?5, ?5)",
        uuidv7(),
        owner,
        kind,
        uuidv7(),
        at,
        title,
      );
    for (const k of BELL_MARKER_KINDS) await bell(k);
    await bell("pdf.ready");
    // a marker of 11 months (kept whole) and one already neutral (not due again)
    await bell("milestone.unbilled", Date.now() - 330 * DAY, "Young title");
    await bell("proforma.tax_invoice_due", old, BELL_MARKER_SCRUBBED_TITLE);
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf).bells;
    const dry = await openRun("dry_run");
    await db().batch(retentionStatements(db(), "bells", "dry_run", cut, asOf, dry));
    // one bell to delete and one marker of each kind to scrub
    expect((await countsOf(dry, "bells"))?.due).toBe(1 + BELL_MARKER_KINDS.length);
    await switchRetention(true);
    const live = await openRun("live");
    await page("bells", "live", cut, asOf, live);
    expect((await countsOf(live, "bells"))?.due).toBe(1 + BELL_MARKER_KINDS.length);
    await switchRetention(false);
    const rows = await all<{ kind: string; title: string; created_at: number }>(
      "SELECT kind, title, created_at FROM notifications WHERE user_id = ?1 ORDER BY kind, created_at",
      owner,
    );
    expect(rows.map((r) => r.kind)).toEqual(
      [...BELL_MARKER_KINDS, "milestone.unbilled", "proforma.tax_invoice_due"].sort(),
    );
    for (const r of rows)
      expect(r.title, r.kind).toBe(r.created_at === old ? BELL_MARKER_SCRUBBED_TITLE : "Young title");
    // the next night finds nothing more to do in the bells
    const again = await openRun("dry_run");
    await db().batch(retentionStatements(db(), "bells", "dry_run", cut, asOf, again));
    expect((await countsOf(again, "bells"))?.due).toBe(0);
    await run("DELETE FROM notifications WHERE user_id = ?1", owner);
  });

  it("the neutral line is plain text the SQL can hold as a literal, with no name in it", () => {
    expect(BELL_MARKER_SCRUBBED_TITLE).not.toMatch(/['"{}]/);
    expect(BELL_MARKER_SCRUBBED_TITLE.length).toBeLessThanOrEqual(300);
  });
});
