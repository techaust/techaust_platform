// The words and the pure rules of the M6.1 payment screens (ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17, ADM-APR-01, Q60): the invoice's Payments panel,
// the Record a payment dialog and its TDS variant, the /payments list with the Owner's check, a client's credit, the FEMA extensions, the dashboard tiles and the
// payments and TDS register.
//
// Copy: 07-ZH (docs/07-content-appendix/ZH-m6.1-payments.md). Lines 1–21 are APPROVED by the owner (2026-10-31) and line 22 by the lead, and are used word for
// word. Lines 23 onwards are the designer's recommended words for what 07-ZH lacked (the API codes without words, the audit labels, the screens' own labels,
// empty states and dialogs); each one shows the "[Placeholder]" mark until it is approved, then `APPROVED_07ZH_NEW` turns true and the marks go (the
// 07-X, 07-Y and 07-Z pattern). A 07-S, 07-R or 07-V line that already says the thing is reused and says where it comes from.
// Money is formatted and added only through core; nothing here adds up an amount by hand. Pure, so the words and rules are tested without a browser.
import { LEDGER_STATUSES, PAYABLE_TYPES, receiptMonthWarning, TDS_TYPES } from "@techaust/core/ledger";
import { type Currency, compare, formatMoney, money, subtract, sum } from "@techaust/core/money";
import type { PaymentMode, PaymentStatus } from "../api.ts";
import { RequestError } from "../api.ts";
import type { PillTone } from "../components/display.tsx";
import { ZH } from "./copy-zh.ts";
import { dayText, docErrorText } from "./documents.ts";
import { bpToPercent, moneyFrom } from "./settings-form.ts";

export { APPROVED_07ZH_NEW, PAY_AUDIT, PLACEHOLDER_MARK, ZH } from "./copy-zh.ts";

export const amountText = (minor: number, currency: Currency) => formatMoney(money(minor, currency));
const day = (iso: string | null | undefined) => (iso ? (dayText(iso) ?? iso) : "");

// ---- 07-ZH lines 1–22 (approved) ------------------------------------------------------------------------------------------------------------------------

export const PAY_COPY = {
  // line 1
  heading: "Payments",
  paid: "Paid",
  tds: "TDS deducted by the client",
  credited: "Credited",
  balance: "Balance",
  excess: "Paid above what it owes",
  // line 2
  recordTitle: "Record a payment",
  amount: "Amount the client paid",
  dateReceived: "Date received",
  mode: "How it was paid",
  reference: "Bank reference (UTR)",
  charges: "Bank charges (we absorb them)",
  proof: "Proof",
  proofKind: "Proof type",
  proofKindHint: "FIRA, FIRC, e-BRC or bank advice",
  proofRef: "Proof reference",
  note: "Note",
  // line 3
  staffNotice: "The owner checks this payment before it counts toward the balance.",
  // line 4
  toCheck: "Payments to check",
  confirm: "Confirm",
  reject: "Reject",
  rejectReason: "Why it is rejected",
  // line 7
  tdsHeading: "Tax deducted at source (TDS)",
  tdsSection: "Section the client used",
  tdsRate: "Rate the client used (%)",
  tdsAmount: "TDS amount on the certificate",
  tdsCertificate: "Certificate number (Form 16A)",
  tdsHint:
    "The invoice and its GST stay at full value. Enter the section, rate and amount exactly as the client's certificate shows them.",
  // line 8
  certificateAwaited: "Certificate awaited",
  // line 10 (the label is the line's words before its amount)
  creditHeld: "Credit held",
  useCredit: "Use credit on this invoice",
  // line 12
  proformaLine: "A payment on a proforma is confirmed by issuing the tax invoice for the payment received.",
  // line 14
  extend: "Bank extended the date",
  newLastDate: "New last date",
  bankRef: "Bank's reference",
  bankLetter: "Bank's letter",
  extendHint: "Only your bank can extend this date.",
  // line 15
  exportProofHint: "Add the bank's FIRA or FIRC when it arrives.",
  // line 16
  collectedMonth: "Collected this month",
  // line 17
  collected: "Collected",
  projectPaid: "Paid",
  // line 20
  register: "Payments and TDS register",
} as const;

