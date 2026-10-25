// The acceptance block (ADM-PROP-08, ADM-PROP-10, POR-05): on an open version, type your full name, tick "I have read
// and agree to the terms" and press Accept; a confirmation step shows exactly what is being accepted; then the version is
// locked and shows the record, with the two downloads. Or decline with a reason (decline-dialog.tsx). Expired versions
// can't be accepted. After a decision focus moves to the result, so a screen-reader user hears what happened.
import { formatDate, formatIstDateTime } from "@techaust/core";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { PENDING, WORDS } from "../../copy-documents.ts";
import { amount, type DocumentView } from "../../lib/document-view.ts";
import { ConfirmDialog } from "../dialog.tsx";
import { Alert, CheckCircle, Download, Lock, XCircle } from "../icons.tsx";
import { Ph } from "../pending.tsx";
import { FieldError } from "../ui.tsx";
import { DeclineDialog } from "./decline-dialog.tsx";

export type DecisionProps = {
  doc: DocumentView;
  /** The signed-in contact (or, on the token view, the person the link was sent to). */
  me: { name: string; email: string };
  /** Records the acceptance. Throws an Error whose message is shown in the confirmation step. */
  onAccept: (typedName: string) => Promise<void>;
  /** Records the decline. Throws an Error whose message is shown. */
  onDecline: (reason: string, note: string | null) => Promise<void>;
  onDownload: (what: "accepted" | "certificate") => void;
};

const OPEN = new Set(["sent", "viewed"]);

export function DecisionPanel(props: DecisionProps) {
  const { doc } = props;
  const kind = WORDS.kind[doc.kind].toLowerCase();
  const result = useRef<HTMLHeadingElement>(null);
  const was = useRef(doc.status);
  // A decision made here: focus the result (after the dialog has closed and tried to return focus to its opener).
  useEffect(() => {
    if (OPEN.has(was.current) && !OPEN.has(doc.status)) result.current?.focus();
    was.current = doc.status;
  }, [doc.status]);

  if (doc.status === "accepted" && doc.acceptance) {
    const a = doc.acceptance;
    const mine = a.email === props.me.email;
    return (
      <div className="record record--accepted">
        <h3 className="record__title" ref={result} tabIndex={-1}>
          <CheckCircle size={24} />
          <span>
            <Ph>{mine ? PENDING.acceptedTitle(kind) : PENDING.acceptedByOtherTitle(kind, a.name)}</Ph>
          </span>
        </h3>
        <dl className="facts facts--record">
          <div>
            <dt>{PENDING.fields.acceptedBy}</dt>
            <dd>{a.name}</dd>
          </div>
          <div>
            <dt>{PENDING.fields.email}</dt>
            <dd className="break">{a.email}</dd>
          </div>
          <div>
            <dt>{PENDING.fields.when}</dt>
            <dd>{formatIstDateTime(a.atMs)}</dd>
          </div>
          <div>
            <dt>{WORDS.doc.version}</dt>
            <dd>
              {doc.number}, {WORDS.doc.version.toLowerCase()} {doc.version}
            </dd>
          </div>
          <div>
            <dt>{PENDING.fields.fingerprint}</dt>
            <dd className="nowrap">{a.fingerprint}</dd>
          </div>
        </dl>
        <p className="record__lock">
          <Lock size={20} />
          <span>
            <Ph>{PENDING.locked}</Ph>
          </span>
        </p>
        <p>
          <Ph>{PENDING.next}</Ph>
        </p>
        <div className="record__actions">
          <button type="button" className="btn btn--secondary" onClick={() => props.onDownload("accepted")}>
            <Download size={20} />
            {WORDS.downloadAccepted}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => props.onDownload("certificate")}
          >
            <Download size={20} />
            {WORDS.downloadCertificate}
          </button>
        </div>
      </div>
    );
  }

  if (doc.status === "declined" && doc.decline) {
    const d = doc.decline;
    return (
      <div className="record record--declined">
        <h3 className="record__title" ref={result} tabIndex={-1}>
          <XCircle size={24} />
          <span>
            <Ph>{PENDING.declinedTitle(kind)}</Ph>
          </span>
        </h3>
        <dl className="facts facts--record">
          <div>
            <dt>{PENDING.fields.declinedBy}</dt>
            <dd>{d.name}</dd>
          </div>
          <div>
            <dt>{PENDING.fields.when}</dt>
            <dd>{formatIstDateTime(d.atMs)}</dd>
          </div>
          <div>
            <dt>{PENDING.fields.reason}</dt>
            <dd>
              {d.reason}
              {d.note && <span className="block muted">{d.note}</span>}
            </dd>
          </div>
        </dl>
        <p>
          <Ph>{PENDING.declinedBody(kind)}</Ph>
        </p>
      </div>
    );
  }

  if (doc.status === "expired") {
    return (
      <div className="notice notice--warning" role="note">
        <Alert size={20} />
        <div>
          <Ph>{PENDING.expired(kind, formatDate(doc.validUntil))}</Ph>
        </div>
      </div>
    );
  }

  return <AcceptForm {...props} kind={kind} />;
}

