// Writers for the audit log and the security (access) log [ADM-G-06, ADM-AUD-01, NFR-9]. They return prepared
// statements, never run them: the caller puts them in its own `db.batch()` so a change and its log row commit
// together (or not at all). Used by the admin API now and the portal in M1.6.
//
// Guards: a log row that describes something that may not have happened (a session that was refused by a replay
// guard, a mutation whose conditional UPDATE matched nothing) is written with a guard in the same batch:
//   - a session id string (or { sessionId }): only if that staff session row exists,
//   - { auditId }: only if that audit row was written (the usual guard for the rest of a mutation's batch),
//   - "changes": only if the statement right before it changed at least one row (use it ONLY directly after the
//     statement it guards; D1 resets changes() with every statement),
//   - { sql, params }: a hand-written condition for the rare row that needs more than one (the new-device alert).
//
// All placeholders are NUMBERED (`?1`, `?2`…), never anonymous `?`: a guard's SQL is a function of the number its
// first bound value gets, so a caller can append it to a statement that already binds values.
//
// Subpath export (`@techaust/db/log`) so a Worker importing it doesn't pull in the Drizzle schema.
import { uuidv7 } from "@techaust/core/ids";

/** A condition and the values it binds; `sql(at)` numbers its first placeholder `?at`. */
export type GuardSql = { sql: (at: number) => string; params: readonly unknown[] };

export type Guard = string | { sessionId: string } | { auditId: string } | GuardSql | "changes";

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

const sessionLive = (id: string): GuardSql => ({
  sql: (at) => `EXISTS (SELECT 1 FROM staff_sessions WHERE id = ?${at})`,
  params: [id],
});

/** The condition (without WHERE) and its bound values for a guard. */
export function guardSql(guard: Guard): GuardSql {
  if (guard === "changes") return { sql: () => "changes() > 0", params: [] };
  if (typeof guard === "string") return sessionLive(guard);
  if ("sql" in guard) return guard;
  if ("sessionId" in guard) return sessionLive(guard.sessionId);
  return { sql: (at) => `EXISTS (SELECT 1 FROM audit_log WHERE id = ?${at})`, params: [guard.auditId] };
}

const AUDIT_COLUMNS =
  "id, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent, request_id";

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `?${i + 1}`).join(", ");

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
      .prepare(`INSERT INTO audit_log (${AUDIT_COLUMNS}) VALUES (${numbered(values.length)})`)
      .bind(...values);
  const g = guardSql(guard);
  return db
    .prepare(
      `INSERT INTO audit_log (${AUDIT_COLUMNS}) SELECT ${numbered(values.length)} WHERE ${g.sql(values.length + 1)}`,
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
      .prepare(`INSERT INTO access_log (${ACCESS_COLUMNS}) VALUES (${numbered(values.length)})`)
      .bind(...values);
  const g = guardSql(guard);
  return db
    .prepare(
      `INSERT INTO access_log (${ACCESS_COLUMNS}) SELECT ${numbered(values.length)} WHERE ${g.sql(values.length + 1)}`,
    )
    .bind(...values, ...g.params);
}
