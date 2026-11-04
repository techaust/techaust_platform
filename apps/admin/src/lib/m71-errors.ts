// M7.1: the admin's refusals of a notice dismiss, a record from a notice and a request close, worded from the code (never the server's message). Its own module
// so the shell, which imports lib/copy-zp.ts for the navigation's count, never carries the payment screens' words.
import { RequestError } from "../api.ts";
import { ZP_UI } from "./copy-zp.ts";
import { payErrorText } from "./payments.ts";

/** A dismiss or close refused, by its code (the shared payment and document words for every other code). */
export function m71ErrorText(e: unknown): string {
  if (e instanceof RequestError) {
    if (e.code === "notice_closed")
      return "This notice was already recorded or dismissed. The list shows it as it is now.";
    if (e.code === "notice_mismatch")
      return "This notice is for another client, currency or invoice. Record the payment on the notice's own invoice.";
    if (e.code === "request_closed")
      return "This request was already closed. The list shows it as it is now.";
    if (e.status === 403) return ZP_UI.ownerOnly;
  }
  return payErrorText(e);
}
