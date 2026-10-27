// M5.4 on an issued invoice, proforma, credit note or debit note (ADM-INV-15, ADM-INV-13, POR-06; Q42, Q44, Q47, Q48, Q50): emailing it to the client's
// contacts with portal access (the dialog shows the email as it will go), the emails sent so far with their status, "Revoke links", and the payment
// reminders as a schedule around the due date with pause and resume. On a care invoice: the plan and the period it bills, and on a draft why the system
// didn't issue it by itself (ADM-CARE-02, Q43). Everything shown is the API's (GET /invoices/:id, GET /clients/:id); the words are 07-U's, marked until
// the owner approves them (lib/invoice-send.ts).
import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type ContactView, RequestError } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { Modal } from "../../components/dialog.tsx";
import { StatusPill } from "../../components/display.tsx";
import { Switch } from "../../components/form.tsx";
import {
  Alert,
  Check,
  Clock,
  FileText,
  LifeBuoy,
  Lock,
  Mail,
  Pause,
  Play,
  Send,
} from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import {
  BILLING_FROM,
  CARE_COPY,
  draftedBecause,
  hasReminders,
  invoiceRecipientChoices,
  MAX_RECIPIENTS,
  periodText,
  previewBody,
  previewFacts,
  previewSubject,
  REMINDER_COPY,
  type ReminderRowView,
  reminderActions,
  reminderDayLabel,
  reminderState,
  reminderStateText,
  remindersOf,
  SEND_COPY,
  sendErrorText,
  sendMapped,
  sendState,
  sendStateLabel,
  sendStateLook,
  sendWhen,
} from "../../lib/invoice-send.ts";
import { type InvoiceM54, type InvoiceView, invoicesApi, type SendResult } from "../../lib/invoices-api.ts";

export type SendableView = InvoiceView &
  InvoiceM54 & {
    parentLink?: { number: string | null; balanceMinor?: number | null } | null;
    noteOf?: { reason?: { code: string; text: string } | null } | null;
  };

type Loaded =
  | { state: "loading" }
  | { state: "failed"; error: unknown }
  | { state: "ready"; contacts: ContactView[]; attachDefault: boolean };

