// The confirm dialog for irreversible staff actions (docs/06 §5.3 ConfirmDialog): what will happen, then one
// clear action. If the action needs a fresh step-up, the step-up dialog opens on top and the action carries on.
// An action can return something to show afterwards (a reset link shown once): the dialog then shows it with "Done".
import { type ReactNode, useState } from "react";
import { errorText } from "../api.ts";
import { Modal } from "./dialog.tsx";
import { Notice } from "./ui.tsx";

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string | undefined;
  tone?: "default" | "danger" | undefined;
  /** Runs the action. Throws to show an error and stay open; returns content to show a result step. */
  onConfirm: () => Promise<ReactNode | undefined>;
  onClose: () => void;
  /** Disable the confirm button (e.g. nothing picked yet). */
  disabled?: boolean | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReactNode | null>(null);

  function close() {
    setError(null);
    setResult(null);
    props.onClose();
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const shown = await props.onConfirm();
      if (shown) setResult(shown);
      else close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={props.open} title={props.title} onClose={close} busy={busy} tone={props.tone}>
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
          {error && <Notice tone="error">{error}</Notice>}
          <div className="dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={close} disabled={busy}>
              Cancel
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
