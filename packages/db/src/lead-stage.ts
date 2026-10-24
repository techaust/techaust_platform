// Stage automation (M3.2 decision 3, ADM-LEAD-02): the one function M4.2 (proposal sent) and M4.3 (proposal accepted) call.
// It returns statements for the caller's own `db.batch()`, so the stage move commits with the proposal change. The rule is in
// SQL (`stage IN (...)`), so a person's later manual stage (won, lost) is never overwritten, even with a stale read.
// Subpath export (`@techaust/db/lead-stage`) so a Worker importing it doesn't pull in the Drizzle schema.
import { uuidv7 } from "@techaust/core/ids";
import { PROPOSAL_EVENT_RULES, type ProposalEvent, touchLeadSql } from "@techaust/core/lead-lifecycle";

/**
 * The statements for the lead linked to a proposal (`leads.proposal_id = documentId`): move the stage forward if the rule
 * allows it, then, only if it moved, one timeline row (actor none: the system did it). Nothing happens when the document is
 * not linked to a lead or the lead is already further along.
 */
export function proposalEventStatements(
  db: D1Database,
  documentId: string,
  event: ProposalEvent,
  t: number = Date.now(),
): D1PreparedStatement[] {
  const rule = PROPOSAL_EVENT_RULES[event];
  const from = rule.from.map((_, i) => `?${i + 4}`).join(", ");
  return [
    db
      .prepare(
        `UPDATE leads SET stage = ?1, lost_reason = NULL, updated_at = ?2, ${touchLeadSql("?2")} WHERE proposal_id = ?3 AND stage IN (${from})`,
      )
      .bind(rule.to, t, documentId, ...rule.from),
    db
      .prepare(
        `INSERT INTO lead_activities (id, lead_id, kind, body, actor_id, created_at)
         SELECT ?1, id, 'stage', 'Stage set to ' || ?2 || ' (' || ?3 || ')', NULL, ?4 FROM leads WHERE proposal_id = ?5 AND stage = ?2 AND updated_at = ?4 AND changes() > 0`,
      )
      .bind(
        uuidv7(),
        rule.to,
        event === "proposal_sent" ? "proposal sent" : "proposal accepted",
        t,
        documentId,
      ),
  ];
}
