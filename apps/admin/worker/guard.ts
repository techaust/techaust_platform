// The session guard and the route table [ADM-G-02, ADM-AUTH-01, -05, -08]. Deny by default: a route that isn't in
// ROUTES answers 404 at runtime (and a test proves every registered route is in the table and the reverse).
// Each row says who may call it (`public` or a matrix action from core); `decide(role, action)` then answers
// allow / step-up / approval / deny. One D1 read per guarded request: the session joined with its user.
import { checkSession, readCookie, stepUpActive, tokenHash } from "@techaust/auth";
import { decide, isRole } from "@techaust/core/permissions";
import { createMiddleware } from "hono/factory";
import {
  type Actor,
  type AppEnv,
  err,
  FORBIDDEN,
  NOT_FOUND,
  type RouteDef,
  STEP_UP_REQUIRED,
  UNAUTHENTICATED,
} from "./context.ts";

type Opts = { audit?: string; log?: boolean | "refusals" };
const R = (
  method: RouteDef["method"],
  path: string,
  access: RouteDef["access"],
  opts: Opts = {},
): RouteDef => ({ method, path: `/api/v1${path}`, access, ...opts });

export const ROUTES: readonly RouteDef[] = [
  R("GET", "/health", "public", { log: false }),
  // Sign-in: public, every one checks its own credentials. /salt and /invite/start are lookups, not attempts.
  R("POST", "/auth/salt", "public", { log: "refusals" }),
  R("POST", "/auth/login", "public"),
  R("POST", "/auth/totp", "public"),
  R("POST", "/auth/recovery", "public"),
  R("POST", "/auth/logout", "public", { audit: "auth.logout" }),
  R("POST", "/auth/invite/start", "public", { log: "refusals" }),
  R("POST", "/auth/invite/finish", "public"),
  R("POST", "/auth/invite/totp", "public"),
  // The signed-in member's own account.
  R("GET", "/auth/me", "account.own"),
  R("POST", "/auth/step-up", "account.own", { audit: "auth.step_up" }),
  R("GET", "/auth/sessions", "account.own"),
  R("DELETE", "/auth/sessions/:id", "account.own", { audit: "auth.session_revoke" }),
  R("POST", "/auth/sessions/revoke-all", "account.own", { audit: "auth.session_revoke_all" }),
  R("POST", "/auth/recovery/regenerate", "account.recoveryCodes", { audit: "auth.recovery_regenerate" }),
  // Staff and invites (owner).
  R("GET", "/users", "users.read"),
  R("GET", "/users/invites", "users.read"),
  R("POST", "/users/invites", "users.manage", { audit: "user.invite" }),
  R("POST", "/users/invites/:tokenHash/revoke", "users.manage", { audit: "user.invite_revoke" }),
  R("POST", "/users/sessions/revoke-all", "users.manage", { audit: "user.sessions_revoke_all" }),
  R("PATCH", "/users/:id", "users.manage", { audit: "user.role_change" }),
  R("POST", "/users/:id/deactivate", "users.manage", { audit: "user.deactivate" }),
  R("POST", "/users/:id/reset-2fa", "users.manage", { audit: "user.reset_2fa" }),
  R("POST", "/users/:id/reactivate", "users.manage", { audit: "user.reactivate" }),
  // Settings (M3.1, ADM-SET-01..10). The generic groups name their audit action by group (`settings.<group>.update`); bank
  // details and gateways have their own rows because they need a fresh step-up (the matrix: bank.manage, gateways.manage).
  R("GET", "/settings", "settings.read"),
  R("GET", "/settings/groups/:group", "settings.read"),
  R("PUT", "/settings/groups/:group", "settings.manage", { audit: "settings.<group>.update" }),
  R("GET", "/settings/gateways", "settings.manage"),
  R("PUT", "/settings/gateways", "gateways.manage", { audit: "settings.gateways.update" }),
  R("GET", "/settings/bank", "bank.readMasked"),
  R("PUT", "/settings/bank/:kind", "bank.manage", { audit: "settings.bank.update" }),
  R("GET", "/settings/terms", "settings.manage"),
  R("GET", "/settings/terms/:block", "settings.manage"),
  R("POST", "/settings/terms/:block", "settings.manage", { audit: "settings.terms.update" }),
  R("POST", "/settings/email/test-send", "settings.manage", { audit: "settings.email.test_send" }),
  // The bell, the global search and the audit viewer (M3.1, ADM-G-09, ADM-G-05, ADM-AUD-02).
  R("GET", "/notifications", "notifications.own"),
  R("POST", "/notifications/read-all", "notifications.own", { audit: "notification.read_all" }),
  R("POST", "/notifications/:id/read", "notifications.own", { audit: "notification.read" }),
  R("GET", "/search", "search.use"),
  R("GET", "/audit", "audit.readFinance"),
];

const BY_ROUTE = new Map(ROUTES.map((r) => [`${r.method} ${r.path}`, r]));

/** The table row for a request, by method and the matched Hono pattern (`routePath`); undefined = not declared. */
export const routeFor = (method: string, pattern: string) => BY_ROUTE.get(`${method} ${pattern}`);

/** The guarded read, also used by the plan test: the session joined with its (active, enrolled) user. */
export const SESSION_READ =
  "SELECT s.last_seen_at, s.idle_expires_at, s.abs_expires_at, s.revoked_at, s.step_up_until, u.id, u.name, u.email, u.role FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id WHERE s.id = ?1 AND u.status = 'active' AND u.totp_enabled_at IS NOT NULL";

type SessionRow = {
  last_seen_at: number;
  idle_expires_at: number;
  abs_expires_at: number;
  revoked_at: number | null;
  step_up_until: number | null;
  id: string;
  name: string;
  email: string;
  role: string;
};

/** The 15-minute refresh of `last_seen_at`; the idle window can't pass the absolute end. */
export const TOUCH_SQL =
  "UPDATE staff_sessions SET last_seen_at = ?2, idle_expires_at = min(?3, abs_expires_at) WHERE id = ?1";
export const IDLE_REFRESH_MS = 12 * 60 * 60 * 1000;

export const guard = createMiddleware<AppEnv>(async (c, next) => {
  const row = c.var.route;
  if (!row) return err(c, NOT_FOUND, 404);
  if (row.access === "public") return next();

  // No cookie: 401 without touching the database.
  const token = readCookie(c.req.header("Cookie"));
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

  const user: Actor = {
    id: s.id,
    role: s.role as Actor["role"],
    sessionId,
    stepUpUntil: s.step_up_until,
    name: s.name,
    email: s.email,
  };
  c.set("user", user);
  if (state.touch) c.set("touch", c.env.DB.prepare(TOUCH_SQL).bind(sessionId, t, t + IDLE_REFRESH_MS));

  const decision = isRole(s.role) ? decide(s.role, row.access) : "deny";
  if (decision === "deny") return err(c, FORBIDDEN, 403);
  if (decision === "step-up" && !stepUpActive(s.step_up_until, t)) return err(c, STEP_UP_REQUIRED, 403);
  // "approval": the handler decides (no route needs it yet).
  return next();
});
