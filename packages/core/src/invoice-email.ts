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
] as const;

const ALERT_KEYS = ["owner_first_name", "client_name", "admin_url"] as const;

/** The data keys of each M5.4 template. */
export const INVOICE_EMAIL_DATA = {
  "invoice.sent": DOCUMENT_KEYS,
  "proforma.sent": DOCUMENT_KEYS,
  "credit_note.sent": DOCUMENT_KEYS,
  "debit_note.sent": DOCUMENT_KEYS,
  "reminder.sent": [
    ...DOCUMENT_KEYS,
    /** The reminder's offset in days from the due date (-3, 0, 3, 7, 14 by default) as text, and "before", "on" or "after" the due date. */
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
} as const satisfies Partial<Record<EmailTemplate, readonly string[]>>;

export type InvoiceEmailTemplate = keyof typeof INVOICE_EMAIL_DATA;
export const isInvoiceEmailTemplate = (t: string): t is InvoiceEmailTemplate =>
  Object.hasOwn(INVOICE_EMAIL_DATA, t);
