// The typed client for the M7.4 admin routes (run file C.1–C.10; the B2 report): the requests inbox with its clock, the staff log, the two steps and the
// close; legal holds; the erased-address lift; the clean-up report and the real-deletion switch; a lead's export, erase and consent withdrawal; and a
// contact's "anonymise in parts" (F5). Its own module, so the main chunk doesn't carry it. The shapes mirror apps/admin/worker/{client-requests,
// data-protection,lead-data,clients}.ts; every refusal arrives as a `RequestError` whose `code` the screens word (lib/copy-zr.ts).
import { qs, request } from "../api.ts";

const pid = (id: string) => encodeURIComponent(id);

export type RequestKind =
  | "contact_change"
  | "data_access"
  | "data_correction"
  | "data_erasure"
  | "grievance"
  | "consent_withdrawal"
  | "nomination";
export const REQUEST_KINDS: readonly RequestKind[] = [
  "data_access",
  "data_correction",
  "data_erasure",
  "consent_withdrawal",
  "nomination",
  "grievance",
  "contact_change",
];
export type Channel = "portal" | "email" | "post" | "phone" | "in_person";
export const STAFF_CHANNELS = ["email", "post", "phone", "in_person"] as const;
export type RequestState = "open" | "ack_overdue" | "due_soon" | "overdue" | "closed";
export type DeclineReason =
  | "legal_hold"
  | "law_requires_keeping"
  | "identity_not_confirmed"
  | "duplicate"
  | "not_on_record"
  | "other";
export const DECLINE_REASONS: readonly DeclineReason[] = [
  "legal_hold",
  "law_requires_keeping",
  "identity_not_confirmed",
  "duplicate",
  "not_on_record",
  "other",
];
/** L28: an erasure request naming only an address closes only as declined, for one of these (core `EMAIL_ONLY_DECLINE_REASONS`). */
export const EMAIL_ONLY_DECLINE_REASONS: readonly DeclineReason[] = [
  "not_on_record",
  "identity_not_confirmed",
  "duplicate",
  "other",
];
/** L42: these kinds close `done` only once the identity check is recorded (core `IDENTITY_CHECKED_KINDS`). */
export const IDENTITY_CHECKED_KINDS: readonly string[] = [
  "data_access",
  "data_correction",
  "data_erasure",
  "nomination",
];

/** One request as the admin reads it (`requestView` in worker/client-requests.ts). */
export type RequestView = {
  id: string;
  client: { id: string; code: string | null; name: string | null } | null;
  contact: { id: string; name: string | null; email: string | null } | null;
  leadId: string | null;
  lead: { id: string; ref: string | null; gone: boolean } | null;
  contactRef: string | null;
  requesterEmail: string | null;
  kind: RequestKind | string;
  details: string | null;
  status: "open" | "closed";
  outcome: "done" | "declined" | null;
  closedBy: { id: string; name: string | null } | null;
  closedAt: number | null;
  closeNote: string | null;
  createdAt: number;
  updatedAt: number;
  channel: Channel | string;
  loggedBy: string | null;
  receivedAt: number | null;
  dueAt: number | null;
  ackDueAt: number | null;
  acknowledgedAt: number | null;
  identityCheckedAt: number | null;
  identityCheckedBy: string | null;
  declineReason: DeclineReason | null;
  actionAuditId: string | null;
  exportSentAt: number | null;
  state: RequestState;
  daysLeft: number | null;
  canClose: boolean;
};

export type RequestsQuery = {
  status?: "open" | "closed" | undefined;
  state?: "overdue" | "due_soon" | "ack_overdue" | undefined;
  kind?: string | undefined;
  client?: string | undefined;
  after?: string | undefined;
};

export type RequestLogInput = {
  kind: RequestKind;
  channel: (typeof STAFF_CHANNELS)[number];
  receivedOn: string;
  clientId?: string;
  contactId?: string;
  leadId?: string;
  requesterEmail?: string;
  details?: string | null;
};

