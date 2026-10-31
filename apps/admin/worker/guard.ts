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

type Opts = {
  audit?: string;
  log?: boolean | "refusals";
  body?: "upload" | "large" | "document";
  on?: "front" | "finance";
};
const R = (
  method: RouteDef["method"],
  path: string,
  access: RouteDef["access"],
  opts: Opts = {},
): RouteDef => ({ method, path: `/api/v1${path}`, access, ...opts });

/** A row the front Worker answers itself (sign-in and staff management hold the secrets; M5.0). */
const F = (...a: Parameters<typeof R>): RouteDef => R(a[0], a[1], a[2], { ...a[3], on: "front" });

/** A row the finance Worker answers (M6.1 stage A, ADM-PAY-01): invoices and notes, a client's invoices and statement, reports, approvals, the dashboard. */
const X = (...a: Parameters<typeof R>): RouteDef => R(a[0], a[1], a[2], { ...a[3], on: "finance" });

export const ROUTES: readonly RouteDef[] = [
  F("GET", "/health", "public", { log: false }),
  // Sign-in: public, every one checks its own credentials. /salt and /invite/start are lookups, not attempts.
  F("POST", "/auth/salt", "public", { log: "refusals" }),
  F("POST", "/auth/login", "public"),
  F("POST", "/auth/totp", "public"),
  F("POST", "/auth/recovery", "public"),
  F("POST", "/auth/logout", "public", { audit: "auth.logout" }),
  F("POST", "/auth/invite/start", "public", { log: "refusals" }),
  F("POST", "/auth/invite/finish", "public"),
  F("POST", "/auth/invite/totp", "public"),
  // The signed-in member's own account.
  F("GET", "/auth/me", "account.own"),
  F("POST", "/auth/step-up", "account.own", { audit: "auth.step_up" }),
  F("GET", "/auth/sessions", "account.own"),
  F("DELETE", "/auth/sessions/:id", "account.own", { audit: "auth.session_revoke" }),
  F("POST", "/auth/sessions/revoke-all", "account.own", { audit: "auth.session_revoke_all" }),
  F("POST", "/auth/recovery/regenerate", "account.recoveryCodes", { audit: "auth.recovery_regenerate" }),
  // Staff and invites (owner).
  F("GET", "/users", "users.read"),
  F("GET", "/users/invites", "users.read"),
  F("POST", "/users/invites", "users.manage", { audit: "user.invite" }),
  F("POST", "/users/invites/:tokenHash/revoke", "users.manage", { audit: "user.invite_revoke" }),
  F("POST", "/users/sessions/revoke-all", "users.manage", { audit: "user.sessions_revoke_all" }),
  F("PATCH", "/users/:id", "users.manage", { audit: "user.role_change" }),
  F("POST", "/users/:id/deactivate", "users.manage", { audit: "user.deactivate" }),
  F("POST", "/users/:id/reset-2fa", "users.manage", { audit: "user.reset_2fa" }),
  F("POST", "/users/:id/reactivate", "users.manage", { audit: "user.reactivate" }),
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
  X("GET", "/clients/:id/statement", "clients.finance.read"),
  // M5.5b (LD79): the statement as a PDF made on request (a cache row, then the jobs Worker) and streamed back. Anyone who sees the finance tab (Q59).
  X("POST", "/clients/:id/statement/pdf", "clients.finance.read", { audit: "client.statement_pdf" }),
  X("GET", "/clients/:id/statement/pdf/:sid", "clients.finance.read"),
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
  // T11 (L8; 08-C RB-38(a)): the deed of assignment. Owner and Staff read it and fill the Schedules (decision (c)); the Owner finalises and uploads the signed
  // copy with a fresh code, cancels a draft, asks for a project to be checked again and for the unsigned PDF to be rendered again. The signed copy is a raw PDF
  // upload of at most 10 MB.
  R("GET", "/projects/:id/deed", "deeds.view"),
  R("POST", "/projects/:id/deed/recheck", "deeds.recheck", { audit: "deed.recheck" }),
  R("PUT", "/deeds/:id/schedules", "deeds.editSchedules", { audit: "deed.edit" }),
  R("POST", "/deeds/:id/finalise", "deeds.finalise", { audit: "deed.finalise" }),
  R("PUT", "/deeds/:id/signed", "deeds.uploadSigned", { audit: "deed.sign", body: "upload" }),
  R("POST", "/deeds/:id/cancel", "deeds.cancel", { audit: "deed.cancel" }),
  R("GET", "/deeds/:id/pdf/unsigned", "deeds.view"),
  R("GET", "/deeds/:id/pdf/signed", "deeds.view"),
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
  X("GET", "/dashboard", "dashboard.read"),
  // Reports (M5.5b, LD71, LD74): the register page of the GST and CA exports (a fresh step-up on every page: `exports.gst`; one audit row per page), the EDF month and the
  // export realisation list (Owner and Accountant, `reports.finance`, Q56).
  X("GET", "/reports/registers", "exports.gst", { audit: "report.export" }),
  X("GET", "/reports/edf", "reports.finance"),
  X("GET", "/reports/realisation", "reports.finance"),
  // M6.1: the payments and TDS register of one FY (07-ZH line 20; the SPA builds the CSV, the TDS rows apart for Form 26AS and AIS matching).
  X("GET", "/reports/payments", "reports.finance"),
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
  // "Use Catalogue text" (owner 2026-10-28): adds the text Catalogue has since been given to a hidden or short service section.
  R("POST", "/documents/:id/sections/fill-from-catalogue", "proposals.draft", { audit: "document.update" }),
  R("DELETE", "/documents/:id", "proposals.draft", { audit: "document.delete" }),
  R("POST", "/documents/:id/revise", "proposals.draft", { audit: "document.revise" }),
  R("POST", "/documents/:id/approval-request", "proposals.draft", { audit: "approval.request" }),
  R("POST", "/documents/:id/send", "proposals.send", { audit: "document.send" }),
  // The PDF of a sent version (M4.4, JOB-PDF-01): streamed through the session (an access-log row each); "again" is for a send-level role.
  R("GET", "/documents/:id/pdf", "proposals.read"),
  R("POST", "/documents/:id/pdf/retry", "proposals.send", { audit: "document.pdf_retry" }),
  // Offers to the client (M4.5): send again, end every link, the acceptance certificate, and start the project of an accepted proposal.
  R("POST", "/documents/:id/resend", "proposals.send", { audit: "document.resend" }),
  R("POST", "/documents/:id/links/revoke", "proposals.send", { audit: "document.links_revoke" }),
  R("GET", "/documents/:id/certificate", "proposals.read"),
  R("POST", "/documents/:id/start-project", "projects.write", { audit: "project.create" }),
  R("POST", "/documents/:id/convert", "invoices.draft", { audit: "document.convert" }),
  R("GET", "/clients/:id/documents", "proposals.read"),
  // Invoices (M5.1, ADM-INV-01..04, -07, ADM-PRJ-02, LD1): their own prefix, because the permissions differ from proposals and a row has one action.
  // Static paths come before `/:id`. Only the Owner issues (a fresh code at the guard); a Staff member's issue is a request (`approval.request`);
  // voiding is `invoices.void` (Owner, step-up). Sales reads no invoice at all. A save is up to 96 KB (`body: "document"`).
  X("GET", "/invoices", "invoices.read"),
  X("POST", "/invoices", "invoices.draft", { audit: "invoice.create" }),
  X("GET", "/invoices/:id", "invoices.read"),
  X("PATCH", "/invoices/:id", "invoices.draft", { audit: "invoice.update", body: "document" }),
  X("DELETE", "/invoices/:id", "invoices.draft", { audit: "invoice.delete" }),
  X("POST", "/invoices/:id/issue", "invoices.issue", { audit: "invoice.issue" }),
  X("POST", "/invoices/:id/issue-request", "invoices.draft", { audit: "approval.request" }),
  X("POST", "/invoices/:id/void", "invoices.void", { audit: "invoice.void" }),
  // ADM-INV-10 (owner, 2026-10-30, docs/13): withdrawing a proforma the client has received (Owner, step-up; Q1).
  X("POST", "/invoices/:id/withdraw", "invoices.withdraw", { audit: "invoice.withdraw" }),
  // M5.2: the day the service was completed (set once), and the tax invoice for money received against a proforma (Q9: Owner only, with a fresh code).
  X("POST", "/invoices/:id/service-completed", "invoices.draft", { audit: "invoice.service_completed" }),
  X("POST", "/invoices/:id/advance-invoice", "invoices.advance", { audit: "invoice.advance_issue" }),
  // M5.3 (ADM-INV-11): the draft of a credit or debit note against an issued invoice (a Staff member drafts and asks, the Owner issues: the same issue, request and approve
  // routes as an invoice), and the client's IMS answer on a credit note (Q36: the Owner, no fresh code: it changes no money).
  X("POST", "/invoices/:id/credit-note", "invoices.draft", { audit: "invoice.note_create" }),
  X("POST", "/invoices/:id/debit-note", "invoices.draft", { audit: "invoice.note_create" }),
  X("POST", "/invoices/:id/ims-status", "invoices.ims", { audit: "invoice.ims_status" }),
  X("GET", "/invoices/:id/pdf", "invoices.read"),
  X("GET", "/invoices/:id/pdf/supplier", "invoices.supplierCopy"),
  X("POST", "/invoices/:id/pdf/retry", "invoices.draft", { audit: "invoice.pdf_retry" }),
  // M5.4 (ADM-INV-15, ADM-INV-13, POR-06): send an issued invoice (Owner and Staff, Q42), revoke its links, pause or resume its reminders.
  X("POST", "/invoices/:id/send", "invoices.send", { audit: "invoice.send" }),
  X("POST", "/invoices/:id/links/revoke", "invoices.send", { audit: "invoice.links_revoke" }),
  X("POST", "/invoices/:id/reminders/pause", "invoices.send", { audit: "invoice.reminders_pause" }),
  X("POST", "/invoices/:id/reminders/resume", "invoices.send", { audit: "invoice.reminders_resume" }),
  X("GET", "/clients/:id/invoices", "invoices.read"),
  // M6.1 (ADM-PAY-01, -05, -06, ADM-INV-16, -17, Q60; run file C): manual payments and TDS. Recording or confirming needs the Owner's fresh code (owner, Q2
  // A, 2026-10-31); a Staff member's entry waits for the Owner (`payments.record` is "approval" for Staff: the handler records it as pending). Withdrawing and
  // using credit are the Owner's with a fresh code; a proof or a TDS certificate is added by the Owner or Staff; a FEMA extension is the Owner's.
  X("GET", "/payments", "payments.read"),
  X("POST", "/payments", "payments.record", { audit: "payment.record" }),
  X("GET", "/payments/:id", "payments.read"),
  X("POST", "/payments/:id/verify", "payments.verify", { audit: "payment.verify" }),
  X("POST", "/payments/:id/withdraw", "payments.withdraw", { audit: "payment.withdraw" }),
  X("PUT", "/payments/:id/proof", "payments.attachProof", { audit: "payment.proof", body: "upload" }),
  X("GET", "/payments/:id/proof", "payments.read"),
  X("POST", "/payments/:id/tds-certificate", "payments.attachProof", { audit: "payment.tds_certificate" }),
  X("GET", "/clients/:id/credit", "payments.read"),
  X("POST", "/clients/:id/credit/apply", "payments.applyCredit", { audit: "payment.credit_apply" }),
  X("GET", "/invoices/:id/payments", "payments.read"),
  X("POST", "/invoices/:id/credit/release", "payments.applyCredit", { audit: "payment.credit_release" }),
  X("POST", "/invoices/:id/realisation-extensions", "realisation.extend", {
    audit: "invoice.realisation_extend",
  }),
  X("PUT", "/invoices/:id/realisation-extensions/:eid/letter", "realisation.extend", {
    audit: "invoice.realisation_extend",
    body: "upload",
  }),
  // The owner's approval queue. Staff and Sales read only their own requests (the handler filters); only the owner decides.
  X("GET", "/approvals", "approvals.readOwn"),
  X("POST", "/approvals/:id/decide", "approvals.decide", { audit: "approval.decide" }),
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
