// Pay now and Pay by card (M6.2, M6.3; POR-06, ADM-PAY-02, ADM-PAY-12; run files G5): the button on an invoice the client can pay online, the amount dialog
// (the full amount due, or a part of at least the minimum; typed the Indian way in rupees, whole rupees on a proforma; en-US dollars with cents on a card
// payment, never above the online maximum), and "Continue to Razorpay" or "Continue to Stripe", which asks the server for the gateway's page and sends the
// browser there. No card or bank field exists here or anywhere in the portal (ADM-PAY-12). Words: 07-ZI lines 1 to 9 and 14; 07-ZM lines 1 to 3 and 6 for a
// card payment; word for word. Back from the gateway, the page shows the Processing state (pay-status.tsx); nothing is ever marked paid by the return itself
// (ADR 0008).
import { useId, useRef, useState } from "react";
import { type PayLink, RequestError } from "../../api.ts";
import { COPY } from "../../copy.ts";
import { PAY_ZI } from "../../copy-zi.ts";
import { PAY_ZM } from "../../copy-zm.ts";
import {
  currencyOf,
  isGatewayUrl,
  moneyText,
  type PayGateway,
  partAmount,
  rememberPay,
  upperOf,
} from "../../lib/pay.ts";
import { Modal } from "../dialog.tsx";
import { Lock } from "../icons.tsx";
import { FieldError, Notice } from "../ui.tsx";

/** The words that differ by gateway (07-ZI lines 1, 8, 9; 07-ZM lines 1, 2, 3). Everything else is 07-ZI's currency-neutral lines. */
const WORDS: Record<PayGateway, { button: string; go: string; how: string; sign: string }> = {
  razorpay: { button: PAY_ZI.payNow, go: PAY_ZI.continue, how: PAY_ZI.howItWorks, sign: "₹" },
  stripe: { button: PAY_ZM.payByCard, go: PAY_ZM.continue, how: PAY_ZM.howItWorks, sign: "$" },
};

type Props = {
  documentId: string;
  /** The gateway of the document's currency (M6.3: Stripe for USD, Razorpay for INR). */
  provider: PayGateway;
  balanceMinor: number;
  /** The smallest part payment; null while the server doesn't send it (then only the full amount is offered). */
  minimumMinor: number | null;
  /** M6.3 (L9): the most one card payment may be; null when there is none (Razorpay). */
  maximumMinor: number | null;
  wholeRupees: boolean;
  /** When the newest online payment the page shows was received (null: none), remembered at the press (review finding 5). */
  lastPaidAt: number | null;
  /** Makes the gateway's page (the session's route or the emailed link's). */
  pay: (amountMinor: number) => Promise<PayLink>;
  /** Leaves for the gateway (the page's `location.assign`; a test passes its own). */
  leave?: (url: string) => void;
};

