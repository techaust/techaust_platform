// 07-ZO's client lines (M6.5 receipts and refunds; docs/07-content-appendix/ZO-m6.5-receipts-refunds.md), in ONE place for the receipt PDF (`packages/pdf`), the
// receipt email (`packages/email`), the statement's refund line and the portal. Client-facing words are the owner's: until the owner approves 07-ZO word for word,
// every line here shows the "[Placeholder] " mark before the drafted words; the lead turns `APPROVED_07ZO` to true once the page is approved (one switch). Lines 8
// and 9 rest on 08-C RA-39 (n1, Researched 2026-11-03, s.31(3)(d) CGST Act and Rule 50 CGST Rules: the receipt is no tax invoice and never a voucher) and RB-21 (b)
// (OPEN (08-C RB-21): is an emailed, computer-generated receipt chargeable to stamp duty? so no signature or stamp claim either way). No line names a stamp, a
// signature or a voucher (a test holds it).

/** The owner's approval of 07-ZO's client lines (owner, pending at build time, 2026-11-03). */
export const APPROVED_07ZO: boolean = false;
const ZO = (line: string): string => (APPROVED_07ZO ? line : `[Placeholder] ${line}`);

/** The receipt PDF's fixed words (07-ZO lines 1 to 10). */
export const RECEIPT_COPY = {
  title: ZO("Payment receipt"),
  number: ZO("Receipt number"),
  date: ZO("Receipt date"),
  receivedFrom: ZO("Received from"),
  amountReceived: ZO("Amount received"),
  amountInWords: ZO("Amount in words"),
  receivedOn: ZO("Received on"),
  paidBy: ZO("Paid by"),
  reference: ZO("Reference"),
  appliedTo: ZO("Applied to"),
  invoice: ZO("Invoice"),
  amount: ZO("Amount"),
  heldAsCredit: ZO("Held as credit on your account"),
  notTaxInvoice: ZO("This is a receipt for a payment we received. It is not a tax invoice."),
  computerGenerated: ZO("Computer-generated receipt."),
  /** Line 18: "and {n} more" under a long "Applied to" list (added to 07-ZO after the designer, 2026-11-03; marked like the rest until the owner approves). */
  appliedMore: (n: number) => ZO(`and ${n} more`),
} as const;

/** Line 10: the "Paid by" words, one per way of paying (only the ways the business takes are ever shown); anything else reads as a bank transfer's words. */
export function paidByWords(provider: string, mode: string | null): string {
  if (provider === "paypal") return ZO("PayPal");
  if (mode === "upi") return ZO("UPI");
  if (mode === "card") return ZO("Card");
  if (mode === "netbanking") return ZO("Netbanking");
  if (mode === "swift") return ZO("International bank transfer (SWIFT)");
  if (mode === "cheque") return ZO("Cheque");
  if (mode === "cash") return ZO("Cash");
  return ZO("Bank transfer");
}

/** Lines 11, 12 and 12b: the receipt email (`{amount}` and `{date}` already formatted by the caller). */
export const RECEIPT_EMAIL_COPY = {
  subject: (number: string, amount: string) => ZO(`Receipt ${number} for your payment of ${amount}`),
  bodyAttached: (amount: string, date: string, number: string) =>
    ZO(`Thank you. We received ${amount} on ${date}. Your receipt ${number} is attached.`),
  bodyPortal: (amount: string, date: string, number: string) =>
    ZO(
      `Thank you. We received ${amount} on ${date}. You can download receipt ${number} from your client portal.`,
    ),
  /** Line 12b: the closing line, as the other house emails end (added to 07-ZO after the designer, 2026-11-03; marked until the owner approves). */
  closing: ZO("Questions? Just reply to this email."),
} as const;

/** Lines 13 to 16: the client portal. */
export const PORTAL_RECEIPT_COPY = {
  receiptLink: ZO("Receipt"),
  refunded: (amount: string, date: string) => ZO(`Refunded ${amount} on ${date}`),
  receiptsHeading: ZO("Receipts"),
  receiptRow: (number: string, amount: string, date: string) =>
    ZO(`Receipt ${number}: ${amount} received on ${date}`),
} as const;

/** A line 07-ZO lacks (builder's draft for the owner, run file): a refund on the statement of account (its PDF and CSV). */
export const STATEMENT_REFUND_WORD = ZO("Refund");

/** Every client line as text, for the forbidden-words test (RA-39, RB-21 (b)). */
export const zoAllText = (): readonly string[] => [
  ...Object.values(RECEIPT_COPY).map((v) => (typeof v === "function" ? v(2) : v)),
  ...["razorpay", "stripe", "paypal", "manual"].flatMap((p) =>
    [null, "upi", "card", "netbanking", "swift", "cheque", "cash", "neft"].map((m) => paidByWords(p, m)),
  ),
  RECEIPT_EMAIL_COPY.subject("TH/RCT/2627/0001", "₹1.00"),
  RECEIPT_EMAIL_COPY.bodyAttached("₹1.00", "3 Nov 2026", "TH/RCT/2627/0001"),
  RECEIPT_EMAIL_COPY.bodyPortal("₹1.00", "3 Nov 2026", "TH/RCT/2627/0001"),
  RECEIPT_EMAIL_COPY.closing,
  PORTAL_RECEIPT_COPY.receiptLink,
  PORTAL_RECEIPT_COPY.refunded("₹1.00", "3 Nov 2026"),
  PORTAL_RECEIPT_COPY.receiptsHeading,
  PORTAL_RECEIPT_COPY.receiptRow("TH/RCT/2627/0001", "₹1.00", "3 Nov 2026"),
  STATEMENT_REFUND_WORD,
];
