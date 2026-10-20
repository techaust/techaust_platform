// The step-up dialog [ADM-AUTH-08]. It opens when the API answers 403 `step_up_required`; a fresh authenticator
// code opens sensitive actions for ten minutes, and the request that needed it is sent again. The sign-in code
// can't be used twice (replay guard), so the hint says to wait for the next one. A wrong code is 400
// `invalid_code`; ten wrong codes lock the account for 15 minutes (429 `locked`).
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, errorText, onStepUpRequired, RequestError } from "../api.ts";
import { Modal } from "./dialog.tsx";
import { CodeField } from "./ui.tsx";

export function StepUpDialog({ onConfirmed }: { onConfirmed?: (until: number) => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settle = useRef<((ok: boolean) => void) | null>(null);

  useEffect(
    () =>
      onStepUpRequired(
        () =>
          new Promise<boolean>((resolve) => {
            settle.current?.(false); // a second request while one is open: the first one gives up
            settle.current = resolve;
            setCode("");
            setError(null);
            setOpen(true);
          }),
      ),
    [],
  );

  function finish(ok: boolean) {
    setOpen(false);
    settle.current?.(ok);
    settle.current = null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.stepUp(code);
      onConfirmed?.(r.stepUpUntil);
      finish(true);
    } catch (err) {
      setCode("");
      setError(
        err instanceof RequestError && err.code === "invalid_code"
          ? "That code didn't work. It may be the one you signed in with, which can't be used again. Wait for the next code and enter it."
          : errorText(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Confirm it's you" onClose={() => finish(false)} busy={busy}>
      <form onSubmit={submit} noValidate>
        <div className="dialog__body">
          <p>
            This change needs a fresh code from your authenticator app. Once confirmed, you won't be asked
            again for 10 minutes.
          </p>
          <CodeField
            id="step-up-code"
            label="Authenticator code"
            hint="Use a new code. The one you signed in with won't work twice, so wait for the next one if needed."
            value={code}
            onChange={setCode}
            error={error}
            autoFocus
          />
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={() => finish(false)} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Checking…" : "Confirm"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
