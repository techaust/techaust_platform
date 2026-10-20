// Staff and invites, owner only [ADM-AUTH-05, -07, -08]: invite someone (the link is shown once, in place of the
// email that M2.4 sends), revoke pending invites, change a role, deactivate, reset two-step sign-in, and sign out
// everyone except you. Every change needs a fresh step-up; the step-up dialog opens on its own when it's due.
import { ROLES, type Role } from "@techaust/core/permissions";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { api, errorText, type Invite, type InviteLink, type StaffMember } from "../api.ts";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { Card, Field, Notice, ShownOnce, SkeletonRows } from "../components/ui.tsx";
import { ROLE_LABELS, STATUS_LABELS, when } from "../lib/format.ts";
import { useUser } from "../session.tsx";

type Data = { users: StaffMember[]; invites: Invite[] };
type Pending =
  | { kind: "role"; member: StaffMember }
  | { kind: "deactivate"; member: StaffMember }
  | { kind: "reset"; member: StaffMember }
  | { kind: "revoke"; invite: Invite }
  | { kind: "everyone" }
  | null;

export function Component() {
  const me = useUser();
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([api.users(), api.invites()]).then(
      ([u, i]) => setData({ users: u.users, invites: i.invites }),
      (e) => setLoadError(errorText(e)),
    );
  }, []);
  useEffect(load, [load]);

  const nameOf = (id: string | null) =>
    (id && data?.users.find((u) => u.id === id)?.name) || (id ? "Someone no longer listed" : "System");
  const close = () => setPending(null);
  const done = (text: string) => {
    setNotice(text);
    load();
  };

  return (
    <Card
      title="Staff and invites"
      wide
      focusTitle
      back={{ to: "/", label: "Home" }}
      busy={!data && !loadError}
    >
      {notice && <Notice tone="success">{notice}</Notice>}
      {loadError && (
        <div className="load-error">
          <Notice tone="error">{loadError}</Notice>
          <button type="button" className="btn btn--secondary" onClick={load}>
            Try again
          </button>
        </div>
      )}

      <InviteForm onCreated={load} />

      <section className="section" aria-labelledby="invites-h">
        <div className="section__head">
          <h2 id="invites-h">Pending invites</h2>
          <p className="hint">Links not used yet. Each works once and for 48 hours.</p>
        </div>
        {!data && !loadError && <SkeletonRows n={1} />}
        {data && data.invites.length === 0 && <p className="empty">No pending invites.</p>}
        {data && data.invites.length > 0 && (
          <ul className="rows">
            {data.invites.map((inv) => (
              <li key={inv.token_hash} className="row">
                <div className="row__main">
                  <p className="row__title">
                    <span className="break">{inv.email}</span>
                    <span className="pill">{ROLE_LABELS[inv.role]}</span>
                  </p>
                  <dl className="row__facts">
                    <div>
                      <dt>Expires</dt>
                      <dd>{when(inv.expires_at)}</dd>
                    </div>
                    <div>
                      <dt>Invited by</dt>
                      <dd>{nameOf(inv.invited_by)}</dd>
                    </div>
                  </dl>
                </div>
                <div className="row__actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setPending({ kind: "revoke", invite: inv })}
                    aria-label={`Revoke the invite for ${inv.email}`}
                  >
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="staff-h">
        <div className="section__head">
          <h2 id="staff-h">Staff</h2>
        </div>
        {!data && !loadError && <SkeletonRows n={2} />}
        {data && (
          <ul className="rows">
            {data.users.map((m) => {
              const self = m.email === me.email;
              const actionable = !self && m.status === "active";
              return (
                <li key={m.id} className="row">
                  <div className="row__main">
                    <p className="row__title">
                      <span>{m.name || "Name not set yet"}</span>
                      {self && <span className="pill pill--accent">You</span>}
                    </p>
                    <p className="row__sub break">{m.email}</p>
                    <dl className="row__facts">
                      <div>
                        <dt>Role</dt>
                        <dd>{ROLE_LABELS[m.role]}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>
                          <span className={`status status--${m.status}`}>{STATUS_LABELS[m.status]}</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Last sign-in</dt>
                        <dd>{when(m.last_login_at)}</dd>
                      </div>
                    </dl>
                  </div>
                  {actionable && (
                    <div className="row__actions row__actions--below">
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={() => setPending({ kind: "role", member: m })}
                        aria-label={`Change role for ${m.name || m.email}`}
                      >
                        Change role
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={() => setPending({ kind: "reset", member: m })}
                        aria-label={`Reset two-step sign-in for ${m.name || m.email}`}
                      >
                        Reset sign-in
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger-outline"
                        onClick={() => setPending({ kind: "deactivate", member: m })}
                        aria-label={`Deactivate ${m.name || m.email}`}
                      >
                        Deactivate
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {data && (
          <div className="section__foot">
            <button
              type="button"
              className="btn btn--danger-outline"
              onClick={() => setPending({ kind: "everyone" })}
            >
              Sign out everyone except you
            </button>
          </div>
        )}
      </section>

      <RoleDialog
        member={pending?.kind === "role" ? pending.member : null}
        onClose={close}
        onChanged={(m, role, changed) =>
          done(
            changed
              ? `${m.name || m.email} is now ${ROLE_LABELS[role]}. They've been signed out.`
              : "No change: that's already their role.",
          )
        }
      />

      <ConfirmDialog
        open={pending?.kind === "deactivate"}
        title={
          pending?.kind === "deactivate" ? `Deactivate ${pending.member.name || pending.member.email}?` : ""
        }
        tone="danger"
        confirmLabel="Deactivate"
        busyLabel="Deactivating…"
        onClose={close}
        onConfirm={async () => {
          if (pending?.kind !== "deactivate") return undefined;
          await api.deactivate(pending.member.id);
          done(`${pending.member.name || pending.member.email} is deactivated and signed out everywhere.`);
          return undefined;
        }}
      >
        <p>
          They're signed out everywhere straight away and can't sign in again. Their past activity stays in
          the records.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "reset"}
        title={
          pending?.kind === "reset" ? `Reset sign-in for ${pending.member.name || pending.member.email}?` : ""
        }
        tone="danger"
        confirmLabel="Reset and make a link"
        resultTitle="Sign-in reset"
        busyLabel="Resetting…"
        onClose={() => {
          close();
          load();
        }}
        onConfirm={async () => {
          if (pending?.kind !== "reset") return undefined;
          const link = await api.resetTwoStep(pending.member.id);
          return <LinkResult link={link} email={pending.member.email} what="reset" />;
        }}
      >
        <p>
          Their password, authenticator app and recovery codes stop working, and they're signed out
          everywhere. You'll get a new 48-hour link to send them, so they can choose a new password and set up
          their app again.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "revoke"}
        title="Revoke this invite?"
        confirmLabel="Revoke invite"
        busyLabel="Revoking…"
        onClose={close}
        onConfirm={async () => {
          if (pending?.kind !== "revoke") return undefined;
          await api.revokeInvite(pending.invite.token_hash);
          done(`The invite for ${pending.invite.email} no longer works.`);
          return undefined;
        }}
      >
        {pending?.kind === "revoke" && (
          <p>
            The link sent to <strong className="break">{pending.invite.email}</strong> stops working. You can
            invite them again later.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "everyone"}
        title="Sign out everyone except you?"
        tone="danger"
        confirmLabel="Sign out everyone else"
        busyLabel="Signing out…"
        onClose={close}
        onConfirm={async () => {
          await api.revokeAllStaff();
          done("Everyone except you has been signed out.");
          return undefined;
        }}
      >
        <p>
          Every other staff member is signed out on every device, straight away. You stay signed in here. They
          can sign in again with their password and authenticator app.
        </p>
      </ConfirmDialog>
    </Card>
  );
}

function LinkResult({ link, email, what }: { link: InviteLink; email: string; what: "invite" | "reset" }) {
  const id = useId();
  return (
    <>
      <Notice tone="success">
        {what === "reset" ? "Sign-in reset. " : "Invite created. "}
        Send this link to <strong className="break">{email}</strong> yourself.
      </Notice>
      <ShownOnce id={id} label="Invite link" value={link.link}>
        <p className="hint">
          Works once, until {when(link.expires_at)}. You won't see this link again; if it's lost, revoke it
          and make a new one.
        </p>
      </ShownOnce>
    </>
  );
}

function InviteForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ link: InviteLink; email: string } | null>(null);
  const createdRef = useRef<HTMLDivElement>(null);
  // The form is replaced by the link: focus moves to it, so the result is read next.
  useEffect(() => {
    if (created) createdRef.current?.focus();
  }, [created]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setEmailError("Enter an email address, like name@example.com.");
      return;
    }
    setEmailError(null);
    setBusy(true);
    setError(null);
    try {
      const link = await api.invite(value, role);
      setCreated({ link, email: value });
      setEmail("");
      onCreated();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section section--first" aria-labelledby="invite-h">
      <div className="section__head">
        <h2 id="invite-h">Invite someone</h2>
        <p className="hint">
          They choose their own name, password and authenticator app when they open the link.
        </p>
      </div>
      {created ? (
        <div className="invite-created" ref={createdRef} tabIndex={-1}>
          <LinkResult link={created.link} email={created.email} what="invite" />
          <button type="button" className="btn btn--secondary" onClick={() => setCreated(null)}>
            Invite someone else
          </button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="invite-form">
          {error && <Notice tone="error">{error}</Notice>}
          <div className="invite-form__fields">
            <Field
              id="invite-email"
              label="Email"
              type="email"
              inputMode="email"
              value={email}
              onChange={setEmail}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              error={emailError}
              className="invite-form__email"
            />
            <div className="field invite-form__role">
              <label htmlFor="invite-role">Role</label>
              <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Creating…" : "Create invite link"}
          </button>
        </form>
      )}
    </section>
  );
}

function RoleDialog(props: {
  member: StaffMember | null;
  onClose: () => void;
  onChanged: (m: StaffMember, role: Role, changed: boolean) => void;
}) {
  const m = props.member;
  const [role, setRole] = useState<Role | null>(null);
  const groupId = useId();
  useEffect(() => setRole(m?.role ?? null), [m]);

  return (
    <ConfirmDialog
      open={!!m}
      title={m ? `Change role for ${m.name || m.email}` : ""}
      confirmLabel="Change role"
      busyLabel="Changing…"
      disabled={!role || role === m?.role}
      onClose={props.onClose}
      onConfirm={async () => {
        if (!m || !role) return undefined;
        const r = await api.changeRole(m.id, role);
        props.onChanged(m, role, r.changed);
        return undefined;
      }}
    >
      <fieldset className="radios">
        <legend id={groupId}>New role</legend>
        {ROLES.map((r) => (
          <label key={r} className="radio">
            <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
            <span>
              {ROLE_LABELS[r]}
              {m?.role === r && <span className="radio__note"> (current)</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="hint">They're signed out everywhere when their role changes.</p>
    </ConfirmDialog>
  );
}
