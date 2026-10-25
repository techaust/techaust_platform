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

type Opts = { audit?: string; log?: boolean | "refusals"; body?: "upload" | "large" | "document" };
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
  // The signature image (M4.4, ADM-SET-01): a raw binary upload of up to 256 KB; the image streams back for the preview.
  R("GET", "/settings/signature", "settings.manage"),
  R("PUT", "/settings/signature", "settings.manage", { audit: "settings.signature.update", body: "upload" }),
  R("DELETE", "/settings/signature", "settings.manage", { audit: "settings.signature.delete" }),
  R("POST", "/settings/email/test-send", "settings.manage", { audit: "settings.email.test_send" }),
  // Leads (M3.2, ADM-LEAD-01..06). Converting also needs proposals.draft (checked in the handler).
  R("GET", "/leads", "leads.read"),
  R("GET", "/leads/board", "leads.read"),
  R("GET", "/leads/assignees", "leads.read"),
  R("POST", "/leads", "leads.write", { audit: "lead.create" }),
  R("GET", "/leads/:id", "leads.read"),
  R("GET", "/leads/:id/activities", "leads.read"),
  R("PATCH", "/leads/:id", "leads.write", { audit: "lead.update" }),
  R("POST", "/leads/:id/notes", "leads.write", { audit: "lead.note" }),
  R("POST", "/leads/:id/stage", "leads.write", { audit: "lead.stage" }),
  R("GET", "/leads/:id/reply-templates", "leads.read"),
  R("POST", "/leads/:id/reply", "leads.write", { audit: "lead.reply" }),
  R("POST", "/leads/:id/convert", "clients.write", { audit: "lead.convert" }),
  // Clients and contacts (M3.3, ADM-CLI-01..05). Billing fields are `clients.finance.write`; a contact is erased or anonymised only
  // by the owner with a fresh step-up (the audit action is `contact.anonymise` when the mode is anonymise).
  R("GET", "/clients", "clients.read"),
  R("POST", "/clients", "clients.write", { audit: "client.create" }),
  R("GET", "/clients/:id", "clients.read"),
  R("PATCH", "/clients/:id", "clients.write", { audit: "client.update" }),
  R("PATCH", "/clients/:id/billing", "clients.finance.write", { audit: "client.billing_update" }),
  R("GET", "/clients/:id/finance", "clients.finance.read"),
  R("GET", "/clients/:id/statement", "clients.finance.read"),
  R("GET", "/clients/:id/activity", "clients.read"),
  R("GET", "/clients/:id/contacts", "clients.read"),
  R("POST", "/clients/:id/contacts", "clients.write", { audit: "contact.create" }),
  R("PATCH", "/contacts/:id", "clients.write", { audit: "contact.update" }),
  R("POST", "/contacts/:id/export", "clients.dataExport", { audit: "contact.export" }),
  R("POST", "/contacts/:id/erase", "clients.dataErase", { audit: "contact.erase" }),
  // Projects, milestones, notes and files (M3.4, ADM-PRJ-01..05). The client page's tabs are the /clients/:id/... rows. Uploads are
  // raw binary bodies (`body: "upload"`); downloads are streamed through the session and appear in the access log.
  R("GET", "/projects", "projects.read"),
  R("POST", "/projects", "projects.write", { audit: "project.create" }),
  R("GET", "/projects/:id", "projects.read"),
  R("PATCH", "/projects/:id", "projects.write", { audit: "project.update" }),
  R("POST", "/projects/:id/status", "projects.write", { audit: "project.status" }),
  R("POST", "/projects/:id/milestones", "projects.write", { audit: "milestone.create" }),
  R("POST", "/projects/:id/milestones/order", "projects.write", { audit: "milestone.reorder" }),
  R("PATCH", "/milestones/:id", "projects.write", { audit: "milestone.update" }),
  R("POST", "/milestones/:id/status", "projects.write", { audit: "milestone.status" }),
  R("DELETE", "/milestones/:id", "projects.write", { audit: "milestone.delete" }),
  R("GET", "/projects/:id/notes", "projects.read"),
  R("POST", "/projects/:id/notes", "projects.write", { audit: "note.create" }),
  R("GET", "/projects/:id/files", "projects.read"),
  R("POST", "/projects/:id/files", "projects.write", { audit: "file.upload", body: "upload" }),
  R("GET", "/clients/:id/projects", "projects.read"),
  R("GET", "/clients/:id/notes", "projects.read"),
  R("POST", "/clients/:id/notes", "projects.write", { audit: "note.create" }),
  R("GET", "/clients/:id/files", "projects.read"),
  R("POST", "/clients/:id/files", "projects.write", { audit: "file.upload", body: "upload" }),
  R("PATCH", "/notes/:id", "projects.write", { audit: "note.update" }),
  R("DELETE", "/notes/:id", "projects.write", { audit: "note.delete" }),
  R("PATCH", "/files/:id", "projects.write", { audit: "file.share" }),
  R("DELETE", "/files/:id", "projects.write", { audit: "file.delete" }),
  R("GET", "/files/:id/download", "projects.read"),
  // Care plans, time logs and the dashboard (M3.5, ADM-CARE-01, -03, ADM-TIME-01..03, ADM-DASH-01). Static paths come before `/:id`.
  // Price changes are the owner's (`carePlans.changePrice`); the handler also holds cancelling to the owner. Time routes scope to the
  // member's own entries unless the role has `time.readAll`; logging for someone else needs `time.writeAny` (checked in the handler).
  R("GET", "/care-plans", "carePlans.read"),
  R("GET", "/care-plans/defaults", "carePlans.write"),
  R("POST", "/care-plans", "carePlans.write", { audit: "care_plan.create" }),
  R("GET", "/care-plans/:id", "carePlans.read"),
  R("POST", "/care-plans/:id/terms", "carePlans.changePrice", { audit: "care_plan.terms" }),
  R("POST", "/care-plans/:id/status", "carePlans.write", { audit: "care_plan.status" }),
  R("GET", "/clients/:id/care-plans", "carePlans.read"),
  R("GET", "/time", "time.read"),
  R("GET", "/time/week", "time.read"),
  R("GET", "/time/targets", "time.writeOwn"),
  R("GET", "/time/people", "time.read"),
  R("POST", "/time", "time.writeOwn", { audit: "time.create" }),
  R("PATCH", "/time/:id", "time.writeOwn", { audit: "time.update" }),
  R("DELETE", "/time/:id", "time.writeOwn", { audit: "time.delete" }),
  R("GET", "/dashboard", "dashboard.read"),
  // Catalogue, templates and publishing (M4.1, ADM-CAT-01..05). Static paths (`snapshots`, `publish`) are declared before `:id`.
  R("GET", "/catalogue", "catalogue.read"),
  R("GET", "/catalogue/snapshots", "catalogue.read"),
  R("POST", "/catalogue/publish", "catalogue.publish", { audit: "catalogue.publish" }),
  // A service with all its texts and lines can pass 16 KB (its fields allow about 21 KB of plain text), so the saves take 32 KB.
  R("POST", "/catalogue", "catalogue.write", { audit: "catalogue.create", body: "large" }),
  R("GET", "/catalogue/:id", "catalogue.read"),
  R("PATCH", "/catalogue/:id", "catalogue.write", { audit: "catalogue.update", body: "large" }),
  // The audit action is `catalogue.activate` or `catalogue.deactivate`, by the request.
  R("POST", "/catalogue/:id/active", "catalogue.write", { audit: "catalogue.activate" }),
  R("GET", "/templates", "catalogue.read"),
  R("GET", "/templates/:id", "catalogue.read"),
  // A template body is up to 12,000 characters, which passes 16 KB once it holds a few multi-byte characters (the rupee sign).
  R("POST", "/templates", "catalogue.write", { audit: "template.version", body: "large" }),
  // Proposals, estimates and approvals (M4.3, ADM-PROP-01..07, ADM-EST-01/02, ADM-APR-01/02). One code path for both types. Sending is
  // `proposals.send`: Staff and Sales pass the guard and the handler decides by the discount (403 `approval_required`). A save is up to
  // 96 KB (`body: "document"`). Converting an accepted estimate makes an invoice draft (`invoices.draft`).
  R("GET", "/documents", "proposals.read"),
  R("POST", "/documents", "proposals.draft", { audit: "document.create" }),
  R("GET", "/documents/:id", "proposals.read"),
  R("PATCH", "/documents/:id", "proposals.draft", { audit: "document.update", body: "document" }),
  R("DELETE", "/documents/:id", "proposals.draft", { audit: "document.delete" }),
  R("POST", "/documents/:id/revise", "proposals.draft", { audit: "document.revise" }),
  R("POST", "/documents/:id/approval-request", "proposals.draft", { audit: "approval.request" }),
  R("POST", "/documents/:id/send", "proposals.send", { audit: "document.send" }),
  // The PDF of a sent version (M4.4, JOB-PDF-01): streamed through the session (an access-log row each); "again" is for a send-level role.
  R("GET", "/documents/:id/pdf", "proposals.read"),
  R("POST", "/documents/:id/pdf/retry", "proposals.send", { audit: "document.pdf_retry" }),
  R("POST", "/documents/:id/convert", "invoices.draft", { audit: "document.convert" }),
  R("GET", "/clients/:id/documents", "proposals.read"),
  // The owner's approval queue. Staff and Sales read only their own requests (the handler filters); only the owner decides.
  R("GET", "/approvals", "approvals.readOwn"),
  R("POST", "/approvals/:id/decide", "approvals.decide", { audit: "approval.decide" }),
  // The bell, the global search and the audit viewer (M3.1, ADM-G-09, ADM-G-05, ADM-AUD-02).
  R("GET", "/notifications", "notifications.own"),
  R("POST", "/notifications/read-all", "notifications.own", { audit: "notification.read_all" }),
  R("POST", "/notifications/:id/read", "notifications.own", { audit: "notification.read" }),
  R("GET", "/search", "search.use"),
  R("GET", "/audit", "audit.readFinance"),
  // The CSV export reads the same list through its own step-up action; each page is audited (`audit.export`).
  R("GET", "/audit/export", "audit.export", { audit: "audit.export" }),
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
