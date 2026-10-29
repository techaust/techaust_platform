// The expiry of proposals and estimates (M4.3 item 9, JOB-CRON-01, ADM-PROP-06). Researched 2026-10-29, Contract Act s.6(2) (08-C RB-35): the
// offer lapses after the date it prescribes; a new version is a new offer.
//   cron (daily 22:00 UTC = 03:30 IST) -> `enqueueStats` adds ONE `documents.expire` message (the IST date of the run) to its existing
//     LEADS_QUEUE `sendBatch`. The cron reads no D1 for it.
//   consumer -> `processExpire`: ONE page per message. It picks at most 50 ids of sent or viewed proposals and estimates whose `valid_until`
//     is before `asOf` (`documents_status_valid_until`, then the ids after the cursor), then in ONE `db.batch()` writes an audit row for
//     each (system actor; ids, type, version, number and dates only) and moves them to `expired`, both with the conditions repeated, so a
//     document that was accepted, revised or already expired since the pick is left alone and gets no row. Exactly 50 picked -> a
//     continuation message `{after: <last id>}`. A rerun or a redelivery finds nothing left to do.
//   A document is acceptable through its `valid_until` day, so `valid_until = asOf` is NOT expired.
import { EXPIRE_PAGE, type ExpireMessage } from "@techaust/core/expiry";
import { uuidv7 } from "@techaust/core/ids";
import { logEvent } from "./log.ts";

/** The conditions of a due offer, written once (`?2` is `asOf`). */
const due = (t: string) =>
  `${t}status IN ('sent', 'viewed') AND ${t}type IN ('proposal', 'estimate') AND ${t}valid_until < ?2`;

/** The pick, exported so a test can EXPLAIN it: `?1` the cursor (an id; empty for the first page), `?2` `asOf`. It must use `documents_status_valid_until`. */
export const PICK_SQL = `SELECT id FROM documents INDEXED BY documents_status_valid_until WHERE ${due("")} AND id > ?1 ORDER BY id LIMIT ${EXPIRE_PAGE}`;

/** The audit rows (`?1` the `[auditId, documentId]` pairs as JSON, `?2` `asOf`). Written before the update, so each row is for a document still due. */
export const AUDIT_SQL = `INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, summary)
  SELECT json_extract(j.value, '$[0]'), 'system', 'document.expire', 'document', d.id,
    json_object('documentId', d.id, 'type', d.type, 'version', d.version, 'number', d.number_display, 'validUntil', d.valid_until, 'asOf', ?2)
  FROM json_each(?1) j CROSS JOIN documents d ON d.id = json_extract(j.value, '$[1]')
  WHERE d.status IN ('sent', 'viewed') AND d.type IN ('proposal', 'estimate') AND d.valid_until < ?2`;

/**
 * The move to `expired` (`?1` the pairs as JSON, `?2` `asOf`). The conditions are repeated; the flow trigger allows sent or viewed -> expired.
 * The unary plus keeps the planner from walking the whole due set by `documents_status_valid_until`: it finds each document by its id.
 */
export const EXPIRE_SQL = `UPDATE documents SET status = 'expired' FROM json_each(?1) j WHERE documents.id = json_extract(j.value, '$[1]') AND ${due("+documents.")}`;

export type ExpireResult = { picked: number; expired: number; continued: boolean };

/** Handles one `documents.expire` message (a valid one: the queue routes the rest to `skipExpire`). */
export async function processExpire(env: Env, msg: ExpireMessage): Promise<ExpireResult> {
  const { results } = await env.DB.prepare(PICK_SQL)
    .bind(msg.after ?? "", msg.asOf)
    .all<{ id: string }>();
  const ids = results.map((r) => r.id);
  let expired = 0;
  if (ids.length > 0) {
    const pairs = JSON.stringify(ids.map((id) => [uuidv7(), id]));
    const [, update] = await env.DB.batch([
      env.DB.prepare(AUDIT_SQL).bind(pairs, msg.asOf),
      env.DB.prepare(EXPIRE_SQL).bind(pairs, msg.asOf),
    ]);
    expired = update?.meta.changes ?? 0;
  }
  const last = ids.at(-1);
  // The continuation goes after the page is written: a redelivery that finds the page already done writes nothing again.
  const continued = ids.length === EXPIRE_PAGE && last !== undefined;
  if (continued) await env.LEADS_QUEUE.sendBatch([{ body: { ...msg, after: last } satisfies ExpireMessage }]);
  logEvent("documents.expire", { asOf: msg.asOf, picked: ids.length, expired, more: continued });
  return { picked: ids.length, expired, continued };
}

/** A `documents.expire` body this version cannot use (a bad date, a bad cursor): acknowledged and logged, never a lead. */
export function skipExpire(): void {
  logEvent("documents.expire_unknown");
}

/** An expiry message that ran out of tries: tomorrow's run picks the same offers up again; no alert and no retry. */
export function logExpireDeadLetter(queue: string): void {
  logEvent("documents.expire_dead_letter", { queue });
}
