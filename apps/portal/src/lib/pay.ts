// Pay now and Pay by card in the portal (M6.2, M6.3; POR-06, ADM-PAY-02, ADM-PAY-12; run files E, G5, G6): the pure rules of the amount dialog, the return
// from the gateway's page and the Processing state. The server decides everything again (the finance Worker's `createLink`); these checks only save a round
// trip and say it in 07-ZI's and 07-ZM's words. Amounts are minor units read and compared through core (`parseMoney`, `compare`); nothing here adds money up.
import { istDate, toIsoDate } from "@techaust/core/dates";
import { isGatewayLinkUrl, type LinkHostGateway } from "@techaust/core/gateway-rpc";
import { compare, formatMoney, money, parseMoney } from "@techaust/core/money";
import { RequestError } from "../api.ts";
import type { PayPhase } from "../components/pay/pay-status.tsx";
import { PAY_ZI } from "../copy-zi.ts";
import { PAY_ZM } from "../copy-zm.ts";
import { PAY_ZN } from "../copy-zn.ts";

/**
 * The gateways the portal's screens send a client to (M6.3: Stripe for USD documents, Razorpay for INR; M6.4: PayPal beside Stripe on a USD document, in the
 * server's `providers` order).
 */
export type PayGateway = LinkHostGateway;
const GATEWAYS: readonly PayGateway[] = ["razorpay", "stripe", "paypal"];
export const isPayGateway = (v: unknown): v is PayGateway => (GATEWAYS as readonly unknown[]).includes(v);

/**
 * The ways a document may be paid, in the order the page offers them: the server's `providers` (M6.4: `["stripe", "paypal"]` for USD), only gateways the
 * portal knows, each once; an older API sends none, and then the one gateway of `provider` (or of the currency).
 */
export function payWaysOf(d: {
  providers?: readonly unknown[] | undefined;
  provider?: PayGateway | null | undefined;
  currency: string;
}): PayGateway[] {
  const listed = (d.providers ?? []).filter(isPayGateway);
  if (listed.length > 0) return [...new Set(listed)];
  return [d.provider ?? (d.currency === "USD" ? "stripe" : "razorpay")];
}
export type PayCurrency = "INR" | "USD";

export const inr = (minor: number) => formatMoney(money(minor, "INR"));
/** An amount in the document's own currency (en-IN rupees, en-US dollars), through core. */
export const moneyText = (minor: number, currency: PayCurrency) => formatMoney(money(minor, currency));
/** The gateway's currency (Stripe and PayPal take US dollars, Razorpay rupees; M6.4 L23: every gateway by name). */
export const currencyOf = (gateway: LinkHostGateway): PayCurrency =>
  gateway === "stripe" || gateway === "paypal" ? "USD" : "INR";

/**
 * The part amount as typed (en-IN "12,500" or "₹12,500.50"; en-US "1,250" or "$1,250.50") against the minimum, the balance and, on a card payment, the most
 * one payment may be (`maximumMinor`, L9). The error is 07-ZI line 5, 6 or 7 (line 5 with the maximum as its top above the maximum: the dialog says 07-ZM
 * line 6 over the field).
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
  // Above the maximum the dialog already says 07-ZM line 6 over the field, so the field's own error is 07-ZI line 5 with the maximum as its top (never the
  // same sentence twice).
  if (compare(m, money(top, cur)) > 0)
    return { ok: false, error: PAY_ZI.between(show(a.minimumMinor), show(top)) };
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

/**
 * How the client came back: after paying (`?pay=return`), or by leaving Stripe's page without paying (`?pay=cancel`, M6.3); M6.4: from PayPal's page after
 * approving (`?pay=paypal&c=<checkout id>`: the page asks the server to capture THAT checkout) or by leaving it (`?pay=paypal-cancel`: 07-ZN line 7, no call).
 */
export type PayReturnKind = "return" | "cancel" | "paypal" | "paypal-cancel";
/** What the page keeps of a return: the kind, and for PayPal our own checkout id (never PayPal's `token` or `PayerID` on the signed-in page). */
export type PayReturn = { kind: PayReturnKind; checkoutId?: string };

/** Our checkout ids are UUIDs (`c` on PayPal's return; the server answers 400 to anything else, so nothing else is sent). */
const CHECKOUT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** PayPal's order id as its return carries it (`token`): the shape the return route accepts. */
const PAYPAL_TOKEN = /^[A-Z0-9]{1,36}$/;

/**
 * The signed-out return page after PayPal (`/pay/return?via=paypal&c=…&token=…&PayerID=…`, or `…&cancelled=1`): our checkout id and PayPal's `token` (its
 * order id), kept in memory for the one POST that asks the server to capture (the token only ever in that body; `PayerID` is never read). `token` is null when
 * PayPal sent none; `malformed` when it sent something that isn't an order id (then nothing is asked).
 */