/** Line 2's options, by the API's value. */
export const MODE_LABELS: Record<PaymentMode, string> = {
  neft: "NEFT",
  rtgs: "RTGS",
  imps: "IMPS",
  upi: "UPI",
  swift: "SWIFT",
  // M6.2: how a Razorpay payment was made (core `methodToMode`; staff words drafted by the designer for the lead, 2026-11-01). Never offered when recording.
  card: "Card",
  netbanking: "Netbanking",
  wallet: "Wallet",
  emi: "EMI",
  paylater: "Pay later",
  other: "Other",
};
export const MODES: readonly PaymentMode[] = ["neft", "rtgs", "imps", "upi", "swift"];

/** Line 21, the void blocker `payment_pending`. */
export const VOID_PAYMENT_PENDING =
  "A payment recorded on it is waiting for the owner's check. Reject it first.";
/**
 * M6.2 (fix round 3 item 3; the lead under the standing delegation, 2026-11-01): the void and withdraw blocker `payment_pending_gateway`, a pending Razorpay
 * payment (it can't be rejected). The Worker's `VOID_GATEWAY_PENDING_LINE` is the same words (a test pins the two).
 */
export const VOID_GATEWAY_PENDING =
  'A Razorpay payment on it is waiting for its tax invoice. Issue it with "Confirm by issuing the tax invoice", or resolve it in Needs review.';

/** Line 9, the overpayment line. */
export const overpaymentLine = (amount: string, client: string) =>
  `${amount} is more than this invoice owes. It is kept as ${client}'s credit.`;
/** Line 47 (visual review finding 2): what is left of a payment deliberately split short of what the listed invoices owe (line 9 is a real overpayment). */
export const keptAsCreditLine = (amount: string, client: string) =>
  ZH(`${amount} is kept as ${client}'s credit.`);
/** 07-M's line for a truncated list (approved; dashboard.ts says it too), when the open documents' read stops at its cap (re-check finding 5). */
export const showingFirstLine = (n: number) => `Showing the first ${n}.`;
/** Line 10. */
export const creditHeldLine = (amount: string) => `Credit held: ${amount}`;
/** Line 10's warning (RA-17, L13): `month` is "YYYY-MM", said as "October 2026". */
export const earlierMonthLine = (month: string) =>
  `This money arrived in ${monthText(month)}. GST on it was due in that month's return; if that return is filed, add it to the next one with interest.`;
/** Line 11. */
export const moveExcessLine = (amount: string) =>
  `Move ${amount} paid above what this invoice owes to the client's credit.`;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** "2026-10" → "October 2026"; anything else as it came. */
export function monthText(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : month;
}

// ---- 07-ZH lines 23 onwards (the designer's words, marked until approved) ------------------------------------------------------------------------------

