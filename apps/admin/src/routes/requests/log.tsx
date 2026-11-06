// "Log a request" (M7.4 G.1; C.2, L22, L28): a request that reached us by email, post, phone or in person, with what was asked, how it came, the day it
// arrived (the shared DateField with `onValidity`: the reply date counts from it, never a future day) and who it's from: a client's contact, a lead, an
// address not in our records, or a client as a whole. A contact, lead or client is found with the admin's search (the start of an email, a reference or a
// code); opened from a contact or a lead, the dialog starts with that person chosen. Fields are checked on submit and each refusal lands on its field.
import "../../dp.css";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { type FormEvent, useId, useRef, useState } from "react";
import { api } from "../../api.ts";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Search } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { ZR_LOG, ZR_REQ } from "../../lib/copy-zr.ts";
import { dateError } from "../../lib/date-field.ts";
import { m74Api, REQUEST_KINDS, type RequestView, STAFF_CHANNELS } from "../../lib/m74-api.ts";
import {
  clientIdOfLink,
  DETAILS_REQUIRED,
  type LogForm,
  logBodyOf,
  logErrorText,
  type Picked,
  SUBJECTS,
  type Subject,
} from "../../lib/requests.ts";

const SEARCH_TYPE: Record<Exclude<Subject, "email">, "contact" | "lead" | "client"> = {
  contact: "contact",
  lead: "lead",
  client: "client",
};

