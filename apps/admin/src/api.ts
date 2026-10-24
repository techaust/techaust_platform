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
  type: "user" | "lead";
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
