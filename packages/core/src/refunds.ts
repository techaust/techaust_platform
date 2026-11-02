// Refunds, pure (M6.5; ADM-PAY-08, ADM-PAY-11, ADM-INV-09, ADM-INV-11; run file docs/runs/m6.5-receipts-refunds.md B, Step 0 and L33 to L39). No I/O, no zod, no
// floats: amounts cross the boundary as safe integers (minor units) and every sum runs in bigint. Codes only: the words are the screens' (07-ZO, staff lines S1–S30).
//
//   - the refund's lists and status moves (`REFUND_STATUSES`, `canMoveRefund`; the twin of the trigger `payment_refunds_status_flow`, 0070);
//   - what a payment can still give back from credit (`refundableOf`, the twin of `paymentFreeSql` in `@techaust/db/sql-rules`);
//   - the plan of one refund (`planRefund`): from the client's credit, from an invoice's excess (after its credit note, Q1 A), or a pending gateway payment in
//     full (L33), each refused with the code the route answers (the database holds the same bounds: `payment_refunds_bounds`, the insert's WHERE, L2);
//   - the warnings: a refund of export money (RB-43) and credit that may be an advance (RA-41).
// The live guard is the existing `liveModeAllowed` (`@techaust/core/payments`), checked by the route before anything is written (review fix 3).

import { refundDueOf } from "./ledger.ts";

export const REFUND_PROVIDERS = ["manual", "razorpay", "stripe", "paypal"] as const;
export type RefundProvider = (typeof REFUND_PROVIDERS)[number];
export const REFUND_ORIGINS = ["owner", "outside", "chargeback"] as const;
export type RefundOrigin = (typeof REFUND_ORIGINS)[number];
export const REFUND_STATUSES = ["requested", "processing", "succeeded", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
/** A manual refund's bank mode (the five bank modes of a manual payment). */
export const REFUND_MODES = ["neft", "rtgs", "imps", "upi", "swift"] as const;
export type RefundMode = (typeof REFUND_MODES)[number];
/** Researched 2026-10-28, RBI PA Directions 2025 para 10(f) (08-C RB-24): the original method, or another account in the payer's own name at their request. */
export const REFUND_PAID_TO = ["original", "own_account"] as const;
export type RefundPaidTo = (typeof REFUND_PAID_TO)[number];
export const REFUND_REASONS = [
  "credit_note",
  "overpayment",
  "duplicate",
  "tds_payback",
  "chargeback",
  "other",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];
/** The statuses in which a refund still holds the money (one open refund per payment, L8: the partial unique index `payment_refunds_open`). */
export const OPEN_REFUND_STATUSES = ["requested", "processing"] as const;

const isIn = <T extends string>(xs: readonly T[], v: unknown): v is T =>
  (xs as readonly unknown[]).includes(v);
export const isRefundStatus = (v: unknown): v is RefundStatus => isIn(REFUND_STATUSES, v);
export const isRefundReason = (v: unknown): v is RefundReason => isIn(REFUND_REASONS, v);
export const isRefundMode = (v: unknown): v is RefundMode => isIn(REFUND_MODES, v);
export const isRefundPaidTo = (v: unknown): v is RefundPaidTo => isIn(REFUND_PAID_TO, v);

/** requested → processing | succeeded | failed; processing → succeeded | failed; succeeded and failed are final. Staying put is not a move. */
export function canMoveRefund(from: string, to: string): boolean {
  if (from === "requested") return to === "processing" || to === "succeeded" || to === "failed";
  if (from === "processing") return to === "succeeded" || to === "failed";
  return false;
}

// ---- safe integers in, bigint inside ------------------------------------------------------------------------------------------------------------------

const isSafe = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);
const num = (b: bigint): number => {
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw new RangeError("the result is not a safe integer");
  return n;
};

/**
 * What a confirmed money-received payment can still give back from credit: its amount less what it holds net on documents and less its refunds that have not
 * failed (`refundedMinor`). Never below zero. The twin of `paymentFreeSql` (`@techaust/db/sql-rules`; a db test compares them).
 */
