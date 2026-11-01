// The staff words of M6.2 (07-ZI S17 to S24: staff-only, drafted here and approved by the lead under the owner's delegation; the designer may tighten them and
// lists any change in the run file). The client lines (07-ZI 1 to 19) are the portal's and Razorpay's page; none is here. Bells never carry a payer's details
// (L8): the client's display name, the amount and the document number only, as every other bell.
import type { ApiError } from "../context.ts";
import { amountText } from "../payment-messages.ts";
import { NO_PAYMENT_LISTED_LINE } from "./reasons.ts";

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

// ---- M6.3 (07-ZM S17, staff words, lead under the owner's delegation) -------------------------------------------------------------------------------------------

/** S17: "{client} paid {amount} by card for {number}." (USD, en-US). */
export const bellPaidByCard = (client: string, amountMinor: number, number: string | null) =>
  `${client} paid ${amountText(amountMinor, "USD")} by card for ${number ?? "an invoice"}.`;
/** S17: the Stripe signature bell (the jobs Worker writes it; the words are kept here too, and a test holds the two equal). */
export const BELL_SIGNATURES_STRIPE =
  "Stripe webhook signatures failed 5 times in an hour. Check the webhook secret.";

// ---- S20: review reasons ----------------------------------------------------------------------------------------------------------------------------------
// In `reasons.ts` (pure), so the admin SPA's "Needs review" list reads the same words; re-exported here for the Worker.
export {
  ADVANCE_BLOCKER_WORDS,
  advanceBlockersText,
  NO_PAYMENT_LISTED_LINE,
  NOT_PAYABLE_WORDS,
  notPayableWords,
  type ReasonFacts,
  reviewReason,
} from "./reasons.ts";

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
/** Fix round 4, low 3: "Try again" on a link Razorpay marks paid while it still lists no payment (Razorpay was reached: 409, never 502 `gateway_error`). */
export const NO_PAYMENT_LISTED = e("no_payment_listed", NO_PAYMENT_LISTED_LINE);
export const GATEWAY_REFUND_NEEDED = e(
  "gateway_refund_needed",
  "A Razorpay payment can't be rejected here. It needs a refund through Razorpay.",
);
export const GATEWAY_PAYMENT = e(
  "gateway_payment",
  "A Razorpay payment can't be withdrawn here. It needs a refund through Razorpay.",
);
export const NOT_RETRYABLE = e("not_retryable", "This item can't be tried again. Resolve it instead.");

// ---- M6.3 S19: the API messages of the new codes (builder's drafts, 2026-11-02, marked for the lead in 07-ZM) -----------------------------------------------------

/** 409 `payment_processing`: a gateway payment on the document still waits (core `payment_pending`), or Stripe's session was found complete. */
export const PAYMENT_PROCESSING = e(
  "payment_processing",
  "A payment on this document is still being confirmed. Wait for it before taking another.",
);
/** 400 `amount_above_maximum` (L9): more than one online payment may be. */
export const amountAboveMaximum = (maximumMinor: number, currency: "INR" | "USD"): ApiError =>
  e(
    "amount_above_maximum",
    `Online payments are limited to ${amountText(maximumMinor, currency)} at a time.`,
  );
/** 409 `not_payable_online` with reason `use_portal` (L7): no staff-made link for a card payment. */
export const USE_PORTAL = e(
  "not_payable_online",
  "Card payments are made by the client from the portal. Copy the portal link and send it to them instead.",
);
/** 502 `gateway_error` for Stripe (the Razorpay line names Razorpay). */
export const STRIPE_GATEWAY_ERROR = e("gateway_error", "Stripe couldn't be reached. Try again.");
/** 409 `stripe_permission`: Stripe refused the re-fetch for the restricted key's permissions (401 or 403). */
export const STRIPE_PERMISSION = e(
  "stripe_permission",
  "Stripe refused the request for our key's permissions. Check the restricted key in Stripe, then try again.",
);
/** The verify and withdraw refusals for a Stripe payment (M6.2's lines name Razorpay). */
export const STRIPE_REFUND_NEEDED = e(
  "gateway_refund_needed",
  "A Stripe payment can't be rejected here. It needs a refund through Stripe.",
);
export const STRIPE_GATEWAY_PAYMENT = e(
  "gateway_payment",
  "A Stripe payment can't be withdrawn here. It needs a refund through Stripe.",
);
/** The verify refusal and the withdraw refusal by the payment's gateway. */
export const refundNeededOf = (provider: string): ApiError =>
  provider === "stripe" ? STRIPE_REFUND_NEEDED : GATEWAY_REFUND_NEEDED;
export const gatewayPaymentOf = (provider: string): ApiError =>
  provider === "stripe" ? STRIPE_GATEWAY_PAYMENT : GATEWAY_PAYMENT;
/** Early check 2, finding 1: the proforma changed while its tax invoice was being issued (the admin "Try again" makes one try only). */
export const ADVANCE_CHANGED = e(
  "advance_changed",
  "The proforma changed while its tax invoice was being issued. Try again.",
);
/** Early check 2, finding 5: Resolve records what the money already is; it never moves it. */
export const RESOLUTION_NOT_ALLOWED = e(
  "resolution_not_allowed",
  "That doesn't match the payment yet. Confirm the payment or issue its tax invoice first, or dismiss the item.",
);
