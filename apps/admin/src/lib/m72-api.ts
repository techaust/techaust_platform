// The typed client for the M7.2 admin routes (run file C.1, C.2; B2's "Shapes for the designer"): the member's notification switches, the email log and its
// detail, the Owner's "Allow emails again" for an email row or a contact, and "Send receipt again" (finance Worker). Its own module, so the main chunk doesn't
// carry it: only the Notifications, Emails, contacts and payments screens import it. The shapes mirror apps/admin/worker/{notifications,emails,receipt-send}.ts.
import { qs, request } from "../api.ts";

const pid = (id: string) => encodeURIComponent(id);

export type Prefs = {
  digestWeekly: boolean;
  offerViewed: boolean;
  paymentReceived: boolean;
  approvals: boolean;
  hookFailed: boolean;
};
export type PrefsAnswer = {
  prefs: Prefs;
  /** The weekly digest goes to owners only (L7). */
  digestAvailable: boolean;
  digestOffVia: "settings" | "one_click" | null;
  /** The row's version; null while the member has no row (the defaults). */
  updatedAt: number | null;
};

export type Suppression = { reason: string; label: string; at: number };

export type EmailRow = {
  id: string;
  to: string;
  template: string;
  entity: { type: string; id: string };
  status: string;
  statusLabel: string;
  bounceType: string | null;
  lastEventAt: number | null;
  createdAt: number;
  updatedAt: number;
};
export type EmailEvent = {
  id: string;
  type: string;
  bounceType: string | null;
  bounceSubType: string | null;
  outcome: string;
  receivedAt: number;
};
export type EmailsQuery = {
  status?: string | undefined;
  template?: string | undefined;
  /** UTC ms, as a string (the IST start of the chosen day). */
  since?: string | undefined;
  to?: string | undefined;
  after?: string | undefined;
};

export const m72Api = {
  prefs: () => request<PrefsAnswer>("/notifications/prefs"),
  savePrefs: (changes: Partial<Prefs>, expectedUpdatedAt: number | null) =>
    request<PrefsAnswer>("/notifications/prefs", { method: "PUT", body: { ...changes, expectedUpdatedAt } }),
  emails: (q: EmailsQuery) => request<{ emails: EmailRow[]; next: string | null }>(`/emails${qs(q)}`),
  email: (id: string) =>
    request<{
      email: EmailRow & { error: string | null };
      events: EmailEvent[];
      suppression: Suppression | null;
    }>(`/emails/${pid(id)}`),
  unsuppressEmail: (id: string) => request<{ ok: true }>(`/emails/${pid(id)}/unsuppress`, { body: {} }),
  unsuppressContact: (id: string, expectedUpdatedAt: number) =>
    request<{ ok: true }>(`/contacts/${pid(id)}/unsuppress`, { body: { expectedUpdatedAt } }),
  sendReceipt: (receiptId: string, contactIds: string[]) =>
    request<{ ok: true; queued: number }>(`/receipts/${pid(receiptId)}/send`, { body: { contactIds } }),
};
