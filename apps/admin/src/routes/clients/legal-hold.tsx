// Legal hold (M7.4 G.2; ADM-CLI-05; C.5, L3, L6): on a client, a contact or a lead. A held record shows the banner (S1, the brief's words) at the top of its
// page; the panel on the client's Overview and on the lead page says whether a hold stands, keeps its history (who set or lifted it, when, why; newest
// first) and gives the Owner "Set a legal hold" or "Lift the legal hold", with a reason and a fresh authenticator code (`legalHold.manage`, step-up). A
// contact has no page of its own, so its row's Data tools open the same panel in a dialog (`ContactHoldDialog`). Every refusal is worded from its code
// (`hold_unchanged`, `anonymised`). Researched 2026-10-28, s.36 CGST Act (08-C RA-25): the hold the register's open point asks for.
import "../../dp.css";
import { type ReactNode, useId, useState } from "react";
import { errorText, RequestError, stepUpActive } from "../../api.ts";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { StatusPill } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { Lock } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { CodeField, Notice, useFieldError } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import { ZR_HOLD } from "../../lib/copy-zr.ts";
import { type HoldEntity, m74Api } from "../../lib/m74-api.ts";
import { dayText } from "../../lib/requests.ts";
import { isWrongCode, withCode } from "../../lib/step-up.ts";
import { useUser } from "../../session.tsx";

const CODE_MISSING = "Enter the 6-digit code from your authenticator app.";
const REASON_MAX = 500;

/** The band at the top of a held record's page (S1): the lock and the rule in the warning colour, the words in the text colour (AA in both themes). */
export function LegalHoldBanner(props: { children?: ReactNode }) {
  return (
    <div className="dp-hold-band" role="note">
      <Lock size={20} />
      <div className="dp-hold-band__body">
        <p className="dp-hold-band__title">{ZR_HOLD.onPill}</p>
        <p>{ZR_HOLD.on}</p>
        {props.children}
      </div>
    </div>
  );
}

/** The panel: the hold's state and history, and the Owner's set or lift. `held` is the record's flag as the page read it. */
export function LegalHoldPanel(props: {
  entityType: HoldEntity;
  entityId: string;
  /** How the dialog names the record ("Acme Ltd", "Lead L-0042"). */
  name: string;
  held: boolean;
  /** The page reloads its record (the flag) after a change. */
  onChanged: () => void;
}) {
  const user = useUser();
  const canManage = allowed(user.role, "legalHold.manage");
  const [changing, setChanging] = useState(false);
  const titleId = useId();
  return (
    <section className="lead-panel dp-hold" aria-labelledby={titleId}>
      <h2 id={titleId} className="lead-panel__title">
        {ZR_HOLD.title}
      </h2>
      {/* the page shows S1 in its banner, so the panel shows the pill alone while held */}
      <HoldBody {...props} bannerShown />
      {canManage && (
        <button type="button" className="btn btn--secondary" onClick={() => setChanging(true)}>
          <Lock size={16} />
          {props.held ? ZR_HOLD.lift : ZR_HOLD.set}
        </button>
      )}
      {changing && (
        <Modal
          open
          title={props.held ? ZR_HOLD.liftTitle(props.name) : ZR_HOLD.setTitle(props.name)}
          onClose={() => setChanging(false)}
        >
          <HoldChangeForm
            {...props}
            onCancel={() => setChanging(false)}
            onDone={() => {
              setChanging(false);
              props.onChanged();
            }}
          />
        </Modal>
      )}
    </section>
  );
}

