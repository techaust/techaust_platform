// Accept an invite [ADM-AUTH-03, -04, -07]: your name and a password (rules checked here, in the browser), then the
// authenticator app (QR code, a link on a phone, or the key typed in), then the ten recovery codes, shown once.
// The token is in the URL fragment (#t=…): it never reaches a server log. Loaded with import() (route chunk), and
// the password dictionaries load on top of that only when the password field is used.
import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { api, errorText, hashPassword, type User } from "../api.ts";
import { QrCode } from "../components/qr-code.tsx";
import { RecoveryCodes } from "../components/recovery-codes.tsx";
import { Card, CodeField, CopyButton, Field, Notice, useFocusOnChange } from "../components/ui.tsx";
import { groupSecret, inviteTokenFromHash, ROLE_LABELS } from "../lib/format.ts";
import {
  evaluatePassword,
  lengthProblem,
  MIN_LENGTH,
  MIN_SCORE,
  passwordLength,
  personalWords,
  preloadStrength,
  STRENGTH_LABELS,
  type Strength,
  zxcvbnStrength,
} from "../lib/password-policy.ts";
import { useSession } from "../session.tsx";

type Invite = Awaited<ReturnType<typeof api.inviteStart>>;
type Enrolment = Awaited<ReturnType<typeof api.inviteFinish>>;
type Step = "details" | "app" | "codes";

const STEPS: Record<Step, { n: number; title: string }> = {
  details: { n: 1, title: "Your name and password" },
  app: { n: 2, title: "Add your authenticator app" },
  codes: { n: 3, title: "Save your recovery codes" },
};

export function Component() {
  const [token] = useState(() => inviteTokenFromHash(location.hash));
  const [invite, setInvite] = useState<Invite | null>(null);
  const [invalid, setInvalid] = useState<string | null>(token ? null : "This invite link is incomplete.");
  const [step, setStep] = useState<Step>("details");
  const [enrol, setEnrol] = useState<Enrolment | null>(null);
  const [done, setDone] = useState<{ user: User; codes: string[] } | null>(null);
  const heading = useFocusOnChange<HTMLHeadingElement>(step);
  const { user } = useSession();

  useEffect(() => {
    if (!token) return;
    api.inviteStart(token).then(setInvite, (err) => setInvalid(errorText(err)));
  }, [token]);

  // No token (e.g. a reload after setup took it out of the address bar): someone signed in goes home.
  if (!token && user) return <Navigate to="/" replace />;
  if (!token && user === undefined) return null;
  if (invalid) return <InviteInvalid reason={invalid} />;
  if (!invite || !token) {
    return (
      <Card title="Set up your account" busy>
        <p className="hint" role="status">
          Checking your invite…
        </p>
      </Card>
    );
  }

  const s = STEPS[step];
  return (
    <Card title={s.title} titleRef={heading}>
      <Progress n={s.n} of={3} />
      {step === "details" && (
        <DetailsStep
          token={token}
          invite={invite}
          onDone={(e) => {
            setEnrol(e);
            setStep("app");
          }}
        />
      )}
      {step === "app" && enrol && (
        <AppStep
          enrol={enrol}
          email={invite.email}
          onDone={(user, codes) => {
            // Signed in now; take the token out of the address bar so a reload can't show it again.
            history.replaceState(history.state, "", "/invite");
            setDone({ user, codes });
            setStep("codes");
          }}
        />
      )}
      {step === "codes" && done && <CodesStep user={done.user} codes={done.codes} />}
    </Card>
  );
}

function Progress({ n, of }: { n: number; of: number }) {
  return (
    <div className="progress">
      <p className="progress__text">
        Step {n} of {of}
      </p>
      <div className="progress__bar" aria-hidden="true">
        {Array.from({ length: of }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of segments
          <span key={i} className={i < n ? "progress__seg progress__seg--done" : "progress__seg"} />
        ))}
      </div>
    </div>
  );
}

function InviteInvalid({ reason }: { reason: string }) {
  return (
    <Card title="This invite link doesn't work">
      <Notice tone="error">{reason}</Notice>
      <p>
        Invite links work once, for 48 hours, and stop working when a newer invite is sent. Ask the owner for
        a new link.
      </p>
      <p>
        <a href="/">Go to sign in</a>
      </p>
    </Card>
  );
}

