// The typed client for the admin API (apps/admin/worker). Every error body is `{ error: { code, message },
// request_id }`. Two codes are handled here for every caller:
// - `step_up_required` (403): the step-up dialog opens; on success the same request is sent once more.
// - `unauthenticated` (401) on a signed-in route: the session has ended, so the app goes back to sign-in.
import type { ArgonParams } from "@techaust/auth";
import type {
  CATALOGUE_CATEGORIES,
  CATALOGUE_UNITS,
  CreateEntry,
  PatchEntry,
  TEMPLATE_KIND_VALUES,
  TemplateBody,
} from "@techaust/core/catalogue";
import type { Role } from "@techaust/core/permissions";
import type { Settings, SignatureRef } from "@techaust/core/settings";
import type { TermsBlockId } from "@techaust/core/terms";
import type { HashRequest, HashResponse } from "./hash.worker.ts";
import type { DeedPage } from "./lib/deeds.ts";
import type { CarePlanBilling } from "./lib/invoice-send.ts";

export type User = { name: string; email: string; role: Role };
export type Me = { user: User; stepUpUntil: number | null };
export type Session = {
  id: string;
  created_at: number;
  last_seen_at: number;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
};
export type StaffMember = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: "invited" | "active" | "deactivated";
  last_login_at: number | null;
  created_at: number;
};
export type Invite = {
  token_hash: string;
  email: string;
  role: Role;
  invited_by: string | null;
  expires_at: number;
  created_at: number;
  /** The address already has a row in the staff list (a reset member): show the person once, not the invite as well. */
  existing_member: boolean;
};
export type InviteLink = { link: string; expires_at: number; email_queued?: boolean };
export type Page<K extends string, T> = { [key in K]: T[] } & { next: string | null; prev: string | null };

/** The settings groups (ADM-SET-01..10) as the API names them. */
export type GroupKey =
  | "company"
  | "bank"
  | "tax"
  | "numbering"
  | "payment_terms"
  | "gateways"
  | "email"
  | "terms"
  | "retention"
  | "flags";
/** The groups stored as one JSON document each (`/settings/groups/:group`). */
export type JsonGroup = "company" | "tax" | "numbering" | "payment_terms" | "email" | "retention" | "flags";
export type OverviewGroup = {
  group: GroupKey;
  version: number | null;
  updatedAt: number | null;
  attention: string[];
};
/** `used`/`locked`: a document of the series was issued this financial year; format and next number are then read-only. */
export type SeriesState = {
  series: string;
  nextNo: number;
  used: boolean;
  locked: boolean;
  lockReason: string | null;
};
export type GroupMeta = {
  /** Which 08-C §5 list holds the group's open questions: "08-C §5: CA", or "08-C §5: CA and lawyer" (FX-3; was a "VERIFY WITH" tag). */
  verify?: string;
  /** M5.2 (Settings › Tax): today's LUT reminder, worked out by the server from the saved letters. */
  lutStatus?: {
    currentFy: string;
    currentFyLabel: string;
    nextFy: string;
    nextFyLabel: string;
    due: boolean;
    currentMissing: boolean;
  } | null;
  notes?: string;
  /** FX-5 (Settings › Payment terms): the days the newest proposal terms state, and whether they all match the saved due days. */
  termsDueDays?: { stated: number[]; matches: boolean };
  pan?: string | null;
  logos?: readonly string[];
  fy?: string;
  series?: SeriesState[];
};
export type GatewayMeta = {
  status: Record<"razorpay" | "stripe" | "paypal", { configured: boolean; missing: string[] }>;
  liveAllowed: boolean;
};
export type SettingsDoc<K extends JsonGroup | "gateways"> = {
  group: K;
  version: number;
  updatedAt: number | null;
  value: Settings[K];
  meta: K extends "gateways" ? GatewayMeta : GroupMeta;
};
export type BankKind = "INR" | "USD_SWIFT";
export type BankAccount = {
  kind: BankKind;
  exists: boolean;
  accountName: string | null;
  accountNoLast4: string | null;
  ifsc: string | null;
  swift: string | null;
  bankName: string | null;
  branch: string | null;
  bankAddress: string | null;
  intermediary: string | null;
  /** M5.2 (LD30): the RBI purpose code of the USD account (P and four digits); absent from an older API. */
  purposeCode?: string | null;
  updatedAt: number | null;
};
export type BankInput = {
  accountName: string;
  accountNo?: string;
  accountNoAgain?: string;
  ifsc?: string | null;
  swift?: string | null;
  bankName: string;
  branch?: string | null;
  bankAddress?: string | null;
  intermediary?: string | null;
  /** M5.2: the USD account's purpose code; null clears it. */
  purposeCode?: string | null;
  /** The `updatedAt` from GET /settings/bank (null for a first save); a different one on the server is a 409. */
  expectedUpdatedAt: number | null;
};
export type TermsVersion = {
  version: number;
  bodyMd: string;
  sha256: string;
  createdAt: number;
  /** null: documents don't record this block's version yet (until M5). */
  usedBy: number | null;
};
export type TermsBlock = { block: TermsBlockId; label: string; current: TermsVersion | null };
export type Saved = { ok: true; changed: boolean; version?: number | null };
export type Notification = {
  id: string;
  kind: string;
  title: string;
  link: string;
  readAt: number | null;
  createdAt: number;
};
export type SearchGroupData = {
  /** `invoice` (M5.1): issued invoice numbers, only for roles with `invoices.read` (the API leaves the group out otherwise). */
  type: "user" | "lead" | "client" | "contact" | "project" | "catalogue" | "document" | "invoice";
  label: string;
  items: { id: string; title: string; subtitle: string; link: string }[];
};
export type AuditEntry = {
  id: string;
  at: number;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  role: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
};
export type UsersQuery = {
  limit?: "25" | "50" | undefined;
  sort?: "name" | "created" | undefined;
  dir?: "asc" | "desc" | undefined;
  role?: Role | undefined;
  status?: StaffMember["status"] | undefined;
  q?: string | undefined;
  after?: string | undefined;
  before?: string | undefined;
};
export type AuditQuery = {
  limit?: "25" | "50" | undefined;
  actor?: string | undefined;
  entity?: string | undefined;
  action?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  after?: string | undefined;
  before?: string | undefined;
};

// Leads (M3.2, ADM-LEAD-01..06): the shapes of apps/admin/worker/leads.ts.
export type LeadStage = "new" | "qualified" | "proposal_sent" | "won" | "lost";
export type LostReason = "price" | "timing" | "scope_fit" | "no_response" | "competitor" | "other";
export type LeadItem = {
  id: string;
  ref: string;
  stage: LeadStage;
  lostReason: LostReason | null;
  source: "web" | "manual";
  serviceCode: string | null;
  serviceName: string | null;
  name: string;
  email: string;
  company: string | null;
  ownerId: string | null;
  ownerName: string | null;
  nextActionAt: number | null;
  nextActionNote: string | null;
  nextActionOverdue: boolean;
  clientId: string | null;
  duplicateOf: string | null;
  lastActivityAt: number | null;
  deleteAfter: number | null;
  scheduledForDeletion: boolean;
  legalHold: boolean;
  createdAt: number;
};
export type LeadConsent = {
  noticeVersion?: string;
  purposes?: string[];
  at?: number;
  marketing?: boolean;
  withdrawnAt?: number | null;
};
export type LeadDetail = LeadItem & {
  requestType: string | null;
  plan: string | null;
  budgetBand: string | null;
  timeline: string | null;
  currency: "INR" | "USD" | null;
  message: string | null;
  tools: string[] | null;
  phone: string | null;
  country: string | null;
  callWindow: string | null;
  utm: Record<string, string> | null;
  sourcePage: string | null;
  referrerHost: string | null;
  consent: LeadConsent | null;
  proposalId: string | null;
  /** Send back as `expectedUpdatedAt` with the next PATCH. */
  updatedAt: number;
};
export type LeadActivity = {
  id: string;
  kind: string;
  body: string | null;
  actorId: string | null;
  actorName: string | null;
  createdAt: number;
};
export type LeadPage = {
  lead: LeadDetail;
  client: { id: string; code: string | null; name: string | null } | null;
  proposal: { id: string; status: string | null } | null;
  /** M4.5 (ADM-PROP-10): the client's decision on the lead's proposal, when there is one. */
  decision?: {
    status: string;
    at: number;
    reason: string | null;
    note: string | null;
    contactName: string | null;
  } | null;
  duplicates: {
    id: string;
    ref: string;
    stage: LeadStage;
    createdAt: number;
    relation: "earlier" | "later";
  }[];
  timeline: { items: LeadActivity[]; next: string | null };
};
export type LeadsQuery = {
  limit?: "25" | "50" | undefined;
  stage?: LeadStage | undefined;
  owner?: string | undefined;
  source?: "web" | "manual" | undefined;
  service?: string | undefined;
  overdue?: "1" | undefined;
  deletion?: "1" | undefined;
  sort?: "created" | "activity" | "next_action" | undefined;
  dir?: "asc" | "desc" | undefined;
  q?: string | undefined;
  after?: string | undefined;
  before?: string | undefined;
};
export type BoardColumn = { stage: LeadStage; count: number; leads: LeadItem[]; next: string | null };
/** A member a lead can be assigned to; the work email tells two members with the same name apart (final sweep A20). */
export type Assignee = { id: string; name: string; email: string };
export type NewLead = {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  country?: string | null;
  serviceCode?: string | null;
  message?: string | null;
  ownerId?: string | null;
  nextActionAt?: number | null;
  nextActionNote?: string | null;
  /**
   * FX-3 (ADM-LEAD-01): the quote form's answers, given by hand. A band needs its currency and must be one of `budgetBandOptions(currency)`; the timeline
   * one of `TIMELINE_LABELS` (core `form-labels`). Anything else is a 400.
   */
  currency?: Currency | null;
  budgetBand?: string | null;
  timeline?: string | null;
};
/**
 * FX-3 round 2 (docs/13 2026-10-29): a manual lead's `currency`, `budgetBand` and `timeline` can be changed, with the creation checks on the
 * values the lead ends up with (a band needs its own currency: change both together); anything else is a 400. A website lead's answers are
 * fixed: changing one is a 409 `lead_answers_fixed`.
 */
export type LeadPatch = Omit<Partial<NewLead>, "serviceCode" | "message"> & {
  expectedUpdatedAt: number;
};
export type ReplyTemplateFilled = { id: string; label: string; subject: string; body: string };
export type ConvertInput = {
  type: "business" | "individual";
  country: string;
  gstStatus: GstStatus;
  gstin?: string;
  /** Required for registered and unregistered Indian clients (defaults to the GSTIN's for registered ones). */
  stateCode?: string;
  /** The new contact is the billing contact (and may see finance by default). */
  billingContact?: boolean;
  currency: Currency;
  legalName?: string;
  displayName?: string;
};
export type Changed = { ok: true; changed: boolean; updatedAt: number };
/** A passed tax check's notes (07-J): `gstin_state_mismatch` today, never a block. */
export type TaxWarning = { code: string; message: string };

