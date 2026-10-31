// The words of the payment routes (M6.1; ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17, Q60). The error lines and bells of 07-ZH (APPROVED by the owner,
// 2026-10-31, lines 1–21) are word for word; a `{slot}` is filled here when the server has the value (the amount, the date, the client), as the M5 lines do.
// Lines 23–25 (the codes without owner words) are staff-only and approved by the lead under the owner's delegation, 2026-10-31. Nothing here is logged.
import { formatDate, parseIsoDate } from "@techaust/core/dates";
import { type Currency, formatMoney, money } from "@techaust/core/money";
import type { ApiError } from "./context.ts";

const e = (code: string, message: string): ApiError => ({ code, message });

export const amountText = (amountMinor: number, currency: string): string =>
  formatMoney(money(amountMinor, currency as Currency));

const dayText = (iso: string): string => {
  const d = parseIsoDate(iso);
  return d ? formatDate(d) : iso;
};

// ---- 07-ZH line 13 (errors), line 12 (proforma), line 21 (void blocker) ---------------------------------------------------------------------------------

/** 07-ZH line 13: `allocation_exceeds_balance`, with what the invoice still owes. */
export const allocationExceedsBalance = (balanceMinor: number, currency: string): ApiError =>
  e(
    "allocation_exceeds_balance",
    `This is more than the invoice still owes (${amountText(balanceMinor, currency)}).`,
  );

/** 07-ZH line 13: `reference_seen`, with the day and the client of the payment that already has this bank reference (L12). */
export const referenceSeen = (receivedOn: string, clientName: string): ApiError =>
  e(
    "reference_seen",
    `This bank reference was already recorded on ${dayText(receivedOn)} for ${clientName}. Record it again only if it is a different payment.`,
  );

/** 07-ZH line 13. */
export const PAYMENT_NOT_PENDING = e("payment_not_pending", "This payment was already checked.");
/** 07-ZH line 13 (L8: only INR tax invoices and debit notes of clients in India). */
export const TDS_NOT_ALLOWED = e(
  "tds_not_allowed",
  "TDS applies only to rupee invoices for clients in India.",
);
/** 07-ZH line 12 (L5): a payment on a proforma is confirmed only through the advance batch. */
export const USE_ADVANCE_INVOICE = e(
  "use_advance_invoice",
  "A payment on a proforma is confirmed by issuing the tax invoice for the payment received.",
);
/** 07-ZH line 21: the void blocker `payment_pending` (the screens show it by the code; the API names it for the reasons list). */
export const VOID_PAYMENT_PENDING_LINE =
  "A payment recorded on it is waiting for the owner's check. Reject it first.";

/** L32: the void blocker `payment_recorded` (a payment was put on it, one released or withdrawn since included). 07-ZH from line 23 (the designer's draft). */
export const VOID_PAYMENT_RECORDED_LINE =
  "A payment was put on this invoice, so it can't be voided. Use a credit note instead.";

/** A bank reference `normaliseReference` refuses (early check A1): the words of M5.2's `advance_reference_invalid` (07-S, approved). */
export const REFERENCE_INVALID = e(
  "reference_invalid",
  "Enter the payment reference: letters, digits, / and -, up to 60 characters",
);

// ---- 07-ZH lines 23–24 (lead, owner's delegation) -----------------------------------------------------------------------------------------------------------------

