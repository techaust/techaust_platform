// The typed client for the M7.4 admin routes (run file C.1–C.10; the B2 report): the requests inbox with its clock, the staff log, the two steps and the
// close; legal holds; the erased-address lift; the clean-up report and the real-deletion switch; a lead's export, erase and consent withdrawal; and a
// contact's "anonymise in parts" (F5). Its own module, so the main chunk doesn't carry it. The shapes mirror apps/admin/worker/{client-requests,
// data-protection,lead-data,clients}.ts; every refusal arrives as a `RequestError` whose `code` the screens word (lib/copy-zr.ts).
import {
  type Channel,
  DECLINE_REASONS as CORE_DECLINE,
  EMAIL_ONLY_DECLINE_REASONS as CORE_EMAIL_ONLY,
  IDENTITY_CHECKED_KINDS as CORE_IDENTITY,
  REQUEST_KINDS as CORE_KINDS,
  STAFF_CHANNELS as CORE_STAFF_CHANNELS,
  type DeclineReason,
  type DsrKind,
  type RequestState,
} from "@techaust/core/dsr";
import { qs, request } from "../api.ts";

const pid = (id: string) => encodeURIComponent(id);

// The lists come from core (`@techaust/core/dsr`, pure, the same lists the API, its SQL and the triggers hold; review low 5), never copies. Only the order
// the screens offer the kinds in is ours: a record keyed by every core kind, so a kind added to core fails the typecheck until it has a place here.
export type RequestKind = DsrKind;
export type { Channel, DeclineReason, RequestState };

const KIND_ORDER: Readonly<Record<RequestKind, number>> = {
  data_access: 0,
  data_correction: 1,
  data_erasure: 2,
  consent_withdrawal: 3,
  nomination: 4,
  grievance: 5,
  contact_change: 6,
};
/** Every kind, in the order "What they asked for" and "Kind" offer them (the data rights first). */
export const REQUEST_KINDS: readonly RequestKind[] = [...CORE_KINDS].sort(
  (a, b) => KIND_ORDER[a] - KIND_ORDER[b],
);
export const STAFF_CHANNELS = CORE_STAFF_CHANNELS;
export const DECLINE_REASONS: readonly DeclineReason[] = CORE_DECLINE;
/** L28: an erasure request naming only an address closes only as declined, for one of these. */
export const EMAIL_ONLY_DECLINE_REASONS: readonly DeclineReason[] = CORE_EMAIL_ONLY;
/** L42: these kinds close `done` only once the identity check is recorded. */
export const IDENTITY_CHECKED_KINDS: readonly string[] = CORE_IDENTITY;

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
  /** Full audit AU9: the dry-run count reached its cap (the screen says "10,000 or more"). Optional: an older API answer lacks it. */
  capped?: boolean;
  /** Full audit AU9: a live family stopped at its nightly page budget; the next night carries on. */
  moreTomorrow?: boolean;
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
