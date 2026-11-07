// One request (M7.4 G.1; C.3, C.4, L28, L42, Q2 A): who it's from, its reply clock, its steps (received, acknowledged, identity checked, closed) and the
// close, in one dialog. The steps are a sequence, so they are an ordered list; a step not yet taken offers its button to Owner and Staff (`requests.log`).
// "Close request" turns the dialog into the close form (never a second dialog on top): the outcome, a decline reason (only the L28 ones for an erasure
// request that names only an address), the erase or anonymise that fulfilled a done erasure (read from the audit log: this contact's or this lead's,
// since the request arrived), and for a done access request the day its export was emailed (Q2 A). Only what the server accepts is offered: Done waits
// for the identity check on the L42 kinds and says why. Every refusal is worded from its code.
import "../../dp.css";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { type AuditEntry, api, RequestError } from "../../api.ts";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { StatusPill } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { Check } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import { ZR_CLOSE, ZR_DETAIL, ZR_REQ } from "../../lib/copy-zr.ts";
import { dateError } from "../../lib/date-field.ts";
import { type DeclineReason, m74Api, type RequestView } from "../../lib/m74-api.ts";
import {
  channelText,
  closeErrorText,
  closeOptions,
  dayText,
  erasureActionsOf,
  erasureMatches,
  exportSentAtOf,
  kindText,
  stateLook,
  subjectOf,
} from "../../lib/requests.ts";
import { useUser } from "../../session.tsx";
import { ReplyClock } from "./clock.tsx";

export function RequestDialog(props: {
  request: RequestView;
  now: number;
  onClose: () => void;
  /** A step was recorded or the request was closed: the list reloads (and the navigation's count follows). */
  onChanged: () => void;
}) {
  const [r, setR] = useState(props.request);
  const [seen, setSeen] = useState(props.request);
  // A fresher copy from the list replaces the local one (a reload after a step).
  if (seen !== props.request) {
    setSeen(props.request);
    setR(props.request);
  }
  const [mode, setMode] = useState<"view" | "close">("view");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={mode === "close" ? ZR_CLOSE.title : kindText(r.kind)}
      onClose={props.onClose}
      busy={busy}
      className="dialog--dp-request"
    >
      {mode === "view" ? (
        <RequestBody
          r={r}
          now={props.now}
          onStep={(next) => {
            setR(next);
            props.onChanged();
          }}
          onClose={props.onClose}
          onCloseRequest={() => setMode("close")}
        />
      ) : (
        <CloseForm
          r={r}
          setBusy={setBusy}
          onBack={() => setMode("view")}
          onClosed={() => {
            props.onChanged();
            props.onClose();
          }}
        />
      )}
    </Modal>
  );
}