/** Line 23: the API codes 07-ZH had no words for (the builder's list of 26, and the second early check's `proforma_ask_whole`), by code. */
export const PAY_ERRORS = {
  already_recorded: ZH("This payment is already recorded."),
  use_payment_verify: ZH("Check this payment from Payments, not from Approvals."),
  received_on_future: ZH("The date received can't be after today."),
  currency_mismatch: ZH("A payment must be in the client's currency."),
  client_mismatch: ZH("That invoice belongs to another client."),
  not_payable: ZH("A payment can go only on an issued invoice or debit note."),
  exceeds_payment: ZH("The amounts put on invoices add up to more than the payment."),
  tds_not_whole: ZH("A TDS amount goes on one invoice, in full."),
  too_many: ZH("A payment can go on at most 10 invoices."),
  reason_required: ZH("Say why it is rejected."),
  payment_mismatch: ZH("The amount or date doesn't match the payment being confirmed."),
  ledger_changed: ZH("The invoice's payments changed in the meantime. Reload and try again."),
  payment_not_confirmed: ZH("Only a confirmed payment can be withdrawn."),
  payment_advance_backed: ZH(
    "A tax invoice was issued for this payment, so it can't be withdrawn. Correct it with a credit note.",
  ),
  exceeds_credit: ZH("This is more than the client's credit."),
  exceeds_excess: ZH("This is more than was paid above what the invoice owes."),
  not_tds: ZH("Only a TDS entry has a certificate."),
  certificate_already_set: ZH("The certificate is already recorded."),
  proof_already_set: ZH("A proof is already attached to this payment."),
  payment_closed: ZH("This payment was rejected or withdrawn, so it can't change."),
  file_too_large: ZH("The file is larger than 5 MB."),
  file_type_not_allowed: ZH("Attach a PDF, JPEG or PNG file."),
  letter_already_set: ZH("The bank's letter is already attached."),
  not_an_export_invoice: ZH("Only an issued export invoice has a realisation date."),
  // second early check: a Staff request naming a proforma puts the whole payment on that one proforma (L5)
  proforma_ask_whole: ZH("A payment for a proforma goes on that proforma alone, in full."),
} as const;

/** Line 25 (second early check): the void blocker `payment_recorded`, a payment put on this invoice, even one withdrawn later (line 21 is `payment_pending`). */
export const VOID_PAYMENT_RECORDED = ZH(
  "A payment was put on this invoice, so it can't be voided. Use a credit note instead.",
);

/** Line 24: `extension_not_later`, with the current FEMA date. */
export const extensionNotLater = (date: string) => ZH(`The new last date must be after ${date}.`);
/** Line 24: `extension_too_far`, with the latest date allowed. */
export const extensionTooFar = (date: string) => ZH(`The new last date can't be after ${date}.`);

/** Line 27: the status chip of an entry (docs/06 §5.5: pending verification is Warning with its own icon; never colour alone). */
export const STATUS_LABELS: Record<PaymentStatus, string> = {
  pending_verification: ZH("Waiting for the owner's check"),
  confirmed: ZH("Confirmed"),
  rejected: ZH("Rejected"),
  withdrawn: ZH("Withdrawn"),
};
export const STATUS_PILLS: Record<
  PaymentStatus,
  { tone: PillTone; icon: "clock" | "check" | "xCircle" | "undo"; outline?: boolean }
> = {
  pending_verification: { tone: "warning", icon: "clock" },
  confirmed: { tone: "success", icon: "check" },
  rejected: { tone: "muted", icon: "xCircle" },
  withdrawn: { tone: "muted", icon: "undo" },
};

