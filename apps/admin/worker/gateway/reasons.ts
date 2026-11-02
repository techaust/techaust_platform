// The "Needs review" reasons of M6.2 (07-ZI S20; staff-only words, approved by the lead under the owner's delegation; the designer's additions are listed in the
// run file). Pure (core only, no Worker types), so the finance Worker's bells and the admin SPA's "Needs review" list say the same words from one copy: the SPA
// imports this file directly, `messages.ts` re-exports it for the Worker. A reason never names a payer (L8): amounts, codes and document words only.
import { formatMoney, money } from "@techaust/core/money";
import type { NotPayableReason } from "@techaust/core/online-pay";

export type ReasonFacts = {
  paidMinor?: number | null;
  expectedMinor?: number | null;
  extraMinor?: number | null;
  /** `document_not_payable`: core `payableOnline`'s reason code (or "changed"); shown in words. */
  reason?: string | null;
  blocker?: string | null;
  /** M6.3: the gateway the item is about (its name in the line; Razorpay when missing) and the money's currency (INR when missing). */
  provider?: string | null;
  currency?: "INR" | "USD" | null;
};

const money_ = (m: number | null | undefined, currency: "INR" | "USD" | null | undefined) =>
  m == null ? "the amount" : formatMoney(money(m, currency === "USD" ? "USD" : "INR"));
/** The gateway's name in a line (M6.3): Stripe or Razorpay. */
const gatewayName = (provider: string | null | undefined) => (provider === "stripe" ? "Stripe" : "Razorpay");

/**
 * `document_not_payable`'s `{reason}` in words (designer's draft, 2026-11-01, for the lead): core `NOT_PAYABLE_REASONS` and the race fallback "changed". An
 * unknown code reads as "it changed", never as the code. M6.3 B2 (07-ZM S19, approved by the lead 2026-11-02): the four reasons core gained for Stripe, and
 * `use_portal` (L7: no staff link for a card payment).
 */
export const NOT_PAYABLE_WORDS: Record<NotPayableReason | "changed" | "use_portal", string> = {
  type_not_payable: "this kind of document isn't paid online",
  not_inr: "it isn't in rupees",
  client_overseas: "the client is outside India",
  client_anonymised: "the client's details were erased",
  not_issued: "it isn't issued",
  void: "it was voided",
  withdrawn: "it was withdrawn",
  nothing_due: "nothing was due on it",
  // Early check 2, open question 4 (lead under delegation, 2026-11-02; 07-ZM S19 notes the change against 07-ZI): gateway-neutral, since Stripe's minimum is USD 0.50.
  below_gateway_minimum: "less than the smallest amount the gateway takes was due on it",
  target_not_whole_unit: "its balance isn't in whole rupees",
  client_domestic: "the client is in India",
  not_usd: "it isn't in US dollars",
  above_gateway_maximum: "even the smallest payment allowed is above the card payment limit",
  payment_pending: "a payment on it is still waiting to be confirmed",
  use_portal: "card payments are made by the client from the portal",
  changed: "it changed",
};
export const notPayableWords = (code: string | null | undefined): string =>
  (code && Object.hasOwn(NOT_PAYABLE_WORDS, code)
    ? NOT_PAYABLE_WORDS[code as keyof typeof NOT_PAYABLE_WORDS]
    : NOT_PAYABLE_WORDS.changed) as string;

/**
 * M6.2 review finding 4: the gateway advance's own blocker codes (`gateway/advance.ts`) in words, so the bell, the proforma banner, "Needs review" and the "Try
 * again" toast never show a code (builder's draft, 2026-11-01, approved by the lead under the standing delegation). Each fits S20's "…couldn't be issued
 * automatically: {words}." A test holds every code `advance.ts` can produce to this list. The invoice's own issue checks (`blockersOf`) keep their 07-R/07-S
 * lines on the screens; where those lines aren't at hand (the Worker's bell) they read as `ADVANCE_OTHER_CHECK`.
 */
export const ADVANCE_BLOCKER_WORDS = {
  request_invalid: "the payment doesn't say which proforma it is for",
  not_found: "the proforma can't be found",
  proforma_not_issued: "the proforma is no longer issued (it was voided or withdrawn)",
  client_anonymised: "the client's details were erased",
  not_domestic_inr: "the proforma is no longer in rupees for a client in India",
  advance_supply_changed: "the client's GST details changed after the proforma was issued",
  advance_exceeds_balance: "the payment is more than the proforma's balance",
  issuer_not_owner: "the owner who issued the proforma is no longer an active owner",
  advance_date_invalid: "the payment's date is before the proforma or after today",
  tax_errors: "the tax on the payment couldn't be worked out",
  freeze_refused: "the proforma changed while the tax invoice was being issued",
  // M6.3 S16 (lead under delegation, 07-ZM): a USD proforma paid by card waits for the Owner, who issues its tax invoice with the RBI or FBIL rate of the day the
  // money arrived (owner, 2026-11-01, Q1 A; Researched 2026-10-28, Rule 34 CGST Rules (08-C RA-21)).
  fx_rate_needed: "enter the exchange rate of the day the money arrived",
} as const;
export type AdvanceBlockerCode = keyof typeof ADVANCE_BLOCKER_WORDS;
/** An invoice issue check (Settings, the client's details) that failed, where its own line isn't at hand. */
export const ADVANCE_OTHER_CHECK = "a check on the tax invoice failed (open the proforma to see which)";

