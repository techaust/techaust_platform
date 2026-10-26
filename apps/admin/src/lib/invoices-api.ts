// The typed client for the invoices API (M5.1; apps/admin/worker/invoices.ts, invoice-issue.ts, invoice-view.ts, document-pdf.ts, client-tabs.ts,
// approvals.ts). Its own module, so the main chunk does not carry it: only the invoice screens import it. The shapes mirror the Worker's answers
// (`InvoiceView`, the list rows, the issue-request queue). Money is integer minor units in the invoice's currency; the screens only format it
// (through core), never work it out.
import type { IssueBlockerCode, VoidBlockerCode } from "@techaust/core/invoices";
import type { Currency } from "../api.ts";
import { qs, request } from "../api.ts";
import type {
  ApprovalInfo,
  ApprovalState,
  Discount,
  Issue,
  LineIn,
  RecipientView,
  SummaryRow,
  Supply,
  Totals,
} from "./documents-api.ts";

/** The invoice family of M5.1 (only `tax_invoice` can be issued now; the others arrive with M5.2 and M5.3). */
export type InvoiceType = "proforma" | "tax_invoice" | "export_invoice" | "credit_note" | "debit_note";
export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "partially_credited"
  | "credited"
  | "void"
  | "converted";
/** The list's status filter: a stored status, or `overdue` (worked out by the server: a balance past its due date). */
export type InvoiceListStatus = InvoiceStatus | "overdue";

export type InvoiceListRow = {
  id: string;
  type: InvoiceType;
  status: InvoiceStatus;
  number: string | null;
  clientId: string;
  clientCode: string;
  clientName: string;
  currency: Currency;
  totalMinor: number;
  balanceMinor: number;
  issueDate: string | null;
  dueDate: string | null;
  overdue: boolean;
  pdf: "none" | "pending" | "ready";
  createdAt: number;
  updatedAt: number;
  approval: ApprovalState;
};

export type InvoiceListQuery = {
  type?: InvoiceType | undefined;
  status?: InvoiceListStatus | undefined;
  clientId?: string | undefined;
  limit?: "25" | "50" | undefined;
  after?: string | undefined;
};

/** A blocker as the server sends it: a code, and for a line's blocker the line's 1-based position. */
export type InvoiceBlocker = { code: IssueBlockerCode | string; line?: number };

export type InvoiceLine = {
  id: string;
  position: number;
  catalogueItemId: string | null;
  description: string;
  detail: string | null;
  sac: string | null;
  qtyMilli: number;
  unit: string;
  rateMinor: number;
  discount: Discount | null;
  gstRateBp: number;
  taxableMinor: number | null;
  cgstMinor: number | null;
  sgstMinor: number | null;
  igstMinor: number | null;
  lineTotalMinor: number | null;
};

export type InvoiceIssuerView = {
  company?: { tradeName?: string; legalName?: string | null; gstin?: string | null; stateCode?: string };
  sender?: { staffId?: string; name?: string; email?: string };
  [k: string]: unknown;
};

/** GET /invoices/:id (and what a save answers): a draft worked out today, or an issued invoice read back from what was frozen. */
export type InvoiceView = {
  id: string;
  type: InvoiceType;
  status: InvoiceStatus;
  number: string | null;
  series: string | null;
  fy: string | null;
  currency: Currency;
  issueDate: string | null;
  dueDate: string | null;
  dueDays: number;
  dueDatePreview: string | null;
  createdAt: number;
  updatedAt: number;
  frozenAt: number | null;
  contentSha256: string | null;
  frozen: boolean;
  parentId: string | null;
  sourceDocumentId: string | null;
  client: {
    id: string;
    code: string;
    name: string;
    gstStatus: string;
    stateCode: string | null;
    country: string;
    currency: Currency;
    anonymised: boolean;
  };
  contact: { id: string | null; name: string | null; email: string | null; anonymised: boolean } | null;
  recipient: RecipientView | null;
  issuer: InvoiceIssuerView | null;
  discount: Discount | null;
  lines: InvoiceLine[];
  totals: Totals | null;
  supply: Supply | null;
  summary: SummaryRow[] | null;
  paidMinor: number;
  creditedMinor: number;
  balanceMinor: number;
  overdue: boolean;
  errors: Issue[];
  warnings: Issue[];
  blockers: InvoiceBlocker[];
  typeIssuable: boolean;
  needsResave: boolean;
  issue: {
    decision: "allow" | "step-up" | "approval" | "deny";
    canIssue: boolean;
    approval: ApprovalInfo;
    preview: { series: string; fy: string; template: string; padding: number };
  };
  void: {
    voidedAt: number | null;
    reason: string | null;
    canVoid: boolean;
    blockers: (VoidBlockerCode | string)[];
  };
  pdf: { state: "none" | "pending" | "ready"; sha256: string | null; fingerprint: string | null };
  milestone: { id: string; title: string; projectId: string; status: string } | null;
  terms: { id: string; version: number; sha256: string } | null;
};