/** Lines 28–45: the screens' own labels, empty states, dialogs and toasts. */
export const PAY_UI = {
  // 28 entries and columns
  kindPayment: ZH("Payment"),
  kindTds: ZH("TDS"),
  // 29 the panel
  recordTds: ZH("Record TDS"),
  moveExcess: ZH("Move excess to credit"),
  // 28
  colAmount: "Amount",
  colClient: "Client",
  colStatus: ZH("Status"),
  colKind: ZH("Entry"),
  // 29
  noneOnInvoice: ZH("No payments recorded on this invoice yet."),
  // 30 proof
  openProof: ZH("Open proof"),
  noProof: ZH("None yet"),
  attachProof: ZH("Attach proof"),
  proofFileHint: ZH("PDF, JPEG or PNG, up to 5 MB."),
  proofKindMissing: ZH("Enter the proof type."),
  // 31 allocation table ("Invoice" and "Amount" are 07-V §4's column words)
  allocHeading: ZH("Put it on these invoices"),
  allocAmount: ZH("Amount on this invoice"),
  allocHint: ZH("Leave a row empty to skip that invoice."),
  allocNone: ZH("This client has no open invoices. The whole amount is kept as the client's credit."),
  allocMore: ZH("This is more than the invoice still owes."),
  allocInvoice: "Invoice",
  // 32 TDS
  certificateOn: ZH("Certificate date"),
  certificateBoth: ZH("Enter the certificate number and its date together, or leave both empty."),
  tdsSectionMissing: ZH("Enter the section the client used."),
  tdsRateInvalid: ZH("Enter the rate as a percentage, for example 10 or 7.5."),
  tdsInvoiceMissing: ZH("Pick the invoice the TDS is for."),
  tdsInvoiceHint: ZH("Rupee tax invoices and debit notes only."),
  addCertificate: ZH("Add certificate"),
  certificateTitle: ZH("Add the TDS certificate"),
  // 33 USD
  inrReceived: ZH("Amount credited in INR (bank advice)"),
  // 34 record from Payments
  pickClient: "Client",
  pickClientMissing: ZH("Pick the client who paid."),
  // 35 toasts
  recordedConfirmed: ZH("Payment recorded and confirmed."),
  recordedPending: ZH("Payment recorded. The owner checks it next."),
  tdsRecorded: ZH("TDS recorded."),
  confirmed: ZH("Payment confirmed."),
  rejected: ZH("Payment rejected."),
  withdrawn: ZH("Payment withdrawn."),
  creditUsed: ZH("Credit used on this invoice."),
  excessMoved: ZH("Moved to the client's credit."),
  extensionSaved: ZH("Extension recorded."),
  certificateSaved: ZH("Certificate recorded."),
  proofSaved: ZH("Proof attached."),
  // 36 list
  allPayments: ZH("All payments"),
  noneToCheck: ZH("No payments waiting for your check."),
  noneYet: ZH("No payments recorded yet."),
  noneMatch: ZH("No payments match these filters."),
  from: ZH("Received from"),
  to: ZH("Received to"),
  showMore: ZH("Show more payments"),
  // 37 check dialogs
  confirmTitle: ZH("Confirm this payment"),
  confirmBody: ZH(
    "It counts toward the balance of the invoices below as soon as you confirm. You can change the amounts first.",
  ),
  rejectTitle: ZH("Reject this payment"),
  rejectBody: ZH("Nothing is put on any invoice. The person who recorded it is told why."),
  // 38 withdraw
  withdraw: ZH("Withdraw"),
  withdrawTitle: ZH("Withdraw this payment"),
  withdrawBody: ZH(
    "Withdraw only an entry made in error. The invoices it was put on owe that amount again, and the entry stays in the list as withdrawn.",
  ),
  withdrawReason: ZH("Why it is withdrawn"),
  withdrawReasonMissing: ZH("Say why it is withdrawn."),
  // 39 an entry
  detailTitle: ZH("Payment"),
  recordedBy: ZH("Recorded by"),
  checkedBy: ZH("Checked by"),
  rejectedWhy: ZH("Why it was rejected"),
  withdrawnWhy: ZH("Why it was withdrawn"),
  putOn: ZH("Put on"),
  askedFor: ZH("Asked for"),
  movedToCredit: ZH("Moved to credit"),
  close: ZH("Close"),
  // 40 credit
  amountToUse: ZH("Amount to use"),
  amountToMove: ZH("Amount to move"),
  fromPayment: (date: string) => ZH(`From the payment received on ${date}`),
  creditInvoiceMissing: ZH("Pick the invoice the credit goes on."),
  // 41 export realisation
  femaDate: ZH("FEMA date"),
  gstDate: ZH("GST date"),
  extensions: ZH("Extensions by the bank"),
  extensionRow: (date: string, ref: string) => ZH(`Extended to ${date}, bank's reference ${ref}`),
  noLetter: ZH("Letter not attached"),
  newDateMissing: ZH("Enter the new last date."),
  bankRefMissing: ZH("Enter the bank's reference."),
  // 42 proforma
  confirmByIssuing: ZH("Confirm by issuing the tax invoice"),
  // 43 dashboard
  paymentsCount: (n: number) => ZH(n === 1 ? "1 payment" : `${n} payments`),
  noneCollected: ZH("Nothing collected this month."),
  nothingToCheck: ZH("Nothing to check."),
  openToCheck: ZH("Open payments to check"),
  // 44 register
  registerLede: ZH(
    "Every confirmed payment and TDS entry received in the financial year, for your books and for matching TDS with Form 26AS and AIS.",
  ),
  fy: ZH("Financial year"),
  read: ZH("Show"),
  registerDone: (n: number) => ZH(n === 1 ? "1 entry read." : `${n} entries read.`),
  registerEmpty: ZH("No confirmed payments in this financial year."),
  download: ZH("Download the register (CSV)"),
  awaitingHeading: ZH("TDS waiting for a certificate"),
  awaitingNone: ZH("Every TDS entry has its certificate."),
  // 45 realisation report note (replaces 07-V §5's note that pointed to "the payments update")
  extensionNote: ZH(
    "If your bank extended a date, record it on the export invoice's page: Bank extended the date.",
  ),
  // 34
  modeMissing: ZH("Pick how it was paid."),
  // 34 the submit button once a seen reference was explained (line 13)
  recordAgain: ZH("Record it again"),
  // 34 the client search on Payments
  searchClients: ZH("Search clients"),
  // 48 (visual review finding 9) an extension saved without the bank's letter: the action, its dialog's title and button, and its toast
  attachLetter: ZH("Attach the bank's letter"),
  letterSaved: ZH("Letter attached."),
  // 50 (re-check finding 2) the letter dialog without a file chosen
  letterMissing: ZH("Choose the bank's letter."),
  // 49 (visual review finding 10) the client Overview's button and dialog, where no invoice is in context yet (line 10's words stay on an invoice)
  useCreditShort: ZH("Use credit"),
} as const;

