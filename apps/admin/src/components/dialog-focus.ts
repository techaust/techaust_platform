// The focus rule of `Modal` (components/dialog.tsx; WCAG 2.4.3, M6.2 review finding 1), pure so it is tested without a DOM: when a dialog ends, by its
// `open` prop going false OR by the component unmounting while still open (a screen that mounts it as `{x && <Modal open …>}` and drops it on Escape or
// Cancel), the native dialog is closed and focus goes back to the control that opened it, if that control is still on the page. Duck-typed (no
// `HTMLElement` checks), so the same function runs in the browser and in the Workers test pool.
//
// M7.5 (A1, M1.5 M2): an opener can't always take the focus back. The step-up dialog opens over a confirm dialog whose button is disabled while its
// request waits, and a row's button can be gone once the action has run. Focus then fell to <body>, and a keyboard or screen reader user lost their place.
// Now the focus moves on to a fallback: the title of the dialog still open underneath (the confirm dialog the step-up covered), else the page's main
// landmark. A candidate counts only if the focus really landed on it (`active()`), so an element that refuses the focus never ends the search.

/** What `endDialog` needs of the native `<dialog>`. */
export type DialogLike = { readonly open: boolean; close(): void };
/** What `endDialog` needs of an element that may take the focus (the opener, or a fallback). */
export type FocusLike = {
  readonly isConnected?: boolean;
  readonly disabled?: boolean;
  focus?: (options?: FocusOptions) => void;
};
/** The opener: `document.activeElement` when the dialog opened (never `<body>`; `Modal` records null then). */
export type OpenerLike = FocusLike;

/**
 * Where the focus goes when the opener can't take it: `candidates` in order (read once the dialog has closed), and `active` the element that has the
 * focus now (`document.activeElement`), to check a candidate really took it.
 */
export type FocusFallback = {
  candidates: () => readonly (FocusLike | null | undefined)[];
  active: () => unknown;
};

/** Connected, not disabled, and focusable by script. */
const canTake = (el: FocusLike | null | undefined): el is FocusLike & { focus: (o?: FocusOptions) => void } =>
  !!el && el.isConnected === true && el.disabled !== true && typeof el.focus === "function";

/**
 * Closes `dialog` if it is still open and hands the focus back: to `opener` if it can take it, else to the first `fallback` candidate that does.
 * Returns whether the focus was placed (false: nothing could take it; without a fallback, the opener couldn't).
 */
export function endDialog(
  dialog: DialogLike | null,
  opener: OpenerLike | null,
  fallback?: FocusFallback,
): boolean {
  if (dialog?.open) dialog.close();
  if (canTake(opener)) {
    opener.focus();
    if (!fallback || fallback.active() === opener) return true;
  }
  if (!fallback) return false;
  for (const el of fallback.candidates()) {
    if (!canTake(el)) continue;
    // The fallback is a heading or a landmark, not where the person was: it takes the focus without scrolling the page.
    el.focus({ preventScroll: true });
    if (fallback.active() === el) return true;
  }
  return false;
}