// Clients and contacts (M3.3, ADM-CLI-01..05): the shapes of apps/admin/worker/clients.ts.
export type GstStatus = "registered" | "unregistered" | "overseas";
export type Currency = "INR" | "USD";
export type ClientType = "business" | "individual";
export type Address = {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  stateCode?: string;
  postalCode?: string;
  country: string;
};
export type ReminderPolicy = { enabled: boolean; offsetsDays?: number[] };
/** What every role that reads clients sees. */
export type ClientView = {
  id: string;
  code: string;
  legalName: string;
  displayName: string;
  type: ClientType;
  country: string;
  gstStatus: GstStatus;
  gstin: string | null;
  stateCode: string | null;
  billingAddress: Address | null;
  currency: Currency;
  serviceAddress: Address | null;
  tags: string[] | null;
  notes: string | null;
  legalHold: boolean;
  createdAt: number;
  /** Send back as `expectedUpdatedAt` with the next PATCH (details or billing). */
  updatedAt: number;
  // Only for a role with `clients.finance.read` (the API leaves them out for Sales).
  paymentTermsDays?: number | null;
  reminderPolicy?: ReminderPolicy | null;
  careAutoIssue?: boolean;
  attachPdf?: boolean;
  /** M5.4: the owner who turned automatic care invoices on (null: nobody); `active` false means that owner is gone, so the switch is not in effect. */
  /** `at`: when it was turned on (UTC ms, from the audit log); null when no audit row says so. */
  careAutoIssueBy?: { id: string; name: string | null; active: boolean; at?: number | null } | null;
};
export type MarketingConsent = { granted: boolean; at?: number; source?: string; withdrawnAt?: number };
export type ContactView = {
  id: string;
  clientId: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
  isBilling: boolean;
  portalAccess: boolean;
  canSeeFinance: boolean;
  marketingConsent: MarketingConsent | null;
  bouncedAt: number | null;
  anonymisedAt: number | null;
  legalHold: boolean;
  createdAt: number;
  updatedAt: number;
};
export type ClientPage = {
  client: ClientView;
  contacts: ContactView[];
  moreContacts: boolean;
  /** Where "Show more" continues: pass it as `after` to GET /clients/:id/contacts. Null when there is no more. */
  contactsNext: string | null;
  /** Contacts that are not anonymised (the list keeps the tombstones). */
  liveContactCount: number;
  /** An individual whose personal details were removed: nothing new can be added to it (client_anonymised). */
  anonymised: boolean;
  sourceLead: { id: string; ref: string } | null;
  /** Only for a finance role: an invoice exists, so the currency can't change. */
  currencyLocked?: boolean;
};
export type ClientsQuery = {
  limit?: "25" | "50" | undefined;
  q?: string | undefined;
  gstStatus?: GstStatus | undefined;
  currency?: Currency | undefined;
  after?: string | undefined;
  before?: string | undefined;
};
export type ContactInput = {
  name: string;
  email: string;
  phone?: string | null;
  title?: string | null;
  isPrimary?: true;
  isBilling?: boolean;
  portalAccess?: boolean;
  canSeeFinance?: boolean;
  marketingConsent?: boolean;
};
export type NewClientInput = {
  legalName: string;
  displayName?: string;
  type: ClientType;
  country: string;
  gstStatus: GstStatus;
  gstin?: string;
  stateCode?: string;
  currency: Currency;
  serviceAddress?: Address;
  tags?: string[];
  notes?: string | null;
  contact?: ContactInput;
};
export type ClientPatch = {
  expectedUpdatedAt: number;
  legalName?: string;
  displayName?: string;
  type?: ClientType;
  serviceAddress?: Address | null;
  tags?: string[] | null;
  notes?: string | null;
};
export type BillingPatch = {
  expectedUpdatedAt: number;
  country?: string;
  gstStatus?: GstStatus;
  gstin?: string | null;
  stateCode?: string | null;
  billingAddress?: Address | null;
  currency?: Currency;
  paymentTermsDays?: number | null;
  reminderPolicy?: ReminderPolicy | null;
  careAutoIssue?: boolean;
  attachPdf?: boolean;
};
export type ContactPatch = Partial<Omit<ContactInput, "name" | "email">> & {
  expectedUpdatedAt: number;
  name?: string;
  email?: string;
};
export type ClientActivity = {
  id: string;
  at: number;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: Record<string, unknown> | null;
};
export const EXPORT_PARTS = [
  "leads",
  "lead_activities",
  "sessions",
  "magic_links",
  "acceptances",
  "documents",
  "email_log",
  "audit_log",
  "access_log",
  "notes",
  "files",
] as const;
export type ExportPart = (typeof EXPORT_PARTS)[number];
export type ExportSummary = {
  contact: Record<string, unknown>;
  client: Record<string, unknown> | null;
  suppression: Record<string, unknown> | null;
  manifest: ExportPart[];
};
export type ExportPage = { part: ExportPart; items: Record<string, unknown>[]; next: string | null };
export type EraseMode = "erase" | "anonymise";

// Projects, milestones, notes and files (M3.4, ADM-PRJ-01..05): the shapes of apps/admin/worker/{projects,notes,files}.ts.
export type ProjectStatus = "planned" | "active" | "on_hold" | "completed" | "cancelled";
export type MilestoneStatus = "pending" | "ready_to_bill" | "invoiced" | "paid";
export type ProjectView = {
  id: string;
  code: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  sourceDocumentId: string | null;
  name: string;
  status: ProjectStatus;
  /** ISO dates (YYYY-MM-DD), IST days as typed. */
  startDate: string | null;
  targetDate: string | null;
  ownerId: string | null;
  ownerName: string | null;
  currency: Currency;
  budgetMinor: number | null;
  createdAt: number;
  /** Send back as `expectedUpdatedAt` with the next PATCH. */
  updatedAt: number;
};
export type MilestoneView = {
  id: string;
  projectId: string;
  position: number;
  title: string;
  amountMinor: number | null;
  pctBp: number | null;
  /** The amount, or the percentage of the budget (half up); null for a percentage with no budget. */
  resolvedMinor: number | null;
  dueDate: string | null;
  status: MilestoneStatus;
  deliveredAt: number | null;
  documentId: string | null;
  /** The advance (Start project's first instalment): billable while pending, wherever it sits in the order. */
  isAdvance: boolean;
  createdAt: number;
  updatedAt: number;
};
export type NoteVisibility = "internal" | "shared";
export type NoteView = {
  id: string;
  clientId: string;
  projectId: string | null;
  visibility: NoteVisibility;
  bodyMd: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: number;
  updatedAt: number;
};
export type FileView = {
  id: string;
  clientId: string;
  projectId: string | null;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  shared: boolean;
  uploadedBy: string | null;
  uploadedByName: string | null;
  createdAt: number;
};
/** FX-3: one currency of a project's billed figure (worker/figures.ts `ProjectBilled`); minor units, tax included. */
export type ProjectBilled = {
  currency: Currency;
  billedMinor: number;
  creditedMinor: number;
  /** M6.1 (07-ZH line 17 "Paid"): money on the project's debit documents, from the ledger; and the TDS on them. */
  paidMinor: number;
  tdsMinor: number;
};
/**
 * FX-3 (ADM-CLI-03): one currency of a client's Overview figures (worker/figures.ts `ClientFigures`); minor units, tax included. Billed is the statement's
 * debit column over all time, the balance what it owes now. M6.1: collected, credit held, TDS and the excess; the statement closes at balance − excess − credit.
 */
export type ClientFigures = {
  currency: Currency;
  billedMinor: number;
  creditedMinor: number;
  balanceMinor: number;
  overdueMinor: number;
  overdueCount: number;
  /** M6.1: TDS recorded on its debit documents. */
  tdsMinor: number;
  /** M6.1: settled above what its debit documents owe (paid + credited + TDS − total, where positive). */
  excessMinor: number;
  /** M6.1 (07-ZH line 17 "Collected"): its confirmed payments, all time. */
  collectedMinor: number;
  /** M6.1 (07-ZH line 10 "Credit held"): what those payments hold unallocated. */
  creditMinor: number;
};
export type ClientFinance =
  | { available: true; asOf: string; currencies: ClientFigures[] }
  | { available: false; reason: "anonymised" };
export type ProjectPage = {
  project: ProjectView;
  milestones: MilestoneView[];
  /** The client is an anonymised individual: the screens are read-only. */
  clientAnonymised: boolean;
  milestoneTotals: { totalMinor: number; mismatch: boolean };
  recentNotes: NoteView[];
  recentFiles: FileView[];
  figures: {
    /**
     * FX-3 (ADM-PRJ-05): billed from the project's issued invoices and debit notes, and its credit notes, by currency (the client statement's rules).
     * Absent for a role without `clients.finance.read` (Sales); `available: false` for an anonymised client. "Paid" arrives with payments (M6).
     */
    billed?: { available: true; currencies: ProjectBilled[] } | { available: false; reason: "anonymised" };
    /** M3.5: the time logged on the project (totals only, the same for every role). */
    hours:
      | { available: true; totalMinutes: number; billableMinutes: number }
      | { available: false; arrivesWith: string };
  };
};
export type ProjectsQuery = {
  limit?: "25" | "50" | undefined;
  q?: string | undefined;
  status?: ProjectStatus | undefined;
  clientId?: string | undefined;
  ownerId?: string | undefined;
  after?: string | undefined;
  before?: string | undefined;
};
export type NewProjectInput = {
  clientId: string;
  name: string;
  startDate?: string | null;
  targetDate?: string | null;
  ownerId?: string | null;
  budgetMinor?: number | null;
};
export type ProjectPatch = Omit<Partial<NewProjectInput>, "clientId"> & { expectedUpdatedAt: number };
export type MilestoneInput = {
  title: string;
  amountMinor?: number | null;
  pctBp?: number | null;
  dueDate?: string | null;
};
export type MilestonePatch = Partial<MilestoneInput> & { expectedUpdatedAt: number };
/** Where a note or file belongs: a project, or the client itself. */
export type VaultScope = { kind: "project" | "client"; id: string };
const scopePath = (s: VaultScope) =>
  `/${s.kind === "project" ? "projects" : "clients"}/${encodeURIComponent(s.id)}`;
export type UploadResult = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: number;
};

