// Every word the M5.4 invoice screens show (POR-06; Q49), in two groups:
// - U: docs/07-content-appendix/U-m5.4-send-recurring-reminders.md §3 (07-U), drafted by the lead and PENDING the owner's word-for-word approval. Each line
//   carries the "[Placeholder] " mark until the owner approves 07-U (`APPROVED_07U`), as the admin's M5.1 to M5.3 screens mark unapproved lines.
// - the PDF's own words (07-R §6, 07-S §1 and §2, 07-T §1, `@techaust/pdf/copy`), because 07-U says the page shows "the lines and tax summary as on the
//   PDF"; and approved portal words from copy-documents.ts (the navigation, "Download PDF", "Show more", "Sign in").
// English (India/UK spelling), "and" never "&". The payment and tax lines are VERIFY WITH CA/LEGAL.
import { EXPORT_PDF_COPY, INVOICE_PDF_COPY, NOTE_PDF_COPY, PROFORMA_PDF_COPY } from "@techaust/pdf/copy";
import { N, PENDING, WORDS } from "./copy-documents.ts";

/** Flip to true when the owner approves 07-U: every mark disappears at once (the admin and the emails have the same switch). */
export const APPROVED_07U = false;
export const PLACEHOLDER = "[Placeholder]";
/** A 07-U line, marked until the owner approves it. */
export const U = (line: string): string => (APPROVED_07U ? line : `${PLACEHOLDER} ${line}`);

/** {document} in a sentence (07-U §1): "invoice", "payment request", "credit note", "debit note". */
export function documentWord(type: string): string {
  if (type === "proforma") return "payment request";
  if (type === "credit_note") return "credit note";
  if (type === "debit_note") return "debit note";
  return "invoice";
}

export const INV = {
  // The brief's navigation word (approved with M4.5), also 07-U §3's list heading.
  title: WORDS.nav.invoices,
  cols: {
    number: U("Number"),
    type: U("Type"),
    issued: U("Issued"),
    due: U("Due"),
    total: U("Total"),
    balance: U("Balance"),
    status: U("Status"),
  },
  types: {
    tax_invoice: U("Invoice"),
    export_invoice: U("Export invoice"),
    proforma: U("Payment request"),
    credit_note: U("Credit note"),
    debit_note: U("Debit note"),
  } as Record<string, string>,
  status: {
    due: U("Due"),
    overdue: U("Overdue"),
    paid: U("Paid"),
    credited: U("Credited"),
    void: U("Void"),
  },
  empty: U("No invoices yet. When we send you one, it appears here."),
  issuedOn: (date: string) => U(`Issued ${date}`),
  dueOn: (date: string) => U(`Due ${date}`),
  total: U("Total"),
  balanceDue: U("Balance due"),
  againstInvoice: (number: string) => U(`Against invoice ${number}`),
  howToPay: (type: string, number: string) =>
    U(
      `Pay by bank transfer to the account shown on the ${documentWord(type)}. Please quote ${number} as the payment reference.`,
    ),
  linkEnded: U(
    "This link no longer works. Sign in to your client portal to see your invoices, or ask us for a new link at contact@techaust.com.",
  ),
  pdfNotReady: U("The PDF is still being prepared. Try again in a minute."),
  /**
   * The emailed link's offer to sign in: 07-U has no line for it (the M4.5 one speaks of accepting). Review L7: a proposed line instead of the bare
   * mark, marked (the plain mark: approving 07-U alone doesn't unmark it) until the owner approves its words.
   */
  signInHint: `${PLACEHOLDER} Sign in to your client portal to see all your invoices and payment requests in one place.`,
  // Approved portal words.
  downloadPdf: WORDS.downloadPdf,
  showMore: PENDING.showMore,
  signIn: N.signIn,
  back: N.back,
  // The PDF's words (07-R §6 and the PDF view's totals rows).
  pdf: {
    lines: INVOICE_PDF_COPY.lines,
    summary: INVOICE_PDF_COPY.summary,
    howToPay: INVOICE_PDF_COPY.payment.heading,
    bankLine: INVOICE_PDF_COPY.payment.bank,
    accountName: INVOICE_PDF_COPY.payment.accountName,
    accountNumber: INVOICE_PDF_COPY.payment.accountNumber,
    ifsc: INVOICE_PDF_COPY.payment.ifsc,
    bankAndBranch: INVOICE_PDF_COPY.payment.bankAndBranch,
    swiftLine: EXPORT_PDF_COPY.payment.swift,
    beneficiary: EXPORT_PDF_COPY.payment.beneficiary,
    swiftBic: EXPORT_PDF_COPY.payment.swiftBic,
    bankAddress: EXPORT_PDF_COPY.payment.bankAddress,
    intermediary: EXPORT_PDF_COPY.payment.intermediary,
    purposeCode: EXPORT_PDF_COPY.payment.purposeCode,
    validUntil: PROFORMA_PDF_COPY.header.validUntil,
    noteTitles: { credit_note: NOTE_PDF_COPY.credit.title, debit_note: NOTE_PDF_COPY.debit.title },
    totals: {
      subtotal: "Sub-total",
      discount: "Discount",
      taxable: "Taxable value",
      cgst: "CGST",
      sgst: "SGST",
      igst: "IGST",
      roundOff: "Round-off",
      total: "Total",
    },
  },
} as const;
