// Writers for the audit log and the security (access) log [ADM-G-06, ADM-AUD-01, NFR-9]. They return prepared
// statements, never run them: the caller puts them in its own `db.batch()` so a change and its log row commit
// together (or not at all). Used by the admin API now and the portal in M1.6.
//
// Guards: a log row that describes something that may not have happened (a session that was refused by a replay
// guard, a mutation whose conditional UPDATE matched nothing) is written with a guard in the same batch:
//   - a session id string (or { sessionId }): only if that staff session row exists,
//   - { auditId }: only if that audit row was written (the usual guard for the rest of a mutation's batch),
//   - "changes": only if the statement right before it changed at least one row (use it ONLY directly after the
//     statement it guards; D1 resets changes() with every statement).
//
// Subpath export (`@techaust/db/log`) so a Worker importing it doesn't pull in the Drizzle schema.
import { uuidv7 } from "@techaust/core";

//   - { sql, params }: a hand-written condition for the rare row that needs more than one (the new-device alert).
export type Guard =
  | string
  | { sessionId: string }
  | { auditId: string }
  | { sql: string; params: readonly unknown[] }
  | "changes";

/** Who and where, copied onto every row; `ip` and `ua` serve security only (docs/08). */
export type RequestInfo = { requestId: string | null; ip: string | null; ua: string | null };

export type AuditEntry = RequestInfo & {
  /** Defaults to a new UUIDv7; give one when later statements of the batch refer to this row (`{ auditId }`). */
  id?: string;
  actorType?: "staff" | "contact" | "system" | "webhook";
  actorId: string | null;
  role: "owner" | "staff" | "sales" | "accountant" | null;
  action: string;
  entityType: string;
  entityId: string | null;
  /** A changed-fields summary with sensitive values already masked (`auditSummary` in core). */
  summary?: unknown;
};

export type AccessEntry = RequestInfo & {
  realm?: "admin" | "portal" | "jobs";
  /** NULL before sign-in. Never an email. */
  actorId: string | null;
  method: string;
  /** The route PATTERN (`/v1/users/:id`), never the raw path. */
  route: string;
  status: number;
};

/** The WHERE clause (without the keyword) and its bound values for a guard. */
export function guardSql(guard: Guard): { sql: string; params: readonly unknown[] } {
  if (guard === "changes") return { sql: "changes() > 0", params: [] };
  if (typeof guard === "string")
    return { sql: "EXISTS (SELECT 1 FROM staff_sessions WHERE id = ?)", params: [guard] };
  if ("sql" in guard) return guard;
  if ("sessionId" in guard)
    return { sql: "EXISTS (SELECT 1 FROM staff_sessions WHERE id = ?)", params: [guard.sessionId] };
  return { sql: "EXISTS (SELECT 1 FROM audit_log WHERE id = ?)", params: [guard.auditId] };
}

const AUDIT_COLUMNS =
  "id, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent, request_id";

export function auditStmt(db: D1Database, entry: AuditEntry, guard?: Guard): D1PreparedStatement {
  const values = [
    entry.id ?? uuidv7(),
    entry.actorType ?? "staff",
    entry.actorId,
    entry.role,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.summary === undefined ? null : JSON.stringify(entry.summary),
    entry.ip,
    entry.ua,
    entry.requestId,
  ];
  if (!guard)
    return db
      .prepare(`INSERT INTO audit_log (${AUDIT_COLUMNS}) VALUES (${values.map(() => "?").join(", ")})`)
      .bind(...values);
  const g = guardSql(guard);
  return db
    .prepare(
      `INSERT INTO audit_log (${AUDIT_COLUMNS}) SELECT ${values.map(() => "?").join(", ")} WHERE ${g.sql}`,
    )
    .bind(...values, ...g.params);
}

const ACCESS_COLUMNS = "id, realm, actor_id, method, route, status, ip, user_agent, request_id";

export function accessStmt(db: D1Database, entry: AccessEntry, guard?: Guard): D1PreparedStatement {
  const values = [
    uuidv7(),
    entry.realm ?? "admin",
    entry.actorId,
    entry.method,
    entry.route,
    entry.status,
    entry.ip,
    entry.ua,
    entry.requestId,
  ];
  if (!guard)
    return db
      .prepare(`INSERT INTO access_log (${ACCESS_COLUMNS}) VALUES (${values.map(() => "?").join(", ")})`)
      .bind(...values);
  const g = guardSql(guard);
  return db
    .prepare(
      `INSERT INTO access_log (${ACCESS_COLUMNS}) SELECT ${values.map(() => "?").join(", ")} WHERE ${g.sql}`,
    )
    .bind(...values, ...g.params);
}