export type InvoicePatch = {
  expectedUpdatedAt: number;
  fields?: { contactId?: string | null; discount?: Discount | null };
  lines?: LineIn[];
};

export type NewInvoiceInput = {
  clientId: string;
  contactId?: string;
  fromMilestoneId?: string;
  services?: { catalogueItemId: string; defaultLines?: string[] }[];
};

export type IssuedResult = {
  ok: true;
  id: string;
  number: string | null;
  issueDate: string;
  dueDate: string;
  fy: string;
  fyLabel: string;
  status: "issued";
  updatedAt: number;
  approvalId?: string;
};

/** One row of the owner's queue of issue requests (GET /approvals?kind=issue). */
export type IssueApprovalRow = {
  id: string;
  kind: "issue";
  state: ApprovalState;
  createdAt: number;
  decidedAt: number | null;
  reason: string | null;
  note: string | null;
  requestedBy: string;
  requesterName: string | null;
  decidedBy: string | null;
  deciderName: string | null;
  document: {
    id: string;
    type: InvoiceType;
    status: InvoiceStatus;
    number: string | null;
    currency: Currency;
    clientCode: string;
    clientName: string;
  };
  totalMinor: number;
};

const enc = encodeURIComponent;

/** The PDF of an issued invoice: a same-origin download (the API answers an attachment). */
export const invoicePdfHref = (id: string) => `/api/v1/invoices/${enc(id)}/pdf`;

export const invoicesApi = {
  list: (q: InvoiceListQuery = {}) =>
    request<{ invoices: InvoiceListRow[]; next: string | null }>(`/invoices${qs(q)}`),
  clientList: (clientId: string, after?: string, limit?: "25" | "50") =>
    request<{ invoices: InvoiceListRow[]; next: string | null }>(
      `/clients/${enc(clientId)}/invoices${qs({ after, limit })}`,
    ),
  get: (id: string) => request<InvoiceView>(`/invoices/${enc(id)}`),
  create: (body: NewInvoiceInput) =>
    request<{
      id: string;
      type: InvoiceType;
      updatedAt: number;
      contentSha256: string;
      totalMinor: number | null;
    }>("/invoices", { body }),
  save: (id: string, body: InvoicePatch) =>
    request<InvoiceView>(`/invoices/${enc(id)}`, { method: "PATCH", body }),
  discard: (id: string, expectedUpdatedAt: number) =>
    request<{ ok: true }>(`/invoices/${enc(id)}${qs({ expectedUpdatedAt: String(expectedUpdatedAt) })}`, {
      method: "DELETE",
    }),
  issue: (id: string, expectedUpdatedAt: number, expectedContentSha256: string) =>
    request<IssuedResult>(`/invoices/${enc(id)}/issue`, {
      body: { expectedUpdatedAt, expectedContentSha256 },
    }),
  requestIssue: (id: string, expectedUpdatedAt: number) =>
    request<{ id: string; status: "pending" }>(`/invoices/${enc(id)}/issue-request`, {
      body: { expectedUpdatedAt },
    }),
  void: (id: string, expectedUpdatedAt: number, reason: string) =>
    request<{ ok: true; status: "void"; number: string | null; voidedAt: number; updatedAt: number }>(
      `/invoices/${enc(id)}/void`,
      { body: { expectedUpdatedAt, reason } },
    ),
  retryPdf: (id: string) =>
    request<{ ok: true; pdf: { state: "pending" } }>(`/invoices/${enc(id)}/pdf/retry`, { body: {} }),
  issueApprovals: (q: { status?: ApprovalState | undefined; after?: string | undefined } = {}) =>
    request<{ approvals: IssueApprovalRow[]; next: string | null }>(
      `/approvals${qs({ kind: "issue", ...q })}`,
    ),
  /** Approve = issue (the approver's fresh code first); reject leaves the draft as it was. */
  decide: (id: string, decision: "approve" | "reject", note?: string) =>
    request<IssuedResult | { ok: true; status: "rejected" }>(`/approvals/${enc(id)}/decide`, {
      body: note ? { decision, note } : { decision },
    }),
};