/** A gateway advance blocker in words, or null when it is one of the invoice's own issue checks. */
export const advanceBlockerWords = (code: string): string | null =>
  Object.hasOwn(ADVANCE_BLOCKER_WORDS, code) ? ADVANCE_BLOCKER_WORDS[code as AdvanceBlockerCode] : null;

/** The Worker's words for a blocked advance's codes (the bell): each gateway code in words, the invoice checks once as `ADVANCE_OTHER_CHECK`. */
export const advanceBlockersText = (codes: readonly string[]): string | null => {
  const words = [...new Set(codes.map((c) => advanceBlockerWords(c) ?? ADVANCE_OTHER_CHECK))];
  return words.length ? words.join("; ") : null;
};

/**
 * M6.2 fix round 4, low 3 (staff words, the lead under the standing delegation, 2026-11-01): a `refetch_failed` item for a link Razorpay marks paid while it lists
 * no payment (`facts.reason: "no_payment_listed"`): Razorpay was reached, so the line doesn't say it couldn't be. Also the "Try again" route's 409 while it still
 * lists none.
 */
export const NO_PAYMENT_LISTED_LINE =
  "Razorpay shows the link as paid but lists no payment yet. Try again in a few minutes.";

/**
 * M6.3 S19 (lead under delegation, early check 2, finding 2; 07-ZM): `not_export_receipt`, a USD card payment whose card was issued in India (or whose country
 * Stripe did not give) is not an inflow of foreign exchange, so it is never an export receipt under the LUT: the line says the tax consequence (Settled by the lead
 * on the safest reading, 2026-11-02 (08-C RA-38)).
 */
export const NOT_EXPORT_RECEIPT_LINE =
  "The card was issued in India, or Stripe didn't say where, so this payment doesn't count as money received from abroad and can't be treated as an export receipt under the LUT. Check with the client before confirming it or issuing a tax invoice for it.";
/** M6.3 S19 (approved by the lead, 2026-11-02): a `refetch_failed` item whose re-fetch Stripe refused for the key's permissions (`facts.reason: "stripe_permission"`). */
export const STRIPE_PERMISSION_LINE =
  "Stripe refused to show this payment to our key. Check the restricted key's permissions, then try again.";

/** One line per review kind (07-ZI S20; the five the designer drafts are drafted here in the same style). M6.3: the gateway's name and the currency by the item. */
export function reviewReason(kind: string, f: ReasonFacts = {}): string {
  const gw = gatewayName(f.provider);
  const m = (v: number | null | undefined) => money_(v, f.currency);
  switch (kind) {
    case "not_export_receipt":
      return NOT_EXPORT_RECEIPT_LINE;
    case "amount_mismatch":
      return `The amount paid (${m(f.paidMinor)}) doesn't match the link (${m(f.expectedMinor)}).`;
    case "unknown_link":
      return "A payment arrived for a link we don't know.";
    case "document_not_payable":
      return `The invoice could no longer be paid when the money arrived (${notPayableWords(f.reason)}). The money waits for your decision.`;
    case "advance_blocked":
      return `The tax invoice for this payment couldn't be issued automatically: ${f.blocker ?? "a check failed"}. Issue it from the proforma.`;
    case "refetch_failed":
      return f.reason === "no_payment_listed"
        ? NO_PAYMENT_LISTED_LINE
        : f.reason === "stripe_permission"
          ? STRIPE_PERMISSION_LINE
          : `${gw} couldn't be reached to confirm this payment. Try again.`;
    case "dead_letter":
      return `${gw} couldn't be reached to confirm this payment. Try again.`;
    // Settled by the lead on the safest reading, 2026-10-31 (08-C RA-36): credit held is treated as an advance (s.13(2) CGST Act), so GST on it was due in the
    // month the money arrived; the line says so (staff words, early check 2, finding 17; drafted for the lead).
    case "overpaid":
      return `The client paid ${m(f.extraMinor)} more than was due. It is held as credit, treated as an advance: GST on it is due for the month it arrived.`;
    case "proforma_overpaid":
      return "The client paid more than the proforma's balance. Issue the tax invoice by hand.";
    case "partial_payment":
      return `${gw} reports only part of the link as paid. Check the payment before confirming it.`;
    case "client_gone":
      return "A payment arrived for a client whose details were erased.";
    case "currency_mismatch":
      return "The payment's currency doesn't match the link.";
    case "reference_mismatch":
      return "The payment came through a link that doesn't match our record.";
    case "order_mismatch":
      return "The payment belongs to a different Razorpay order than the link.";
    case "payment_not_on_link":
      return `${gw} doesn't list this payment on the link.`;
    case "not_captured":
      // M6.3 (early check 1, F1): for Stripe also a charge refunded (in full or part) or disputed after it succeeded.
      return f.provider === "stripe"
        ? "Stripe reports this payment as not completed, refunded or disputed. Nothing was recorded."
        : "Razorpay reports this payment as failed or refunded. Nothing was recorded.";
    case "unreadable_event":
      return `A verified ${gw} notification couldn't be read. Check the payment in ${gw}'s dashboard.`;
    default:
      return "Check this payment.";
  }
}
