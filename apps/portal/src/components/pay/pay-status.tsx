// Back from Razorpay (M6.2; POR-06; run file G5): the Processing state and its three ends, in 07-ZI's words (lines 10 to 13), and line 16 on a proforma. The
// page asks the server every 3 s for up to a minute (and once, at 20 s, asks it to check with Razorpay); this only shows where that stands. The words say
// "received", never "confirmed": the payment the page shows may still be being checked (a proforma's waits for its tax invoice). Announced politely
// (`aria-live`), one block that changes in place, so a screen reader hears each step once. The progress line stands still when motion is reduced.
import { PAY_ZI } from "../../copy-zi.ts";
import { inr } from "../../lib/pay.ts";
import { CheckCircle, Clock, Info } from "../icons.tsx";

export type PayPhase =
  | { phase: "checking" }
  | { phase: "received"; amountMinor: number; proforma: boolean }
  | { phase: "not_yet" };

export function PayStatus({ state }: { state: PayPhase }) {
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
                ? PAY_ZI.receivedProforma(inr(state.amountMinor))
                : PAY_ZI.received(inr(state.amountMinor))}
            </p>
          </div>
        </>
      ) : (
        <>
          <Info size={24} />
          <div className="pay-status__body">
            <p>{PAY_ZI.notYet}</p>
          </div>
        </>
      )}
    </div>
  );
}
