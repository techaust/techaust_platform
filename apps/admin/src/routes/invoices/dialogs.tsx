// The invoice dialogs (M5.1, ADM-INV-03, -04, -07, ADM-APR-01, ADM-G-04 ConfirmDialog): issue (the owner, with the series preview, what still
// stops it and a fresh code), request issue (Staff), void (the owner, a required reason and a fresh code) and delete a draft. Each says what will
// happen before the one button that does it; a refusal is said in 07-R's words and the dialog stays open. The number is never shown as if it
// were known: the preview draws the series and an empty slot, because the number is taken only inside the issue batch.
import { useState } from "react";
import { Link } from "react-router";
import { stepUpActive } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { Modal } from "../../components/dialog.tsx";
import { KeepDates } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { Alert } from "../../components/icons.tsx";
import { CodeField, Notice } from "../../components/ui.tsx";
import {
  blockerLine,
  blockerTarget,
  INV_COPY,
  INV_ERRORS,
  invErrorText,
  invMapped,
  issueBody,
  seriesPreview,
  splitAtPlace,
  voidTitle,
} from "../../lib/invoices.ts";
import type { InvoiceBlocker, InvoiceView } from "../../lib/invoices-api.ts";
import { withCode } from "../../lib/step-up.ts";

const CODE_MISSING = "Enter the 6-digit code from your authenticator app.";