// Care plans, time logs and the dashboard (M3.5, ADM-CARE-01, -03, ADM-TIME-01..03, ADM-DASH-01): the shapes of
// apps/admin/worker/{care,time-logs,dashboard}.ts. Hours are minutes; money is minor units in the plan's currency.
export type CareStatus = "active" | "paused" | "cancelled";
export type CareTier = "essential" | "growth" | "scale" | "dev_subscription" | "custom";
export type RolloverRule = "none" | "one_month";
export type CareTerms = {
  effectiveFrom: string;
  tier: CareTier;
  priceMinor: number;
  includedMinutes: number;
  aiOpsMinor: number | null;
  overageRateMinor: number | null;
  rollover: RolloverRule;
  createdAt: number;
};
/** One billing period's hours (core's `carePeriodUsage`). */
export type CareUsage = {
  period: { start: string; end: string };
  included: number;
  rolloverIn: number;
  available: number;
  used: number;
  nonBillable: number;
  remaining: number;
  overageMinutes: number;
  /** Before GST; null when there is overage and no rate. */
  overageMinor: number | null;
  rateMissing: boolean;
  rateMinor: number | null;
  burnBp: number | null;
  flag: "none" | "near" | "reached";
};
export type CarePlanBase = {
  id: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  currency: Currency;
  startDate: string;
  billingDay: number;
  status: CareStatus;
  pausedAt: number | null;
  cancelledAt: number | null;
  createdAt: number;
  /** Send back as `expectedUpdatedAt`. */
  updatedAt: number;
};
export type CarePlanTermsSummary = { current: CareTerms | null; pending: CareTerms | null };
export type CarePlanRow = CarePlanBase & { terms: CarePlanTermsSummary; usage: CareUsage | null };
export type CarePlanList = {
  today: string;
  carePlans: CarePlanRow[];
  next: string | null;
  prev: string | null;
};
export type CarePlanPage = {
  today: string;
  plan: CarePlanBase;
  terms: CarePlanTermsSummary;
  statusLog: { status: CareStatus; effectiveOn: string; createdAt: number }[];
  usage: CareUsage | null;
  /** Newest first, at most 12. */
  periods: CareUsage[];
  clientAnonymised: boolean;
  /** M5.4: overage goes on the next monthly care draft (never issued automatically); an older API still says it arrives later. */
  overage: {
    addToInvoice:
      | { available: true; via: "next_care_draft" | string }
      | { available: false; arrivesWith: string };
  };
  /** M5.4: the plan's billing (finance roles only; absent for Sales). Shape: lib/invoice-send.ts `CarePlanBilling`. */
  billing?: CarePlanBilling;
};
export type CarePlansQuery = {
  limit?: "25" | "50" | undefined;
  status?: CareStatus | undefined;
  clientId?: string | undefined;
  after?: string | undefined;
  before?: string | undefined;
};
export type CareDefaults = {
  currency: Currency;
  clientAnonymised: boolean;
  tiers: Record<
    CareTier,
    { priceMinor: number | null; includedMinutes: number | null; rollover: RolloverRule }
  >;
  aiOpsMinor: number | null;
  overageRateMinor: number | null;
  undecided: string[];
};
export type NewCarePlanInput = {
  clientId: string;
  tier: CareTier;
  priceMinor: number;
  includedMinutes: number;
  aiOpsMinor?: number | null;
  overageRateMinor?: number | null;
  rollover: RolloverRule;
  startDate: string;
  billingDay: number;
};
export type CareTermsInput = Partial<
  Pick<
    NewCarePlanInput,
    "tier" | "priceMinor" | "includedMinutes" | "aiOpsMinor" | "overageRateMinor" | "rollover"
  >
> & { expectedUpdatedAt: number };

export type TimeEntry = {
  id: string;
  userId: string;
  userName: string | null;
  workDate: string;
  minutes: number;
  billable: boolean;
  note: string | null;
  projectId: string | null;
  projectCode: string | null;
  carePlanId: string | null;
  carePlanClientCode: string | null;
  carePlanTier: CareTier | null;
  createdAt: number;
  updatedAt: number;
  /** The viewer may change it now: the owner always, the author for 7 days. */
  canEdit: boolean;
};
export type TimeQuery = {
  limit?: "25" | "50" | undefined;
  from?: string | undefined;
  to?: string | undefined;
  userId?: string | undefined;
  projectId?: string | undefined;
  carePlanId?: string | undefined;
  billable?: "1" | "0" | undefined;
  after?: string | undefined;
};
export type TimePage = {
  today: string;
  range: { from: string; to: string };
  entries: TimeEntry[];
  next: string | null;
  prev: string | null;
};
export type TimeWeekGroup = {
  userId: string;
  userName: string | null;
  projectId: string | null;
  projectCode: string | null;
  carePlanId: string | null;
  carePlanClientCode: string | null;
  workDate: string;
  minutes: number;
  billableMinutes: number;
  entries: number;
};
export type TimeWeek = {
  today: string;
  week: { start: string; end: string };
  groups: TimeWeekGroup[];
  truncated: boolean;
  dayTotals: { workDate: string; minutes: number; billableMinutes: number; entries: number }[];
  totalMinutes: number;
};
export type TimeWeekQuery = {
  start?: string | undefined;
  userId?: string | undefined;
  projectId?: string | undefined;
  carePlanId?: string | undefined;
};
export type TimeTargets = {
  projects: { id: string; code: string; name: string; status: ProjectStatus; clientCode: string }[];
  carePlans: { id: string; tier: CareTier | null; clientCode: string; clientName: string }[];
};
export type NewTimeInput = {
  userId?: string;
  workDate: string;
  minutes: number;
  projectId?: string | null;
  carePlanId?: string | null;
  note?: string | null;
  billable: boolean;
};
export type TimePatch = Partial<Omit<NewTimeInput, "userId">> & { expectedUpdatedAt: number };

export type DashboardTiles = {
  leads?: {
    openByStage: Record<string, number>;
    open: number;
    newLast7Days: number;
    overdue: { count: number; oldest: { id: string; ref: string; contactName: string; dueAt: number }[] };
  };
  /** The offers out and still acceptable, before tax, by currency (M4.3, ADM-DASH-01). */
  pipelineValue?: { asOf: string; byCurrency: { currency: Currency; count: number; taxableMinor: number }[] };
  /** M5.5b (LD80): the finance tiles (Owner, Accountant). Before M5.5b the API sent `{available: false}`. */
  finance?: FinanceTile | { available: false; arrivesWith?: unknown };
  /** FX-3 (A3 10): Planned projects count too. */
  projects?: { planned: number; active: number; onHold: number };
  milestones?: {
    windowDays: number;
    count: number;
    next: {
      id: string;
      projectId: string;
      projectCode: string | null;
      title: string;
      dueDate: string;
      status: MilestoneStatus;
    }[];
  };
  careBurn?: {
    counts: { active: number; notStarted: number; near: number; reached: number };
    truncated: boolean;
    rows: {
      planId: string;
      clientCode: string;
      clientName: string;
      tier: CareTier;
      period: { start: string; end: string };
      used: number;
      available: number;
      burnBp: number | null;
      flag: CareUsage["flag"];
      overageMinutes: number;
    }[];
  };
  myTime?: {
    week: { minutes: number; billableMinutes: number; start: string; end: string };
    today: { minutes: number; billableMinutes: number; date: string };
  };
  activity?: {
    days: number;
    items: {
      id: string;
      at: number;
      actor: string;
      action: string;
      entityType: string;
      entityId: string | null;
      ref: string | null;
      /** A document row's own type (the invoice family opens /invoices/:id, an offer /documents/:id); null for every other row. */
      docType: string | null;
      /** The record the row names no longer exists (a deleted draft, a purged lead): no title and no link. */
      gone: boolean;
      /** A document (or an approval of one) with no number yet: its title; null for an anonymised client's, or when it has none ("Untitled"). */
      title: string | null;
      /** A time entry logged against a project, as its audit row recorded it. */
      project: { id: string; code: string; name: string } | null;
      /** A time entry logged against a care plan: the plan and its client's code. */
      carePlan: { id: string; clientCode: string } | null;
    }[];
  };
};
export type Dashboard = { asOf: number; today: string; tiles: DashboardTiles };
/** One currency's invoiced figures (credit notes negative, voided and proformas left out); `inrTaxableMinor` is null when a USD document lacks its INR view. */
export type InvoicedByCurrency = {
  currency: Currency;
  documents: number;
  taxableMinor: number;
  totalMinor: number;
  inrTaxableMinor: number | null;
};
export type OwedByCurrency = { currency: Currency; count: number; balanceMinor: number };
/** The shape of apps/admin/worker/dashboard.ts `finance` (M5.5b, LD80). */
export type FinanceTile = {
  today: string;
  month: { from: string; to: string };
  fy: { label: string; from: string; to: string };
  invoiced: { month: InvoicedByCurrency[]; fy: InvoicedByCurrency[] };
  outstanding: OwedByCurrency[];
  overdue: {
    byCurrency: OwedByCurrency[];
    oldest: {
      id: string;
      number: string;
      clientCode: string;
      clientName: string;
      dueDate: string;
      currency: Currency;
      balanceMinor: number;
      daysOverdue: number;
    }[];
  };
  proformasAwaiting: OwedByCurrency[];
  exports:
    | {
        counts: { femaApproaching: number; femaOverdue: number; gstApproaching: number; gstOverdue: number };
        next: {
          id: string;
          number: string;
          clientCode: string;
          currency: Currency;
          outstandingMinor: number;
          stage: string;
          dueDate: string;
        }[];
      }
    | { available: false; reason: string };
  /** M6.1 (07-ZH line 16 "Collected this month"): confirmed payments this IST month and this FY, by currency. */
  collected:
    | {
        available: true;
        month: { currency: Currency; collectedMinor: number; count: number }[];
        fy: { currency: Currency; collectedMinor: number; count: number }[];
      }
    | { available: false; arrivesWith: string };
  /** M6.1 (07-ZH line 16 "Payments to check"): the Owner's count; another role gets `owner_only`. */
  paymentsToVerify:
    | { available: true; count: number }
    | { available: false; arrivesWith?: string; reason?: string };
};
export const isFinanceTile = (t: DashboardTiles["finance"]): t is FinanceTile =>
  t !== undefined && "invoiced" in t;

/** One line of a statement (M5.5b): core `StatementEntry`. */
export type StatementEntryView = {
  id: string;
  kind: "tax_invoice" | "export_invoice" | "debit_note" | "credit_note" | "receipt" | "tds";
  date: string;
  number: string;
  /** A credit note's invoice number (07-V §6 "Credit note against {number}"); null for every other kind. */
  againstNumber?: string | null;
  amountMinor: number;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
};
export type StatementPage = {
  from: string;
  to: string;
  currency: Currency;
  entries: StatementEntryView[];
  balanceBeforeMinor: number;
  range: { openingMinor: number; debitMinor: number; creditMinor: number; closingMinor: number };
  next: string | null;
};

