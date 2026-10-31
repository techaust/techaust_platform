// A change made by the system, with nobody signed in (M5.4, LD57, LD58): the recurring care invoices run in the admin finance Worker (the admin API Worker before M6.1) behind the `BillingJobs` entrypoint, called by
// the jobs Worker. `mutateSystem` is `mutate` (context.ts) without a request: ONE D1 batch = the conditional statements, then an audit row written only if the last of them
// changed a row (actor type `system`, actor NULL, no role, no address), then the side statements (each guarded on that audit row). There is no access-log row: it records a
// request, and there is none. The audit row is the record of what the system did and why (ids, codes, totals; never a name or an address).
import { uuidv7 } from "@techaust/core/ids";
import { auditStmt, type GuardSql, guardSql } from "@techaust/db/log";

export type SystemMutation = {
  /** The conditional statement(s); the LAST one decides (the audit row follows it with `changes() > 0`). None: always written. */
  main?: D1PreparedStatement | D1PreparedStatement[];
  action: string;
  entityType: string;
  entityId: string | null;
  summary?: unknown;
  /** Further statements: bind `...g.params` after your own values and use `g.sql(n)`, n = the number of that first placeholder. */
  side?: (g: GuardSql, auditId: string) => D1PreparedStatement[];
  /** Called with every statement's result and the index of the audit statement (the side statements follow it, in order). */
  onResults?: (results: D1Result[], auditAt: number) => void;
};

/** Runs the batch. True when the audit row was written, meaning the main statement changed a row and the side statements ran. */
export async function mutateSystem(env: { DB: D1Database }, m: SystemMutation): Promise<boolean> {
  const db = env.DB;
  const auditId = uuidv7();
  const g = guardSql({ auditId });
  const mains = m.main === undefined ? [] : Array.isArray(m.main) ? m.main : [m.main];
  const stmts: D1PreparedStatement[] = [...mains];
  const auditAt = stmts.length;
  stmts.push(
    auditStmt(
      db,
      {
        id: auditId,
        actorType: "system",
        actorId: null,
        role: null,
        requestId: null,
        ip: null,
        ua: null,
        action: m.action,
        entityType: m.entityType,
        entityId: m.entityId,
        summary: m.summary,
      },
      mains.length ? "changes" : undefined,
    ),
  );
  stmts.push(...(m.side?.(g, auditId) ?? []));
  const results = await db.batch(stmts);
  m.onResults?.(results, auditAt);
  return results[auditAt]?.meta.changes === 1;
}
