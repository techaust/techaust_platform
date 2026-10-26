// The time entry dialog (M3.5, ADM-TIME-01, ADM-TIME-03): who (the owner may log for others: "Log time for"), the date (no future
// date; more than 7 days back is the owner's), the time in 15-minute steps up to 24 hours, the project or care plan (searched through
// GET /time/targets: open projects, plans active today), billable and a note. The same dialog edits an entry, sending only what
// changed with the version it was loaded with; the owner editing an entry locked for its author sees the 07-M notice first.
import { parseIsoDate } from "@techaust/core/dates";
import { type FormEvent, useState } from "react";
import { api, RequestError, type TimeEntry, type TimePatch } from "../../api.ts";
import { DateField } from "../../components/date-field.tsx";
import { Modal } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Search } from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { careErrorText, QUARTERS, TIER_LABELS } from "../../lib/care.ts";
import { PENDING } from "../../lib/projects.ts";
import {
  type EntryErrors,
  type EntryForm,
  earliestDate,
  entryFormOf,
  entryInput,
  type TargetRef,
  TIME_COPY,
  TIME_PENDING,
  TIME_TOASTS,
} from "../../lib/time.ts";
import { useDebounced } from "../projects/client-filter.tsx";

const P = "te";
/** Where an API refusal belongs in the form. */
const FIELD_OF: Record<string, keyof EntryErrors | "userId"> = {
  day_cap: "hours",
  plan_not_active: "target",
  project_closed: "target",
  client_anonymised: "target",
  one_target: "target",
  future_date: "workDate",
  owner_only_date: "workDate",
  bad_user: "userId",
};

export function EntryDialog(props: {
  open: boolean;
  /** null: a new entry. */
  entry: TimeEntry | null;
  today: string;
  me: { id: string; name: string };
  canWriteAny: boolean;
  /** The owner editing an entry locked for its author. */
  override: boolean;
  onClose: () => void;
  onSaved: () => void;
  onStale: () => void;
}) {
  // One dialog element for the screen's life, so closing it returns focus to the button that opened it; the form inside is new
  // each time it opens (a fresh draft of the entry).
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={props.open}
      title={props.entry ? "Edit time entry" : "Log time"}
      onClose={props.onClose}
      busy={busy}
      wide
    >
      {props.open && (
        <EntryFormBody {...props} key={props.entry?.id ?? "new"} busy={busy} setBusy={setBusy} />
      )}
    </Modal>
  );
}

