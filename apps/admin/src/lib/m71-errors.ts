// M7.1: the admin's refusals of a notice dismiss, a record from a notice and a request close, worded from the code (never the server's message). Its own module
// so the shell, which imports lib/copy-zp.ts for the navigation's count, never carries the payment screens' words.
import { RequestError } from "../api.ts";
import { ZP_UI } from "./copy-zp.ts";
import { payErrorText } from "./payments.ts";

/** S1: a notice that doesn't match the payment, when there is no invoice row to point at. */
export const NOTICE_MISMATCH_TEXT =
  "This notice is for another client, currency or invoice. Record the payment on the notice's own invoice.";

/**
 * A dismiss or close refused, by its code (the shared payment and document words for every other code). `onRow`: the text goes under the invoice row the
 * refusal names, the only place S8 ("this invoice") reads true.
 */
export function m71ErrorText(e: unknown, opts: { onRow?: boolean } = {}): string {
  if (e instanceof RequestError) {
    if (e.code === "notice_closed")
      return "This notice was already recorded or dismissed. The list shows it as it is now.";
    if (e.code === "notice_mismatch")
      // S8 (review M2): the payment isn't put on the notice's invoice (`details.reason: "document"`, read by api.ts into `extra.reason`), shown only under
      // that invoice's row; with no row (re-check 5: the invoice was paid or voided since the notice), S1's line
      return e.extra.reason === "document" && opts.onRow === true
        ? ZP_UI.noticeOnDocument
        : NOTICE_MISMATCH_TEXT;
    if (e.code === "request_closed")
      return "This request was already closed. The list shows it as it is now.";
    if (e.status === 403) return ZP_UI.ownerOnly;
  }
  return payErrorText(e);
}
