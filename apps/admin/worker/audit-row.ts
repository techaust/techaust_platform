// The audit row written FIRST (M3.5): the same pattern as clients.ts's `auditRow`, for any entity type. The row is selected from the
// rows as they are now and only if every condition of the write holds (`where`), so the rest of the batch, guarded on this row,
// happens only then. Audit rows hold ids, codes, field names, dates, minutes and statuses, never a note's text.
import type { mutate } from "./context.ts";

type Who = Parameters<NonNullable<Parameters<typeof mutate>[1]["auditFirst"]>>[1];

const AUDIT_INSERT =
  "INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent, request_id)";

export type AuditFirstSpec = {
  /** Code, never input. */
  action: string;
  /** Code, never input. */
  entityType: string;
  /** An SQL expression (a placeholder or a column), evaluated against `from`. */
  entityExpr: string;
  /** An SQL expression, usually a `json_object(...)`, evaluated against `from`. */
  summaryExpr: string;
  /** `FROM table alias WHERE ...` or just `WHERE ...`: the conditions of the write. The caller's placeholders start at `?7`. */
  from: string;
  params: readonly unknown[];
};

/** `?1` id, `?2` actor, `?3` role, `?4` ip, `?5` user agent, `?6` request id; the caller's placeholders start at `?7`. */
export const auditFirstRow = (db: D1Database, auditId: string, who: Who, s: AuditFirstSpec) =>
  db
    .prepare(
      `${AUDIT_INSERT} SELECT ?1, 'staff', ?2, ?3, '${s.action}', '${s.entityType}', ${s.entityExpr}, ${s.summaryExpr}, ?4, ?5, ?6 ${s.from}`,
    )
    .bind(auditId, who.actor.id, who.actor.role, who.ip, who.ua, who.requestId, ...s.params);
