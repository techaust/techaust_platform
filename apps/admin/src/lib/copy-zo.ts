// M6.5 receipts, refunds and reconciliation: the staff lines of the admin screens [ADM-PAY-08, ADM-PAY-09, ADM-PAY-10, ADM-PAY-13, ADM-INV-17; run file
// docs/runs/m6.5-receipts-refunds.md G, H S1–S30, L40–L46]. Staff-only words, drafted by the designer in the plain style of the M6.2–M6.4 screens, unmarked (the
// `ZN_UI` pattern, so the screens read as they will) and listed in 07-ZO "Staff lines" and the run file's designer report for the lead's approval under the
// owner's delegation. The client-facing words are 07-ZO's (`@techaust/core/copy-zo`); the API's refusals and the review reasons are the finance Worker's
// (`worker/refunds.ts`, `worker/gateway/reasons.ts`). Tax and legal lines say which 08-C row they rest on. Pure, so the words are tested without a browser.
import type { RefundOrigin, RefundReason, RefundStatus } from "@techaust/core/refunds";

/** The gateway's name as the screens write it (manual: our bank transfer). */
const gw = (provider: string): string =>
  provider === "stripe"
    ? "Stripe"
    : provider === "paypal"
      ? "PayPal"
      : provider === "razorpay"
        ? "Razorpay"
        : "bank";