/** Line 44: the register's CSV header (one file; TDS rows carry their certificate columns, for Form 26AS and AIS matching). */
export const REGISTER_COLUMNS = [
  "Date received",
  "Entry",
  "Client code",
  "Client",
  "Currency",
  "Amount",
  "Bank charges",
  "Amount credited in INR",
  "How it was paid",
  "Bank reference",
  "TDS section",
  "TDS rate (%)",
  "Certificate number",
  "Certificate date",
  "Proof type",
  "Proof reference",
  "Put on",
] as const;

// ---- errors ---------------------------------------------------------------------------------------------------------------------------------------------

/** The approved 07-ZH codes come from the server word for word (with its amounts and dates); the rest by code here; anything else as the documents do. */
const APPROVED_CODES = new Set([
  "allocation_exceeds_balance",
  "reference_seen",
  "payment_not_pending",
  "tds_not_allowed",
  "use_advance_invoice",
  "reference_invalid",
  "payments_pending",
]);

const sentenceOf = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

export function payErrorText(e: unknown): string {
  if (e instanceof RequestError) {
    if (APPROVED_CODES.has(e.code)) return sentenceOf(e.message);
    const d = e.extra.details ?? {};
    if (e.code === "extension_not_later" && typeof d.femaDue === "string")
      return extensionNotLater(day(d.femaDue));
    if (e.code === "extension_too_far" && typeof d.latest === "string") return extensionTooFar(day(d.latest));
    if (Object.hasOwn(PAY_ERRORS, e.code)) return (PAY_ERRORS as Record<string, string>)[e.code] as string;
    if (e.code === "step_up_cancelled" || e.code === "invalid_code") return e.message;
  }
  return docErrorText(e);
}

// ---- the record form ------------------------------------------------------------------------------------------------------------------------------------

/** An open document the payment can go on (the allocation table's row). */
export type OpenDoc = {
  id: string;
  number: string | null;
  type: string;
  currency: Currency;
  balanceMinor: number;
  dueDate: string | null;
  /** The issue day, for line 10's warning before a submit (RA-17); absent when the screen doesn't know it. */
  issueDate?: string | null;
};

