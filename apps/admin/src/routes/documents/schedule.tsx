// The payment schedule of a draft (M4.3, ADM-PROP-03, docs/06 §5.3 PaymentScheduleEditor): instalments as shares of the total, each with
// when it is paid, what the client gets and a target date. The amounts are the server's: it rounds them so they always add up to the
// total exactly. The M4.1 schedule bar draws the shares, so a gap or an overshoot is visible before the server says so.
import { type Dispatch, memo, useCallback, useState } from "react";
import type { Currency } from "../../api.ts";
import { ArrowDown, ArrowUp, Plus, Trash } from "../../components/icons.tsx";
import { MenuButton } from "../../components/popover.tsx";
import { FieldError } from "../../components/ui.tsx";
import { TRIGGER_LABELS, TRIGGERS } from "../../lib/catalogue.ts";
import {
  DOC_COPY,
  DOC_PENDING,
  type EditorAction,
  moneyText,
  moved,
  type StepDraft,
  type StepErrors,
  stepErrors,
  uid,
} from "../../lib/documents.ts";
import { percentToBp } from "../../lib/settings-form.ts";

const STEPS_MAX = 24;

export const SchedulePanel = memo(function SchedulePanel(props: {
  steps: StepDraft[];
  amounts: Record<string, number | null>;
  currency: Currency;
  showErrors: boolean;
  dispatch: Dispatch<EditorAction>;
  current: () => StepDraft[];
}) {
  const { dispatch, current } = props;
  const edit = useCallback(
    (u: string, patch: Partial<StepDraft>) => dispatch({ type: "step", uid: u, patch }),
    [dispatch],
  );
  const move = useCallback(
    (u: string, by: -1 | 1) => {
      const list = current();
      dispatch({
        type: "schedule",
        schedule: moved(
          list,
          list.findIndex((s) => s.uid === u),
          by,
        ),
      });
      requestAnimationFrame(() => document.getElementById(`st-${u}-label`)?.focus());
    },
    [dispatch, current],
  );
  const remove = useCallback(
    (u: string) => {
      dispatch({ type: "schedule", schedule: current().filter((s) => s.uid !== u) });
      requestAnimationFrame(() => document.getElementById("doc-schedule-h")?.focus());
    },
    [dispatch, current],
  );
  // The bar: each share as a segment; what is missing to 100 % as an outline (the catalogue's picture of a schedule).
  const shares = props.steps.map((s) => percentToBp(s.pct) ?? 0);
  let running = 0;
  const segs = shares.map((bp) => {
    const room = Math.max(0, 10_000 - running);
    running += bp;
    return Math.min(bp, room);
  });
  const gap = Math.max(0, 10_000 - running);

  return (
    <section className="lead-panel doc-schedule" aria-labelledby="doc-schedule-h">
      <div className="lead-panel__head">
        <h2 id="doc-schedule-h" className="lead-panel__title" tabIndex={-1}>
          Payment schedule
        </h2>
      </div>
      {props.steps.length > 0 && (
        <div className="sched-bar" aria-hidden="true">
          {segs.map((bp, i) => (
            <span
              key={props.steps[i]?.uid}
              className="sched-bar__seg"
              data-alt={i % 2 === 1 || undefined}
              style={{ flexGrow: bp }}
            />
          ))}
          {gap > 0 && <span className="sched-bar__gap" style={{ flexGrow: gap }} />}
        </div>
      )}
      <ol className="qledger qledger--steps">
        {props.steps.map((s, i) => (
          <StepRow
            key={s.uid}
            s={s}
            n={i + 1}
            count={props.steps.length}
            amount={props.amounts[s.uid]}
            currency={props.currency}
            showErrors={props.showErrors}
            onEdit={edit}
            onMove={move}
            onRemove={remove}
          />
        ))}
      </ol>
      <p className="hint doc-schedule__rule">{DOC_COPY.scheduleRule}</p>
      {props.steps.length < STEPS_MAX && (
        <button
          type="button"
          className="btn btn--text"
          onClick={() => {
            const s: StepDraft = {
              uid: uid("p"),
              id: null,
              label: "",
              trigger: "milestone",
              pct: "",
              detail: "",
              targetDate: "",
            };
            dispatch({ type: "schedule", schedule: [...current(), s] });
            requestAnimationFrame(() => document.getElementById(`st-${s.uid}-label`)?.focus());
          }}
        >
          <Plus size={16} />
          {DOC_PENDING.addStep}
        </button>
      )}
    </section>
  );
});

