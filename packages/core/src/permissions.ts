// The staff permission matrix [docs/04 §9, ADM-G-02, ADM-AUTH-08]. Deny by default: an action not listed
// for a role is denied. The API checks this on every route; the UI only uses it to hide controls.
//   allow    — go ahead
//   step-up  — allowed after a fresh TOTP prompt (issuing invoices, refunds, bank/gateway settings,
//              user/role changes, data exports)
//   approval — the action becomes a request in the Owner's approvals queue
//   deny     — not allowed

export const ROLES = ["owner", "staff", "sales", "accountant"] as const;
export type Role = (typeof ROLES)[number];

/** How a role is written for a person (screens and emails); the code ("accountant") is never shown. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  staff: "Staff",
  sales: "Sales",
  accountant: "Accountant",
};
export type Decision = "allow" | "step-up" | "approval" | "deny";

/** Staff and Sales may send a proposal themselves only up to this document discount (10 %). */
export const SELF_SEND_DISCOUNT_BPS = 1_000;

type Rule = Decision | ((ctx: Context) => Decision);
export type Context = { readonly discountBps?: number };

const selfSend: Rule = ({ discountBps }) =>
  discountBps !== undefined &&
  Number.isInteger(discountBps) &&
  discountBps >= 0 &&
  discountBps <= SELF_SEND_DISCOUNT_BPS
    ? "allow"
    : "approval";