export type PayPalReturnPage =
  | { cancelled: true }
  | { cancelled: false; checkoutId: string | null; token: string | null; malformed: boolean };

let returnedTo: { id: string; ret: PayReturn } | null = null;
let returnPage: PayReturnKind = "return";
let payPalPage: PayPalReturnPage | null = null;

/**
 * FIRST, before anything renders (main.tsx): the gateway sends the browser back with a query (Razorpay's `razorpay_payment_id`, `razorpay_signature`, …; our own
 * `pay=return` or `pay=cancel` from Stripe; M6.4: our `pay=paypal&c=…` or `via=paypal&c=…` with PayPal's `token` and `PayerID`). Strip it from the address bar
 * and history at once, read nothing but our own words (and, on the signed-out page, PayPal's `token` for the capture's body), never forward it (ADR 0008:
 * nothing is marked paid on a redirect), and remember only that this page is a return: `/invoices/:id?pay=…` (signed in) keeps the invoice's id (and PayPal's
 * checkout id) for the Processing state, 07-ZM line 5 or 07-ZN's states; `/pay/return` keeps which it was.
 */
export function capturePayReturn(loc: Pick<Location, "pathname" | "search" | "hash"> = location): void {
  if (!loc.search) return;
  const invoice = /^\/invoices\/([^/]+)$/.exec(loc.pathname);
  const q = new URLSearchParams(loc.search);
  const pay = q.get("pay");
  const kind: PayReturnKind | null =
    pay === "return" || pay === "cancel" || pay === "paypal" || pay === "paypal-cancel" ? pay : null;
  if (loc.pathname !== PAY_RETURN_PATH && !(invoice && kind)) return;
  history.replaceState(history.state, "", loc.pathname);
  const c = q.get("c");
  const checkoutId = c !== null && CHECKOUT_ID.test(c) ? c : null;
  if (invoice && kind) {
    // A PayPal return without our checkout id can't name what to capture: the page opens as usual (its waiting state still shows from the server's facts).
    if (kind === "paypal" && !checkoutId) return;
    returnedTo = {
      id: decodeURIComponent(invoice[1] as string),
      ret: kind === "paypal" && checkoutId ? { kind, checkoutId } : { kind },
    };
  }
  if (loc.pathname === PAY_RETURN_PATH) {
    if (q.get("via") === "paypal") {
      returnPage = q.get("cancelled") === "1" ? "paypal-cancel" : "paypal";
      const token = q.get("token");
      payPalPage =
        returnPage === "paypal-cancel"
          ? { cancelled: true }
          : {
              cancelled: false,
              checkoutId,
              token: token !== null && PAYPAL_TOKEN.test(token) ? token : null,
              malformed: token !== null && !PAYPAL_TOKEN.test(token),
            };
    } else returnPage = kind === "cancel" ? "cancel" : "return";
  }
}

/** Whether this page load came back from the gateway for this invoice, and how (read once: a later visit to the same page is not a return). */
export function takePayReturn(documentId: string): PayReturn | null {
  if (returnedTo?.id !== documentId) return null;
  const ret = returnedTo.ret;
  returnedTo = null;
  return ret;
}

/** How the signed-out return page was reached (M6.3: for the emailed link, Stripe's cancel comes back there too; M6.4: PayPal's return and cancel). */
export const payReturnPageKind = (): PayReturnKind => returnPage;
/** M6.4: what PayPal's return to the signed-out page carried (null unless `via=paypal`). */
export const payPalReturnPage = (): PayPalReturnPage | null => payPalPage;

/** Test-only. */
export const _setReturned = (id: string | null, kind: PayReturnKind = "return", checkoutId?: string) => {
  returnedTo = id === null ? null : { id, ret: checkoutId ? { kind, checkoutId } : { kind } };
};
/** Test-only. */
export const _resetPayReturnPage = () => {
  returnPage = "return";
  payPalPage = null;
};

const KEY = "ta.pay";

/** What this tab remembers of a press of "Continue to Razorpay" (or "Continue to Stripe"): the document, the amount, when, and the newest online payment the page showed then. */
export type PayPress = { amountMinor: number; at: number; seenAt: number | null; proforma?: boolean };

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
  proforma = false,
): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ documentId, amountMinor, at, seenAt, proforma }));
  } catch {
    // Private mode: no press is remembered, so the Processing state ends on 07-ZI line 13 (never "received").
  }
}

/** A press as the page reads it (`proforma` only when it was one). */
const pressOf = (v: PayPress): PayPress => ({
  amountMinor: v.amountMinor,
  at: v.at,
  seenAt: v.seenAt,
  ...(v.proforma === true ? { proforma: true } : {}),
});