export function refundableOf(payment: {
  readonly amountMinor: number;
  readonly netAllocatedMinor: number;
  readonly refundedMinor: number;
}): number {
  for (const v of [payment.amountMinor, payment.netAllocatedMinor, payment.refundedMinor])
    if (!isSafe(v)) throw new RangeError("not a safe integer");
  const left =
    BigInt(payment.amountMinor) - BigInt(payment.netAllocatedMinor) - BigInt(payment.refundedMinor);
  return left > 0n ? num(left) : 0;
}

// ---- the plan of one refund -----------------------------------------------------------------------------------------------------------------------

/** The source payment as the route reads it. */
export type RefundSourcePayment = {
  readonly id: string;
  readonly clientId: string;
  readonly currency: "INR" | "USD";
  readonly kind: string;
  readonly status: string;
  readonly provider: string;
  readonly amountMinor: number;
  /** Σ allocate − Σ release of this payment. */
  readonly netAllocatedMinor: number;
  /** Σ its refunds that have not failed. */
  readonly refundedMinor: number;
  /** The ISO IST day the money arrived (Razorpay's refund window counts from it). */
  readonly receivedOn: string;
  /** A refund of this payment is `requested` or `processing` (L8). */
  readonly hasOpenRefund: boolean;
};

/** The invoice whose excess is refunded, as the route reads it. */
export type RefundDocument = {
  readonly id: string;
  readonly clientId: string;
  readonly currency: string;
  readonly type: string;
  readonly status: string;
  readonly frozen: boolean;
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly creditedMinor: number;
  readonly tdsMinor: number;
  /** A tax invoice for a payment received (`header_extras.advance`): its refund needs a credit note with reason `service_not_delivered` (RA-40). */
  readonly isAdvanceInvoice: boolean;
};

export type RefundSource = "credit" | "document" | "pending";

export type RefundPlanInput = {
  readonly payment: RefundSourcePayment;
  readonly from: RefundSource;
  /** Through the payment's own gateway, or by a bank transfer we make. */
  readonly via: "gateway" | "manual";
  readonly amountMinor: number;
  /** With `from: "document"`. */
  readonly doc?: RefundDocument | undefined;
  /** With `from: "document"`: what THIS payment holds net on `doc`. */
  readonly holdingMinor?: number | undefined;
  /** Today, the ISO IST day. */
  readonly today: string;
};

export const REFUND_REFUSALS = [
  "invalid_amount",
  "not_refundable_kind",
  "payment_not_confirmed",
  "payment_not_pending",
  "pending_gateway_only",
  "pending_full_only",
  "refund_in_progress",
  "not_gateway_payment",
  "gateway_refund_window",
  "document_mismatch",
  "currency_mismatch",
  "exceeds_refundable",
  "exceeds_holding",
  "credit_note_needed",
] as const;
export type RefundRefusal = (typeof REFUND_REFUSALS)[number];

/**
 * RA-40 (Researched 2026-11-03, CBIC Circular 137/07/2020-GST issue 1; GST Council flyer ch. 6 (08-C RA-40)): the reason the credit note of an advance invoice's
 * refund is drafted with. Never a refund voucher: TecHaust issues no receipt voucher while the advance mode is not `receipt_voucher`.
 */
export const ADVANCE_REFUND_NOTE_REASON = "service_not_delivered";

export type RefundPlan =
  | {
      readonly ok: true;
      /** From a document: the `release` row of exactly the refund's amount, written right after the refund row (L1, L2). */
      readonly release?: { readonly documentId: string; readonly amountMinor: number };
      /** From a pending gateway payment (L33): the payment is rejected by the system once the refund succeeds; no allocation, no receipt. */
      readonly rejectsPayment?: true;
    }
  | {
      readonly ok: false;
      readonly code: RefundRefusal;
      /** `exceeds_refundable`: what the payment can still give back from credit. */
      readonly refundableMinor?: number;
      /** `exceeds_holding`: what this payment holds on the document. */
      readonly holdingMinor?: number;
      /** `credit_note_needed`: the excess the document has today (Q1 A: the credit note comes first). */
      readonly excessMinor?: number;
      /** `credit_note_needed`: the reason the credit note is drafted with, when the law fixes it (RA-40); null: the Owner picks. */
      readonly noteReason?: typeof ADVANCE_REFUND_NOTE_REASON | null;
    };