/** A field the server refused (400 `invalid`): its dotted path in the request body and our own message. */
export type FieldIssue = { path: string; message: string };

type ApiErrorBody = {
  /** `details` (step 5): the worker's `err(..., details)`, e.g. `{ fy }` of `advance_lut_missing`, `{ stated, dueDays }` of `terms_due_days_mismatch`. */
  error?: { code: string; message: string; details?: unknown };
  request_id?: string;
  fields?: FieldIssue[];
  /** 422 `snapshot_invalid` (POST /catalogue/publish): the failing paths of the snapshot, never values. */
  paths?: string[];
  /** 422 `snapshot_invalid`: what the website needs that the snapshot lacks. */
  needs?: SiteNeedAnswer[];
  /** M4.5: 409 `recipient_invalid`. */
  contactIds?: unknown;
  /** M4.5: 409 `instalment_failed`. */
  missing?: unknown;
  /** M5.1: 409 `already_issued` (the number it was issued as) and 409 `issue_blocked` (the blockers). */
  number?: unknown;
  blockers?: unknown;
  /** M5.1 and ADM-INV-10: a refused void or withdraw (409) names every reason (codes) beside the first one's code. */
  reasons?: unknown;
  /** M5.3: the note refusals' figures (`remaining`, `line`, `closestMinor`), the open draft (`draftId`), the last day (`date`). */
  remaining?: unknown;
  line?: unknown;
  closestMinor?: unknown;
  draftId?: unknown;
  date?: unknown;
};

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
    /** 400 `invalid`: which fields, with the server's message for each. */
    readonly fields: FieldIssue[] = [],
    /** 422 `snapshot_invalid`: the snapshot paths that failed ("items.3.unit"). */
    readonly paths: string[] = [],
    /** 422 `snapshot_invalid`: what the website needs that the snapshot lacks. */
    readonly needs: SiteNeedAnswer[] = [],
    /** M4.5: 409 `recipient_invalid` names the contacts (`contactIds`); 409 `instalment_failed` the empty client fields (`missing`).
     * M5.1: 409 `already_issued` carries the `number`, 409 `issue_blocked` the `blockers` (codes, with a line's position). */
    readonly extra: {
      contactIds?: string[];
      missing?: string[];
      number?: string;
      blockers?: { code: string; line?: number; remaining?: number; fy?: string; date?: string }[];
      /** M5.3: what can still be credited (`credit_exceeds_remaining`, `line_credit_exceeds` with its `line`, 0-based), the nearest amount a credit
       * note can be (`credit_amount_unfit`), the open draft (`note_draft_exists`) and the last day (`credit_deadline_passed`). */
      remaining?: number;
      line?: number;
      closestMinor?: number | null;
      draftId?: string;
      date?: string;
      fy?: string;
      /** `error.details.reason` (`debit_tax_only_invalid`: `odd_amount`, 07-W 5.9). */
      reason?: string;
      /** FX-5: 400 `terms_due_days_mismatch`, the days the terms state that differ (`stated`) and Settings › Payment terms' days (`dueDays`). */
      termsDueDays?: { stated: number[]; dueDays: number };
      /** M6.1: the payment routes' `error.details`, its plain values only (`femaDue`, `latest`, `documentId`, `balanceMinor`, `receivedOn`). */
      details?: Record<string, string | number>;
      /** ADM-INV-10: a refused void or withdraw (409) names every reason (codes), so the screen picks its own line (a proforma's void points to Withdraw). */
      reasons?: string[];
    } = {},
  ) {
    super(message);
  }
}

/** What the step-up dialog answers: true once a fresh code was accepted, false if the person cancelled. */
type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;
let unauthenticatedHandler: (() => void) | null = null;

/** The step-up dialog registers itself here (one per app). Returns the unregister function. */
export function onStepUpRequired(handler: StepUpHandler) {
  stepUpHandler = handler;
  return () => {
    if (stepUpHandler === handler) stepUpHandler = null;
  };
}

/** The session provider registers itself here: a signed-in call answered 401 means the session has ended. */
export function onUnauthenticated(handler: () => void) {
  unauthenticatedHandler = handler;
  return () => {
    if (unauthenticatedHandler === handler) unauthenticatedHandler = null;
  };
}

// When the last step-up runs out (UTC ms), as the server said: from /auth/me and every accepted code. Screens use it to
// ask for the code before unlocking a form (bank details) or to leave the code out of a confirmation that doesn't need
// it. The server still decides: a refused request opens the step-up dialog as before.
let stepUpUntil: number | null = null;
const STEP_UP_MARGIN_MS = 30_000;

/** True while a fresh step-up is still good for at least another 30 seconds. */
export const stepUpActive = (now = Date.now()) =>
  stepUpUntil !== null && stepUpUntil - STEP_UP_MARGIN_MS > now;

export function noteStepUp(until: number | null) {
  stepUpUntil = until;
}

/** Ask for the code now unless a step-up is already active. Resolves false if the person cancels. */
export async function ensureStepUp(): Promise<boolean> {
  if (stepUpActive()) return true;
  if (!stepUpHandler) return false;
  return stepUpHandler();
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** `raw`: a binary body sent as it is (`application/octet-stream`; the signature image), instead of JSON. */
type Options = { method?: Method; body?: unknown; raw?: Blob; signedIn?: boolean };

/** No answer at all (the fetch itself failed): the only case that reads as offline. */
export const NETWORK = "Couldn't reach the server. Check your connection and try again.";
/** The words of the Worker's own unhandled error (`worker/app.ts` onError), for an error answer that carries none. */
const SERVER_ERROR = "Something went wrong";

/**
 * The error an answer carries, one rule for every path that reads one (`request`, the file upload, the statement PDF poll; final sweep A15 and
 * review 4): our JSON error with its code and words; anything else (a Cloudflare 502 or 503 page, a CPU-limit page, an error without words,
 * no body) the Worker's own unhandled error, in its words or the caller's `fallback`. The server answered, so it is never `network` (offline).
 */
export function answerError(
  data: unknown,
  fallback: string = SERVER_ERROR,
): { code: string; message: string } {
  const err = typeof data === "object" && data !== null ? (data as ApiErrorBody).error : undefined;
  const code = typeof err?.code === "string" && err.code !== "" ? err.code : null;
  if (code && typeof err?.message === "string" && err.message !== "") return { code, message: err.message };
  return { code: code ?? "internal", message: fallback };
}

async function send<T>(path: string, { method, body, raw, signedIn = true }: Options): Promise<T> {
  const m: Method = method ?? (body === undefined && raw === undefined ? "GET" : "POST");
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: m,
      headers:
        raw !== undefined
          ? { "Content-Type": "application/octet-stream" }
          : body === undefined
            ? {}
            : { "Content-Type": "application/json" },
      body: raw !== undefined ? raw : body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new RequestError(0, "network", NETWORK);
  }
  const data = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (res.ok) return data;
  // The server answered, so this is never "offline" (final sweep A15): `answerError`.
  const e = answerError(data);
  // The worker's `error.details` (`err(..., details)`): `advance_lut_missing` sends `{ fy }`, `debit_tax_only_invalid` `{ reason }`. The last day of
  // `credit_deadline_passed` is a top-level `date` (M5.3).
  const inner = data.error?.details;
  const details = typeof inner === "object" && inner !== null ? (inner as Record<string, unknown>) : {};
  const fy = typeof details.fy === "string" ? details.fy : undefined;
  const date = typeof data.date === "string" ? data.date : undefined;
  // FX-5: `terms_due_days_mismatch` sends `{ stated, dueDays }` (the days the terms state that differ, Settings › Payment terms' days).
  const stated = Array.isArray(details.stated) ? details.stated.filter(isDays) : [];
  const termsDueDays =
    e.code === "terms_due_days_mismatch" && stated.length > 0 && isDays(details.dueDays)
      ? { stated, dueDays: details.dueDays }
      : undefined;
  const error = new RequestError(
    res.status,
    e.code,
    e.message,
    data.request_id ?? null,
    Array.isArray(data.fields) ? data.fields : [],
    Array.isArray(data.paths) ? data.paths.filter((p) => typeof p === "string") : [],
    Array.isArray(data.needs)
      ? data.needs.filter(
          (n: unknown): n is SiteNeedAnswer =>
            typeof n === "object" &&
            n !== null &&
            typeof (n as { code?: unknown }).code === "string" &&
            typeof (n as { missing?: unknown }).missing === "string",
        )
      : [],
    {
      ...(Array.isArray(data.contactIds) ? { contactIds: strings(data.contactIds) } : {}),
      ...(Array.isArray(data.missing) ? { missing: strings(data.missing) } : {}),
      ...(typeof data.number === "string" ? { number: data.number } : {}),
      ...(Array.isArray(data.blockers) ? { blockers: blockersOf(data.blockers) } : {}),
      ...(typeof data.remaining === "number" ? { remaining: data.remaining } : {}),
      ...(typeof data.line === "number" ? { line: data.line } : {}),
      ...(typeof data.closestMinor === "number" || data.closestMinor === null
        ? { closestMinor: data.closestMinor as number | null }
        : {}),
      ...(typeof data.draftId === "string" ? { draftId: data.draftId } : {}),
      ...(date !== undefined ? { date } : {}),
      ...(fy !== undefined ? { fy } : {}),
      ...(typeof details.reason === "string" ? { reason: details.reason } : {}),
      ...(termsDueDays ? { termsDueDays } : {}),
      ...(Object.keys(plainDetails(details)).length > 0 ? { details: plainDetails(details) } : {}),
      ...(Array.isArray(data.reasons) ? { reasons: strings(data.reasons) } : {}),
    },
  );
  if (signedIn && res.status === 401 && e.code === "unauthenticated") unauthenticatedHandler?.();
  throw error;
}

/** M6.1: the payment routes' `error.details` keys the screens read (string or number values only; nothing else is copied). */
const PAYMENT_DETAIL_KEYS = [
  "femaDue",
  "latest",
  "documentId",
  "balanceMinor",
  "excessMinor",
  "releasableMinor",
  "receivedOn",
  "clientCode",
  "clientName",
  "paymentId",
] as const;
const plainDetails = (d: Record<string, unknown>): Record<string, string | number> =>
  Object.fromEntries(
    PAYMENT_DETAIL_KEYS.flatMap((k) => {
      const v = d[k];
      return typeof v === "string" || typeof v === "number" ? [[k, v] as const] : [];
    }),
  );

const strings = (xs: unknown[]): string[] => xs.filter((x): x is string => typeof x === "string");

const isDays = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

/** The blockers of a 409 `issue_blocked`: the code, and the line, amount, year or date its sentence names (M5.2: `lut_missing` has `fy`,
 * `fx_missing` `date`; M5.3: a note's `remaining` and `date`). */