/** What still stops an issue, one line each, with a link to where it is fixed (07-R §2 "Blockers"). */
export function BlockerList(props: {
  blockers: InvoiceBlocker[];
  clientId: string;
  currency: string;
  /** A line's blocker: put the cursor where that line is fixed (the editor maps the position to the line; `field` says which part). */
  onLine?: ((n: number, field: "description" | "sac") => void) | undefined;
  /** A blocker about the lines as a whole. */
  onLines?: (() => void) | undefined;
}) {
  if (props.blockers.length === 0) return null;
  return (
    <ul className="blockers inv-blockers">
      {props.blockers.map((b, i) => {
        const line = blockerLine(b, props.currency);
        const t = blockerTarget(b, props.clientId);
        let body: React.ReactNode = line;
        if (t?.kind === "page") {
          const parts = splitAtPlace(line, t.place);
          body = parts ? (
            <>
              {parts[0]}
              <Link className="blockers__link inv-blockers__place" to={t.to}>
                {parts[1]}
              </Link>
              {parts[2]}
            </>
          ) : (
            <Link className="blockers__link" to={t.to}>
              {line}
            </Link>
          );
        } else if (t?.kind === "line" && props.onLine) {
          const { n, field } = t;
          const onLine = props.onLine;
          body = (
            <button
              type="button"
              className="blockers__link inv-blockers__jump"
              onClick={() => onLine(n, field)}
            >
              {line}
            </button>
          );
        } else if (t?.kind === "lines" && props.onLines) {
          const onLines = props.onLines;
          body = (
            <button type="button" className="blockers__link inv-blockers__jump" onClick={onLines}>
              {line}
            </button>
          );
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a code can repeat for different lines; the list is redrawn whole
          <li key={`${b.code}-${b.line ?? ""}-${i}`} className="blockers__item">
            <Alert size={16} />
            <span>{body}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The series with the slot its number takes at issue: "TH/INV/2627/" then an empty box. Decoration for the sentence that says it. */
function SeriesSlot({ preview }: { preview: InvoiceView["issue"]["preview"] }) {
  const p = seriesPreview(preview);
  return (
    <p className="inv-series" aria-hidden="true">
      <span className="docno">{p.before}</span>
      <span className="inv-slot inv-slot--lead" />
      {p.after && <span className="docno">{p.after}</span>}
    </p>
  );
}

/**
 * Issue (the owner, 07-R §3): the next number in the series and today's date, final once done. The draft is saved first (and saved once more when
 * its figures are out of date: a converted or "Start project" draft has no stored hash yet), then issued with the version and the content the
 * owner saw. A fresh code is asked for here when the step-up has lapsed.
 */
export function IssueDialog(props: {
  open: boolean;
  view: InvoiceView;
  issueDate: string;
  onClose: () => void;
  /** Saves what was typed (and the out-of-date figures); resolves with the view to issue, or null when it couldn't. */
  prepare: () => Promise<InvoiceView | null>;
  issue: (v: InvoiceView) => Promise<void>;
  onLine: (n: number, field: "description" | "sac") => void;
  onLines: () => void;
}) {
  const v = props.view;
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsCode = !stepUpActive();
  const blocked = v.blockers.length > 0 || !v.typeIssuable;
  const p = seriesPreview(v.issue.preview);

  function close() {
    setCode("");
    setCodeError(null);
    setError(null);
    props.onClose();
  }

  async function confirm() {
    if (needsCode && code.length !== 6) {
      setCodeError(CODE_MISSING);
      document.getElementById("issue-code")?.focus();
      return;
    }
    setCodeError(null);
    setError(null);
    setBusy(true);
    try {
      const ready = await props.prepare();
      if (!ready) return;
      if (ready.blockers.length > 0) return; // the dialog now lists them
      await withCode(needsCode ? code : undefined, () => props.issue(ready));
      setCode("");
    } catch (e) {
      setError(invErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const leave = (go: () => void) => () => {
    close();
    requestAnimationFrame(go);
  };

  return (
    <Modal open={props.open} title={INV_COPY.issueTitle} onClose={close} busy={busy}>
      <div className="dialog__body inv-issue">
        <SeriesSlot preview={v.issue.preview} />
        <p>
          <KeepDates text={issueBody(p.text, p.example, props.issueDate)} />
        </p>
        {blocked && v.blockers.length > 0 && (
          <div className="inv-issue__blocked">
            <p className="inv-issue__fix">{INV_COPY.fixFirst}</p>
            <BlockerList
              blockers={v.blockers}
              clientId={v.client.id}
              currency={v.client.currency}
              onLine={(n, field) => leave(() => props.onLine(n, field))()}
              onLines={leave(props.onLines)}
            />
          </div>
        )}
        {!v.typeIssuable && v.blockers.length === 0 && (
          <Notice tone="info">{INV_ERRORS.type_not_issuable}</Notice>
        )}
      </div>
      {needsCode && !blocked && (
        <CodeField
          id="issue-code"
          label="Authenticator code"
          hint="Enter the 6-digit code from your authenticator app to continue."
          value={code}
          onChange={setCode}
          error={codeError}
        />
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={close} disabled={busy}>
          {INV_COPY.cancel}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={confirm}
          disabled={busy || blocked}
          aria-busy={busy || undefined}
        >
          {busy ? "Working…" : INV_COPY.issue}
        </button>
      </div>
    </Modal>
  );
}

/** Request issue (Staff, 07-R §3): the owner gets a request; a change to the draft afterwards cancels it. */
export function RequestIssueDialog(props: {
  open: boolean;
  view: InvoiceView;
  onClose: () => void;
  onSend: () => Promise<void>;
  onLine: (n: number, field: "description" | "sac") => void;
  onLines: () => void;
}) {
  const v = props.view;
  const blocked = v.blockers.length > 0;
  return (
    <ConfirmDialog
      open={props.open}
      title={INV_COPY.requestTitle}
      confirmLabel={INV_COPY.sendRequest}
      cancelLabel={INV_COPY.cancel}
      onClose={props.onClose}
      disabled={blocked}
      onConfirm={async () => {
        try {
          await props.onSend();
        } catch (e) {
          throw invMapped(e);
        }
        return undefined;
      }}
    >
      <p>{INV_COPY.requestBody}</p>
      {blocked && (
        <div className="inv-issue__blocked">
          <p className="inv-issue__fix">{INV_COPY.fixFirst}</p>
          <BlockerList
            blockers={v.blockers}
            clientId={v.client.id}
            currency={v.client.currency}
            onLine={(n, field) => {
              props.onClose();
              requestAnimationFrame(() => props.onLine(n, field));
            }}
            onLines={() => {
              props.onClose();
              requestAnimationFrame(props.onLines);
            }}
          />
        </div>
      )}
    </ConfirmDialog>
  );
}

/** Void (the owner, 07-R §4): it keeps its number, the reason is required and kept, a fresh code confirms it. */
export function VoidDialog(props: {
  open: boolean;
  number: string;
  onClose: () => void;
  onVoid: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsCode = !stepUpActive();

  function close() {
    setReason("");
    setReasonError(null);
    setCode("");
    setCodeError(null);
    setError(null);
    props.onClose();
  }

  async function confirm() {
    const r = reason.trim();
    const noReason = r === "";
    const noCode = needsCode && code.length !== 6;
    setReasonError(noReason ? INV_COPY.voidReasonEmpty : null);
    setCodeError(noCode ? CODE_MISSING : null);
    if (noReason || noCode) {
      document.getElementById(noReason ? "void-reason" : "void-code")?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await withCode(needsCode ? code : undefined, () => props.onVoid(r));
      setReason("");
      setCode("");
    } catch (e) {
      setError(invErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={props.open} title={voidTitle(props.number)} onClose={close} busy={busy} tone="danger">
      <div className="dialog__body">
        <p>{INV_COPY.voidBody}</p>
        <FormField id="void-reason" label={INV_COPY.voidReason} error={reasonError}>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError && e.target.value.trim()) setReasonError(null);
              }}
            />
          )}
        </FormField>
      </div>
      {needsCode && (
        <CodeField
          id="void-code"
          label="Authenticator code"
          hint="Enter the 6-digit code from your authenticator app to continue."
          value={code}
          onChange={setCode}
          error={codeError}
        />
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={close} disabled={busy}>
          {INV_COPY.cancel}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={confirm}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Working…" : INV_COPY.voidConfirm}
        </button>
      </div>
    </Modal>
  );
}

/** "Delete this draft? It has no number yet, so nothing is lost from the series." (07-R §2): the question as the title, the reason beneath. */
const DELETE_Q = ((t: string) => {
  const i = t.indexOf("? ");
  return [t.slice(0, i + 1), t.slice(i + 2)] as const;
})(INV_COPY.deleteBody);

export function DeleteDraftDialog(props: {
  open: boolean;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={props.open}
      title={DELETE_Q[0]}
      tone="danger"
      confirmLabel={INV_COPY.deleteDraft}
      cancelLabel={INV_COPY.keepIt}
      onClose={props.onClose}
      onConfirm={async () => {
        try {
          await props.onDelete();
        } catch (e) {
          throw invMapped(e);
        }
        return undefined;
      }}
    >
      <p>{DELETE_Q[1]}</p>
    </ConfirmDialog>
  );
}
