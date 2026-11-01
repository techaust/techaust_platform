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
};

const money_ = (m: number | null | undefined) => (m == null ? "the amount" : formatMoney(money(m, "INR")));

/**
 * `document_not_payable`'s `{reason}` in words (designer's draft, 2026-11-01, for the lead): core `NOT_PAYABLE_REASONS` and the race fallback "changed". An
 * unknown code reads as "it changed", never as the code.
 */
export const NOT_PAYABLE_WORDS: Record<NotPayableReason | "changed", string> = {
  type_not_payable: "this kind of document isn't paid online",
  not_inr: "it isn't in rupees",
  client_overseas: "the client is outside India",
  client_anonymised: "the client's details were erased",
  not_issued: "it isn't issued",
  void: "it was voided",
  withdrawn: "it was withdrawn",
  nothing_due: "nothing was due on it",
  below_gateway_minimum: "less than ₹1 was due on it",
  target_not_whole_unit: "its balance isn't in whole rupees",
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

/** One line per review kind (07-ZI S20; the five the designer drafts are drafted here in the same style). */
export function reviewReason(kind: string, f: ReasonFacts = {}): string {
  switch (kind) {
    case "amount_mismatch":
      return `The amount paid (${money_(f.paidMinor)}) doesn't match the link (${money_(f.expectedMinor)}).`;
    case "unknown_link":
      return "A payment arrived for a link we don't know.";
    case "document_not_payable":
      return `The invoice could no longer be paid when the money arrived (${notPayableWords(f.reason)}). The money waits for your decision.`;
    case "advance_blocked":
      return `The tax invoice for this payment couldn't be issued automatically: ${f.blocker ?? "a check failed"}. Issue it from the proforma.`;
    case "refetch_failed":
    case "dead_letter":
      return "Razorpay couldn't be reached to confirm this payment. Try again.";
    // Settled by the lead on the safest reading, 2026-10-31 (08-C RA-36): credit held is treated as an advance (s.13(2) CGST Act), so GST on it was due in the
    // month the money arrived; the line says so (staff words, early check 2, finding 17; drafted for the lead).
    case "overpaid":
      return `The client paid ${money_(f.extraMinor)} more than was due. It is held as credit, treated as an advance: GST on it is due for the month it arrived.`;
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
      return "Razorpay reports this payment as failed or refunded. Nothing was recorded.";
    case "unreadable_event":
      return "A verified Razorpay notification couldn't be read. Check the payment in Razorpay's dashboard.";
    default:
      return "Check this payment.";
  }
}
