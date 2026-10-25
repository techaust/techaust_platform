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
import type { Settings } from "@techaust/core/settings";
import type { TermsBlockId } from "@techaust/core/terms";
import type { HashRequest, HashResponse } from "./hash.worker.ts";

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
  verify?: string;
  notes?: string;
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
  type: "user" | "lead" | "client" | "contact" | "project" | "catalogue" | "document";
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
export type Assignee = { id: string; name: string };
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
};
export type LeadPatch = Omit<Partial<NewLead>, "serviceCode" | "message"> & { expectedUpdatedAt: number };
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
export type ProjectPage = {
  project: ProjectView;
  milestones: MilestoneView[];
  /** The client is an anonymised individual: the screens are read-only. */
  clientAnonymised: boolean;
  milestoneTotals: { totalMinor: number; mismatch: boolean };
  recentNotes: NoteView[];
  recentFiles: FileView[];
  figures: {
    billedVsPaid: { available: boolean; arrivesWith: string };
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
  overage: { addToInvoice: { available: false; arrivesWith: string } };
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
  finance?: { available: false; arrivesWith: Record<string, string> };
  projects?: { active: number; onHold: number };
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
    }[];
  };
};
export type Dashboard = { asOf: number; today: string; tiles: DashboardTiles };

/** A field the server refused (400 `invalid`): its dotted path in the request body and our own message. */
export type FieldIssue = { path: string; message: string };

type ApiErrorBody = {
  error?: { code: string; message: string };
  request_id?: string;
  fields?: FieldIssue[];
  /** 422 `snapshot_invalid` (POST /catalogue/publish): the failing paths of the snapshot, never values. */
  paths?: string[];
  /** 422 `snapshot_invalid`: what the website needs that the snapshot lacks. */
  needs?: SiteNeedAnswer[];
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
type Options = { method?: Method; body?: unknown; signedIn?: boolean };

const NETWORK = "Couldn't reach the server. Check your connection and try again.";

async function send<T>(path: string, { method, body, signedIn = true }: Options): Promise<T> {
  const m: Method = method ?? (body === undefined ? "GET" : "POST");
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: m,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new RequestError(0, "network", NETWORK);
  }
  const data = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (res.ok) return data;
  const e = data.error ?? { code: "network", message: NETWORK };
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
  );
  if (signedIn && res.status === 401 && e.code === "unauthenticated") unauthenticatedHandler?.();
  throw error;
}

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
  clientFinance: (id: string) =>
    request<{ available: boolean }>(`/clients/${encodeURIComponent(id)}/finance`),
  clientStatement: (id: string, from: string, to: string) =>
    request<{ available: boolean; from: string; to: string }>(
      `/clients/${encodeURIComponent(id)}/statement${qs({ from, to })}`,
    ),
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
  timePeople: () => request<{ people: { id: string; name: string }[] }>("/time/people"),
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
      const e = data?.error ?? { code: "network", message: NETWORK };
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
