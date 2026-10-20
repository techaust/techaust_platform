// Small shared pieces of the M1.5 screens: the logo, form fields, the code field, notices and the copy button.
// Tokens only (@techaust/ui); the design-system React components arrive with the admin shell in M3.1.
import logoColor from "@techaust/ui/brand/logo-primary-color.svg?url";
import logoDark from "@techaust/ui/brand/logo-primary-dark.svg?url";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { digitsOnly } from "../lib/format.ts";
import { Alert, ArrowLeft, Check, Copy } from "./icons.tsx";

/** The primary lockup, in its on-dark version when the OS is in dark mode (docs/06 §1). */
export function Logo() {
  return (
    <picture>
      <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
      <img src={logoColor} alt="TecHaust Technologies" className="logo" width="285" height="40" />
    </picture>
  );
}

/** The page frame: the card, the logo, an optional way back, and one h1 that takes focus when the page opens. */
export function Card(props: {
  title: string;
  wide?: boolean | undefined;
  back?: { to: string; label: string };
  children: ReactNode;
  busy?: boolean | undefined;
  lede?: ReactNode | undefined;
  /** The h1 takes focus when a step changes (pass the ref from useFocusOnChange). */
  titleRef?: Ref<HTMLHeadingElement> | undefined;
}) {
  return (
    <main className={props.wide ? "card card--wide" : "card"} aria-busy={props.busy || undefined}>
      <div className="card__top">
        <Logo />
        {props.back && (
          <Link to={props.back.to} className="back">
            <ArrowLeft size={16} />
            {props.back.label}
          </Link>
        )}
      </div>
      <h1 ref={props.titleRef} tabIndex={-1}>
        {props.title}
      </h1>
      {props.lede && <p className="lede">{props.lede}</p>}
      {props.children}
    </main>
  );
}

/** Move focus to the first heading of a step when it changes (docs/06 §5.4), so screen readers hear the new step. */
export function useFocusOnChange<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the step key changes
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.focus();
  }, [key]);
  return ref;
}

export function Field(props: {
  id: string;
  label: string;
  type?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: ReactNode | undefined;
  error?: string | null | undefined;
  inputMode?: "numeric" | "email" | "text" | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  autoFocus?: boolean | undefined;
  spellCheck?: boolean | undefined;
  autoCapitalize?: string | undefined;
  maxLength?: number | undefined;
  className?: string | undefined;
  children?: ReactNode | undefined;
  /** A control that sits inside the field's right edge (the password's Show/Hide). */
  addon?: ReactNode | undefined;
}) {
  const describedBy = [props.hint ? `${props.id}-hint` : null, props.error ? `${props.id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={props.className ? `field ${props.className}` : "field"}>
      <label htmlFor={props.id}>{props.label}</label>
      {props.hint && (
        <p className="hint" id={`${props.id}-hint`}>
          {props.hint}
        </p>
      )}
      {(() => {
        const input = (
          <input
            id={props.id}
            type={props.type ?? "text"}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            onFocus={props.onFocus}
            onBlur={props.onBlur}
            autoComplete={props.autoComplete}
            inputMode={props.inputMode}
            aria-describedby={describedBy || undefined}
            aria-invalid={props.error ? true : undefined}
            // biome-ignore lint/a11y/noAutofocus: each step has one field; focus follows the step change
            autoFocus={props.autoFocus}
            spellCheck={props.spellCheck}
            autoCapitalize={props.autoCapitalize}
            maxLength={props.maxLength}
            required
          />
        );
        return props.addon ? (
          <div className="input-wrap">
            {input}
            {props.addon}
          </div>
        ) : (
          input
        );
      })()}
      {props.children}
      {props.error && <FieldError id={`${props.id}-error`}>{props.error}</FieldError>}
    </div>
  );
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="field-error" id={id}>
      <Alert size={16} />
      <span>{children}</span>
    </p>
  );
}

/** The six-digit authenticator code: one field, digits only, paste-friendly, `one-time-code` (docs/06 §5.3). */
export function CodeField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode | undefined;
  error?: string | null | undefined;
  autoFocus?: boolean | undefined;
}) {
  return (
    <Field
      id={props.id}
      label={props.label}
      value={props.value}
      onChange={(v) => props.onChange(digitsOnly(v))}
      autoComplete="one-time-code"
      inputMode="numeric"
      hint={props.hint}
      error={props.error}
      autoFocus={props.autoFocus}
      className="field--code"
      spellCheck={false}
      maxLength={7}
    />
  );
}

/** An error or a status line for the whole form. `alert` interrupts (errors); `status` waits its turn. */
export function Notice({
  tone,
  children,
  id,
}: {
  tone: "error" | "info" | "success";
  children: ReactNode;
  id?: string | undefined;
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : "status"} id={id}>
      {tone === "success" ? <Check size={20} /> : <Alert size={20} />}
      <div>{children}</div>
    </div>
  );
}

/** Copies a value; says "Copied" in a polite live region (and on the button) for a few seconds. */
export function CopyButton({
  text,
  label,
  hiddenSuffix,
  className,
}: {
  text: string;
  label: string;
  /** Words only screen readers hear after the label ("Copy" + " codes"), when the context makes them obvious. */
  hiddenSuffix?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <>
      <button
        type="button"
        className={className ?? "btn btn--secondary"}
        onClick={() =>
          navigator.clipboard.writeText(text).then(
            () => setState("copied"),
            () => setState("failed"),
          )
        }
      >
        {state === "copied" ? <Check size={20} /> : <Copy size={20} />}
        {state === "copied" ? "Copied" : label}
        {hiddenSuffix && state !== "copied" && <span className="visually-hidden">{hiddenSuffix}</span>}
      </button>
      <span className="visually-hidden" role="status">
        {state === "copied"
          ? "Copied to the clipboard"
          : state === "failed"
            ? "Couldn't copy. Select the text and copy it yourself."
            : ""}
      </span>
    </>
  );
}

/** A link or key that is shown only once (invites, 2FA resets): read-only, selectable, with a copy button. */
export function ShownOnce(props: { id: string; label: string; value: string; children?: ReactNode }) {
  return (
    <div className="shown-once">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="shown-once__row">
        <input
          id={props.id}
          value={props.value}
          readOnly
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          className="mono"
        />
        <CopyButton text={props.value} label="Copy link" />
      </div>
      {props.children}
    </div>
  );
}

/** Loading placeholders for a list (docs/06 §5.3: skeletons, not spinners, for page data). */
export function SkeletonRows({ n }: { n: number }) {
  return (
    <ul className="rows" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <li key={i} className="row row--skeleton">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--line" />
        </li>
      ))}
    </ul>
  );
}
