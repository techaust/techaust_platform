// How the audit log reads (ADM-AUD-02): action and record names in words, a change summary as before and after rows
// (sensitive values arrive as "[masked]" and stay masked), and the CSV export built in the browser from the loaded
// entries. Pure, so the wording and the CSV are tested without a browser.
import { formatIstDateTime, MASKED } from "@techaust/core";
import { ROLE_LABELS } from "@techaust/core/permissions";
import type { AuditEntry } from "../api.ts";

/** Every action the API writes today, in words. Unknown ones read as their own name ("lead.created"). */
/** A label by its own key only: a free-form value such as "constructor" never reads an inherited property. */
const own = (map: Record<string, string>, k: string): string | undefined =>
  Object.hasOwn(map, k) ? map[k] : undefined;

export const ACTION_LABELS: Record<string, string> = {
  "auth.login": "signed in",
  "auth.logout": "signed out",
  "auth.step_up": "confirmed with an authenticator code",
  "auth.session_revoke": "signed out a session",
  "auth.session_revoke_all": "signed out everywhere",
  "auth.recovery_regenerate": "made new recovery codes",
  "alert.new_device": "signed in on a new device",
  "alert.2fa_change": "changed two-step sign-in",
  "alert.lockout": "was locked out after wrong codes",
  "user.invite": "invited someone",
  "user.invite_revoke": "revoked an invite",
  "user.role_change": "changed a role",
  "user.deactivate": "deactivated a user",
  "user.reactivate": "reactivated a user",
  "user.reset_2fa": "reset someone's sign-in",
  "user.sessions_revoke_all": "signed out everyone else",
  "settings.company.update": "changed the company profile",
  "settings.bank.update": "changed the bank details",
  "settings.tax.update": "changed the tax settings",
  "settings.numbering.update": "changed the numbering",
  "settings.payment_terms.update": "changed the payment terms",
  "settings.gateways.update": "changed the gateway modes",
  "settings.email.update": "changed the email settings",
  "settings.email.test_send": "sent a test email",
  "settings.terms.update": "saved a new version of the document terms",
  "settings.retention.update": "changed data retention",
  "settings.flags.update": "changed the feature flags",
  "notification.read": "read a notification",
  "notification.read_all": "marked all notifications as read",
  "lead.created": "created a lead",
  "portal.login": "signed in to the client portal",
  "portal.logout": "signed out of the client portal",
  "portal.sessions_revoke_all": "signed out of the client portal everywhere",
  "portal.link_minted": "made a portal sign-in link",
  "doc_token.use": "opened a document link",
  "audit.export": "exported the audit log",
  // M3.3 clients and contacts (all written on the client, with the contact's id in the summary).
  "client.create": "added a client",
  "client.update": "changed a client's details",
  "client.billing_update": "changed a client's tax and billing",
  "contact.create": "added a contact",
  "contact.update": "changed a contact",
  "contact.export": "exported a contact's data",
  "contact.erase": "erased a contact",
  "contact.anonymise": "anonymised a contact",
  // M3.4 projects, milestones, notes and files (07-K, draft pending the owner).
  "project.create": "added a project",
  "project.update": "changed the project",
  "project.status": "changed the project status",
  "milestone.create": "added a milestone",
  "milestone.update": "changed a milestone",
  "milestone.status": "changed a milestone status",
  "milestone.delete": "deleted a milestone",
  "milestone.reorder": "reordered the milestones",
  "note.create": "added a note",
  "note.update": "changed a note",
  "note.share": "shared a note",
  "note.delete": "deleted a note",
  "file.upload": "uploaded a file",
  "file.share": "shared a file",
  "file.delete": "deleted a file",
};

