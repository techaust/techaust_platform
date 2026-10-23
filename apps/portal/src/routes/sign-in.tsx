// Ask for a sign-in link [POR-01]. One field. The reply is the same generic sentence for every email, known or not
// (the API answers 200 `{ ok: true }` for both); only a rate limit (429) or a failure to reach us reads differently.
// The form never says an email "has been sent" as a fact: a link goes only to addresses that can use the portal.
// M2.4b: the Turnstile check is always on this form (managed widget, action `portal_link`); each request takes the
// widget's current token once, and the widget is reset after every request that didn't succeed (tokens are single use).
import type { TurnstileWidget } from "@techaust/auth/client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { Mail } from "../components/icons.tsx";
import { TurnstileBox } from "../components/turnstile.tsx";
import { Card, Field, Notice, Reference } from "../components/ui.tsx";
import { COPY, checkFailed, emailProblem, type LinkOutcome, linkOutcome } from "../copy.ts";
import { useSession } from "../session.tsx";

export function SignIn() {
  const { note } = useSession();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LinkOutcome | null>(null);
  const [again, setAgain] = useState(false);
  const sent = outcome?.kind === "sent";
  const titleRef = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const widget = useRef<TurnstileWidget | null>(null);
  // Focus follows the step: the reply's heading once a link is requested; the field after "Use a different email".
  useEffect(() => {
    if (sent) titleRef.current?.focus();
    else if (again) emailRef.current?.focus();
  }, [sent, again]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = emailProblem(email);
    setFieldError(problem);
    if (problem) {
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    setOutcome(null);
    const token = (await widget.current?.token()) ?? "";
    if (!token) {
      // No token in time (the check is still running, failed, or its script couldn't load): nothing is sent.
      setOutcome(checkFailed());
      widget.current?.reset();
      setBusy(false);
      return;
    }
    try {
      await api.requestLink(email.trim(), token);
      setOutcome(linkOutcome());
    } catch (err) {
      setOutcome(linkOutcome(err));
      widget.current?.reset();
    } finally {
      setBusy(false);
    }
  }

  function startAgain() {
    setOutcome(null);
    setEmail("");
    setAgain(true);
  }

  if (sent) {
    return (
      <Card title={COPY.signIn.sentTitle} titleRef={titleRef}>
        <div className="sent">
          <span className="sent__icon">
            <Mail size={24} />
          </span>
          <p className="sent__text">{COPY.signIn.sent}</p>
        </div>
        <p className="signing-in-as">
          {COPY.signIn.sentFor} <strong>{email.trim()}</strong>
        </p>
        <p className="hint">{COPY.signIn.sentHelp}</p>
        <button type="button" className="btn btn--secondary btn--block btn--after-hint" onClick={startAgain}>
          {COPY.signIn.again}
        </button>
      </Card>
    );
  }

  return (
    <Card title={COPY.signIn.title} titleRef={titleRef} lede={COPY.signIn.lede} focusTitle={!!note}>
      {note && !outcome && <Notice tone="info">{note}</Notice>}
      {outcome?.kind === "rate_limited" && (
        <Notice tone="error" more={outcome.more}>
          {outcome.text}
        </Notice>
      )}
      {outcome?.kind === "check_failed" && <Notice tone="error">{outcome.text}</Notice>}
      {outcome?.kind === "error" && (
        <Notice tone="error" more={outcome.requestId ? <Reference id={outcome.requestId} /> : undefined}>
          {outcome.text}
        </Notice>
      )}
      <form onSubmit={submit} noValidate>
        <Field
          id="email"
          label={COPY.signIn.label}
          type="email"
          inputMode="email"
          value={email}
          onChange={(v) => {
            setEmail(v);
            if (fieldError) setFieldError(emailProblem(v));
          }}
          onBlur={() => email.trim() && setFieldError(emailProblem(email))}
          autoComplete="email"
          spellCheck={false}
          autoCapitalize="none"
          maxLength={254}
          error={fieldError}
          inputRef={emailRef}
        />
        <TurnstileBox action="portal_link" widgetRef={widget} />
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? COPY.signIn.busy : COPY.signIn.submit}
        </button>
      </form>
    </Card>
  );
}