export function LogRequestDialog(props: {
  onClose: () => void;
  onLogged: (r: RequestView) => void;
  /** Opened from a contact or a lead: that person, chosen already. */
  preset?: Picked | undefined;
}) {
  const id = useId();
  const toast = useToast();
  const today = toIsoDate(istDate(Date.now()));
  const [f, setF] = useState<LogForm>({
    kind: "",
    channel: "",
    receivedOn: today,
    subject: props.preset?.type ?? "",
    picked: props.preset ?? null,
    email: "",
    details: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dates = useUnreadDates<"received">();
  const refusal = useRefusalFocus();
  const set = (patch: Partial<LogForm>) => setF((x) => ({ ...x, ...patch }));
  const clear = (k: string) => setErrors((x) => (x[k] ? { ...x, [k]: "" } : x));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const out = logBodyOf(f, Date.now(), dates.unread.received === true);
    if ("errors" in out) {
      const errs = { ...out.errors };
      const unread = dateError(dates.unread.received);
      if (unread) errs.receivedOn = unread;
      setErrors(errs);
      const order: [string, string][] = [
        ["kind", `${id}-kind`],
        ["channel", `${id}-channel-0`],
        ["receivedOn", `${id}-received`],
        ["subject", `${id}-subject-0`],
        ["find", `${id}-find`],
        ["email", `${id}-email`],
        ["details", `${id}-details`],
      ];
      const first = order.find(([k]) => errs[k]);
      if (first) document.getElementById(first[1])?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await m74Api.logRequest(out.body);
      toast("success", ZR_LOG.logged);
      props.onLogged(r.request);
    } catch (err) {
      setBusy(false);
      setFailure(logErrorText(err));
      refusal.show();
    }
  }

  const erasureUnmatched = f.kind === "data_erasure" && f.subject === "email";
  return (
    <Modal open title={ZR_LOG.title} onClose={props.onClose} busy={busy} className="dialog--dp-log">
      <form noValidate onSubmit={(e) => void submit(e)}>
        <div className="dialog__body dp-log">
          <p className="dp-log__intro">{ZR_LOG.intro}</p>
          <p className="hint">All fields are needed unless marked optional.</p>
          <FormField id={`${id}-kind`} label={ZR_LOG.kind} error={errors.kind}>
            {(a) => (
              <select
                {...a}
                value={f.kind}
                onChange={(e) => {
                  set({ kind: e.target.value as LogForm["kind"] });
                  clear("kind");
                  clear("details");
                }}
              >
                <option value="">Choose…</option>
                {REQUEST_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ZR_REQ.kind[k]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <fieldset
            className="radios dp-log__channels"
            aria-describedby={errors.channel ? `${id}-channel-error` : undefined}
          >
            <legend>{ZR_LOG.channel}</legend>
            <div className="segmented">
              {STAFF_CHANNELS.map((c, i) => (
                <label key={c} className="segmented__opt">
                  <input
                    id={`${id}-channel-${i}`}
                    type="radio"
                    name={`${id}-channel`}
                    checked={f.channel === c}
                    onChange={() => {
                      set({ channel: c });
                      clear("channel");
                    }}
                  />
                  {ZR_REQ.channel[c]}
                </label>
              ))}
            </div>
            {errors.channel && <FieldError id={`${id}-channel-error`}>{errors.channel}</FieldError>}
          </fieldset>
          <FormField
            id={`${id}-received`}
            label={ZR_LOG.receivedOn}
            hint={ZR_LOG.receivedHint}
            error={errors.receivedOn}
          >
            {(a) => (
              <DateField
                {...a}
                {...dates.bind("received")}
                value={f.receivedOn}
                max={today}
                onChange={(v) => {
                  set({ receivedOn: v });
                  clear("receivedOn");
                }}
              />
            )}
          </FormField>
          <fieldset className="radios" aria-describedby={errors.subject ? `${id}-subject-error` : undefined}>
            <legend>{ZR_LOG.who}</legend>
            {SUBJECTS.map((s, i) => (
              <label key={s} className="radio">
                <input
                  id={`${id}-subject-${i}`}
                  type="radio"
                  name={`${id}-subject`}
                  checked={f.subject === s}
                  onChange={() => {
                    set({ subject: s, picked: f.picked?.type === s ? f.picked : null });
                    setErrors({});
                  }}
                />
                <span>{ZR_LOG.subject[s]}</span>
              </label>
            ))}
            {errors.subject && <FieldError id={`${id}-subject-error`}>{errors.subject}</FieldError>}
          </fieldset>
          {f.subject !== "" && f.subject !== "email" && (
            <Finder
              id={`${id}-find`}
              type={SEARCH_TYPE[f.subject]}
              picked={f.picked}
              error={errors.find}
              onPick={(p) => {
                set({ picked: p });
                clear("find");
              }}
            />
          )}
          {f.subject === "email" && (
            <FormField id={`${id}-email`} label={ZR_LOG.email} error={errors.email}>
              {(a) => (
                <input
                  {...a}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  value={f.email}
                  onChange={(e) => {
                    set({ email: e.target.value });
                    clear("email");
                  }}
                />
              )}
            </FormField>
          )}
          {erasureUnmatched && (
            <p className="dp-log__note" role="note">
              {ZR_LOG.erasureUnmatched}
            </p>
          )}
          <FormField
            id={`${id}-details`}
            label={ZR_LOG.details}
            hint={ZR_LOG.detailsHint}
            error={errors.details}
            optional={!(f.kind !== "" && DETAILS_REQUIRED.has(f.kind))}
          >
            {(a) => (
              <textarea
                {...a}
                rows={4}
                value={f.details}
                onChange={(e) => {
                  set({ details: e.target.value });
                  clear("details");
                }}
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
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Working…" : ZR_LOG.submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Found =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "ready"; items: Picked[] }
  | { state: "failed" };

/** The person or client a request is from, found with the admin's search (prefix matches on the email, the reference or the code). */
function Finder(props: {
  id: string;
  type: "contact" | "lead" | "client";
  picked: Picked | null;
  error?: string | undefined;
  onPick: (p: Picked) => void;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found>({ state: "idle" });
  const [short, setShort] = useState(false);
  const [editing, setEditing] = useState(props.picked === null || props.picked.type !== props.type);
  const listRef = useRef<HTMLDivElement>(null);
  const picked = props.picked?.type === props.type ? props.picked : null;

  async function find() {
    const v = q.trim();
    if (v.length < 2) {
      setShort(true);
      return;
    }
    setShort(false);
    setFound({ state: "busy" });
    try {
      const r = await api.search(v);
      const items = r.groups
        .filter((g) => g.type === props.type)
        .flatMap((g) =>
          g.items.map((i): Picked => {
            const p: Picked = { type: props.type, id: i.id, title: i.title, sub: i.subtitle };
            const clientId = props.type === "contact" ? clientIdOfLink(i.link) : undefined;
            return clientId ? { ...p, clientId } : p;
          }),
        );
      setFound({ state: "ready", items });
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLInputElement>("input")?.focus());
    } catch {
      setFound({ state: "failed" });
    }
  }

  if (picked && !editing)
    return (
      <div className="field dp-find">
        <p className="dp-find__label" id={`${props.id}-label`}>
          {ZR_LOG.chosen}
        </p>
        <div className="dp-find__chosen">
          <span className="dp-find__who">
            <strong className="break">{picked.title}</strong>
            <span className="muted break">{picked.sub}</span>
          </span>
          <button
            type="button"
            id={props.id}
            className="btn btn--text"
            onClick={() => {
              setEditing(true);
              requestAnimationFrame(() => document.getElementById(`${props.id}-q`)?.focus());
            }}
          >
            {ZR_LOG.change}
            <span className="visually-hidden">{` ${picked.title}`}</span>
          </button>
        </div>
      </div>
    );

  const hint = ZR_LOG.findHint[props.type] ?? "";
  const err = short ? ZR_LOG.findShort : props.error;
  return (
    <div className="field dp-find">
      <div className="field__head">
        <label htmlFor={`${props.id}-q`}>{ZR_LOG.find}</label>
        <p className="hint" id={`${props.id}-hint`}>
          {hint}
        </p>
      </div>
      <div className="field__body">
        <div className="dp-find__row">
          <input
            id={`${props.id}-q`}
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={q}
            aria-describedby={[`${props.id}-hint`, err ? `${props.id}-error` : null]
              .filter(Boolean)
              .join(" ")}
            aria-invalid={err ? true : undefined}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void find();
              }
            }}
          />
          <button
            type="button"
            id={props.id}
            className="btn btn--secondary"
            onClick={() => void find()}
            aria-busy={found.state === "busy" || undefined}
          >
            <Search size={20} />
            {ZR_LOG.findButton}
          </button>
        </div>
        {err && <FieldError id={`${props.id}-error`}>{err}</FieldError>}
        <div ref={listRef} className="dp-find__results" aria-live="polite">
          {found.state === "failed" && <p className="dp-find__none">{ZR_LOG.findFailed}</p>}
          {found.state === "ready" && found.items.length === 0 && (
            <p className="dp-find__none">{ZR_LOG.findNone}</p>
          )}
          {found.state === "ready" && found.items.length > 0 && (
            <fieldset className="radios">
              <legend className="visually-hidden">{ZR_LOG.find}</legend>
              {found.items.map((p) => (
                <label key={p.id} className="radio dp-find__opt">
                  <input
                    type="radio"
                    name={`${props.id}-pick`}
                    checked={picked?.id === p.id}
                    // arrow keys move through the list choosing as they go (native radios), so the list stays open with the choice marked
                    onChange={() => props.onPick(p)}
                  />
                  <span className="dp-find__who">
                    <span className="break">{p.title}</span>
                    <span className="muted break">{p.sub}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </div>
    </div>
  );
}
