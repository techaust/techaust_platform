// The staff words of M6.2 (07-ZI S17 to S24: staff-only, drafted here and approved by the lead under the owner's delegation; the designer may tighten them and
// lists any change in the run file). The client lines (07-ZI 1 to 19) are the portal's and Razorpay's page; none is here. Bells never carry a payer's details
// (L8): the client's display name, the amount and the document number only, as every other bell.
import type { ApiError } from "../context.ts";
import { amountText } from "../payment-messages.ts";

const e = (code: string, message: string): ApiError => ({ code, message });

// ---- S22: bells -------------------------------------------------------------------------------------------------------------------------------------------

/** "{client} paid {amount} online for {number}." */
export const bellPaidOnline = (client: string, amountMinor: number, number: string | null) =>
  `${client} paid ${amountText(amountMinor, "INR")} online for ${number ?? "an invoice"}.`;
/** "A payment needs review: {reason}." */
export const bellNeedsReview = (reason: string) => `A payment needs review: ${reason}`;
/** "Razorpay webhook signatures failed 5 times in an hour. Check the webhook secret." (the jobs Worker writes this bell; the words are kept with the others.) */
export const BELL_SIGNATURES =
  "Razorpay webhook signatures failed 5 times in an hour. Check the webhook secret.";

// ---- S20: review reasons ----------------------------------------------------------------------------------------------------------------------------------

export type ReasonFacts = {
  paidMinor?: number | null;
  expectedMinor?: number | null;
  extraMinor?: number | null;
  reason?: string | null;
  blocker?: string | null;
};

const money = (m: number | null | undefined) => (m == null ? "the amount" : amountText(m, "INR"));

/** One line per review kind (07-ZI S20; the five the designer drafts are drafted here in the same style). */
export function reviewReason(kind: string, f: ReasonFacts = {}): string {
  switch (kind) {
    case "amount_mismatch":
      return `The amount paid (${money(f.paidMinor)}) doesn't match the link (${money(f.expectedMinor)}).`;
    case "unknown_link":
      return "A payment arrived for a link we don't know.";
    case "document_not_payable":
      return `The invoice could no longer be paid when the money arrived (${f.reason ?? "changed"}). The money waits for your decision.`;
    case "advance_blocked":
      return `The tax invoice for this payment couldn't be issued automatically: ${f.blocker ?? "a check failed"}. Issue it from the proforma.`;
    case "refetch_failed":
    case "dead_letter":
      return "Razorpay couldn't be reached to confirm this payment. Try again.";
    case "overpaid":
      return `The client paid ${money(f.extraMinor)} more than was due. It is held as credit.`;
    case "proforma_overpaid":
      return "The client paid more than the proforma's balance. Issue the tax invoice by hand.";
    case "partial_payment":
      return "Razorpay reports only part of the link as paid. Check the payment before confirming it.";
    case "client_gone":
      return "A payment arrived for a client whose details were erased.";
    case "currency_mismatch":
      return "The payment's currency doesn't match the link.";
    case "reference_mismatch":
      return "The payment came through a link that doesn't match our record.";
    case "order_mismatch":
      return "The payment belongs to a different Razorpay order than the link.";
    case "payment_not_on_link":
      return "Razorpay doesn't list this payment on the link.";
    case "not_captured":
      return "Razorpay reports this payment as failed or refunded.";
    default:
      return "Check this payment.";
  }
}

// ---- S24: the API messages of section C's new error codes --------------------------------------------------------------------------------------------------

export const amountBelowMinimum = (minimumMinor: number): ApiError =>
  e("amount_below_minimum", `Enter an amount of at least ${amountText(minimumMinor, "INR")}.`);
export const amountAboveBalance = (balanceMinor: number): ApiError =>
  e("amount_above_balance", `That's more than the amount due (${amountText(balanceMinor, "INR")}).`);
export const AMOUNT_NOT_WHOLE_RUPEE = e("amount_not_whole_rupee", "Enter a whole number of rupees.");
export const NOT_PAYABLE_ONLINE = e("not_payable_online", "This document can't be paid online.");
export const LINK_IN_PROGRESS = e(
  "link_in_progress",
  "A payment link for this document is being made. Try again in a moment.",
);
export const LINK_NOT_LIVE = e("link_not_live", "This payment link is no longer live.");
export const REVIEW_RESOLVED = e("review_resolved", "This item was already resolved.");
export const TOO_MANY_LINKS = e(
  "too_many_links",
  "Too many payment links were made for this client in the last hour. Try again later.",
);
export const GATEWAY_UNAVAILABLE = e("gateway_unavailable", "Online payment isn't set up right now.");
export const LIVE_NOT_ALLOWED = e("live_not_allowed", "Live payments aren't switched on yet.");
export const GATEWAY_ERROR = e("gateway_error", "Razorpay couldn't be reached. Try again.");
export const GATEWAY_REFUND_NEEDED = e(
  "gateway_refund_needed",
  "A Razorpay payment can't be rejected here. It needs a refund through Razorpay.",
);
export const GATEWAY_PAYMENT = e(
  "gateway_payment",
  "A Razorpay payment can't be withdrawn here. It needs a refund through Razorpay.",
);
export const NOT_RETRYABLE = e("not_retryable", "This item can't be tried again. Resolve it instead.");
