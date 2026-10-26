// Send a proposal or estimate to chosen contacts (M4.5, ADM-PROP-07, ADM-G-04), and send the latest version again: the client's contacts
// with portal access (billing contacts ticked; up to five; each gets their own email and link), the "Attach the PDF" switch that starts
// from the client's setting, and the message as it will go (07 §8 with 07-N §4). The first send also says what sending does (07-O §5)
// and for how much to whom. The owner-approved preview's layout: the choices on the left, the message on the right (stacked when narrow).
import { type FormEvent, useEffect, useId, useState } from "react";
import { api, type ContactView, type Currency, RequestError } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { Switch } from "../../components/form.tsx";
import { Send } from "../../components/icons.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { DOC_COPY, moneyText, sendLine } from "../../lib/documents.ts";
import {
  EMAIL_PREVIEW,
  MAX_RECIPIENTS,
  OFFER_COPY,
  OFFER_ERRORS,
  OFFER_PENDING,
  offerErrorText,
  recipientChoices,
} from "../../lib/offers.ts";

type Loaded =
  | { state: "loading" }
  | { state: "failed"; error: unknown }
  | { state: "ready"; contacts: ContactView[]; attachPdf: boolean | undefined };

export function SendDialog(props: {
  open: boolean;
  /** "send": a draft's first send (it freezes the version); "resend": the latest sent version again. */
  mode: "send" | "resend";
  type: "proposal" | "estimate";
  /** The number once sent (a v2+ draft carries its group's); null for a first draft (numbered at send). */
  number: string | null;
  title: string;
  version: number;
  totalMinor: number | null;
  currency: Currency;
  clientId: string;
  clientName: string;
  /** "10 Nov 2026" (the version's validity, as the email states it); null while a draft has none yet. */
  validUntil: string | null;
  /** Sends; throws a RequestError to show (its `contactIds` mark the contacts that can't receive it). */
  onSend: (contactIds: string[], attachPdf: boolean | undefined) => Promise<void>;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [attach, setAttach] = useState(false);
  const [attachTouched, setAttachTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const groupId = useId();
  const attachId = useId();
  const { open, clientId } = props;

  // The client's contacts and its "Attach PDF" setting, read when the dialog opens (the client page's own API).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoaded({ state: "loading" });
    setError(null);
    setInvalid(new Set());
    setAttachTouched(false);
    api.client(clientId).then(
      (page) => {
        if (!alive) return;
        const { ticked } = recipientChoices(page.contacts);
        setPicked(new Set(ticked));
        setAttach(page.client.attachPdf === true);
        setLoaded({ state: "ready", contacts: page.contacts, attachPdf: page.client.attachPdf });
      },
      (e: unknown) => alive && setLoaded({ state: "failed", error: e }),
    );
    return () => {
      alive = false;
    };
  }, [open, clientId]);

  const choices = loaded.state === "ready" ? recipientChoices(loaded.contacts).choices : [];
  const firstPicked = choices.find((c) => picked.has(c.id));
  const firstName = firstPicked ? (firstPicked.name.trim().split(/\s+/)[0] ?? "") : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || loaded.state !== "ready") return;
    if (picked.size === 0) {
      setError(OFFER_COPY.chooseOne);
      document.getElementById(`${groupId}-0`)?.focus();
      return;
    }
    if (picked.size > MAX_RECIPIENTS) {
      setError(OFFER_ERRORS.recipients_too_many ?? null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The client's own setting is the server's default: the switch is sent only when the person changed it, or when the setting is
      // known here (a role that can read the client's finance settings).
      const send = attachTouched || loaded.attachPdf !== undefined ? attach : undefined;
      await props.onSend(
        choices.filter((c) => picked.has(c.id)).map((c) => c.id),
        send,
      );
    } catch (err) {
      if (err instanceof RequestError && err.code === "recipient_invalid" && err.extra.contactIds?.length)
        setInvalid(new Set(err.extra.contactIds));
      setError(offerErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const numberOrTitle = props.number ?? props.title;
  const title =
    props.mode === "send" ? OFFER_COPY.sendTitle(numberOrTitle, props.version) : OFFER_PENDING.sendAgain;
  const subject = EMAIL_PREVIEW.subject(props.type, props.title, props.number ?? "…", props.version);
  const total = props.totalMinor !== null ? moneyText(props.totalMinor, props.currency) : null;

  return (
    <Modal open={props.open} title={title} onClose={props.onClose} busy={busy} wide>
      <form className="sendd" noValidate onSubmit={submit}>
        <div className="sendd__form">
          {props.mode === "send" && total && (
            <p className="confirm-figure">
              <span className="tnum">{sendLine(total, props.clientName)}</span>
            </p>
          )}
          {props.mode === "send" && <p className="sendd__intro">{DOC_COPY.sendIntro}</p>}
          {loaded.state === "loading" && (
            <p className="hint" role="status">
              Loading…
            </p>
          )}
          {loaded.state === "failed" && <Notice tone="error">{offerErrorText(loaded.error)}</Notice>}
          {loaded.state === "ready" && (
            <>
              <fieldset
                className="radios sendd__to"
                aria-describedby={`${groupId}-hint${error ? ` ${groupId}-error` : ""}`}
              >
                <legend>{OFFER_COPY.sendTo}</legend>
                <p className="hint" id={`${groupId}-hint`}>
                  {OFFER_COPY.sendToHint}
                </p>
                {choices.map((c, i) => {
                  const bad = invalid.has(c.id);
                  return (
                    <label key={c.id} className={`check sendd__contact${c.portalAccess ? "" : " is-off"}`}>
                      <input
                        id={`${groupId}-${i}`}
                        type="checkbox"
                        checked={picked.has(c.id)}
                        disabled={!c.portalAccess || busy}
                        aria-invalid={bad || undefined}
                        aria-describedby={bad ? `${groupId}-bad-${i}` : undefined}
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
                        <span className="sendd__meta">{c.email}</span>
                        {!c.portalAccess && <span className="sendd__meta">{OFFER_COPY.noPortal}</span>}
                        {bad && (
                          <span className="sendd__bad" id={`${groupId}-bad-${i}`}>
                            {OFFER_ERRORS.recipient_invalid}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
                {error && <FieldError id={`${groupId}-error`}>{error}</FieldError>}
              </fieldset>
              <div className="sendd__attach">
                <div>
                  <p className="sendd__label" id={`${attachId}-label`}>
                    {OFFER_COPY.attach}
                  </p>
                  <p className="hint" id={`${attachId}-hint`}>
                    {OFFER_COPY.attachHint}
                  </p>
                </div>
                <Switch
                  id={attachId}
                  checked={attach}
                  onChange={(on) => {
                    setAttach(on);
                    setAttachTouched(true);
                  }}
                  labelledBy={`${attachId}-label`}
                  describedBy={`${attachId}-hint`}
                  disabled={busy}
                />
              </div>
            </>
          )}
        </div>
        <section className="sendd__preview" aria-labelledby={`${groupId}-pv`}>
          <h3 id={`${groupId}-pv`} className="sendd__label">
            {OFFER_COPY.message}
          </h3>
          <dl className="sendd__head">
            <div>
              <dt>From</dt>
              <dd>{EMAIL_PREVIEW.from}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{subject}</dd>
            </div>
          </dl>
          <div className="sendd__body">
            <p>{EMAIL_PREVIEW.lead(props.type, firstName || "…", props.validUntil ?? "…")}</p>
            <dl className="sendd__facts">
              <div>
                <dt>{EMAIL_PREVIEW.facts.number}</dt>
                <dd>
                  {props.number ?? "…"} v{props.version}
                </dd>
              </div>
              {total && (
                <div>
                  <dt>{EMAIL_PREVIEW.facts.total}</dt>
                  <dd className="tnum">{total}</dd>
                </div>
              )}
              <div>
                <dt>{EMAIL_PREVIEW.facts.validUntil}</dt>
                <dd>{props.validUntil ?? "…"}</dd>
              </div>
            </dl>
            <p>
              <span className="sendd__btn">{EMAIL_PREVIEW.button}</span>
            </p>
            <p>{attach ? EMAIL_PREVIEW.attached : EMAIL_PREVIEW.linked}</p>
            <p className="muted">{EMAIL_PREVIEW.questions}</p>
          </div>
          <p className="hint">{OFFER_COPY.deliveryNote}</p>
        </section>
        <div className="dialog__actions sendd__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || loaded.state !== "ready"}
            aria-busy={busy || undefined}
          >
            <Send size={20} />
            {busy ? OFFER_COPY.sending : DOC_COPY.send}
          </button>
        </div>
      </form>
    </Modal>
  );
}
