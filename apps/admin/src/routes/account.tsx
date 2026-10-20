// Your account [ADM-AUTH-04, -05, -08]: where you're signed in (sign out one, or everywhere) and your recovery
// codes (how many are left; make new ones after a fresh step-up). Loaded with import() (route chunk).
import { useCallback, useEffect, useState } from "react";
import { api, errorText, type Session } from "../api.ts";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { RecoveryCodes } from "../components/recovery-codes.tsx";
import { Card, Notice, SkeletonRows } from "../components/ui.tsx";
import { when } from "../lib/format.ts";
import { describeUserAgent } from "../lib/user-agent.ts";
import { useSession, useUser } from "../session.tsx";

type Data = { sessions: Session[]; recovery_codes_remaining: number };
type Pending = { kind: "one"; session: Session } | { kind: "all" } | { kind: "codes" } | null;

export function Component() {
  const user = useUser();
  const { signedOut } = useSession();
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api.sessions().then(setData, (e) => setLoadError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  async function revokeOne(s: Session) {
    await api.revokeSession(s.id);
    if (s.current) {
      signedOut("You've signed out of this browser.");
      return undefined;
    }
    setNotice(`Signed out of ${describeUserAgent(s.user_agent)}.`);
    load();
    return undefined;
  }

  async function revokeAll() {
    await api.revokeAllMine();
    signedOut("You've signed out everywhere, including this browser.");
    return undefined;
  }

  async function regenerate() {
    const r = await api.regenerateRecoveryCodes();
    setNewCodes(r.recoveryCodes);
    setNotice(null);
    return undefined;
  }

  return (
    <Card title="Your account" wide back={{ to: "/", label: "Home" }} busy={!data && !loadError}>
      {notice && <Notice tone="success">{notice}</Notice>}
      {loadError && (
        <div className="load-error">
          <Notice tone="error">{loadError}</Notice>
          <button type="button" className="btn btn--secondary" onClick={load}>
            Try again
          </button>
        </div>
      )}

      <section className="section" aria-labelledby="sessions-h">
        <div className="section__head">
          <h2 id="sessions-h">Where you're signed in</h2>
          <p className="hint">Sign out of any browser you don't recognise or no longer use.</p>
        </div>
        {!data && !loadError && <SkeletonRows n={2} />}
        {data && (
          <ul className="rows">
            {[...data.sessions]
              .sort((a, b) => Number(b.current) - Number(a.current))
              .map((s) => (
                <li key={s.id} className="row">
                  <div className="row__main">
                    <p className="row__title">
                      {describeUserAgent(s.user_agent)}
                      {s.current && <span className="pill pill--accent">This browser</span>}
                    </p>
                    <dl className="row__facts">
                      <div>
                        <dt>Signed in</dt>
                        <dd>{when(s.created_at)}</dd>
                      </div>
                      <div>
                        <dt>Last active</dt>
                        <dd>{when(s.last_seen_at)}</dd>
                      </div>
                      <div>
                        <dt>IP address</dt>
                        <dd className="mono">{s.ip ?? "Unknown"}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="row__actions">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setPending({ kind: "one", session: s })}
                      aria-label={`Sign out of ${describeUserAgent(s.user_agent)}${s.current ? " (this browser)" : ""}, signed in ${when(s.created_at)}`}
                    >
                      Sign out
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        )}
        {data && (
          <div className="section__foot">
            <button
              type="button"
              className="btn btn--danger-outline"
              onClick={() => setPending({ kind: "all" })}
            >
              Sign out everywhere
            </button>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="codes-h">
        <div className="section__head">
          <h2 id="codes-h">Recovery codes</h2>
          {!newCodes && (
            <p className="hint">Each code lets you sign in once if you can't use your authenticator app.</p>
          )}
        </div>
        {newCodes ? (
          <RecoveryCodes
            codes={newCodes}
            email={user.email}
            doneLabel="Done"
            focusOnMount
            level={3}
            onDone={() => {
              setNewCodes(null);
              setNotice("New recovery codes saved. Your old codes no longer work.");
              load();
            }}
          />
        ) : (
          data && (
            <div className="codes-left">
              <p
                className={
                  data.recovery_codes_remaining <= 3 ? "codes-left__n codes-left__n--low" : "codes-left__n"
                }
              >
                <strong>{data.recovery_codes_remaining}</strong> of 10 codes left
              </p>
              {data.recovery_codes_remaining <= 3 && (
                <p className="hint">You're running low. Make new codes and save them.</p>
              )}
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setPending({ kind: "codes" })}
              >
                Make new codes
              </button>
            </div>
          )
        )}
      </section>

      <ConfirmDialog
        open={pending?.kind === "one"}
        title={
          pending?.kind === "one" && !pending.session.current
            ? `Sign out of ${describeUserAgent(pending.session.user_agent)}?`
            : "Sign out of this browser?"
        }
        confirmLabel="Sign out"
        busyLabel="Signing out…"
        onConfirm={() => (pending?.kind === "one" ? revokeOne(pending.session) : Promise.resolve(undefined))}
        onClose={() => setPending(null)}
      >
        {pending?.kind === "one" && (
          <p>
            {pending.session.current
              ? "This is the browser you're using now. You'll go back to the sign-in screen."
              : `${describeUserAgent(pending.session.user_agent)}, signed in ${when(pending.session.created_at)}, will need to sign in again.`}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "all"}
        title="Sign out everywhere?"
        tone="danger"
        confirmLabel="Sign out everywhere"
        busyLabel="Signing out…"
        onConfirm={revokeAll}
        onClose={() => setPending(null)}
      >
        <p>
          This signs you out on every device and browser, including this one. You'll need your password and an
          authenticator code to sign in again.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "codes"}
        title="Make new recovery codes?"
        confirmLabel="Make new codes"
        busyLabel="Making codes…"
        onConfirm={regenerate}
        onClose={() => setPending(null)}
      >
        <p>
          Your current codes, used or not, stop working straight away. You'll be asked for a fresh
          authenticator code first.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
