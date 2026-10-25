// The fixed wording printed on a proposal or estimate PDF, word for word from 07-P §1 (docs/07-content-appendix/P-m4.4-pdf-documents.md)
// and, for the terms line, 07-O §1. 07-P is PENDING the owner's word-for-word approval; the tax lines are VERIFY WITH CA/LEGAL.
// Values (names, numbers, dates, amounts) come pre-formatted in the view; nothing here is worked out.

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
  schedule: { heading: "Payment schedule", instalment: "Instalment", when: "When", share: "Share", amount: "Amount" },
  timeline: { milestone: "Milestone", whatYouGet: "What you get", targetDate: "Target date", payment: "Payment" },
  /** VERIFY WITH CA/LEGAL (07-P §1; 07 §2.4). */
  usdNote: "International projects are invoiced from India in USD as an export of services.",
  /** VERIFY WITH CA (07-P §1; 07 §2.4). */
  inrNote: "Prices exclude GST (18 %).",
  acceptance: {
    online: "Accept online in the TecHaust client portal:",
    record: "Your acceptance is recorded on a separate acceptance certificate. This document doesn't change.",
  },
  footer: { brand: "TecHaust Technologies · techaust.com · hello@techaust.com" },
  page: { word: "Page", of: "of" },
  /** 07-O §1, the terms section's text; printed only when the section itself is empty (as the admin's read view does). */
  termsLine: (version: string) => `The terms below are version ${version} of our proposal terms.`,
  /** 07-P §2: headings of the parts the layout adds when a document has no such section (the sections carry their own titles). */
  headings: { investment: "Investment", terms: "Terms", acceptance: "Acceptance" },
} as const;