export type AllocRow = { documentId: string; text: string };

/**
 * What the allocation table reads: each row's amount, or an error for the row; and what is left of the payment (core money, never by hand).
 * Re-check finding 1: a row with an amount is never skipped. A row whose document isn't listed is the row's error: `refused` gives the reason the screen found
 * (the Confirm step's asked-for document that can't take the payment), else line 23's `not_payable`. Only an empty or zero row is left out.
 */
export function readAllocations(
  rows: readonly AllocRow[],
  docs: readonly OpenDoc[],
  amountMinor: number | null,
  currency: Currency,
  refused: Readonly<Record<string, string>> = {},
):
  | {
      ok: true;
      allocations: { documentId: string; amountMinor: number }[];
      leftMinor: number | null;
      over: boolean;
    }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const allocations: { documentId: string; amountMinor: number }[] = [];
  for (const r of rows) {
    if (r.text.trim() === "") continue;
    const d = docs.find((x) => x.id === r.documentId);
    const m = moneyFrom(r.text, currency);
    if (!m.ok) errors[r.documentId] = m.error;
    else if (m.minor === 0) continue;
    else if (!d) errors[r.documentId] = refused[r.documentId] ?? PAY_ERRORS.not_payable;
    else if (compare(money(m.minor, currency), money(d.balanceMinor, currency)) > 0)
      errors[r.documentId] = PAY_UI.allocMore;
    else allocations.push({ documentId: r.documentId, amountMinor: m.minor });
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (amountMinor === null) return { ok: true, allocations, leftMinor: null, over: false };
  const put = sum(
    allocations.map((a) => money(a.amountMinor, currency)),
    currency,
  );
  const left = subtract(money(amountMinor, currency), put);
  return { ok: true, allocations, leftMinor: left.amount, over: left.amount < 0 };
}

/** The refused rows that still hold an amount: while any does, Confirm stays disabled (re-check finding 1; the Owner clears the row to remove it, line 31). */
export function blockingRefusals(rows: readonly AllocRow[], refused: readonly { id: string }[]): string[] {
  return refused
    .filter((x) => (rows.find((r) => r.documentId === x.id)?.text.trim() ?? "") !== "")
    .map((x) => x.id);
}

/**
 * The line under the allocation table for what is left of the payment (visual review finding 2): line 9 only when the payment is more than every listed
 * invoice owes together (a real overpayment); a deliberate split short of that reads line 47. Nothing when nothing is left, or when no invoice is listed (line
 * 31's empty line already says the whole amount is kept). Core money only.
 */
export function leftoverLine(
  leftMinor: number | null,
  amountMinor: number | null,
  docs: readonly OpenDoc[],
  currency: Currency,
  client: string,
): { kind: "over" | "kept"; text: string } | null {
  if (leftMinor === null || leftMinor <= 0 || amountMinor === null || docs.length === 0) return null;
  const owed = sum(
    docs.filter((d) => d.currency === currency).map((d) => money(d.balanceMinor, currency)),
    currency,
  );
  const amount = amountText(leftMinor, currency);
  return compare(money(amountMinor, currency), owed) > 0
    ? { kind: "over", text: overpaymentLine(amount, client) }
    : { kind: "kept", text: keptAsCreditLine(amount, client) };
}

/**
 * Line 10's warning before a submit (visual review finding 6; RA-17, L13): the month the money arrived when it is earlier than the month of any invoice it
 * goes on, by core's rule (the server answers the same warning after the write); null otherwise. `receivedOn` and the issue days are ISO IST days.
 */
export function earlierMonthOf(
  receivedOn: string | null | undefined,
  issueDates: readonly (string | null | undefined)[],
): string | null {
  if (!receivedOn || !/^\d{4}-\d{2}/.test(receivedOn)) return null;
  return issueDates.some((d) => typeof d === "string" && receiptMonthWarning(receivedOn, d) !== null)
    ? receivedOn.slice(0, 7)
    : null;
}

