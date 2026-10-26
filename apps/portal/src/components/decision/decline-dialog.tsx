// Decline with a reason (ADM-PROP-10): step 1 picks a reason (four plus "Other", which then needs a few words), step 2 confirms. The
// reason is required; the note is optional unless "Other" is picked. Focus moves to the step's title on each step, and back to the
// Decline button if the dialog is cancelled. The codes are core's `DECLINE_REASONS`; the words are 07-N §3 (PENDING the owner's approval).
import { type FormEvent, useId, useRef, useState } from "react";
import { N, WORDS } from "../../copy-documents.ts";
import { Modal } from "../dialog.tsx";
import { FieldError, Notice } from "../ui.tsx";

export type DeclineReason = keyof typeof N.reasons;
/** In the order of `DECLINE_REASONS` (@techaust/core/offers). */
const REASONS = Object.keys(N.reasons) as DeclineReason[];
/** `DECLINE_NOTE_MAX` (@techaust/core/offers). */
const NOTE_MAX = 500;

export function DeclineDialog(props: {
  open: boolean;
  kind: string;
  onClose: () => void;
  /** Records the decline. Throws an Error whose message is shown, and the dialog stays open. */
  onDecline: (reason: DeclineReason, note: string | null) => Promise<void>;
}) {
  const [step, setStep] = useState<"reason" | "confirm">("reason");
  const [reason, setReason] = useState<DeclineReason | null>(null);
  const [note, setNote] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const groupId = useId();
  const noteId = useId();
  const firstRadio = useRef<HTMLInputElement>(null);
  const isOther = reason === "other";

  /** A step change: the new step's title takes focus once it has rendered (on opening, the dialog focuses as usual). */
  function goTo(next: "reason" | "confirm") {
    setStep(next);
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  function reset() {
    setStep("reason");
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
    const rErr = reason ? null : N.reasonMissing;
    const nErr = isOther && !note.trim() ? N.otherMissing : null;
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
    goTo("confirm");
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

  return (
    <Modal
      open={props.open}
      title={step === "reason" ? N.declineTitle : N.declineConfirmTitle(props.kind)}
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
            <legend>{N.fields.reason}</legend>
            {REASONS.map((r, i) => (
              <label key={r} className="radio">
                <input
                  ref={i === 0 ? firstRadio : undefined}
                  type="radio"
                  name={groupId}
                  value={r}
                  checked={reason === r}
                  onChange={() => {
                    setReason(r);
                    setReasonError(null);
                  }}
                />
                <span>{r === "other" ? WORDS.other : N.reasons[r]}</span>
              </label>
            ))}
            {reasonError && <FieldError id={`${groupId}-error`}>{reasonError}</FieldError>}
          </fieldset>
          <div className="field">
            <label htmlFor={noteId}>{isOther ? N.otherLabel : N.noteLabel}</label>
            <textarea
              id={noteId}
              value={note}
              rows={3}
              maxLength={NOTE_MAX}
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
              {N.continue}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="dialog__body">
            <dl className="facts facts--confirm">
              <div>
                <dt>{N.fields.reason}</dt>
                <dd>
                  {reason === "other" ? WORDS.other : reason ? N.reasons[reason] : ""}
                  {note.trim() && <span className="line muted">{note.trim()}</span>}
                </dd>
              </div>
            </dl>
            <p>{N.declineConfirmBody}</p>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => goTo("reason")}
              disabled={busy}
            >
              {N.back}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={confirm}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              {busy ? N.declining : N.decline}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