/**
 * Razorpay refunds a normal-speed payment only within 6 months of the payment (vendor fact R3, CONFIRMED 2026-11-03: razorpay.com/docs/api/refunds/create-normal/).
 * Counted from the day the money arrived; on the 6-month anniversary itself the refund is refused (the safe side: the gateway's own count may start at capture).
 */
export const RAZORPAY_REFUND_MONTHS = 6;

/** `iso` (YYYY-MM-DD) plus `months`, clamped to the last day of the target month, as ISO text. */
export function addMonthsIso(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const total = y * 12 + (m - 1) + months;
  const ty = Math.trunc(total / 12);
  const tm = (total % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(ty, 4)}-${pad(tm)}-${pad(Math.min(d, last))}`;
}

const isIsoDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * The plan of one refund, checked in the order the route answers (the database holds the same bounds again: `payment_refunds_bounds`, the insert's WHERE and
 * `ledger_result`, L2), the first refusal found returned:
 *   1. the amount is a positive safe integer; the payment is money received (never TDS: L14's payback is not built while 08-C RA-30's point is OPEN);
 *   2. the source: `pending` (L33) is a pending gateway payment refunded in full through its own gateway; `credit` and `document` need confirmed money;
 *   3. no other refund of the payment is open (L8);
 *   4. through a gateway: the payment came by one, and Razorpay's 6-month window has not passed;
 *   5. from credit: at most what the payment can give back (`refundableOf`);
 *   6. from a document: the document is the client's issued, live invoice or debit note in the payment's currency; at most what this payment holds there
 *      (`exceeds_holding`, round 3); at most the document's excess (paid + credited + TDS − total), else `credit_note_needed` with the excess and, for an advance
 *      invoice, the reason `service_not_delivered` (RA-40). A plan from a document carries the release of exactly the refund's amount.
 */
export function planRefund(input: RefundPlanInput): RefundPlan {
  const { payment: p, from, via, amountMinor } = input;
  if (!isSafe(amountMinor) || amountMinor <= 0) return { ok: false, code: "invalid_amount" };
  if (p.kind !== "payment") return { ok: false, code: "not_refundable_kind" };
  if (from === "pending") {
    if (p.status !== "pending_verification") return { ok: false, code: "payment_not_pending" };
    if (p.provider === "manual" || via !== "gateway") return { ok: false, code: "pending_gateway_only" };
    if (amountMinor !== p.amountMinor) return { ok: false, code: "pending_full_only" };
  } else if (p.status !== "confirmed") return { ok: false, code: "payment_not_confirmed" };
  if (p.hasOpenRefund) return { ok: false, code: "refund_in_progress" };
  if (via === "gateway") {
    if (p.provider === "manual") return { ok: false, code: "not_gateway_payment" };
    if (p.provider === "razorpay") {
      if (!isIsoDay(p.receivedOn) || !isIsoDay(input.today))
        return { ok: false, code: "gateway_refund_window" };
      if (input.today >= addMonthsIso(p.receivedOn, RAZORPAY_REFUND_MONTHS))
        return { ok: false, code: "gateway_refund_window" };
    }
  }
  if (from === "pending") return { ok: true, rejectsPayment: true };
  if (from === "credit") {
    const refundable = refundableOf(p);
    return amountMinor > refundable
      ? { ok: false, code: "exceeds_refundable", refundableMinor: refundable }
      : { ok: true };
  }
  const d = input.doc;
  if (
    !d?.frozen ||
    d.clientId !== p.clientId ||
    !["tax_invoice", "export_invoice", "debit_note"].includes(d.type) ||
    d.status === "void"
  )
    return { ok: false, code: "document_mismatch" };
  if (d.currency !== p.currency) return { ok: false, code: "currency_mismatch" };
  const holding = input.holdingMinor ?? 0;
  if (!isSafe(holding)) return { ok: false, code: "invalid_amount" };
  if (amountMinor > holding)
    return { ok: false, code: "exceeds_holding", holdingMinor: Math.max(0, holding) };
  const excess = refundDueOf(d.totalMinor, d.paidMinor, d.creditedMinor, d.tdsMinor);
  if (amountMinor > excess)
    return {
      ok: false,
      code: "credit_note_needed",
      excessMinor: excess,
      noteReason: d.isAdvanceInvoice ? ADVANCE_REFUND_NOTE_REASON : null,
    };
  return { ok: true, release: { documentId: d.id, amountMinor } };
}

// ---- warnings ------------------------------------------------------------------------------------------------------------------------------------------

/**
 * RB-43 (Settled by the lead on the safest reading, 2026-11-03 (08-C RB-43)): a refund of export money (an export invoice's excess, or credit of a client outside
 * India) needs the AD bank's reduction under FEMA 23(R)/2026-RB Reg. 6 asked first; the route answers 409 `export_refund_unconfirmed` until the Owner ticks that
 * the bank was told (`confirmExport`). True when the warning applies.
 */
export function refundExportWarning(f: {
  readonly docType?: string | null;
  readonly clientOverseas: boolean;
}): boolean {
  return f.docType === "export_invoice" || f.clientOverseas;
}

/** The GSTR-3B return period an ISO day falls in, by the filing frequency (`tax.gstr1Frequency`: QRMP files quarterly): "2026-11" or "2026-Q4" (Oct–Dec). */
export function returnPeriodOf(iso: string, frequency: "monthly" | "quarterly"): string {
  const y = iso.slice(0, 4);
  const m0 = Number(iso.slice(5, 7)) - 1;
  return frequency === "monthly" ? iso.slice(0, 7) : `${y}-Q${Math.trunc(m0 / 3) + 1}`;
}

/**
 * RA-41 (Settled by the lead on the safest reading, 2026-11-03 (08-C RA-41)): whether credit left on a payment may be an advance whose GST was due when it arrived
 * (s.13(2) CGST Act; RA-36), so the screens show the RA-41 line. Money not put on any invoice is an advance; an excess over its invoices of up to the s.13(2) proviso's
 * ₹1,000 (`tax.excessProvisoMinor`, default 100000 paise) is not, since TecHaust takes the proviso's option (the next invoice's date is the time of supply). A
 * USD payment has no INR value at hand here, so any credit shows the line (the safe side). Null: no line.
 */
export function overpaymentAdvanceLine(f: {
  readonly currency: "INR" | "USD";
  /** What the payment leaves as credit (its free money). */
  readonly creditMinor: number;
  /** Whether any of the payment is on an invoice. */
  readonly allocatedAny: boolean;
  readonly excessProvisoMinor: number;
}): "credit_may_be_advance" | null {
  if (!isSafe(f.creditMinor) || f.creditMinor <= 0) return null;
  if (!f.allocatedAny || f.currency !== "INR") return "credit_may_be_advance";
  return f.creditMinor > f.excessProvisoMinor ? "credit_may_be_advance" : null;
}

/**
 * RA-41: the refund dialog shows the line when credit is refunded in a later GSTR-3B period than the one its money arrived in (held across a period end: Table 11A
 * of the receipt period and a refund voucher are the follow-up that must be done before the first live payment). Both days are ISO IST days.
 */
export const creditCrossedPeriod = (
  receivedOn: string,
  today: string,
  frequency: "monthly" | "quarterly",
): boolean => returnPeriodOf(receivedOn, frequency) !== returnPeriodOf(today, frequency);
