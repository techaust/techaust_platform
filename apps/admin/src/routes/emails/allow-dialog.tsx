// "Allow emails again" (M7.2; ADM-MAIL-02; run file G3, C.1; early check finding 1): the Owner's confirm for clearing an address from the suppression list,
// from the email log's detail (`POST /emails/:id/unsuppress`) or a contact (`POST /contacts/:id/unsuppress`). It says what happens, why the address was stopped,
// and the caution that Amazon SES's own account list may still refuse it (UNCONFIRMED in the brief, so worded as "may"). A refusal is worded from its code.
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { RequestError } from "../../api.ts";
import { ZQ_UI, zqErrorText } from "../../lib/copy-zq.ts";

export function AllowEmailsDialog(props: {
  open: boolean;
  address: string;
  /** The reason in words and the day it was stopped ("The address bounced", "5 Nov 2026"). */
  reason: string;
  since: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={props.open}
      title={ZQ_UI.allowTitle}
      confirmLabel={ZQ_UI.allowAgain}
      busyLabel={ZQ_UI.allowing}
      onClose={props.onClose}
      onConfirm={async () => {
        try {
          await props.onConfirm();
        } catch (e) {
          // The dialog shows the thrown message: the code's own words.
          throw e instanceof RequestError ? new RequestError(e.status, e.code, zqErrorText(e)) : e;
        }
        return undefined;
      }}
    >
      <p>
        <strong className="break">{props.address}</strong>
        <br />
        {ZQ_UI.stoppedSince(props.reason, props.since)}
      </p>
      <p>{ZQ_UI.allowBody(props.address)}</p>
      <p className="hint">{ZQ_UI.allowSesCaution}</p>
    </ConfirmDialog>
  );
}