export const ZO_UI = {
  // ---- receipts on the Payments panel and the payment (S1–S4) ----
  receipt: "Receipt",
  receiptPreparing: "Receipt being prepared",
  receiptPdfMaking: "PDF being made",
  receiptOpen: "Open PDF",
  receiptRemake: "Make the PDF again",
  receiptRemakeAsked: "A new PDF was asked for. It is on its way.",
  receiptVoid: "Void (payment withdrawn)",
  receiptNone: "No receipt: TDS entries and waiting payments get none.",

  // ---- the refund button and rows (S5–S9) ----
  refund: "Refund",
  refundCredit: "Refund credit",
  noCredit: "This client has no credit left to refund.",
  refundsHeading: "Refunds",
  noRefunds: "No refunds.",
  refundRow: (amount: string, day: string) => `${amount} on ${day}`,
  tryAgain: "Try again",
  cancelRefund: "Cancel refund",
  /** L44 and L46: the buttons wait 15 minutes after the last try (the gateway may still be answering). */
  waitUntil: (time: string) => `Try again or cancel after ${time} IST.`,
  refundInProgress: (amount: string) => `Refund in progress ${amount}`,
  refundInProgressLabel: "Refund in progress",
  refundInProgressHint:
    "Not in the credit any more. It leaves the client's account when the gateway pays it.",
  retried: "Asked the gateway again.",
  cancelled: "Refund cancelled. The money stays as the client's credit.",
  cancelConfirm:
    "It is cancelled only if the gateway shows it never received this refund. The money then stays as the client's credit.",
  keepRefund: "Keep it",
  failureCode: (code: string) => `Gateway code: ${code}`,

  // ---- the refund dialog (S10–S22) ----
  dialogTitle: "Refund money to the client",
  recordTitle: "Record a refund made outside the admin",
  disputeTitle: "Record a lost dispute",
  sourceLabel: "Refund from",
  sourceCredit: "The client's credit",
  sourceCreditHint: (amount: string) => `This payment can give back up to ${amount}.`,
  sourceDocument: "This invoice's excess",
  sourceDocumentHint: (amount: string) => `Paid above what the invoice owes: ${amount}.`,
  sourcePending: "The whole payment (not confirmed yet)",
  sourcePendingHint: "A payment waiting for its check goes back in full through its own gateway.",
  pickPayment: "Payment",
  paymentReceived: "Payment received",
  paymentFact: (amount: string, day: string) => `${amount} on ${day}`,
  invoiceLabel: "Invoice",
  pickPaymentOption: (day: string, amount: string) => `Received ${day}: ${amount} available`,
  amountLabel: "Amount to refund",
  amountMost: (amount: string) => `At most ${amount}.`,
  wayLabel: "How the money goes back",
  wayGateway: (provider: string) => `Through ${gw(provider)} (to the card or account it came from)`,
  wayManual: "By our bank transfer",
  wayOutside: (provider: string) => `Already refunded in ${gw(provider)}'s dashboard`,
  reasonLabel: "Reason",
  noteLabel: "Note",
  modeLabel: "Paid by",
  referenceLabel: "Bank reference (UTR)",
  paidOnLabel: "Paid on",
  paidToLabel: "Paid to",
  paidToOriginal: "The account the money came from",
  paidToOwn: "Another account in the payer's own name",
  /** Researched 2026-10-28, RBI PA Directions 2025 para 10(f) (08-C RB-24): another account only at the payer's written request. */
  paidToOwnHint:
    "Only when the client asks for it in writing (RBI: a refund goes to the original method or the payer's own account).",
  writtenRequest: "The client asked for this in writing",
  writtenRequestMissing: "Tick this once you have the client's written request.",
  /** A card or wallet payment refunded by our bank transfer can't go to the "original" account (RB-24; the API's `paid_to_invalid`). */
  gatewayByBank:
    "A card or wallet payment refunded by bank transfer goes to another account in the payer's own name.",
  gatewayRefundIdLabel: (provider: string) => `${gw(provider)} refund ID`,
  disputeIdLabel: (provider: string) => `${gw(provider)} dispute ID`,
  settledOnLabel: "Refunded on",
  disputeClosedOnLabel: "Dispute closed on",
  refundButton: "Refund",
  recordButton: "Record refund",
  disputeButton: "Record lost dispute",
  requiredText: "Fill this in.",
  /** The amount the API answers with a 202: the gateway didn't answer yet; the sweep settles it (C step 3). */
  sentRequested: "Refund requested. The gateway hasn't answered yet; it is checked again every hour.",
  sentProcessing: "Refund sent. The gateway is paying it.",
  sentSucceeded: "Refund made.",
  recorded: "Refund recorded.",
  disputeRecorded: "Lost dispute recorded. The invoice shows what is owed again.",

  // ---- RA-40: a refund from an invoice's excess needs its credit note first (Q1 A) ----
  creditNoteFirst: "This refund needs a credit note first",
  creditNoteFirstBody:
    "Money paid on an invoice goes back only after a credit note lowers what the invoice owes. Issue the credit note for the amount you want to refund, then refund it here.",
  /** Settled 2026-11-03 (08-C RA-40): an advance invoice refunded with no supply gets a credit note with reason "Service not delivered". */
  creditNoteAdvance:
    "This invoice was issued for a payment received, so the credit note's reason is “Service not delivered”.",
  creditNoteLastDay: (day: string) => `Last day for a credit note on this invoice: ${day}.`,
  creditNoteWarn: (day: string) => `The last day for a credit note is close: ${day}.`,
  /** RA-40 OPEN edge (s.54 after the s.34(2) day): nothing is guessed; the app doesn't refund an invoice's money without its credit note. */
  creditNoteClosed: (day: string) =>
    `The last day for a credit note on this invoice was ${day}, so its money can't be refunded from here.`,
  draftCreditNote: "Draft the credit note",
  excessNow: (amount: string) => `Paid above what it owes now: ${amount}.`,

  // ---- RA-41: credit that may be an advance, refunded in a later GST period ----
  /** Settled by the lead on the safest reading, 2026-11-03 (08-C RA-41). */
  ra41Line: (received: string, now: string) =>
    `This credit arrived in ${received} and is refunded in ${now}. If it was more than ₹1,000 over an invoice, or never on one, GST on it was due when it arrived: record the advance in GSTR-1 Table 11 by hand.`,

  // ---- RB-43: export money goes back only after the bank's Reg. 6 reduction ----
  /** Settled by the lead on the safest reading, 2026-11-03 (08-C RB-43); the lead's line under the delegation (run file, 08-C n1–n5). */
  exportLine:
    "This client is outside India. Before you refund, ask your bank to approve the lower amount for this invoice (FEMA Reg. 6) and keep its reply.",
  exportConfirm: "The bank approved the lower amount",
  exportConfirmMissing: "Tick this once the bank has approved the lower amount.",

  // ---- the ₹25 lakh line (ADM-PAY-13; reuses 07-ZM S18's wording) ----
  /** Researched 2026-10-28, RBI PA Directions 2025 para 11(d) (08-C RB-07); a warning, never a block (L12). */
  paCbOver: (inr: string) =>
    `At the invoice's rate this is about ${inr}. RBI limits a payment aggregator's export payment to ₹25 lakh per transaction, so PayPal can't take it in one payment; card payments are kept under it too. Ask the client to pay by bank transfer or in parts.`,
  paCbRateUnknown: "No recent exchange rate on this invoice, so the ₹25 lakh check can't be made.",

  // ---- chargebacks (L40) ----
  chargebackHint:
    "Use this only when the dispute is lost and the gateway took the money back. The invoice reopens with what is owed.",

  // ---- refund statuses, reasons and origins ----
  status: {
    requested: "Requested",
    processing: "With the gateway",
    succeeded: "Refunded",
    failed: "Failed",
  } satisfies Record<RefundStatus, string>,
  reason: {
    credit_note: "After a credit note",
    overpayment: "Paid too much",
    duplicate: "Paid twice",
    tds_payback: "TDS paid back",
    chargeback: "Lost dispute",
    other: "Other",
  } satisfies Record<RefundReason, string>,
  origin: (o: RefundOrigin, provider: string): string =>
    o === "chargeback"
      ? "Lost dispute"
      : o === "outside"
        ? `Made in ${gw(provider)}`
        : provider === "manual"
          ? "By bank transfer"
          : `Through ${gw(provider)}`,
  colRequested: "Asked on",
  colWay: "How",
  colStatus: "Status",
  colAmount: "Amount",
  colClient: "Client",
  colReason: "Reason",
  colRefunded: "Refunded on",

  // ---- the Refunds tab on Payments (S23–S25) ----
  refundsTab: "Refunds",
  refundsAll: "All",
  refundsOpen: "In progress",
  refundsEmpty: "No refunds yet.",
  refundsEmptyFiltered: "No refunds in this state.",
  loadMore: "Show more",

  // ---- Needs review: the refund items (S26) ----
  recordThisRefund: "Record this refund",
  recordLostDispute: "Record lost dispute",
  openPayment: "Open payment",

  // ---- reconciliation (S27–S30) ----
  reconTitle: "Reconciliation",
  reconLede: "Razorpay's settlements to our bank, matched to the payments and refunds they carry.",
  settlements: "Settlements",
  unmatched: "Unmatched",
  colSettledOn: "Settled on",
  colLine: "Line",
  colUtr: "UTR",
  colGross: "Gross",
  colFees: "Fees and GST (absorbed)",
  colNet: "Net to bank",
  colMatched: "Matched",
  colBank: "Bank statement",
  matchedOf: (n: number, of: number) => `${n} of ${of}`,
  seenInBank: "Seen in bank statement",
  tickSeen: "Tick as seen",
  undoSeen: "Undo",
  undoReason: "Why it is undone",
  statementOn: "Statement date",
  statementRef: "Statement reference (optional)",
  ticked: "Ticked as seen in the bank statement.",
  unticked: "Tick undone.",
  fetchNow: "Fetch now",
  fetchDay: "Day to fetch",
  fetched: (result: string) =>
    result === "stored"
      ? "Settlements fetched."
      : result === "empty"
        ? "Razorpay has no settlements for that day."
        : result === "unconfigured"
          ? "Razorpay isn't set up here."
          : result === "live_not_allowed"
            ? "Live payments are switched off."
            : "Razorpay didn't answer. Try again later.",
  noSettlements: "No settlements yet",
  noSettlementsBody:
    "Razorpay's settlements are fetched every morning at 9:00 for the day before. Fetch a day now to see it here.",
  tabItems: "Settlement lines without a payment",
  tabGateway: "Razorpay payments not settled",
  tabManual: "Bank payments not ticked",
  itemsEmpty: "Every settlement line matches a payment or refund.",
  gatewayEmpty: "Every Razorpay payment older than 5 days is in a settlement.",
  manualEmpty: "Every confirmed bank payment older than 7 days is ticked as seen.",
  itemsHint: "Lines Razorpay settled that match nothing here: check them in Razorpay's dashboard.",
  gatewayHint: "Confirmed Razorpay payments 5 or more days old that no settlement includes yet.",
  manualHint: "Confirmed bank payments not yet ticked as seen in the bank statement after 7 days.",
  entity: {
    payment: "Payment",
    refund: "Refund",
    adjustment: "Adjustment",
    transfer: "Transfer",
    other: "Other",
  } as Record<string, string>,
  direction: { credit: "In", debit: "Out" } as Record<string, string>,
  feeMismatch: "Fee differs from the payment's",
  matchState: { matched: "Matched", unmatched: "Not matched", ignored: "Ignored" } as Record<string, string>,
  settlementItems: "Lines in this settlement",
  close: "Close",
  /** Open item: GST on the gateway's fee is shown absorbed (OPEN (08-C RA-29): is it invoiced to our GSTIN?). */
  feesNote:
    "Fees and their GST are shown as absorbed. Whether Razorpay invoices the GST to our GSTIN is still open.",

  // ---- FEMA reductions (RB-43) ----
  reductions: "Bank-approved reductions",
  reductionAdd: "Record bank's reduction",
  reductionRow: (amount: string, day: string, ref: string) => `${amount} approved ${day}, reference ${ref}`,
  reductionDeclaration: "On our own declaration (up to ₹10 lakh)",
  reductionDeclarationHint:
    "Tick only when the bank allowed it on our declaration rather than its own approval letter.",
  reductionApprovedOn: "Approved on",
  reductionBankRef: "Bank's reference",
  reductionAmount: "Amount reduced",
  reductionSaved: "Reduction recorded.",
  reductionPendingLine:
    "FEMA treats this invoice as not fully realised until the bank's reduction is recorded here.",

  // ---- review part 1 (builder B5's staff drafts for the lead under the delegation; 07-ZO "Staff lines" S34–S38) ----
  /** S34, RA-41 on the Payments panel: the approved refund-dialog line without its "is refunded in" clause (nothing is being refunded there). */
  ra41HeldLine: (received: string) =>
    `This credit arrived in ${received}. If it was more than ₹1,000 over an invoice, or never on one, GST on it was due when it arrived: record the advance in GSTR-1 Table 11 by hand.`,
  /** S35, Payments › Credit at period end (RA-41). */
  creditHeldTab: "Credit at period end",
  creditHeldLede:
    "Credit a client held when a GST period ended that may be an advance: money on no invoice, or more than ₹1,000 over its invoices. Refund it, use it, or record it in GSTR-1 Table 11 for that period.",
  creditHeldPeriod: "Period",
  creditHeldColClient: "Client",
  creditHeldColReceived: "Received on",
  creditHeldColSince: "Held since",
  creditHeldColCredit: "Credit at period end",
  creditHeldColOnInvoice: "Part on an invoice",
  creditHeldOnInvoice: (yes: boolean) => (yes ? "Yes" : "No"),
  creditHeldEmpty: "No client held such credit when this period ended.",
  /** S36, the bank's INR figure of a refund in another currency (L9). */
  inrRecord: "Record INR amount",
  inrLabel: "INR the bank debited",
  inrHint: "As the bank's advice shows it. It can be recorded once.",
  inrDebited: (amount: string) => `INR debited ${amount}`,
  inrSaved: "INR amount recorded.",

  // ---- the refunds register (Reports) ----
  registerTitle: "Refunds register",
  registerHint: "Every refund that went out in the year, with its payment, invoice and credit note.",
} as const;

