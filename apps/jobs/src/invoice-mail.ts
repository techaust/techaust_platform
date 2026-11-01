// What both client emails about an issued document (`invoice.send`, `reminder.send`) are built from (M5.4; ADM-INV-15, ADM-INV-13; the keys are the contract `INVOICE_EMAIL_DATA` in
// `@techaust/core/invoice-email`, the designer's templates read them). Pure of I/O: rows in, strings out. No address, no name and no amount is ever logged here. Every value is a string,
// money and dates already formatted for a person.

import { formatDate, formatMoney, money, parseIsoDate } from "@techaust/core";
import { noteReasonWords } from "@techaust/core/invoice-email";
import type { InvoiceFlowType } from "@techaust/core/invoices";
import { firstNameOf } from "@techaust/core/offers";

/** The template of the first email about a document, by its type (tax and export invoices share one). */
export const SEND_TEMPLATE = {
  tax_invoice: "invoice.sent",
  export_invoice: "invoice.sent",
  proforma: "proforma.sent",
  credit_note: "credit_note.sent",
  debit_note: "debit_note.sent",
} as const satisfies Record<InvoiceFlowType, string>;

/** The document facts the emails print: columns of `documents` as D1 returns them. */
export type DocFacts = {
  type: string;
  number_display: string | null;
  issue_date: string | null;
  due_date: string | null;
  total_minor: number;
  balance_minor: number;
  currency: string;
  issuer: string | null;
  parent_number: string | null;
  /** A note's frozen reason (`header_extras.noteOf.reason`) and its parent invoice's balance now, read in the same SQL as the rest (null for other types). */
  reason_code?: string | null;
  reason_text?: string | null;
  parent_balance_minor?: number | null;
};

/** The SQL columns that fill `DocFacts`' note fields (the document is `d`). Shared by `invoice.send` and `reminder.send`. */
export const NOTE_FACTS_SQL =
  "json_extract(d.header_extras, '$.noteOf.reason.code') AS reason_code, json_extract(d.header_extras, '$.noteOf.reason.text') AS reason_text, (SELECT p.balance_minor FROM documents p WHERE p.id = d.parent_id) AS parent_balance_minor";

const dateText = (iso: string | null): string => {
  const d = iso ? parseIsoDate(iso) : null;
  return d ? formatDate(d) : "";
};
export const moneyText = (minor: number, currency: string): string =>
  formatMoney(money(minor, currency === "USD" ? "USD" : "INR"));
export const firstName = (name: string | null): string => firstNameOf(name ?? "");

/** The sender's display name in the frozen issuer (the company's trade name for an automatic send), or "". */
export function senderNameOf(issuerJson: string | null): string {
  try {
    const i = JSON.parse(issuerJson ?? "null") as { sender?: { name?: unknown } } | null;
    return typeof i?.sender?.name === "string" ? i.sender.name : "";
  } catch {
    return "";
  }
}

/** A PDF's name on the email: the number made safe for a file name, never the client or a title. */
export const pdfFileName = (numberDisplay: string | null): string =>
  `${(numberDisplay ?? "").replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "document"}.pdf`;

/**
 * The keys every client email about an issued document carries (`DOCUMENT_KEYS`). A credit note has no due date and no balance (they are empty strings, not zeros); `url` is the
 * personal link; `attached` is "1" only when the PDF goes with the email.
 */
export function documentData(
  doc: DocFacts,
  who: { name: string | null; url: string; attached: boolean },
): Record<string, string> {
  const credit = doc.type === "credit_note";
  return {
    first_name: firstName(who.name),
    number: doc.number_display ?? "",
    issue_date: dateText(doc.issue_date),
    due_date: credit ? "" : dateText(doc.due_date),
    total: moneyText(doc.total_minor, doc.currency),
    balance: credit ? "" : moneyText(doc.balance_minor, doc.currency),
    url: who.url,
    attached: who.attached ? "1" : "",
    parent_number: doc.parent_number ?? "",
    sender_name: senderNameOf(doc.issuer),
    reason:
      (doc.type === "credit_note" || doc.type === "debit_note") && doc.reason_code
        ? noteReasonWords(doc.reason_code, doc.reason_text ?? "")
        : "",
    parent_balance:
      credit && typeof doc.parent_balance_minor === "number"
        ? moneyText(doc.parent_balance_minor, doc.currency)
        : "",
  };
}

/** The reminder's kind word for the template: an invoice (tax or export), a proforma or a debit note. */
export const reminderKind = (type: string): "invoice" | "proforma" | "debit_note" =>
  type === "proforma" ? "proforma" : type === "debit_note" ? "debit_note" : "invoice";

/** `offset_days` is the number of days (never negative) and `when` says "before", "on" or "after" the due date. */
export const reminderWhen = (
  offsetDays: number,
): { offset_days: string; when: "before" | "on" | "after" } => ({
  offset_days: String(Math.abs(offsetDays)),
  when: offsetDays < 0 ? "before" : offsetDays === 0 ? "on" : "after",
});
