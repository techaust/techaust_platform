// What the admin shows a role (ADM-G-01, ADM-G-02): the sections in the rail and the settings groups. The UI only hides
// what a role can't open; the server decides every request from the same matrix (@techaust/core/permissions).
import { type Action, decide, type Role } from "@techaust/core/permissions";

export type NavKey =
  | "dashboard"
  | "leads"
  | "clients"
  | "projects"
  | "care-plans"
  | "time"
  | "catalogue"
  | "proposals"
  | "estimates"
  | "invoices"
  | "payments"
  | "reports"
  | "approvals"
  | "audit"
  | "settings";

export const NAV_KEYS: readonly NavKey[] = [
  "dashboard",
  "leads",
  "clients",
  "projects",
  "care-plans",
  "time",
  "catalogue",
  "proposals",
  "estimates",
  "invoices",
  "payments",
  "reports",
  "approvals",
  "audit",
  "settings",
];

/** Any one of these matrix actions lets a role see the section (docs/04 §9). The dashboard is everyone's. */
export const NAV_ACCESS: Record<NavKey, readonly Action[]> = {
  dashboard: [],
  leads: ["leads.read"],
  clients: ["clients.read"],
  projects: ["projects.read"],
  "care-plans": ["carePlans.read"],
  time: ["time.readOwn", "time.readAll"],
  catalogue: ["catalogue.read"],
  proposals: ["proposals.read"],
  estimates: ["proposals.read"],
  invoices: ["invoices.read"],
  payments: ["payments.read"],
  reports: ["reports.finance", "reports.delivery", "reports.pipeline"],
  approvals: ["approvals.decide", "approvals.readOwn"],
  audit: ["audit.readFinance"],
  settings: ["settings.read"],
};

export const allowed = (role: Role, action: Action) => decide(role, action) !== "deny";

export const canSee = (role: Role, key: NavKey) => {
  const actions = NAV_ACCESS[key];
  return actions.length === 0 || actions.some((a) => allowed(role, a));
};

/** The section a path belongs to, by its first segment ("/" is the dashboard); null for any other path. */
export function sectionOf(pathname: string): NavKey | null {
  const first = pathname.split("/")[1] ?? "";
  if (first === "") return "dashboard";
  return (NAV_KEYS as readonly string[]).includes(first) && first !== "dashboard" ? (first as NavKey) : null;
}

/** Settings groups: the API's name, the address in the admin, and the action that opens it (the handler agrees). */
export const SETTINGS_PAGES = [
  { group: "company", slug: "company", read: "settings.manage", write: "settings.manage" },
  { group: "bank", slug: "bank", read: "bank.readMasked", write: "bank.manage" },
  { group: "tax", slug: "tax", read: "settings.taxNumbering.read", write: "settings.manage" },
  { group: "numbering", slug: "numbering", read: "settings.taxNumbering.read", write: "settings.manage" },
  { group: "payment_terms", slug: "payment-terms", read: "settings.manage", write: "settings.manage" },
  { group: "gateways", slug: "gateways", read: "settings.manage", write: "gateways.manage" },
  { group: "email", slug: "email", read: "settings.manage", write: "settings.manage" },
  { group: "terms", slug: "terms", read: "settings.manage", write: "settings.manage" },
  { group: "retention", slug: "retention", read: "settings.manage", write: "settings.manage" },
  { group: "flags", slug: "flags", read: "settings.manage", write: "settings.manage" },
] as const satisfies readonly { group: string; slug: string; read: Action; write: Action }[];

export type SettingsPage = (typeof SETTINGS_PAGES)[number];
export type SettingsGroupKey = SettingsPage["group"];

export const settingsPage = (slug: string | undefined) => SETTINGS_PAGES.find((p) => p.slug === slug);

/** The settings pages this role may open, in the PRD order. */
export const settingsFor = (role: Role) => SETTINGS_PAGES.filter((p) => allowed(role, p.read));

/** Only the owner manages users (the Users page lives inside Settings, owner decision 2026-10-24). */
export const canManageUsers = (role: Role) => allowed(role, "users.read");

/** Does this role get the global search box (leads, clients and contacts, or staff for the owner)? The shell and the
 * 404 line both ask. */
export const hasSearch = (role: Role) =>
  allowed(role, "leads.read") || allowed(role, "clients.read") || canManageUsers(role);

/** The 404 page's line: it points to search only for a role that has the box (review L6). */
export const notFoundLine = (role: Role) =>
  hasSearch(role)
    ? "The link may be old, or the record was removed. Use search above, or start from the dashboard."
    : "The link may be old, or the record was removed. Start again from the dashboard.";