function EntryFormBody(
  props: Parameters<typeof EntryDialog>[0] & { busy: boolean; setBusy: (b: boolean) => void },
) {
  const toast = useToast();
  const [f, setF] = useState<EntryForm>(() => entryFormOf(props.entry, props.today, props.me.id));
  const [errors, setErrors] = useState<EntryErrors & { userId?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const { busy, setBusy } = props;
  const [picking, setPicking] = useState(f.target === null);
  const people = useLoad(
    () => (props.canWriteAny && !props.entry ? api.timePeople() : Promise.resolve(null)),
    props.canWriteAny ? "people" : "",
  );
  const set = (p: Partial<EntryForm>) => setF((x) => ({ ...x, ...p }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = entryInput(f, {
      today: props.today,
      canWriteAny: props.canWriteAny,
      me: props.me.id,
      originalDate: props.entry?.workDate,
    });
    if (!r.ok) {
      setErrors(r.errors);
      const first = (["workDate", "hours", "target", "note"] as const).find((k) => r.errors[k]);
      if (first) document.getElementById(`${P}-${first === "target" ? "target-q" : first}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    setFailure(null);
    try {
      if (props.entry) {
        const was = props.entry;
        const b = r.body;
        const patch: TimePatch = { expectedUpdatedAt: was.updatedAt };
        if (b.workDate !== was.workDate) patch.workDate = b.workDate;
        if (b.minutes !== was.minutes) patch.minutes = b.minutes;
        if (b.billable !== was.billable) patch.billable = b.billable;
        if ((b.note ?? null) !== (was.note ?? null)) patch.note = b.note ?? null;
        if ((b.projectId ?? null) !== was.projectId || (b.carePlanId ?? null) !== was.carePlanId) {
          if (b.projectId) patch.projectId = b.projectId;
          else patch.carePlanId = b.carePlanId ?? null;
        }
        await api.updateTime(was.id, patch);
        toast("success", TIME_TOASTS.saved);
      } else {
        await api.logTime(r.body);
        toast("success", TIME_TOASTS.logged);
      }
      props.onSaved();
    } catch (err) {
      if (err instanceof RequestError && err.code === "stale_version") {
        props.onStale();
        return;
      }
      const field = err instanceof RequestError ? FIELD_OF[err.code] : undefined;
      const text = careErrorText(err);
      if (field) {
        setErrors({ [field]: text });
        document.getElementById(`${P}-${field === "target" ? "target-q" : field}`)?.focus();
        if (field === "target") setPicking(true);
      } else setFailure(text);
    } finally {
      setBusy(false);
    }
  }

  const a11y = (k: keyof EntryErrors | "userId") => ({
    id: `${P}-${k}`,
    ...(errors[k] ? { "aria-invalid": true as const, "aria-describedby": `${P}-${k}-error` } : {}),
  });
  const err = (k: keyof EntryErrors | "userId") =>
    errors[k] ? <FieldError id={`${P}-${k}-error`}>{errors[k]}</FieldError> : null;
  const others = (people.data?.people ?? []).filter((p) => p.id !== props.me.id);

  return (
    <form onSubmit={submit} noValidate className="entry-form">
      <div className="dialog__body">
        {props.override && <Notice tone="info">{TIME_COPY.ownerOverride}</Notice>}
        {failure && <Notice tone="error">{failure}</Notice>}
        {props.canWriteAny && !props.entry && others.length > 0 && (
          <div className="field">
            <label htmlFor={`${P}-userId`}>{TIME_COPY.logFor}</label>
            <select {...a11y("userId")} value={f.userId} onChange={(e) => set({ userId: e.target.value })}>
              <option value={props.me.id}>{`${props.me.name || "Name not set yet"} (you)`}</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || "Name not set yet"}
                </option>
              ))}
            </select>
            {err("userId")}
          </div>
        )}
        {props.entry && props.entry.userId !== props.me.id && (
          <p className="entry-form__who">
            <span className="muted">Person</span> {props.entry.userName ?? "A former staff member"}
          </p>
        )}
        {/* Date over Time spent: the two have different shapes (one control, then hours and minutes with their own labels), so
            side by side they could never line up (batch review M3). */}
        <div className="entry-form__when">
          <div className="field">
            <label htmlFor={`${P}-workDate`}>Date</label>
            <DateField
              {...a11y("workDate")}
              value={f.workDate}
              max={props.today}
              min={earliestDate(props.today, props.canWriteAny)}
              onChange={(v) => set({ workDate: v })}
            />
            {err("workDate")}
          </div>
          <fieldset className="field duration" aria-describedby={`${P}-hours-hint`}>
            <legend>Time spent</legend>
            <p className="hint" id={`${P}-hours-hint`}>
              {TIME_COPY.minutesHint}
            </p>
            <div className="duration__row">
              <div className="duration__part">
                <label htmlFor={`${P}-hours`} className="duration__label">
                  Hours
                </label>
                <input
                  {...a11y("hours")}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={2}
                  value={f.hours}
                  onChange={(e) => set({ hours: e.target.value })}
                />
              </div>
              <div className="duration__part">
                <label htmlFor={`${P}-minutes`} className="duration__label">
                  Minutes
                </label>
                <select
                  id={`${P}-minutes`}
                  value={f.minutes}
                  onChange={(e) => set({ minutes: e.target.value })}
                >
                  {QUARTERS.map((q) => (
                    <option key={q} value={q}>
                      {q === "0" ? "00" : q}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {err("hours")}
          </fieldset>
        </div>

        <TargetField
          value={f.target}
          picking={picking}
          workDate={f.workDate}
          onPick={(t) => {
            set({ target: t });
            setPicking(false);
            setErrors(({ target: _gone, ...rest }) => rest);
          }}
          onChange={() => {
            setPicking(true);
            requestAnimationFrame(() => document.getElementById(`${P}-target-q`)?.focus());
          }}
          error={errors.target}
        />

        <label className="check">
          <input type="checkbox" checked={f.billable} onChange={(e) => set({ billable: e.target.checked })} />
          <span>Billable</span>
        </label>
        <FormField id={`${P}-note`} label="Note" optional error={errors.note}>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={1000}
              value={f.note}
              onChange={(e) => set({ note: e.target.value })}
            />
          )}
        </FormField>
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Saving…" : props.entry ? "Save entry" : "Log time"}
        </button>
      </div>
    </form>
  );
}

/** The project or care plan: the chosen one with "Change", or a search (the start of a code or name) with native radios. */
function TargetField(props: {
  value: TargetRef | null;
  picking: boolean;
  /** The plans offered are those active on this date. */
  workDate: string;
  onPick: (t: TargetRef) => void;
  onChange: () => void;
  error: string | undefined;
}) {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim().length >= 2 ? q.trim() : "");
  const found = useLoad(
    () =>
      props.picking
        ? api.timeTargets(term, parseIsoDate(props.workDate) ? props.workDate : undefined)
        : Promise.resolve(null),
    `${props.picking}:${term}:${props.workDate}`,
  );
  if (!props.picking && props.value)
    return (
      <div className="field">
        <span className="label-like">Project or care plan</span>
        <div className="chosen-client">
          <p className="chosen-client__name">
            {props.value.kind === "project" ? (
              <>
                <span>Project</span>
                <span className="docno client-code">{props.value.code}</span>
              </>
            ) : (
              <span>{props.value.label}</span>
            )}
          </p>
          <button type="button" className="btn btn--text" onClick={props.onChange}>
            Change<span className="visually-hidden"> the project or care plan</span>
          </button>
        </div>
        {props.error && <FieldError id={`${P}-target-error`}>{props.error}</FieldError>}
      </div>
    );
  const projects = found.data?.projects ?? [];
  const plans = found.data?.carePlans ?? [];
  const n = projects.length + plans.length;
  return (
    <div className="target-picker">
      <FormField
        id={`${P}-target-q`}
        label="Project or care plan"
        hint={TIME_COPY.targetHint}
        error={props.error}
        className="field-icon-wrap"
      >
        {(a) => (
          <div className="field-icon">
            <Search size={20} />
            <input
              {...a}
              type="search"
              autoComplete="off"
              placeholder={PENDING.clientFilterHint}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        )}
      </FormField>
      <p className="visually-hidden" role="status">
        {found.state === "loading"
          ? "Loading…"
          : found.state === "ready" && term
            ? TIME_PENDING.targetsFound(n)
            : ""}
      </p>
      {found.state === "failed" ? (
        <Notice tone="error">{careErrorText(found.error)}</Notice>
      ) : found.state === "ready" && n === 0 ? (
        <p className="hint">{TIME_PENDING.noTargetMatch}</p>
      ) : (
        <fieldset className="radios target-picker__list" aria-busy={found.state === "loading" || undefined}>
          <legend className="visually-hidden">Project or care plan</legend>
          {projects.length > 0 && (
            <p className="target-picker__group" aria-hidden="true">
              Projects
            </p>
          )}
          {projects.map((p) => (
            <label key={p.id} className="radio client-option">
              <input
                type="radio"
                name={`${P}-target`}
                checked={props.value?.kind === "project" && props.value.id === p.id}
                onChange={() => props.onPick({ kind: "project", id: p.id, code: p.code, label: p.code })}
              />
              <span className="client-option__text">
                <span className="client-option__name">{p.name}</span>
                <span className="client-option__meta">
                  <span className="docno">{p.code}</span>
                  <span className="docno">{p.clientCode}</span>
                </span>
              </span>
            </label>
          ))}
          {plans.length > 0 && (
            <p className="target-picker__group" aria-hidden="true">
              Care plans
            </p>
          )}
          {plans.map((c) => (
            <label key={c.id} className="radio client-option">
              <input
                type="radio"
                name={`${P}-target`}
                checked={props.value?.kind === "plan" && props.value.id === c.id}
                onChange={() =>
                  props.onPick({
                    kind: "plan",
                    id: c.id,
                    code: c.clientCode,
                    label: `Care plan ${c.clientCode}${c.tier ? ` (${TIER_LABELS[c.tier]})` : ""}`,
                  })
                }
              />
              <span className="client-option__text">
                <span className="client-option__name">
                  <span className="visually-hidden">Care plan: </span>
                  {c.clientName}
                </span>
                <span className="client-option__meta">
                  <span className="docno">{c.clientCode}</span>
                  <span>{c.tier ? TIER_LABELS[c.tier] : "Care plan"}</span>
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
