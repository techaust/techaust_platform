// `/pay/return` (M6.2; POR-06, ADM-PAY-02; run file E, G6): where Razorpay sends the browser back after a payment made from an emailed link (or a link staff
// shared). It opens signed out and asks nothing: main.tsx already stripped Razorpay's query from the address and history before the first render, and nothing of
// it is read, kept or forwarded (ADR 0008: a redirect never marks anything paid; the webhook does). The page has `no-referrer` (index.html), so leaving it carries
// no address either. It says 07-ZI line 15 and offers the way to sign in, as the ended link does. M6.3: Stripe sends an emailed link's client back here too, after
// paying (`?pay=return`, line 15 serves both gateways) or after leaving Stripe's page without paying (`?pay=cancel`: 07-ZM line 5).
// M6.4 (run file G2): PayPal's return for an emailed link (`?via=paypal&c=<our checkout id>&token=…&PayerID=…`, all stripped at once): the page asks the server
// to capture that checkout (`POST /api/v1/pay/paypal/return {checkoutId, token}`, never `PayerID`) and shows its state in 07-ZN's words (lines 4 to 11, 13);
// `processing` asks again every 30 s for 5 minutes at most; `&cancelled=1` is line 7 with no call. `paid` says line 5 (6 on a proforma) with the amount this
// tab pressed for (the URL names no document); without one it says 07-ZI line 15. A 429 is the shared line for too many attempts.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { payPalReturnApi, RequestError } from "../api.ts";
import { CheckCircle, Info, LogIn } from "../components/icons.tsx";
import { type PayPhase, PayStatus } from "../components/pay/pay-status.tsx";
import { PageTitle, TokenShell } from "../components/shell/portal-shell.tsx";
import { waitText } from "../copy.ts";
import { PENDING } from "../copy-documents.ts";
import { INV } from "../copy-invoices.ts";
import { PAY_ZI } from "../copy-zi.ts";
import { PAY_ZM } from "../copy-zm.ts";
import {
  forgetPay,
  PAYPAL_POLL_FOR_MS,
  PAYPAL_POLL_MS,
  type PayPalReturnPage,
  payPalReturnOf,
  payPalReturnPage,
  payReturnPageKind,
  recalledRecentPay,
} from "../lib/pay.ts";

/** What the page shows: one of the shared phases (`returned` is 07-ZI line 15, "if your payment went through…"). */
type View = PayPhase;

/** The page's view for one answer of the return route (exported for its tests). */
export function viewOfAnswer(answer: unknown, now = Date.now()): View {
  const r = payPalReturnOf(answer);
  switch (r?.state ?? "processing") {
    case "processing":
      return { phase: "checking" };
    case "paid": {
      const press = recalledRecentPay(now);
      return press
        ? { phase: "received", amountMinor: press.amountMinor, proforma: press.proforma === true }
        : { phase: "returned" };
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
      return { phase: "returned" };
  }
}

/** A refused or failed ask: 429 the shared line, 503 07-ZN line 13; anything else (the network, our side) stays on line 4: PayPal may have captured. */
export function viewOfError(e: unknown): View {
  if (e instanceof RequestError && e.status === 429)
    return { phase: "limited", text: PENDING.linkRateLimited(waitText(e.retryAfterS)) };
  if (e instanceof RequestError && e.status === 503) return { phase: "unavailable" };
  return { phase: "checking" };
}

/** The first view, before any answer: line 7 for PayPal's cancel, line 15 when there is nothing to ask with, else line 4. */
function firstView(page: PayPalReturnPage): View {
  if (page.cancelled) return { phase: "left" };
  if (!page.checkoutId || page.malformed) return { phase: "returned" };
  return { phase: "checking" };
}

function PayPalReturn({ page }: { page: PayPalReturnPage }) {
  const [view, setView] = useState<View>(() => firstView(page));
  const asked = useRef(false);
  useEffect(() => {
    if (page.cancelled || !page.checkoutId || page.malformed || asked.current) return;
    asked.current = true;
    const { checkoutId, token } = page;
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      let next: View;
      try {
        next = viewOfAnswer(await payPalReturnApi(checkoutId, token));
      } catch (e) {
        next = viewOfError(e);
      }
      if (stopped) return;
      if (next.phase === "received") forgetPay();
      setView(next);
      // Only `processing` asks again, no faster than every 30 s, for 5 minutes at most (each ask may capture; the `p:pay:` quota is shared).
      if (next.phase === "checking" && Date.now() - started + PAYPAL_POLL_MS <= PAYPAL_POLL_FOR_MS)
        timer = setTimeout(ask, PAYPAL_POLL_MS);
    };
    void ask();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [page]);
  return <PayStatus state={view} provider="paypal" />;
}

export function PayReturnRoute() {
  const kind = payReturnPageKind();
  const page = payPalReturnPage();
  const left = kind === "cancel";
  return (
    <TokenShell>
      <div className="screen screen--narrow pay-return">
        <header className="screen__head">
          <PageTitle text={INV.title} className="screen__title">
            {INV.title}
          </PageTitle>
        </header>
        {page ? (
          <PayPalReturn page={page} />
        ) : (
          <div className="pay-status" data-phase={left ? "left" : "returned"}>
            {left ? <Info size={24} /> : <CheckCircle size={24} />}
            <div className="pay-status__body">
              <p>{left ? PAY_ZM.cancelled : PAY_ZI.returned}</p>
            </div>
          </div>
        )}
        <Link to="/" className="btn btn--secondary">
          <LogIn size={20} />
          {INV.signIn}
        </Link>
      </div>
    </TokenShell>
  );
}
