// The dashboard's tiles and what each role may see of the activity feed [ADM-DASH-01, ADM-G-02]. Pure.
// A tile a role may not see is ABSENT from the answer (never an "unavailable" stub), so a role cannot even learn it exists.
// The tiles follow the Reports row of the permission matrix (docs/04 section 9): Sales sees the pipeline only, the Accountant
// finance only, Staff the delivery tiles plus their own time.
import { FINANCE_AUDIT_ACTIONS } from "./audit.ts";
import { type Action, can, type Role } from "./permissions.ts";

export type TileKey =
  | "leads"
  | "pipelineValue"
  | "finance"
  | "projects"
  | "milestones"
  | "careBurn"
  | "myTime"
  | "activity";

export type TileDef = {
  key: TileKey;
  /** The matrix action a role needs. */
  capability: Action;
  /** Narrower than the capability: the roles that see the tile (Sales may read their own time, but their tile list is the pipeline). */
  roles?: readonly Role[];
};

export const TILES: readonly TileDef[] = [
  { key: "leads", capability: "reports.pipeline" },
  { key: "pipelineValue", capability: "reports.pipeline" },
  { key: "finance", capability: "reports.finance" },
  { key: "projects", capability: "reports.delivery" },
  { key: "milestones", capability: "reports.delivery" },
  { key: "careBurn", capability: "reports.delivery" },
  { key: "myTime", capability: "time.readOwn", roles: ["owner", "staff"] },
  { key: "activity", capability: "dashboard.read" },
];

/** The tiles a role sees, in display order. */
export const tilesFor = (role: Role): TileKey[] =>
  TILES.filter((t) => (t.roles ? t.roles.includes(role) : true) && can(role, t.capability)).map((t) => t.key);

// ---- activity ----------------------------------------------------------------------------------------------------------
// Exact action names, never prefixes: `client.billing_update` starts with `client.` but is finance. A test proves each name is a
// ROUTES audit action or a known system action.

const LEAD = [
  "lead.create",
  "lead.update",
  "lead.note",
  "lead.stage",
  "lead.reply",
  "lead.convert",
  "lead.purge",
] as const;
const CLIENT_PLAIN = ["client.create", "client.update", "contact.create", "contact.update"] as const;
const PROJECT = [
  "project.create",
  "project.update",
  "project.status",
  "milestone.create",
  "milestone.update",
  "milestone.status",
  "milestone.reorder",
  "milestone.delete",
  "note.create",
  "note.update",
  "note.delete",
  "file.upload",
  "file.share",
  "file.delete",
] as const;
const CARE = ["care_plan.create", "care_plan.terms", "care_plan.status"] as const;
/**
 * Proposals, estimates and their approvals (M4.3). `document.convert` is not here: it is a finance event (FINANCE_AUDIT_ACTIONS), so the owner
 * and the accountant see it and Staff and Sales do not. `document.expire` is written by the jobs Worker (actor System). `document.update`
 * is left out: the editor autosaves, so every few seconds of typing would be a row (the audit log keeps them all).
 */
const DOCUMENT = [
  "document.create",
  "document.delete",
  "document.revise",
  "document.send",
  "document.expire",
  "approval.request",
  "approval.decide",
  "approval.expire",
] as const;
export const TIME_ACTIONS = ["time.create", "time.update", "time.delete"] as const;

/** The owner's business actions: everything except sign-in and session events (`auth.*`), the bell (`notification.*`) and staff alerts. */
const OWNER = [
  "user.invite",
  "user.invite_revoke",
  "user.sessions_revoke_all",
  "user.role_change",
  "user.deactivate",
  "user.reset_2fa",
  "user.reactivate",
  "settings.company.update",
  "settings.tax.update",
  "settings.numbering.update",
  "settings.payment_terms.update",
  "settings.retention.update",
  "settings.flags.update",
  "settings.gateways.update",
  "settings.email.update",
  "settings.email.test_send",
  "settings.bank.update",
  "settings.terms.update",
  ...LEAD,
  ...CLIENT_PLAIN,
  "client.billing_update",
  "contact.export",
  "contact.erase",
  "contact.anonymise",
  ...PROJECT,
  ...CARE,
  ...DOCUMENT,
  ...TIME_ACTIONS,
  "audit.export",
  ...FINANCE_AUDIT_ACTIONS,
] as const;

const unique = (list: readonly string[]): readonly string[] => [...new Set(list)];

export const ACTIVITY_ACTIONS: Record<Role, readonly string[]> = {
  owner: unique(OWNER),
  staff: unique([
    ...LEAD,
    "client.create",
    "client.update",
    "contact.create",
    "contact.update",
    ...PROJECT,
    ...CARE,
    ...DOCUMENT,
    ...TIME_ACTIONS,
  ]),
  sales: unique([...LEAD, ...CLIENT_PLAIN, ...DOCUMENT, ...TIME_ACTIONS]),
  accountant: unique(FINANCE_AUDIT_ACTIONS),
};

/** Actions a role sees only when it did them itself (time entries are staff personal data). */
export const ACTIVITY_OWN_ONLY: Record<Role, readonly string[]> = {
  owner: [],
  staff: TIME_ACTIONS,
  sales: TIME_ACTIONS,
  accountant: [],
};

export const ACTIVITY_LIMIT = 20;
export const ACTIVITY_DAYS = 30;
/** The milestone window of the "due soon" tile (days from today, inclusive). */
export const MILESTONE_WINDOW_DAYS = 14;
