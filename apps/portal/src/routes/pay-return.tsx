// `/pay/return` (M6.2; POR-06, ADM-PAY-02; run file E, G6): where Razorpay sends the browser back after a payment made from an emailed link (or a link staff
// shared). It opens signed out and asks nothing: main.tsx already stripped Razorpay's query from the address and history before the first render, and nothing of
// it is read, kept or forwarded (ADR 0008: a redirect never marks anything paid; the webhook does). The page has `no-referrer` (index.html), so leaving it carries
// no address either. It says 07-ZI line 15 and offers the way to sign in, as the ended link does.
import { Link } from "react-router";
import { CheckCircle, LogIn } from "../components/icons.tsx";
import { PageTitle, TokenShell } from "../components/shell/portal-shell.tsx";
import { INV } from "../copy-invoices.ts";
import { PAY_ZI } from "../copy-zi.ts";

export function PayReturnRoute() {
  return (
    <TokenShell>
      <div className="screen screen--narrow pay-return">
        <header className="screen__head">
          <PageTitle text={INV.title} className="screen__title">
            {INV.title}
          </PageTitle>
        </header>
        <div className="pay-status" data-phase="returned">
          <CheckCircle size={24} />
          <div className="pay-status__body">
            <p>{PAY_ZI.returned}</p>
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