export type RequestCloseInput = {
  outcome: "done" | "declined";
  note?: string | null;
  declineReason?: DeclineReason | null;
  actionAuditId?: string | null;
  exportSentAt?: number | null;
};

export type HoldEntity = "client" | "contact" | "lead";
export type HoldHistory = {
  id: string;
  action: "set" | "clear";
  reason: string;
  by: { id: string; name: string | null };
  at: number;
};

export type RetentionCount = {
  family: string;
  due: number;
  heldSkipped: number;
  oldestAt: number | null;
  done: boolean;
};
export type RetentionRun = {
  id: string;
  asOf: number;
  mode: "dry_run" | "live";
  startedAt: number;
  finishedAt: number | null;
  families: number;
  counts: RetentionCount[];
};
export type RetentionReport = {
  live: boolean;
  switchedAt: number | null;
  switchedBy: { id: string; name: string | null } | null;
  liveVerdict: "ok" | "no_trial_report" | "trial_report_stale";
  runs: RetentionRun[];
  leadsDue: { id: string; ref: string; deleteAfter: number }[];
};

export type LeadExportPart = "lead_activities" | "email_log" | "consent_receipts";
export type LeadExportSummary = {
  lead: Record<string, unknown>;
  manifest: LeadExportPart[];
  keyedFormMonths: number;
};
export type LeadExportPage = { part: LeadExportPart; items: Record<string, unknown>[]; next: string | null };

export const m74Api = {
  // ---- C.1–C.4 requests ----
  requests: (q: RequestsQuery = {}) =>
    request<{ items: RequestView[]; next: string | null; openCount: number }>(`/client-requests${qs(q)}`),
  logRequest: (body: RequestLogInput) => request<{ request: RequestView }>("/client-requests", { body }),
  step: (id: string, step: "acknowledged" | "identity_checked") =>
    request<{ ok: true; step: string; at: number }>(`/client-requests/${pid(id)}/step`, { body: { step } }),
  close: (id: string, body: RequestCloseInput) =>
    request<{ ok: true; status: "closed"; outcome: string }>(`/client-requests/${pid(id)}/close`, { body }),

  // ---- C.5 legal holds ----
  holds: (entityType: HoldEntity, entityId: string) =>
    request<{ held: boolean; history: HoldHistory[] }>(`/legal-holds${qs({ entityType, entityId })}`),
  setHold: (body: { entityType: HoldEntity; entityId: string; on: boolean; reason: string }) =>
    request<{ ok: true; held: boolean; holdId: string }>("/legal-holds", { body }),

  // ---- C.6 the erased-address lift ----
  liftSuppression: (email: string) => request<{ ok: true }>("/suppressions/lift", { body: { email } }),

  // ---- C.7 the clean-up ----
  retentionReport: () => request<RetentionReport>("/retention/report"),
  retentionLive: (on: boolean) =>
    request<{ ok: true; live: boolean; runId: string | null }>("/retention/live", { body: { on } }),

  // ---- C.8 a lead's data ----
  leadExportSummary: (id: string) => request<LeadExportSummary>(`/leads/${pid(id)}/export`, { body: {} }),
  leadExportPart: (id: string, part: LeadExportPart, after?: string) =>
    request<LeadExportPage>(`/leads/${pid(id)}/export`, { body: after ? { part, after } : { part } }),
  leadErase: (id: string, reason: string) =>
    request<{ ok: true; erased: string[] }>(`/leads/${pid(id)}/erase`, { body: { reason } }),
  leadWithdrawConsent: (id: string) =>
    request<{ ok: true; withdrawnAt: number }>(`/leads/${pid(id)}/consent/withdraw`, { body: {} }),

  // ---- C.10 (F5) a contact anonymised in parts ----
  redactOffersPart: (contactId: string, reason: string) =>
    request<{ ok: true; mode: "anonymise"; part: "offers"; redacted: number; more: boolean }>(
      `/contacts/${pid(contactId)}/erase`,
      { body: { mode: "anonymise", reason, part: "offers" } },
    ),
};
