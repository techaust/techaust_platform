// M6.5 (ADM-MAIL-01 "payment received + receipt", ADM-PAY-09; run file D `onRendered(receipt)`, L5, L41): the client's email with its payment receipt, from
// billing@ (Q-P3-5) to the contacts with portal access AND "can see finance" (RB-31), sent as soon as the PDF is made (L41). The house transactional layout
// (`securityEmail`): the subject as the heading, 07-ZO line 12's sentence, then the receipt's three facts in the facts table under the PDF's own labels (07-ZO
// lines 2, 4 and 5, so the email and the attached page name things alike), and, when the PDF isn't attached, 07 §8's "Open in the portal" button (the portal's
// invoices page; the client signs in, no token in the link) with the plain link in the text twin. No greeting and no closing line: 07-ZO has neither (line 12
// opens with "Thank you."); the dark modes are the layout's. Words: `RECEIPT_EMAIL_COPY` and `RECEIPT_COPY` (`@techaust/core/copy-zo`; "[Placeholder]" until
// the owner approves 07-ZO). The words never call it a tax invoice or a voucher and make no stamp or signature claim (Researched 2026-11-03, s.31(3)(d) CGST Act
// and Rule 50 CGST Rules (08-C RA-39); OPEN (08-C RB-21): is an emailed, computer-generated receipt chargeable to stamp duty?).
//
// The data (every value a string, formatted by the jobs Worker): `number`, `amount`, `date` (the day the money arrived), `attached` ("1" with the PDF, else "0"),
// `url` (the portal's invoices page).
import { RECEIPT_COPY, RECEIPT_EMAIL_COPY } from "@techaust/core/copy-zo";
import { headerValue } from "./headers.ts";
import { type LayoutOptions, para, type Rendered, securityEmail } from "./templates.ts";

export type ReceiptSentData = { number: string; amount: string; date: string; attached: string; url: string };
/** The keys a `receipt.sent` message carries (the jobs Worker fills each; the warm-up sends the same). */
export const RECEIPT_SENT_KEYS = [
  "number",
  "amount",
  "date",
  "attached",
  "url",
] as const satisfies readonly (keyof ReceiptSentData)[];

/** 07 §8's portal button (approved; the deed email's too). */
export const RECEIPT_PORTAL_BUTTON = "Open in the portal";

/** `receipt.sent`: 07-ZO lines 11 and 12, with the receipt's facts under the PDF's labels (lines 2, 4 and 5). */
export function receiptSent(d: ReceiptSentData, opts: LayoutOptions): Rendered {
  const C = RECEIPT_EMAIL_COPY;
  const attached = d.attached === "1";
  const body = attached
    ? C.bodyAttached(d.amount, d.date, d.number)
    : C.bodyPortal(d.amount, d.date, d.number);
  const rows: [string, string][] = [
    [RECEIPT_COPY.number, d.number],
    [RECEIPT_COPY.amountReceived, d.amount],
    [RECEIPT_COPY.receivedOn, d.date],
  ];
  return securityEmail(headerValue(C.subject(d.number, d.amount)), opts, {
    before: [para(body)],
    facts: { rows, text: rows.map(([k, v]) => `${k}: ${v}`).join("\n") },
    ...(attached ? {} : { action: { label: RECEIPT_PORTAL_BUTTON, url: d.url } }),
  });
}
