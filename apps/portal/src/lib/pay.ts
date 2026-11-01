// Pay now and Pay by card in the portal (M6.2, M6.3; POR-06, ADM-PAY-02, ADM-PAY-12; run files E, G5, G6): the pure rules of the amount dialog, the return
// from the gateway's page and the Processing state. The server decides everything again (the finance Worker's `createLink`); these checks only save a round
// trip and say it in 07-ZI's and 07-ZM's words. Amounts are minor units read and compared through core (`parseMoney`, `compare`); nothing here adds money up.
import { istDate, toIsoDate } from "@techaust/core/dates";
import { isGatewayLinkUrl, type LinkHostGateway } from "@techaust/core/gateway-rpc";
import { compare, formatMoney, money, parseMoney } from "@techaust/core/money";
import { PAY_ZI } from "../copy-zi.ts";
import { PAY_ZM } from "../copy-zm.ts";

/** The gateways the portal sends a client to (M6.3: Stripe for USD documents, Razorpay for INR). */
export type PayGateway = LinkHostGateway;
export type PayCurrency = "INR" | "USD";

export const inr = (minor: number) => formatMoney(money(minor, "INR"));
/** An amount in the document's own currency (en-IN rupees, en-US dollars), through core. */
export const moneyText = (minor: number, currency: PayCurrency) => formatMoney(money(minor, currency));
/** The gateway's currency (Stripe takes US dollars, Razorpay rupees). */
export const currencyOf = (gateway: PayGateway): PayCurrency => (gateway === "stripe" ? "USD" : "INR");

/**
 * The part amount as typed (en-IN "12,500" or "₹12,500.50"; en-US "1,250" or "$1,250.50") against the minimum, the balance and, on a card payment, the most
 * one payment may be (`maximumMinor`, L9). The error is 07-ZI line 5, 6 or 7, or 07-ZM line 6 above the maximum.
 */
export function partAmount(
  text: string,
  a: {
    minimumMinor: number;
    balanceMinor: number;
    wholeRupees: boolean;
    currency?: PayCurrency;
    maximumMinor?: number | null;
  },
): { ok: true; minor: number } | { ok: false; error: string } {
  const cur = a.currency ?? "INR";
  const show = (m: number) => moneyText(m, cur);
  const top = upperOf(a.balanceMinor, a.maximumMinor);
  const r = parseMoney(text, cur);
  if (!r.ok || r.value.amount <= 0)
    return { ok: false, error: PAY_ZI.between(show(a.minimumMinor), show(top)) };
  const m = r.value;
  if (compare(m, money(a.balanceMinor, cur)) > 0)
    return { ok: false, error: PAY_ZI.tooMuch(show(a.balanceMinor)) };
  if (compare(m, money(top, cur)) > 0) return { ok: false, error: PAY_ZM.maximum(show(top)) };
  if (compare(m, money(a.minimumMinor, cur)) < 0)
    return { ok: false, error: PAY_ZI.atLeast(show(a.minimumMinor)) };
  if (a.wholeRupees && m.amount % 100 !== 0) return { ok: false, error: PAY_ZI.wholeRupees };
  return { ok: true, minor: m.amount };
}

/** The most the client may pay now: the balance, or the online maximum when that is lower (L9; none for Razorpay). Compared as integers, never summed. */
export const upperOf = (balanceMinor: number, maximumMinor: number | null | undefined): number =>
  maximumMinor !== undefined && maximumMinor !== null && maximumMinor < balanceMinor
    ? maximumMinor
    : balanceMinor;

/**
 * The gateway's own hosts over https (the server checks the same before answering; the browser checks again before it leaves). One check and one host list for
 * the portal's Worker, its screens and the finance Worker (`isGatewayLinkUrl` in `@techaust/core/gateway-rpc`; M6.2 review finding 12).
 */
export const isGatewayUrl = (gateway: PayGateway, v: string): boolean => isGatewayLinkUrl(gateway, v);
export const isRazorpayUrl = (v: string): boolean => isGatewayUrl("razorpay", v);

// ---- back from the gateway's page -----------------------------------------------------------------------------------------------------------------------

/** The signed-out return page (the emailed link's and a staff link's `callback_url`; for the emailed link, Stripe's `success_url` and `cancel_url` too). */
export const PAY_RETURN_PATH = "/pay/return";

/** How the client came back: after paying (`?pay=return`), or by leaving Stripe's page without paying (`?pay=cancel`, M6.3). */
export type PayReturnKind = "return" | "cancel";

let returnedTo: { id: string; kind: PayReturnKind } | null = null;
let returnPage: PayReturnKind = "return";

/**
 * FIRST, before anything renders (main.tsx): the gateway sends the browser back with a query (Razorpay's `razorpay_payment_id`, `razorpay_signature`, …; our own
 * `pay=return` or `pay=cancel` from Stripe). Strip it from the address bar and history at once, read nothing but our own `pay` word, never forward it (ADR 0008:
 * nothing is marked paid on a redirect), and remember only that this page is a return: `/invoices/:id?pay=return|cancel` (signed in) keeps the invoice's id for
 * the Processing state or 07-ZM line 5; `/pay/return` keeps only which of the two it was.
 */
export function capturePayReturn(loc: Pick<Location, "pathname" | "search" | "hash"> = location): void {
  if (!loc.search) return;
  const invoice = /^\/invoices\/([^/]+)$/.exec(loc.pathname);
  const pay = new URLSearchParams(loc.search).get("pay");
  const kind: PayReturnKind | null = pay === "return" ? "return" : pay === "cancel" ? "cancel" : null;
  if (loc.pathname === PAY_RETURN_PATH || (invoice && kind)) {
    history.replaceState(history.state, "", loc.pathname);
    if (invoice && kind) returnedTo = { id: decodeURIComponent(invoice[1] as string), kind };
    if (loc.pathname === PAY_RETURN_PATH) returnPage = kind ?? "return";
  }
}

/** Whether this page load came back from the gateway for this invoice, and how (read once: a later visit to the same page is not a return). */
export function takePayReturn(documentId: string): PayReturnKind | null {
  if (returnedTo?.id !== documentId) return null;
  const kind = returnedTo.kind;
  returnedTo = null;
  return kind;
}

/** How the signed-out return page was reached (M6.3: for the emailed link, Stripe's cancel comes back there too). */
export const payReturnPageKind = (): PayReturnKind => returnPage;

/** Test-only. */
export const _setReturned = (id: string | null, kind: PayReturnKind = "return") => {
  returnedTo = id === null ? null : { id, kind };
};

const KEY = "ta.pay";

/** What this tab remembers of a press of "Continue to Razorpay" (or "Continue to Stripe"): the document, the amount, when, and the newest online payment the page showed then. */
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

/** Processing asks every 3 s for up to a minute, and once at 20 s asks the server to check with the gateway (`?refresh=1`; run file E). */
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

/** An instant as the IST day (`YYYY-MM-DD`), for 07-ZI line 16's and 07-ZM line 8's date. */
export const istDayOf = (ms: number) => toIsoDate(istDate(ms));
