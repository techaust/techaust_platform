// The acceptance block (ADM-PROP-08, ADM-PROP-10, POR-05): on an open version, type your full name, tick "I have read and agree to the
// terms" and press Accept; a confirmation step shows exactly what is being accepted; then the version is locked and shows the record,
// with the accepted PDF and the acceptance certificate. Or decline with a reason (decline-dialog.tsx). An expired version, or one whose
// newer version is still being prepared, can't be accepted. After a decision focus moves to the result, so a screen-reader user hears
// what happened. Words: 07-N §3 (approved with 07-Q, 2026-10-26); the binding sentence 07-A §7; the record notice 07-A §9 (Researched 2026-10-28,
// 08-C RB-19; the ground for recording the IP address and browser: Settled by the lead on the safest reading, 2026-10-30 (08-C RB-12): DPDP s.7(a) with the Rule 6 log duty, kept 13 months; GDPR Art. 6(1)(f) for EU and UK persons).
// FX-3 (A4 1, 2, 8): once the form has been checked, each error follows the field as it changes (never on blur), so the
// line can't vanish under the pointer between pressing and releasing Accept; the whole agreement row is the checkbox's
// label (44 px); the number in the confirmation never breaks.
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import type { OfferKind, OfferStatus } from "../../api.ts";
import { N, NOTICES, WORDS } from "../../copy-documents.ts";
import { formatIstDateTime, kindWord } from "../../lib/offers.ts";
import { ConfirmDialog } from "../dialog.tsx";
import { Alert, CheckCircle, Clock, Download, Lock, XCircle } from "../icons.tsx";
import { FieldError } from "../ui.tsx";
import { DeclineDialog, type DeclineReason } from "./decline-dialog.tsx";

/** What the block shows and offers; everything comes from the API (the page builds it). */
export type DecisionModel = {
  kind: OfferKind;
  title: string;
  numberDisplay: string;
  version: number;
  /** The grand total, as formatted on the document. */
  total: string;
  status: OfferStatus;
  /** "06 Oct 2026". */
  validUntil: string;
  acceptance: { typedName: string; email: string; acceptedAt: number; fingerprint: string } | null;
  /** True when the person looking accepted it (signed in as that contact, or they just pressed Accept here). */
  acceptedByMe: boolean;
  decline: { reason: string | null; note: string | null; at: number | null; by: string | null } | null;
  /** The email the record will carry, when known (signed in); the link view doesn't know it. */
  myEmail: string | null;
};

export type DecisionProps = {
  model: DecisionModel;
  /** Records the acceptance. Throws an Error whose message is shown in the confirmation step. */
  onAccept: (typedName: string) => Promise<void>;
  /** Records the decline. Throws an Error whose message is shown. */
  onDecline: (reason: DeclineReason, note: string | null) => Promise<void>;
  onDownload: (what: "accepted" | "certificate") => void;
  /** Which download is in flight, if any. */
  downloading: "pdf" | "accepted" | "certificate" | null;
};

const OPEN = new Set<OfferStatus>(["sent", "viewed"]);

/** The first 12 hex characters of the PDF's SHA-256 (as the PDF's integrity line and the admin show it). */
const short = (sha: string) => sha.slice(0, 12);

