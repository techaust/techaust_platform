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
  type Ctx,
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
  on?: "front" | "finance" | "invoices";
};
const R = (
  method: RouteDef["method"],
  path: string,
  access: RouteDef["access"],
  opts: Opts = {},
): RouteDef => ({ method, path: `/api/v1${path}`, access, ...opts });

/** A row the front Worker answers itself (sign-in and staff management hold the secrets; M5.0). */
const F = (...a: Parameters<typeof R>): RouteDef => R(a[0], a[1], a[2], { ...a[3], on: "front" });

/**
 * A row the finance Worker answers (M6.1 stage A, ADM-PAY-01). Since the fourth admin Worker (2026-11-03) the payments side: a row whose handler needs a gateway
 * key, writes `payments`/`payment_allocations` without issuing a document, or reads the ledger panels.
 */
const X = (...a: Parameters<typeof R>): RouteDef => R(a[0], a[1], a[2], { ...a[3], on: "finance" });

/**
 * A row the invoices Worker answers (the fourth admin Worker, 2026-11-03, ADM-G-02): a row that drafts, issues, sends, voids or renders an invoice-family
 * document, or reads a report, a statement or the dashboard.
 */
const I = (...a: Parameters<typeof R>): RouteDef => R(a[0], a[1], a[2], { ...a[3], on: "invoices" });

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
  I("GET", "/clients/:id/statement", "clients.finance.read"),
  // M5.5b (LD79): the statement as a PDF made on request (a cache row, then the jobs Worker) and streamed back. Anyone who sees the finance tab (Q59).
  I("POST", "/clients/:id/statement/pdf", "clients.finance.read", { audit: "client.statement_pdf" }),
  I("GET", "/clients/:id/statement/pdf/:sid", "clients.finance.read"),
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
  R("POST", "/deeds/:id/pdf/render", "deeds.renderPdf", { audit: "deed.pdf_retry" }),
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
  I("GET", "/dashboard", "dashboard.read"),
  // M7.5 D1/G (Q4 A): the Free-plan usage tile's data, Owner and Accountant.
  I("GET", "/dashboard/usage", "usage.read"),
  // Reports (M5.5b, LD71, LD74): the register page of the GST and CA exports (a fresh step-up on every page: `exports.gst`; one audit row per page), the EDF month and the
  // export realisation list (Owner and Accountant, `reports.finance`, Q56).
  I("GET", "/reports/registers", "exports.gst", { audit: "report.export" }),
  I("GET", "/reports/edf", "reports.finance"),
  I("GET", "/reports/realisation", "reports.finance"),
  // M6.1: the payments and TDS register of one FY (07-ZH line 20; the SPA builds the CSV, the TDS rows apart for Form 26AS and AIS matching).
  I("GET", "/reports/payments", "reports.finance"),
  // M6.5 (B4; ADM-PAY-08): the refunds register of one FY, the registers' rule (Owner and Accountant with a fresh code on every page, one audit row per page). Its
  // own row, not a kind of `/reports/registers`: that page answers GST register rows and a settings meta over a date range; this one answers refunds over an FY.
  I("GET", "/reports/refunds", "exports.gst", { audit: "report.export" }),
  // M7.3 (ADM-REP-01, -02, -06; run file C1, C2, C9, L12): revenue and collections (by month, category or kind; per client) and outstanding and ageing, read only,
  // Owner and Accountant (`reports.finance`). On the invoices Worker with the other reports (the brief's "finance" predates the fourth admin Worker; Step 0).
  I("GET", "/reports/revenue", "reports.finance"),
  I("GET", "/reports/revenue/clients", "reports.finance"),
  I("GET", "/reports/ageing", "reports.finance"),
  // M7.3 C6 (L6): the per-client CSVs of C2 and C9, the registers' rule (a fresh code on every page, one `report.export` audit row per page; a refused request
  // writes nothing), through the same handlers as the screens' rows.
  I("GET", "/reports/revenue/export", "exports.gst", { audit: "report.export" }),
  I("GET", "/reports/ageing/export", "exports.gst", { audit: "report.export" }),
  // M7.3 (ADM-REP-03, -05; C3, C4): the pipeline and win rate (Owner, Sales) and care plan hours (Owner, Staff), on the API Worker with the leads and care plans.
  R("GET", "/reports/pipeline", "reports.pipeline"),
  R("GET", "/reports/care-hours", "reports.delivery"),
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
  I("GET", "/invoices", "invoices.read"),
  I("POST", "/invoices", "invoices.draft", { audit: "invoice.create" }),
  I("GET", "/invoices/:id", "invoices.read"),
  I("PATCH", "/invoices/:id", "invoices.draft", { audit: "invoice.update", body: "document" }),
  I("DELETE", "/invoices/:id", "invoices.draft", { audit: "invoice.delete" }),
  I("POST", "/invoices/:id/issue", "invoices.issue", { audit: "invoice.issue" }),
  I("POST", "/invoices/:id/issue-request", "invoices.draft", { audit: "approval.request" }),
  I("POST", "/invoices/:id/void", "invoices.void", { audit: "invoice.void" }),
  // ADM-INV-10 (owner, 2026-10-30, docs/13): withdrawing a proforma the client has received (Owner, step-up; Q1).
  I("POST", "/invoices/:id/withdraw", "invoices.withdraw", { audit: "invoice.withdraw" }),
  // M5.2: the day the service was completed (set once), and the tax invoice for money received against a proforma (Q9: Owner only, with a fresh code).
  I("POST", "/invoices/:id/service-completed", "invoices.draft", { audit: "invoice.service_completed" }),
  I("POST", "/invoices/:id/advance-invoice", "invoices.advance", { audit: "invoice.advance_issue" }),
  // M5.3 (ADM-INV-11): the draft of a credit or debit note against an issued invoice (a Staff member drafts and asks, the Owner issues: the same issue, request and approve
  // routes as an invoice), and the client's IMS answer on a credit note (Q36: the Owner, no fresh code: it changes no money).
  I("POST", "/invoices/:id/credit-note", "invoices.draft", { audit: "invoice.note_create" }),
  I("POST", "/invoices/:id/debit-note", "invoices.draft", { audit: "invoice.note_create" }),
  I("POST", "/invoices/:id/ims-status", "invoices.ims", { audit: "invoice.ims_status" }),
  I("GET", "/invoices/:id/pdf", "invoices.read"),
  I("GET", "/invoices/:id/pdf/supplier", "invoices.supplierCopy"),
  I("POST", "/invoices/:id/pdf/retry", "invoices.draft", { audit: "invoice.pdf_retry" }),
  // M5.4 (ADM-INV-15, ADM-INV-13, POR-06): send an issued invoice (Owner and Staff, Q42), revoke its links, pause or resume its reminders.
  I("POST", "/invoices/:id/send", "invoices.send", { audit: "invoice.send" }),
  I("POST", "/invoices/:id/links/revoke", "invoices.send", { audit: "invoice.links_revoke" }),
  I("POST", "/invoices/:id/reminders/pause", "invoices.send", { audit: "invoice.reminders_pause" }),
  I("POST", "/invoices/:id/reminders/resume", "invoices.send", { audit: "invoice.reminders_resume" }),
  I("GET", "/clients/:id/invoices", "invoices.read"),
  // M6.1 (ADM-PAY-01, -05, -06, ADM-INV-16, -17, Q60; run file C): manual payments and TDS. Recording or confirming needs the Owner's fresh code (owner, Q2
  // A, 2026-10-31); a Staff member's entry waits for the Owner (`payments.record` is "approval" for Staff: the handler records it as pending). Withdrawing and
  // using credit are the Owner's with a fresh code; a proof or a TDS certificate is added by the Owner or Staff; a FEMA extension is the Owner's.
  // M6.2 (Razorpay, run file C): payment links, "Needs review" and the gateways' status. Static paths before `/payments/:id` (the finance router registers them first).
  X("POST", "/invoices/:id/payment-link", "payments.link", { audit: "payment.link_create" }),
  X("POST", "/invoices/:id/payment-link/cancel", "payments.link", { audit: "payment.link_cancel" }),
  X("POST", "/payments/links/:id/refresh", "payments.link"),
  X("GET", "/payments/review", "payments.read"),
  X("POST", "/payments/review/:id/resolve", "payments.review", { audit: "payment.review_resolve" }),
  X("POST", "/payments/review/:id/retry", "payments.review", { audit: "payment.review_retry" }),
  X("GET", "/payments/gateways", "settings.manage"),
  // M6.4 (ADM-INV-17, L12; run file C): remittance advices and the "Without advice" list, above `/payments/:id` so their static paths are never a payment id.
  X("GET", "/payments/advices", "payments.read"),
  X("POST", "/payments/advices", "payments.attachProof", { audit: "payment.advice_create" }),
  X("GET", "/payments/advices/:id", "payments.read"),
  X("PUT", "/payments/advices/:id/file", "payments.attachProof", {
    audit: "payment.advice_file",
    body: "upload",
  }),
  X("GET", "/payments/advices/:id/file", "payments.read"),
  X("POST", "/payments/advices/:id/payments", "payments.attachProof", { audit: "payment.advice_link" }),
  X("POST", "/payments/advices/:id/payments/:pid/remove", "payments.adviceUnlink", {
    audit: "payment.advice_unlink",
  }),
  X("GET", "/payments/without-advice", "payments.read"),
  // M6.5 review part 1, finding 3 (RA-41): credit held at a return period's end that may be an advance (the Owner and the Accountant), above `/payments/:id`.
  X("GET", "/payments/credit-held", "reports.finance"),
  // M7.1 (ADM-PAY-05, L10; run file C): the clients' "I've paid" notices and the dismiss, above `/payments/:id` so `notices` is never a payment id. A notice
  // is recorded only through `POST /payments` with `noticeId` (L23).
  X("GET", "/payments/notices", "payments.read"),
  X("POST", "/payments/notices/:id/close", "payments.notices", { audit: "payment.notice_close" }),
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
  // M6.5 (ADM-INV-17, RB-43): the AD bank's FEMA Reg. 6 reductions of an export invoice (the Owner with a fresh code) and the bank's letter.
  X("GET", "/invoices/:id/realisation-reductions", "payments.read"),
  X("POST", "/invoices/:id/realisation-reductions", "realisation.reduce", { audit: "realisation.reduce" }),
  X("PUT", "/invoices/:id/realisation-reductions/:rid/letter", "realisation.reduce", {
    audit: "realisation.reduce",
    body: "upload",
  }),
  // M6.5 (ADM-PAY-08): refunds (the Owner with a fresh code; the Accountant reads), the Refunds tab, "Try again" and Cancel.
  X("POST", "/payments/:id/refunds", "refunds.issue", { audit: "refund.issue" }),
  X("GET", "/payments/:id/refunds", "refunds.read"),
  X("GET", "/refunds", "refunds.read"),
  X("POST", "/refunds/:id/retry", "refunds.issue", { audit: "refund.retry" }),
  X("POST", "/refunds/:id/cancel", "refunds.issue", { audit: "refund.cancel" }),
  // Review part 1, finding 9 (L9): the INR the bank debited for a USD refund (the Owner with a fresh code, once), for the refunds register.
  X("POST", "/refunds/:id/inr", "refunds.issue", { audit: "refund.inr" }),
  // M6.5 (ADM-PAY-10, L11): reconciliation: Razorpay's settlements, the unmatched lists, the Owner's "seen in the bank statement" tick and "Fetch now".
  X("GET", "/reconciliation/settlements", "reports.finance"),
  X("GET", "/reconciliation/settlements/:id", "reports.finance"),
  X("GET", "/reconciliation/unmatched", "reports.finance"),
  X("POST", "/reconciliation/bank-matches", "payments.reconcile", { audit: "recon.match" }),
  X("POST", "/reconciliation/bank-matches/:id/remove", "payments.reconcile", { audit: "recon.unmatch" }),
  X("POST", "/reconciliation/settlements/fetch", "payments.reconcile", { audit: "recon.fetch" }),
  // M6.5 (ADM-PAY-09, L34): a payment's receipt (a read beside the payment: the finance Worker), its PDF (an invoice-family document: the invoices Worker) and
  // the re-render as the invoice's (`invoices.draft`).
  X("GET", "/payments/:id/receipt", "payments.read"),
  // M7.2 (ADM-PAY-09, C.2): "Send receipt again" to 1 to 5 finance contacts (a manual send goes at once).
  X("POST", "/receipts/:id/send", "invoices.send", { audit: "receipt.send" }),
  I("GET", "/receipts/:id/pdf", "payments.read"),
  I("POST", "/receipts/:id/pdf/retry", "invoices.draft", { audit: "receipt.pdf_retry" }),
  // The owner's approval queue. Staff and Sales read only their own requests (the handler filters); only the owner decides.
  I("GET", "/approvals", "approvals.readOwn"),
  I("POST", "/approvals/:id/decide", "approvals.decide", { audit: "approval.decide" }),
  // The bell, the global search and the audit viewer (M3.1, ADM-G-09, ADM-G-05, ADM-AUD-02).
  // M7.1 (POR-09, POR-11, L8; run file C): the requests clients send from the portal, and the close (Staff only for a contact change or a grievance: the
  // handler decides on the record's kind, the UPDATE and the trigger hold it too).
  R("GET", "/client-requests", "requests.read"),
  R("POST", "/client-requests/:id/close", "requests.close", { audit: "client_request.close" }),
  // M7.4 (ADM-SET-09, ADM-CLI-05, POR-11; run file C.2–C.8): staff log a request that came another way and record its steps; the legal hold (Owner, step-up)
  // and its history; the erased-address lift (Owner, step-up, L20); the clean-up report and the real-deletion switch (Owner; the switch with step-up, Q1 A);
  // a lead's export and erase (Owner, step-up) and its consent withdrawal.
  R("POST", "/client-requests", "requests.log", { audit: "client_request.log" }),
  R("POST", "/client-requests/:id/step", "requests.log", { audit: "client_request.step" }),
  R("GET", "/legal-holds", "clients.read"),
  R("POST", "/legal-holds", "legalHold.manage", { audit: "legal_hold.set" }),
  R("POST", "/suppressions/lift", "suppressions.lift", { audit: "suppression.lift" }),
  R("GET", "/retention/report", "retention.read"),
  R("POST", "/retention/live", "retention.live", { audit: "retention.live" }),
  R("POST", "/leads/:id/export", "leads.dataExport", { audit: "lead.export" }),
  R("POST", "/leads/:id/erase", "leads.dataErase", { audit: "lead.erase" }),
  R("POST", "/leads/:id/consent/withdraw", "leads.write", { audit: "lead.consent_withdraw" }),
  R("GET", "/notifications", "notifications.own"),
  R("POST", "/notifications/read-all", "notifications.own", { audit: "notification.read_all" }),
  R("POST", "/notifications/:id/read", "notifications.own", { audit: "notification.read" }),
  // M7.2 (ADM-G-09, C.1): the member's own email switches; the email log (Owner, Staff) and the suppression list (Owner only, audited, no step-up: L12).
  R("GET", "/notifications/prefs", "notifications.own"),
  R("PUT", "/notifications/prefs", "notifications.own", { audit: "notification.prefs" }),
  R("GET", "/emails", "emails.read"),
  R("GET", "/emails/:id", "emails.read"),
  R("POST", "/emails/:id/unsuppress", "emails.unsuppress", { audit: "email.unsuppress" }),
  R("POST", "/contacts/:id/unsuppress", "emails.unsuppress", { audit: "contact.unsuppress" }),
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