/** The button, and its dialog. */
export function PayNow(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--primary pay-now" onClick={() => setOpen(true)}>
        {WORDS[props.provider].button}
      </button>
      <Modal open={open} title={PAY_ZI.howMuch} onClose={() => setOpen(false)}>
        {open && <AmountForm {...props} onCancel={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function AmountForm(props: Props & { onCancel: () => void }) {
  const id = useId();
  const words = WORDS[props.provider];
  const currency = currencyOf(props.provider);
  const show = (m: number) => moneyText(m, currency);
  // M6.3 (L9): above the online maximum the full amount can't be paid at once; the most is the maximum (07-ZM line 6 says so first).
  const top = upperOf(props.balanceMinor, props.maximumMinor);
  const capped = top < props.balanceMinor;
  // A part is offered only when the minimum is known and below the most that can be paid now (otherwise that amount is the only one).
  const canPart = props.minimumMinor !== null && props.minimumMinor < top;
  const [choice, setChoice] = useState<"full" | "part">(capped && canPart ? "part" : "full");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const full = show(props.balanceMinor);
  const minimum = props.minimumMinor !== null ? show(props.minimumMinor) : "";

  async function submit() {
    setFailure(null);
    let amountMinor = top;
    if (choice === "part" && props.minimumMinor !== null) {
      const r = partAmount(text, {
        minimumMinor: props.minimumMinor,
        balanceMinor: props.balanceMinor,
        wholeRupees: props.wholeRupees,
        currency,
        maximumMinor: props.maximumMinor,
      });
      if (!r.ok) {
        setError(r.error);
        input.current?.focus();
        return;
      }
      amountMinor = r.minor;
    }
    setError(null);
    setBusy(true);
    try {
      const link = await props.pay(amountMinor);
      // The server checked the address; the browser checks again before it leaves (a wrong answer never sends a client elsewhere).
      if (!isGatewayUrl(props.provider, link.url))
        throw new RequestError(502, "gateway_error", PAY_ZI.unavailable);
      rememberPay(props.documentId, amountMinor, props.lastPaidAt);
      (props.leave ?? ((u: string) => window.location.assign(u)))(link.url);
      // the page is leaving: the button stays busy
    } catch (e) {
      setBusy(false);
      // The amount's own refusals (07-ZI lines 6 and 7, 07-ZM line 6, in the server's words) go under the field; everything else is line 14 (or the server's
      // own line, 07-ZM line 4 for a payment still being confirmed).
      if (
        e instanceof RequestError &&
        e.status === 400 &&
        e.code.startsWith("amount_") &&
        choice === "part"
      ) {
        setError(e.message || PAY_ZI.between(minimum, show(top)));
        input.current?.focus();
        return;
      }
      setFailure(
        e instanceof RequestError && e.code === "network"
          ? COPY.network
          : e instanceof RequestError && e.message
            ? e.message
            : PAY_ZI.unavailable,
      );
      requestAnimationFrame(() => failureRef.current?.focus());
    }
  }

  const partField = (
    <div className={capped ? "field pay-part pay-part--alone" : "field pay-part"}>
      <label htmlFor={`${id}-part`} className={capped ? "pay-part__label" : "visually-hidden"}>
        {PAY_ZI.part(minimum)}
      </label>
      <p className="hint" id={`${id}-hint`}>
        {PAY_ZI.between(minimum, show(top))}
      </p>
      <div className="pay-part__in">
        <span aria-hidden="true">{words.sign}</span>
        <input
          ref={input}
          id={`${id}-part`}
          inputMode={props.wholeRupees ? "numeric" : "decimal"}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={`${id}-hint${capped ? ` ${id}-max` : ""}${error ? ` ${id}-error` : ""}`}
          aria-invalid={error ? true : undefined}
        />
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="dialog__body pay-form">
        {capped && (
          <p className="pay-max" id={`${id}-max`}>
            {PAY_ZM.maximum(show(top))}
          </p>
        )}
        {capped ? (
          canPart ? (
            partField
          ) : (
            <p className="pay-full tnum">{show(top)}</p>
          )
        ) : canPart ? (
          <fieldset className="radios pay-choices">
            <legend className="visually-hidden">{PAY_ZI.howMuch}</legend>
            <label className="radio">
              <input
                type="radio"
                name={`${id}-amount`}
                checked={choice === "full"}
                onChange={() => {
                  setChoice("full");
                  setError(null);
                }}
              />
              <span>{PAY_ZI.full(full)}</span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name={`${id}-amount`}
                checked={choice === "part"}
                onChange={() => {
                  setChoice("part");
                  requestAnimationFrame(() => input.current?.focus());
                }}
              />
              <span>{PAY_ZI.part(minimum)}</span>
            </label>
            {choice === "part" && partField}
          </fieldset>
        ) : (
          <p className="pay-full">{PAY_ZI.full(full)}</p>
        )}
        <p className="pay-how">
          <Lock size={16} />
          <span>{words.how}</span>
        </p>
      </div>
      {failure && (
        <div ref={failureRef} tabIndex={-1} className="pay-failure">
          <Notice tone="error">{failure}</Notice>
        </div>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onCancel} disabled={busy}>
          {COPY.home.cancel}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {words.go}
        </button>
      </div>
    </form>
  );
}
