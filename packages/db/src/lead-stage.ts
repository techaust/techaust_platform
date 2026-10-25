// Stage automation (M3.2 decision 3, ADM-LEAD-02): the one function M4.3 (proposal sent) and M4.5 (proposal accepted) call.
// It returns statements for the caller's own `db.batch()`, so the stage move commits with the proposal change. The rule is in
// SQL (`stage IN (...)`), so a person's later manual stage (won, lost) is never overwritten, even with a stale read.
// Subpath export (`@techaust/db/lead-stage`) so a Worker importing it doesn't pull in the Drizzle schema.
import { uuidv7 } from "@techaust/core/ids";
import { PROPOSAL_EVENT_RULES, type ProposalEvent, touchLeadSql } from "@techaust/core/lead-lifecycle";
import type { GuardSql } from "./log.ts";

/**
 * The statements for the lead linked to a proposal group (`leads.proposal_id = groupId`, the id of version 1): move the stage forward
 * if the rule allows it, then, only if it moved, one timeline row (actor none: the system did it). Nothing happens when the document
 * is not linked to a lead or the lead is already further along.
 *
 * `g` (M4.3): the caller's guard, usually `{ auditId }` of the request's audit row, appended to BOTH statements. A send that changed
 * nothing (a stale one, a refused one) writes no audit row, so it cannot move a lead either. Without it the statements run
 * unconditionally (the M3.2 shape).
 *
 * `lostReason` (M4.5): required when the event moves the lead to `lost` (a client's decline); it is the lead's `lost_reason`. Any other
 * move clears it, as before.
 */
export function proposalEventStatements(
  db: D1Database,
  groupId: string,
  event: ProposalEvent,
  t: number = Date.now(),
  g?: GuardSql,
  lostReason: string | null = null,
): D1PreparedStatement[] {
  const rule = PROPOSAL_EVENT_RULES[event];
  const from = rule.from.map((_, i) => `?${i + 4}`).join(", ");
  const guardAt = rule.from.length + 4;
  if ((rule.to === "lost") !== (lostReason !== null))
    throw new Error("proposalEventStatements: a lost reason goes with, and only with, a move to lost");
  const reasonAt = guardAt + (g?.params.length ?? 0);
  return [
    db
      .prepare(
        `UPDATE leads SET stage = ?1, lost_reason = ${lostReason === null ? "NULL" : `?${reasonAt}`}, updated_at = ?2, ${touchLeadSql("?2")} WHERE proposal_id = ?3 AND stage IN (${from})${g ? ` AND ${g.sql(guardAt)}` : ""}`,
      )
      .bind(
        rule.to,
        t,
        groupId,
        ...rule.from,
        ...(g?.params ?? []),
        ...(lostReason === null ? [] : [lostReason]),
      ),
    db
      .prepare(
        `INSERT INTO lead_activities (id, lead_id, kind, body, actor_id, created_at)
         SELECT ?1, id, 'stage', 'Stage set to ' || ?2 || ' (' || ?3 || ')', NULL, ?4 FROM leads WHERE proposal_id = ?5 AND stage = ?2 AND updated_at = ?4 AND changes() > 0${g ? ` AND ${g.sql(6)}` : ""}`,
      )
      .bind(
        uuidv7(),
        rule.to,
        event === "proposal_sent"
          ? "proposal sent"
          : event === "proposal_accepted"
            ? "proposal accepted"
            : "proposal declined",
        t,
        groupId,
        ...(g?.params ?? []),
      ),
  ];
}
