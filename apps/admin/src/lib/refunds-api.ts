// The typed client for the M6.5 finance routes (apps/admin/worker/refunds.ts, recon.ts, reductions.ts, receipt-read.ts and the invoices Worker's
// receipt-issue.ts): refunds, receipts, reconciliation and FEMA reductions [ADM-PAY-08, ADM-PAY-09, ADM-PAY-10, ADM-INV-17]. Its own module, so the main chunk
// doesn't carry it: only the payment screens import it. The shapes mirror the Workers' answers (the reconciliation rows are the rows themselves, snake_case).
// Money is integer minor units; the screens only format it (through core), never work it out.
import type { RefundOrigin, RefundReason, RefundStatus } from "@techaust/core/refunds";
import type { Currency } from "../api.ts";
import { qs, request } from "../api.ts";

const pid = (id: string) => encodeURIComponent(id);

/** One refund as the screens read it (`view()` in worker/refunds.ts). */
export type RefundView = {
  id: string;
  paymentId: string;
  clientId: string;
  documentId: string | null;
  creditNoteId: string | null;
  provider: string;
  origin: RefundOrigin;
  status: RefundStatus;
  mode: string | null;
  paidTo: string | null;
  reasonCode: RefundReason;
  currency: Currency;
  amountMinor: number;
  referenceNorm: string | null;
  paidOn: string | null;
  providerRefundId: string | null;
  failureCode: string | null;
  requestedAt: number;
  attempts: number;
  settledOn: string | null;
  updatedAt: number;
  /** The Refunds tab's rows only. */
  clientCode?: string;
  clientName?: string;
};

/** The refunds of the Payments panel (`PANEL_REFUNDS_SQL`): the columns the panel reads. */
export type PanelRefund = Pick<
  RefundView,
  | "id"
  | "paymentId"
  | "documentId"
  | "provider"
  | "origin"
  | "status"
  | "reasonCode"
  | "currency"
  | "amountMinor"
  | "requestedAt"
  | "settledOn"
  | "failureCode"
>;

/** A payment's receipt on the Payments panel (null fields: none issued yet). `freeMinor`: what a refund from credit may take. */
export type PanelReceipt = {
  receiptId: string | null;
  number: string | null;
  issueDate: string | null;
  status: string | null;
  hasPdf: boolean;
  freeMinor: number;
};

/** The ₹25 lakh check per gateway (core `paCbCheck`). */
export type PaCbVerdict =
  | { ok: true; inrMinor: number }
  | { ok: false; code: "above_pa_cb_cap"; inrMinor: number }
  | { ok: false; code: "rate_unknown" };

/** What GET /invoices/:id/payments adds in M6.5 (absent from an older API). */
export type PanelM65 = {
  receipts?: Record<string, PanelReceipt>;
  /** Null for a role without `refunds.read`. */
  refunds?: PanelRefund[] | null;
  paCb?: { paypal: PaCbVerdict; stripe: PaCbVerdict } | null;
};

/** RA-40: the credit-note facts of the invoice a refund draws on (`refund-facts.ts`). */
export type CreditNoteFacts = {
  lastDay: string;
  open: boolean;
  deadlineWarnFrom: string | null;
  supplyFy?: string;
  basis?: string;
  period?: string;
  returnBy?: string;
};
/** RA-41: the facts of credit left on one payment, refunded today. */
export type CreditRefundFacts = {
  advanceLine: "credit_may_be_advance" | null;
  creditCrossedPeriod: boolean;
  showLine: boolean;
  receivedOn: string;
  receivedPeriod: string;
  refundPeriod: string;
};
export type RefundFacts = { ra41: CreditRefundFacts; creditNote: CreditNoteFacts | null };

/** The body of POST /payments/:id/refunds (core `refundBody`). */
export type RefundIn = {
  id: string;
  amountMinor: number;
  from: "credit" | "document" | "pending";
  documentId?: string;
  creditNoteId?: string;
  reasonCode: RefundReason;
  note?: string;
  manual?: { mode: string; reference: string; paidOn: string; paidTo: "original" | "own_account" };
  outside?: { providerRefundId: string; origin: "outside" | "chargeback"; settledOn: string };
  confirmExport?: boolean;
  expectedUpdatedAt?: number;
};

export type ReceiptOfPayment = {
  id: string;
  number: string | null;
  issueDate: string | null;
  status: string;
  hasPdf: boolean;
  voidedAt: number | null;
};

/** A settlement row (snake_case, `SETTLEMENTS_SQL`). */
export type SettlementRow = {
  id: string;
  provider: string;
  settlement_id: string;
  utr: string | null;
  currency: Currency;
  amount_minor: number;
  fees_minor: number;
  tax_minor: number;
  settled_on: string;
  status: string;
  items: number;
  matched: number;
  bank_match_id: string | null;
};
export type SettlementItemRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  direction: string;
  amount_minor: number;
  fee_minor: number | null;
  tax_minor: number | null;
  match: string;
  payment_id: string | null;
  refund_id: string | null;
  fee_mismatch: number;
  settlement_id?: string | null;
  created_at?: number;
};
/** An unmatched row of the `gateway` and `manual` tabs. */
export type UnsettledPaymentRow = {
  id: string;
  client_id: string;
  currency: Currency;
  amount_minor: number;
  received_on: string;
  provider_payment_id?: string | null;
  reference_norm?: string | null;
};
export type UnmatchedTab = "items" | "gateway" | "manual";

