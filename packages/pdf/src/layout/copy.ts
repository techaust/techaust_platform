// The fixed wording printed on a proposal or estimate PDF, word for word from 07-P §1 (docs/07-content-appendix/P-m4.4-pdf-documents.md)
// and, for the terms line, 07-O §1. 07-P is PENDING the owner's word-for-word approval; the tax lines are VERIFY WITH CA/LEGAL.
// Values (names, numbers, dates, amounts) come pre-formatted in the view; nothing here is worked out.
import { DEFAULT_CONTACT_EMAIL, footerLine } from "../footer.ts";

export const PDF_COPY = {
  blocks: { from: "From", preparedFor: "Prepared for", document: "Document" },
  document: { number: "No.", date: "Date", validUntil: "Valid until", currency: "Currency" },
  placeOfSupply: (label: string) => `Place of supply: ${label}`,
  cover: {
    preparedFor: "Prepared for",
    contact: (who: string) => `Your contact at TecHaust: ${who}`,
  },
  lines: {
    n: "#",
    description: "Description",
    sac: "SAC",
    qty: "Qty",
    unit: "Unit",
    rate: "Rate",
    discount: "Discount",
    taxable: "Taxable value",
    gst: "GST %",
  },
  summary: {
    heading: "Tax summary",
    taxable: "Taxable value",
    cgst: "CGST",
    sgst: "SGST",
    igst: "IGST",
  },
  words: (words: string) => `Amount in words: ${words}`,
  schedule: {
    heading: "Payment schedule",
    instalment: "Instalment",
    when: "When",
    share: "Share",
    amount: "Amount",
  },
  timeline: {
    milestone: "Milestone",
    whatYouGet: "What you get",
    targetDate: "Target date",
    payment: "Payment",
  },
  /** VERIFY WITH CA/LEGAL (07-P §1; 07 §2.4). */
  usdNote: "International projects are invoiced from India in USD as an export of services.",
  /** VERIFY WITH CA (07-P §1; 07 §2.4). */
  inrNote: "Prices exclude GST.",
  acceptance: {
    online: "Accept online in the TecHaust client portal:",
    record: "Your acceptance is recorded on a separate acceptance certificate. This document doesn't change.",
  },
  /** 07-Q Q11: the proposal and estimate footer is `footerLine` in view.ts (Settings "Email on documents"); this is the certificate's. */
  footer: { brand: footerLine(DEFAULT_CONTACT_EMAIL) },
  page: { word: "Page", of: "of" },
  /** 07-O §1, the terms section's text; printed only when the section itself is empty (as the admin's read view does). */
  termsLine: (version: string) => `The terms below are version ${version} of our terms.`,
  /** 07-P §2: headings of the parts the layout adds when a document has no such section (the sections carry their own titles). */
  headings: { investment: "Investment", terms: "Terms", acceptance: "Acceptance" },
} as const;

/**
 * The fixed wording printed on a tax invoice PDF, word for word from 07-R §6 (docs/07-content-appendix/R-m5.1-invoice-screens.md).
 * Client-facing; PENDING the owner's word-for-word approval; every tax line is VERIFY WITH CA/LEGAL. The reverse-charge statement is NOT here:
 * the invoice prints the text frozen with it at issue (Rule 46(p)), never a constant. 07-R's footer default notes are a placeholder, so no
 * notes are printed unless the owner set some (nothing is invented).
 */
export const INVOICE_PDF_COPY = {
  title: "Tax Invoice",
  copyMark: "ORIGINAL FOR RECIPIENT",
  header: {
    number: "Invoice number",
    date: "Invoice date",
    dueDate: "Due date",
    placeOfSupply: "Place of supply",
    stateCode: "State code",
  },
  parties: {
    from: "From",
    billedTo: "Billed to",
    gstin: "GSTIN",
    pan: "PAN",
    address: "Address",
    state: "State",
  },
  lines: {
    n: "#",
    description: "Description",
    sac: "SAC",
    qty: "Qty",
    rate: "Rate",
    discount: "Discount",
    taxable: "Taxable value",
  },
  summary: {
    heading: "Tax summary",
    sac: "SAC",
    taxable: "Taxable value",
    cgst: "CGST",
    sgst: "SGST",
    igst: "IGST",
    rate: "Rate",
    amount: "Amount",
  },
  words: (words: string) => `Amount in words: ${words}`,
  balanceDue: "Balance due",
  payment: {
    heading: "How to pay",
    bank: "Bank transfer (NEFT, RTGS or IMPS) to:",
    accountName: "Account name",
    accountNumber: "Account number",
    ifsc: "IFSC",
    bankAndBranch: "Bank and branch",
    reference: (number: string) => `Please quote ${number} as the payment reference.`,
    portal: (address: string) => `Or pay in the client portal: ${address}`,
  },
  signature: { for: (legalName: string) => `For ${legalName}`, signatory: "Authorised signatory" },
  page: { word: "Page", of: "of" },
} as const;

/**
 * The fixed wording an export invoice adds, word for word from 07-S §1 (docs/07-content-appendix/S-m5.2-invoice-types.md). Client-facing; PENDING the
 * owner's word-for-word approval; every tax line is VERIFY WITH CA/LEGAL. The endorsement itself is NOT here: the invoice prints the text frozen with
 * it at issue (Rule 46; LD23, LD33), never a constant.
 */
export const EXPORT_PDF_COPY = {
  title: "Export Invoice",
  lut: (arn: string, fyLabel: string) => `LUT ARN: ${arn} (FY ${fyLabel})`,
  countryOfDestination: "Country of destination",
  addressOfDelivery: "Address of delivery",
  placeOfSupply: "Place of supply",
  inr: {
    heading: "Value in INR",
    rate: (rate: string, source: string, date: string) =>
      `Exchange rate: 1 USD = ₹${rate} (${source}, ${date})`,
    taxable: "Taxable value in INR",
    igst: "IGST in INR",
  },
  payment: {
    swift: "International wire (SWIFT) to:",
    beneficiary: "Beneficiary",
    accountNumber: "Account number",
    swiftBic: "SWIFT/BIC",
    bankAndBranch: "Bank and branch",
    bankAddress: "Bank address",
    /** Not in 07-S §1: borrowed from the Settings › Bank label (07-S §8 "Intermediary bank (if your bank uses one)"), its first two words. */
    intermediary: "Intermediary bank",
    purposeCode: (code: string) => `Purpose code: ${code}`,
  },
} as const;

/** The fixed wording of a proforma (07-S §2; PENDING approval). The notice under the title is NOT here: the proforma prints the text frozen with it. */
export const PROFORMA_PDF_COPY = {
  title: "Proforma Invoice",
  header: { number: "Proforma number", date: "Proforma date", validUntil: "Valid until" },
} as const;

/** The line under the title of a tax or export invoice issued for a payment received against a proforma (07-S §8, Q9; PENDING approval). */
export const advanceLine = (proformaNumber: string, proformaDate: string, receivedOn: string) =>
  `Against proforma ${proformaNumber} of ${proformaDate}, payment received on ${receivedOn}.`;