const MATRIX = {
  // Users, roles, settings, gateway modes, tax and numbering
  "users.manage": { owner: "step-up" },
  "users.read": { owner: "allow" },
  // A signed-in member's own account: sessions, step-up, the "who am I" read (M1.5, ADM-AUTH-05, -08)
  "account.own": { owner: "allow", staff: "allow", sales: "allow", accountant: "allow" },
  "account.recoveryCodes": { owner: "step-up", staff: "step-up", sales: "step-up", accountant: "step-up" },
  "settings.manage": { owner: "allow" },
  // The settings overview and a group's read: the handler then filters by group (the accountant sees only tax, numbering
  // and masked bank details; everything else is the owner's) [ADM-SET-01..10, M3.1]
  "settings.read": { owner: "allow", accountant: "allow" },
  // The bell and the global search: every signed-in member; each handler returns only what the role may read [ADM-G-05, ADM-G-09]
  "notifications.own": { owner: "allow", staff: "allow", sales: "allow", accountant: "allow" },
  "search.use": { owner: "allow", staff: "allow", sales: "allow", accountant: "allow" },
  "settings.taxNumbering.read": { owner: "allow", accountant: "allow" },
  "gateways.manage": { owner: "step-up" },
  // Bank details
  "bank.manage": { owner: "step-up" },
  "bank.readMasked": { owner: "allow", accountant: "allow" },
  // Leads & pipeline
  "leads.read": { owner: "allow", staff: "allow", sales: "allow" },
  "leads.write": { owner: "allow", staff: "allow", sales: "allow" },
  // Clients & contacts (Sales: no finance tabs)
  "clients.read": { owner: "allow", staff: "allow", sales: "allow", accountant: "allow" },
  "clients.write": { owner: "allow", staff: "allow", sales: "allow" },
  "clients.finance.read": { owner: "allow", staff: "allow", accountant: "allow" },
  // M3.3: the billing fields (tax identity, currency, terms) are changed only by Owner and Staff; Sales sets them once, at creation
  // or conversion. Erasing or anonymising a person is the Owner's, with a fresh step-up (owner answer 2026-10-25).
  "clients.finance.write": { owner: "allow", staff: "allow" },
  "clients.dataExport": { owner: "step-up" },
  "clients.dataErase": { owner: "step-up" },
  // Projects, milestones, notes, files
  "projects.read": { owner: "allow", staff: "allow", sales: "allow" },
  "projects.write": { owner: "allow", staff: "allow" },
  // Care plans (Staff: no price changes)
  "carePlans.read": { owner: "allow", staff: "allow", sales: "allow", accountant: "allow" },
  "carePlans.write": { owner: "allow", staff: "allow" },
  "carePlans.changePrice": { owner: "allow" },
  // Time logs
  // M3.5: `time.read` opens the time routes; the handler scopes to the member's own entries unless the role has `time.readAll`.
  "time.read": { owner: "allow", staff: "allow", sales: "allow", accountant: "allow" },
  "time.readOwn": { owner: "allow", staff: "allow", sales: "allow" },
  "time.readAll": { owner: "allow", accountant: "allow" },
  "time.writeOwn": { owner: "allow", staff: "allow", sales: "allow" },
  "time.writeAny": { owner: "allow" },
  // Service catalogue
  "catalogue.read": { owner: "allow", staff: "allow", sales: "allow", accountant: "allow" },
  "catalogue.write": { owner: "allow" },
  "catalogue.publish": { owner: "allow" },
  // Proposals & estimates
  "proposals.read": { owner: "allow", staff: "allow", sales: "allow", accountant: "allow" },
  "proposals.draft": { owner: "allow", staff: "allow", sales: "allow" },
  "proposals.send": { owner: "allow", staff: selfSend, sales: selfSend },
  // Invoices, proformas, credit notes
  "invoices.read": { owner: "allow", staff: "allow", accountant: "allow" },
  "invoices.draft": { owner: "allow", staff: "allow" },
  "invoices.issue": { owner: "step-up", staff: "approval" },
  // M5.1 (Q2, Settled by the lead on the safest reading, 2026-10-30 (08-C RA-10): such a void is reported as cancelled in Table 13, anything else is corrected by a credit note): only the Owner voids an issued invoice, with a fresh code; Staff cannot request a void.
  "invoices.void": { owner: "step-up" },
  // M5.2 (LD22, Q9): the tax invoice made for money received against a proforma: the Owner only, with a fresh code. A new docs/04 §9 row.
  "invoices.advance": { owner: "step-up" },
  // M5.3 (Q36, LD46; Researched 2026-10-28, s.34(2) proviso CGST Act (08-C RA-04)): recording the client's answer to a credit note in the GST portal's IMS: the Owner only (no fresh code: it changes no money).
  // A new docs/04 §9 row.
  "invoices.ims": { owner: "allow" },
  // M5.4 (Q42, ADM-INV-15, ADM-INV-13; Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28)): sending an issued invoice to the client, sending it again, revoking its links and pausing its reminders: Owner and Staff
  // (the Owner already issued it; sending moves no money). A new docs/04 §9 row.
  "invoices.send": { owner: "allow", staff: "allow" },
  // M5 research round (Q11, owner 2026-10-28; Rule 48(2) CGST Rules): the stored, never-sent DUPLICATE FOR SUPPLIER copy of an invoice or note is the books, so the Owner and the
  // Accountant read it. A new docs/04 §9 row.
  "invoices.supplierCopy": { owner: "allow", accountant: "allow" },
  // M5.4 (Q43, LD58; Researched 2026-10-28, s.31(5) CGST Act (08-C RA-24)): turning on the automatic issue of a client's monthly care invoice lets the system issue invoices WITHOUT the Owner each month, so only the Owner
  // may, with a fresh code (turning it off is `clients.finance.write`: Staff may). A new docs/04 §9 row.
  "clients.careAutoIssue": { owner: "step-up" },
  // Manual payments (Staff entries wait for the Owner's verification)
  "payments.read": { owner: "allow", staff: "allow", accountant: "allow" },
  "payments.record": { owner: "allow", staff: "approval" },
  "payments.verify": { owner: "allow" },
  // Refunds
  "refunds.read": { owner: "allow", accountant: "allow" },
  "refunds.issue": { owner: "step-up" },
  // The dashboard (M3.5): every role; the handler keeps only the tiles the role may see (core/dashboard.ts)
  "dashboard.read": { owner: "allow", staff: "allow", sales: "allow", accountant: "allow" },
  // Reports
  "reports.finance": { owner: "allow", accountant: "allow" },
  "reports.delivery": { owner: "allow", staff: "allow" },
  "reports.pipeline": { owner: "allow", sales: "allow" },
  // GST/CA exports
  "exports.gst": { owner: "step-up", accountant: "step-up" },
  // Audit log
  "audit.read": { owner: "allow" },
  "audit.readFinance": { owner: "allow", accountant: "allow" },
  // The CSV export (owner decision 2026-10-24): a fresh step-up for both; the accountant's rows are the finance events only.
  "audit.export": { owner: "step-up", accountant: "step-up" },
  // Approvals queue
  "approvals.decide": { owner: "allow" },
  "approvals.readOwn": { owner: "allow", staff: "allow", sales: "allow" },
} as const satisfies Record<string, Partial<Record<Role, Rule>>>;

export type Action = keyof typeof MATRIX;
export const ACTIONS = Object.keys(MATRIX) as Action[];

export const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);

export function decide(role: Role, action: Action, ctx: Context = {}): Decision {
  if (!isRole(role) || !Object.hasOwn(MATRIX, action)) return "deny";
  const rules: Partial<Record<Role, Rule>> = MATRIX[action];
  const rule = rules[role];
  if (rule === undefined) return "deny";
  return typeof rule === "function" ? rule(ctx) : rule;
}

/** True when the role may perform the action now or after step-up (not when it needs approval). */
export const can = (role: Role, action: Action, ctx: Context = {}) => {
  const d = decide(role, action, ctx);
  return d === "allow" || d === "step-up";
};
