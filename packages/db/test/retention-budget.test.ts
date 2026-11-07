// Full audit M6–M7 AU9 and AU10 [ADM-SET-09, NFR-9, JOB-CRON-01; run file docs/runs/full-audit-m6-m7.md]: a live family stops after `LIVE_PAGES_PER_RUN`
// pages a night (done, "more tomorrow"); a dry-run count that reached its cap says so (`capped`); the once-only marker bells are never cleaned up. Its own
// file: it needs 10,000 rows of one table. Invented data.
import { uuidv7 } from "@techaust/core";
import { cutoffsOf } from "@techaust/core/retention";
import { describe, expect, it } from "vitest";
import {
  BELL_MARKER_KINDS,
  DRY_RUN_COUNT_CAP,
  LIVE_PAGE_ROWS,
  LIVE_PAGES_PER_RUN,
  retentionStatements,
} from "../src/retention.ts";
import { mkMember } from "./billing-helpers.ts";
import { all, db, first, run, switchRetention } from "./helpers.ts";

const figures = { emailLogMonths: 13, securityLogMonths: 13, requestsMonths: 36, consentProofMonths: 36 };
const DAY = 86_400_000;

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

describe("AU9: the nightly page budget and the capped trial count", () => {
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

  it("a live family stops at its page budget with rows still due: done, more tomorrow; the next night's run carries on", async () => {
    await switchRetention(true);
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf).stats;
    const night1 = await openRun("live");
    // the family already ran all but one of its pages tonight (as if 19 pages had gone)
    await run(
      "INSERT INTO retention_run_counts (run_id, family, due, done, pages) VALUES (?1, 'stats', ?2, 0, ?3)",
      night1,
      (LIVE_PAGES_PER_RUN - 1) * LIVE_PAGE_ROWS,
      LIVE_PAGES_PER_RUN - 1,
    );
    await oldStats(LIVE_PAGE_ROWS + 7, "bud-");
    await db().batch(retentionStatements(db(), "stats", "live", cut, asOf, night1));
    expect(await countsOf(night1, "stats")).toEqual({
      due: LIVE_PAGES_PER_RUN * LIVE_PAGE_ROWS,
      done: 1,
      pages: LIVE_PAGES_PER_RUN,
      capped: 0,
      more_tomorrow: 1,
    });
    const left = async () =>
      (await first<{ n: number }>("SELECT count(*) AS n FROM stats_daily WHERE dimension GLOB 'bud-*'"))?.n;
    expect(await left()).toBe(7);
    // the next night: a fresh run takes the rest and is done without more tomorrow
    const night2 = await openRun("live");
    await db().batch(retentionStatements(db(), "stats", "live", cut, asOf + DAY, night2));
    expect(await countsOf(night2, "stats")).toEqual({
      due: 7,
      done: 1,
      pages: 1,
      capped: 0,
      more_tomorrow: 0,
    });
    expect(await left()).toBe(0);
    await switchRetention(false);
  });

  it("a family that ends below the budget is done with no more tomorrow; a stopped page (switch off) never marks it", async () => {
    await switchRetention(true);
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf).stats;
    const r1 = await openRun("live");
    await oldStats(3, "small-");
    await db().batch(retentionStatements(db(), "stats", "live", cut, asOf, r1));
    expect(await countsOf(r1, "stats")).toEqual({ due: 3, done: 1, pages: 1, capped: 0, more_tomorrow: 0 });
    // budget reached on a page the switch stopped: done, nothing deleted, not "more tomorrow"
    const r2 = await openRun("live");
    await run(
      "INSERT INTO retention_run_counts (run_id, family, due, done, pages) VALUES (?1, 'stats', 0, 0, ?2)",
      r2,
      LIVE_PAGES_PER_RUN - 1,
    );
    await oldStats(2, "stop-");
    await switchRetention(false);
    await db().batch(retentionStatements(db(), "stats", "live", cut, asOf, r2));
    expect(await countsOf(r2, "stats")).toMatchObject({ done: 1, more_tomorrow: 0 });
    expect(
      (await first<{ n: number }>("SELECT count(*) AS n FROM stats_daily WHERE dimension GLOB 'stop-*'"))?.n,
    ).toBe(2);
  });
});

describe("AU10: the once-only marker bells stay", () => {
  it("an old read bell goes; a marker kind of the same age stays, in the trial count and the live page", async () => {
    const owner = await mkMember("owner");
    const old = Date.now() - 400 * DAY;
    const bell = (kind: string) =>
      run(
        "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link, read_at, created_at) VALUES (?1, ?2, ?3, 'document', ?4, 't', '/', ?5, ?5)",
        uuidv7(),
        owner,
        kind,
        uuidv7(),
        old,
      );
    for (const k of BELL_MARKER_KINDS) await bell(k);
    await bell("pdf.ready");
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf).bells;
    const dry = await openRun("dry_run");
    await db().batch(retentionStatements(db(), "bells", "dry_run", cut, asOf, dry));
    expect((await countsOf(dry, "bells"))?.due).toBe(1);
    await switchRetention(true);
    const live = await openRun("live");
    await db().batch(retentionStatements(db(), "bells", "live", cut, asOf, live));
    await switchRetention(false);
    const kinds = (
      await all<{ kind: string }>("SELECT kind FROM notifications WHERE user_id = ?1 ORDER BY kind", owner)
    ).map((r) => r.kind);
    expect(kinds).toEqual([...BELL_MARKER_KINDS].sort());
  });
});
