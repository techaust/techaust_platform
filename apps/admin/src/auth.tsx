// M1.4 screens: sign in (email + password → authenticator code) and invite acceptance. Minimal on purpose;
// the full admin shell and design-system components come in M1.5/M3.1.

import logoColor from "@techaust/ui/brand/logo-primary-color.svg?url";
import logoDark from "@techaust/ui/brand/logo-primary-dark.svg?url";
import { type FormEvent, useEffect, useState } from "react";
import { api, hashPassword, RequestError, type User } from "./api.ts";

/** The primary lockup, in its on-dark version when the OS is in dark mode (docs/06 §1). */
function Logo() {
  return (
    <picture>
      <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
      <img src={logoColor} alt="TecHaust Technologies" className="logo" width="285" height="40" />
    </picture>
  );
}

const errorText = (e: unknown) =>
  e instanceof RequestError ? e.message : "Something went wrong. Check your connection and try again.";

function Field(props: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: string;
  inputMode?: "numeric";
}) {
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
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        aria-describedby={props.hint ? `${props.id}-hint` : undefined}
        required
      />
    </div>
  );
}

function Timing({ ms }: { ms: number | null }) {
  if (ms === null) return null;
  return <p className="hint">Password hashing took {ms.toLocaleString("en-IN")} ms on this device.</p>;
}

export function SignIn({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { salt, params } = await api.salt(email);
      const hashed = await hashPassword({ password, salt, params });
      setMs(hashed.ms);
      setChallenge((await api.login(email, hashed.hash)).challenge);
      setPassword("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn((await api.totp(challenge, code.replace(/\s/g, ""))).user);
    } catch (err) {
      setError(errorText(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="card">
      <Logo />
      <h1>Sign in</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {challenge === null ? (
        <form onSubmit={submitPassword}>
          <Field
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="username"
          />
          <Field
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode}>
          <Field
            id="code"
            label="Authenticator code"
            hint="The 6-digit code from your authenticator app."
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            inputMode="numeric"
          />
          <button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Sign in"}
          </button>
        </form>
      )}
      <Timing ms={ms} />
    </main>
  );
}

export function AcceptInvite({ token, onSignedIn }: { token: string; onSignedIn: (u: User) => void }) {
  const [invite, setInvite] = useState<Awaited<ReturnType<typeof api.inviteStart>> | null>(null);
  const [password, setPassword] = useState("");
  const [enrol, setEnrol] = useState<Awaited<ReturnType<typeof api.inviteFinish>> | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    api.inviteStart(token).then(setInvite, (err) => setError(errorText(err)));
  }, [token]);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    if (password.length < 12) {
      setError("Use at least 12 characters");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const hashed = await hashPassword({ password, salt: invite.salt, params: invite.params });
      setMs(hashed.ms);
      setEnrol(await api.inviteFinish(token, hashed.hash));
      setPassword("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!enrol) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn((await api.inviteTotp(enrol.challenge, code.replace(/\s/g, ""))).user);
      history.replaceState(null, "", "/");
    } catch (err) {
      setError(errorText(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="card">
      <Logo />
      <h1>Set up your account</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {invite && !enrol && (
        <form onSubmit={submitPassword}>
          <p>
            You're setting up <strong>{invite.email}</strong>.
          </p>
          <Field
            id="new-password"
            label="Choose a password"
            hint="At least 12 characters. A short sentence works well."
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Continue"}
          </button>
        </form>
      )}
      {enrol && (
        <form onSubmit={submitCode}>
          <p>
            Add TecHaust to your authenticator app (Google Authenticator, Microsoft Authenticator or
            1Password).
          </p>
          <p>
            On this phone, <a href={enrol.totpUri}>open it in your authenticator app</a>. On a computer, enter
            this key in the app:
          </p>
          <p className="secret">
            <code>{enrol.secret.match(/.{1,4}/g)?.join(" ")}</code>
          </p>
          <Field
            id="code"
            label="Code from the app"
            hint="Enter the 6-digit code to finish."
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            inputMode="numeric"
          />
          <button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Finish setup"}
          </button>
        </form>
      )}
      <Timing ms={ms} />
    </main>
  );
}

export function Home({ user, onSignedOut }: { user: User; onSignedOut: () => void }) {
  return (
    <main className="card">
      <Logo />
      <h1>Signed in</h1>
      <p>
        {user.email} · {user.role}
      </p>
      <p className="hint">The admin screens arrive in later milestones.</p>
      <button type="button" onClick={() => api.logout().then(onSignedOut, onSignedOut)}>
        Sign out
      </button>
    </main>
  );
}
