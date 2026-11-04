// The typed client for the M7.1 admin routes (run file C): the clients' "I've paid" notices (finance Worker, `worker/payment-notices.ts`) and the requests
// clients send from the portal (admin API Worker, `worker/client-requests.ts`) [ADM-PAY-05, POR-09, POR-11]. Its own module, so the main chunk doesn't carry
// it: only the Payments, Clients and shell screens import it. The shapes mirror the Workers' answers; money is integer minor units, only formatted here.
import type { Currency, PaymentStatus } from "../api.ts";
import { qs, request } from "../api.ts";

const pid = (id: string) => encodeURIComponent(id);

export type NoticeStatus = "open" | "recorded" | "dismissed";

/** A notice as the Notices tab reads it (`noticeView` in worker/payment-notices.ts). */
export type NoticeView = {
  id: string;
  client: { id: string; code: string; name: string };
  document: { id: string; type: string; numberDisplay: string | null };
  contact: { id: string; name: string | null } | null;
  via: "portal" | "link" | string;
  amountMinor: number;
  currency: Currency;
  paidOn: string;
  reference: string;
  referenceNorm: string;
  note: string | null;
  status: NoticeStatus;
  paymentId: string | null;
  /** Review M5 (B4): the payment recorded from this notice and its status now (it may have been rejected or withdrawn since); null while open or dismissed. */
  payment?: { id: string; status: PaymentStatus } | null;
  closedBy: { id: string; name: string | null } | null;
  closedAt: number | null;
  closeNote: string | null;
  createdAt: number;
};

/** An open notice on an invoice's Payments panel (`GET /invoices/:id/payments` `notices`, at most 3). */
export type PanelNotice = {
  id: string;
  via: string;
  amountMinor: number;
  currency: Currency;
  paidOn: string;
  reference: string;
  note: string | null;
  contactName: string | null;
  createdAt: number;
};

export type RequestKind = "contact_change" | "data_access" | "data_correction" | "data_erasure" | "grievance";

/** A client's request as the admin reads it (`requestView` in worker/client-requests.ts); `canClose` is this member's right on its kind. */
export type ClientRequestView = {
  id: string;
  client: { id: string; code: string | null; name: string | null } | null;
  contact: { id: string; name: string | null; email: string | null } | null;
  leadId: string | null;
  kind: RequestKind | string;
  details: string | null;
  status: "open" | "closed";
  outcome: "done" | "declined" | null;
  closedBy: { id: string; name: string | null } | null;
  closedAt: number | null;
  closeNote: string | null;
  createdAt: number;
  updatedAt: number;
  canClose: boolean;
};

export const noticesApi = {
  /** The Notices tab: a keyset page of 50 by status (oldest first) or one client's, and the open count. */
  list: (f: { status?: NoticeStatus; client?: string; after?: string } = {}) =>
    request<{ items: NoticeView[]; next: string | null; openCount: number }>(`/payments/notices${qs(f)}`),
  /** Dismiss (Owner, Staff); 409 `notice_closed`. The note is optional; the dialog asks for no personal data (S6). */
  dismiss: (id: string, note: string | null) =>
    request<{ ok: true }>(`/payments/notices/${pid(id)}/close`, {
      body: note ? { outcome: "dismissed", note } : { outcome: "dismissed" },
    }),
};

export const requestsApi = {
  /** By status (oldest first) or one client's (newest first), and the open count (the navigation's). */
  list: (f: { status?: "open" | "closed"; kind?: string; client?: string; after?: string } = {}) =>
    request<{ items: ClientRequestView[]; next: string | null; openCount: number }>(
      `/client-requests${qs(f)}`,
    ),
  /** Close (Staff: a contact change or a grievance; the Owner: every kind); 403, 409 `request_closed`. */
  close: (id: string, outcome: "done" | "declined", note: string | null) =>
    request<{ ok: true; status: "closed"; outcome: string }>(`/client-requests/${pid(id)}/close`, {
      body: note ? { outcome, note } : { outcome },
    }),
};
