// Decline with a reason (ADM-PROP-10): step 1 picks a reason (a short list plus "Other", which then needs a few words),
// step 2 confirms. The reason is required; the note is optional unless "Other" is picked. Focus moves to the step's title
// on each step, and back to the Decline button if the dialog is cancelled.
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { PENDING, WORDS } from "../../copy-documents.ts";
import { Modal } from "../dialog.tsx";
import { Ph } from "../pending.tsx";
import { FieldError, Notice } from "../ui.tsx";

export function DeclineDialog(props: {
  open: boolean;
  kind: string;
  onClose: () => void;
  /** Records the decline. Throws an Error whose message is shown, and the dialog stays open. */
  onDecline: (reason: string, note: string | null) => Promise<void>;
}) {
  const [step, setStep] = useState<"reason" | "confirm">("reason");
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const groupId = useId();
  const noteId = useId();
  const firstRadio = useRef<HTMLInputElement>(null);
  const isOther = reason === WORDS.other;

  // A new step: its title takes focus (not on opening, where the first radio does, as a dialog should).
  const [stepped, setStepped] = useState(false);
  useEffect(() => {
    if (stepped) titleRef.current?.focus();
  }, [step, stepped]);

  function reset() {
    setStep("reason");
    setStepped(false);
    setReason(null);
    setNote("");
    setReasonError(null);
    setNoteError(null);
    setError(null);
  }

  function close() {
    reset();
    props.onClose();
  }

  function next(e: FormEvent) {
    e.preventDefault();
    const rErr = reason ? null : PENDING.reasonMissing;
    const nErr = isOther && !note.trim() ? PENDING.otherMissing : null;
    setReasonError(rErr);
    setNoteError(nErr);
    if (rErr) {
      firstRadio.current?.focus();
      return;
    }
    if (nErr) {
      document.getElementById(noteId)?.focus();
      return;
    }
    setStepped(true);
    setStep("confirm");
  }

  async function confirm() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await props.onDecline(reason, note.trim() || null);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const options = [...PENDING.reasons, WORDS.other];
  return (
    <Modal
      open={props.open}
      title={
        step === "reason" ? (
          <Ph>{PENDING.declineTitle}</Ph>
        ) : (
          <Ph>{PENDING.declineConfirmTitle(props.kind)}</Ph>
        )
      }
      onClose={close}
      busy={busy}
      titleRef={titleRef}
    >
      {step === "reason" ? (
        <form noValidate onSubmit={next}>
          <fieldset
            className="radios"
            aria-describedby={reasonError ? `${groupId}-error` : undefined}
            aria-invalid={reasonError ? true : undefined}
          >
            <legend>{PENDING.reasonLegend}</legend>
            {options.map((o, i) => (
              <label key={o} className="radio">
                <input
                  ref={i === 0 ? firstRadio : undefined}
                  type="radio"
                  name={groupId}
                  value={o}
                  checked={reason === o}
                  onChange={() => {
                    setReason(o);
                    setReasonError(null);
                  }}
                />
                <span>{o}</span>
              </label>
            ))}
            {reasonError && <FieldError id={`${groupId}-error`}>{reasonError}</FieldError>}
          </fieldset>
          <div className="field">
            <label htmlFor={noteId}>{isOther ? PENDING.otherLabel : PENDING.noteLabel}</label>
            <textarea
              id={noteId}
              value={note}
              rows={3}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => isOther && noteError && note.trim() && setNoteError(null)}
              aria-invalid={noteError ? true : undefined}
              aria-describedby={noteError ? `${noteId}-error` : undefined}
              required={isOther}
            />
            {noteError && <FieldError id={`${noteId}-error`}>{noteError}</FieldError>}
          </div>
          <div className="dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={close}>
              {WORDS.cancel}
            </button>
            <button type="submit" className="btn btn--primary">
              {PENDING.continue}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="dialog__body">
            <dl className="facts facts--confirm">
              <div>
                <dt>{PENDING.fields.reason}</dt>
                <dd>
                  {reason}
                  {note.trim() && <span className="block muted">{note.trim()}</span>}
                </dd>
              </div>
            </dl>
            <p>
              <Ph>{PENDING.declineConfirmBody}</Ph>
            </p>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setStep("reason");
              }}
              disabled={busy}
            >
              {PENDING.back}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={confirm}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              {busy ? PENDING.declining : PENDING.decline}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
