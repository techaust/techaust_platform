// `/pay/return` (M6.2; POR-06, ADM-PAY-02; run file E, G6): where Razorpay sends the browser back after a payment made from an emailed link (or a link staff
// shared). It opens signed out and asks nothing: main.tsx already stripped Razorpay's query from the address and history before the first render, and nothing of
// it is read, kept or forwarded (ADR 0008: a redirect never marks anything paid; the webhook does). The page has `no-referrer` (index.html), so leaving it carries
// no address either. It says 07-ZI line 15 and offers the way to sign in, as the ended link does. M6.3: Stripe sends an emailed link's client back here too, after
// paying (`?pay=return`, line 15 serves both gateways) or after leaving Stripe's page without paying (`?pay=cancel`: 07-ZM line 5).
import { Link } from "react-router";
import { CheckCircle, Info, LogIn } from "../components/icons.tsx";
import { PageTitle, TokenShell } from "../components/shell/portal-shell.tsx";
import { INV } from "../copy-invoices.ts";
import { PAY_ZI } from "../copy-zi.ts";
import { PAY_ZM } from "../copy-zm.ts";
import { payReturnPageKind } from "../lib/pay.ts";

export function PayReturnRoute() {
  const left = payReturnPageKind() === "cancel";
  return (
    <TokenShell>
      <div className="screen screen--narrow pay-return">
        <header className="screen__head">
          <PageTitle text={INV.title} className="screen__title">
            {INV.title}
          </PageTitle>
        </header>
        <div className="pay-status" data-phase={left ? "left" : "returned"}>
          {left ? <Info size={24} /> : <CheckCircle size={24} />}
          <div className="pay-status__body">
            <p>{left ? PAY_ZM.cancelled : PAY_ZI.returned}</p>
          </div>
        </div>
        <Link to="/" className="btn btn--secondary">
          <LogIn size={20} />
          {INV.signIn}
        </Link>
      </div>
    </TokenShell>
  );
}
