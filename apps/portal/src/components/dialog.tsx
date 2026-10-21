// A confirm dialog on the native <dialog> element (copied from the admin's M1.5 Modal + ConfirmDialog, trimmed):
// showModal() gives the top layer, an inert page behind, focus inside and Escape to cancel, which is the WAI-ARIA
// dialog pattern without a library. Focus goes back to the control that opened it.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { COPY } from "../copy.ts";
import { Notice } from "./ui.tsx";

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  /** Runs the action. Throws an Error whose message is shown, and the dialog stays open. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { open, onClose } = props;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    }
  }, [open]);

  function close() {
    setError(null);
    onClose();
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : COPY.network);
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      {open && (
        <>
          <h2 id={titleId} className="dialog__title">
            {props.title}
          </h2>
          <div className="dialog__body" id={bodyId}>
            {props.children}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={close} disabled={busy}>
              {COPY.home.cancel}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={confirm}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              {busy ? props.busyLabel : props.confirmLabel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