export const ALREADY_RECORDED = e("already_recorded", "This payment is already recorded.");
export const USE_PAYMENT_VERIFY = e("use_payment_verify", "Check this payment from Payments, not from Approvals.");
export const PAYMENT_NOT_CONFIRMED = e("payment_not_confirmed", "Only a confirmed payment can be withdrawn.");
export const PAYMENT_ADVANCE_BACKED = e("payment_advance_backed", "A tax invoice was issued for this payment, so it can't be withdrawn. Correct it with a credit note.");
export const RECEIVED_ON_FUTURE = e("received_on_future", "The date received can't be after today.");
export const CURRENCY_MISMATCH = e("currency_mismatch", "A payment must be in the client's currency.");
export const CLIENT_MISMATCH = e("client_mismatch", "That invoice belongs to another client.");
export const NOT_PAYABLE = e("not_payable", "A payment can go only on an issued invoice or debit note.");
export const EXCEEDS_PAYMENT = e("exceeds_payment", "The amounts put on invoices add up to more than the payment.");
export const TDS_NOT_WHOLE = e("tds_not_whole", "A TDS amount goes on one invoice, in full.");
export const TOO_MANY = e("too_many", "A payment can go on at most 10 invoices.");
export const EXCEEDS_CREDIT = e("exceeds_credit", "This is more than the client's credit.");
export const EXCEEDS_EXCESS = e("exceeds_excess", "This is more than was paid above what the invoice owes.");
export const REJECT_REASON_REQUIRED = e("reason_required", "Say why it is rejected.");
export const NOT_TDS = e("not_tds", "Only a TDS entry has a certificate.");
export const CERTIFICATE_ALREADY_SET = e("certificate_already_set", "The certificate is already recorded.");
export const PROOF_ALREADY_SET = e("proof_already_set", "A proof is already attached to this payment.");
export const LETTER_ALREADY_SET = e("letter_already_set", "The bank's letter is already attached.");
export const PAYMENT_CLOSED = e("payment_closed", "This payment was rejected or withdrawn, so it can't change.");
export const NOT_AN_EXPORT_INVOICE = e("not_an_export_invoice", "Only an issued export invoice has a realisation date.");
/** 07-ZH line 24, with the current FEMA date. */
export const extensionNotLater = (femaDue: string): ApiError =>
  e("extension_not_later", `The new last date must be after ${dayText(femaDue)}.`);
/** 07-ZH line 24, with the latest allowed date. */
export const extensionTooFar = (latest: string): ApiError =>
  e("extension_too_far", `The new last date can't be after ${dayText(latest)}.`);
export const PAYMENT_MISMATCH = e("payment_mismatch", "The amount or date doesn't match the payment being confirmed.");
/** Early check 2, finding 3: `proforma_ask_whole` (07-ZH from line 23, the designer's draft): a payment asked for a proforma goes whole onto that one proforma. */
export const PROFORMA_ASK_WHOLE = e("proforma_ask_whole", "A payment for a proforma goes on that proforma alone, in full.");
export const LEDGER_CHANGED = e("ledger_changed", "The invoice's payments changed in the meantime. Reload and try again.");
// Proof and letter files (L10): PDF, JPEG or PNG, at most 5 MB, sniffed as the file vault does.
export const PROOF_TOO_LARGE = e("file_too_large", "The file is larger than 5 MB.");
export const PROOF_TYPE_NOT_ALLOWED = e("file_type_not_allowed", "Attach a PDF, JPEG or PNG file.");

// ---- bells (07-ZH lines 5 and 6) ------------------------------------------------------------------------------------------------------------------------

/** 07-ZH line 5, the Owner's bell for a Staff entry. */
export const bellRecorded = (name: string, amountMinor: number, currency: string, client: string): string =>
  `${name} recorded a payment of ${amountText(amountMinor, currency)} from ${client}. Check it.`;

/** 07-ZH line 6, the requester's bell after the Owner's decision. */
export const bellDecided = (
  decision: "confirmed" | "rejected",
  amountMinor: number,
  currency: string,
  client: string,
  reason: string,
): string =>
  decision === "confirmed"
    ? `Your payment of ${amountText(amountMinor, currency)} from ${client} was confirmed.`
    : `Your payment of ${amountText(amountMinor, currency)} from ${client} was rejected: ${reason.replace(/[.!?]+$/, "")}.`;

/** Where a payment bell opens (the designer's `/payments` screen; the id selects the row). */
export const paymentLink = (id: string): string => `/payments/${id}`;
