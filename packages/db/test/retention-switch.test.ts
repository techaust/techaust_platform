// M7.4 C.7 (Q1 A, L4): the real-deletion switch is its own append-only table (`retention_switches`; B2: `settings.key` is held by the CHECK `settings_key`, so
// the brief's `retention_live` settings row can't exist). An active Owner turns it; on only with a dry run that finished within 7 days, named by `run_id`; the
// history is never changed or deleted. Invented data only.
import { uuidv7 } from "@techaust/core";
import { TRIAL_REPORT_MAX_AGE_MS } from "@techaust/core/retention";
import { describe, expect, it } from "vitest";
import { TRIAL_REPORT_MAX_AGE_MS_0079 } from "../src/triggers-data-protection.ts";
import { mkMember } from "./billing-helpers.ts";
import { rejects, run } from "./helpers.ts";

const DAY = 86_400_000;

const mkRun = async (mode: "dry_run" | "live", finishedAt: number | null) => {
  const id = uuidv7();
  await run(
    "INSERT INTO retention_runs (id, as_of, mode, started_at, finished_at, families) VALUES (?1, ?2, ?3, ?2, ?4, 11)",
    id,
    (finishedAt ?? Date.now()) - 1000,
    mode,
    finishedAt,
  );
  return id;
};
const turn = (live: 0 | 1, by: string, runId: string | null) =>
  run(
    "INSERT INTO retention_switches (id, live, by, run_id, at) VALUES (?1, ?2, ?3, ?4, ?5)",
    uuidv7(),
    live,
    by,
    runId,
    Date.now(),
  );

describe("retention_switches (C.7)", () => {
  it("the trigger's 7 days are core's", () =>
    expect(TRIAL_REPORT_MAX_AGE_MS_0079).toBe(TRIAL_REPORT_MAX_AGE_MS));

  it("on needs an active Owner and a dry run finished within 7 days; off needs only an active Owner; never changed or deleted", async () => {
    const owner = await mkMember("owner");
    const staff = await mkMember("staff");
    const fresh = await mkRun("dry_run", Date.now() - DAY);
    const stale = await mkRun("dry_run", Date.now() - 8 * DAY);
    const running = await mkRun("dry_run", null);
    const live = await mkRun("live", Date.now() - DAY);
    await rejects(turn(1, owner, null), /retention_switches/);
    await rejects(turn(1, owner, stale), /retention_switches_values/);
    await rejects(turn(1, owner, running), /retention_switches_values/);
    await rejects(turn(1, owner, live), /retention_switches_values/);
    await rejects(turn(1, staff, fresh), /retention_switches_values/);
    await rejects(turn(0, staff, null), /retention_switches_values/);
    await turn(1, owner, fresh);
    await turn(0, owner, null);
    await rejects(run("UPDATE retention_switches SET live = 1"), /retention_switches_no_update/);
    await rejects(run("DELETE FROM retention_switches"), /retention_switches_no_delete/);
    expect(true).toBe(true);
  });
});