/** A GSTR-3B period as people say it: "2026-11" → "November 2026", "2026-Q4" → "October to December 2026" (anything else as it is). */
export function periodText(period: string): string {
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
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) {
    const first = (Number(q[2]) - 1) * 3;
    return `${MONTHS[first]} to ${MONTHS[first + 2]} ${q[1]}`;
  }
  return period;
}

/** The status chip's tone and icon (icon and words, never colour alone; docs/06 §5.5). */
export const REFUND_PILLS: Record<
  RefundStatus,
  {
    tone: "neutral" | "success" | "warning" | "danger" | "info" | "muted";
    icon: "clock" | "progress" | "check" | "xCircle";
  }
> = {
  requested: { tone: "warning", icon: "clock" },
  processing: { tone: "info", icon: "progress" },
  succeeded: { tone: "success", icon: "check" },
  failed: { tone: "danger", icon: "xCircle" },
};

/** The review kinds the refund flow answers ("Record this refund", L7, L40) and the ones that point back to a refund of ours. */
export const RECORD_KINDS: readonly string[] = [
  "refunded_outside",
  "reversed_after_confirm",
  "dispute_closed",
  "refund_after_failed",
];
export const DISPUTE_KINDS: readonly string[] = ["reversed_after_confirm", "dispute_closed"];