function readPress(): (PayPress & { documentId: unknown }) | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as {
      documentId?: unknown;
      amountMinor?: unknown;
      at?: unknown;
      seenAt?: unknown;
      proforma?: unknown;
    } | null;
    return v &&
      typeof v.at === "number" &&
      typeof v.amountMinor === "number" &&
      (v.seenAt === null || typeof v.seenAt === "number")
      ? {
          documentId: v.documentId,
          amountMinor: v.amountMinor,
          at: v.at,
          seenAt: v.seenAt,
          proforma: v.proforma === true,
        }
      : null;
  } catch {
    return null;
  }
}

export function recalledPay(documentId: string): PayPress | null {
  const v = readPress();
  return v && v.documentId === documentId ? pressOf(v) : null;
}

/** A PayPal checkout lasts at most two and a half hours (L5): an older press in this tab is not the one this return is about. */
export const PAYPAL_PRESS_MS = 150 * 60_000;

/**
 * M6.4: the signed-out return page doesn't know the document (its URL carries only our checkout id), so it reads this tab's last press, whatever its document,
 * if it was made within a PayPal checkout's life: its amount says 07-ZN line 5 (line 6 on a proforma) once the server answers `paid`. None: the page says
 * 07-ZI line 15 instead (never an amount it doesn't know).
 */