/**
 * M7.5 (A1 F2, L2): the front's per-session limit (rate-limit.ts `sessionLimit`): its 429 when this session is over the limit, else null. Passed in by the
 * front only (createApp `sessionLimit`), so the Workers behind it never bundle the limiter or name its key.
 */
export type SessionLimit = (c: Ctx, sessionId: string) => Promise<Response | null>;

/** The guard, with the front's per-session limit asked before any D1 work (none: the Workers behind the front, which counted the request). */
export const guardWith = (sessionLimit?: SessionLimit) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const row = c.var.route;
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.access === "public") return next();

    // No cookie: 401 without touching the database.
    const token = readCookie(c.req.header("Cookie"));
    if (!token) return err(c, UNAUTHENTICATED, 401);
    const sessionId = await tokenHash(token);
    // A refusal writes nothing, not even the access row.
    const refused = sessionLimit ? await sessionLimit(c, sessionId) : null;
    if (refused) return refused;
    return guarded(c, next, row.access, sessionId);
  });

/** The guard without a session limit (the Workers behind the front, and tests of the table). */
export const guard = guardWith();

async function guarded(
  c: Ctx,
  next: () => Promise<void>,
  access: Exclude<RouteDef["access"], "public">,
  sessionId: string,
) {
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

  const decision = isRole(s.role) ? decide(s.role, access) : "deny";
  if (decision === "deny") return err(c, FORBIDDEN, 403);
  if (decision === "step-up" && !stepUpActive(s.step_up_until, t)) return err(c, STEP_UP_REQUIRED, 403);
  // "approval" (M7.5 L9: this used to say no route needed it): a Staff member's issue request and payment record (`invoices.issue`, `payments.record`), a
  // proposal sent with a discount over the self-send limit (`proposals.send`) and a request close without its kind (`requests.close`) reach the handler,
  // which decides again with the record (`decide(role, action, ctx)`) and turns "approval" into an approval request or a refusal; it never allows on it.
  return next();
}
