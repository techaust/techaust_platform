// Pay now (M6.2; POR-06, ADM-PAY-02, ADM-PAY-12; run file G5): the button on an invoice the client can pay online, the amount dialog (the full amount due, or a
// part of at least the minimum, typed the Indian way; whole rupees on a proforma), and "Continue to Razorpay", which asks the server for a payment link and sends
// the browser to Razorpay's own page. No card or bank field exists here or anywhere in the portal (ADM-PAY-12). Words: 07-ZI lines 1 to 9 and 14, word for word.
// Back from Razorpay, the page shows the Processing state (pay-status.tsx); nothing is ever marked paid by the return itself (ADR 0008).
import { useId, useRef, useState } from "react";
import { type PayLink, RequestError } from "../../api.ts";
import { COPY } from "../../copy.ts";
import { PAY_ZI } from "../../copy-zi.ts";
import { inr, isRazorpayUrl, partAmount, rememberPay } from "../../lib/pay.ts";
import { Modal } from "../dialog.tsx";
import { Lock } from "../icons.tsx";
import { FieldError, Notice } from "../ui.tsx";

type Props = {
  documentId: string;
  balanceMinor: number;
  /** The smallest part payment; null while the server doesn't send it (then only the full amount is offered). */
  minimumMinor: number | null;
  wholeRupees: boolean;
  /** When the newest online payment the page shows was received (null: none), remembered at the press (review finding 5). */
  lastPaidAt: number | null;
  /** Makes the link (the session's route or the emailed link's). */
  pay: (amountMinor: number) => Promise<PayLink>;
  /** Leaves for Razorpay (the page's `location.assign`; a test passes its own). */
  leave?: (url: string) => void;
};

/** The button, and its dialog. */
export function PayNow(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--primary pay-now" onClick={() => setOpen(true)}>
        {PAY_ZI.payNow}
      </button>
      <Modal open={open} title={PAY_ZI.howMuch} onClose={() => setOpen(false)}>
        {open && <AmountForm {...props} onCancel={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function AmountForm(props: Props & { onCancel: () => void }) {
  const id = useId();
  // A part is offered only when the minimum is known and below the balance (otherwise the full amount is the only amount).
  const canPart = props.minimumMinor !== null && props.minimumMinor < props.balanceMinor;
  const [choice, setChoice] = useState<"full" | "part">("full");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const full = inr(props.balanceMinor);
  const minimum = props.minimumMinor !== null ? inr(props.minimumMinor) : "";

  async function submit() {
    setFailure(null);
    let amountMinor = props.balanceMinor;
    if (choice === "part" && props.minimumMinor !== null) {
      const r = partAmount(text, {
        minimumMinor: props.minimumMinor,
        balanceMinor: props.balanceMinor,
        wholeRupees: props.wholeRupees,
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
      if (!isRazorpayUrl(link.shortUrl)) throw new RequestError(502, "gateway_error", PAY_ZI.unavailable);
      rememberPay(props.documentId, amountMinor, props.lastPaidAt);
      (props.leave ?? ((u: string) => window.location.assign(u)))(link.shortUrl);
      // the page is leaving: the button stays busy
    } catch (e) {
      setBusy(false);
      // The amount's own refusals (lines 6 and 7, in the server's words) go under the field; everything else is line 14.
      if (
        e instanceof RequestError &&
        e.status === 400 &&
        e.code.startsWith("amount_") &&
        choice === "part"
      ) {
        setError(e.message || PAY_ZI.between(minimum, full));
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

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="dialog__body pay-form">
        {canPart ? (
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
            {choice === "part" && (
              <div className="field pay-part">
                <label htmlFor={`${id}-part`} className="visually-hidden">
                  {PAY_ZI.part(minimum)}
                </label>
                <p className="hint" id={`${id}-hint`}>
                  {PAY_ZI.between(minimum, full)}
                </p>
                <div className="pay-part__in">
                  <span aria-hidden="true">₹</span>
                  <input
                    ref={input}
                    id={`${id}-part`}
                    inputMode={props.wholeRupees ? "numeric" : "decimal"}
                    autoComplete="off"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
                    aria-invalid={error ? true : undefined}
                  />
                </div>
                {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
              </div>
            )}
          </fieldset>
        ) : (
          <p className="pay-full">{PAY_ZI.full(full)}</p>
        )}
        <p className="pay-how">
          <Lock size={16} />
          <span>{PAY_ZI.howItWorks}</span>
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
          {PAY_ZI.continue}
        </button>
      </div>
    </form>
  );
}
