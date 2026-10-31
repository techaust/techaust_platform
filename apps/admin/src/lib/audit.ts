// How the audit log reads (ADM-AUD-02): action and record names in words, a change summary as before and after rows
// (sensitive values arrive as "[masked]" and stay masked), and the CSV export built in the browser from the loaded
// entries. Pure, so the wording and the CSV are tested without a browser.
import { formatIstDateTime, MASKED } from "@techaust/core";
import { ROLE_LABELS } from "@techaust/core/permissions";
import type { AuditEntry } from "../api.ts";
import { Y } from "./copy-y.ts";

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
  // 07-V §1 ("Made a statement PDF", "Exported a report"), in this list's lower-case form (it follows the person's name).
  "client.statement_pdf": "made a statement PDF",
  "report.export": "exported a report",
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
  // M4.1 catalogue, templates and publishing (07-L).
  "catalogue.create": "added a service",
  "catalogue.update": "changed a service",
  "catalogue.deactivate": "retired a service",
  "catalogue.activate": "made a service active again",
  "template.version": "saved a template version",
  "catalogue.publish": "published prices",
  // M4.3 proposals, estimates and approvals (07-O §7).
  "document.create": "created a draft",
  "document.update": "changed a draft",
  "document.delete": "discarded a draft",
  "document.send": "sent a document",
  "document.revise": "made a new version",
  "approval.request": "asked for approval",
  "approval.decide": "decided an approval",
  "document.convert": "converted a document",
  // FX-4 (full audit A5 4): the actions the API writes that had no label, so the log and the dashboard feed showed raw codes.
  // Leads, care plans and time (M3.2, M3.5): the approved 07-Q words the dashboard already uses (dashboard.ts `ACTIVITY_PENDING`; a test keeps the two equal).
  "lead.create": "added a lead",
  "lead.update": "changed a lead",
  "lead.note": "added a note to a lead",
  "lead.stage": "moved a lead to another stage",
  "lead.reply": "replied to a lead",
  "lead.convert": "converted a lead into a client",
  "care_plan.create": "added a care plan",
  "care_plan.terms": "changed a care plan's terms",
  "care_plan.status": "changed a care plan's status",
  "time.create": "logged time",
  "time.update": "changed a time entry",
  "time.delete": "deleted a time entry",
  "approval.expire": "marked an approval as expired",
  // Written outside ROUTES (FX-4 fix round 1, early check M2): the jobs Worker's lead purge and offer expiry take their approved
  // 07-Q words (DASH7, DASH14); the portal's offer actions are 07-Y below.
  "lead.purge": "deleted old leads",
  "document.expire": "marked a document as expired",
  // Lines 07 lacked: 07-Y, PENDING the owner, marked until approved (the same lower-case form, after the person's name).
  "document.resend": Y("sent a document again"),
  "document.links_revoke": Y("revoked a document's links"),
  "document.pdf_retry": Y("asked for a document's PDF again"),
  "settings.signature.update": Y("changed the signature image"),
  "settings.signature.delete": Y("removed the signature image"),
  // The client portal's offers (M4.5), written by a client contact ("A client contact …"); only proposals and estimates are offers.
  "document.view": Y("viewed a proposal or estimate"),
  "document.accept": Y("accepted a proposal or estimate"),
  "document.decline": Y("declined a proposal or estimate"),
  "offer_link.use": Y("opened a proposal or estimate from an email link"),
  // M5 invoices (07-R to 07-U had no audit words).
  "invoice.create": Y("created an invoice draft"),
  "invoice.update": Y("changed an invoice draft"),
  "invoice.delete": Y("discarded an invoice draft"),
  "invoice.issue": Y("issued an invoice"),
  "invoice.issue_auto": Y("issued a care plan invoice automatically"),
  "invoice.advance_issue": Y("issued a tax invoice for a payment received"),
  "invoice.void": Y("voided an invoice"),
  // ADM-INV-10: 07-ZF 9 (owner-approved 2026-10-31); the builder added it so the label test passes with the new ROUTES row (the designer may move it to ZF()).
  "invoice.withdraw": "withdrew a proforma",
  "invoice.note_create": Y("drafted a credit or debit note"),
  "invoice.ims_status": Y("recorded a client's IMS response"),
  "invoice.service_completed": Y("set the date the service was completed"),
  "invoice.send": Y("sent an invoice"),
  "invoice.links_revoke": Y("revoked an invoice's links"),
  "invoice.pdf_retry": Y("asked for an invoice's PDF again"),
  "invoice.reminders_pause": Y("paused payment reminders"),
  "invoice.reminders_resume": Y("resumed payment reminders"),
  "care_invoice.draft": Y("drafted a care plan invoice"),
  "care_invoice.auto_issue_refused": Y("could not issue a care plan invoice automatically"),
};

