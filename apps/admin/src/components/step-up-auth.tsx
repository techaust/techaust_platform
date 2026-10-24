// StepUpAuth (docs/06 §5.3): the "confirm it's you" dialog with one 6-digit field (`one-time-code`, paste-friendly).
// Presentational: StepUpDialog wires it to the API (403 `step_up_required`); settings screens open it before
// sensitive fields unlock (bank details, ADM-SET-02).
import type { FormEvent, ReactNode } from "react";
import { Modal } from "./dialog.tsx";
import { CodeField } from "./ui.tsx";

export function StepUpPrompt(props: {
  open: boolean;
  code: string;
  onCode: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  busy?: boolean | undefined;
  error?: string | null | undefined;
  intro?: ReactNode | undefined;
}) {
  return (
    <Modal open={props.open} title="Confirm it's you" onClose={props.onCancel} busy={props.busy}>
      <form onSubmit={props.onSubmit} noValidate>
        <div className="dialog__body">
          {props.intro ?? (
            <p>
              This needs a fresh code from your authenticator app. Once confirmed, you won't be asked
              again for 10 minutes.
            </p>
          )}
          <CodeField
            id="step-up-code"
            label="Authenticator code"
            hint="Use a new code. The one you signed in with won't work twice, so wait for the next one if needed."
            value={props.code}
            onChange={props.onCode}
            error={props.error}
            autoFocus
          />
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onCancel} disabled={props.busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={props.busy}
            aria-busy={props.busy || undefined}
          >
            {props.busy ? "Checking…" : "Confirm"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