export function recalledRecentPay(now = Date.now()): PayPress | null {
  const v = readPress();
  return v && now - v.at >= 0 && now - v.at <= PAYPAL_PRESS_MS ? pressOf(v) : null;
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
 * M6.4 (early check 2, "Designer must know" 2 and 3): back from PayPal, each ask may capture, and the return shares the `p:pay:` quota (20 per 10 minutes), so the
 * page asks again only while the answer is `processing` (07-ZN line 4), no faster than every 30 s, and stops after 5 minutes (the line stays: the invoice shows
 * the payment once it's confirmed). Every other state is an end: no more asks.
 */
export const PAYPAL_POLL_MS = 30_000;
export const PAYPAL_POLL_FOR_MS = 5 * 60_000;

/** The states PayPal's return answers (core `CAPTURE_RETURN_STATES`); the page reads only these. */
export const PAYPAL_RETURN_STATES = [
  "paid",
  "processing",
  "pending",
  "declined",
  "not_completed",
  "expired",
  "changed",
  "not_found",
] as const;
export type PayPalReturnState = (typeof PAYPAL_RETURN_STATES)[number];
export type PayPalReturn = { state: PayPalReturnState; retryUrl?: string };

/** An answer's `payPalReturn` as the page may use it: a known state, and `retryUrl` kept only with `declined` and only on PayPal's own hosts. */
export function payPalReturnOf(v: unknown): PayPalReturn | null {
  if (typeof v !== "object" || v === null) return null;
  const state: unknown = Reflect.get(v, "state");
  if (!(PAYPAL_RETURN_STATES as readonly unknown[]).includes(state)) return null;
  const retryUrl: unknown = Reflect.get(v, "retryUrl");
  return state === "declined" && typeof retryUrl === "string" && isGatewayLinkUrl("paypal", retryUrl)
    ? { state, retryUrl }
    : { state: state as PayPalReturnState };
}

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

/**
 * M6.4 (run file G2): the signed-in page's words for PayPal's answer (07-ZN lines 4 to 11), or null for none: `processing` is line 4 (the page asks again),
 * `paid` line 5 (6 on a proforma) with an amount the page knows (the newest PayPal payment, else this tab's press; neither: no block, the summary shows the
 * payment), `not_found` nothing (the page as usual). No `payPalReturn` in the answer (the server's call failed or answered wrongly): line 4, never "pay another
 * way" (early check 2 finding 1).
 */
export function payPalPhaseOf(
  r: PayPalReturn | null,
  doc: {
    id: string;
    type: string;
    online?: { lastPaid?: { amountMinor: number; provider?: string | null } | null } | undefined;
  },
): PayPhase | null {
  const state = r?.state ?? "processing";
  switch (state) {
    case "processing":
      return { phase: "checking" };
    case "paid": {
      const last = doc.online?.lastPaid;
      const amountMinor =
        last && last.provider === "paypal" ? last.amountMinor : (recalledPay(doc.id)?.amountMinor ?? null);
      return amountMinor === null
        ? null
        : { phase: "received", amountMinor, proforma: doc.type === "proforma" };
    }
    case "pending":
      return { phase: "held" };
    case "declined":
      return r?.retryUrl ? { phase: "declined", retryUrl: r.retryUrl } : { phase: "declined" };
    case "not_completed":
      return { phase: "left" };
    case "expired":
      return { phase: "expired" };
    case "changed":
      return { phase: "changed" };
    case "not_found":
      return null;
  }
}

/**
 * M6.4 review 2 finding 7: one read of the document back from PayPal. The read that names the checkout (`?c=`) counts against the client's pay quota, so a
 * quota refusal (429) is never the page's failure: the document is read plainly instead (`asked: false`), the page stays on 07-ZN line 4 and the next ask
 * names the checkout again. Any other failure is the read's own.
 */
export async function readPayPalReturn<T>(
  ask: () => Promise<T>,
  plain: () => Promise<T>,
): Promise<{ answer: T; asked: boolean }> {
  try {
    return { answer: await ask(), asked: true };
  } catch (e) {
    if (e instanceof RequestError && e.status === 429) return { answer: await plain(), asked: false };
    throw e;
  }
}

/**
 * The address of "Try again on PayPal" (07-ZN line 8), or null when the block draws no such button: only on a declined return, and only for PayPal's own page
 * (the server checked it; the browser checks again). While it shows, it is the page's one primary action (review 2 finding 10).
 */
export function payPalRetryOf(state: PayPhase | null): string | null {
  return state?.phase === "declined" && state.retryUrl && isGatewayUrl("paypal", state.retryUrl)
    ? state.retryUrl
    : null;
}

/** The online block's facts the page reads to name a gateway (M6.4: `open.provider`, `lastPaid.provider`, `pendingPayPal`; absent from an older API). */
type OnlineFacts = {
  open?: { provider?: string | null } | null;
  lastPaid?: { provider?: string | null } | null;
  pendingPayPal?: boolean;
};

/**
 * M6.4: whose words say a payment still waits on the document (`paymentPending`: 07-ZI line 13, 07-ZM line 4 or 07-ZN line 10): PayPal when it holds a capture;
 * else the gateway of the open checkout (a claimed PayPal order is still live); else the gateway of the newest online payment (a waiting one is the newest);
 * else the document's own gateway.
 */
export function waitingGatewayOf(online: OnlineFacts | undefined, fallback: PayGateway): PayGateway {
  if (online?.pendingPayPal === true) return "paypal";
  const open = online?.open?.provider;
  if (isPayGateway(open)) return open;
  const paid = online?.lastPaid?.provider;
  return isPayGateway(paid) ? paid : fallback;
}

/** The gateway of the newest online payment the page shows (`lastPaid.provider`), or the document's own gateway when the server names none. */
export const paidGatewayOf = (online: OnlineFacts | undefined, fallback: PayGateway): PayGateway => {
  const paid = online?.lastPaid?.provider;
  return isPayGateway(paid) ? paid : fallback;
};

/** An instant as the IST day (`YYYY-MM-DD`), for 07-ZI line 16's and 07-ZM line 8's date. */
export const istDayOf = (ms: number) => toIsoDate(istDate(ms));

/**
 * The slip's paid row, under the figures (M6.2 07-ZI line 16, M6.3 07-ZM line 8, M6.4 07-ZN line 14), or null: on a proforma whose online payment waits for
 * its invoice, "…; invoice to follow" in the words of the gateway it came through (`lastPaid.provider`); on any other document whose newest online payment came
 * through PayPal, "Paid by PayPal on {date}" (not while a payment still waits: the waiting block says that). `date` writes the IST day as the page does.
 */
export function paidRowOf(
  d: {
    type: string;
    currency: string;
    provider?: PayGateway | null;
    online?:
      | (OnlineFacts & {
          lastPaid?: { at: number; provider?: string | null } | null;
          proformaPending?: boolean;
          paymentPending?: boolean;
        })
      | undefined;
  },
  date: (iso: string) => string,
): { text: string; waits: boolean } | null {
  const last = d.online?.lastPaid;
  if (!last || d.type === "credit_note") return null;
  const day = date(istDayOf(last.at));
  const own: PayGateway = d.provider ?? (d.currency === "USD" ? "stripe" : "razorpay");
  if (d.type === "proforma" && d.online?.proformaPending === true) {
    const by = paidGatewayOf(d.online, own);
    return {
      text:
        by === "paypal"
          ? PAY_ZN.paidProforma(day)
          : by === "stripe"
            ? PAY_ZM.proformaPaid(day)
            : PAY_ZI.proformaPaid(day),
      waits: true,
    };
  }
  if (last.provider === "paypal" && d.online?.paymentPending !== true)
    return { text: PAY_ZN.paid(day), waits: false };
  return null;
}

/**
 * M6.2 line approved by the owner (2026-11-03, M6.5 run file "Owner's answers"): the "How to pay" bank-transfer box shows only while nothing waits on a gateway
 * payment, so a client whose card or PayPal payment is still being processed isn't invited to pay the same amount again by bank transfer (no new wording).
 */
export function showsBankTransfer(
  online: { paymentPending?: boolean; pendingPayPal?: boolean } | null | undefined,
): boolean {
  return online?.paymentPending !== true && online?.pendingPayPal !== true;
}