/** The amount the row of the invoice the dialog was opened from follows (until edited): the payment, at most that invoice's balance. */
export function autoFill(amountMinor: number | null, balanceMinor: number, currency: Currency): string {
  if (amountMinor === null || amountMinor <= 0) return "";
  const a = money(amountMinor, currency);
  const b = money(balanceMinor, currency);
  const take = compare(a, b) > 0 ? b : a;
  return plainAmount(take.amount, currency);
}

/** Minor units as the text a person types back ("12500.00"), through core. */
export function plainAmount(minor: number, currency: Currency): string {
  return formatMoney(money(minor, currency), { symbol: false }).replaceAll(",", "");
}

/** Today in IST as an ISO date. */
export const todayIst = (now = Date.now()) => new Date(now + 19_800_000).toISOString().slice(0, 10);

/** The open documents a payment (or a TDS entry) can go on, from the client's invoice list rows: issued, a balance left, never a credit note; a proforma only
 * for a pending entry (Staff), never for TDS (L5, L8). */
export function openDocsOf(
  rows: readonly {
    id: string;
    type: string;
    status: string;
    number: string | null;
    currency: Currency;
    balanceMinor: number;
    dueDate: string | null;
    issueDate?: string | null;
  }[],
  opts: { kind: "payment" | "tds"; proformas: boolean },
): OpenDoc[] {
  const types: readonly string[] =
    opts.kind === "tds" ? TDS_TYPES : [...PAYABLE_TYPES, ...(opts.proformas ? ["proforma"] : [])];
  const seen = new Set<string>();
  const docs = rows
    .filter(
      (r) =>
        types.includes(r.type) &&
        r.number !== null &&
        r.status !== "draft" &&
        r.status !== "void" &&
        r.balanceMinor > 0 &&
        (opts.kind !== "tds" || r.currency === "INR"),
    )
    .filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .map((r) => ({
      id: r.id,
      number: r.number,
      type: r.type,
      currency: r.currency,
      balanceMinor: r.balanceMinor,
      dueDate: r.dueDate,
      issueDate: r.issueDate ?? null,
    }));
  return byDueDate(docs);
}

/** Due-date order (re-check finding 7): the earliest due first, then the ones without a due date; ties keep their order (stable sort). */
export function byDueDate<T extends Pick<OpenDoc, "dueDate">>(docs: readonly T[]): T[] {
  return [...docs].sort((a, b) =>
    a.dueDate === b.dueDate
      ? 0
      : a.dueDate === null
        ? 1
        : b.dueDate === null
          ? -1
          : a.dueDate < b.dueDate
            ? -1
            : 1,
  );
}

/**
 * A document Staff asked for, read by id because the open lists didn't return it (re-check finding 1): a row when it can still take this payment (issued,
 * a type a payment goes on, this client and currency, a balance left), else the reason it can't, in line 23's and line 31's words.
 */
export function askedDocOf(
  v: {
    id: string;
    type: string;
    status: string;
    number: string | null;
    currency: Currency;
    balanceMinor: number;
    dueDate: string | null;
    issueDate: string | null;
    client: { id: string };
  },
  payment: { clientId: string; currency: Currency },
): { ok: true; doc: OpenDoc } | { ok: false; error: string } {
  if (
    v.number === null ||
    !(PAYABLE_TYPES as readonly string[]).includes(v.type) ||
    !(LEDGER_STATUSES as readonly string[]).includes(v.status)
  )
    return { ok: false, error: PAY_ERRORS.not_payable };
  if (v.client.id !== payment.clientId) return { ok: false, error: PAY_ERRORS.client_mismatch };
  if (v.currency !== payment.currency) return { ok: false, error: PAY_ERRORS.currency_mismatch };
  if (v.balanceMinor <= 0) return { ok: false, error: PAY_UI.allocMore };
  return {
    ok: true,
    doc: {
      id: v.id,
      number: v.number,
      type: v.type,
      currency: v.currency,
      balanceMinor: v.balanceMinor,
      dueDate: v.dueDate,
      issueDate: v.issueDate,
    },
  };
}