/** "Email {document} {number}": the client's contacts with portal access (billing contacts ticked, up to five), "Attach the PDF", and the email as it will go. */
export function InvoiceSendDialog(props: {
  open: boolean;
  view: SendableView;
  onClose: () => void;
  onSent: (r: SendResult) => void;
}) {
  const { open, view: v } = props;
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [attach, setAttach] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const groupId = useId();
  const attachId = useId();
  const clientId = v.client.id;

  // The contacts and the client's "Attach PDF" setting (the switch's starting position), read when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoaded({ state: "loading" });
    setError(null);
    setInvalid(new Set());
    api.client(clientId).then(
      (page) => {
        if (!alive) return;
        const { ticked } = invoiceRecipientChoices(page.contacts);
        const attachDefault = page.client.attachPdf === true;
        setPicked(new Set(ticked));
        setAttach(attachDefault);
        setLoaded({ state: "ready", contacts: page.contacts, attachDefault });
      },
      (e: unknown) => alive && setLoaded({ state: "failed", error: e }),
    );
    return () => {
      alive = false;
    };
  }, [open, clientId]);

  const choices = loaded.state === "ready" ? invoiceRecipientChoices(loaded.contacts).choices : [];
  const noneCan = loaded.state === "ready" && !choices.some((c) => c.block === null);
  // H1: some have portal access but none can see finance: say what to turn on (not "no portal access").
  const noneWithFinance = noneCan && choices.some((c) => c.block === "no_finance");
  const firstPicked = choices.find((c) => picked.has(c.id));
  const firstName = firstPicked ? (firstPicked.name.trim().split(/\s+/)[0] ?? "") : "";
  const facts = previewFacts({
    type: v.type,
    number: v.number,
    issueDate: v.issueDate,
    dueDate: v.dueDate,
    totalMinor: v.totals?.totalMinor ?? null,
    currency: v.currency,
    parentNumber: v.parentLink?.number ?? null,
    reason: v.noteOf?.reason ?? null,
    parentBalanceMinor: v.type === "credit_note" ? (v.parentLink?.balanceMinor ?? null) : null,
  });
  const body = previewBody(facts, firstName || "…", attach);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || loaded.state !== "ready") return;
    if (picked.size === 0) {
      setError(SEND_COPY.chooseOne);
      document.getElementById(`${groupId}-0`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await invoicesApi.send(
        v.id,
        choices.filter((c) => picked.has(c.id)).map((c) => c.id),
        attach,
      );
      props.onSent(r);
    } catch (err) {
      if (err instanceof RequestError && err.code === "recipient_invalid" && err.extra.contactIds?.length)
        setInvalid(new Set(err.extra.contactIds));
      setError(sendErrorText(err, v.type));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={SEND_COPY.dialogTitle(v.type, v.number ?? "")}
      onClose={props.onClose}
      busy={busy}
      wide
    >
      <form className="sendd" noValidate onSubmit={submit}>
        <div className="sendd__form">
          {loaded.state === "loading" && (
            <p className="hint" role="status">
              Loading…
            </p>
          )}
          {loaded.state === "failed" && <Notice tone="error">{sendErrorText(loaded.error, v.type)}</Notice>}
          {noneCan && (
            <Notice tone="info">
              {noneWithFinance ? SEND_COPY.noneWithFinance : SEND_COPY.noneWithPortal}{" "}
              <Link to={`/clients/${encodeURIComponent(clientId)}?tab=contacts`} onClick={props.onClose}>
                {SEND_COPY.contactsTab}
              </Link>
            </Notice>
          )}
          {loaded.state === "ready" && (
            <>
              <fieldset
                className="radios sendd__to"
                aria-describedby={`${groupId}-hint${error ? ` ${groupId}-error` : ""}`}
              >
                <legend>{SEND_COPY.sendTo}</legend>
                <p className="hint" id={`${groupId}-hint`}>
                  {SEND_COPY.sendToHint}
                </p>
                {choices.map((c, i) => {
                  const bad = invalid.has(c.id);
                  // At most five: once five are ticked, the others wait (the server refuses a sixth).
                  const full = picked.size >= MAX_RECIPIENTS && !picked.has(c.id);
                  const why = `${groupId}-why-${i}`;
                  const described = [c.block ? why : "", bad ? `${groupId}-bad-${i}` : ""]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <label key={c.id} className={`check sendd__contact${c.block ? " is-off" : ""}`}>
                      <input
                        id={`${groupId}-${i}`}
                        type="checkbox"
                        checked={picked.has(c.id)}
                        disabled={c.block !== null || busy || full}
                        aria-invalid={bad || undefined}
                        aria-describedby={described || undefined}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(c.id);
                          else next.delete(c.id);
                          setPicked(next);
                          setError(null);
                        }}
                      />
                      <span>
                        <span className="sendd__name">{c.name}</span>
                        <span className="sendd__meta">{c.email}</span>
                        {c.block && (
                          <span className="sendd__meta sendd__why" id={why}>
                            {c.block === "no_portal" ? SEND_COPY.noPortal : SEND_COPY.noFinance}
                          </span>
                        )}
                        {bad && (
                          <span className="sendd__bad" id={`${groupId}-bad-${i}`}>
                            {sendErrorText(new RequestError(409, "recipient_invalid", ""), v.type)}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
                {error && <FieldError id={`${groupId}-error`}>{error}</FieldError>}
              </fieldset>
              <div className="sendd__attach">
                <div>
                  <p className="sendd__label" id={`${attachId}-label`}>
                    {SEND_COPY.attach}
                  </p>
                  <p className="hint" id={`${attachId}-hint`}>
                    {SEND_COPY.attachHint}
                  </p>
                </div>
                <Switch
                  id={attachId}
                  checked={attach}
                  onChange={setAttach}
                  labelledBy={`${attachId}-label`}
                  describedBy={`${attachId}-hint`}
                  disabled={busy}
                />
              </div>
            </>
          )}
        </div>
        <section className="sendd__preview" aria-labelledby={`${groupId}-pv`}>
          <h3 id={`${groupId}-pv`} className="sendd__label">
            {SEND_COPY.message}
          </h3>
          <dl className="sendd__head">
            <div>
              <dt>{SEND_COPY.from}</dt>
              <dd>{BILLING_FROM}</dd>
            </div>
            <div>
              <dt>{SEND_COPY.subject}</dt>
              <dd className="inv-subject">{previewSubject(facts)}</dd>
            </div>
          </dl>
          <div className="sendd__body">
            {body.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
            <p>{body.closing}</p>
            <p>
              <span className="sendd__btn">{body.button}</span>
            </p>
          </div>
        </section>
        <div className="dialog__actions sendd__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            {SEND_COPY.cancel}
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || loaded.state !== "ready" || noneCan}
            aria-busy={busy || undefined}
          >
            <Send size={20} />
            {busy ? SEND_COPY.sending : SEND_COPY.send}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const PILL_ICON = { clock: "clock", send: "send", check: "check", ban: "ban" } as const;

/**
 * H2 (WCAG 2.4.3): an action that swaps or removes the control that had focus (Pause becomes Resume, Revoke goes) moves focus to what replaced it, or
 * to the panel's heading, once the page has the new view. `focusNext` is called before the reload; the pick runs when `view` changes.
 */
function useFocusAfterReload(view: unknown) {
  const pending = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const pick = pending.current;
    if (!pick || view === undefined) return;
    pending.current = null;
    pick()?.focus();
  }, [view]);
  return (pick: () => HTMLElement | null) => {
    pending.current = pick;
  };
}

/** The connected element, else null (a control the new view no longer draws). */
const connected = <E extends HTMLElement>(el: E | null): E | null => (el?.isConnected ? el : null);

/** The emails of the document (newest first) with "Email to client" (first time) or "Email again", and "Revoke links". */
export function EmailsPanel(props: {
  view: SendableView;
  /** This member may email it now (the view's `actions.send`). */
  canSend: boolean;
  /** Show 07-U's lock line: off where the page's banner already says why it can't be voided (the owner sees 07-R's line there). */
  showLock: boolean;
  onEmail: () => void;
  onRevoked: () => void;
  /** The "Email to client" / "Email again" button, so the page can give it focus back when the send dialog closes (H2). */
  emailRef?: RefObject<HTMLButtonElement | null> | undefined;
}) {
  const { view: v } = props;
  const toast = useToast();
  const [revoking, setRevoking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const focusNext = useFocusAfterReload(v);
  const rows = v.sends ?? [];
  const live = v.links?.live ?? 0;
  // L1: a row not queued yet waits for the PDF only while the PDF isn't ready; otherwise it is "Queued" like a queued row not sent yet.
  const pdfReady = v.pdf?.state === "ready";
  const waiting = rows.some((r) => sendState({ ...r, pdfReady }) === "waiting");
  const queued = rows.some((r) => sendState({ ...r, pdfReady }) === "queued");
  const pauses = hasReminders(v.type);
  // The void lock line (Q1): an emailed tax, export or proforma invoice can't be voided any more. A note is never voided anyway.
  const lockable = v.type === "tax_invoice" || v.type === "export_invoice" || v.type === "proforma";
  const emailed = rows.some((r) => r.cancelledAt === null);
  return (
    <section className="lead-panel inv-mail" aria-labelledby="inv-mail-h">
      <h2 id="inv-mail-h" className="lead-panel__title inv-mail__title" ref={headingRef} tabIndex={-1}>
        <Mail size={20} />
        {SEND_COPY.emailsHeading}
      </h2>
      {rows.length > 0 && (
        <ul className="deliv inv-mail__list">
          {rows.map((r) => {
            const state = sendState({ ...r, pdfReady });
            const look = sendStateLook(state);
            return (
              <li key={r.id} className="deliv__row">
                <dl className="inv-mail__row">
                  <div className="inv-mail__who">
                    <dt className="visually-hidden">{SEND_COPY.colTo}</dt>
                    <dd>
                      <span className="deliv__name">{r.contactName ?? r.email ?? "–"}</span>
                      {r.contactName && r.email && <span className="deliv__meta break">{r.email}</span>}
                    </dd>
                  </div>
                  {r.kind === "auto" ? (
                    <div>
                      <dt className="visually-hidden">{SEND_COPY.colSentBy}</dt>
                      <dd className="deliv__meta">{SEND_COPY.sentAutomatically}</dd>
                    </div>
                  ) : (
                    r.sentByName && (
                      <div className="inv-mail__by">
                        <dt className="deliv__meta">{SEND_COPY.colSentBy}</dt>
                        <dd className="deliv__meta">{r.sentByName}</dd>
                      </div>
                    )
                  )}
                  <div>
                    <dt className="visually-hidden">{SEND_COPY.colWhen}</dt>
                    <dd className="deliv__meta">{sendWhen(r.createdAt)}</dd>
                  </div>
                  <div className="inv-mail__state">
                    <dt className="visually-hidden">{SEND_COPY.colStatus}</dt>
                    <dd>
                      <StatusPill tone={look.tone} icon={PILL_ICON[look.icon]}>
                        {sendStateLabel(state)}
                      </StatusPill>
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
      {waiting && (
        <p className="approval-line" data-state="pending">
          <FileText size={16} />
          <span>{SEND_COPY.waitingForPdf}</span>
        </p>
      )}
      {!waiting && queued && (
        <p className="approval-line" data-state="pending">
          <Clock size={16} />
          <span>{SEND_COPY.queued}</span>
        </p>
      )}
      {props.showLock && emailed && lockable && v.status !== "void" && (
        <p className="inv-mail__lock">
          <Lock size={16} />
          <span>{SEND_COPY.locked(v.type)}</span>
        </p>
      )}
      {props.canSend && (
        <div className="send-panel__actions">
          <button
            type="button"
            ref={props.emailRef}
            className={`btn ${rows.length === 0 ? "btn--primary" : "btn--secondary"} btn--block`}
            onClick={props.onEmail}
          >
            <Send size={20} />
            {rows.length === 0 ? SEND_COPY.emailToClient : SEND_COPY.emailAgain}
          </button>
          {(live > 0 || waiting) && (
            <button
              type="button"
              ref={revokeRef}
              className="btn btn--text btn--block"
              onClick={() => setRevoking(true)}
            >
              {SEND_COPY.revoke}
            </button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={revoking}
        tone="danger"
        title={SEND_COPY.revokeTitle(v.number ?? "")}
        confirmLabel={SEND_COPY.revoke}
        onClose={() => setRevoking(false)}
        onConfirm={async () => {
          try {
            await invoicesApi.revokeLinks(v.id);
            setRevoking(false);
            toast("success", SEND_COPY.revoked);
            // "Revoke links" goes once no link is live: focus to the panel's heading (the button, if a send still waits).
            focusNext(() => connected(revokeRef.current) ?? headingRef.current);
            props.onRevoked();
            return undefined;
          } catch (e) {
            throw sendMapped(e, v.type);
          }
        }}
      >
        <p>{SEND_COPY.revokeBody(v.type)}</p>
        {pauses && <p>{SEND_COPY.revokePauses}</p>}
      </ConfirmDialog>
    </section>
  );
}

const NODE_ICON = { sent: Check, due: null, paused: Pause, skipped: null } as const;

/** The payment reminders as a schedule around the due date (07-U §5), the window, and pause or resume. */
export function RemindersPanel(props: {
  view: SendableView;
  canAct: boolean;
  /** The last send answered `remindersPaused`: say so first and offer "Resume reminders" at once. */
  offerResume: boolean;
  onChanged: () => void;
}) {
  const { view: v } = props;
  const toast = useToast();
  const [busy, setBusy] = useState<"pause" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pauseRef = useRef<HTMLButtonElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const focusNext = useFocusAfterReload(v);
  if (!hasReminders(v.type)) return null;
  const now = Date.now();
  // M2: a reminder whose day passed while paused is "missed while paused", and the banner shows only while a paused one is still ahead.
  const r = remindersOf(v.reminders, now);
  const rows: ReminderRowView[] = r.rows;
  const acts = reminderActions(rows, now);

  async function act(kind: "pause" | "resume") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "pause") await invoicesApi.pauseReminders(v.id);
      else await invoicesApi.resumeReminders(v.id);
      toast("success", kind === "pause" ? REMINDER_COPY.pausedDone : REMINDER_COPY.resumedDone);
      // H2: Pause becomes Resume and the other way round; with neither left, the panel's heading.
      const other = kind === "pause" ? resumeRef : pauseRef;
      focusNext(() => connected(other.current) ?? headingRef.current);
      props.onChanged();
    } catch (e) {
      setError(sendErrorText(e, v.type));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="lead-panel inv-remind" aria-labelledby="inv-remind-h">
      <h2 id="inv-remind-h" className="lead-panel__title inv-mail__title" ref={headingRef} tabIndex={-1}>
        <Clock size={20} />
        {REMINDER_COPY.heading}
      </h2>
      {!r.started || rows.length === 0 ? (
        <p className="muted inv-remind__empty">{REMINDER_COPY.notStarted(v.type)}</p>
      ) : (
        <>
          {(r.paused || (props.offerResume && acts.canResume)) && (
            <p className="approval-line" data-state="pending" role={props.offerResume ? "status" : undefined}>
              <Pause size={16} />
              <span>{REMINDER_COPY.paused}</span>
            </p>
          )}
          <ol className="remind">
            {rows.map((row) => {
              const state = reminderState(row);
              const Icon = NODE_ICON[state];
              return (
                <li
                  key={row.offset}
                  className="remind__row"
                  data-state={state}
                  data-due={row.offset === 0 || undefined}
                >
                  <span className="remind__node" aria-hidden="true">
                    {Icon && <Icon size={16} />}
                  </span>
                  <span className="remind__day">{reminderDayLabel(row.offset)}</span>
                  <span className="remind__state">{reminderStateText(row)}</span>
                </li>
              );
            })}
          </ol>
          {r.window && (
            <p className="hint inv-remind__window">{REMINDER_COPY.window(r.window.from, r.window.to)}</p>
          )}
        </>
      )}
      {error && (
        <p className="approval-line" data-state="rejected" role="alert">
          <Alert size={16} />
          <span>{error}</span>
        </p>
      )}
      {props.canAct && r.started && (acts.canPause || acts.canResume) && (
        <div className="send-panel__actions">
          {acts.canResume && (
            <button
              type="button"
              ref={resumeRef}
              className={`btn ${props.offerResume ? "btn--primary" : "btn--secondary"} btn--block`}
              onClick={() => act("resume")}
              disabled={busy !== null}
              aria-busy={busy === "resume" || undefined}
            >
              <Play size={20} />
              {REMINDER_COPY.resume}
            </button>
          )}
          {acts.canPause && (
            <button
              type="button"
              ref={pauseRef}
              className="btn btn--secondary btn--block"
              onClick={() => act("pause")}
              disabled={busy !== null}
              aria-busy={busy === "pause" || undefined}
            >
              <Pause size={20} />
              {REMINDER_COPY.pause}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** A care invoice: the plan it bills and its period; on a draft, why the system didn't issue it by itself (07-U §6). */
export function CareOrigin(props: { care: NonNullable<InvoiceM54["care"]>; canOpenPlan: boolean }) {
  const { care } = props;
  const because = care.auto && !care.auto.eligible ? draftedBecause(care.auto.reasons) : null;
  const period = periodText(care.periodStart, care.periodEnd);
  return (
    <>
      <p className="inv-origin">
        <LifeBuoy size={16} />
        <span>
          {props.canOpenPlan ? (
            <Link to={`/care-plans/${encodeURIComponent(care.planId)}`}>{CARE_COPY.carePlan}</Link>
          ) : (
            CARE_COPY.carePlan
          )}
          , {period}
        </span>
      </p>
      {because && (
        <p className="approval-line inv-care-why" data-state="pending">
          <Alert size={16} />
          <span>{because}</span>
        </p>
      )}
    </>
  );
}

/** The words of a finished send, for the toast: queued while the PDF is made, else sent to n contacts. */
export const sentToast = (r: SendResult) =>
  r.waitingForPdf ? SEND_COPY.waitingForPdf : SEND_COPY.sent(r.sends);
