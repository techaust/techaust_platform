// A modal dialog on the native <dialog> element: showModal() gives the top layer, an inert page behind, focus
// inside and Escape to cancel, which is the WAI-ARIA dialog pattern without a library. Focus goes back to the
// control that opened it.
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";

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
  /** A wider dialog for a form with a preview beside it (the lead reply). */
  wide?: boolean | undefined;
  /** A screen's own modifier (its width), e.g. `dialog--advance`. */
  className?: string | undefined;
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
      className={`dialog${props.tone === "danger" ? " dialog--danger" : ""}${props.wide ? " dialog--wide" : ""}${props.className ? ` ${props.className}` : ""}`}
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
            // Focusable only when asked: otherwise opening the dialog focuses its first control, as it should.
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

/**
 * A server's refusal inside a dialog (its blocker lines or its error line) takes the focus once it is drawn: the pressed button was disabled
 * while busy, so focus would otherwise fall to `<body>` (WCAG 2.4.3, 4.1.3; rt2 visual review 1). Give `ref` to the refusal (focusable by
 * script only: `tabIndex={-1}`) and call `show()` after setting it. It is brought to the top of the dialog's view, never "nearest": the dialog's
 * sticky actions would cover its last lines (as the advance dialog's route choice, M5.2).
 */
export function useRefusalFocus() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (shown === 0 || !el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "start" });
  }, [shown]);
  return { ref, show: () => setShown((n) => n + 1) };
}