function DetailsStep(props: { token: string; invite: Invite; onDone: (e: Enrolment) => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [strength, setStrength] = useState<Strength | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "checking" | "hashing">("idle");
  const [ms, setMs] = useState<number | null>(null);
  const inputs = personalWords(name, props.invite.email);
  const inputsKey = inputs.join(" ");

  // The meter: re-scored shortly after typing stops, once the dictionaries have loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: inputsKey stands for inputs
  useEffect(() => {
    if (!password) {
      setStrength(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      zxcvbnStrength(password, inputs).then(
        (s) => live && setStrength(s),
        () => live && setStrength(null),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [password, inputsKey]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim() ? null : "Enter your name.";
    setNameError(n);
    setError(null);
    const short = lengthProblem(password);
    if (short || n) {
      setPwError(short);
      return;
    }
    setPhase("checking");
    try {
      const verdict = await evaluatePassword(password, inputs);
      if (!verdict.ok) {
        setPwError(verdict.problems.join(" "));
        return;
      }
      setPwError(null);
      setPhase("hashing");
      const hashed = await hashPassword({ password, salt: props.invite.salt, params: props.invite.params });
      setMs(hashed.ms);
      const enrol = await api.inviteFinish(props.token, hashed.hash, name.trim());
      setPassword("");
      props.onDone(enrol);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  return (
    <form onSubmit={submit} noValidate>
      <p>
        You're setting up <strong>{props.invite.email}</strong>.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Field
        id="name"
        label="Your name"
        hint="As your colleagues know you. It appears in the activity log."
        value={name}
        onChange={setName}
        onBlur={() => {
          if (name.trim()) setNameError(null);
        }}
        autoComplete="name"
        error={nameError}
        maxLength={100}
      />
      <Field
        id="new-password"
        label="Choose a password"
        hint={`At least ${MIN_LENGTH} characters. A short sentence of unrelated words works well.`}
        type={show ? "text" : "password"}
        value={password}
        onChange={setPassword}
        onFocus={preloadStrength}
        autoComplete="new-password"
        spellCheck={false}
        autoCapitalize="none"
        error={pwError}
        className="field--password"
        addon={
          <button
            type="button"
            className="reveal"
            aria-controls="new-password"
            onClick={() => setShow((v) => !v)}
          >
            {show ? "Hide" : "Show"}
            <span className="visually-hidden"> password</span>
          </button>
        }
      >
        <StrengthMeter password={password} strength={strength} />
      </Field>
      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {phase === "checking" ? "Checking password…" : phase === "hashing" ? "Saving…" : "Continue"}
      </button>
      {ms !== null && (
        <p className="hint hint--foot">
          Password hashing took {ms.toLocaleString("en-IN")} ms on this device.
        </p>
      )}
    </form>
  );
}

function StrengthMeter({ password, strength }: { password: string; strength: Strength | null }) {
  if (!password) return null;
  const length = passwordLength(password);
  const short = length < MIN_LENGTH;
  const score = strength?.score ?? null;
  const level = score === null ? 0 : score;
  const good = !short && score !== null && score >= MIN_SCORE;
  return (
    <div className="meter" data-good={good || undefined}>
      <div className="meter__bar" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={
              score !== null && i <= Math.max(level, 1) ? `meter__seg meter__seg--${level}` : "meter__seg"
            }
          />
        ))}
      </div>
      <p className="meter__text" aria-live="polite">
        {short
          ? `${length} of ${MIN_LENGTH} characters`
          : score === null
            ? "Checking strength…"
            : `Strength: ${STRENGTH_LABELS[score]}${score < MIN_SCORE ? " (needs to be Good or Strong)" : ""}`}
      </p>
    </div>
  );
}

function AppStep(props: { enrol: Enrolment; email: string; onDone: (u: User, codes: string[]) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setFieldError("Enter the 6 digits your authenticator app shows for TecHaust.");
      return;
    }
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      const r = await api.inviteTotp(props.enrol.challenge, code);
      props.onDone(r.user, r.recoveryCodes);
    } catch (err) {
      setCode("");
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <p>
        Every sign-in needs a code from an authenticator app, such as Google Authenticator, Microsoft
        Authenticator or 1Password.
      </p>
      <div className="enrol">
        <QrCode value={props.enrol.totpUri} label="QR code to add TecHaust admin to your authenticator app" />
        <ol className="enrol__steps">
          <li>Open your authenticator app and choose to add an account.</li>
          <li>Scan this QR code with it.</li>
          <li>Enter the 6-digit code it shows below.</li>
        </ol>
      </div>
      <p className="enrol__phone">
        On this phone? <a href={props.enrol.totpUri}>Open in your authenticator app</a>
      </p>
      <details className="disclosure">
        <summary>Can't scan? Type the key instead</summary>
        <div className="disclosure__body">
          <p>In your app, choose to enter a setup key, and use:</p>
          <dl className="key-facts">
            <dt>Account</dt>
            <dd>{props.email}</dd>
            <dt>Key</dt>
            <dd>
              <code className="secret">{groupSecret(props.enrol.secret)}</code>
            </dd>
            <dt>Type</dt>
            <dd>Time-based</dd>
          </dl>
          <CopyButton text={props.enrol.secret} label="Copy key" />
        </div>
      </details>
      {error && <Notice tone="error">{error}</Notice>}
      <CodeField
        id="enrol-code"
        label="Code from the app"
        hint="Shown under TecHaust in your app. It changes every 30 seconds."
        value={code}
        onChange={setCode}
        error={fieldError}
      />
      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {busy ? "Checking…" : "Finish setup"}
      </button>
    </form>
  );
}

function CodesStep({ user, codes }: { user: User; codes: string[] }) {
  const { signedIn } = useSession();
  const navigate = useNavigate();
  return (
    <>
      <Notice tone="success">Your account is ready. You're signed in as {ROLE_LABELS[user.role]}.</Notice>
      <RecoveryCodes
        codes={codes}
        email={user.email}
        doneLabel="Continue to the admin"
        onDone={() => {
          signedIn(user);
          navigate("/", { replace: true });
        }}
      />
    </>
  );
}
