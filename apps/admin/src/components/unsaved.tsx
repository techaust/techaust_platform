// The unsaved-changes warning (ADM-G-04): leaving a changed form inside the app asks first; closing the tab or
// reloading gets the browser's own warning.
import { useEffect } from "react";
import { useBlocker } from "react-router";
import { Modal } from "./dialog.tsx";

export function UnsavedChangesGuard({ dirty, what }: { dirty: boolean; what: string }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <Modal open={blocker.state === "blocked"} title="Leave without saving?" onClose={() => blocker.reset?.()}>
      <div className="dialog__body">
        <p>Your changes to {what} haven't been saved. If you leave now, they're lost.</p>
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={() => blocker.reset?.()}>
          Stay on this page
        </button>
        <button type="button" className="btn btn--danger" onClick={() => blocker.proceed?.()}>
          Leave without saving
        </button>
      </div>
    </Modal>
  );
}