/**
 * Groups for the action filter (the API filters by one exact action), in the sidebar's order. A group holds the actions that start with one of its
 * prefixes; every labelled action sits in exactly one group (a test checks it), so none is left out of the filter. FX-4 (A5 4): Leads, Care plans, Time,
 * Invoices and Reports are the sidebar's own words; a care plan's invoice actions sit with Invoices, an offer link with Proposals and estimates, and a
 * document link with the client portal.
 */
export const ACTION_GROUPS: { label: string; prefixes: readonly string[] }[] = [
  { label: "Sign-ins and security", prefixes: ["auth."] },
  { label: "Security alerts", prefixes: ["alert."] },
  { label: "Users and invites", prefixes: ["user."] },
  { label: "Settings", prefixes: ["settings."] },
  { label: "Notifications", prefixes: ["notification."] },
  { label: "Leads", prefixes: ["lead."] },
  { label: "Clients", prefixes: ["client."] },
  { label: "Contacts", prefixes: ["contact."] },
  { label: "Projects", prefixes: ["project."] },
  { label: "Milestones", prefixes: ["milestone."] },
  { label: "Notes", prefixes: ["note."] },
  { label: "Files", prefixes: ["file."] },
  { label: "Care plans", prefixes: ["care_plan."] },
  { label: "Time", prefixes: ["time."] },
  { label: "Catalogue", prefixes: ["catalogue."] },
  { label: "Templates", prefixes: ["template."] },
  { label: "Proposals and estimates", prefixes: ["document.", "offer_link."] },
  { label: "Invoices", prefixes: ["invoice.", "care_invoice."] },
  { label: "Reports", prefixes: ["report."] },
  { label: "Approvals", prefixes: ["approval."] },
  { label: "Client portal", prefixes: ["portal.", "doc_token."] },
  { label: "Audit log", prefixes: ["audit."] },
];

/** The actions of one filter group, in the order given. */
export const actionsInGroup = (g: { prefixes: readonly string[] }, actions: readonly string[]): string[] =>
  actions.filter((a) => g.prefixes.some((p) => a.startsWith(p)));

/**
 * Record types the API writes (`entity_type`), for the record filter (`routes/audit.tsx` offers every entry, in this order). FX-4 review M2: leads,
 * care plans, time and reports take the sidebar's words (approved); no "Document sends" type, since sends are audited on their document (lead, after
 * the FX-4 fix round). `audit-labels.test.ts` scans every
 * writer for the types it can put in `audit_log` and fails on one without a label here.
 */
export const ENTITY_LABELS: Record<string, string> = {
  settings: "Settings",
  bank_account: "Bank details",
  terms: "Document terms",
  staff_user: "Staff",
  staff_invite: "Invites",
  staff_session: "Staff sessions",
  notification: "Notifications",
  lead: "Leads",
  client: "Clients",
  contact: "Contacts",
  catalogue_item: "Catalogue",
  template: "Templates",
  site_snapshot: "Published price lists",
  client_session: "Client portal sessions",
  project: "Projects",
  milestone: "Milestones",
  note: "Notes",
  file: "Files",
  care_plan: "Care plans",
  time_log: "Time",
  document: "Documents",
  approval: "Approvals",
  report: "Reports",
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
  // FX-4 (A5 12; 07-Y, PENDING): the tax setting's own field label (tax-settings.ts `TAX_SAC_COPY`).
  defaultSac: Y("Default SAC for custom lines"),
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
