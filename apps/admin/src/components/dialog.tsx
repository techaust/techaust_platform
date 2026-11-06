// A modal dialog on the native <dialog> element: showModal() gives the top layer, an inert page behind, focus
// inside and Escape to cancel, which is the WAI-ARIA dialog pattern without a library. Focus goes back to the
// control that opened it; when that control is disabled or gone, to the dialog still open underneath, else to the main landmark (M7.5, M1.5 M2).
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";
import { endDialog, type FocusFallback } from "./dialog-focus.ts";

/** The dialogs this page has shown and not ended yet, oldest first: the top layer's order (a step-up opens over a confirm dialog). */
const shownDialogs: HTMLDialogElement[] = [];

/** Makes an element a focus target for script only (a heading or a landmark that has no tabindex of its own). */
function scriptFocusable(el: HTMLElement | null): HTMLElement | null {
  if (el && !el.hasAttribute("tabindex")) el.tabIndex = -1;
  return el;
}

/**
 * Where the focus goes when a dialog's opener can't take it back (M7.5, M1.5 M2; WCAG 2.4.3): the title of the newest dialog still open under `ended`
 * (its own button may be disabled while its request waits), else the shell's main landmark (`#main`, or the sign-in card's `<main>`).
 */
export function dialogFocusFallback(ended: HTMLDialogElement | null): FocusFallback {
  return {
    candidates: () => {
      const under = shownDialogs.findLast((d) => d !== ended && d.open && d.isConnected);
      return [
        scriptFocusable(under?.querySelector<HTMLElement>(":scope > .dialog__title") ?? null),
        scriptFocusable(document.getElementById("main") ?? document.querySelector<HTMLElement>("main")),
      ];
    },
    active: () => document.activeElement,
  };
}

/** Ends a dialog this component showed: off the shown list, closed, the focus handed back (components/dialog-focus.ts). */
function finish(d: HTMLDialogElement | null, opener: Element | null) {
  const at = d ? shownDialogs.lastIndexOf(d) : -1;
  if (at >= 0) shownDialogs.splice(at, 1);
  endDialog(d, opener as HTMLElement | null, dialogFocusFallback(d));
}

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
  /** This component showed the dialog and hasn't ended it yet. */
  const shown = useRef(false);
  const titleId = useId();
  const { open, busy, onClose } = props;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      // <body> is no opener: a button disabled while busy can drop the focus there before the dialog opens (the fallback then decides).
      const active = document.activeElement;
      opener.current = active && active !== document.body ? active : null;
      d.showModal();
      shownDialogs.push(d);
      shown.current = true;
    } else if (!open && d.open) {
      shown.current = false;
      finish(d, opener.current);
    }
  }, [open]);

  // M6.2 review finding 1 (WCAG 2.4.3): a screen that mounts the dialog only while it is open (`{x && <Modal open …>}`) unmounts it on Escape or Cancel
  // with `open` still true, so the branch above never runs and focus would fall to <body>. Unmounting while shown ends it the same way: the dialog closes
  // and focus goes back to its opener (components/dialog-focus.ts).
  useEffect(() => {
    const d = ref.current;
    return () => {
      if (!shown.current) return;
      shown.current = false;
      finish(d, opener.current);
    };
  }, []);

  // The sticky actions cover the dialog's last lines while it scrolls, so the dialog keeps what takes focus (or is scrolled to) above them: its
  // `scroll-padding-bottom` is their real height (app.css), which changes with the width (stacked full width on phones), the number of buttons and a
  // step's own actions. WCAG 2.4.11 (rt2 re-check A).
  // The title sticks to the top in the same way (polish sweep 5b), so what takes the focus stops below it too: `scroll-padding-top` is its real
  // height (a long name wraps it to several lines), and `data-scrolled` draws its rule once the body has moved under it.
  useEffect(() => {
    const d = ref.current;
    if (!open || !d) return;
    let actions: HTMLElement | null = null;
    const title = d.querySelector<HTMLElement>(":scope > .dialog__title");
    const size = () => {
      d.style.setProperty("--dialog-actions-h", `${actions?.offsetHeight ?? 0}px`);
      if (title) d.style.setProperty("--dialog-title-h", `${title.offsetHeight}px`);
    };
    const scrolled = () => d.toggleAttribute("data-scrolled", d.scrollTop > 0);
    d.addEventListener("scroll", scrolled, { passive: true });
    scrolled();
    const sizes = new ResizeObserver(size);
    if (title) sizes.observe(title, { box: "border-box" });
    const pick = () => {
      const all = d.querySelectorAll<HTMLElement>(".dialog__actions");
      const next = all[all.length - 1] ?? null;
      if (next === actions) return;
      if (actions) sizes.unobserve(actions);
      actions = next;
      if (actions) sizes.observe(actions, { box: "border-box" });
      size();
      // showModal() (or a new step) focused a control before the height was known: bring it clear of the actions now.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== d && d.contains(focused))
        focused.scrollIntoView({ block: "nearest" });
    };
    const steps = new MutationObserver(pick);
    steps.observe(d, { childList: true, subtree: true });
    pick();
    return () => {
      steps.disconnect();
      sizes.disconnect();
      d.removeEventListener("scroll", scrolled);
      d.removeAttribute("data-scrolled");
      d.style.removeProperty("--dialog-actions-h");
      d.style.removeProperty("--dialog-title-h");
    };
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