const StepRow = memo(function StepRow(p: {
  s: StepDraft;
  n: number;
  count: number;
  amount: number | null | undefined;
  currency: Currency;
  showErrors: boolean;
  onEdit: (uid: string, patch: Partial<StepDraft>) => void;
  onMove: (uid: string, by: -1 | 1) => void;
  onRemove: (uid: string) => void;
}) {
  const { s } = p;
  const [left, setLeft] = useState<Partial<Record<keyof StepErrors, true>>>({});
  const errors = stepErrors(s);
  const shown = (k: keyof StepErrors) => (p.showErrors || left[k] ? errors[k] : undefined);
  const id = (k: string) => `st-${s.uid}-${k}`;
  const a11y = (k: keyof StepErrors) => {
    const e = shown(k);
    return {
      id: id(k),
      ...(e ? { "aria-invalid": true as const, "aria-describedby": `${id(k)}-error` } : {}),
    };
  };
  const hidden = <span className="visually-hidden">{`${DOC_COPY.instalment} ${p.n}, `}</span>;
  const items = [
    ...(p.n > 1
      ? [{ label: "Move up", icon: <ArrowUp size={16} />, onSelect: () => p.onMove(s.uid, -1) }]
      : []),
    ...(p.n < p.count
      ? [{ label: "Move down", icon: <ArrowDown size={16} />, onSelect: () => p.onMove(s.uid, 1) }]
      : []),
    {
      label: "Remove",
      icon: <Trash size={16} />,
      tone: "danger" as const,
      onSelect: () => p.onRemove(s.uid),
    },
  ];
  return (
    <li className="qledger__row qledger__row--step">
      <span className="qledger__n tnum" aria-hidden="true">
        {p.n}
      </span>
      <div className="qledger__desc">
        <label className="qledger__label" htmlFor={id("label")}>
          {hidden}
          {DOC_COPY.instalment}
        </label>
        <input
          {...a11y("label")}
          autoComplete="off"
          maxLength={200}
          value={s.label}
          onChange={(e) => p.onEdit(s.uid, { label: e.target.value })}
          onBlur={() => setLeft((x) => ({ ...x, label: true }))}
        />
      </div>
      <p className="qledger__amount tnum">
        <span className="visually-hidden">
          {hidden}
          {DOC_COPY.amount}:{" "}
        </span>
        {p.amount === null || p.amount === undefined ? "" : moneyText(p.amount, p.currency)}
      </p>
      <div className="qledger__act">
        <MenuButton
          label={`Actions for ${DOC_COPY.instalment.toLowerCase()} ${p.n}`}
          items={items}
          align="end"
        />
      </div>
      <div className="qledger__work qledger__work--step">
        <div className="qledger__cell qledger__cell--pct">
          <label className="qledger__label" htmlFor={id("pct")}>
            {hidden}
            {DOC_COPY.share}
          </label>
          <div className="number-unit">
            <input
              {...a11y("pct")}
              className="tnum"
              inputMode="decimal"
              autoComplete="off"
              value={s.pct}
              onChange={(e) => p.onEdit(s.uid, { pct: e.target.value })}
              onBlur={() => setLeft((x) => ({ ...x, pct: true }))}
            />
            <span className="number-unit__unit" aria-hidden="true">
              %
            </span>
          </div>
        </div>
        <div className="qledger__cell">
          <label className="qledger__label" htmlFor={id("when")}>
            {hidden}
            {DOC_COPY.when}
          </label>
          <select
            id={id("when")}
            value={s.trigger}
            onChange={(e) => p.onEdit(s.uid, { trigger: e.target.value as StepDraft["trigger"] })}
          >
            {TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="qledger__cell qledger__cell--what">
          <label className="qledger__label" htmlFor={id("detail")}>
            {hidden}
            {DOC_COPY.whatYouGet}
          </label>
          <input
            id={id("detail")}
            autoComplete="off"
            maxLength={300}
            value={s.detail}
            onChange={(e) => p.onEdit(s.uid, { detail: e.target.value })}
          />
        </div>
        <div className="qledger__cell">
          <label className="qledger__label" htmlFor={id("date")}>
            {hidden}
            {DOC_COPY.targetDate}
          </label>
          <input
            id={id("date")}
            type="date"
            value={s.targetDate}
            onChange={(e) => p.onEdit(s.uid, { targetDate: e.target.value })}
          />
        </div>
      </div>
      {(shown("label") || shown("pct")) && (
        <div className="qledger__errors">
          {shown("label") && <FieldError id={`${id("label")}-error`}>{shown("label")}</FieldError>}
          {shown("pct") && <FieldError id={`${id("pct")}-error`}>{shown("pct")}</FieldError>}
        </div>
      )}
    </li>
  );
});
