// M6.5 (ADM-MAIL-01 "payment received + receipt", ADM-PAY-09; run file D `onRendered(receipt)`, L5): the client's email with its payment receipt, from billing@
// (Q-P3-5) to the contacts with portal access AND "can see finance" (RB-31). Words: 07-ZO lines 11 and 12 (`RECEIPT_EMAIL_COPY`, `@techaust/core/copy-zo`;
// "[Placeholder]" until the owner approves them). THE BUILDER'S PLAIN TEMPLATE on the house transactional layout (`securityEmail`): the designer finishes it after
// early check 2. The words never call it a tax invoice or a voucher and make no stamp or signature claim (08-C RA-39; OPEN (08-C RB-21)).
//
// The data (every value a string, formatted by the jobs Worker): `number`, `amount`, `date` (the day the money arrived), `attached` ("1" with the PDF, else "0"),
// `url` (the portal's invoices page; the client signs in, no token in it).
import { RECEIPT_EMAIL_COPY } from "@techaust/core/copy-zo";
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

/** `receipt.sent`: 07-ZO lines 11 and 12. */
export function receiptSent(d: ReceiptSentData, opts: LayoutOptions): Rendered {
  const C = RECEIPT_EMAIL_COPY;
  const body =
    d.attached === "1"
      ? C.bodyAttached(d.amount, d.date, d.number)
      : C.bodyPortal(d.amount, d.date, d.number);
  return securityEmail(headerValue(C.subject(d.number, d.amount)), opts, {
    before: [para(body)],
    ...(d.attached === "1" ? {} : { action: { label: "Open in the portal", url: d.url } }),
  });
}
