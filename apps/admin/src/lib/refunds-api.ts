// The typed client for the M6.5 finance routes (apps/admin/worker/refunds.ts, recon.ts, reductions.ts, receipt-read.ts and the invoices Worker's
// receipt-issue.ts): refunds, receipts, reconciliation and FEMA reductions [ADM-PAY-08, ADM-PAY-09, ADM-PAY-10, ADM-INV-17]. Its own module, so the main chunk
// doesn't carry it: only the payment screens import it. The shapes mirror the Workers' answers (the reconciliation rows are the rows themselves, snake_case).
// Money is integer minor units; the screens only format it (through core), never work it out.
import { REFUND_SWEEP_IDLE_MS } from "@techaust/core/gateway-rpc";
import {
  previousReturnPeriod,
  type RefundOrigin,
  type RefundReason,
  type RefundStatus,
  returnPeriodEnd,
} from "@techaust/core/refunds";
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
  /** Review part 1, finding 9: the INR the bank debited for a refund in another currency (null until the Owner records it). */
  inrRefundedMinor?: number | null;
  referenceNorm: string | null;
  paidOn: string | null;
  providerRefundId: string | null;
  failureCode: string | null;
  requestedAt: number;
  /** The last check's instant (UTC ms), null before any (L44, L46: with `requestedAt`, when "Try again" and Cancel open). */
  lastAttemptAt: number | null;
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
  | "lastAttemptAt"
  | "settledOn"
  | "failureCode"
  | "inrRefundedMinor"
>;

/** Payments › Credit at period end (review part 1, finding 3): the period `p` and the ones before it, newest first, `n` in all, by the filing frequency. */
export function periodsFrom(p: string, frequency: "monthly" | "quarterly", n = 8): string[] {
  const out = [p];
  while (out.length < n) {
    const end = returnPeriodEnd(out.at(-1) as string);
    if (!end) break;
    out.push(previousReturnPeriod(end, frequency));
  }
  return out;
}

/**
 * When "Try again" and Cancel open (L44, L46): `REFUND_SWEEP_IDLE_MS` after the later of the request and the last check, as the server's `refundIdleAt` counts
 * (apps/admin/worker/refund-flow.ts), so the time shows before any press. A `too_soon` answer still moves it to the server's `retryAfterS`.
 */
export const refundOpensAt = (r: Pick<RefundView, "requestedAt" | "lastAttemptAt">): number =>
  Math.max(r.requestedAt, r.lastAttemptAt ?? r.requestedAt) + REFUND_SWEEP_IDLE_MS;

/** A payment's receipt on the Payments panel (null fields: none issued yet). `freeMinor`: what a refund from credit may take. */
export type PanelReceipt = {
  receiptId: string | null;
  number: string | null;
  issueDate: string | null;
  status: string | null;
  hasPdf: boolean;
  freeMinor: number;
  /** Review part 1, finding 3 (RA-41): the payment's credit facts (null for an entry that isn't confirmed money received). */
  ra41?: CreditRefundFacts | null;
};

/** One row of Payments › Credit at period end (`GET /payments/credit-held`; RA-41). */
export type CreditHeldRow = {
  paymentId: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  currency: Currency;
  receivedOn: string;
  amountMinor: number;
  creditMinor: number;
  onInvoice: boolean;
  heldSince: string;
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
/** `issuedCreditNote` (review part 1, finding 6): the invoice's newest issued credit note, the one a refund of its excess is linked to (RA-40). */
export type RefundFacts = {
  ra41: CreditRefundFacts;
  creditNote: CreditNoteFacts | null;
  issuedCreditNote?: { id: string; number: string | null } | null;
};

/** The body of POST /payments/:id/refunds (core `refundBody`). */
export type RefundIn = {
  id: string;
  amountMinor: number;
  from: "credit" | "document" | "pending";
  documentId?: string;
  creditNoteId?: string;
  reasonCode: RefundReason;
  note?: string;
  manual?: {
    mode: string;
    reference: string;
    paidOn: string;
    paidTo: "original" | "own_account";
    /** RB-24: the payer asked in writing (required with `own_account`). */
    writtenRequest?: true;
  };
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
  /** The Refunds tab, newest first, 50 a page; `clientId`: one client's only. */
  list: (f: { status?: RefundStatus; clientId?: string; cursor?: string } = {}) =>
    request<{ items: RefundView[]; next: string | null }>(`/refunds${qs(f)}`),
  /** "Try again" (Owner). Codes: `too_soon` (details `retryAfterS`), `gateway_unavailable`, `live_not_allowed`. */
  retry: (id: string) =>
    request<{ refund: RefundView | null; result: string }>(`/refunds/${pid(id)}/retry`, { body: {} }),
  /** Cancel a refund the gateway never received (Owner). Codes: `too_soon`, `not_cancellable`, `refund_found`, `gateway_error`. */
  cancel: (id: string) => request<{ refund: RefundView | null }>(`/refunds/${pid(id)}/cancel`, { body: {} }),
  /** The INR the bank debited for a refund in another currency, once (Owner, fresh code). Codes: `inr_already_set`, `inr_not_applicable`. */
  recordInr: (id: string, inrMinor: number) =>
    request<{ refund: RefundView | null }>(`/refunds/${pid(id)}/inr`, { body: { inrMinor } }),
  /** Payments › Credit at period end (RA-41): one return period (none: the latest that has ended), 50 a page. */
  creditHeld: (f: { period?: string; cursor?: string } = {}) =>
    request<{
      period: string;
      periodEnd: string;
      frequency: "monthly" | "quarterly";
      items: CreditHeldRow[];
      next: string | null;
    }>(`/payments/credit-held${qs(f)}`),
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
