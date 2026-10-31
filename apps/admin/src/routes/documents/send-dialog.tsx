// Send a proposal or estimate to chosen contacts (M4.5, ADM-PROP-07, ADM-G-04), and send the latest version again: the client's contacts
// with portal access (billing contacts ticked; up to five; each gets their own email and link), the "Attach the PDF" switch that starts
// from the client's setting as the document read resolves it (`attachPdfDefault`, so a role that can't read the client sees it too), and the message as it will go (07 §8 with 07-N §4). The first send also says what sending does (07-O §5)
// and for how much to whom. The owner-approved preview's layout: the choices on the left, the message on the right (stacked when narrow).
// T6 (07-ZE lines 1, 3 and 4): the preview follows packages/email `offerSent` paragraph for paragraph: "(IST)" on the validity, the version line
// after the lead from version 2, and the closing line as an ordinary paragraph (it states how to accept, so it isn't stepped back).
import { type FormEvent, useEffect, useId, useState } from "react";
import { Link } from "react-router";
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
  pdfNote,
  recipientChoices,
} from "../../lib/offers.ts";

type Loaded =
  | { state: "loading" }
  | { state: "failed"; error: unknown }
  | { state: "ready"; contacts: ContactView[] };

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
  /** The client's "Attach PDF" setting as GET /documents/:id resolves it: the switch's starting position and the send path's default. */
  attachPdfDefault: boolean;
  /** The draft's "Send to" contact: ticked to start with when it has portal access (sweep finding 4). */
  preferredContactId?: string | null | undefined;
  /** "10 Nov 2026" (the version's validity, as the email states it); null while a draft has none yet. */
  validUntil: string | null;
  /** Sends; throws a RequestError to show (its `contactIds` mark the contacts that can't receive it). */
  onSend: (contactIds: string[], attachPdf: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [attach, setAttach] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const groupId = useId();
  const attachId = useId();
  const { open, clientId, attachPdfDefault } = props;
  const preferred = props.preferredContactId ?? null;

  // The client's contacts, read when the dialog opens (the client page's own API); the switch starts from the document's resolved default.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoaded({ state: "loading" });
    setError(null);
    setInvalid(new Set());
    setAttach(attachPdfDefault);
    api.client(clientId).then(
      (page) => {
        if (!alive) return;
        const { ticked } = recipientChoices(page.contacts, preferred);
        setPicked(new Set(ticked));
        setLoaded({ state: "ready", contacts: page.contacts });
      },
      (e: unknown) => alive && setLoaded({ state: "failed", error: e }),
    );
    return () => {
      alive = false;
    };
  }, [open, clientId, attachPdfDefault, preferred]);

  const choices = loaded.state === "ready" ? recipientChoices(loaded.contacts).choices : [];
  // Nobody can receive it (no live contact with portal access): Send is off and the dialog says where to turn access on.
  const noneCan = loaded.state === "ready" && !choices.some((c) => c.portalAccess);
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
      // The switch is always sent, so the email that goes is the one the preview shows.
      await props.onSend(
        choices.filter((c) => picked.has(c.id)).map((c) => c.id),
        attach,
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
  // 07-ZE line 3: from version 2, the paragraph the email puts right after its lead sentence (null for version 1).
  const replaces = EMAIL_PREVIEW.replaces(props.version);

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
          {noneCan && (
            <Notice tone="info">
              {OFFER_COPY.noneWithPortal}{" "}
              <Link
                to={`/clients/${encodeURIComponent(props.clientId)}?tab=contacts`}
                onClick={props.onClose}
              >
                {OFFER_COPY.contactsTab}
              </Link>
            </Notice>
          )}
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
                    {attachPdfDefault ? OFFER_COPY.attachHintOn : OFFER_COPY.attachHint}
                  </p>
                </div>
                <Switch
                  id={attachId}
                  checked={attach}
                  onChange={setAttach}
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
            {replaces && <p>{replaces}</p>}
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
                <dd>{props.validUntil ? EMAIL_PREVIEW.validUntilValue(props.validUntil) : "…"}</dd>
              </div>
            </dl>
            <p>
              <span className="sendd__btn">{EMAIL_PREVIEW.button}</span>
            </p>
            <p>{pdfNote(attach)}</p>
            <p>{EMAIL_PREVIEW.questions}</p>
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
            disabled={busy || loaded.state !== "ready" || noneCan}
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
