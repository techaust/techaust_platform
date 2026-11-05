// "Send receipt again" (M7.2; ADM-PAY-09; run file C.2, G7; Tier A ground: client email recipients): the receipt email again to 1 to 5 of the client's contacts,
// at once (a manual send, Q48). Only a contact with portal access AND "Can see finance" can get it (RB-31): the others are listed with why not, and an address
// whose emails are stopped is listed with the reason (the email would be skipped). The server is the check (every rule in its INSERT's WHERE); its 409
// `recipient_invalid` marks the contacts it refused. The client's contacts come from the client page's own read.
import { type FormEvent, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { api, type ContactView, RequestError } from "../../api.ts";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { Send } from "../../components/icons.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { ZQ_UI, zqErrorText } from "../../lib/copy-zq.ts";
import { invoiceRecipientChoices, MAX_RECIPIENTS } from "../../lib/invoice-send.ts";
import { m72Api } from "../../lib/m72-api.ts";
import "../../documents.css";

/** The refusals of the receipt itself, not of a contact (review 1, finding 5): the dialog can only be closed after one. */
export const RECEIPT_STOPS: ReadonlySet<string> = new Set([
  "receipt_refunded",
  "receipt_void",
  "client_anonymised",
]);

type Loaded =
  | { state: "loading" }
  | { state: "failed"; error: unknown }
  | { state: "ready"; contacts: ContactView[] };

export function ReceiptSendDialog(props: {
  receiptId: string;
  number: string;
  clientId: string;
  onClose: () => void;
  onDone: (toast: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // A refusal of the receipt itself (refunded in full, voided, the client anonymised): nothing in the form can change it, so it shows above the contacts,
  // takes focus, and the send button goes (review 1, finding 5).
  const [stopped, setStopped] = useState<string | null>(null);
  const refusal = useRefusalFocus();
  const groupId = useId();
  const { clientId } = props;

  useEffect(() => {
    let alive = true;
    api.client(clientId).then(
      (page) => {
        if (!alive) return;
        setPicked(new Set(invoiceRecipientChoices(page.contacts).ticked));
        setLoaded({ state: "ready", contacts: page.contacts });
      },
      (e: unknown) => alive && setLoaded({ state: "failed", error: e }),
    );
    return () => {
      alive = false;
    };
  }, [clientId]);

  const choices = loaded.state === "ready" ? invoiceRecipientChoices(loaded.contacts).choices : [];
  const noneCan = loaded.state === "ready" && !choices.some((c) => c.block === null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || loaded.state !== "ready") return;
    if (picked.size === 0) {
      setError(ZQ_UI.sendReceiptChooseOne);
      document.getElementById(`${groupId}-0`)?.focus();
      return;
    }
    if (picked.size > MAX_RECIPIENTS) {
      setError(ZQ_UI.sendReceiptTooMany);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ids = choices.filter((c) => picked.has(c.id)).map((c) => c.id);
      const r = await m72Api.sendReceipt(props.receiptId, ids);
      props.onDone(ZQ_UI.sendReceiptSent(r.queued ?? ids.length));
    } catch (err) {
      if (err instanceof RequestError && RECEIPT_STOPS.has(err.code)) {
        setStopped(zqErrorText(err));
        refusal.show();
        return;
      }
      if (err instanceof RequestError && err.code === "recipient_invalid" && err.extra.contactIds?.length)
        setInvalid(new Set(err.extra.contactIds));
      setError(zqErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const why = (block: string | null, c: ContactView) =>
    block === "no_portal"
      ? ZQ_UI.sendReceiptNoPortal
      : block === "no_finance"
        ? ZQ_UI.sendReceiptNoFinance
        : block === "stopped"
          ? ZQ_UI.pickerStopped(c.suppression?.label ?? ZQ_UI.stopped)
          : "";

  return (
    <Modal open title={ZQ_UI.sendReceiptTitle(props.number)} onClose={props.onClose} busy={busy}>
      <form noValidate onSubmit={submit}>
        <div className="dialog__body">
          <p>{ZQ_UI.sendReceiptIntro}</p>
          {stopped && (
            <Notice tone="error" ref={refusal.ref}>
              {stopped}
            </Notice>
          )}
          {loaded.state === "loading" && (
            <p className="hint" role="status">
              {ZQ_UI.loading}
            </p>
          )}
          {loaded.state === "failed" && <Notice tone="error">{zqErrorText(loaded.error)}</Notice>}
          {noneCan && (
            <Notice tone="info">
              {ZQ_UI.sendReceiptNoneCan}{" "}
              <Link to={`/clients/${encodeURIComponent(clientId)}?tab=contacts`} onClick={props.onClose}>
                {ZQ_UI.sendReceiptContacts}
              </Link>
            </Notice>
          )}
          {loaded.state === "ready" && choices.length > 0 && (
            <fieldset
              className="radios sendd__to"
              aria-describedby={`${groupId}-hint${error ? ` ${groupId}-error` : ""}`}
            >
              <legend>{ZQ_UI.sendReceiptTo}</legend>
              <p className="hint" id={`${groupId}-hint`}>
                {ZQ_UI.sendReceiptToHint}
              </p>
              {choices.map((c, i) => {
                const bad = invalid.has(c.id);
                const full = picked.size >= MAX_RECIPIENTS && !picked.has(c.id);
                const reason = why(c.block, c);
                const described = [reason ? `${groupId}-why-${i}` : "", bad ? `${groupId}-bad-${i}` : ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <label key={c.id} className={`check sendd__contact${c.block ? " is-off" : ""}`}>
                    <input
                      id={`${groupId}-${i}`}
                      type="checkbox"
                      checked={picked.has(c.id)}
                      disabled={c.block !== null || busy || full || stopped !== null}
                      aria-invalid={bad || undefined}
                      aria-describedby={described || undefined}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        setPicked(next);
                        setError(null);
                      }}
                    />
                    <span>
                      <span className="sendd__name">{c.name}</span>
                      <span className="sendd__meta break">{c.email}</span>
                      {reason && (
                        <span className="sendd__meta" id={`${groupId}-why-${i}`}>
                          {reason}
                        </span>
                      )}
                      {bad && (
                        <span className="sendd__bad" id={`${groupId}-bad-${i}`}>
                          {ZQ_UI.sendReceiptRefused}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
              {error && <FieldError id={`${groupId}-error`}>{error}</FieldError>}
            </fieldset>
          )}
          {error && !(loaded.state === "ready" && choices.length > 0) && (
            <Notice tone="error">{error}</Notice>
          )}
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            {ZQ_UI.cancel}
          </button>
          {!stopped && (
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || loaded.state !== "ready" || noneCan}
              aria-busy={busy || undefined}
            >
              <Send size={20} />
              {busy ? ZQ_UI.sendReceiptSending : ZQ_UI.sendReceiptSend}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
