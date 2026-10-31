// Form pieces of the admin (docs/06 §5.4): FormField (label, hint, error linked by aria-describedby), the
// ErrorSummary that takes focus on submit, a Switch, a number with its unit, the settings row layout and the bar
// that holds unsaved changes. Validation runs on blur and on submit, never while the first characters are typed.
import { type ReactNode, useEffect, useRef } from "react";
import { FieldError } from "./ui.tsx";

export type FieldA11y = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

export function FormField(props: {
  id: string;
  label: string;
  hint?: ReactNode | undefined;
  error?: string | null | undefined;
  optional?: boolean | undefined;
  /** A line under the control that isn't an error (e.g. "Valid GSTIN"). */
  status?: ReactNode | undefined;
  className?: string | undefined;
  children: (a11y: FieldA11y) => ReactNode;
}) {
  const ids = [
    props.hint ? `${props.id}-hint` : null,
    props.status ? `${props.id}-status` : null,
    props.error ? `${props.id}-error` : null,
  ].filter(Boolean);
  const a11y: FieldA11y = { id: props.id };
  if (ids.length) a11y["aria-describedby"] = ids.join(" ");
  if (props.error) a11y["aria-invalid"] = true;
  return (
    <div className={props.className ? `field ${props.className}` : "field"}>
      {/* Head (label and hint) and body (control, status, error): in a two-column .form-grid the heads of one row share a
          height, so the controls beside each other line up whatever the hints (shell.css). */}
      <div className="field__head">
        <label htmlFor={props.id} id={`${props.id}-label`}>
          {props.label}
          {props.optional && <span className="field__optional"> (optional)</span>}
        </label>
        {props.hint && (
          <p className="hint" id={`${props.id}-hint`}>
            {props.hint}
          </p>
        )}
      </div>
      <div className="field__body">
        {props.children(a11y)}
        {props.status && !props.error && (
          <p className="field-status" id={`${props.id}-status`}>
            {props.status}
          </p>
        )}
        {props.error && <FieldError id={`${props.id}-error`}>{props.error}</FieldError>}
      </div>
    </div>
  );
}

export type SummaryError = { id: string; text: string };

