// The staff permission matrix [docs/04 §9, ADM-G-02, ADM-AUTH-08]. Deny by default: an action not listed
// for a role is denied. The API checks this on every route; the UI only uses it to hide controls.
//   allow    — go ahead
//   step-up  — allowed after a fresh TOTP prompt (issuing invoices, refunds, bank/gateway settings,
//              user/role changes, data exports)
//   approval — the action becomes a request in the Owner's approvals queue
//   deny     — not allowed

export const ROLES = ["owner", "staff", "sales", "accountant"] as const;
export type Role = (typeof ROLES)[number];
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
  "settings.manage": { owner: "allow" },
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
  "clients.dataExport": { owner: "step-up" },
  // Projects, milestones, notes, files
  "projects.read": { owner: "allow", staff: "allow", sales: "allow" },
  "projects.write": { owner: "allow", staff: "allow" },
  // Care plans (Staff: no price changes)
  "carePlans.read": { owner: "allow", staff: "allow", sales: "allow", accountant: "allow" },
  "carePlans.write": { owner: "allow", staff: "allow" },
  "carePlans.changePrice": { owner: "allow" },
  // Time logs
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
  // Manual payments (Staff entries wait for the Owner's verification)
  "payments.read": { owner: "allow", staff: "allow", accountant: "allow" },
  "payments.record": { owner: "allow", staff: "approval" },
  "payments.verify": { owner: "allow" },
  // Refunds
  "refunds.read": { owner: "allow", accountant: "allow" },
  "refunds.issue": { owner: "step-up" },
  // Reports
  "reports.finance": { owner: "allow", accountant: "allow" },
  "reports.delivery": { owner: "allow", staff: "allow" },
  "reports.pipeline": { owner: "allow", sales: "allow" },
  // GST/CA exports
  "exports.gst": { owner: "step-up", accountant: "step-up" },
  // Audit log
  "audit.read": { owner: "allow" },
  "audit.readFinance": { owner: "allow", accountant: "allow" },
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
