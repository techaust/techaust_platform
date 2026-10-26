// A confirm dialog on the native <dialog> element (copied from the admin's M1.5 Modal + ConfirmDialog, trimmed):
// showModal() gives the top layer, an inert page behind, focus inside and Escape to cancel, which is the WAI-ARIA
// dialog pattern without a library. Focus goes back to the control that opened it.
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";
import { COPY } from "../copy.ts";
import { Notice } from "./ui.tsx";

/**
 * A modal for content with its own steps (M4.5: decline with a reason, then confirm). The same native <dialog> pattern
 * as ConfirmDialog; focus goes back to the opener when it closes, unless the screen moved focus on purpose (a result).
 */
export function Modal(props: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  /** While true, Escape doesn't close it (a request is in flight). */
  busy?: boolean | undefined;
  /** The title takes focus when the step changes under it. */
  titleRef?: Ref<HTMLHeadingElement> | undefined;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const { open, busy, onClose } = props;

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

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      {open && (
        <>
          <h2
            id={titleId}
            className="dialog__title"
            ref={props.titleRef}
            tabIndex={props.titleRef ? -1 : undefined}
          >
            {props.title}
          </h2>
          {props.children}
        </>
      )}
    </dialog>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  /** The way out without acting (default "Cancel"; the accept step says "Back", 07-N §3). */
  cancelLabel?: string | undefined;
  /** Runs the action. Throws an Error whose message is shown, and the dialog stays open. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
  /** How an error line is shown (default: as text). */
  renderError?: ((text: string) => ReactNode) | undefined;
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
          {error && <Notice tone="error">{props.renderError ? props.renderError(error) : error}</Notice>}
          <div className="dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={close} disabled={busy}>
              {props.cancelLabel ?? COPY.home.cancel}
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
