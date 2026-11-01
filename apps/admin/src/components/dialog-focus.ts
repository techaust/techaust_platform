// The focus rule of `Modal` (components/dialog.tsx; WCAG 2.4.3, M6.2 review finding 1), pure so it is tested without a DOM: when a dialog ends, by its
// `open` prop going false OR by the component unmounting while still open (a screen that mounts it as `{x && <Modal open …>}` and drops it on Escape or
// Cancel), the native dialog is closed and focus goes back to the control that opened it, if that control is still on the page. Duck-typed (no
// `HTMLElement` checks), so the same function runs in the browser and in the Workers test pool.

/** What `endDialog` needs of the native `<dialog>`. */
export type DialogLike = { readonly open: boolean; close(): void };
/** What `endDialog` needs of the opener (`document.activeElement` when it opened). */
export type OpenerLike = { readonly isConnected?: boolean; focus?: (options?: FocusOptions) => void };

/** Closes `dialog` if it is still open and focuses `opener` if it is still connected. Returns whether focus was handed back. */
export function endDialog(dialog: DialogLike | null, opener: OpenerLike | null): boolean {
  if (dialog?.open) dialog.close();
  if (opener && opener.isConnected === true && typeof opener.focus === "function") {
    opener.focus();
    return true;
  }
  return false;
}