function RequestBody(props: {
  r: RequestView;
  now: number;
  onStep: (next: RequestView) => void;
  onClose: () => void;
  onCloseRequest: () => void;
}) {
  const { r } = props;
  const user = useUser();
  const toast = useToast();
  const canStep = r.status === "open" && allowed(user.role, "requests.log");
  const [busy, setBusy] = useState<"acknowledged" | "identity_checked" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const refusal = useRefusalFocus();
  const who = subjectOf(r);
  const look = stateLook(r);
  const portal = r.channel === "portal";

  async function step(s: "acknowledged" | "identity_checked") {
    setBusy(s);
    setFailure(null);
    try {
      const done = await m74Api.step(r.id, s);
      toast("success", s === "acknowledged" ? ZR_DETAIL.ackDone : ZR_DETAIL.identityDone);
      props.onStep(
        s === "acknowledged"
          ? { ...r, acknowledgedAt: done.at, state: r.state === "ack_overdue" ? "open" : r.state }
          : // staff checked it (not the portal sign-in): any non-null "by" reads that way until the reload brings the member's id
            { ...r, identityCheckedAt: done.at, identityCheckedBy: r.identityCheckedBy ?? "me" },
      );
    } catch (e) {
      const already = e instanceof RequestError && e.code === "step_done";
      setFailure(already ? ZR_DETAIL.stepAlready : closeErrorText(e));
      refusal.show();
      if (already) props.onStep(r);
    } finally {
      setBusy(null);
    }
  }

  const steps: {
    key: string;
    title: string;
    done: boolean;
    when: string | null;
    extra?: string | null;
    action?: ReactNode;
  }[] = [
    {
      key: "received",
      title: ZR_DETAIL.stepReceived,
      done: true,
      when: r.receivedAt !== null ? dayText(r.receivedAt) : dayText(r.createdAt),
      extra: channelText(r.channel),
    },
    {
      key: "ack",
      title: ZR_DETAIL.stepAck,
      done: r.acknowledgedAt !== null,
      when: r.acknowledgedAt !== null ? dayText(r.acknowledgedAt) : null,
      extra: r.acknowledgedAt === null && r.state === "ack_overdue" ? ZR_REQ.ackLate : null,
      action:
        canStep && r.acknowledgedAt === null ? (
          <StepButton
            label={ZR_DETAIL.ackButton}
            hint={ZR_DETAIL.ackHint}
            busy={busy === "acknowledged"}
            disabled={busy !== null}
            onClick={() => void step("acknowledged")}
          />
        ) : null,
    },
    {
      key: "identity",
      title: ZR_DETAIL.stepIdentity,
      done: r.identityCheckedAt !== null,
      when: r.identityCheckedAt !== null ? dayText(r.identityCheckedAt) : null,
      extra:
        r.identityCheckedAt !== null && portal && r.identityCheckedBy === null
          ? ZR_DETAIL.identityByPortal
          : null,
      action:
        canStep && r.identityCheckedAt === null ? (
          <StepButton
            label={ZR_DETAIL.identityButton}
            hint={ZR_DETAIL.identityHint}
            busy={busy === "identity_checked"}
            disabled={busy !== null}
            onClick={() => void step("identity_checked")}
          />
        ) : null,
    },
    {
      key: "closed",
      title: ZR_DETAIL.stepClosed,
      done: r.status === "closed",
      when: r.closedAt !== null ? dayText(r.closedAt) : null,
      extra:
        r.status === "closed"
          ? [look.text, r.closedBy?.name ? ZR_DETAIL.closedBy(r.closedBy.name) : null]
              .filter(Boolean)
              .join(" ")
          : null,
    },
  ];

  const opts = closeOptions(r);
  return (
    <>
      <div className="dialog__body dp-req">
        <div className="dp-req__head">
          <StatusPill tone={look.tone} icon={look.icon}>
            {look.text}
          </StatusPill>
          {r.status === "open" && <ReplyClock r={r} now={props.now} wide />}
        </div>
        <dl className="dp-req__facts">
          <div>
            <dt>{ZR_DETAIL.from}</dt>
            <dd>
              {who.href ? (
                <Link to={who.href} onClick={props.onClose}>
                  {who.name}
                </Link>
              ) : (
                <span className="break">{who.name}</span>
              )}
              {who.meta && <span className="dp-req__meta break">{who.meta}</span>}
            </dd>
          </div>
          <div>
            <dt>{ZR_DETAIL.received}</dt>
            <dd>{r.receivedAt !== null ? dayText(r.receivedAt) : dayText(r.createdAt)}</dd>
          </div>
          <div>
            <dt>{ZR_DETAIL.channel}</dt>
            <dd>{channelText(r.channel)}</dd>
          </div>
          {/* the open request's reply date is its clock above; a closed one keeps the date as a fact */}
          {r.dueAt !== null && r.status !== "open" && (
            <div>
              <dt>{ZR_DETAIL.replyBy}</dt>
              <dd>{dayText(r.dueAt)}</dd>
            </div>
          )}
        </dl>
        <section className="dp-req__words" aria-labelledby="dp-req-words">
          <h3 id="dp-req-words" className="dp-req__h">
            {ZR_DETAIL.details}
          </h3>
          {r.details ? (
            <p className="dp-req__details">{r.details}</p>
          ) : (
            <p className="muted">{ZR_DETAIL.noDetails}</p>
          )}
        </section>
        <section aria-labelledby="dp-req-steps">
          <h3 id="dp-req-steps" className="dp-req__h">
            {ZR_DETAIL.steps}
          </h3>
          <ol className="dp-steps">
            {steps.map((s) => (
              <li key={s.key} className={s.done ? "dp-step dp-step--done" : "dp-step"}>
                <span className="dp-step__mark" aria-hidden="true">
                  {s.done && <Check size={16} />}
                </span>
                <div className="dp-step__body">
                  <p className="dp-step__title">
                    {s.title}
                    <span className="visually-hidden">
                      {s.done ? `: ${ZR_DETAIL.stepDone}` : `: ${ZR_DETAIL.stepNotYet}`}
                    </span>
                    {s.when && <span className="dp-step__when">{s.when}</span>}
                  </p>
                  {s.extra && <p className="dp-step__extra">{s.extra}</p>}
                  {!s.done && !s.action && s.key !== "closed" && (
                    <p className="dp-step__extra">{ZR_DETAIL.stepNotYet}</p>
                  )}
                  {s.action}
                </div>
              </li>
            ))}
          </ol>
        </section>
        {r.status === "closed" && <ClosedFacts r={r} />}
        {r.status === "open" && opts.needsAction && (
          <Notice tone="info">
            <p>{r.kind === "consent_withdrawal" ? ZR_DETAIL.withdrawalGuide : ZR_DETAIL.erasureGuide}</p>
            {who.href && (
              <Link to={who.href} className="btn btn--secondary" onClick={props.onClose}>
                {r.lead ? ZR_DETAIL.openLead : ZR_DETAIL.openContact}
              </Link>
            )}
          </Notice>
        )}
        {r.status === "open" && !r.canClose && <p className="dp-req__owner muted">{ZR_DETAIL.ownerOnly}</p>}
      </div>
      {failure && (
        <Notice tone="error" ref={refusal.ref}>
          {failure}
        </Notice>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy !== null}>
          {ZR_DETAIL.dismiss}
        </button>
        {r.canClose && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={props.onCloseRequest}
            disabled={busy !== null}
          >
            {ZR_DETAIL.closeButton}
          </button>
        )}
      </div>
    </>
  );
}

