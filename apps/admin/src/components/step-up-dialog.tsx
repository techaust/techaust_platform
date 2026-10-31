// The step-up dialog [ADM-AUTH-08]. It opens when the API answers 403 `step_up_required`; a fresh authenticator
// code opens sensitive actions for ten minutes, and the request that needed it is sent again. The sign-in code
// can't be used twice (replay guard), so the hint says to wait for the next one. A wrong code is 400
// `invalid_code`; ten wrong codes lock the account for 15 minutes (429 `locked`).
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, errorText, onStepUpRequired, RequestError } from "../api.ts";
import { WRONG_CODE } from "../lib/step-up.ts";
import { StepUpPrompt } from "./step-up-auth.tsx";

/** The prompt's one field (`StepUpPrompt`, id `step-up-code`). */
const codeField = () => document.getElementById("step-up-code");

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
      codeField()?.focus();
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
      setError(err instanceof RequestError && err.code === "invalid_code" ? WRONG_CODE : errorText(err));
      // The error is the code field's own line: the field takes the focus (the pressed button was disabled while busy, so focus would fall to
      // <body>; WCAG 2.4.3), and the field brings its line into view above the actions (rt2 re-check A).
      codeField()?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepUpPrompt
      open={open}
      code={code}
      onCode={setCode}
      onSubmit={submit}
      onCancel={() => finish(false)}
      busy={busy}
      error={error}
    />
  );
}