/** A contact's hold, opened from its row's Data tools: the state and history, then the change in the same dialog. */
export function ContactHoldDialog(props: {
  contactId: string;
  name: string;
  held: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const user = useUser();
  const canManage = allowed(user.role, "legalHold.manage");
  const [changing, setChanging] = useState(false);
  return (
    <Modal
      open
      title={
        changing
          ? props.held
            ? ZR_HOLD.liftTitle(props.name)
            : ZR_HOLD.setTitle(props.name)
          : `${ZR_HOLD.title}: ${props.name}`
      }
      onClose={props.onClose}
    >
      {changing ? (
        <HoldChangeForm
          entityType="contact"
          entityId={props.contactId}
          name={props.name}
          held={props.held}
          onCancel={() => setChanging(false)}
          onDone={() => {
            props.onChanged();
            props.onClose();
          }}
        />
      ) : (
        <>
          <div className="dialog__body dp-hold">
            <HoldBody entityType="contact" entityId={props.contactId} held={props.held} />
          </div>
          <div className="dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={props.onClose}>
              Close
            </button>
            {canManage && (
              <button type="button" className="btn btn--primary" onClick={() => setChanging(true)}>
                {props.held ? ZR_HOLD.lift : ZR_HOLD.set}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function HoldBody(props: { entityType: HoldEntity; entityId: string; held: boolean; bannerShown?: boolean }) {
  // The history (and the hold as the server has it now); a role that can't read it (403) still sees the page's own flag.
  const history = useLoad(
    () => m74Api.holds(props.entityType, props.entityId),
    `${props.entityType}:${props.entityId}:${props.held}`,
  );
  const held = history.state === "ready" ? history.data.held : props.held;
  const forbidden =
    history.state === "failed" && history.error instanceof RequestError && history.error.status === 403;
  return (
    <>
      <p className="dp-hold__state">
        {held ? (
          <StatusPill tone="warning" icon="lock">
            {ZR_HOLD.onPill}
          </StatusPill>
        ) : null}
        {!(held && props.bannerShown) && <span>{held ? ZR_HOLD.on : ZR_HOLD.off}</span>}
      </p>
      {!forbidden && (
        <div className="dp-hold__history">
          <h3 className="dp-hold__h">{ZR_HOLD.history}</h3>
          {history.state === "loading" && (
            <p className="muted" role="status">
              Loading…
            </p>
          )}
          {history.state === "failed" && (
            <LoadFailed error={history.error} onRetry={() => history.reload()} />
          )}
          {history.state === "ready" &&
            (history.data.history.length === 0 ? (
              <p className="muted">{ZR_HOLD.historyEmpty}</p>
            ) : (
              <ol className="dp-hold__list">
                {history.data.history.map((h) => (
                  <li key={h.id} className="dp-hold__item">
                    <p className="dp-hold__who">
                      <span>
                        {h.action === "set"
                          ? ZR_HOLD.historySet(h.by.name ?? ZR_HOLD.someone)
                          : ZR_HOLD.historyLift(h.by.name ?? ZR_HOLD.someone)}
                      </span>
                      <span className="dp-hold__when">{dayText(h.at)}</span>
                    </p>
                    <p className="dp-hold__reason">{h.reason}</p>
                  </li>
                ))}
              </ol>
            ))}
        </div>
      )}
    </>
  );
}

function HoldChangeForm(props: {
  entityType: HoldEntity;
  entityId: string;
  name: string;
  held: boolean;
  onCancel: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const id = useId();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError, codeErrorKey] = useFieldError();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  const needsCode = !stepUpActive();
  const on = !props.held;

  async function confirm() {
    const text = reason.trim();
    if (text === "" || text.length > REASON_MAX) {
      setReasonError(text === "" ? ZR_HOLD.reasonMissing : ZR_HOLD.reasonTooLong);
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    setReasonError(null);
    if (needsCode && code.length !== 6) {
      setCodeError(CODE_MISSING);
      document.getElementById(`${id}-code`)?.focus();
      return;
    }
    setCodeError(null);
    setBusy(true);
    setFailure(null);
    try {
      await withCode(needsCode ? code : undefined, () =>
        m74Api.setHold({ entityType: props.entityType, entityId: props.entityId, on, reason: text }),
      );
      toast("success", on ? ZR_HOLD.setDone : ZR_HOLD.liftDone);
      props.onDone();
    } catch (e) {
      setBusy(false);
      if (isWrongCode(e)) {
        setCode("");
        setCodeError(e.message);
        document.getElementById(`${id}-code`)?.focus();
        return;
      }
      setFailure(
        e instanceof RequestError && ZR_HOLD.refused[e.code]
          ? (ZR_HOLD.refused[e.code] as string)
          : errorText(e),
      );
      refusal.show();
    }
  }

  return (
    <>
      <div className="dialog__body dp-hold-form">
        <p>{on ? ZR_HOLD.setBody : ZR_HOLD.liftBody}</p>
        <FormField id={`${id}-reason`} label={ZR_HOLD.reason} hint={ZR_HOLD.reasonHint} error={reasonError}>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={REASON_MAX}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(null);
              }}
            />
          )}
        </FormField>
        {needsCode && (
          <CodeField
            id={`${id}-code`}
            label="Authenticator code"
            hint="A fresh code from your authenticator app confirms it's you."
            value={code}
            onChange={setCode}
            error={codeError}
            errorKey={codeErrorKey}
          />
        )}
      </div>
      {failure && (
        <Notice tone="error" ref={refusal.ref}>
          {failure}
        </Notice>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void confirm()}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Working…" : on ? ZR_HOLD.confirmSet : ZR_HOLD.confirmLift}
        </button>
      </div>
    </>
  );
}
