// Pay now in the portal (M6.2; POR-06, ADM-PAY-02, ADM-PAY-12; run file E, G5, G6): the pure rules of the amount dialog, the return from Razorpay and the
// Processing state. The server decides everything again (the finance Worker's `createLink`); these checks only save a round trip and say it in 07-ZI's words.
// Amounts are minor units read and compared through core (`parseMoney`, `compare`); nothing here adds money up.
import { istDate, toIsoDate } from "@techaust/core/dates";
import { isGatewayLinkUrl } from "@techaust/core/gateway-rpc";
import { compare, formatMoney, money, parseMoney } from "@techaust/core/money";
import { PAY_ZI } from "../copy-zi.ts";

export const inr = (minor: number) => formatMoney(money(minor, "INR"));

/** The part amount as typed (en-IN, "12,500" or "₹12,500.50") against the minimum and the balance; the error is 07-ZI line 5, 6 or 7. */
export function partAmount(
  text: string,
  a: { minimumMinor: number; balanceMinor: number; wholeRupees: boolean },
): { ok: true; minor: number } | { ok: false; error: string } {
  const r = parseMoney(text, "INR");
  if (!r.ok || r.value.amount <= 0)
    return { ok: false, error: PAY_ZI.between(inr(a.minimumMinor), inr(a.balanceMinor)) };
  const m = r.value;
  if (compare(m, money(a.balanceMinor, "INR")) > 0)
    return { ok: false, error: PAY_ZI.tooMuch(inr(a.balanceMinor)) };
  if (compare(m, money(a.minimumMinor, "INR")) < 0)
    return { ok: false, error: PAY_ZI.atLeast(inr(a.minimumMinor)) };
  if (a.wholeRupees && m.amount % 100 !== 0) return { ok: false, error: PAY_ZI.wholeRupees };
  return { ok: true, minor: m.amount };
}

/**
 * Razorpay's own hosts over https (the server checks the same before answering; the browser checks again before it leaves). One check and one host list for the
 * portal's Worker, its screens and the finance Worker (`isGatewayLinkUrl` in `@techaust/core/gateway-rpc`; M6.2 review finding 12).
 */
export const isRazorpayUrl = (v: string): boolean => isGatewayLinkUrl("razorpay", v);

// ---- back from Razorpay ---------------------------------------------------------------------------------------------------------------------------------

/** The signed-out return page (the emailed link's and a staff link's `callback_url`). */
export const PAY_RETURN_PATH = "/pay/return";

let returnedTo: string | null = null;

/**
 * FIRST, before anything renders (main.tsx): Razorpay sends the browser back with its own query (`razorpay_payment_id`, `razorpay_signature`, …). Strip it from the
 * address bar and history at once, never read or forward it (ADR 0008: nothing is marked paid on a redirect), and remember only that this page is a return:
 * `/invoices/:id?pay=return` (signed in) keeps the invoice's id for the Processing state; `/pay/return` keeps nothing.
 */
export function capturePayReturn(loc: Pick<Location, "pathname" | "search" | "hash"> = location): void {
  if (!loc.search) return;
  const invoice = /^\/invoices\/([^/]+)$/.exec(loc.pathname);
  const isReturn = new URLSearchParams(loc.search).get("pay") === "return";
  if (loc.pathname === PAY_RETURN_PATH || (invoice && isReturn)) {
    history.replaceState(history.state, "", loc.pathname);
    if (invoice && isReturn) returnedTo = decodeURIComponent(invoice[1] as string);
  }
}

/** Whether this page load came back from Razorpay for this invoice (read once: a later visit to the same page is not a return). */
export function takePayReturn(documentId: string): boolean {
  if (returnedTo !== documentId) return false;
  returnedTo = null;
  return true;
}

/** Test-only. */
export const _setReturned = (id: string | null) => {
  returnedTo = id;
};

const KEY = "ta.pay";

/** What this tab remembers of a press of "Continue to Razorpay": the document, the amount, when, and the newest online payment the page showed then. */
export type PayPress = { amountMinor: number; at: number; seenAt: number | null };

/**
 * When "Continue to Razorpay" was pressed, for which document and how much, and the time of the newest online payment the page showed then (`seenAt`, null when
 * it showed none), in this tab only (no token, nothing about the payer). The Processing state counts only a payment newer than `seenAt` as this one (review
 * finding 5: an earlier payment is never "the one just made").
 */
export function rememberPay(
  documentId: string,
  amountMinor: number,
  seenAt: number | null,
  at = Date.now(),
): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ documentId, amountMinor, at, seenAt }));
  } catch {
    // Private mode: no press is remembered, so the Processing state ends on 07-ZI line 13 (never "received").
  }
}

export function recalledPay(documentId: string): PayPress | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as {
      documentId?: unknown;
      amountMinor?: unknown;
      at?: unknown;
      seenAt?: unknown;
    } | null;
    return v &&
      v.documentId === documentId &&
      typeof v.at === "number" &&
      typeof v.amountMinor === "number" &&
      (v.seenAt === null || typeof v.seenAt === "number")
      ? { amountMinor: v.amountMinor, at: v.at, seenAt: v.seenAt }
      : null;
  } catch {
    return null;
  }
}

export const forgetPay = () => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
};

/** Processing asks every 3 s for up to a minute, and once at 20 s asks the server to check with Razorpay (`?refresh=1`; run file E). */
export const POLL_MS = 3_000;
export const POLL_FOR_MS = 60_000;
export const REFRESH_AT_MS = 20_000;

/**
 * The payment received online that this return is about, if the page shows one yet (review finding 5): only with a press remembered in this tab, and only a
 * payment newer than the newest one the page showed at the press (any, when it showed none). Without a remembered press nothing counts: the Processing state
 * ends on 07-ZI line 13, never "received" for a payment made earlier.
 */
export function receivedAfter(
  lastPaid: { amountMinor: number; at: number } | null | undefined,
  press: Pick<PayPress, "seenAt"> | null,
): { amountMinor: number; at: number } | null {
  if (!press || !lastPaid) return null;
  return press.seenAt === null || lastPaid.at > press.seenAt ? lastPaid : null;
}

/** An instant as the IST day (`YYYY-MM-DD`), for line 16's date. */
export const istDayOf = (ms: number) => toIsoDate(istDate(ms));