// ---- the register CSV -----------------------------------------------------------------------------------------------------------------------------------

/** One CSV cell: quoted when needed; a leading = + - @ is defused (spreadsheet formulas), as the audit CSV does. */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const decimal = (minor: number, currency: Currency) => plainAmount(minor, currency);
const rateText = (bp: number | null) => (bp === null ? "" : bpToPercent(bp));

export type RegisterRowIn = {
  kind: "payment" | "tds";
  receivedOn: string;
  currency: Currency;
  amountMinor: number;
  chargesMinor: number;
  mode: PaymentMode | null;
  reference: string | null;
  inrReceivedMinor: number | null;
  tds: {
    section: string | null;
    rateBp: number | null;
    certificateNo: string | null;
    certificateOn: string | null;
  } | null;
  proof: { kind: string; ref: string | null } | null;
  client: { code: string; name: string };
  allocations: { documentId?: string; number: string | null; kind: string; amountMinor: number }[];
};

/**
 * The "Put on" cell (code review finding 2): what the entry holds on each document now, Σ allocate − Σ release per document, in the order the documents first
 * appear; a document it no longer holds anything on (all released) is left out.
 */
export function putOnText(r: Pick<RegisterRowIn, "allocations" | "currency">): string {
  const held = new Map<string, { number: string | null; minor: number }>();
  for (const a of r.allocations) {
    const key = a.documentId ?? a.number ?? "";
    const was = held.get(key) ?? { number: a.number, minor: 0 };
    held.set(key, {
      number: was.number ?? a.number,
      minor: was.minor + (a.kind === "release" ? -a.amountMinor : a.amountMinor),
    });
  }
  return [...held.values()]
    .filter((h) => h.minor !== 0)
    .map((h) => `${h.number ?? ""} ${decimal(h.minor, r.currency)}`.trim())
    .join("; ");
}

/** The payments and TDS register as CSV text: money rows first, then the TDS rows apart (for Form 26AS and AIS matching), each by date received. */
export function registerCsv(rows: readonly RegisterRowIn[]): string {
  const ordered = [...rows.filter((r) => r.kind === "payment"), ...rows.filter((r) => r.kind === "tds")];
  const lines = ordered.map((r) =>
    [
      r.receivedOn,
      r.kind === "tds" ? "TDS" : "Payment",
      r.client.code,
      r.client.name,
      r.currency,
      decimal(r.amountMinor, r.currency),
      r.chargesMinor > 0 ? decimal(r.chargesMinor, r.currency) : "",
      r.inrReceivedMinor !== null ? decimal(r.inrReceivedMinor, "INR") : "",
      r.mode ? MODE_LABELS[r.mode] : "",
      r.reference ?? "",
      r.tds?.section ?? "",
      rateText(r.tds?.rateBp ?? null),
      r.tds?.certificateNo ?? "",
      r.tds?.certificateOn ?? "",
      r.proof?.kind ?? "",
      r.proof?.ref ?? "",
      putOnText(r),
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[REGISTER_COLUMNS.join(","), ...lines].join("\r\n")}\r\n`;
}

/** The FY tokens a register can be read for: this FY and the four before it, newest first ("2627" → "2026-27"). */
export function fyChoices(now = Date.now()): { token: string; label: string }[] {
  const t = todayIst(now);
  const y = Number(t.slice(0, 4));
  const start = Number(t.slice(5, 7)) >= 4 ? y : y - 1;
  return Array.from({ length: 5 }, (_, i) => {
    const s = start - i;
    const e = (s + 1) % 100;
    return {
      token: `${String(s % 100).padStart(2, "0")}${String(e).padStart(2, "0")}`,
      label: `${s}-${String(e).padStart(2, "0")}`,
    };
  });
}
