// Lead retention clean-up (M3.2, ADM-LEAD-05, JOB-CRON-01). VERIFY WITH CA/LEGAL (DPDP retention).
//   cron (daily 22:00 UTC = 03:30 IST) -> `enqueueDue`: ONLY enqueues. One page of at most LEAD_PURGE_PAGE due leads, one
//     `lead.purge` message each on the existing leads queue; if more are due, one `lead.purge.scan` message carries the
//     keyset cursor on to the next page (consumer-driven, so no invocation does more than one page).
//   consumer -> `purgeLead`: one lead per message. It re-checks the conditions in SQL (not converted, no legal hold,
//     `delete_after` passed: a lead that got an activity after it was enqueued has a later date and is left alone), then in ONE
//     db.batch() writes the audit row (lead id and ref only, no personal data) and deletes the bell rows and the lead
//     (`lead_activities` cascade, `duplicate_of` links are set to NULL by the foreign key). A redelivery finds nothing to do.
//   LEAD_PURGE_MODE: anything but "live" is a dry run: the lead reference that would be deleted is logged, nothing is deleted.
import { LEAD_PURGE_PAGE, type LeadPurgeScanMessage, uuidv7 } from "@techaust/core";
import { logEvent } from "./log.ts";

/** The cron expression of wrangler.jsonc that triggers the clean-up. */
export const PURGE_CRON = "0 22 * * *";

/** The conditions of a due lead (`?1` is the lead id, `?2` the time). */
const DUE = "delete_after IS NOT NULL AND delete_after <= ?2 AND client_id IS NULL AND legal_hold = 0";

type Cursor = { at: number; id: string };

/** Enqueues the leads due at `asOf` after `cursor`: at most one page, plus a scan message when more are due. Returns the counts. */
export async function enqueueDue(
  env: Env,
  asOf: number,
  cursor?: Cursor,
): Promise<{ queued: number; more: boolean }> {
  const { results } = await env.DB.prepare(
    `SELECT id, delete_after AS at FROM leads WHERE delete_after <= ?1 AND client_id IS NULL AND legal_hold = 0 AND (delete_after > ?2 OR (delete_after = ?2 AND id > ?3)) ORDER BY delete_after, id LIMIT ${LEAD_PURGE_PAGE + 1}`,
  )
    .bind(asOf, cursor?.at ?? -1, cursor?.id ?? "")
    .all<{ id: string; at: number }>();
  const page = results.slice(0, LEAD_PURGE_PAGE);
  const more = results.length > LEAD_PURGE_PAGE;
  const last = page.at(-1);
  const bodies: unknown[] = page.map((r) => ({ kind: "lead.purge", leadId: r.id }));
  if (more && last)
    bodies.push({
      kind: "lead.purge.scan",
      asOf,
      cursor: { at: last.at, id: last.id },
    } satisfies LeadPurgeScanMessage);
  if (bodies.length) await env.LEADS_QUEUE.sendBatch(bodies.map((body) => ({ body })));
  logEvent("lead.purge_enqueued", { queued: page.length, more, mode: purgeMode(env) });
  return { queued: page.length, more };
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
  const [audit] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, summary)
       SELECT ?1, 'system', 'lead.purge', 'lead', id, json_object('ref', ref, 'reason', 'retention') FROM leads WHERE id = ?3 AND ${DUE}`,
    ).bind(auditId, now, leadId),
    env.DB.prepare(
      `DELETE FROM notifications WHERE entity_type = 'lead' AND entity_id = ?2 AND ${audited}`,
    ).bind(auditId, leadId),
    env.DB.prepare(`DELETE FROM leads WHERE id = ?2 AND ${audited}`).bind(auditId, leadId),
  ]);
  if ((audit?.meta.changes ?? 0) === 0) {
    logEvent("lead.purge_skipped", { mode: "live" });
    return "skipped";
  }
  const ref = await env.DB.prepare(
    "SELECT json_extract(summary, '$.ref') AS ref FROM audit_log WHERE id = ?1",
  )
    .bind(auditId)
    .first<{ ref: string }>();
  logEvent("lead.purged", { ref: ref?.ref });
  return "deleted";
}
