// Client scoping [POR-03, LD8]: the ONLY way a portal route learns which organisation it serves is the session. The
// guard (guard.ts) reads the session row and issues one opaque `ClientScope`; handlers get it with `scope(c)` and
// never read a client or contact id from the query, the body or a header (a test sends all three and proves they are
// ignored). Everything below exists so that forgetting the scope is hard and visible:
//
//   - `ClientScope` can't be built outside this file except through `issueScope`, which only guard.ts imports (a
//     test scans the sources), and `scope(c)` refuses a value the guard didn't issue.
//   - `forClient(db, scope, sql, ...params)` binds `?1` to the scope's client and refuses SQL that doesn't say
//     `client_id = ?1` (or `alias.client_id = ?1`), so a query can't be written without the filter. This is a guard
//     against forgetting, not a SQL parser: the SQL spy and cross-tenant tests are the proof.
//   - A thing that isn't yours is `notFound(c)`: the same 404 body as a thing that doesn't exist, so ids can't be
//     probed. A finance-only route for a contact without finance access is the same 404.
//
// RULE FOR TABLES WITHOUT `client_id` (milestones, document_lines, payment_schedules, ...): reach them ONLY through a
// join to a scoped parent that carries the filter (e.g. `... FROM document_lines l JOIN documents d ON d.id =
// l.document_id WHERE d.client_id = ?1 AND ...`). Never select from such a table by its own id alone. M4.5 and M7.1
// follow this; the cross-tenant harness (test-helpers `crossTenant`) is how a new route proves it.
//
// Portal SQL never names a `staff_` table (a source scan enforces it): the portal has no business with staff data.
import { HTTPException } from "hono/http-exception";
import { type Ctx, err, NOT_FOUND } from "./context.ts";

declare const brand: unique symbol;

/** The signed-in contact and organisation, from the session. Opaque: build one only through `issueScope`. */
export type ClientScope = Readonly<{
  contactId: string;
  clientId: string;
  canSeeFinance: boolean;
  /** SHA-256 of the session token (the `client_sessions` row id). */
  sessionId: string;
}> & { readonly [brand]: true };

const issued = new WeakSet<object>();

/** Guard only (a test checks that no other file imports this). */
export function issueScope(v: {
  contactId: string;
  clientId: string;
  canSeeFinance: boolean;
  sessionId: string;
}): ClientScope {
  const s = Object.freeze({ ...v }) as unknown as ClientScope;
  issued.add(s);
  return s;
}

/** The scope of a guarded route. Throws if the route has no session (a route declared `public` must not call it). */
export function scope(c: Ctx): ClientScope {
  const s = c.var.scope;
  if (!s || !issued.has(s)) throw new Error("scope() called on a route without a session");
  return s;
}

const SCOPED = /\bclient_id\s*=\s*\?1(?!\d)/;

/**
 * A prepared statement for this organisation: `?1` is the scope's client id, `params` are `?2`, `?3`... The SQL must
 * contain `client_id = ?1` (or `x.client_id = ?1`), else this throws before anything reaches the database.
 */
export function forClient(db: D1Database, s: ClientScope, sql: string, ...params: unknown[]) {
  if (!SCOPED.test(sql)) throw new Error("a client-scoped query must say `client_id = ?1`");
  return db.prepare(sql).bind(s.clientId, ...params);
}

/** A finance-only handler calls this first; a contact without finance access gets the plain 404. */
export function requireFinance(s: ClientScope): void {
  if (!s.canSeeFinance) throw new HTTPException(404);
}

/** The 404 for a thing that isn't this organisation's: identical to a thing that doesn't exist. */
export const notFound = (c: Ctx) => err(c, NOT_FOUND, 404);
