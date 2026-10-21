// Small shared pieces of the M1.6 portal screens: the logo, the card frame, form fields and notices. Copied from the
// admin's M1.5 screens (apps can't import apps) and trimmed to what the portal needs. Tokens only (@techaust/ui);
// the shared React components arrive with the portal shell in M4.5.
import logoColor from "@techaust/ui/brand/logo-primary-color.svg?url";
import logoDark from "@techaust/ui/brand/logo-primary-dark.svg?url";
import { type ReactNode, type Ref, type RefObject, useEffect, useRef } from "react";
import { Link } from "react-router";
import { COPY, DOC_TITLE_SUFFIX, PRODUCT } from "../copy.ts";
import { Alert, ArrowLeft, Check, Info } from "./icons.tsx";

/** The primary lockup, in its on-dark version when the OS is in dark mode (docs/06 §1). */
export function Logo() {
  return (
    <picture>
      <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
      <img src={logoColor} alt="TecHaust Technologies" className="logo" width="285" height="40" />
    </picture>
  );
}

/**
 * The page frame: the card, the logo with the product's name, an optional way back, and one h1. The tab title
 * follows the h1 (WCAG 2.4.2), so a client with several tabs open can tell the portal's screens apart.
 */
export function Card(props: {
  title: string;
  children?: ReactNode;
  back?: { to: string; label: string } | undefined;
  busy?: boolean | undefined;
  lede?: ReactNode | undefined;
  /** The h1 takes focus when a step changes (pass the ref from useFocusOnChange). */
  titleRef?: RefObject<HTMLHeadingElement | null> | undefined;
  /** Screens reached by a link or after signing in: the h1 takes focus on arrival. */
  focusTitle?: boolean | undefined;
}) {
  const own = useRef<HTMLHeadingElement>(null);
  const ref = props.titleRef ?? own;
  const { focusTitle, title } = props;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ref object is stable; focus only on arrival
  useEffect(() => {
    if (focusTitle) ref.current?.focus();
  }, [focusTitle]);
  useEffect(() => {
    document.title = `${title} – ${DOC_TITLE_SUFFIX}`;
  }, [title]);
  return (
    <main className="card" aria-busy={props.busy || undefined}>
      <div className="card__top">
        <div className="brand">
          <Logo />
          <span className="brand__product">{PRODUCT}</span>
        </div>
        {props.back && (
          <Link to={props.back.to} className="back">
            <ArrowLeft size={16} />
            {props.back.label}
          </Link>
        )}
      </div>
      <h1 ref={ref} tabIndex={-1}>
        {props.title}
      </h1>
      {props.lede && <p className="lede">{props.lede}</p>}
      {props.children}
    </main>
  );
}

/** While the session (or a screen's code) loads: the frame with quiet placeholders, no spinner (docs/06 §5.3). */
export function LoadingCard() {
  return (
    <main className="card" aria-busy="true">
      <div className="card__top">
        <div className="brand">
          <Logo />
          <span className="brand__product">{PRODUCT}</span>
        </div>
      </div>
      <p className="visually-hidden" role="status">
        {COPY.loading}
      </p>
      <div aria-hidden="true">
        <span className="skeleton skeleton--title" />
        <span className="skeleton skeleton--line" />
        <span className="skeleton skeleton--line skeleton--short" />
      </div>
    </main>
  );
}

export function Field(props: {
  id: string;
  label: string;
  type?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  onBlur?: (() => void) | undefined;
  autoComplete: string;
  hint?: ReactNode | undefined;
  error?: string | null | undefined;
  inputMode?: "numeric" | "email" | "text" | undefined;
  spellCheck?: boolean | undefined;
  autoCapitalize?: string | undefined;
  maxLength?: number | undefined;
  inputRef?: Ref<HTMLInputElement> | undefined;
}) {
  const describedBy = [props.hint ? `${props.id}-hint` : null, props.error ? `${props.id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      {props.hint && (
        <p className="hint" id={`${props.id}-hint`}>
          {props.hint}
        </p>
      )}
      <input
        id={props.id}
        ref={props.inputRef}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        aria-describedby={describedBy || undefined}
        aria-invalid={props.error ? true : undefined}
        spellCheck={props.spellCheck}
        autoCapitalize={props.autoCapitalize}
        maxLength={props.maxLength}
        required
      />
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

/** An error or a status line for the whole screen. `alert` interrupts (errors); `status` waits its turn. */
export function Notice({
  tone,
  children,
  more,
}: {
  tone: "error" | "info" | "success";
  children: ReactNode;
  more?: ReactNode | undefined;
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {tone === "success" ? <Check size={20} /> : tone === "info" ? <Info size={20} /> : <Alert size={20} />}
      <div>
        {children}
        {more && <span className="notice__more">{more}</span>}
      </div>
    </div>
  );
}

/** The request ID of a server fault, so a client can quote it to us. */
export function Reference({ id }: { id: string | null }) {
  if (!id) return null;
  return (
    <>
      {COPY.reference}: <span className="mono break">{id}</span>
    </>
  );
}
