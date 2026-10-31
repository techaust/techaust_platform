// The words of the payment routes (M6.1; ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17, Q60). The error lines and bells of 07-ZH (APPROVED by the owner,
// 2026-10-31, lines 1–21) are word for word; a `{slot}` is filled here when the server has the value (the amount, the date, the client), as the M5 lines do.
// A code 07-ZH has no line for still says `[Placeholder]` (CLAUDE.md: a missing piece of copy is reported, never invented); the run file lists them as new
// lines from 22 for the owner. Nothing here is logged.
import { formatDate, parseIsoDate } from "@techaust/core/dates";
import { type Currency, formatMoney, money } from "@techaust/core/money";
import type { ApiError } from "./context.ts";

const e = (code: string, message: string): ApiError => ({ code, message });
/** A code 07-ZH has no line for: the code's meaning in plain words, marked until the owner approves a line (run file "Builder report (stage B2: API)"). */
const pending = (code: string, meaning: string): ApiError => e(code, `[Placeholder] ${meaning}`);

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
  "[Placeholder] A payment was put on this invoice. Correct it with a credit note.";

/** A bank reference `normaliseReference` refuses (early check A1): the words of M5.2's `advance_reference_invalid` (07-S, approved). */
export const REFERENCE_INVALID = e(
  "reference_invalid",
  "Enter the payment reference: letters, digits, / and -, up to 60 characters",
);

// ---- codes 07-ZH has no line for (marked) -----------------------------------------------------------------------------------------------------------------

export const ALREADY_RECORDED = pending("already_recorded", "This payment was already recorded.");
export const USE_PAYMENT_VERIFY = pending(
  "use_payment_verify",
  "A payment is checked from the Payments list, not from the approvals queue.",
);
export const PAYMENT_NOT_CONFIRMED = pending(
  "payment_not_confirmed",
  "Only a confirmed payment can be withdrawn.",
);
export const PAYMENT_ADVANCE_BACKED = pending(
  "payment_advance_backed",
  "This payment has a tax invoice for the payment received. Correct it with a credit note.",
);
export const RECEIVED_ON_FUTURE = pending("received_on_future", "The date received can't be in the future.");
export const CURRENCY_MISMATCH = pending("currency_mismatch", "This payment isn't in the client's currency.");
export const CLIENT_MISMATCH = pending("client_mismatch", "That invoice belongs to another client.");
export const NOT_PAYABLE = pending(
  "not_payable",
  "A payment can only go on an issued invoice or debit note.",
);
export const EXCEEDS_PAYMENT = pending(
  "exceeds_payment",
  "The amounts put on invoices add up to more than the payment.",
);
export const TDS_NOT_WHOLE = pending("tds_not_whole", "A TDS amount goes whole onto one invoice.");
export const TOO_MANY = pending("too_many", "A payment can go on at most 10 invoices.");
export const EXCEEDS_CREDIT = pending("exceeds_credit", "This is more than the client's credit.");
export const EXCEEDS_EXCESS = pending(
  "exceeds_excess",
  "This is more than was paid above what the invoice owes.",
);
export const REJECT_REASON_REQUIRED = pending("reason_required", "Say why it is rejected.");
export const NOT_TDS = pending("not_tds", "Only a TDS entry has a certificate.");
export const CERTIFICATE_ALREADY_SET = pending(
  "certificate_already_set",
  "The certificate is already recorded.",
);
export const PROOF_ALREADY_SET = pending("proof_already_set", "A proof is already attached to this payment.");
export const LETTER_ALREADY_SET = pending("letter_already_set", "The bank's letter is already attached.");
export const PAYMENT_CLOSED = pending("payment_closed", "This payment was rejected or withdrawn.");
export const NOT_AN_EXPORT_INVOICE = pending(
  "not_an_export_invoice",
  "Only an issued export invoice has a realisation date.",
);
export const EXTENSION_NOT_LATER = pending(
  "extension_not_later",
  "The new last date must be later than the current one.",
);
export const EXTENSION_TOO_FAR = pending("extension_too_far", "The new last date is too far ahead.");
export const PAYMENT_MISMATCH = pending(
  "payment_mismatch",
  "The amount or date doesn't match the payment being confirmed.",
);
/** Early check 2, finding 3: `proforma_ask_whole` (07-ZH from line 23, the designer's draft): a payment asked for a proforma goes whole onto that one proforma. */
export const PROFORMA_ASK_WHOLE = pending(
  "proforma_ask_whole",
  "A payment for a proforma goes whole onto that one proforma.",
);
export const LEDGER_CHANGED = pending(
  "ledger_changed",
  "The invoice's payments changed meanwhile. Reload it and try again.",
);
// Proof and letter files (L10): PDF, JPEG or PNG, at most 5 MB, sniffed as the file vault does.
export const PROOF_TOO_LARGE = pending("file_too_large", "The file is larger than 5 MB.");
export const PROOF_TYPE_NOT_ALLOWED = pending("file_type_not_allowed", "Attach a PDF, JPEG or PNG file.");

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
