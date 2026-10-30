// The data the M5.4 emails are queued with (the contract between the jobs consumers that build the messages and the designer's templates in packages/email).
// Every value is a string (the queue's `data` is `Record<string, string>`), money and dates already formatted for a person by the consumer, an address or a link
// never invented here. Flags are "1" or "" (the template tests for empty). The consumer sends exactly these keys, no more (a test compares).
import type { EmailTemplate } from "./email-templates.ts";

/** The keys of one client email about an issued document (invoice, proforma, credit note, debit note). */
const DOCUMENT_KEYS = [
  /** The contact's first name. */
  "first_name",
  /** The document's number, as printed (TH/INV/2627/0001). */
  "number",
  /** The date it was issued and (not on a credit note) the date it is due, as a person reads them. */
  "issue_date",
  "due_date",
  /** The total, and what is still owed (empty on a credit note), formatted with the currency. */
  "total",
  "balance",
  /** The personal link to the document page (a token in the fragment): "View invoice" (Q13). */
  "url",
  /** "1" when the PDF is attached to this email; "" when it is a link only (the client's setting, or the PDF was over the size cap). */
  "attached",
  /** A credit or debit note only: the number of the invoice it is against. */
  "parent_number",
  /** The sender's name (the company's trade name for an automatic send). */
  "sender_name",
  /** A credit or debit note only (empty on every other type): the frozen reason, in words (`noteReasonWords`). */
  "reason",
  /** A credit note only (empty otherwise): the parent invoice's balance after the note, formatted with the currency. */
  "parent_balance",
] as const;

/**
 * 07-T §3 (and §9, Q35): the label of each reason a person can pick for a credit or debit note. THE one place for these words (final sweep, lead
 * 2026-10-30): the emails, the PDF (`@techaust/pdf`), the admin note screens and the portal's note page all read this map, so they never drift.
 */
export const NOTE_REASON_LABELS: Readonly<Record<string, string>> = {
  price_correction: "Price correction",
  service_not_delivered: "Service not delivered",
  service_deficient: "Service deficient",
  discount_after_sale: "Discount after sale",
  tax_charged_too_low: "Tax charged too low",
  other: "Other",
};

/** A reason code's 07-T §3 label; a code nobody knows is printed as it is. */
export const noteReasonLabel = (code: string): string =>
  Object.hasOwn(NOTE_REASON_LABELS, code) ? (NOTE_REASON_LABELS[code] as string) : code;

/** A frozen note reason in words: the typed text alone for "other", else the code's label, then the typed text in brackets when one was typed ("Price correction (rate typed wrong)", Q68). A code nobody knows is printed as it is. */
export function noteReasonWords(code: string, text: string): string {
  const t = text.trim();
  const label = noteReasonLabel(code);
  if (code === "other") return t || label;
  return t ? `${label} (${t})` : label;
}

const ALERT_KEYS = ["owner_first_name", "client_name", "admin_url"] as const;

/** The data keys of each M5.4 template. */
export const INVOICE_EMAIL_DATA = {
  "invoice.sent": DOCUMENT_KEYS,
  "proforma.sent": DOCUMENT_KEYS,
  "credit_note.sent": DOCUMENT_KEYS,
  "debit_note.sent": DOCUMENT_KEYS,
  "reminder.sent": [
    ...DOCUMENT_KEYS,
    /** The reminder's distance from the due date in days, as text and never negative ("3" for the default -3 and for +3, "0" on the day), and `when`: "before", "on" or "after" the due date. */
    "offset_days",
    "when",
    /** The document kind: "invoice", "proforma" or "debit_note". */
    "kind",
  ],
  "alert.unbilled": [...ALERT_KEYS, "milestone_title", "delivered_date", "days_since"],
  "alert.proforma_due": [
    ...ALERT_KEYS,
    "milestone_title",
    "delivered_date",
    "days_since",
    "proforma_number",
    "balance",
  ],
  "lut.reminder": ["owner_first_name", "fy_label", "state", "admin_url"],
  /** M5.5b: `month_label` is the invoice month in words, `count` the number of export invoices (text), `due_date` the EDF due date, `link` the admin page. */
  "edf.reminder": ["owner_first_name", "month_label", "count", "due_date", "link"],
  /** M5.5b: `stage` is `fema_approaching`, `fema_overdue`, `gst_approaching` or `gst_overdue`; `outstanding` and `due_date` are formatted as the invoice shows them. */
  "realisation.alert": [
    "owner_first_name",
    "stage",
    "number",
    "client",
    "currency",
    "outstanding",
    "due_date",
    "link",
  ],
} as const satisfies Partial<Record<EmailTemplate, readonly string[]>>;

export type InvoiceEmailTemplate = keyof typeof INVOICE_EMAIL_DATA;
export const isInvoiceEmailTemplate = (t: string): t is InvoiceEmailTemplate =>
  Object.hasOwn(INVOICE_EMAIL_DATA, t);
