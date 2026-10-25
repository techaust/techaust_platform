// The entry form (M4.1, ADM-CAT-02), shared by "New service" and a service's Edit: every field of the entry in the panels of
// the service page, so the form reads like the page it changes. Money is typed in rupees or dollars (MoneyIn, the Settings
// pattern) and stored in minor units; shares in per cent become basis points; quantities become milli-units (lib/catalogue.ts,
// never floats). Default lines and the schedule are editable lists; the schedule's total, its bar and the website's sentence
// follow every keystroke. Markdown fields show a live preview drawn from the core AST (components/markdown.tsx), never HTML.
import { isSiteReferenced } from "@techaust/core/site-references";
import { type ReactNode, useEffect, useState } from "react";
import type { CatalogueUnit } from "../../api.ts";
import { FormField, NumberUnit, Switch } from "../../components/form.tsx";
import { Lock, Plus, X } from "../../components/icons.tsx";
import { Markdown } from "../../components/markdown.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  COPY,
  type EntryForm,
  FORMATTING_HINT,
  type LineForm,
  newLine,
  newStep,
  type StepForm,
  scheduleTotal,
  scheduleWords,
  TRIGGER_LABELS,
  TRIGGERS,
  UNIT_LABELS,
  UNITS,
} from "../../lib/catalogue.ts";
import { bpToPercent, percentToBp } from "../../lib/settings-form.ts";
import { ctl, MoneyIn, RowError } from "../settings/kit.tsx";
import { ScheduleBar } from "./parts.tsx";

const MAX_LINES = 30;
const MAX_STEPS = 12;

export type EditorProps = {
  form: EntryForm;
  set: (patch: Partial<EntryForm>) => void;
  error: (id: string) => string | undefined;
  /** "edit": the code is shown locked (it never changes once saved). */
  mode: "new" | "edit";
};

