// Writers for the audit log and the security (access) log [ADM-G-06, ADM-AUD-01, NFR-9]. They return prepared
// statements, never run them: the caller puts them in its own `db.batch()` so a change and its log row commit
// together (or not at all). Used by the admin API (M1.5) and the portal API (M1.6).
//
// Guards: a log row that describes something that may not have happened (a session that was refused by a replay
// guard, a mutation whose conditional UPDATE matched nothing) is written with a guard in the same batch:
//   - a session id string (or { sessionId }): only if that staff session row exists,
//   - { clientSessionId }: only if that portal (client) session row exists (M1.6),
//   - { auditId }: only if that audit row was written (the usual guard for the rest of a mutation's batch),
//   - "changes": only if the statement right before it changed at least one row (use it ONLY directly after the
//     statement it guards; D1 resets changes() with every statement),
//   - { sql, params }: a hand-written condition for the rare row that needs more than one (the new-device alert).
//
// Who: `actorId` is bound as given. Right after a portal sign-in nobody knows the contact's id yet (the session row
// was made from the link in the same batch), so `actorFromClientSession` takes the actor from that session row
// instead (a subquery; NULL if the row doesn't exist). Audit rows then carry `actorType: "contact"` and `role: null`.
//
// All placeholders are NUMBERED (`?1`, `?2`…), never anonymous `?`: a guard's SQL is a function of the number its
// first bound value gets, so a caller can append it to a statement that already binds values.
//
// Subpath export (`@techaust/db/log`) so a Worker importing it doesn't pull in the Drizzle schema.
import { uuidv7 } from "@techaust/core/ids";

/** A condition and the values it binds; `sql(at)` numbers its first placeholder `?at`. */
export type GuardSql = { sql: (at: number) => string; params: readonly unknown[] };

export type Guard =
  | string
  | { sessionId: string }
  | { clientSessionId: string }
  | { auditId: string }
  | GuardSql
  | "changes";

/** Who and where, copied onto every row; `ip` and `ua` serve security only (docs/08). */
export type RequestInfo = { requestId: string | null; ip: string | null; ua: string | null };

export type AuditEntry = RequestInfo & {
  /** Defaults to a new UUIDv7; give one when later statements of the batch refer to this row (`{ auditId }`). */
  id?: string;
  actorType?: "staff" | "contact" | "system" | "webhook";
  actorId: string | null;
  /** Instead of `actorId`: the contact of this portal session (see the header). */
  actorFromClientSession?: string;
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
  /** Instead of `actorId`: the contact of this portal session (see the header). */
  actorFromClientSession?: string;
  method: string;
  /** The route PATTERN (`/v1/users/:id`), never the raw path. */
  route: string;
  status: number;
};

const sessionLive = (id: string): GuardSql => ({
  sql: (at) => `EXISTS (SELECT 1 FROM staff_sessions WHERE id = ?${at})`,
  params: [id],
});

const clientSessionLive = (id: string): GuardSql => ({
  sql: (at) => `EXISTS (SELECT 1 FROM client_sessions WHERE id = ?${at})`,
  params: [id],
});

/** The contact of a portal session as an expression of the statement's own placeholder `?at`. */
const clientSessionActor = (at: number) => `(SELECT contact_id FROM client_sessions WHERE id = ?${at})`;

/** The condition (without WHERE) and its bound values for a guard. */
export function guardSql(guard: Guard): GuardSql {
  if (guard === "changes") return { sql: () => "changes() > 0", params: [] };
  if (typeof guard === "string") return sessionLive(guard);
  if ("sql" in guard) return guard;
  if ("sessionId" in guard) return sessionLive(guard.sessionId);
  if ("clientSessionId" in guard) return clientSessionLive(guard.clientSessionId);
  return { sql: (at) => `EXISTS (SELECT 1 FROM audit_log WHERE id = ?${at})`, params: [guard.auditId] };
}

const AUDIT_COLUMNS =
  "id, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent, request_id";

/**
 * One log-row INSERT. `values` are bound as ?1..?n in column order; with `fromSession` the actor column (index
 * `actorAt`) is a subquery on the portal session instead (that value's placeholder stays unused), and with a guard
 * the row is a `SELECT ... WHERE <guard>`, so it is written only if the guard holds.
 */
function insertLog(
  db: D1Database,
  table: string,
  columns: string,
  values: unknown[],
  actorAt: number,
  fromSession: string | undefined,
  guard: Guard | undefined,
): D1PreparedStatement {
  const slots = values.map((_, i) => `?${i + 1}`);
  const extra: unknown[] = [];
  let next = values.length + 1;
  if (fromSession !== undefined) {
    slots[actorAt] = clientSessionActor(next++);
    extra.push(fromSession);
  }
  if (!guard && fromSession === undefined)
    return db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${slots.join(", ")})`).bind(...values);
  const g = guard ? guardSql(guard) : undefined;
  const where = g ? ` WHERE ${g.sql(next)}` : "";
  return db
    .prepare(`INSERT INTO ${table} (${columns}) SELECT ${slots.join(", ")}${where}`)
    .bind(...values, ...extra, ...(g?.params ?? []));
}

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
  return insertLog(db, "audit_log", AUDIT_COLUMNS, values, 2, entry.actorFromClientSession, guard);
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
  return insertLog(db, "access_log", ACCESS_COLUMNS, values, 2, entry.actorFromClientSession, guard);
}