function StepButton(props: {
  label: string;
  hint: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const id = useId();
  return (
    <div className="dp-step__act">
      <button
        type="button"
        className="btn btn--secondary"
        onClick={props.onClick}
        disabled={props.disabled}
        aria-busy={props.busy || undefined}
        aria-describedby={`${id}-hint`}
      >
        {props.busy ? "Working…" : props.label}
      </button>
      <p className="dp-step__hint" id={`${id}-hint`}>
        {props.hint}
      </p>
    </div>
  );
}

function ClosedFacts({ r }: { r: RequestView }) {
  const rows: [string, string][] = [];
  if (r.declineReason)
    rows.push([ZR_DETAIL.declineReasonRow, ZR_CLOSE.reasons[r.declineReason] ?? r.declineReason]);
  if (r.exportSentAt !== null) rows.push([ZR_DETAIL.exportSentRow, dayText(r.exportSentAt)]);
  if (r.closeNote) rows.push([ZR_DETAIL.noteRow, r.closeNote]);
  if (rows.length === 0) return null;
  return (
    <dl className="dp-req__facts dp-req__facts--closed">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="break">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

type Erasures = { state: "loading" } | { state: "ready"; items: AuditEntry[] } | { state: "failed" };

function CloseForm(props: {
  r: RequestView;
  setBusy: (b: boolean) => void;
  onBack: () => void;
  onClosed: () => void;
}) {
  const { r } = props;
  const toast = useToast();
  const id = useId();
  const opts = closeOptions(r);
  const today = toIsoDate(istDate(Date.now()));
  const [outcome, setOutcome] = useState<"done" | "declined" | null>(opts.done === "ok" ? null : "declined");
  const [reason, setReason] = useState<DeclineReason | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [exportSent, setExportSent] = useState(false);
  const [sentOn, setSentOn] = useState(today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusyLocal] = useState(false);
  const [erasures, setErasures] = useState<Erasures>({ state: "loading" });
  // Full audit AU26: a consent withdrawal links its withdrawal, in its own words.
  const withdrawal = r.kind === "consent_withdrawal";
  const [tries, setTries] = useState(0);
  const dates = useUnreadDates<"sent">();
  const refusal = useRefusalFocus();

  // A done erasure links the erase or anonymise of its own person, made since the request arrived (read from the audit log, the Owner's to read).
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again only when the outcome turns to done or the person asks again (`tries`)
  useEffect(() => {
    if (!opts.needsAction || outcome !== "done") return;
    let live = true;
    const from = toIsoDate(istDate(r.receivedAt ?? r.createdAt));
    setErasures({ state: "loading" });
    Promise.all(erasureActionsOf(r).map((a) => api.audit({ action: a, from, limit: "50" }))).then(
      (pages) => {
        if (!live) return;
        const items = erasureMatches(
          pages.flatMap((p) => p.entries),
          r,
        );
        setErasures({ state: "ready", items });
        if (items.length === 1 && items[0]) setAction(items[0].id);
      },
      () => live && setErasures({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [outcome, tries]);

  function busyAll(b: boolean) {
    setBusyLocal(b);
    props.setBusy(b);
  }

  async function confirm() {
    const e: Record<string, string> = {};
    if (!outcome) e.outcome = ZR_CLOSE.outcomeMissing;
    if (outcome === "declined" && !reason) e.reason = ZR_CLOSE.reasonMissing;
    if (outcome === "done" && opts.needsAction && !action)
      e.action = withdrawal ? ZR_CLOSE.withdrawalMissing : ZR_CLOSE.actionMissing;
    let sentAt: number | null = null;
    if (outcome === "done" && opts.canRecordExport && exportSent) {
      const unread = dateError(dates.unread.sent);
      const v = unread ? null : exportSentAtOf(sentOn, Date.now());
      if (unread) e.sent = unread;
      else if (v === null) e.sent = ZR_CLOSE.exportSentMissing;
      else if (v === "future") e.sent = ZR_CLOSE.exportSentFuture;
      // Full audit AU25 L3: never before the IST day the request arrived (the server refuses it too).
      else if (sentOn < toIsoDate(istDate(r.receivedAt ?? r.createdAt))) e.sent = ZR_CLOSE.exportSentEarly;
      else sentAt = v;
    }
    setErrors(e);
    const first = ["outcome", "reason", "action", "sent"].find((k) => e[k]);
    if (first) {
      const target =
        first === "outcome"
          ? `${id}-done`
          : first === "reason"
            ? `${id}-reason-0`
            : first === "action"
              ? `${id}-action-0`
              : `${id}-sent`;
      document.getElementById(target)?.focus();
      return;
    }
    busyAll(true);
    setFailure(null);
    try {
      await m74Api.close(r.id, {
        outcome: outcome as "done" | "declined",
        note: note.trim() || null,
        ...(outcome === "declined" ? { declineReason: reason } : {}),
        ...(outcome === "done" && opts.needsAction ? { actionAuditId: action } : {}),
        ...(sentAt !== null ? { exportSentAt: sentAt } : {}),
      });
      toast("success", ZR_CLOSE.closed);
      props.onClosed();
    } catch (err) {
      busyAll(false);
      setFailure(closeErrorText(err));
      refusal.show();
    }
  }

  return (
    <>
      <div className="dialog__body dp-close">
        <p className="dp-close__what">
          <strong>{kindText(r.kind)}</strong>
          <span className="muted">{`, ${subjectOf(r).name}`}</span>
        </p>
        <fieldset className="radios" aria-describedby={errors.outcome ? `${id}-outcome-error` : undefined}>
          <legend>{ZR_CLOSE.outcome}</legend>
          <label className="radio">
            <input
              id={`${id}-done`}
              type="radio"
              name={`${id}-outcome`}
              checked={outcome === "done"}
              disabled={opts.done !== "ok"}
              aria-describedby={opts.done !== "ok" ? `${id}-done-why` : undefined}
              onChange={() => {
                setOutcome("done");
                setErrors({});
              }}
            />
            <span>{ZR_CLOSE.done}</span>
          </label>
          {opts.done !== "ok" && (
            <p className="dp-close__why" id={`${id}-done-why`}>
              {opts.done === "identity_first"
                ? ZR_CLOSE.identityFirst
                : opts.done === "unmatched_withdrawal"
                  ? ZR_CLOSE.unmatchedWithdrawal
                  : ZR_CLOSE.unmatchedErasure}
            </p>
          )}
          <label className="radio">
            <input
              id={`${id}-declined`}
              type="radio"
              name={`${id}-outcome`}
              checked={outcome === "declined"}
              onChange={() => {
                setOutcome("declined");
                setErrors({});
              }}
            />
            <span>{ZR_CLOSE.declined}</span>
          </label>
          {errors.outcome && <FieldError id={`${id}-outcome-error`}>{errors.outcome}</FieldError>}
        </fieldset>

        {outcome === "declined" && (
          <fieldset
            className="radios dp-close__group"
            aria-describedby={errors.reason ? `${id}-reason-error` : `${id}-reason-hint`}
          >
            <legend>{ZR_CLOSE.reason}</legend>
            <p className="hint" id={`${id}-reason-hint`}>
              {ZR_CLOSE.declinedHint}
            </p>
            {opts.reasons.map((k, i) => (
              <label key={k} className="radio">
                <input
                  id={`${id}-reason-${i}`}
                  type="radio"
                  name={`${id}-reason`}
                  checked={reason === k}
                  onChange={() => {
                    setReason(k);
                    setErrors((x) => ({ ...x, reason: "" }));
                  }}
                />
                <span>{ZR_CLOSE.reasons[k] ?? k}</span>
              </label>
            ))}
            {errors.reason && <FieldError id={`${id}-reason-error`}>{errors.reason}</FieldError>}
          </fieldset>
        )}

        {outcome === "done" && opts.needsAction && (
          <fieldset
            className="radios dp-close__group"
            aria-describedby={errors.action ? `${id}-action-error` : undefined}
          >
            <legend>{withdrawal ? ZR_CLOSE.withdrawalAction : ZR_CLOSE.action}</legend>
            {erasures.state === "loading" && (
              <p className="muted" role="status">
                {withdrawal ? ZR_CLOSE.withdrawalLoading : ZR_CLOSE.actionLoading}
              </p>
            )}
            {erasures.state === "failed" && (
              <Notice tone="error">
                <p>{ZR_CLOSE.actionFailed}</p>
                <button type="button" className="btn btn--secondary" onClick={() => setTries((n) => n + 1)}>
                  Try again
                </button>
              </Notice>
            )}
            {erasures.state === "ready" && erasures.items.length === 0 && (
              <p className="dp-close__why">{withdrawal ? ZR_CLOSE.withdrawalNone : ZR_CLOSE.actionNone}</p>
            )}
            {erasures.state === "ready" &&
              erasures.items.map((a, i) => (
                <label key={a.id} className="radio">
                  <input
                    id={`${id}-action-${i}`}
                    type="radio"
                    name={`${id}-action`}
                    checked={action === a.id}
                    onChange={() => {
                      setAction(a.id);
                      setErrors((x) => ({ ...x, action: "" }));
                    }}
                  />
                  <span>
                    {withdrawal
                      ? ZR_CLOSE.withdrawalOption(dayText(a.at), a.actorName)
                      : ZR_CLOSE.actionOption(
                          a.action === "contact.anonymise" ? "anonymise" : "erase",
                          dayText(a.at),
                          a.actorName,
                        )}
                  </span>
                </label>
              ))}
            {errors.action && <FieldError id={`${id}-action-error`}>{errors.action}</FieldError>}
          </fieldset>
        )}

        {outcome === "done" && opts.canRecordExport && (
          <div className="dp-close__group">
            <label className="check dp-close__check">
              <input
                type="checkbox"
                checked={exportSent}
                aria-describedby={`${id}-export-hint`}
                onChange={(e) => setExportSent(e.target.checked)}
              />
              <span>{ZR_CLOSE.exportSent}</span>
            </label>
            <p className="hint dp-close__hint" id={`${id}-export-hint`}>
              {ZR_CLOSE.exportSentHint}
            </p>
            {exportSent && (
              <FormField id={`${id}-sent`} label={ZR_CLOSE.exportSentOn} error={errors.sent}>
                {(a) => (
                  <DateField
                    {...a}
                    {...dates.bind("sent")}
                    value={sentOn}
                    max={today}
                    onChange={(v) => {
                      setSentOn(v);
                      setErrors((x) => ({ ...x, sent: "" }));
                    }}
                  />
                )}
              </FormField>
            )}
          </div>
        )}

        <FormField id={`${id}-note`} label={ZR_CLOSE.note} hint={ZR_CLOSE.noPersonalData} optional>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </FormField>
      </div>
      {failure && (
        <Notice tone="error" ref={refusal.ref}>
          {failure}
        </Notice>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onBack} disabled={busy}>
          {ZR_DETAIL.back}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void confirm()}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Working…" : ZR_CLOSE.confirm}
        </button>
      </div>
    </>
  );
}
