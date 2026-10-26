// The session guard and the route table [POR-02, POR-03, ADM-G-02's twin]. Deny by default: a route that isn't in
// ROUTES answers 404 at runtime (and a test proves every registered route is in the table and the reverse). Each row
// says who may call it: `public` (the handler does its own checks), `session` (any signed-in contact) or `finance`
// (a signed-in contact with finance access; anyone else gets the same 404 as for a thing that isn't theirs).
//
// One D1 read per guarded request: the session joined with its contact (and the organisation's name). The join is
// the revocation switch: a contact who loses portal access, is anonymised or is moved to another client no longer
// matches, so the next request is a 401 with no write at all.
import { checkSession, PORTAL_IDLE_MS, readPortalCookie, tokenHash } from "@techaust/auth";
import { createMiddleware } from "hono/factory";
import { type AppEnv, err, NOT_FOUND, type RouteDef, UNAUTHENTICATED } from "./context.ts";
import { issueScope } from "./scope.ts";

type Opts = { audit?: string; log?: boolean };
const R = (
  method: RouteDef["method"],
  path: string,
  access: RouteDef["access"],
  opts: Opts = {},
): RouteDef => ({ method, path: `/api/v1${path}`, access, ...opts });

export const ROUTES: readonly RouteDef[] = [
  R("GET", "/health", "public", { log: false }),
  // Sign-in: public, every one checks its own proof (a link, a cookie). Each is a sign-in event (Q1 = A).
  R("POST", "/auth/magic", "public"),
  R("POST", "/auth/magic/verify", "public", { audit: "portal.login" }),
  R("POST", "/auth/logout", "public", { audit: "portal.logout" }),
  // The signed-in contact's own session and identity.
  R("GET", "/me", "session"),
  R("POST", "/auth/sessions/revoke-all", "session", { audit: "portal.sessions_revoke_all" }),
  // A document link (POR-06): the token is in the body, never in the path or query.
  R("POST", "/t/document", "public", { audit: "doc_token.use" }),
  // Proposals and estimates (M4.5, POR-04, POR-05): the signed-in contact's offers. Each query is scoped to the session's organisation.
  R("GET", "/offers", "session"),
  R("GET", "/offers/:id", "session"),
  R("GET", "/offers/:id/pdf", "session"),
  R("GET", "/offers/:id/certificate", "session"),
  R("POST", "/offers/:id/accept", "session", { audit: "document.accept" }),
  R("POST", "/offers/:id/decline", "session", { audit: "document.decline" }),
  // An emailed offer link (M4.5, POR-06): the token is in the body; every one checks its own proof and counts a failure.
  R("POST", "/t/offer", "public", { audit: "offer_link.use" }),
  R("POST", "/t/offer/pdf", "public"),
  R("POST", "/t/offer/certificate", "public"),
  R("POST", "/t/offer/accept", "public", { audit: "document.accept" }),
  R("POST", "/t/offer/decline", "public", { audit: "document.decline" }),
];

/** The table row for a request, by method and the matched Hono pattern (`routePath`); undefined = not declared. */
export const tableOf = (rows: readonly RouteDef[]) => {
  const by = new Map(rows.map((r) => [`${r.method} ${r.path}`, r]));
  return (method: string, pattern: string) => by.get(`${method} ${pattern}`);
};
export const routeFor = tableOf(ROUTES);

/**
 * The guarded read (the plan test EXPLAINs it): the session joined with its live contact. `c.client_id = s.client_id`
 * keeps a session tied to the organisation it was created for; a moved contact stops matching.
 */
export const SESSION_READ =
  "SELECT s.last_seen_at, s.idle_expires_at, s.abs_expires_at, s.revoked_at, c.id AS contact_id, c.name, c.email, c.can_see_finance, cl.id AS client_id, cl.display_name FROM client_sessions s JOIN contacts c ON c.id = s.contact_id AND c.client_id = s.client_id JOIN clients cl ON cl.id = s.client_id WHERE s.id = ?1 AND c.portal_access = 1 AND c.anonymised_at IS NULL";

type SessionRow = {
  last_seen_at: number;
  idle_expires_at: number;
  abs_expires_at: number;
  revoked_at: number | null;
  contact_id: string;
  name: string;
  email: string;
  can_see_finance: number;
  client_id: string;
  display_name: string;
};

/** The 15-minute refresh of `last_seen_at`; the idle window can't pass the absolute end. `client_id` is bound like
 * every statement that touches a table with that column (the SQL spy test). */
export const TOUCH_SQL =
  "UPDATE client_sessions SET last_seen_at = ?2, idle_expires_at = min(?3, abs_expires_at) WHERE id = ?1 AND client_id = ?4";

export const guard = createMiddleware<AppEnv>(async (c, next) => {
  const row = c.var.route;
  if (!row) return err(c, NOT_FOUND, 404);
  if (row.access === "public") return next();

  // No cookie: 401 without touching the database (and no access row: a refused anonymous request, Q1 = A).
  const token = readPortalCookie(c.req.header("Cookie"));
  if (!token) return err(c, UNAUTHENTICATED, 401);
  const sessionId = await tokenHash(token);
  const s = await c.env.DB.prepare(SESSION_READ).bind(sessionId).first<SessionRow>();
  const t = Date.now();
  const state = s
    ? checkSession(
        {
          lastSeenAt: s.last_seen_at,
          idleExpiresAt: s.idle_expires_at,
          absExpiresAt: s.abs_expires_at,
          revokedAt: s.revoked_at,
        },
        t,
      )
    : { valid: false, touch: false };
  if (!s || !state.valid) return err(c, UNAUTHENTICATED, 401);

  c.set(
    "scope",
    issueScope({
      contactId: s.contact_id,
      clientId: s.client_id,
      canSeeFinance: s.can_see_finance === 1,
      sessionId,
    }),
  );
  c.set("who", { name: s.name, email: s.email, organisation: s.display_name });
  if (state.touch)
    c.set("touch", c.env.DB.prepare(TOUCH_SQL).bind(sessionId, t, t + PORTAL_IDLE_MS, s.client_id));

  // Finance for a contact without it: the plain 404 (the route's existence isn't revealed to them either).
  if (row.access === "finance" && s.can_see_finance !== 1) return err(c, NOT_FOUND, 404);
  return next();
});