function AcceptForm(props: DecisionProps & { kind: string }) {
  const { doc, kind } = props;
  const nameId = useId();
  const agreeId = useId();
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<{ name?: string | undefined; agree?: string | undefined } | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [declining, setDeclining] = useState(false);
  const summary = useRef<HTMLDivElement>(null);

  function check() {
    const e: { name?: string | undefined; agree?: string | undefined } = {};
    if (!name.trim()) e.name = PENDING.nameMissing;
    if (!agree) e.agree = PENDING.agreeMissing;
    return e;
  }

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = check();
    if (e.name || e.agree) {
      setErrors(e);
      // The error summary takes focus (docs/06 §5.3 ErrorSummary); its links go to each field.
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    setErrors(null);
    setConfirming(true);
  }

  const nameError = errors?.name;
  const agreeError = errors?.agree;
  return (
    <div className="decide">
      <p className="prose">
        <Ph>{PENDING.acceptIntro(kind)}</Ph>
      </p>
      <form className="decide__form" noValidate onSubmit={submit}>
        <p className="hint decide__all">{WORDS.allNeeded}</p>
        {errors && (nameError || agreeError) && (
          <div
            className="error-summary"
            ref={summary}
            tabIndex={-1}
            role="alert"
            aria-labelledby={`${nameId}-sum`}
          >
            <p id={`${nameId}-sum`} className="error-summary__title">
              <Alert size={20} />
              <span>
                <Ph>{PENDING.errorsTitle}</Ph>
              </span>
            </p>
            <ul>
              {nameError && (
                <li>
                  <a href={`#${nameId}`}>{nameError}</a>
                </li>
              )}
              {agreeError && (
                <li>
                  <a href={`#${agreeId}`}>{agreeError}</a>
                </li>
              )}
            </ul>
          </div>
        )}
        <div className="field">
          <label htmlFor={nameId}>{PENDING.fullName}</label>
          <p className="hint" id={`${nameId}-hint`}>
            <Ph>{PENDING.nameHint}</Ph>
          </p>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() =>
              errors && setErrors({ ...errors, name: name.trim() ? undefined : PENDING.nameMissing })
            }
            autoComplete="name"
            autoCapitalize="words"
            spellCheck={false}
            maxLength={120}
            required
            aria-invalid={nameError ? true : undefined}
            aria-describedby={`${nameId}-hint${nameError ? ` ${nameId}-error` : ""}`}
          />
          {nameError && <FieldError id={`${nameId}-error`}>{nameError}</FieldError>}
        </div>
        <div className="check">
          <input
            type="checkbox"
            id={agreeId}
            checked={agree}
            onChange={(e) => {
              setAgree(e.target.checked);
              if (errors)
                setErrors({ ...errors, agree: e.target.checked ? undefined : PENDING.agreeMissing });
            }}
            required
            aria-invalid={agreeError ? true : undefined}
            aria-describedby={agreeError ? `${agreeId}-error` : undefined}
          />
          <label htmlFor={agreeId}>{WORDS.agree}</label>
        </div>
        <p className="check__more">
          <a href="#terms">{PENDING.readTerms}</a>
        </p>
        {agreeError && <FieldError id={`${agreeId}-error`}>{agreeError}</FieldError>}
        <div className="decide__actions">
          <button type="submit" className="btn btn--primary">
            <CheckCircle size={20} />
            {WORDS.accept}
          </button>
        </div>
      </form>
      <div className="decide__decline">
        <p className="hint">
          <Ph>{PENDING.declineHint(kind)}</Ph>
        </p>
        <button type="button" className="btn btn--secondary" onClick={() => setDeclining(true)}>
          {PENDING.decline}
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={<Ph>{PENDING.confirmTitle(kind)}</Ph>}
        confirmLabel={WORDS.accept}
        busyLabel={PENDING.accepting}
        onConfirm={async () => {
          await props.onAccept(name.trim());
          setConfirming(false);
        }}
        onClose={() => setConfirming(false)}
      >
        <p>
          <Ph>{PENDING.confirmLead}</Ph>
        </p>
        <dl className="facts facts--confirm">
          <div>
            <dt>{WORDS.kind[doc.kind]}</dt>
            <dd>{doc.title}</dd>
          </div>
          <div>
            <dt>{WORDS.doc.number}</dt>
            <dd>
              {doc.number}, {WORDS.doc.version.toLowerCase()} {doc.version}
            </dd>
          </div>
          <div>
            <dt>{WORDS.doc.total}</dt>
            <dd className="num-strong">{amount(doc.computed.totalMinor, doc.currency)}</dd>
          </div>
          <div>
            <dt>{PENDING.fields.acceptedBy}</dt>
            <dd>
              {name.trim()}
              <span className="block muted break">{props.me.email}</span>
            </dd>
          </div>
        </dl>
        <p className="confirm__binding">{WORDS.binding}</p>
      </ConfirmDialog>

      <DeclineDialog
        open={declining}
        kind={kind}
        onClose={() => setDeclining(false)}
        onDecline={async (reason, note) => {
          await props.onDecline(reason, note);
          setDeclining(false);
        }}
      />
    </div>
  );
}