/** Groups for the action filter (the API filters by one exact action). */
export const ACTION_GROUPS: { label: string; prefix: string }[] = [
  { label: "Sign-ins and security", prefix: "auth." },
  { label: "Security alerts", prefix: "alert." },
  { label: "Users and invites", prefix: "user." },
  { label: "Settings", prefix: "settings." },
  { label: "Notifications", prefix: "notification." },
  { label: "Clients", prefix: "client." },
  { label: "Contacts", prefix: "contact." },
  { label: "Projects", prefix: "project." },
  { label: "Milestones", prefix: "milestone." },
  { label: "Notes", prefix: "note." },
  { label: "Files", prefix: "file." },
  { label: "Client portal", prefix: "portal." },
  { label: "Audit log", prefix: "audit." },
];

/** Record types the API writes (`entity_type`), for the record filter. */
export const ENTITY_LABELS: Record<string, string> = {
  settings: "Settings",
  bank_account: "Bank details",
  terms: "Document terms",
  staff_user: "Staff",
  staff_invite: "Invites",
  staff_session: "Staff sessions",
  notification: "Notifications",
  client: "Clients",
  contact: "Contacts",
  client_session: "Client portal sessions",
  project: "Projects",
  milestone: "Milestones",
  note: "Notes",
  file: "Files",
  document: "Documents",
  audit_log: "Audit log",
};

export const actionText = (action: string) => own(ACTION_LABELS, action) ?? action;

/** Who did it: a staff member's name, or what kind of actor it was (the log keeps no client names). */
export function actorText(e: Pick<AuditEntry, "actorType" | "actorName">): string {
  if (e.actorType === "staff") return e.actorName || "A former staff member";
  if (e.actorType === "contact") return "A client contact";
  if (e.actorType === "webhook") return "A payment webhook";
  return "The system";
}

const SETTING_GROUPS: Record<string, string> = {
  company: "Company profile",
  tax: "Tax",
  numbering: "Numbering",
  payment_terms: "Payment terms",
  gateways: "Gateways",
  email: "Email",
  retention: "Data retention",
  flags: "Feature flags",
};

/** What the entry is about, e.g. "Settings: Tax", "Staff: Asha Verma" (with names the page knows). */
export function targetText(e: AuditEntry, names: ReadonlyMap<string, string> = new Map()): string {
  const kind = own(ENTITY_LABELS, e.entityType) ?? e.entityType;
  if (e.entityType === "settings" && e.entityId)
    return `Settings: ${SETTING_GROUPS[e.entityId] ?? e.entityId}`;
  if (e.entityType === "staff_user" && e.entityId)
    return `${kind}: ${names.get(e.entityId) ?? "a staff member"}`;
  if (e.entityType === "terms" && e.entityId) return `${kind}: ${e.entityId.replaceAll("_", " ")}`;
  return kind;
}

/** "tradeName" → "Trade name", "lut.arn" → "Lut arn", "accountNo" → "Account no". Known keys get better words. */
const FIELD_LABELS: Record<string, string> = {
  accountNo: "Account number",
  accountName: "Account name",
  bankName: "Bank",
  bankAddress: "Bank address",
  ifsc: "IFSC",
  swift: "SWIFT / BIC",
  gstin: "GSTIN",
  stateCode: "State code",
  defaultRateBp: "Default GST rate (basis points)",
  sacByCategory: "SAC codes",
  lut: "LUT",
  ga4Id: "Google Analytics ID",
  calComUrl: "Cal.com link",
  dpdpReadinessPage: "DPDP readiness page",
  sha256: "Text fingerprint (SHA-256)",
  nextNumbers: "Next numbers",
  bccOwner: "Copy to the owner",
  via: "How",
  until: "Until",
  rows: "Entries",
  firstPage: "First page",
  from: "From",
  to: "To",
  actor: "Person",
  entity: "Record",
  action: "Action",
  // M3.4
  budgetMinor: "Budget (minor units)",
  amountMinor: "Amount (minor units)",
  pctBp: "Percentage (basis points)",
  ownerId: "Owner",
  bodyMd: "Note text",
  mime: "File type",
  size: "Size (bytes)",
};