export function DecisionPanel(props: DecisionProps) {
  const { model } = props;
  const kind = kindWord(model.kind);
  const result = useRef<HTMLHeadingElement>(null);
  const was = useRef(model.status);
  // A decision made here: focus the result (after the dialog has closed and tried to return focus to its opener).
  useEffect(() => {
    if (OPEN.has(was.current) && !OPEN.has(model.status)) result.current?.focus();
    was.current = model.status;
  }, [model.status]);

  if (model.acceptance) {
    const a = model.acceptance;
    return (
      <div className="record record--accepted">
        <h3 className="record__title" ref={result} tabIndex={-1}>
          <CheckCircle size={24} />
          <span>
            {model.acceptedByMe ? N.acceptedTitle(kind) : N.acceptedByOtherTitle(a.typedName, kind)}
          </span>
        </h3>
        <dl className="facts facts--record">
          <div>
            <dt>{N.fields.acceptedBy}</dt>
            <dd>{a.typedName}</dd>
          </div>
          <div>
            <dt>{N.fields.email}</dt>
            <dd className="break">{a.email}</dd>
          </div>
          <div>
            <dt>{N.fields.when}</dt>
            <dd>{formatIstDateTime(a.acceptedAt)}</dd>
          </div>
          <div>
            <dt>{WORDS.doc.version}</dt>
            <dd>
              {model.numberDisplay} v{model.version}
            </dd>
          </div>
          <div>
            <dt>{N.fields.fingerprint}</dt>
            <dd className="nowrap mono">{short(a.fingerprint)}</dd>
          </div>
        </dl>
        <p className="record__lock">
          <Lock size={20} />
          <span>{N.locked}</span>
        </p>
        <p>{N.next}</p>
        <div className="record__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => props.onDownload("accepted")}
            disabled={props.downloading === "accepted"}
            aria-busy={props.downloading === "accepted" || undefined}
          >
            <Download size={20} />
            {WORDS.downloadAccepted}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => props.onDownload("certificate")}
            disabled={props.downloading === "certificate"}
            aria-busy={props.downloading === "certificate" || undefined}
          >
            <Download size={20} />
            {WORDS.downloadCertificate}
          </button>
        </div>
      </div>
    );
  }

  if (model.status === "declined") {
    const d = model.decline;
    const reason = d?.reason ? ((N.reasons as Record<string, string>)[d.reason] ?? d.reason) : null;
    return (
      <div className="record record--declined">
        <h3 className="record__title" ref={result} tabIndex={-1}>
          <XCircle size={24} />
          <span>{N.declinedTitle(kind)}</span>
        </h3>
        <dl className="facts facts--record">
          {d?.by && (
            <div>
              <dt>{N.fields.declinedBy}</dt>
              <dd>{d.by}</dd>
            </div>
          )}
          {d?.at && (
            <div>
              <dt>{N.fields.when}</dt>
              <dd>{formatIstDateTime(d.at)}</dd>
            </div>
          )}
          {reason && (
            <div>
              <dt>{N.fields.reason}</dt>
              <dd>
                {reason}
                {d?.note && <span className="line muted">{d.note}</span>}
              </dd>
            </div>
          )}
        </dl>
        <p>{N.declinedBody}</p>
      </div>
    );
  }

  if (model.status === "expired") {
    return (
      <div className="notice notice--warning" role="note">
        <Alert size={20} />
        <div>{N.expired(kind, model.validUntil)}</div>
      </div>
    );
  }

  if (model.status === "revised") {
    return (
      <div className="notice notice--info" role="note">
        <Clock size={20} />
        <div>{N.preparing}</div>
      </div>
    );
  }

  return <AcceptForm {...props} kind={kind} />;
}

const NAME_MAX = 120;

function AcceptForm(props: DecisionProps & { kind: string }) {
  const { model, kind } = props;
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
    if (name.trim().length < 2) e.name = N.nameMissing;
    if (!agree) e.agree = N.agreeMissing;
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
  const typed = name.replace(/\s+/g, " ").trim();
  return (
    <div className="decide">
      <p className="prose">{N.acceptIntro}</p>
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
              <span>{N.errorsTitle}</span>
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
          <label htmlFor={nameId}>{N.fullName}</label>
          <p className="hint" id={`${nameId}-hint`}>
            {N.nameHint}
          </p>
          <input
            id={nameId}
            value={name}
            onChange={(e) => {
              const v = e.target.value;
              setName(v);
              if (errors) setErrors({ ...errors, name: v.trim().length >= 2 ? undefined : N.nameMissing });
            }}
            autoComplete="name"
            autoCapitalize="words"
            spellCheck={false}
            maxLength={NAME_MAX}
            required
            aria-invalid={nameError ? true : undefined}
            aria-describedby={`${nameId}-hint${nameError ? ` ${nameId}-error` : ""}`}
          />
          {nameError && <FieldError id={`${nameId}-error`}>{nameError}</FieldError>}
        </div>
        <label className="check" htmlFor={agreeId}>
          <input
            type="checkbox"
            id={agreeId}
            checked={agree}
            onChange={(e) => {
              setAgree(e.target.checked);
              if (errors) setErrors({ ...errors, agree: e.target.checked ? undefined : N.agreeMissing });
            }}
            required
            aria-invalid={agreeError ? true : undefined}
            aria-describedby={agreeError ? `${agreeId}-error` : undefined}
          />
          <span className="check__text">{WORDS.agree}</span>
        </label>
        <p className="check__more">
          <a href="#terms">{N.readTerms}</a>
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
        <p className="hint">{N.declineHint}</p>
        <button type="button" className="btn btn--secondary" onClick={() => setDeclining(true)}>
          {N.decline}
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={N.confirmTitle(kind)}
        confirmLabel={WORDS.accept}
        busyLabel={N.accepting}
        cancelLabel={N.back}
        onConfirm={async () => {
          await props.onAccept(typed);
          setConfirming(false);
        }}
        onClose={() => setConfirming(false)}
      >
        <p>{N.confirmLead}</p>
        <dl className="facts facts--confirm">
          <div>
            <dt>{WORDS.kind[model.kind]}</dt>
            <dd>{model.title}</dd>
          </div>
          <div>
            <dt>{WORDS.doc.number}</dt>
            <dd>
              <span className="nowrap">{model.numberDisplay}</span> v{model.version}
            </dd>
          </div>
          <div>
            <dt>{WORDS.doc.total}</dt>
            <dd className="num-strong">{model.total}</dd>
          </div>
          <div>
            <dt>{N.fields.acceptedBy}</dt>
            <dd>
              {typed}
              {model.myEmail && <span className="line muted break">{model.myEmail}</span>}
            </dd>
          </div>
        </dl>
        <p className="confirm__binding">{WORDS.binding(kind)}</p>
        <p className="hint confirm__record">{NOTICES.accept}</p>
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