/** At the top of a form after a failed submit: links to each invalid field; takes focus so it is read first. */
export function ErrorSummary({ errors, focusKey }: { errors: SummaryError[]; focusKey: number }) {
  const ref = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus again on every submit (focusKey changes)
  useEffect(() => {
    // focusKey counts submits: 0 means none yet, so nothing takes focus while the page loads.
    if (errors.length && focusKey > 0) ref.current?.focus();
  }, [focusKey]);
  if (!errors.length) return null;
  return (
    <section className="error-summary" ref={ref} tabIndex={-1} aria-labelledby="error-summary-title">
      <h2 id="error-summary-title" className="error-summary__title">
        {errors.length === 1 ? "Fix 1 thing before saving" : `Fix ${errors.length} things before saving`}
      </h2>
      <ul>
        {errors.map((e, i) => (
          // one field can break two rules (a template heading with two placeholder faults): the position keeps the keys apart
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is rebuilt whole on every submit; the id alone can repeat
          <li key={`${e.id}-${i}`}>
            <a
              href={`#${e.id}`}
              onClick={(ev) => {
                ev.preventDefault();
                const el = document.getElementById(e.id);
                el?.focus();
                el?.scrollIntoView({ block: "center" });
              }}
            >
              {e.text}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** An on/off setting: a real switch (role="switch"), with "On" / "Off" in words beside the track. */
export function Switch(props: {
  id: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  labelledBy: string;
  describedBy?: string | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <button
      id={props.id}
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-labelledby={props.labelledBy}
      aria-describedby={props.describedBy}
      className="switch"
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__text" aria-hidden="true">
        {props.checked ? "On" : "Off"}
      </span>
    </button>
  );
}

/** A number with its unit after it ("7 days", "18 %"); the unit is part of the accessible description. */
export function NumberUnit(props: {
  a11y: FieldA11y;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  onBlur?: (() => void) | undefined;
  readOnly?: boolean | undefined;
}) {
  return (
    <div className="number-unit">
      <input
        {...props.a11y}
        type="text"
        inputMode="numeric"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
        readOnly={props.readOnly}
      />
      <span className="number-unit__unit" aria-hidden="true">
        {props.unit}
      </span>
    </div>
  );
}

/** A settings row: what it is and why on the left, the control on the right (stacked below md). */
export function SettingRow(props: {
  id: string;
  label: string;
  description?: ReactNode | undefined;
  children: ReactNode;
  /** The control is a switch or a group: the label is a span referenced by aria-labelledby, not a <label>. */
  labelFor?: string | undefined;
  /** Forms mark the optional fields (owner decision 2026-10-24). */
  optional?: boolean | undefined;
}) {
  const opt = props.optional && <span className="field__optional"> (optional)</span>;
  return (
    <div className="setting">
      <div className="setting__text">
        {props.labelFor ? (
          <label htmlFor={props.labelFor} id={`${props.id}-label`} className="setting__label">
            {props.label}
            {opt}
          </label>
        ) : (
          <span id={`${props.id}-label`} className="setting__label">
            {props.label}
            {opt}
          </span>
        )}
        {props.description && (
          <p className="hint" id={`${props.id}-desc`}>
            {props.description}
          </p>
        )}
      </div>
      <div className="setting__control">{props.children}</div>
    </div>
  );
}

/** The gap kept between a focused field and the bar (`--space-4`). */
const BAR_GAP_PX = 16;

/**
 * While the bar is up, a field that takes the focus below its top edge is scrolled up clear of it (WCAG 2.4.11; rt2 visual review 3). The page's
 * `scroll-padding-bottom` (app.css) places a field scrolled in from off screen, but Chromium doesn't scroll a field that is already inside the
 * window, even one under the fixed bar, so this measures after the browser's own scroll and moves the page the rest. Never past the top bar's
 * padding (a field taller than the room keeps its top in view); dialogs (top layer) and anything outside the page's `main` are left alone.
 */
function useClearOfBar(bar: { readonly current: HTMLElement | null }, on: boolean) {
  useEffect(() => {
    if (!on) return;
    function clear(e: FocusEvent) {
      const t = e.target;
      if (!(t instanceof Element) || !t.closest("main") || t.closest("dialog")) return;
      requestAnimationFrame(() => {
        const b = bar.current;
        if (!b || b.contains(t) || document.activeElement !== t) return;
        const box = t.getBoundingClientRect();
        const over = box.bottom - (b.getBoundingClientRect().top - BAR_GAP_PX);
        if (over <= 0) return;
        const top = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        const shift = Math.min(over, box.top - top);
        if (shift > 0) window.scrollBy({ top: shift, behavior: "instant" });
      });
    }
    document.addEventListener("focusin", clear);
    return () => document.removeEventListener("focusin", clear);
  }, [bar, on]);
}

/** The bar that appears while a form has unsaved changes; it stays at the bottom of the window. */
export function SaveBar(props: {
  dirty: boolean;
  busy?: boolean | undefined;
  onDiscard: () => void;
  saveLabel?: string | undefined;
  form: string;
}) {
  const bar = useRef<HTMLElement>(null);
  useClearOfBar(bar, props.dirty);
  if (!props.dirty) return null;
  return (
    <section className="savebar" aria-label="Unsaved changes" ref={bar}>
      <p className="savebar__text">You have unsaved changes.</p>
      <div className="savebar__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onDiscard} disabled={props.busy}>
          Discard
        </button>
        <button
          type="submit"
          form={props.form}
          className="btn btn--primary"
          disabled={props.busy}
          aria-busy={props.busy || undefined}
        >
          {props.busy ? "Saving…" : (props.saveLabel ?? "Save changes")}
        </button>
      </div>
    </section>
  );
}

/** 07-W §4: the tag and the accessible name of the researched-default note. */
export const RESEARCHED_DEFAULT = "Researched default";

/** 07-ZK line 12 (approved 2026-11-01; replaces 07-W §4's text): one text for every settings page that carries the researched-default note. */
export const researchedSettingsText = () =>
  "These defaults follow official sources, researched on 28 October 2026. Where the sources leave a question open, the default takes the safest reading.";

/**
 * Tax and legal settings carry this (CLAUDE.md hard rule 8): the defaults are researched from official sources (08-C), and a question the sources leave
 * open is settled by the lead on the safest reading or kept OPEN in 08-C §5. One tag for every kind (07-W §4).
 */
export function VerifyNote({ children }: { children: ReactNode }) {
  return (
    <aside className="verify-note" aria-label={RESEARCHED_DEFAULT}>
      <p className="verify-note__tag">{RESEARCHED_DEFAULT}</p>
      <p className="verify-note__text">{children}</p>
    </aside>
  );
}
