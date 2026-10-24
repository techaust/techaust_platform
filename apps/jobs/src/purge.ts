// Lead retention clean-up (M3.2, ADM-LEAD-05, JOB-CRON-01). VERIFY WITH CA/LEGAL (DPDP retention).
//   cron (daily 22:00 UTC = 03:30 IST) -> `enqueueDue`: ONLY enqueues. One page of at most LEAD_PURGE_PAGE due leads, one
//     `lead.purge` message each on the existing leads queue; if more are due, one `lead.purge.scan` message carries the
//     keyset cursor on to the next page (consumer-driven, so no invocation does more than one page).
//   consumer -> `purgeLead`: one lead per message. It re-checks the conditions in SQL (not converted, no legal hold,
//     `delete_after` passed: a lead that got an activity after it was enqueued has a later date and is left alone), then in ONE
//     db.batch() writes the audit row (lead id and ref only, no personal data) and deletes the bell rows and the lead
//     (`lead_activities` cascade, `duplicate_of` links are set to NULL by the foreign key). A redelivery finds nothing to do.
//   LEAD_PURGE_MODE: anything but "live" is a dry run: the cron logs one count per page (`lead.purge_dry_run_page`) and enqueues
//   no per-lead messages; nothing is deleted. (A message already in flight still logs the reference in `purgeLead`.)
import { LEAD_DELETABLE_SQL, LEAD_PURGE_PAGE, type LeadPurgeScanMessage, uuidv7 } from "@techaust/core";
import { logEvent } from "./log.ts";

/** The cron expression of wrangler.jsonc that triggers the clean-up. */
export const PURGE_CRON = "0 22 * * *";

/** The conditions of a due lead (`?1` is the lead id, `?2` the time). */
const DUE = `delete_after IS NOT NULL AND delete_after <= ?2 AND ${LEAD_DELETABLE_SQL}`;

/** The scan, exported so a test can EXPLAIN it (it must use the partial index `leads_delete_due`). */
export const SCAN_SQL = `SELECT id, ref, delete_after AS at FROM leads INDEXED BY leads_delete_due WHERE delete_after <= ?1 AND ${LEAD_DELETABLE_SQL} AND (delete_after, id) > (?2, ?3) ORDER BY delete_after, id LIMIT ${LEAD_PURGE_PAGE + 1}`;

type Cursor = { at: number; id: string };

/** Enqueues the leads due at `asOf` after `cursor`: at most one page, plus a scan message when more are due. Returns the counts. */
export async function enqueueDue(
  env: Env,
  asOf: number,
  cursor?: Cursor,
): Promise<{ queued: number; more: boolean }> {
  const { results } = await env.DB.prepare(SCAN_SQL)
    .bind(asOf, cursor?.at ?? -1, cursor?.id ?? "")
    .all<{ id: string; ref: string; at: number }>();
  const page = results.slice(0, LEAD_PURGE_PAGE);
  const more = results.length > LEAD_PURGE_PAGE;
  const last = page.at(-1);
  const dry = purgeMode(env) === "dry_run";
  // A dry run only counts: no per-lead message, so the same leads are not re-enqueued every day (the scan still walks the pages).
  const bodies: unknown[] = dry ? [] : page.map((r) => ({ kind: "lead.purge", leadId: r.id }));
  if (more && last)
    bodies.push({
      kind: "lead.purge.scan",
      asOf,
      cursor: { at: last.at, id: last.id },
    } satisfies LeadPurgeScanMessage);
  if (bodies.length) await env.LEADS_QUEUE.sendBatch(bodies.map((body) => ({ body })));
  const queued = dry ? 0 : page.length;
  logEvent(dry ? "lead.purge_dry_run_page" : "lead.purge_enqueued", {
    // A dry run is the report (owner, 2026-10-24): the refs it would delete, never a name or an address.
    ...(dry ? { due: page.length, refs: page.map((r) => r.ref).join(" ") } : { queued }),
    more,
    mode: dry ? "dry_run" : "live",
  });
  return { queued, more };
}

export const purgeMode = (env: Pick<Env, "LEAD_PURGE_MODE">): "live" | "dry_run" =>
  (env.LEAD_PURGE_MODE as string | undefined) === "live" ? "live" : "dry_run";

export type PurgeResult = "deleted" | "dry_run" | "skipped";

/** Deletes one lead if it is still due (or, in dry-run mode, only logs its reference). */
export async function purgeLead(env: Env, leadId: string, now = Date.now()): Promise<PurgeResult> {
  if (purgeMode(env) === "dry_run") {
    const row = await env.DB.prepare(`SELECT ref FROM leads WHERE id = ?1 AND ${DUE}`)
      .bind(leadId, now)
      .first<{ ref: string }>();
    if (!row) {
      logEvent("lead.purge_skipped", { mode: "dry_run" });
      return "skipped";
    }
    logEvent("lead.purge_dry_run", { ref: row.ref });
    return "dry_run";
  }

  const auditId = uuidv7();
  const audited = "EXISTS (SELECT 1 FROM audit_log WHERE id = ?1)";
  const [audit, , , refRow] = await env.DB.batch<{ ref: string }>([
    env.DB.prepare(
      `INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, summary)
       SELECT ?1, 'system', 'lead.purge', 'lead', id, json_object('ref', ref, 'reason', 'retention') FROM leads WHERE id = ?3 AND ${DUE}`,
    ).bind(auditId, now, leadId),
    env.DB.prepare(
      `DELETE FROM notifications WHERE entity_type = 'lead' AND entity_id = ?2 AND ${audited}`,
    ).bind(auditId, leadId),
    env.DB.prepare(`DELETE FROM leads WHERE id = ?2 AND ${audited}`).bind(auditId, leadId),
    // the reference for the log line, read in the same round trip
    env.DB.prepare("SELECT json_extract(summary, '$.ref') AS ref FROM audit_log WHERE id = ?1").bind(auditId),
  ]);
  if ((audit?.meta.changes ?? 0) === 0) {
    logEvent("lead.purge_skipped", { mode: "live" });
    return "skipped";
  }
  logEvent("lead.purged", { ref: refRow?.results[0]?.ref });
  return "deleted";
}