export function fieldLabel(key: string): string {
  const known = FIELD_LABELS[key];
  if (known) return known;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A value as one short line: empty, masked, text, or compact JSON for objects. */
export function valueText(v: unknown): string {
  if (v === undefined || v === null || v === "") return "Empty";
  if (v === MASKED) return "Masked";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

/** Facts the entry already shows another way (the device line is the user agent in words). */
const HIDDEN_FACTS = new Set(["ua", "userAgent"]);

const VIA: Record<string, string> = {
  totp: "Authenticator code",
  recovery: "Recovery code",
  invite: "Invite link",
  cli: "Command line (owner's setup script)",
};
const ROLE_WORDS: Record<string, string> = ROLE_LABELS;

/** An export filter's value in words: actions and records by their labels (the person filter stays its ID). */
const filterText = (k: string, x: unknown): string =>
  k === "action" && typeof x === "string"
    ? actionText(x)
    : k === "entity" && typeof x === "string"
      ? (own(ENTITY_LABELS, x) ?? x)
      : valueText(x);

/** A fact's value in words: roles and sign-in methods named, instants (UTC ms) as IST times. */
export function factText(key: string, v: unknown): string {
  if (key === "role" && typeof v === "string") return own(ROLE_WORDS, v) ?? v;
  if (key === "via" && typeof v === "string") return own(VIA, v) ?? v;
  if (key === "firstPage" && typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" && v > 1_000_000_000_000 && /until|at$|At$|expires/i.test(key))
    return formatIstDateTime(v);
  // An export's filters, e.g. "From: 2026-10-01, To: 2026-10-31" (the dates as typed, IST days); none is "None".
  if (key === "filters" && typeof v === "object" && v !== null && !Array.isArray(v)) {
    const set = Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== "");
    return set.length ? set.map(([k, x]) => `${fieldLabel(k)}: ${filterText(k, x)}`).join(", ") : "None";
  }
  return valueText(v);
}

export type DiffRow = { field: string; before: string; after: string; masked: boolean };
export type Fact = { field: string; value: string };

const isChange = (v: unknown): v is { before: unknown; after: unknown } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && ("before" in v || "after" in v);

/** A summary as rows: `{ field: { before, after } }` are changes; anything else is a plain fact ("Role: staff"). */
export function readSummary(summary: Record<string, unknown> | null): { changes: DiffRow[]; facts: Fact[] } {
  const changes: DiffRow[] = [];
  const facts: Fact[] = [];
  for (const [k, v] of Object.entries(summary ?? {})) {
    if (isChange(v))
      changes.push({
        field: fieldLabel(k),
        before: valueText(v.before),
        after: valueText(v.after),
        masked: v.before === MASKED || v.after === MASKED,
      });
    else if (!HIDDEN_FACTS.has(k)) facts.push({ field: fieldLabel(k), value: factText(k, v) });
  }
  return { changes, facts };
}

/** One CSV cell: quoted when it holds a comma, quote or line break; a leading = + - @ is defused (spreadsheet formulas). */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** The CSV of the entries, newest first, times in IST. */
export function auditCsv(entries: AuditEntry[], names: ReadonlyMap<string, string> = new Map()): string {
  const head = ["Time (IST)", "Who", "Role", "Action", "Record", "Changes", "IP address", "Device"];
  const rows = entries.map((e) => {
    const { changes, facts } = readSummary(e.summary);
    const detail = [
      ...changes.map((c) => `${c.field}: ${c.before} to ${c.after}`),
      ...facts.map((f) => `${f.field}: ${f.value}`),
    ].join("; ");
    return [
      formatIstDateTime(e.at),
      actorText(e),
      e.role ? (own(ROLE_WORDS, e.role) ?? e.role) : "",
      actionText(e.action),
      targetText(e, names),
      detail,
      e.ip ?? "",
      e.userAgent ?? "",
    ];
  });
  return `${[head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
