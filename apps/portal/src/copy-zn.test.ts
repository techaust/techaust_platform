// 07-ZN (POR-06, M6.4): the portal's client lines 1 to 14 word for word with docs/07-content-appendix/ZN-m6.4-paypal.md (read here, so a change to the page
// that isn't made in the code fails); the chooser's order; PayPal's return read from the address (stripped at once; `token` kept only for the signed-out
// page's POST body, `PayerID` never), the answer's states and the page's words for them; the slip's paid row; the dialog's and the status block's markup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import znPage from "../../../docs/07-content-appendix/ZN-m6.4-paypal.md?raw";
import { RequestError } from "./api.ts";
import { PayStatus } from "./components/pay/pay-status.tsx";
import { PENDING } from "./copy-documents.ts";
import { PAY_ZI } from "./copy-zi.ts";
import { PAY_ZM } from "./copy-zm.ts";
import { PAY_ZN } from "./copy-zn.ts";
import { dateText } from "./lib/offers.ts";
import {
  _resetPayReturnPage,
  capturePayReturn,
  PAYPAL_POLL_FOR_MS,
  PAYPAL_POLL_MS,
  PAYPAL_PRESS_MS,
  paidRowOf,
  payPalPhaseOf,
  payPalReturnOf,
  payPalReturnPage,
  payReturnPageKind,
  payWaysOf,
  recalledRecentPay,
  rememberPay,
  takePayReturn,
  waitingGatewayOf,
} from "./lib/pay.ts";
import paySource from "./lib/pay.ts?raw";
import { viewOfAnswer, viewOfError } from "./routes/pay-return.tsx";
import returnSource from "./routes/pay-return.tsx?raw";

