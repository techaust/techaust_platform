// A modal dialog on the native <dialog> element: showModal() gives the top layer, an inert page behind, focus
// inside and Escape to cancel, which is the WAI-ARIA dialog pattern without a library. Focus goes back to the
// control that opened it.
import { type ReactNode, type Ref, useEffect, useId, useRef } from "react";

export function Modal(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** While true, Escape and the backdrop don't close it (a request is in flight). */
  busy?: boolean | undefined;
  children: ReactNode;
  tone?: "default" | "danger" | undefined;
  /** The title takes focus when the content changes under it (a result step). */
  titleRef?: Ref<HTMLHeadingElement> | undefined;
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
      className={props.tone === "danger" ? "dialog dialog--danger" : "dialog"}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      {open && (
        <>
          <h2 id={titleId} className="dialog__title" ref={props.titleRef} tabIndex={-1}>
            {props.title}
          </h2>
          {props.children}
        </>
      )}
    </dialog>
  );
}
