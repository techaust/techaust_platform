// The unsaved-changes warning (ADM-G-04): leaving a changed form inside the app asks first; closing the tab or
// reloading gets the browser's own warning.
import { useEffect } from "react";
import { useBlocker } from "react-router";
import { Modal } from "./dialog.tsx";

export function UnsavedChangesGuard({
  dirty,
  what,
  onStay,
}: {
  dirty: boolean;
  what: string;
  /** Called when the person chooses to stay (the button or Escape): a screen that held back a reload for the leave can run it now. */
  onStay?: () => void;
}) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const stay = () => {
    blocker.reset?.();
    onStay?.();
  };
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <Modal open={blocker.state === "blocked"} title="Leave without saving?" onClose={stay}>
      <div className="dialog__body">
        <p>Your changes to {what} haven't been saved. If you leave now, they're lost.</p>
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={stay}>
          Stay on this page
        </button>
        <button type="button" className="btn btn--danger" onClick={() => blocker.proceed?.()}>
          Leave without saving
        </button>
      </div>
    </Modal>
  );
}
