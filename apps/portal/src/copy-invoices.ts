// Every word the M5.4 invoice screens show (POR-06; Q49), in two groups:
// - docs/07-content-appendix/U-m5.4-send-recurring-reminders.md §3 (07-U), approved by the lead on 2026-10-28 under the owner's delegation, word for word;
// - the PDF's own words (07-R §6, 07-S §1 and §2, 07-T §1, `@techaust/pdf/copy`), because 07-U says the page shows "the lines and tax summary as on the
//   PDF"; and approved portal words from copy-documents.ts (the navigation, "Download PDF", "Show more", "Sign in").
// A line 07-U lacked is 07-W's (approved 2026-10-28), never invented. English (India/UK spelling),
// "and" never "&". The payment line is a product rule (Researched 2026-10-28, 08-C RA-28: a statement or reminder is not a tax document).
import { PROFORMA_NOTICE } from "@techaust/core/invoices";
import { EXPORT_PDF_COPY, INVOICE_PDF_COPY, NOTE_PDF_COPY, PROFORMA_PDF_COPY } from "@techaust/pdf/copy";
import { N, PENDING, WORDS } from "./copy-documents.ts";

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
    number: "Number",
    type: "Type",
    issued: "Issued",
    due: "Due",
    total: "Total",
    balance: "Balance",
    status: "Status",
  },
  types: {
    tax_invoice: "Invoice",
    export_invoice: "Export invoice",
    proforma: "Payment request",
    credit_note: "Credit note",
    debit_note: "Debit note",
  } as Record<string, string>,
  status: {
    due: "Due",
    overdue: "Overdue",
    paid: "Paid",
    credited: "Credited",
    void: "Void",
  },
  empty: "No invoices yet. When we send you one, it appears here.",
  issuedOn: (date: string) => `Issued ${date}`,
  dueOn: (date: string) => `Due ${date}`,
  total: "Total",
  balanceDue: "Balance due",
  /** 07-ZA item 15 (owner 2026-10-30): a payment request says what the PDF says, the frozen statutory line (07-S §2). */
  proformaNotice: PROFORMA_NOTICE,
  /** 07-ZA item 11 (owner 2026-10-30): the money row between Total and Balance due once something was paid. */
  paid: "Paid",
  againstInvoice: (number: string) => `Against invoice ${number}`,
  howToPay: (type: string, number: string) =>
    `Pay by bank transfer to the account shown on the ${documentWord(type)}. Please quote ${number} as the payment reference.`,
  linkEnded:
    "This link no longer works. Sign in to your client portal to see your invoices, or ask us for a new link at contact@techaust.com.",
  pdfNotReady: "The PDF is still being prepared. Try again in a minute.",
  /**
   * The emailed link's offer to sign in: 07-U has no line for it (the M4.5 one speaks of accepting). Review L7: a proposed line instead of the bare
   * mark, marked until the owner approves its words (run file).
   */
  signInHint: "Sign in to your client portal to see all your invoices and payment requests in one place.",
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
    /**
     * FX-4 review M1 (A5 5): a proforma sealed with the estimate marker names each tax head "CGST (estimate)", the PDF's own words (07-Y, pending;
     * unmarked like the PDF, docs/13). Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28).
     */
    estimateHead: PROFORMA_PDF_COPY.estimate,
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
