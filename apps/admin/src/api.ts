// The typed client for the admin API (apps/admin/worker). Every error body is `{ error: { code, message },
// request_id }`. Two codes are handled here for every caller:
// - `step_up_required` (403): the step-up dialog opens; on success the same request is sent once more.
// - `unauthenticated` (401) on a signed-in route: the session has ended, so the app goes back to sign-in.
import type { ArgonParams } from "@techaust/auth";
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
  type: "user" | "lead" | "client" | "contact";
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

/** A field the server refused (400 `invalid`): its dotted path in the request body and our own message. */
export type FieldIssue = { path: string; message: string };

type ApiErrorBody = {
  error?: { code: string; message: string };
  request_id?: string;
  fields?: FieldIssue[];
};

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
    /** 400 `invalid`: which fields, with the server's message for each. */
    readonly fields: FieldIssue[] = [],
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
