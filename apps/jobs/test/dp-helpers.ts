// M7.4 test helpers of the jobs Worker: the real-deletion switch (`retention_switches`, append-only; on needs an active Owner and a dry run finished within 7
// days, so the helper writes both) and an active Owner. Invented data only.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";

let tick = 0;

/** An active Owner (the bells' and the switch's member). */
export async function mkDpOwner(): Promise<string> {
  const id = uuidv7();
  await env.DB.prepare(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Owner', 'owner', 'active')",
  )
    .bind(id, `owner-${id}@example.test`)
    .run();
  return id;
}

/** Turns real deletion on or off, as the Owner's switch does (C.7); the newest row wins. */
export async function setRetentionMode(mode: "live" | "dry_run"): Promise<void> {
  const owner = await mkDpOwner();
  const at = Date.now() + ++tick;
  let runId: string | null = null;
  if (mode === "live") {
    runId = uuidv7();
    await env.DB.prepare(
      "INSERT INTO retention_runs (id, as_of, mode, started_at, finished_at, families) VALUES (?1, ?2, 'dry_run', ?2, ?2, 11)",
    )
      .bind(runId, Date.now() - 1000)
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO retention_switches (id, live, by, run_id, at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(uuidv7(), mode === "live" ? 1 : 0, owner, runId, at)
    .run();
}
