// Sign in [ADM-AUTH-01, -02, -04, -06]: email and password (hashed in the browser), then the authenticator code,
// or a recovery code instead. One generic error for every wrong answer (no hint which part was wrong); a lockout
// message after too many attempts.
// M2.4b: after 3 wrong attempts the server asks for the Turnstile check (401 `turnstile_required`). The check then
// appears above the button with the 07-G line, and stays for every later attempt on this page: each attempt takes the
// widget's current token once, and the widget is reset after every attempt that didn't succeed (tokens are single
// use). The password's client hash is reused from memory (lib/password-sign-in.ts), never hashed twice or stored.
import type { TurnstileWidget } from "@techaust/auth/client";
import { type FormEvent, useRef, useState } from "react";
import { api, errorText, hashPassword, RequestError } from "../api.ts";
import { TurnstileBox } from "../components/turnstile.tsx";
import { Card, CodeField, Field, Notice } from "../components/ui.tsx";
import { passwordSignIn } from "../lib/password-sign-in.ts";
import { useSession } from "../session.tsx";

type Step = "password" | "code" | "recovery";

/** 07-G §3 (owner-approved, M2.4b): the line with the Turnstile check. */
const CHECK_LINE = "To keep your account safe, please complete the check below, then sign in again.";

const HEADINGS: Record<Step, string> = {
  password: "Sign in",
  code: "Enter your code",
  recovery: "Use a recovery code",
};

export function SignIn() {
  const { signedIn, endedNote } = useSession();
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; locked: boolean } | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  // Focus goes to the one field of each step (its label and hint are read out); after "Start again", to the email.
  const [restarted, setRestarted] = useState(false);
  // The Turnstile check: off until the server asks for it, then on for the rest of this page. `nudge` re-announces
  // the line when an attempt had no token to send.
  const [check, setCheck] = useState(false);
  const [nudge, setNudge] = useState(0);
  const widget = useRef<TurnstileWidget | null>(null);
  const [signIn] = useState(() =>
    passwordSignIn({ salt: api.salt, hash: hashPassword, login: api.login, onHashed: setMs }),
  );

  const fail = (err: unknown) =>
    setError({ text: errorText(err), locked: err instanceof RequestError && err.code === "locked" });

  function go(next: Step) {
    setError(null);
    setFieldError(null);
    setCode("");
    setRecovery("");
    setStep(next);
  }

  function startAgain() {
    setChallenge(null);
    setPassword("");
    signIn.forget();
    setRestarted(true);
    go("password");
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let token: string | undefined;
      if (check) {
        token = (await widget.current?.token()) ?? "";
        if (!token) {
          // No token in time (the check is still running or failed): nothing is sent; the line says what to do.
          widget.current?.reset();
          setNudge((n) => n + 1);
          return;
        }
      }
      const r = await signIn.attempt(email, password, token);
      if (r.kind === "challenge") {
        setChallenge(r.challenge);
        setPassword("");
        go("code");
        return;
      }
      if (check) widget.current?.reset();
      if (r.kind === "check_required") {
        setCheck(true);
        setNudge((n) => n + 1);
      } else fail(r.error);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    if (code.length !== 6) {
      setFieldError("Enter the 6 digits from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      signedIn((await api.totp(challenge, code)).user);
    } catch (err) {
      fail(err);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function submitRecovery(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    if (recovery.replace(/[\s-]/g, "").length !== 16) {
      setFieldError("A recovery code has 16 letters and numbers, like ABCD-EFGH-JKLM-NPQR.");
      return;
    }
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      signedIn((await api.recovery(challenge, recovery.trim())).user);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={HEADINGS[step]}>
      {endedNote && step === "password" && !error && <Notice tone="info">{endedNote}</Notice>}
      {error && (
        <Notice tone="error">
          {error.text}
          {error.locked && (
            <span className="notice__more">
              This protects the account from guessing. If it wasn't you, tell the owner.
            </span>
          )}
        </Notice>
      )}

      {step === "password" && (
        <form onSubmit={submitPassword}>
          <Field
            id="email"
            label="Email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(v) => {
              signIn.forget();
              setEmail(v);
            }}
            autoComplete="username"
            spellCheck={false}
            autoCapitalize="none"
            autoFocus={restarted}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={(v) => {
              signIn.forget();
              setPassword(v);
            }}
            autoComplete="current-password"
          />
          {check && (
            <div className="bot-check">
              <Notice tone="info" key={nudge}>
                {CHECK_LINE}
              </Notice>
              <TurnstileBox action="admin_login" widgetRef={widget} />
            </div>
          )}
          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={submitCode} noValidate>
          <p className="signing-in-as">
            Signing in as <strong>{email}</strong>
          </p>
          <CodeField
            id="code"
            label="Authenticator code"
            hint="The 6-digit code from your authenticator app."
            value={code}
            onChange={setCode}
            error={fieldError}
            autoFocus
          />
          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? "Checking…" : "Sign in"}
          </button>
          <div className="alt-actions">
            <button type="button" className="btn btn--text" onClick={() => go("recovery")}>
              Use a recovery code
            </button>
            <button type="button" className="btn btn--text" onClick={startAgain}>
              Start again
            </button>
          </div>
        </form>
      )}

      {step === "recovery" && (
        <form onSubmit={submitRecovery} noValidate>
          <p className="signing-in-as">
            Signing in as <strong>{email}</strong>
          </p>
          <Field
            id="recovery-code"
            label="Recovery code"
            hint="One of the codes you saved when you set up your account. Each code works once."
            value={recovery}
            onChange={setRecovery}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            error={fieldError}
            autoFocus
            className="field--mono"
            maxLength={40}
          />
          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? "Checking…" : "Sign in"}
          </button>
          <div className="alt-actions">
            <button type="button" className="btn btn--text" onClick={() => go("code")}>
              Use your authenticator app
            </button>
            <button type="button" className="btn btn--text" onClick={startAgain}>
              Start again
            </button>
          </div>
        </form>
      )}

      {ms !== null && (
        <p className="hint hint--foot">
          Password hashing took {ms.toLocaleString("en-IN")} ms on this device.
        </p>
      )}
    </Card>
  );
}