/** The main column of the form: description, prices and tax, default lines, schedule, and what's included. */
export function EntryMain({ form: f, set, error, mode }: EditorProps) {
  return (
    <>
      <section className="lead-panel" aria-labelledby="ce-desc-h">
        <h2 id="ce-desc-h" className="lead-panel__title">
          Description
        </h2>
        <div className="form-grid">
          {mode === "new" ? (
            <FormField id="ce-code" label="Code" hint={COPY.codeLocked} error={error("ce-code")}>
              {(a) => (
                <input
                  {...a}
                  className="docno ce-code"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="characters"
                  maxLength={5}
                  value={f.code}
                  onChange={(e) => set({ code: e.target.value })}
                />
              )}
            </FormField>
          ) : (
            <div className="field">
              <span className="label-like">Code</span>
              <p className="locked-value">
                <span className="docno">{f.code}</span>
                <span className="locked-note">
                  <Lock size={16} />
                  {COPY.codeLocked}
                </span>
              </p>
            </div>
          )}
          <FormField id="ce-name" label="Name" error={error("ce-name")}>
            {(a) => (
              <input
                {...a}
                autoComplete="off"
                maxLength={120}
                value={f.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </FormField>
          <FormField id="ce-category" label="Category">
            {(a) => (
              <select
                {...a}
                value={f.category}
                onChange={(e) => set({ category: e.target.value as EntryForm["category"] })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField id="ce-unit" label="Unit">
            {(a) => (
              <select {...a} value={f.unit} onChange={(e) => set({ unit: e.target.value as CatalogueUnit })}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
        <FormField id="ce-short" label="Short description" error={error("ce-short")}>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={400}
              value={f.short}
              onChange={(e) => set({ short: e.target.value })}
            />
          )}
        </FormField>
        <MdField
          id="ce-longMd"
          label="Long description"
          value={f.longMd}
          onChange={(longMd) => set({ longMd })}
          error={error("ce-longMd")}
        />
      </section>

      <section className="lead-panel" aria-labelledby="ce-prices-h">
        <h2 id="ce-prices-h" className="lead-panel__title">
          Prices and tax
        </h2>
        <div className="field" id="ce-from" tabIndex={-1}>
          <span className="label-like" id="ce-from-label">
            From prices<span className="field__optional"> (optional)</span>
          </span>
          <p className="hint" id="ce-from-hint">
            {COPY.fromHint}
          </p>
          <div className="money-pair">
            <MoneyIn
              a11y={ctl("ce-priceInr", error("ce-priceInr"), "ce-from-hint")}
              label="From price in rupees"
              currency="INR"
              value={f.priceInr}
              onChange={(priceInr) => set({ priceInr })}
            />
            <MoneyIn
              a11y={ctl("ce-priceUsd", error("ce-priceUsd"), "ce-from-hint")}
              label="From price in US dollars"
              currency="USD"
              value={f.priceUsd}
              onChange={(priceUsd) => set({ priceUsd })}
            />
          </div>
          <RowError id="ce-priceInr" error={error("ce-priceInr")} />
          <RowError id="ce-priceUsd" error={error("ce-priceUsd")} />
        </div>
        <div className="form-grid">
          <FormField id="ce-sac" label="SAC" hint={COPY.sacHint} error={error("ce-sac")}>
            {(a) => (
              <input
                {...a}
                className="docno"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={f.sac}
                onChange={(e) => set({ sac: e.target.value.replace(/\D/g, "") })}
              />
            )}
          </FormField>
          <FormField
            id="ce-gstRate"
            label="GST rate"
            optional
            hint={COPY.gstHint}
            error={error("ce-gstRate")}
          >
            {(a) => (
              <NumberUnit a11y={a} value={f.gstRate} onChange={(gstRate) => set({ gstRate })} unit="%" />
            )}
          </FormField>
        </div>
      </section>

      <LinesEditor lines={f.lines} unit={f.unit} set={(lines) => set({ lines })} error={error} />
      <ScheduleEditor steps={f.schedule} set={(schedule) => set({ schedule })} error={error} />

      <section className="lead-panel" aria-labelledby="ce-incl-h">
        <h2 id="ce-incl-h" className="lead-panel__title">
          Deliverables, assumptions and exclusions
        </h2>
        <MdField
          id="ce-deliverablesMd"
          label="Deliverables"
          value={f.deliverablesMd}
          onChange={(deliverablesMd) => set({ deliverablesMd })}
          error={error("ce-deliverablesMd")}
        />
        <MdField
          id="ce-assumptionsMd"
          label="Assumptions"
          value={f.assumptionsMd}
          onChange={(assumptionsMd) => set({ assumptionsMd })}
          error={error("ce-assumptionsMd")}
        />
        <MdField
          id="ce-exclusionsMd"
          label="Exclusions"
          value={f.exclusionsMd}
          onChange={(exclusionsMd) => set({ exclusionsMd })}
          error={error("ce-exclusionsMd")}
        />
      </section>
    </>
  );
}

/** The side column of the form: the website address and the show-on-website switch. */
export function EntrySide({ form: f, set, error, mode }: EditorProps) {
  // The website shows this service and the switch is off: the next publish would be refused (07-L, added after the review).
  const usedBySite = mode === "edit" && !f.showOnSite && isSiteReferenced(f.code);
  return (
    <section className="lead-panel" aria-labelledby="ce-site-h">
      <h2 id="ce-site-h" className="lead-panel__title">
        Website
      </h2>
      <FormField id="ce-slug" label="Website address" optional error={error("ce-slug")}>
        {(a) => (
          <div className="slug-in">
            <span aria-hidden="true">/services/</span>
            <input
              {...a}
              className="docno"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              maxLength={80}
              value={f.slug}
              onChange={(e) => set({ slug: e.target.value })}
            />
          </div>
        )}
      </FormField>
      <div className="switch-row">
        <div className="switch-row__text">
          <span id="ce-onSite-label" className="switch-row__label">
            Show on website
          </span>
          <p className="hint" id="ce-onSite-desc">
            {COPY.onSiteHint}
          </p>
        </div>
        <Switch
          id="ce-onSite"
          checked={f.showOnSite}
          onChange={(showOnSite) => set({ showOnSite })}
          labelledBy="ce-onSite-label"
          describedBy={usedBySite ? "ce-onSite-desc ce-onSite-warn" : "ce-onSite-desc"}
        />
      </div>
      {usedBySite && (
        <Notice tone="info" id="ce-onSite-warn">
          {COPY.siteUsesService}
        </Notice>
      )}
    </section>
  );
}

/** A Markdown field: the text, the formatting hint, and a live preview once something is written. */
function MdField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | undefined;
}) {
  return (
    <div className="md-field">
      <FormField id={props.id} label={props.label} optional hint={FORMATTING_HINT} error={props.error}>
        {(a) => (
          <textarea
            {...a}
            rows={5}
            maxLength={2500}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
          />
        )}
      </FormField>
      {props.value.trim() && (
        <section className="md-preview" aria-label={`${props.label}: preview`}>
          <p className="md-preview__title" aria-hidden="true">
            Preview
          </p>
          <Markdown source={props.value} />
        </section>
      )}
    </div>
  );
}

/** Focus the first field of a row that was just added. */
function useFocusAdded(id: string | null) {
  useEffect(() => {
    if (id) document.getElementById(id)?.focus();
  }, [id]);
}

function LinesEditor(props: {
  lines: LineForm[];
  unit: CatalogueUnit;
  set: (lines: LineForm[]) => void;
  error: (id: string) => string | undefined;
}) {
  const [added, setAdded] = useState<string | null>(null);
  useFocusAdded(added);
  const edit = (i: number, patch: Partial<LineForm>) =>
    props.set(props.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <section className="lead-panel" aria-labelledby="ce-lines-h">
      <h2 id="ce-lines-h" className="lead-panel__title">
        Default lines<span className="field__optional"> (optional)</span>
      </h2>
      <p className="hint lines-hint" id="ce-lines-hint">
        {COPY.linesHint}
      </p>
      {props.lines.length > 0 && (
        <ol className="line-list" aria-labelledby="ce-lines-h" aria-describedby="ce-lines-hint">
          {props.lines.map((l, i) => {
            const id = (k: string) => `ce-line-${i}-${k}`;
            const n = i + 1;
            return (
              <li key={l.uid} className="line-row">
                <div className="line-row__cell line-row__cell--desc">
                  <label className="line-row__label" htmlFor={id("description")}>
                    <span className="visually-hidden">Line {n}, </span>Description
                  </label>
                  <input
                    {...ctl(id("description"), props.error(id("description")))}
                    autoComplete="off"
                    maxLength={200}
                    value={l.description}
                    onChange={(e) => edit(i, { description: e.target.value })}
                  />
                </div>
                <div className="line-row__cell">
                  <label className="line-row__label" htmlFor={id("unit")}>
                    <span className="visually-hidden">Line {n}, </span>Unit
                  </label>
                  <select
                    id={id("unit")}
                    value={l.unit}
                    onChange={(e) => edit(i, { unit: e.target.value as CatalogueUnit })}
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {UNIT_LABELS[u]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="line-row__cell">
                  <label className="line-row__label" htmlFor={id("qty")}>
                    <span className="visually-hidden">Line {n}, </span>Quantity
                  </label>
                  <input
                    {...ctl(id("qty"), props.error(id("qty")))}
                    className="line-row__qty"
                    inputMode="decimal"
                    autoComplete="off"
                    value={l.qty}
                    onChange={(e) => edit(i, { qty: e.target.value })}
                  />
                </div>
                <div className="line-row__cell">
                  <label className="line-row__label" htmlFor={id("rateInr")}>
                    <span className="visually-hidden">Line {n}, </span>Rate in rupees
                  </label>
                  <MoneyIn
                    a11y={ctl(id("rateInr"), props.error(id("rateInr")))}
                    currency="INR"
                    value={l.rateInr}
                    onChange={(rateInr) => edit(i, { rateInr })}
                  />
                </div>
                <div className="line-row__cell">
                  <label className="line-row__label" htmlFor={id("rateUsd")}>
                    <span className="visually-hidden">Line {n}, </span>Rate in US dollars
                  </label>
                  <MoneyIn
                    a11y={ctl(id("rateUsd"), props.error(id("rateUsd")))}
                    currency="USD"
                    value={l.rateUsd}
                    onChange={(rateUsd) => edit(i, { rateUsd })}
                  />
                </div>
                <button
                  type="button"
                  className="icon-btn line-row__remove"
                  aria-label={`Remove line ${n}`}
                  onClick={() => props.set(props.lines.filter((_, j) => j !== i))}
                >
                  <X size={16} />
                </button>
                <div className="line-row__errors">
                  {(["description", "qty", "rateInr", "rateUsd"] as const).map((k) => (
                    <RowError key={k} id={id(k)} error={props.error(id(k))} />
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {props.lines.length < MAX_LINES && (
        <button
          type="button"
          className="btn btn--text"
          onClick={() => {
            const line = newLine(props.unit);
            props.set([...props.lines, line]);
            setAdded(`ce-line-${props.lines.length}-description`);
          }}
        >
          <Plus size={16} />
          Add a line
        </button>
      )}
    </section>
  );
}

function ScheduleEditor(props: {
  steps: StepForm[];
  set: (steps: StepForm[]) => void;
  error: (id: string) => string | undefined;
}) {
  const [added, setAdded] = useState<string | null>(null);
  useFocusAdded(added);
  const edit = (i: number, patch: Partial<StepForm>) =>
    props.set(props.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const total = scheduleTotal(props.steps);
  const parsed = props.steps.map((s) => ({ ...s, pctBp: percentToBp(s.pct) }));
  const words =
    total === 10_000
      ? scheduleWords(parsed.map((s) => ({ label: s.label.trim(), pctBp: s.pctBp ?? 0, trigger: s.trigger })))
      : null;
  // A total that adds up again clears the error at once (the other field errors wait for the next save).
  const scheduleError = total === 10_000 && props.steps.length ? undefined : props.error("ce-schedule");
  return (
    <section className="lead-panel" aria-labelledby="ce-sched-h">
      <h2 id="ce-sched-h" className="lead-panel__title">
        Payment schedule
      </h2>
      <p className="hint" id="ce-sched-hint">
        {COPY.scheduleHint}
      </p>
      <ScheduleBar steps={parsed} />
      <ol
        className="step-list"
        id="ce-schedule"
        tabIndex={-1}
        aria-labelledby="ce-sched-h"
        aria-describedby={scheduleError ? "ce-sched-hint ce-schedule-error" : "ce-sched-hint"}
      >
        {props.steps.map((s, i) => {
          const id = (k: string) => `ce-step-${i}-${k}`;
          const n = i + 1;
          return (
            <li key={s.uid} className="step-row">
              <span className="step-row__swatch" data-alt={i % 2 === 1 || undefined} aria-hidden="true" />
              <div className="step-row__cell step-row__cell--label">
                <label className="line-row__label" htmlFor={id("label")}>
                  <span className="visually-hidden">Step {n}, </span>Name
                </label>
                <input
                  {...ctl(id("label"), props.error(id("label")))}
                  autoComplete="off"
                  maxLength={80}
                  value={s.label}
                  onChange={(e) => edit(i, { label: e.target.value })}
                />
              </div>
              <div className="step-row__cell">
                <label className="line-row__label" htmlFor={id("pct")}>
                  <span className="visually-hidden">Step {n}, </span>Share
                </label>
                <NumberUnit
                  a11y={ctl(id("pct"), props.error(id("pct")))}
                  value={s.pct}
                  onChange={(pct) => edit(i, { pct })}
                  unit="%"
                />
              </div>
              <div className="step-row__cell">
                <label className="line-row__label" htmlFor={id("trigger")}>
                  <span className="visually-hidden">Step {n}, </span>Paid
                </label>
                <select
                  id={id("trigger")}
                  value={s.trigger}
                  onChange={(e) => edit(i, { trigger: e.target.value as StepForm["trigger"] })}
                >
                  {TRIGGERS.map((t) => (
                    <option key={t} value={t}>
                      {TRIGGER_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="icon-btn step-row__remove"
                aria-label={`Remove step ${n}`}
                onClick={() => props.set(props.steps.filter((_, j) => j !== i))}
              >
                <X size={16} />
              </button>
              <div className="line-row__errors">
                <RowError id={id("label")} error={props.error(id("label"))} />
                <RowError id={id("pct")} error={props.error(id("pct"))} />
              </div>
            </li>
          );
        })}
      </ol>
      <SumLine total={total} words={words} />
      {scheduleError && <FieldError id="ce-schedule-error">{scheduleError}</FieldError>}
      {props.steps.length < MAX_STEPS && (
        <button
          type="button"
          className="btn btn--text"
          onClick={() => {
            props.set([...props.steps, newStep()]);
            setAdded(`ce-step-${props.steps.length}-label`);
          }}
        >
          <Plus size={16} />
          Add a step
        </button>
      )}
    </section>
  );
}

/** "Total: 90 %" while it doesn't add up; "Total: 100 %" and the website's sentence once it does. Read politely. */
function SumLine({ total, words }: { total: number | null; words: string | null }): ReactNode {
  return (
    <div className="sched-sum" aria-live="polite">
      <p className={total === 10_000 ? "sum sum--ok" : "sum"}>
        {total === null ? "Total: check the shares" : `Total: ${bpToPercent(total)} %`}
      </p>
      {words && <p className="sched__words sched__words--live">{words}</p>}
    </div>
  );
}
