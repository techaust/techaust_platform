// Back from the gateway (M6.2, M6.3, M6.4; POR-06; run file G5, M6.4 G2): the Processing state and its ends, in 07-ZI's words (lines 10 to 13), for a card
// payment 07-ZM's (line 4 for "not yet", line 7 on a proforma), and for PayPal 07-ZN's (lines 4 to 11 and 13, by the state the server answers); and the
// cancel-return (07-ZM line 5; 07-ZN line 7 for PayPal) when the client left the gateway's page without paying. The words say "received", never "confirmed": the
// payment the page shows may still be being checked (a proforma's waits for its invoice). Announced politely (`aria-live`), one block that changes in place, so
// a screen reader hears each step once. The progress line stands still when motion is reduced. Declined by PayPal, the block carries the one way on: back to
// PayPal's own page for the same order ("Try again on PayPal"), only when the server sent that page.
import { PAY_ZI } from "../../copy-zi.ts";
import { PAY_ZM } from "../../copy-zm.ts";
import { PAY_ZN } from "../../copy-zn.ts";
import { currencyOf, isGatewayUrl, moneyText, type PayGateway } from "../../lib/pay.ts";
import { AlertTriangle, CheckCircle, Clock, Info } from "../icons.tsx";

export type PayPhase =
  | { phase: "checking" }
  | { phase: "received"; amountMinor: number; proforma: boolean }
  | { phase: "not_yet" }
  /** M6.3: back from Stripe's page without paying (`?pay=cancel`): 07-ZM line 5; M6.4: PayPal's (`?pay=paypal-cancel`, `not_completed`): 07-ZN line 7. */
  | { phase: "left" }
  /** M6.4: PayPal holds the capture (07-ZN line 10). */
  | { phase: "held" }
  /** M6.4: PayPal declined the payment method (07-ZN line 8); `retryUrl` is PayPal's own page for the same order. */
  | { phase: "declined"; retryUrl?: string }
  /** M6.4: the order expired (07-ZN line 9). */
  | { phase: "expired" }
  /** M6.4: the amount due changed since the client started (07-ZN line 11). */
  | { phase: "changed" }
  /** M6.4: PayPal can't be used right now (07-ZN line 13). */
  | { phase: "unavailable" }
  /** M6.4: the emailed link's return page with nothing more to say (no amount known, or nothing to ask with): 07-ZI line 15. */
  | { phase: "returned" }
  /** A refused ask, in the shared words the page passes (a 429). */
  | { phase: "limited"; text: string };

/** The phases that say "nothing was charged, start again" or "it's on its way": an info mark, not a tick or a warning. */
const ICONS: Record<PayPhase["phase"], "clock" | "tick" | "info" | "warn"> = {
  checking: "clock",
  received: "tick",
  not_yet: "info",
  left: "info",
  held: "clock",
  declined: "warn",
  expired: "info",
  changed: "info",
  unavailable: "warn",
  limited: "warn",
  returned: "tick",
};

function Mark({ phase }: { phase: PayPhase["phase"] }) {
  const k = ICONS[phase];
  return k === "clock" ? (
    <Clock size={24} />
  ) : k === "tick" ? (
    <CheckCircle size={24} />
  ) : k === "warn" ? (
    <AlertTriangle size={24} />
  ) : (
    <Info size={24} />
  );
}

/** The words of one phase (07-ZI, 07-ZM or 07-ZN by the gateway), as a title line and a body line. */
function wordsOf(state: PayPhase, provider: PayGateway): { title?: string; body?: string } {
  const amount = (m: number) => moneyText(m, currencyOf(provider));
  switch (state.phase) {
    case "checking":
      return { title: PAY_ZI.checking, body: PAY_ZI.checkingBody };
    case "received":
      return {
        title: state.proforma
          ? provider === "razorpay"
            ? PAY_ZI.receivedProforma(amount(state.amountMinor))
            : // 07-ZM line 7 is 07-ZN line 6 (a USD proforma, card or PayPal)
              PAY_ZM.receivedProforma(amount(state.amountMinor))
          : PAY_ZI.received(amount(state.amountMinor)),
      };
    case "left":
      return { body: provider === "paypal" ? PAY_ZN.notCompleted : PAY_ZM.cancelled };
    case "not_yet":
      return {
        body: provider === "paypal" ? PAY_ZN.pending : provider === "stripe" ? PAY_ZM.notYet : PAY_ZI.notYet,
      };
    case "held":
      return { body: PAY_ZN.pending };
    case "declined":
      return { body: PAY_ZN.declined };
    case "expired":
      return { body: PAY_ZN.expired };
    case "changed":
      return { body: PAY_ZN.changed };
    case "unavailable":
      return { body: PAY_ZN.unavailable };
    case "limited":
      return { body: state.text };
    case "returned":
      return { body: PAY_ZI.returned };
  }
}

export function PayStatus({ state, provider = "razorpay" }: { state: PayPhase; provider?: PayGateway }) {
  const w = wordsOf(state, provider);
  // The button back to PayPal is drawn only for PayPal's own page (the server checked it; the browser checks again before offering it).
  const retry =
    state.phase === "declined" && state.retryUrl && isGatewayUrl("paypal", state.retryUrl)
      ? state.retryUrl
      : null;
  return (
    <div
      className="pay-status"
      role="status"
      aria-live="polite"
      data-phase={state.phase}
      data-tone={ICONS[state.phase]}
    >
      <Mark phase={state.phase} />
      <div className="pay-status__body">
        {w.title && <p className="pay-status__title">{w.title}</p>}
        {w.body && <p>{w.body}</p>}
        {state.phase === "checking" && <span className="pay-status__bar" aria-hidden="true" />}
        {retry && (
          <p className="pay-status__act">
            <a className="btn btn--primary" href={retry} rel="noreferrer">
              {PAY_ZN.tryAgain}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
