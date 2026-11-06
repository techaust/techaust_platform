// M7.4 early check 1 L4, L6 [ADM-SET-09, NFR-9; run file docs/runs/m7.4-data-protection.md B.5, L30]: a live page of the consent family takes the `ended`
// rows last, so a hash split across pages never loses its `ended` row before its other receipts (they would then never be due again); and a later page keeps
// the first page's held count and oldest date (only the first page reads them). Its own file: it needs more than a full page of receipts. Invented data.
import { uuidv7 } from "@techaust/core";
import { cutoffsOf } from "@techaust/core/retention";
import { describe, expect, it } from "vitest";
import {
  dryRunSql,
  dueWhere,
  FAMILY_TABLES,
  LIVE_PAGE_ROWS,
  livePageSql,
  retentionStatements,
} from "../src/retention.ts";
import { all, db, first, run, switchRetention } from "./helpers.ts";

const DAY = 86_400_000;
// every receipt here is older than the 36-month cut-off (about 1,096 days)
const ago = (days: number) => Date.now() - days * DAY;
const figures = { emailLogMonths: 13, securityLogMonths: 13, requestsMonths: 36, consentProofMonths: 36 };

describe("consent pages (L4) and the first page's figures (L6)", () => {
  it("a hash whose receipts fall on two pages keeps its ended row until the last of them goes; the whole hash goes in the end", async () => {
    const hash = "4".repeat(64);
    // a full page of old receipts of another ended subject, older than the split hash's grant
    await run(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
       INSERT INTO consent_receipts (id, subject_hash, lead_id, contact_id, event, source, purposes, at)
       SELECT lower(hex(randomblob(16))), ?2, NULL, NULL, 'grant', 'web_form', '[]', ?3 FROM n`,
      LIVE_PAGE_ROWS,
      "5".repeat(64),
      ago(1300),
    );
    await run(
      "INSERT INTO consent_receipts (id, subject_hash, event, source, purposes, at) VALUES (?1, ?2, 'ended', 'retention', '[]', ?3)",
      uuidv7(),
      "5".repeat(64),
      ago(1300),
    );
    // the split hash: its ended row is OLDER than its grant (a page in date order would take the ended row first)
    await run(
      "INSERT INTO consent_receipts (id, subject_hash, event, source, purposes, at) VALUES (?1, ?2, 'ended', 'retention', '[]', ?3)",
      uuidv7(),
      hash,
      ago(1500),
    );
    await run(
      "INSERT INTO consent_receipts (id, subject_hash, event, source, purposes, at) VALUES (?1, ?2, 'grant', 'web_form', '[]', ?3)",
      uuidv7(),
      hash,
      ago(1200),
    );
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf).consent;
    const runId = uuidv7();
    await run(
      "INSERT INTO retention_runs (id, as_of, mode, families) VALUES (?1, ?2, 'live', 1)",
      runId,
      asOf,
    );
    await switchRetention(true);
    const left = () =>
      all<{ event: string }>("SELECT event FROM consent_receipts WHERE subject_hash = ?1 ORDER BY at", hash);
    // page 1: a full page of grants; neither ended row is touched
    await db().batch(retentionStatements(db(), "consent", "live", cut, asOf, runId));
    expect(await left()).toEqual([{ event: "ended" }, { event: "grant" }]);
    const p1 = await first<{ due: number; held_skipped: number; oldest_at: number | null; done: number }>(
      "SELECT due, held_skipped, oldest_at, done FROM retention_run_counts WHERE run_id = ?1 AND family = 'consent'",
      runId,
    );
    expect(p1?.due).toBe(LIVE_PAGE_ROWS);
    expect(p1?.done).toBe(0);
    // later pages: the rest goes, the hash whole; the first page's oldest date is kept (L6)
    for (let page = 0; page < 3; page++) {
      await db().batch(retentionStatements(db(), "consent", "live", cut, asOf, runId));
      const r = await first<{ done: number }>(
        "SELECT done FROM retention_run_counts WHERE run_id = ?1 AND family = 'consent'",
        runId,
      );
      if (r?.done === 1) break;
    }
    expect(await left()).toEqual([]);
    expect(
      (
        await first<{ n: number }>(
          "SELECT count(*) AS n FROM consent_receipts WHERE subject_hash = ?1",
          "5".repeat(64),
        )
      )?.n,
    ).toBe(0);
    const end = await first<{ due: number; oldest_at: number | null; held_skipped: number; done: number }>(
      "SELECT due, held_skipped, oldest_at, done FROM retention_run_counts WHERE run_id = ?1 AND family = 'consent'",
      runId,
    );
    expect(end).toEqual({
      due: LIVE_PAGE_ROWS + 3,
      held_skipped: p1?.held_skipped,
      oldest_at: p1?.oldest_at,
      done: 1,
    });
  });

  it("early check 2 M2: the switch turned off between page 1 and page 2: page 2 deletes nothing, adds nothing to due and ends the family", async () => {
    const hash = "6".repeat(64);
    await run(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
       INSERT INTO consent_receipts (id, subject_hash, lead_id, contact_id, event, source, purposes, at)
       SELECT lower(hex(randomblob(16))), ?2, NULL, NULL, 'grant', 'web_form', '[]', ?3 FROM n`,
      LIVE_PAGE_ROWS + 5,
      hash,
      ago(1300),
    );
    await run(
      "INSERT INTO consent_receipts (id, subject_hash, event, source, purposes, at) VALUES (?1, ?2, 'ended', 'retention', '[]', ?3)",
      uuidv7(),
      hash,
      ago(1300),
    );
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf).consent;
    const runId = uuidv7();
    await run(
      "INSERT INTO retention_runs (id, as_of, mode, families) VALUES (?1, ?2, 'live', 1)",
      runId,
      asOf,
    );
    const left = async () =>
      (await first<{ n: number }>("SELECT count(*) AS n FROM consent_receipts WHERE subject_hash = ?1", hash))
        ?.n;
    const counts = () =>
      first<{ due: number; done: number }>(
        "SELECT due, done FROM retention_run_counts WHERE run_id = ?1 AND family = 'consent'",
        runId,
      );
    await switchRetention(true);
    await db().batch(retentionStatements(db(), "consent", "live", cut, asOf, runId));
    expect(await left()).toBe(6);
    expect(await counts()).toEqual({ due: LIVE_PAGE_ROWS, done: 0 });
    // the Owner turns real deletion off; the page already queued runs
    await switchRetention(false);
    const results = await db().batch(retentionStatements(db(), "consent", "live", cut, asOf, runId));
    expect(await left()).toBe(6);
    expect(await counts()).toEqual({ due: LIVE_PAGE_ROWS, done: 1 });
    for (const r of results.slice(1)) expect(r.meta.changes).toBe(0);
    // every live statement holds the switch; the dry run's (and `dueWhere`) don't
    for (const sql of livePageSql("consent")) expect(sql).toContain("FROM retention_switches");
    expect(dryRunSql("consent")).not.toContain("retention_switches");
    for (const t of FAMILY_TABLES.consent) expect(dueWhere(t)).not.toContain("retention_switches");
    // a stopped page on a family with no row yet: the row says done with nothing due
    const fresh = uuidv7();
    await run(
      "INSERT INTO retention_runs (id, as_of, mode, families) VALUES (?1, ?2, 'live', 1)",
      fresh,
      asOf,
    );
    await db().batch(retentionStatements(db(), "consent", "live", cut, asOf, fresh));
    expect(
      await first(
        "SELECT due, held_skipped, oldest_at, done FROM retention_run_counts WHERE run_id = ?1",
        fresh,
      ),
    ).toEqual({ due: 0, held_skipped: 0, oldest_at: null, done: 1 });
    expect(await left()).toBe(6);
  });

  it("L6: the held count and the oldest date are read under the first-page CASE only", () => {
    const [upsert] = livePageSql("email_log");
    expect(upsert).toMatch(
      /CASE WHEN NOT EXISTS \(SELECT 1 FROM retention_run_counts WHERE run_id = \?3 AND family = \?4\) THEN \(SELECT count\(\*\)/,
    );
    expect(upsert).toMatch(
      /CASE WHEN NOT EXISTS \(SELECT 1 FROM retention_run_counts WHERE run_id = \?3 AND family = \?4\) THEN \(SELECT min\(/,
    );
  });
});