/** The quoted texts of 07-ZN's numbered client line `n` (before the staff section). */
function quoted(n: number): string[] {
  const client = znPage.split("## Staff lines")[0] as string;
  const line = client.split("\n").find((l) => l.startsWith(`${n}. `));
  if (!line) throw new Error(`07-ZN has no line ${n}`);
  return [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

const C = "0195f000-0000-7000-8000-000000000004";
const RETRY = "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T";

/** A history and a session store for one test (the pool has neither). */
function withBrowser(run: (replaced: string[], store: Map<string, string>) => void) {
  const g = globalThis as { history?: unknown; sessionStorage?: unknown };
  const had = [g.history, g.sessionStorage] as const;
  const replaced: string[] = [];
  const store = new Map<string, string>();
  g.history = { state: null, replaceState: (_s: unknown, _t: string, u: string) => replaced.push(u) };
  g.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  try {
    run(replaced, store);
  } finally {
    [g.history, g.sessionStorage] = had;
    _resetPayReturnPage();
  }
}

describe("07-ZN client lines [POR-06, M6.4]", () => {
  it("are approved by the owner", () => {
    expect(znPage).toContain("client lines 1–15 APPROVED by the owner, 2026-11-02");
  });

  it("1 to 14, word for word (4, 5, 6 and 12 are the lines approved before)", () => {
    expect([PAY_ZN.payWithPayPal]).toEqual(quoted(1));
    expect([PAY_ZN.continue]).toEqual(quoted(2));
    expect([PAY_ZN.howItWorks]).toEqual(quoted(3));
    expect([PAY_ZN.checking, PAY_ZN.checkingBody]).toEqual(quoted(4));
    expect([PAY_ZN.received("{amount}")]).toEqual(quoted(5));
    expect([PAY_ZN.receivedProforma("{amount}")]).toEqual(quoted(6));
    expect([PAY_ZN.notCompleted]).toEqual(quoted(7));
    expect([PAY_ZN.declined, PAY_ZN.tryAgain]).toEqual(quoted(8));
    expect([PAY_ZN.expired]).toEqual(quoted(9));
    expect([PAY_ZN.pending]).toEqual(quoted(10));
    expect([PAY_ZN.changed]).toEqual(quoted(11));
    expect([PAY_ZN.maximum("{maximum}")]).toEqual(quoted(12));
    expect([PAY_ZN.unavailable]).toEqual(quoted(13));
    expect([PAY_ZN.paid("{date}"), PAY_ZN.paidProforma("{date}")]).toEqual(quoted(14));
    // the reused ones are the same constants as before, not copies
    expect(PAY_ZN.checking).toBe(PAY_ZI.checking);
    expect(PAY_ZN.receivedProforma("$1.00")).toBe(PAY_ZM.receivedProforma("$1.00"));
  });
});

describe("Pay with PayPal: the chooser and the dialog [POR-06, M6.4 G1]", () => {
  it("offers the server's providers in its order, the gateways the portal knows, once each; an older API: the one gateway", () => {
    expect(payWaysOf({ providers: ["stripe", "paypal"], provider: "stripe", currency: "USD" })).toEqual([
      "stripe",
      "paypal",
    ]);
    expect(payWaysOf({ providers: ["paypal", "stripe", "paypal", "bitcoin"], currency: "USD" })).toEqual([
      "paypal",
      "stripe",
    ]);
    expect(payWaysOf({ providers: ["razorpay"], currency: "INR" })).toEqual(["razorpay"]);
    expect(payWaysOf({ currency: "USD" })).toEqual(["stripe"]);
    expect(payWaysOf({ providers: [], provider: null, currency: "INR" })).toEqual(["razorpay"]);
  });
  // The drawn chooser (one primary way, the next stepped back, no card or bank field) is checked in the browser (hooks don't render in this pool).
});

describe("back from PayPal: the address [POR-06, M6.4 G2]", () => {
  it("signed in: `pay=paypal&c=…` keeps our checkout id; `c`, `token` and `PayerID` leave the address at once", () => {
    withBrowser((replaced) => {
      capturePayReturn({
        pathname: "/invoices/doc-7",
        search: `?pay=paypal&c=${C}&token=5O190127TN364715T&PayerID=QYR5Z8XDVJNXQ`,
        hash: "",
      });
      expect(replaced).toEqual(["/invoices/doc-7"]);
      expect(takePayReturn("doc-7")).toEqual({ kind: "paypal", checkoutId: C });
      expect(takePayReturn("doc-7")).toBeNull();
      capturePayReturn({
        pathname: "/invoices/doc-7",
        search: `?pay=paypal-cancel&c=${C}&token=X1`,
        hash: "",
      });
      expect(takePayReturn("doc-7")).toEqual({ kind: "paypal-cancel" });
      // a malformed or missing `c`: stripped, but nothing to capture, so not a return
      capturePayReturn({ pathname: "/invoices/doc-7", search: "?pay=paypal&c=../x&token=X1", hash: "" });
      expect(takePayReturn("doc-7")).toBeNull();
      expect(replaced).toEqual(["/invoices/doc-7", "/invoices/doc-7", "/invoices/doc-7"]);
    });
  });

  it("the emailed link's page: our id and PayPal's order id for the POST body, never `PayerID`; `cancelled=1` asks nothing", () => {
    withBrowser((replaced) => {
      capturePayReturn({
        pathname: "/pay/return",
        search: `?via=paypal&c=${C}&token=5O190127TN364715T&PayerID=QYR5Z8XDVJNXQ`,
        hash: "",
      });
      expect(replaced).toEqual(["/pay/return"]);
      expect(payReturnPageKind()).toBe("paypal");
      expect(payPalReturnPage()).toEqual({
        cancelled: false,
        checkoutId: C,
        token: "5O190127TN364715T",
        malformed: false,
      });
      expect(JSON.stringify(payPalReturnPage())).not.toContain("QYR5Z8XDVJNXQ");
      capturePayReturn({ pathname: "/pay/return", search: `?via=paypal&c=${C}&cancelled=1`, hash: "" });
      expect(payReturnPageKind()).toBe("paypal-cancel");
      expect(payPalReturnPage()).toEqual({ cancelled: true });
      capturePayReturn({ pathname: "/pay/return", search: `?via=paypal&c=${C}&token=bad token`, hash: "" });
      expect(payPalReturnPage()).toMatchObject({ token: null, malformed: true });
      capturePayReturn({ pathname: "/pay/return", search: `?via=paypal&c=${C}`, hash: "" });
      expect(payPalReturnPage()).toMatchObject({ checkoutId: C, token: null, malformed: false });
      // Razorpay's and Stripe's returns there are as before
      capturePayReturn({ pathname: "/pay/return", search: "?pay=cancel", hash: "" });
      expect(payReturnPageKind()).toBe("cancel");
    });
    // `PayerID` is never read anywhere in the portal's screens
    expect(paySource).not.toMatch(/get\("PayerID"\)/);
    expect(returnSource).not.toMatch(/get\("PayerID"\)|PayerID:/);
  });

  it("asks again every 30 s at most, for 5 minutes", () => {
    expect(PAYPAL_POLL_MS).toBeGreaterThanOrEqual(30_000);
    expect(PAYPAL_POLL_FOR_MS).toBe(300_000);
    expect(PAYPAL_PRESS_MS).toBe(150 * 60_000);
  });
});

describe("back from PayPal: the answer and its words [POR-06, M6.4 G2]", () => {
  it("reads a known state; `retryUrl` only with `declined` and only on PayPal's hosts", () => {
    expect(payPalReturnOf({ state: "declined", retryUrl: RETRY })).toEqual({
      state: "declined",
      retryUrl: RETRY,
    });
    expect(payPalReturnOf({ state: "declined", retryUrl: "https://evil.example/checkoutnow" })).toEqual({
      state: "declined",
    });
    expect(payPalReturnOf({ state: "paid", retryUrl: RETRY })).toEqual({ state: "paid" });
    expect(payPalReturnOf({ state: "refunded" })).toBeNull();
    expect(payPalReturnOf(undefined)).toBeNull();
  });

  it("signed in: each state's phase; none in the answer is line 4 (never 'pay another way'); paid needs an amount the page knows", () => {
    const doc = { id: "doc-7", type: "export_invoice", online: { lastPaid: null } };
    expect(payPalPhaseOf(null, doc)).toEqual({ phase: "checking" });
    expect(payPalPhaseOf({ state: "processing" }, doc)).toEqual({ phase: "checking" });
    expect(payPalPhaseOf({ state: "pending" }, doc)).toEqual({ phase: "held" });
    expect(payPalPhaseOf({ state: "declined", retryUrl: RETRY }, doc)).toEqual({
      phase: "declined",
      retryUrl: RETRY,
    });
    expect(payPalPhaseOf({ state: "declined" }, doc)).toEqual({ phase: "declined" });
    expect(payPalPhaseOf({ state: "not_completed" }, doc)).toEqual({ phase: "left" });
    expect(payPalPhaseOf({ state: "expired" }, doc)).toEqual({ phase: "expired" });
    expect(payPalPhaseOf({ state: "changed" }, doc)).toEqual({ phase: "changed" });
    expect(payPalPhaseOf({ state: "not_found" }, doc)).toBeNull();
    // paid: the newest PayPal payment the answer shows; else this tab's press; else no block
    withBrowser(() => {
      expect(payPalPhaseOf({ state: "paid" }, doc)).toBeNull();
      rememberPay("doc-7", 500_00, null);
      expect(payPalPhaseOf({ state: "paid" }, doc)).toEqual({
        phase: "received",
        amountMinor: 500_00,
        proforma: false,
      });
      expect(
        payPalPhaseOf(
          { state: "paid" },
          {
            id: "doc-7",
            type: "proforma",
            online: { lastPaid: { amountMinor: 1_200_00, provider: "paypal" } },
          },
        ),
      ).toEqual({ phase: "received", amountMinor: 1_200_00, proforma: true });
    });
  });

  it("the emailed link's page: the same states; paid with this tab's recent press, else 07-ZI line 15; 429 the shared line, 503 line 13", () => {
    withBrowser(() => {
      expect(viewOfAnswer({ state: "processing" })).toEqual({ phase: "checking" });
      expect(viewOfAnswer({ nonsense: true })).toEqual({ phase: "checking" });
      expect(viewOfAnswer({ state: "paid" })).toEqual({ phase: "returned" });
      expect(viewOfAnswer({ state: "not_found" })).toEqual({ phase: "returned" });
      const now = 10_000_000;
      rememberPay("doc-9", 1_200_00, null, now - 60_000, true);
      expect(viewOfAnswer({ state: "paid" }, now)).toEqual({
        phase: "received",
        amountMinor: 1_200_00,
        proforma: true,
      });
      // older than a PayPal checkout's life: not this one
      expect(viewOfAnswer({ state: "paid" }, now + PAYPAL_PRESS_MS)).toEqual({ phase: "returned" });
      expect(recalledRecentPay(now - 120_000)).toBeNull();
      expect(viewOfAnswer({ state: "declined", retryUrl: RETRY })).toEqual({
        phase: "declined",
        retryUrl: RETRY,
      });
      expect(viewOfAnswer({ state: "pending" })).toEqual({ phase: "held" });
      expect(viewOfAnswer({ state: "not_completed" })).toEqual({ phase: "left" });
      expect(viewOfAnswer({ state: "expired" })).toEqual({ phase: "expired" });
      expect(viewOfAnswer({ state: "changed" })).toEqual({ phase: "changed" });
    });
    expect(viewOfError(new RequestError(429, "rate_limited", "x", null, 540))).toEqual({
      phase: "limited",
      text: PENDING.linkRateLimited("9 minutes"),
    });
    expect(viewOfError(new RequestError(503, "gateway_unavailable", PAY_ZN.unavailable))).toEqual({
      phase: "unavailable",
    });
    // the network or our side: PayPal may have captured, so line 4, and the page asks again
    expect(viewOfError(new RequestError(0, "network", "network"))).toEqual({ phase: "checking" });
    expect(viewOfError(new RequestError(500, "server", ""))).toEqual({ phase: "checking" });
  });

  it("the status block says each state in 07-ZN's words, politely; the way back to PayPal only for PayPal's own page", () => {
    const html = (state: Parameters<typeof PayStatus>[0]["state"]) =>
      renderToStaticMarkup(createElement(PayStatus, { state, provider: "paypal" }));
    const esc = (s: string) => s.replaceAll("'", "&#x27;");
    expect(html({ phase: "checking" })).toContain(esc(PAY_ZN.checkingBody));
    expect(html({ phase: "checking" })).toMatch(/role="status" aria-live="polite"/);
    expect(html({ phase: "received", amountMinor: 1_000_00, proforma: false })).toContain(
      esc(PAY_ZN.received("$1,000.00")),
    );
    expect(html({ phase: "received", amountMinor: 1_000_00, proforma: true })).toContain(
      esc(PAY_ZN.receivedProforma("$1,000.00")),
    );
    expect(html({ phase: "left" })).toContain(esc(PAY_ZN.notCompleted));
    expect(html({ phase: "held" })).toContain(esc(PAY_ZN.pending));
    expect(html({ phase: "not_yet" })).toContain(esc(PAY_ZN.pending));
    expect(html({ phase: "expired" })).toContain(esc(PAY_ZN.expired));
    expect(html({ phase: "changed" })).toContain(esc(PAY_ZN.changed));
    expect(html({ phase: "unavailable" })).toContain(esc(PAY_ZN.unavailable));
    expect(html({ phase: "returned" })).toContain(esc(PAY_ZI.returned));
    const declined = html({ phase: "declined", retryUrl: RETRY });
    expect(declined).toContain(esc(PAY_ZN.declined));
    expect(declined).toContain(`href="${RETRY}"`);
    expect(declined).toContain(PAY_ZN.tryAgain);
    expect(html({ phase: "declined" })).not.toContain(PAY_ZN.tryAgain);
    expect(html({ phase: "declined", retryUrl: "https://paypal.com.evil.example/x" })).not.toContain(
      PAY_ZN.tryAgain,
    );
  });
});

describe("the gateway named by the page [POR-06, M6.4]", () => {
  it("a waiting payment speaks for PayPal when it holds one, else the open checkout's, else the newest payment's, else the document's", () => {
    expect(waitingGatewayOf({ pendingPayPal: true, open: { provider: "stripe" } }, "stripe")).toBe("paypal");
    expect(
      waitingGatewayOf({ open: { provider: "paypal" }, lastPaid: { provider: "stripe" } }, "stripe"),
    ).toBe("paypal");
    expect(waitingGatewayOf({ open: null, lastPaid: { provider: "stripe" } }, "stripe")).toBe("stripe");
    expect(waitingGatewayOf({ open: { provider: "unknown" }, lastPaid: null }, "razorpay")).toBe("razorpay");
    expect(waitingGatewayOf(undefined, "stripe")).toBe("stripe");
  });

  it("the slip's row: '…; invoice to follow' by the paying gateway on a proforma; 'Paid by PayPal on {date}' otherwise; none while a payment waits", () => {
    const at = Date.UTC(2026, 10, 3, 8, 35);
    const day = dateText("2026-11-03");
    const usd = { currency: "USD", provider: "stripe" as const };
    expect(
      paidRowOf(
        { ...usd, type: "proforma", online: { proformaPending: true, lastPaid: { at, provider: "paypal" } } },
        dateText,
      ),
    ).toEqual({ text: PAY_ZN.paidProforma(day), waits: true });
    expect(
      paidRowOf(
        { ...usd, type: "proforma", online: { proformaPending: true, lastPaid: { at, provider: "stripe" } } },
        dateText,
      ),
    ).toEqual({ text: PAY_ZM.proformaPaid(day), waits: true });
    // an older API: no provider on the payment, the document's gateway
    expect(
      paidRowOf(
        {
          currency: "INR",
          provider: "razorpay",
          type: "proforma",
          online: { proformaPending: true, lastPaid: { at } },
        },
        dateText,
      ),
    ).toEqual({ text: PAY_ZI.proformaPaid(day), waits: true });
    expect(
      paidRowOf(
        { ...usd, type: "export_invoice", online: { lastPaid: { at, provider: "paypal" } } },
        dateText,
      ),
    ).toEqual({ text: PAY_ZN.paid(day), waits: false });
    expect(
      paidRowOf(
        {
          ...usd,
          type: "export_invoice",
          online: { paymentPending: true, lastPaid: { at, provider: "paypal" } },
        },
        dateText,
      ),
    ).toBeNull();
    expect(
      paidRowOf(
        { ...usd, type: "export_invoice", online: { lastPaid: { at, provider: "stripe" } } },
        dateText,
      ),
    ).toBeNull();
    expect(paidRowOf({ ...usd, type: "export_invoice", online: { lastPaid: null } }, dateText)).toBeNull();
  });
});
