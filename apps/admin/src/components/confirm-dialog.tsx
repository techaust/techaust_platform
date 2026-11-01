// The confirm dialog for irreversible staff actions (docs/06 §5.3 ConfirmDialog): what will happen, then one
// clear action. If the action needs a fresh step-up, the step-up dialog opens on top and the action carries on.
// An action can return something to show afterwards (a reset link shown once): the dialog then shows it with "Done".
import { type ReactNode, useEffect, useRef, useState } from "react";
import { errorText } from "../api.ts";
import { isWrongCode, WRONG_CODE } from "../lib/step-up.ts";
import { Modal, useRefusalFocus } from "./dialog.tsx";
import { CodeField, Notice, useFieldError } from "./ui.tsx";

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string | undefined;
  tone?: "default" | "danger" | undefined;
  /** Runs the action. Throws to show an error and stay open; returns content to show a result step.
   * With `stepUp`, it receives the 6-digit code typed in the dialog. */
  onConfirm: (code?: string) => Promise<ReactNode | undefined>;
  /** The step-up slot (docs/06 §5.3): the authenticator code is asked for in this dialog, not a second one. */
  stepUp?: boolean | undefined;
  onClose: () => void;
  /** Disable the confirm button (e.g. nothing picked yet). */
  disabled?: boolean | undefined;
  /** The title once the action has happened (a question no longer fits). */
  resultTitle?: string | undefined;
  /** The way out, when the copy names it (07-R "Keep it"); "Cancel" otherwise. */
  cancelLabel?: string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReactNode | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError, codeErrorKey] = useFieldError();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Any other refusal takes the focus (the confirm button was disabled while busy, so focus would fall to <body>; polish sweep re-check 1, WCAG 2.4.3).
  const refusal = useRefusalFocus();
  // The confirm button is gone once the result shows: focus goes to the title so the result is read next.
  useEffect(() => {
    if (result) titleRef.current?.focus();
  }, [result]);

  function close() {
    setError(null);
    setResult(null);
    setCode("");
    setCodeError(null);
    props.onClose();
  }

  async function confirm() {
    if (props.stepUp && code.length !== 6) {
      setCodeError("Enter the 6-digit code from your authenticator app.");
      document.getElementById("confirm-code")?.focus();
      return;
    }
    setCodeError(null);
    setBusy(true);
    setError(null);
    try {
      const shown = await props.onConfirm(props.stepUp ? code : undefined);
      if (shown) setResult(shown);
      else close();
    } catch (e) {
      // A wrong code is the code field's own error, as in the issue, note and advance dialogs: cleared, said under it, and focused
      // (polish sweep review 2, WCAG 2.4.3); every other refusal keeps the dialog's notice.
      if (props.stepUp && isWrongCode(e)) {
        setCode("");
        setCodeError(WRONG_CODE);
        document.getElementById("confirm-code")?.focus();
        return;
      }
      setError(errorText(e));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={props.open}
      title={result && props.resultTitle ? props.resultTitle : props.title}
      onClose={close}
      busy={busy}
      tone={props.tone}
      titleRef={result ? titleRef : undefined}
    >
      {result ? (
        <>
          <div className="dialog__body">{result}</div>
          <div className="dialog__actions">
            <button type="button" className="btn btn--primary" onClick={close}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="dialog__body">{props.children}</div>
          {props.stepUp && (
            <CodeField
              id="confirm-code"
              label="Authenticator code"
              hint="A fresh code from your authenticator app confirms it's you."
              value={code}
              onChange={setCode}
              error={codeError}
              errorKey={codeErrorKey}
            />
          )}
          {error && (
            <Notice tone="error" ref={refusal.ref}>
              {error}
            </Notice>
          )}
          <div className="dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={close} disabled={busy}>
              {props.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              className={props.tone === "danger" ? "btn btn--danger" : "btn btn--primary"}
              onClick={confirm}
              disabled={busy || props.disabled}
              aria-busy={busy || undefined}
            >
              {busy ? (props.busyLabel ?? "Working…") : props.confirmLabel}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