const blockersOf = (
  xs: unknown[],
): { code: string; line?: number; remaining?: number; fy?: string; date?: string }[] =>
  xs.flatMap((x) => {
    if (typeof x !== "object" || x === null || typeof (x as { code?: unknown }).code !== "string") return [];
    const b = x as { code: string; line?: unknown; remaining?: unknown; fy?: unknown; date?: unknown };
    return [
      {
        code: b.code,
        ...(typeof b.line === "number" ? { line: b.line } : {}),
        ...(typeof b.remaining === "number" ? { remaining: b.remaining } : {}),
        ...(typeof b.fy === "string" ? { fy: b.fy } : {}),
        ...(typeof b.date === "string" ? { date: b.date } : {}),
      },
    ];
  });

/** One request; if it needs a fresh step-up, ask for it and send the same request once more. */
export async function request<T>(path: string, options: Options = {}): Promise<T> {
  try {
    return await send<T>(path, options);
  } catch (e) {
    if (!(e instanceof RequestError) || e.code !== "step_up_required" || !stepUpHandler) throw e;
    const confirmed = await stepUpHandler();
    if (!confirmed) throw new RequestError(403, "step_up_cancelled", "Cancelled. Nothing was changed.");
    return send<T>(path, options);
  }
}

/** A query string from the set values only ("" when none). */
export function qs(params: Record<string, string | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const pub = { signedIn: false } as const;

export const api = {
  // Sign-in (public)
  salt: (email: string) =>
    request<{ salt: string; params: ArgonParams }>("/auth/salt", { ...pub, body: { email } }),
  /**
   * `turnstile`: only once the server has asked for the check (401 `turnstile_required`, after 3 failures; M2.4b,
   * ADM-AUTH-06). A normal sign-in sends none.
   */
  login: (email: string, clientHash: string, turnstile?: string) =>
    request<{ challenge: string }>("/auth/login", {
      ...pub,
      body: turnstile ? { email, clientHash, turnstile } : { email, clientHash },
    }),
  totp: (challenge: string, code: string) =>
    request<{ user: User }>("/auth/totp", { ...pub, body: { challenge, code } }),
  recovery: (challenge: string, code: string) =>
    request<{ user: User }>("/auth/recovery", { ...pub, body: { challenge, code } }),
  logout: () => request<{ ok: true }>("/auth/logout", { ...pub, body: {} }),

  // Invite acceptance (public)
  inviteStart: (token: string) =>
    request<{ email: string; salt: string; params: ArgonParams }>("/auth/invite/start", {
      ...pub,
      body: { token },
    }),
  inviteFinish: (token: string, clientHash: string, name: string) =>
    request<{ totpUri: string; secret: string; challenge: string }>("/auth/invite/finish", {
      ...pub,
      body: { token, clientHash, name },
    }),
  inviteTotp: (challenge: string, code: string) =>
    request<{ user: User; recoveryCodes: string[] }>("/auth/invite/totp", {
      ...pub,
      body: { challenge, code },
    }),

  // The signed-in member's own account
  me: () =>
    request<Me>("/auth/me").then((r) => {
      noteStepUp(r.stepUpUntil);
      return r;
    }),
  stepUp: (code: string) =>
    send<{ ok: true; stepUpUntil: number }>("/auth/step-up", { body: { code } }).then((r) => {
      noteStepUp(r.stepUpUntil);
      return r;
    }),
  sessions: () => request<{ sessions: Session[]; recovery_codes_remaining: number }>("/auth/sessions"),
  revokeSession: (id: string) =>
    request<{ ok: true }>(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  revokeAllMine: () => request<{ ok: true }>("/auth/sessions/revoke-all", { body: {} }),
  regenerateRecoveryCodes: () =>
    request<{ recoveryCodes: string[] }>("/auth/recovery/regenerate", { body: {} }),

  // Staff and invites (owner)
  users: (q: UsersQuery = {}) => request<Page<"users", StaffMember>>(`/users${qs(q)}`),
  invites: () => request<{ invites: Invite[] }>("/users/invites"),
  invite: (email: string, role: Role) => request<InviteLink>("/users/invites", { body: { email, role } }),
  revokeInvite: (tokenHash: string) =>
    request<{ ok: true }>(`/users/invites/${encodeURIComponent(tokenHash)}/revoke`, { body: {} }),
  changeRole: (id: string, role: Role) =>
    request<{ ok: true; changed: boolean }>(`/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { role },
    }),
  deactivate: (id: string) =>
    request<{ ok: true }>(`/users/${encodeURIComponent(id)}/deactivate`, { body: {} }),
  reactivate: (id: string) =>
    request<{ ok: true }>(`/users/${encodeURIComponent(id)}/reactivate`, { body: {} }),
  resetTwoStep: (id: string) =>
    request<InviteLink>(`/users/${encodeURIComponent(id)}/reset-2fa`, { body: {} }),
  revokeAllStaff: () => request<{ ok: true }>("/users/sessions/revoke-all", { body: {} }),

  // Settings (ADM-SET-01..10)
  settingsOverview: () => request<{ groups: OverviewGroup[] }>("/settings"),
  settingsGroup: <K extends JsonGroup>(group: K) => request<SettingsDoc<K>>(`/settings/groups/${group}`),
  saveSettingsGroup: <K extends JsonGroup>(
    group: K,
    version: number,
    value: Settings[K],
    extra: Record<string, unknown> = {},
  ) => request<Saved>(`/settings/groups/${group}`, { method: "PUT", body: { version, value, ...extra } }),
  gateways: () => request<SettingsDoc<"gateways">>("/settings/gateways"),
  saveGateways: (version: number, value: Settings["gateways"]) =>
    request<Saved>("/settings/gateways", { method: "PUT", body: { version, value } }),
  bank: () => request<{ accounts: BankAccount[] }>("/settings/bank"),
  saveBank: (kind: BankKind, body: BankInput) =>
    request<{ ok: true; changed: boolean; updatedAt: number | null }>(`/settings/bank/${kind}`, {
      method: "PUT",
      body,
    }),
  terms: () =>
    request<{ blocks: TermsBlock[]; meta: { verify: string; usedByNote: string } }>("/settings/terms"),
  termsHistory: (block: TermsBlockId) =>
    request<{ block: TermsBlockId; label: string; versions: TermsVersion[] }>(`/settings/terms/${block}`),
  saveTerms: (block: TermsBlockId, body: string) =>
    request<Saved & { sha256?: string }>(`/settings/terms/${block}`, { body: { body } }),
  testEmail: (template: string) =>
    request<{ ok: true; queued: true; template: string }>("/settings/email/test-send", {
      body: { template },
    }),

  // The bell, search and the audit log (ADM-G-09, ADM-G-05, ADM-AUD-02)
  notifications: (after?: string) =>
    request<{ notifications: Notification[]; unread: number; next: string | null }>(
      `/notifications${qs({ limit: "20", after })}`,
    ),
  readNotification: (id: string) =>
    request<{ ok: true }>(`/notifications/${encodeURIComponent(id)}/read`, { body: {} }),
  readAllNotifications: () => request<{ ok: true }>("/notifications/read-all", { body: {} }),
  search: (q: string) => request<{ q: string; groups: SearchGroupData[] }>(`/search${qs({ q })}`),
  audit: (q: AuditQuery = {}) => request<Page<"entries", AuditEntry>>(`/audit${qs(q)}`),
  /** One page of the CSV export: same rows as `audit`, but every page needs a fresh step-up (403 `step_up_required` opens the dialog) and is audited. */
  auditExport: (q: AuditQuery = {}) => request<Page<"entries", AuditEntry>>(`/audit/export${qs(q)}`),

  // Leads (M3.2)
  leads: (q: LeadsQuery = {}) =>
    request<Page<"leads", LeadItem> & { purgeMode?: "live" | "dry_run" }>(`/leads${qs(q)}`),
  leadsBoard: () => request<{ stages: BoardColumn[] }>("/leads/board"),
  leadAssignees: () => request<{ me: string; assignees: Assignee[] }>("/leads/assignees"),
  lead: (id: string) => request<LeadPage>(`/leads/${encodeURIComponent(id)}`),
  leadActivities: (id: string, after: string) =>
    request<{ items: LeadActivity[]; next: string | null }>(
      `/leads/${encodeURIComponent(id)}/activities${qs({ after })}`,
    ),
  createLead: (body: NewLead) => request<{ id: string; ref: string }>("/leads", { body }),
  updateLead: (id: string, body: LeadPatch) =>
    request<Changed>(`/leads/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  addLeadNote: (id: string, body: string) =>
    request<{ id: string }>(`/leads/${encodeURIComponent(id)}/notes`, { body: { body } }),
  setLeadStage: (id: string, stage: LeadStage, lostReason?: LostReason) =>
    request<Changed>(`/leads/${encodeURIComponent(id)}/stage`, {
      body: lostReason ? { stage, lostReason } : { stage },
    }),
  replyTemplates: (id: string) =>
    request<{ templates: ReplyTemplateFilled[] }>(`/leads/${encodeURIComponent(id)}/reply-templates`),
  replyToLead: (id: string, body: { subject: string; body: string; templateId?: string }) =>
    request<{ ok: true; queued: true; id: string }>(`/leads/${encodeURIComponent(id)}/reply`, { body }),
  convertLead: (id: string, body: ConvertInput) =>
    request<{
      clientId: string;
      clientCode: string;
      contactId: string;
      proposalId: string;
      warnings?: TaxWarning[];
    }>(`/leads/${encodeURIComponent(id)}/convert`, { body }),

  // Clients and contacts (M3.3)
  clients: (q: ClientsQuery = {}) => request<Page<"clients", ClientView>>(`/clients${qs(q)}`),
  client: (id: string) => request<ClientPage>(`/clients/${encodeURIComponent(id)}`),
  createClient: (body: NewClientInput) =>
    request<{ id: string; code: string; contactId?: string; warnings: TaxWarning[] }>("/clients", { body }),
  updateClient: (id: string, body: ClientPatch) =>
    request<Changed>(`/clients/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  updateBilling: (id: string, body: BillingPatch) =>
    request<Changed & { warnings: TaxWarning[] }>(`/clients/${encodeURIComponent(id)}/billing`, {
      method: "PATCH",
      body,
    }),
  /** FX-3 (ADM-CLI-03): the Overview figures (finance roles). Shape: worker/figures.ts `ClientFinanceAnswer`. */
  clientFinance: (id: string) => request<ClientFinance>(`/clients/${encodeURIComponent(id)}/finance`),
  /** M5.5b (ADM-CLI-04, LD78): one page (≤ 50 entries) of the statement of one currency; `after` is the previous page's `next`. */
  clientStatement: (id: string, q: { from: string; to: string; currency?: Currency; after?: string }) =>
    request<StatementPage>(`/clients/${encodeURIComponent(id)}/statement${qs(q)}`),
  /** M5.5b (LD79): ask for the statement PDF; 202 `{id}`, then poll `statementPdfUrl`. */
  clientStatementPdf: (id: string, body: { from: string; to: string; currency: Currency }) =>
    request<{ id: string }>(`/clients/${encodeURIComponent(id)}/statement/pdf`, { body }),
  clientActivity: (id: string, after?: string) =>
    request<{ entries: ClientActivity[]; next: string | null }>(
      `/clients/${encodeURIComponent(id)}/activity${qs({ after })}`,
    ),
  clientContacts: (id: string, after?: string) =>
    request<{ contacts: ContactView[]; next: string | null }>(
      `/clients/${encodeURIComponent(id)}/contacts${qs({ limit: "50", after })}`,
    ),
  addContact: (clientId: string, body: ContactInput) =>
    request<{ id: string }>(`/clients/${encodeURIComponent(clientId)}/contacts`, { body }),
  updateContact: (id: string, body: ContactPatch) =>
    request<Changed>(`/contacts/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  /** Owner only, step-up: the summary and the manifest of the export. */
  exportSummary: (id: string) =>
    request<ExportSummary>(`/contacts/${encodeURIComponent(id)}/export`, { body: {} }),
  /** Owner only, step-up: one page (at most 50 rows) of one part of the export. */
  exportPart: (id: string, part: ExportPart, after?: string) =>
    request<ExportPage>(`/contacts/${encodeURIComponent(id)}/export`, {
      body: after ? { part, after } : { part },
    }),
  eraseContact: (id: string, mode: EraseMode, reason: string) =>
    request<{ ok: true; mode: EraseMode }>(`/contacts/${encodeURIComponent(id)}/erase`, {
      body: { mode, reason },
    }),

  // Projects, milestones, notes and files (M3.4)
  projects: (q: ProjectsQuery = {}) => request<Page<"projects", ProjectView>>(`/projects${qs(q)}`),
  project: (id: string) => request<ProjectPage>(`/projects/${encodeURIComponent(id)}`),
  createProject: (body: NewProjectInput) =>
    request<{ id: string; code: string; updatedAt: number }>("/projects", { body }),
  updateProject: (id: string, body: ProjectPatch) =>
    request<Changed>(`/projects/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  setProjectStatus: (id: string, to: ProjectStatus) =>
    request<{ ok: true; status: ProjectStatus; updatedAt: number }>(
      `/projects/${encodeURIComponent(id)}/status`,
      { body: { to } },
    ),
  clientProjects: (clientId: string, after?: string) =>
    request<{ projects: ProjectView[]; next: string | null }>(
      `/clients/${encodeURIComponent(clientId)}/projects${qs({ after })}`,
    ),
  addMilestone: (projectId: string, body: MilestoneInput) =>
    request<{ id: string; updatedAt: number }>(`/projects/${encodeURIComponent(projectId)}/milestones`, {
      body,
    }),
  updateMilestone: (id: string, body: MilestonePatch) =>
    request<Changed>(`/milestones/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  setMilestoneStatus: (id: string, to: "pending" | "ready_to_bill") =>
    request<{ ok: true; status: MilestoneStatus; updatedAt: number }>(
      `/milestones/${encodeURIComponent(id)}/status`,
      { body: { to } },
    ),
  deleteMilestone: (id: string) =>
    request<{ ok: true }>(`/milestones/${encodeURIComponent(id)}`, { method: "DELETE" }),
  reorderMilestones: (projectId: string, ids: string[]) =>
    request<{ ok: true }>(`/projects/${encodeURIComponent(projectId)}/milestones/order`, { body: { ids } }),
  notes: (scope: VaultScope, after?: string) =>
    request<{ notes: NoteView[]; next: string | null }>(`${scopePath(scope)}/notes${qs({ after })}`),
  addNote: (scope: VaultScope, bodyMd: string, visibility: NoteVisibility) =>
    request<{ id: string; createdAt: number; updatedAt: number }>(`${scopePath(scope)}/notes`, {
      body: { bodyMd, visibility },
    }),
  updateNote: (
    id: string,
    body: { expectedUpdatedAt: number; bodyMd?: string; visibility?: NoteVisibility },
  ) => request<Changed>(`/notes/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  deleteNote: (id: string) => request<{ ok: true }>(`/notes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  files: (scope: VaultScope, after?: string) =>
    request<{ files: FileView[]; next: string | null }>(`${scopePath(scope)}/files${qs({ after })}`),
  shareFile: (id: string, shared: boolean) =>
    request<{ ok: true; changed: boolean; shared: boolean }>(`/files/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { shared },
    }),
  deleteFile: (id: string) => request<{ ok: true }>(`/files/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Care plans, time and the dashboard (M3.5)
  carePlans: (q: CarePlansQuery = {}) => request<CarePlanList>(`/care-plans${qs(q)}`),
  carePlan: (id: string) => request<CarePlanPage>(`/care-plans/${encodeURIComponent(id)}`),
  careDefaults: (clientId: string) => request<CareDefaults>(`/care-plans/defaults${qs({ clientId })}`),
  createCarePlan: (body: NewCarePlanInput) =>
    request<{ id: string; updatedAt: number }>("/care-plans", { body }),
  changeCareTerms: (id: string, body: CareTermsInput) =>
    request<{ ok: true; changed: boolean; updatedAt: number; effectiveFrom?: string }>(
      `/care-plans/${encodeURIComponent(id)}/terms`,
      { body },
    ),
  setCareStatus: (id: string, to: CareStatus, expectedUpdatedAt: number) =>
    request<{ ok: true; status: CareStatus; effectiveOn: string; updatedAt: number }>(
      `/care-plans/${encodeURIComponent(id)}/status`,
      { body: { to, expectedUpdatedAt } },
    ),
  clientCarePlans: (clientId: string, after?: string) =>
    request<CarePlanList>(`/clients/${encodeURIComponent(clientId)}/care-plans${qs({ after })}`),
  timeEntries: (q: TimeQuery = {}) => request<TimePage>(`/time${qs(q)}`),
  timeWeek: (q: TimeWeekQuery = {}) => request<TimeWeek>(`/time/week${qs(q)}`),
  timeTargets: (q: string, workDate?: string) => request<TimeTargets>(`/time/targets${qs({ q, workDate })}`),
  timePeople: () => request<{ people: { id: string; name: string; email: string }[] }>("/time/people"),
  logTime: (body: NewTimeInput) =>
    request<{ id: string; createdAt: number; updatedAt: number }>("/time", { body }),
  updateTime: (id: string, body: TimePatch) =>
    request<Changed & { lockOverride?: boolean }>(`/time/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    }),
  deleteTime: (id: string, expectedUpdatedAt: number) =>
    request<{ ok: true; lockOverride: boolean }>(
      `/time/${encodeURIComponent(id)}${qs({ expectedUpdatedAt: String(expectedUpdatedAt) })}`,
      { method: "DELETE" },
    ),
  dashboard: () => request<Dashboard>("/dashboard"),
};

// ---- the signature image (M4.4, ADM-SET-01) ------------------------------------------------------------------------

export const signatureApi = {
  /** Uploads (or replaces) the image: the raw bytes, at most 256 KB. Answers the company settings' new version. */
  put: (file: Blob) =>
    request<{ ok: true; version: number; signature: SignatureRef }>("/settings/signature", {
      method: "PUT",
      raw: file,
    }),
  remove: () => request<{ ok: true; version: number }>("/settings/signature", { method: "DELETE" }),
};

/** The image for the settings preview: a same-origin GET with the session cookie; `v` changes with the image, so no stale copy shows. */
export const signatureSrc = (sha256: string) =>
  `/api/v1/settings/signature?v=${encodeURIComponent(sha256.slice(0, 12))}`;

/** The PDF of a sent proposal or estimate (M4.4): a plain same-origin GET with the session cookie (an attachment, never shown inline). */
export const documentPdfHref = (id: string) => `/api/v1/documents/${encodeURIComponent(id)}/pdf`;

/** The address of a file's download: a plain same-origin GET with the session cookie (an attachment, never rendered). */
export const fileDownloadHref = (id: string) => `/api/v1/files/${encodeURIComponent(id)}/download`;

/** The headers of a raw upload (M3.4): the browser adds `Content-Length` itself from the File body (a header scripts may
 * not set), so these are the name, percent-encoded UTF-8, and the SHA-256 the browser computed, which R2 checks. */
export const uploadHeaders = (name: string, sha256: string): Record<string, string> => ({
  "Content-Type": "application/octet-stream",
  "X-File-Name": encodeURIComponent(name),
  "X-File-Sha256": sha256,
});

/** The SHA-256 of a file as lower-case hex (`crypto.subtle`; up to 25 MB is read into memory once). */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Upload one file as a raw body (never multipart). XMLHttpRequest rather than fetch: it reports upload progress and sends the
 * File with its `Content-Length`. `signal` cancels it (the promise rejects with code `aborted`). Errors arrive as RequestError
 * with the API's code (`file_type_mismatch`, `file_too_large`, ...); a 401 ends the session as for every other call.
 */
export function uploadFile(
  scope: VaultScope,
  file: File,
  sha256: string,
  onProgress: (sent: number, total: number) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1${scopePath(scope)}/files`);
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(uploadHeaders(file.name, sha256))) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : file.size);
    xhr.onload = () => {
      let data: (UploadResult & ApiErrorBody) | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) return resolve(data);
      // the server answered: its error, or the Worker's own unhandled one, never "offline" (final sweep review 4)
      const e = answerError(data);
      if (xhr.status === 401 && e.code === "unauthenticated") unauthenticatedHandler?.();
      reject(new RequestError(xhr.status, e.code, e.message, data?.request_id ?? null));
    };
    xhr.onerror = () => reject(new RequestError(0, "network", NETWORK));
    xhr.onabort = () => reject(new RequestError(0, "aborted", "Cancelled"));
    if (signal) {
      if (signal.aborted) {
        reject(new RequestError(0, "aborted", "Cancelled"));
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}
// ---- the catalogue, templates and publishing (M4.1, ADM-CAT-01..05) -------------------------------------------------

export type CatalogueCategory = (typeof CATALOGUE_CATEGORIES)[number];
export type CatalogueUnit = (typeof CATALOGUE_UNITS)[number];
export type TemplateKind = (typeof TEMPLATE_KIND_VALUES)[number];
export type EntryLine = NonNullable<CreateEntry["defaultLines"]>[number];
export type EntryStep = CreateEntry["schedule"][number];
export type { CreateEntry, PatchEntry, TemplateBody };

/** 422 `snapshot_invalid`: what the website needs that the snapshot lacks (codes and field words only, never values). */
/** `id`: the service's id when it exists (retired or off the website included), for a direct link. */
export type SiteNeedAnswer = { id?: string | null } & (
  | { code: string; missing: "service" }
  | { code: string; missing: "price"; currency: "inr" | "usd" }
  | { code: string; missing: "line"; line: string; currency: "inr" | "usd" | null; ambiguous: boolean }
);

/** A row of GET /catalogue. Prices are minor units (null: not offered in that currency). */
export type CatalogueListItem = {
  id: string;
  code: string;
  name: string;
  category: CatalogueCategory;
  short: string;
  unit: CatalogueUnit;
  priceInrMinor: number | null;
  priceUsdMinor: number | null;
  slug: string | null;
  showOnSite: boolean;
  active: boolean;
  updatedAt: number;
};
/** The whole entry (GET /catalogue/:id): every role reads it, internal fields too. */
export type CatalogueEntry = CatalogueListItem & {
  longMd: string | null;
  sac: string;
  gstRateBp: number | null;
  defaultLines: EntryLine[] | null;
  deliverablesMd: string | null;
  assumptionsMd: string | null;
  exclusionsMd: string | null;
  schedule: EntryStep[];
  createdAt: number;
};
/** One price change (ADM-CAT-04). `field`: price_inr_minor, price_usd_minor, line:<description>:rate_inr_minor or _usd_minor. */
export type PriceChangeRow = {
  id: string;
  field: string;
  oldMinor: number | null;
  newMinor: number | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: number;
};
export type CataloguePage = {
  item: CatalogueEntry;
  history: { items: PriceChangeRow[]; next: string | null };
};
export type CatalogueQuery = {
  limit?: "25" | "50" | undefined;
  category?: CatalogueCategory | undefined;
  active?: "1" | "0" | undefined;
  onSite?: "1" | "0" | undefined;
  q?: string | undefined;
  after?: string | undefined;
  before?: string | undefined;
};
export type TemplateMeta = {
  id: string;
  kind: TemplateKind;
  category: CatalogueCategory | null;
  version: number;
  createdAt: number;
  /** Who saved the version (null for the seeded versions). */
  savedByName: string | null;
};
export type TemplatePage = { template: TemplateMeta & { body: TemplateBody }; versions: TemplateMeta[] };
export type SnapshotRow = {
  id: string;
  sha256: string;
  publishedBy: string | null;
  publishedByName: string | null;
  publishedAt: number;
  bytes: number;
  latest: boolean;
};
export type PublishResult =
  | { sha256: string; unchanged: false; id: string; items: number }
  | { sha256: string; unchanged: true };

export const catalogueApi = {
  list: (q: CatalogueQuery = {}) => request<Page<"items", CatalogueListItem>>(`/catalogue${qs(q)}`),
  item: (id: string, after?: string) =>
    request<CataloguePage>(`/catalogue/${encodeURIComponent(id)}${qs({ after })}`),
  create: (body: CreateEntry) => request<{ ok: true; id: string; code: string }>("/catalogue", { body }),
  update: (id: string, body: PatchEntry) =>
    request<Changed>(`/catalogue/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  setActive: (id: string, active: boolean) =>
    request<{ ok: true; changed: boolean }>(`/catalogue/${encodeURIComponent(id)}/active`, {
      body: { active },
    }),
  /** The newest version of every kind and category (12 seeded rows; at most 50). */
  templates: () =>
    request<{ templates: TemplateMeta[]; next: string | null }>(`/templates${qs({ limit: "50" })}`),
  template: (id: string) => request<TemplatePage>(`/templates/${encodeURIComponent(id)}`),
  saveTemplate: (body: { kind: TemplateKind; category: CatalogueCategory | null; body: TemplateBody }) =>
    request<{ ok: true; id: string; version: number }>("/templates", { body }),
  snapshots: () => request<{ snapshots: SnapshotRow[] }>("/catalogue/snapshots"),
  publish: () => request<PublishResult>("/catalogue/publish", { body: {} }),
};

/** A message to show for any failure: the server's own words, or a plain network message. */
export const errorText = (e: unknown) => (e instanceof RequestError ? e.message : NETWORK);

/** Hash a password in a Web Worker. Resolves with the client hash and how long Argon2id took. */
export function hashPassword(req: HashRequest): Promise<{ hash: string; ms: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<HashResponse>) => {
      worker.terminate();
      if (e.data.ok) resolve({ hash: e.data.hash, ms: e.data.ms });
      else reject(new Error("Hashing failed"));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Hashing failed"));
    };
    worker.postMessage(req);
  });
}

// ---- payments, TDS, credit and FEMA extensions (M6.1; ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17, Q60) -----------------------------------------------
// The finance Worker's routes (worker/payments.ts, worker/payment-ledger.ts, worker/reports.ts). Recording or confirming a payment, withdrawing it and using
// credit need a fresh code (`request` asks for it on 403 `step_up_required`). The screens' words are 07-ZH's; the API's codes are listed with each call.

export type PaymentKind = "payment" | "tds";
export type PaymentStatus = "pending_verification" | "confirmed" | "rejected" | "withdrawn";
export type PaymentMode = "neft" | "rtgs" | "imps" | "upi" | "swift";
export type AllocationAsk = { documentId: string; amountMinor: number };

/** One payment entry (worker/payments.ts `paymentView`); never the R2 key of its proof. */
export type PaymentView = {
  id: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  clientGone: boolean;
  kind: PaymentKind;
  provider: string;
  status: PaymentStatus;
  currency: Currency;
  amountMinor: number;
  chargesMinor: number;
  receivedOn: string;
  mode: PaymentMode | null;
  reference: string | null;
  inrReceivedMinor: number | null;
  requestedAllocations: AllocationAsk[];
  /** 07-ZH line 8 "Certificate awaited" while `certificateAwaited`. */
  tds: {
    section: string | null;
    rateBp: number | null;
    certificateNo: string | null;
    certificateOn: string | null;
    certificateAwaited: boolean;
  } | null;
  proof: {
    kind: string | null;
    ref: string | null;
    hasFile: boolean;
    mime: string | null;
    sha256: string | null;
  } | null;
  advanceReceiptId: string | null;
  note: string | null;
  recordedBy: string | null;
  recordedByName: string | null;
  recordedAt: number;
  verifiedBy: string | null;
  verifiedByName: string | null;
  verifiedAt: number | null;
  decisionNote: string | null;
  withdrawnBy: string | null;
  withdrawnAt: number | null;
  withdrawReason: string | null;
};

export type PaymentAllocationView = {
  id: string;
  documentId: string;
  number: string | null;
  type: string;
  kind: "allocate" | "release";
  amountMinor: number;
  createdAt: number;
};

/** RA-17 (L13): money from a month before the invoice's month (07-ZH line 10's warning; `month` is `YYYY-MM`). Never a block. */
export type ReceiptWarning = { code: "received_in_earlier_month"; documentId: string; month: string };

export type RecordPaymentInput = {
  /** A UUIDv7 picked once per dialog (the idempotency key: the same id again is 409 `already_recorded`). */
  id: string;
  clientId: string;
  kind: PaymentKind;
  currency: Currency;
  amountMinor: number;
  receivedOn: string;
  /** Required for money received; none for TDS. */
  mode?: PaymentMode | null;
  /** Required for money received (`reference_invalid` when it doesn't normalise). */
  reference?: string;
  chargesMinor?: number;
  inrReceivedMinor?: number;
  allocations?: AllocationAsk[];
  tds?: { section: string; rateBp: number; certificateNo?: string; certificateOn?: string };
  note?: string;
  /** After 409 `reference_seen` (07-ZH line 13), when it is a different payment. */
  confirmDuplicate?: boolean;
};

export type RecordPaymentAnswer = {
  ok: true;
  id: string;
  status: "confirmed" | "pending_verification";
  allocations: AllocationAsk[];
  requestedAllocations: AllocationAsk[];
  /** 07-ZH line 9: kept as the client's credit (the Owner's entry only; null for a pending one). */
  unallocatedMinor: number | null;
  approvalId?: string;
  warnings: ReceiptWarning[];
};

/** The invoice's Payments panel (07-ZH line 1, and line 14 on an export invoice). */
export type InvoicePaymentsPanel = {
  documentId: string;
  type: string;
  status: string;
  currency: Currency;
  updatedAt: number;
  totalMinor: number;
  paidMinor: number;
  tdsMinor: number;
  creditedMinor: number;
  balanceMinor: number;
  excessMinor: number;
  /** What "Move excess to credit" may move: the excess less its TDS part (code review finding 1). */
  releasableMinor: number;
  payments: {
    paymentId: string;
    kind: PaymentKind;
    status: PaymentStatus;
    receivedOn: string;
    mode: PaymentMode | null;
    reference: string | null;
    currency: Currency;
    amountMinor: number;
    heldMinor: number;
    tds: {
      section: string | null;
      rateBp: number | null;
      certificateNo: string | null;
      certificateAwaited: boolean;
    } | null;
    hasProof: boolean;
  }[];
  pending: {
    paymentId: string;
    kind: PaymentKind;
    receivedOn: string;
    mode: PaymentMode | null;
    reference: string | null;
    currency: Currency;
    amountMinor: number;
    askedMinor: number;
    recordedBy: string | null;
    recordedAt: number;
  }[];
  credits: { currency: Currency; creditMinor: number }[];
  realisation: {
    femaStandard: string;
    femaDue: string;
    gstDue: string;
    stage: string;
    extensions: {
      id: string;
      extendedTo: string;
      bankRef: string;
      hasLetter: boolean;
      recordedBy: string | null;
      recordedByName: string | null;
      createdAt: number;
    }[];
  } | null;
};

export type ClientCredit = {
  clientId: string;
  anonymised: boolean;
  credits: { currency: Currency; creditMinor: number }[];
  sources: { paymentId: string; receivedOn: string; availableMinor: number }[];
};

/** One row of the payments and TDS register (07-ZH line 20). */
export type PaymentsRegisterRow = {
  id: string;
  kind: PaymentKind;
  receivedOn: string;
  currency: Currency;
  amountMinor: number;
  chargesMinor: number;
  mode: PaymentMode | null;
  reference: string | null;
  inrReceivedMinor: number | null;
  tds: {
    section: string | null;
    rateBp: number | null;
    certificateNo: string | null;
    certificateOn: string | null;
    certificateAwaited: boolean;
  } | null;
  proof: { kind: string; ref: string | null } | null;
  client: { id: string; code: string; name: string };
  allocations: { documentId: string; number: string | null; kind: string; amountMinor: number }[];
};

/** One payment item of the approvals queue (`GET /approvals?kind=payment`); decided only through `paymentsApi.verify`. */
export type PaymentApprovalItem = {
  id: string;
  kind: "payment";
  state: string;
  createdAt: number;
  decidedAt: number | null;
  note: string | null;
  requestedBy: string;
  requesterName: string | null;
  decidedBy: string | null;
  deciderName: string | null;
  payment: {
    id: string;
    kind: PaymentKind;
    status: PaymentStatus;
    currency: Currency;
    amountMinor: number;
    receivedOn: string;
    clientId: string;
    clientCode: string;
    clientName: string;
  };
};

const pid = (id: string) => encodeURIComponent(id);

export const paymentsApi = {
  /** The list: `status` uses the matching index (pending: oldest first, the Owner's "Payments to check"); `client`, `from`, `to` filter; `after` pages. */
  list: (f: { status?: PaymentStatus; client?: string; from?: string; to?: string; after?: string } = {}) =>
    request<{ payments: PaymentView[]; next: string | null }>(`/payments${qs(f)}`),
  get: (id: string) =>
    request<{ payment: PaymentView; allocations: PaymentAllocationView[] }>(`/payments/${pid(id)}`),
  /**
   * Record (07-ZH line 2). The Owner's entry is confirmed now (fresh code); a Staff member's waits for the Owner (line 3). Codes: `already_recorded`,
   * `reference_seen` (details `receivedOn`, `clientCode`, `clientName`), `reference_invalid`, `received_on_future`, `currency_mismatch`, `tds_not_allowed`,
   * `use_advance_invoice`, `allocation_exceeds_balance` (details `documentId`, `balanceMinor`), `exceeds_payment`, `not_payable`, `client_anonymised`.
   */
  record: (input: RecordPaymentInput) => request<RecordPaymentAnswer>("/payments", { body: input }),
  /** The Owner's check (07-ZH line 4). A reject needs `note` ("Why it is rejected"). Codes: `payment_not_pending`, `use_advance_invoice`, `stale_version`. */
  verify: (
    id: string,
    body: {
      decision: "confirm" | "reject";
      note?: string;
      allocations?: AllocationAsk[];
      expectedRecordedAt: number;
    },
  ) =>
    request<{
      ok: true;
      id: string;
      status: "confirmed" | "rejected";
      allocations: AllocationAsk[];
      unallocatedMinor: number | null;
      warnings: ReceiptWarning[];
    }>(`/payments/${pid(id)}/verify`, { body }),
  /** Withdraw a confirmed entry made in error (Owner, fresh code). Codes: `payment_not_confirmed`, `payment_advance_backed`. */
  withdraw: (id: string, reason: string) =>
    request<{ ok: true; id: string; status: "withdrawn" }>(`/payments/${pid(id)}/withdraw`, {
      body: { reason },
    }),
  /** The Form 16A number and date, set once (`certificate_already_set`). */
  tdsCertificate: (id: string, certificateNo: string, certificateOn: string) =>
    request<{ ok: true; id: string; certificateNo: string; certificateOn: string }>(
      `/payments/${pid(id)}/tds-certificate`,
      {
        body: { certificateNo, certificateOn },
      },
    ),
  /** The proof's download: a plain same-origin GET with the session cookie (an attachment). */
  proofHref: (id: string) => `/api/v1/payments/${pid(id)}/proof`,
  clientCredit: (clientId: string) => request<ClientCredit>(`/clients/${pid(clientId)}/credit`),
  /** "Use credit on this invoice" (07-ZH line 10; Owner, fresh code). Codes: `allocation_exceeds_balance`, `exceeds_credit`, `stale_version`. */
  applyCredit: (
    clientId: string,
    body: { documentId: string; amountMinor: number; expectedUpdatedAt: number },
  ) =>
    request<{
      ok: true;
      documentId: string;
      updatedAt: number;
      allocations: { paymentId: string; amountMinor: number }[];
      warnings: ReceiptWarning[];
    }>(`/clients/${pid(clientId)}/credit/apply`, { body }),
  /** "Move excess to credit" (07-ZH line 11; Owner, fresh code). Codes: `exceeds_excess`, `stale_version`. */
  releaseExcess: (documentId: string, body: { amountMinor: number; expectedUpdatedAt: number }) =>
    request<{
      ok: true;
      documentId: string;
      updatedAt: number;
      releases: { paymentId: string; amountMinor: number }[];
    }>(`/invoices/${pid(documentId)}/credit/release`, { body }),
  invoicePanel: (documentId: string) =>
    request<InvoicePaymentsPanel>(`/invoices/${pid(documentId)}/payments`),
  /** "Bank extended the date" (07-ZH line 14; Owner). Codes: `extension_not_later` (details `femaDue`), `extension_too_far`, `not_an_export_invoice`. */
  extendRealisation: (documentId: string, body: { extendedTo: string; bankRef: string }) =>
    request<{ ok: true; id: string; documentId: string; extendedTo: string }>(
      `/invoices/${pid(documentId)}/realisation-extensions`,
      { body },
    ),
  /** The payments and TDS register of one FY (07-ZH line 20; `fy` like "2627"). */
  register: (fy: string, after?: string) =>
    request<{ fy: string; from: string; to: string; rows: PaymentsRegisterRow[]; next: string | null }>(
      `/reports/payments${qs({ fy, after })}`,
    ),
  /** The approvals queue's payment items. */
  approvals: (f: { status?: string; id?: string; after?: string } = {}) =>
    request<{ approvals: PaymentApprovalItem[]; next: string | null }>(
      `/approvals${qs({ kind: "payment", ...f })}`,
    ),
};

/**
 * Upload a payment's proof (L10, L11; PDF, JPEG or PNG, at most 5 MB; set once) or a FEMA extension's bank letter, as a raw body with the file vault's
 * headers plus the proof's type and reference. Codes: `file_too_large`, `file_type_not_allowed`, `file_type_mismatch`, `proof_already_set`,
 * `letter_already_set`, `checksum_mismatch`.
 */
export function uploadPaymentDoc(
  target:
    | { proofOf: string; kind: string; ref?: string }
    | { letterOf: { documentId: string; extensionId: string } },
  file: File,
  sha256: string,
  onProgress: (sent: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const path =
    "proofOf" in target
      ? `/api/v1/payments/${pid(target.proofOf)}/proof`
      : `/api/v1/invoices/${pid(target.letterOf.documentId)}/realisation-extensions/${pid(target.letterOf.extensionId)}/letter`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", path);
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(uploadHeaders(file.name, sha256))) xhr.setRequestHeader(k, v);
    if ("proofOf" in target) {
      xhr.setRequestHeader("X-Proof-Kind", encodeURIComponent(target.kind));
      if (target.ref) xhr.setRequestHeader("X-Proof-Ref", encodeURIComponent(target.ref));
    }
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : file.size);
    xhr.onload = () => {
      let data: (Record<string, unknown> & ApiErrorBody) | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) return resolve(data);
      const e = answerError(data);
      if (xhr.status === 401 && e.code === "unauthenticated") unauthenticatedHandler?.();
      reject(new RequestError(xhr.status, e.code, e.message, data?.request_id ?? null));
    };
    xhr.onerror = () => reject(new RequestError(0, "network", NETWORK));
    xhr.onabort = () => reject(new RequestError(0, "aborted", "Cancelled"));
    if (signal) {
      if (signal.aborted) {
        reject(new RequestError(0, "aborted", "Cancelled"));
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

/**
 * T11, the deed of assignment (apps/admin/worker/deeds.ts; ADM-PRJ-04). Writes carry the `updatedAt` the screen loaded (`stale_version` otherwise); finalise and
 * the signed upload need a fresh step-up (the screen asks for the code first). Downloads are plain same-origin links (an attachment).
 */
export const deedsApi = {
  get: (projectId: string) => request<DeedPage>(`/projects/${pid(projectId)}/deed`),
  /** "Check again" (Owner): `created` says whether a draft was made; the page as it is now comes with it. */
  recheck: (projectId: string) =>
    request<DeedPage & { created: boolean }>(`/projects/${pid(projectId)}/deed/recheck`, { body: {} }),
  saveSchedules: (
    deedId: string,
    body: { expectedUpdatedAt: number } & Partial<Record<"deliverables" | "location" | "deliveredDates" | "tools" | "thirdParty", string | null>>,
  ) =>
    request<{ ok: true; updatedAt: number; blankSchedules: string[] }>(`/deeds/${pid(deedId)}/schedules`, {
      method: "PUT",
      body,
    }),
  finalise: (deedId: string, expectedUpdatedAt: number) =>
    request<{ ok: true; status: "final"; number: string | null; updatedAt: number }>(
      `/deeds/${pid(deedId)}/finalise`,
      { body: { expectedUpdatedAt } },
    ),
  cancel: (deedId: string, expectedUpdatedAt: number, reason: string) =>
    request<{ ok: true; status: "cancelled"; updatedAt: number }>(`/deeds/${pid(deedId)}/cancel`, {
      body: { expectedUpdatedAt, reason },
    }),
  renderPdf: (deedId: string) =>
    request<{ ok: true; pdf: { state: "pending" } }>(`/deeds/${pid(deedId)}/pdf/render`, { body: {} }),
  unsignedHref: (deedId: string) => `/api/v1/deeds/${pid(deedId)}/pdf/unsigned`,
  signedHref: (deedId: string) => `/api/v1/deeds/${pid(deedId)}/pdf/signed`,
};

/**
 * Upload the signed deed (Owner, fresh step-up; L4): the raw PDF with the file vault's headers, the `updatedAt` the screen loaded, and the eSign moment
 * ("YYYY-MM-DDTHH:mm[:ss]", IST) and transaction ID as the provider shows them, URI-encoded. Codes: `file_too_large`, `file_type_not_allowed`, `esign_invalid`,
 * `deed_not_final`, `stale_version`, `checksum_mismatch`, `step_up_required`.
 */
export function uploadSignedDeed(
  deedId: string,
  file: File,
  sha256: string,
  meta: { expectedUpdatedAt: number; esignAt: string; esignTxn: string },
  onProgress: (sent: number, total: number) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/v1/deeds/${pid(deedId)}/signed`);
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(uploadHeaders(file.name, sha256))) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader("X-Expected-Updated-At", String(meta.expectedUpdatedAt));
    xhr.setRequestHeader("X-Esign-At", encodeURIComponent(meta.esignAt));
    xhr.setRequestHeader("X-Esign-Txn", encodeURIComponent(meta.esignTxn));
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : file.size);
    xhr.onload = () => {
      let data: (Record<string, unknown> & ApiErrorBody) | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) return resolve(data);
      const e = answerError(data);
      if (xhr.status === 401 && e.code === "unauthenticated") unauthenticatedHandler?.();
      reject(new RequestError(xhr.status, e.code, e.message, data?.request_id ?? null));
    };
    xhr.onerror = () => reject(new RequestError(0, "network", NETWORK));
    xhr.onabort = () => reject(new RequestError(0, "aborted", "Cancelled"));
    xhr.send(file);
  });
}