/** One FEMA reduction (`REDUCTIONS_OF_DOCUMENT_SQL`). */
export type ReductionRow = {
  id: string;
  currency: Currency;
  amount_minor: number;
  approved_on: string;
  bank_ref: string;
  declaration: number;
  has_letter: number;
  recorded_by: string | null;
  created_at: number;
};

export const refundsApi = {
  /** A payment's refunds and the dialog's facts (`documentId`: the invoice the refund would draw on, for RA-40). */
  ofPayment: (paymentId: string, documentId?: string) =>
    request<{ items: RefundView[]; facts: RefundFacts | null }>(
      `/payments/${pid(paymentId)}/refunds${qs({ documentId })}`,
    ),
  /**
   * The refund (Owner, fresh code). 200 `{refund, facts}`; 202 `{refund, status: "requested"}` (the gateway didn't answer). Codes: `credit_note_needed` (details
   * `excessMinor`, `noteReason`, `creditNoteLastDay`, `creditNoteOpen`), `exceeds_refundable` (`refundableMinor`), `exceeds_holding` (`holdingMinor`),
   * `export_refund_unconfirmed`, `refund_in_progress`, `gateway_refund_window`, `paid_to_invalid`, `day_invalid`, `gateway_refused` (`code`), `gateway_error`,
   * `gateway_unavailable`, `live_not_allowed`, `capture_pending`, `outside_not_at_gateway`, `client_anonymised`, `stale_version`.
   */
  create: (paymentId: string, body: RefundIn) =>
    request<{ refund: RefundView | null; facts?: RefundFacts; status?: "requested" }>(
      `/payments/${pid(paymentId)}/refunds`,
      { body },
    ),
  /** The Refunds tab, newest first, 50 a page. */
  list: (f: { status?: RefundStatus; cursor?: string } = {}) =>
    request<{ items: RefundView[]; next: string | null }>(`/refunds${qs(f)}`),
  /** "Try again" (Owner). Codes: `too_soon` (details `retryAfterS`), `gateway_unavailable`, `live_not_allowed`. */
  retry: (id: string) =>
    request<{ refund: RefundView | null; result: string }>(`/refunds/${pid(id)}/retry`, { body: {} }),
  /** Cancel a refund the gateway never received (Owner). Codes: `too_soon`, `not_cancellable`, `refund_found`, `gateway_error`. */
  cancel: (id: string) => request<{ refund: RefundView | null }>(`/refunds/${pid(id)}/cancel`, { body: {} }),
  // ---- receipts ----
  receiptOf: (paymentId: string) =>
    request<{ receipt: ReceiptOfPayment | null }>(`/payments/${pid(paymentId)}/receipt`),
  /** The receipt's PDF: a plain same-origin GET with the session cookie (an attachment). */
  receiptPdfHref: (receiptId: string) => `/api/v1/receipts/${pid(receiptId)}/pdf`,
  /** "Make the PDF again" (Owner, Staff). Codes: `pdf_done`, `too_soon` (429), `client_gone`. */
  receiptRemake: (receiptId: string) =>
    request<{ ok: true }>(`/receipts/${pid(receiptId)}/pdf/retry`, { body: {} }),
  // ---- reconciliation ----
  settlements: (cursor?: string) =>
    request<{ items: SettlementRow[]; next: string | null }>(`/reconciliation/settlements${qs({ cursor })}`),
  settlement: (id: string) =>
    request<{ settlement: SettlementRow; items: SettlementItemRow[] }>(
      `/reconciliation/settlements/${pid(id)}`,
    ),
  unmatched: (tab: UnmatchedTab, cursor?: string) =>
    request<{ items: (SettlementItemRow & UnsettledPaymentRow)[]; next: string | null }>(
      `/reconciliation/unmatched${qs({ tab, cursor })}`,
    ),
  /** "Seen in bank statement" (Owner). Codes: `match_exists`, `day_invalid`. */
  bankMatch: (body: {
    id: string;
    target: { kind: "payment" | "settlement" | "refund"; id: string };
    statementOn: string;
    statementRef?: string;
  }) => request<{ ok: true; id: string }>("/reconciliation/bank-matches", { body }),
  bankUnmatch: (id: string, reason: string) =>
    request<{ ok: true }>(`/reconciliation/bank-matches/${pid(id)}/remove`, { body: { reason } }),
  /** "Fetch now" (Owner): one page of a day. Codes: `too_soon` (429), `gateway_unavailable`, `live_not_allowed`, `day_invalid`. */
  fetchDay: (day: string) =>
    request<{ result: string; next?: { skip: number } }>("/reconciliation/settlements/fetch", {
      body: { day },
    }),
  // ---- FEMA reductions (RB-43) ----
  reductions: (documentId: string) =>
    request<{ items: ReductionRow[] }>(`/invoices/${pid(documentId)}/realisation-reductions`),
  /** The Owner (fresh code). Codes: `declaration_too_large`, `reduction_refused`, `day_invalid`. */
  addReduction: (
    documentId: string,
    body: {
      id: string;
      amountMinor: number;
      approvedOn: string;
      bankRef: string;
      declaration: boolean;
      note?: string;
    },
  ) => request<{ ok: true; id: string }>(`/invoices/${pid(documentId)}/realisation-reductions`, { body }),
};
