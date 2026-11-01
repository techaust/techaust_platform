// Back from the gateway (M6.2, M6.3; POR-06; run file G5): the Processing state and its three ends, in 07-ZI's words (lines 10 to 13), and for a card payment
// 07-ZM's (line 4 for "not yet", line 7 on a proforma); and the cancel-return (07-ZM line 5) when the client left Stripe's page without paying. The page asks the
// server every 3 s for up to a minute (and once, at 20 s, asks it to check with the gateway); this only shows where that stands. The words say "received", never
// "confirmed": the payment the page shows may still be being checked (a proforma's waits for its tax invoice). Announced politely (`aria-live`), one block that
// changes in place, so a screen reader hears each step once. The progress line stands still when motion is reduced.
import { PAY_ZI } from "../../copy-zi.ts";
import { PAY_ZM } from "../../copy-zm.ts";
import { currencyOf, moneyText, type PayGateway } from "../../lib/pay.ts";
import { CheckCircle, Clock, Info } from "../icons.tsx";

export type PayPhase =
  | { phase: "checking" }
  | { phase: "received"; amountMinor: number; proforma: boolean }
  | { phase: "not_yet" }
  /** M6.3: back from Stripe's page without paying (`?pay=cancel`): 07-ZM line 5; Pay by card stays offered. */
  | { phase: "left" };

export function PayStatus({ state, provider = "razorpay" }: { state: PayPhase; provider?: PayGateway }) {
  const stripe = provider === "stripe";
  const amount = (m: number) => moneyText(m, currencyOf(provider));
  return (
    <div className="pay-status" role="status" aria-live="polite" data-phase={state.phase}>
      {state.phase === "checking" ? (
        <>
          <Clock size={24} />
          <div className="pay-status__body">
            <p className="pay-status__title">{PAY_ZI.checking}</p>
            <p>{PAY_ZI.checkingBody}</p>
            <span className="pay-status__bar" aria-hidden="true" />
          </div>
        </>
      ) : state.phase === "received" ? (
        <>
          <CheckCircle size={24} />
          <div className="pay-status__body">
            <p className="pay-status__title">
              {state.proforma
                ? stripe
                  ? PAY_ZM.receivedProforma(amount(state.amountMinor))
                  : PAY_ZI.receivedProforma(amount(state.amountMinor))
                : PAY_ZI.received(amount(state.amountMinor))}
            </p>
          </div>
        </>
      ) : state.phase === "left" ? (
        <>
          <Info size={24} />
          <div className="pay-status__body">
            <p>{PAY_ZM.cancelled}</p>
          </div>
        </>
      ) : (
        <>
          <Info size={24} />
          <div className="pay-status__body">
            <p>{stripe ? PAY_ZM.notYet : PAY_ZI.notYet}</p>
          </div>
        </>
      )}
    </div>
  );
}
