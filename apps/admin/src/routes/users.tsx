// Users, owner only [ADM-AUTH-07, -05, -08, ADM-G-03]: the keyset list (sort, role and status filters and search in the
// URL), row actions (change role, reset sign-in, deactivate, reactivate, resend or revoke an invite) through a
// confirmation that takes the authenticator code when no step-up is active, and the invite dialog. The invite email is
// queued by the API (07-H); the link is also shown once, for when the email can't be delivered.
import { ROLES, type Role } from "@techaust/core/permissions";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useSearchParams } from "react-router";
import { api, errorText, type InviteLink, stepUpActive, type UsersQuery } from "../api.ts";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { type Column, DataTable, FilterBar, Pager, type Sort } from "../components/data-table.tsx";
import { Modal } from "../components/dialog.tsx";
import { EmptyState, PageHeader, StatusPill, When } from "../components/display.tsx";
import { FormField } from "../components/form.tsx";
import { Ban, LogOut, Mail, Pencil, RotateCcw, Search, UserPlus, X } from "../components/icons.tsx";
import { MenuButton, type MenuItem } from "../components/popover.tsx";
import { LoadFailed, NoAccess, useLoad } from "../components/states.tsx";
import { useToast } from "../components/toast.tsx";
import { CodeField, Notice, ShownOnce } from "../components/ui.tsx";
import { canManageUsers } from "../lib/access.ts";
import { ROLE_LABELS, STATUS_LABELS, when } from "../lib/format.ts";
import { withCode } from "../lib/step-up.ts";
import { displayName, type UserRow, type UserStatus, userRows } from "../lib/users.ts";
import { useUser } from "../session.tsx";

const CRUMBS = [{ label: "Settings", to: "/settings" }];
const STATUSES: UserStatus[] = ["active", "invited", "deactivated"];

/** What each role may do (docs/04 §9), in a line. */
export const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including users, settings, bank details, issuing invoices and refunds.",
  staff: "Leads, clients, projects and care plans; drafts invoices for the owner to issue.",
  sales: "Leads, clients and proposals, without finance details.",
  accountant: "Reads clients and documents; reports, GST exports and finance events in the audit log.",
};

export function UserStatusPill({ status }: { status: UserStatus }) {
  if (status === "active")
    return (
      <StatusPill tone="success" icon="check">
        Active
      </StatusPill>
    );
  if (status === "invited")
    return (
      <StatusPill tone="warning" icon="clock">
        Invited
      </StatusPill>
    );
  return (
    <StatusPill tone="muted" icon="ban">
      Deactivated
    </StatusPill>
  );
}

type Kind = "role" | "reset" | "deactivate" | "reactivate" | "resend" | "revoke";
type Pending = { kind: Kind; row: UserRow; code: boolean } | { kind: "everyone"; code: boolean } | null;

const isRole = (v: string | null): v is Role => ROLES.includes(v as Role);
const isStatus = (v: string | null): v is UserStatus => STATUSES.includes(v as UserStatus);

export function Component() {
  const me = useUser();
  return canManageUsers(me.role) ? <Users /> : <NoAccess what="Users" crumbs={CRUMBS} />;
}

function Users() {
  const me = useUser();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [pending, setPending] = useState<Pending>(null);
  const [inviting, setInviting] = useState(false);

  const q = params.get("q") ?? "";
  const roleParam = params.get("role");
  const statusParam = params.get("status");
  const role = isRole(roleParam) ? roleParam : null;
  const status = isStatus(statusParam) ? statusParam : null;
  const sortKey = params.get("sort") === "created" ? "created" : "name";
  const dir = params.get("dir") === "desc" ? "desc" : "asc";
  const size = params.get("size") === "50" ? 50 : 25;
  const after = params.get("after") ?? undefined;
  const before = params.get("before") ?? undefined;
  const pageNo = Math.max(1, Number(params.get("page")) || 1);
  const filtered = q !== "" || role !== null || status !== null;

  const query: UsersQuery = {
    limit: size === 50 ? "50" : undefined,
    sort: sortKey,
    dir,
    role: role ?? undefined,
    status: status ?? undefined,
    q: q.trim() || undefined,
    after,
    before,
  };
  const key = JSON.stringify(query);
  const list = useLoad(() => api.users(query), key);
  const invites = useLoad(() => api.invites(), "");
  const reload = () => {
    list.reload(true);
    invites.reload(true);
  };

  const set = (changes: Record<string, string | null>, keepCursor = false) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === "") n.delete(k);
          else n.set(k, v);
        }
        if (!keepCursor) {
          n.delete("after");
          n.delete("before");
          n.delete("page");
        }
        return n;
      },
      { replace: true },
    );

  const firstPage = pageNo === 1 && !after && !before;
  const rows =
    list.state === "ready"
      ? userRows(list.data.users, invites.data?.invites ?? [], { q, role, status }, firstPage)
      : [];
  const newInvites = rows.filter((r) => !r.member).length;
  const offset = firstPage ? 0 : (pageNo - 1) * size + (invites.data?.invites.length ?? 0);
  const loading = list.state === "loading";

  const open = (kind: Kind, row: UserRow) => setPending({ kind, row, code: !stepUpActive() });

  const actionsFor = (r: UserRow) => {
    if (r.member && r.email === me.email)
      return (
        <span className="pill pill--accent">
          You<span className="visually-hidden">: you can't change your own account here</span>
        </span>
      );
    const name = displayName(r);
    const items: MenuItem[] =
      r.status === "active"
        ? [
            { label: "Change role", icon: <Pencil size={16} />, onSelect: () => open("role", r) },
            { label: "Reset sign-in", icon: <RotateCcw size={16} />, onSelect: () => open("reset", r) },
            {
              label: "Deactivate",
              icon: <Ban size={16} />,
              tone: "danger",
              onSelect: () => open("deactivate", r),
            },
          ]
        : r.status === "invited"
          ? [
              { label: "Resend invite", icon: <Mail size={16} />, onSelect: () => open("resend", r) },
              ...(r.invite
                ? [
                    {
                      label: "Revoke invite",
                      icon: <X size={16} />,
                      tone: "danger" as const,
                      onSelect: () => open("revoke", r),
                    },
                  ]
                : []),
            ]
          : [{ label: "Reactivate", icon: <RotateCcw size={16} />, onSelect: () => open("reactivate", r) }];
    return <MenuButton label={`Actions for ${name}`} items={items} />;
  };

  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      card: "title",
      cell: (r) => (
        <span className="person">
          <span className={r.name ? "person__name" : "person__name person__name--unset"}>
            {r.name || "Name not set yet"}
          </span>
          <span className="person__email">{r.email}</span>
        </span>
      ),
    },
    { key: "role", header: "Role", cell: (r) => ROLE_LABELS[r.role] },
    { key: "status", header: "Status", cell: (r) => <UserStatusPill status={r.status} /> },
    {
      key: "last",
      header: "Last sign-in",
      cell: (r) =>
        r.status === "invited" && r.lastLoginAt === null ? (
          <span className="muted">Not yet</span>
        ) : (
          <When ms={r.lastLoginAt} />
        ),
    },
    { key: "created", header: "Added", sortable: true, cell: (r) => <When ms={r.createdAt} /> },
  ];
  const sort: Sort = { key: sortKey, dir };

  const close = () => setPending(null);
  const row = pending && pending.kind !== "everyone" ? pending.row : null;
  const name = row ? displayName(row) : "";
  const done = (text: ReactNode) => {
    toast("success", text);
    reload();
  };

  return (
    <>
      <PageHeader
        title="Users"
        crumbs={CRUMBS}
        lede="Who can sign in to the admin, and what their role lets them do. Every change here asks for your authenticator code."
        action={
          <button type="button" className="btn btn--primary" onClick={() => setInviting(true)}>
            <UserPlus />
            Invite someone
          </button>
        }
        more={[
          {
            label: "Sign out everyone except you",
            icon: <LogOut size={16} />,
            tone: "danger",
            onSelect: () => setPending({ kind: "everyone", code: !stepUpActive() }),
          },
        ]}
      />

      <FilterBar
        searchLabel="Search by the start of a name or email"
        query={q}
        onQuery={(v) => set({ q: v })}
        groups={[
          {
            key: "role",
            label: "Role",
            selected: role ? [role] : [],
            options: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
          },
          {
            key: "status",
            label: "Status",
            selected: status ? [status] : [],
            options: STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
          },
        ]}
        onToggle={(group, value) => {
          const cur = group === "role" ? role : status;
          set({ [group]: cur === value ? null : value });
        }}
        onClear={() => set({ q: null, role: null, status: null })}
        result={
          loading
            ? "Loading…"
            : list.state === "ready"
              ? rows.length === 1
                ? "1 person on this page"
                : `${rows.length} people on this page`
              : ""
        }
      />

      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <DataTable
          caption="Users"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          sort={sort}
          onSort={(k) =>
            set({
              sort: k === "created" ? "created" : null,
              dir: sortKey === k && dir === "asc" ? "desc" : null,
            })
          }
          loading={loading}
          skeletonRows={6}
          actions={actionsFor}
          cardSub={(r) => (r.name ? null : <span className="muted">Name not set yet</span>)}
          empty={
            <EmptyState
              icon={<Search />}
              title={filtered ? "No one matches these filters" : "No users yet"}
              action={
                filtered ? (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => set({ q: null, role: null, status: null })}
                  >
                    Clear filters
                  </button>
                ) : (
                  <button type="button" className="btn btn--primary" onClick={() => setInviting(true)}>
                    <UserPlus />
                    Invite someone
                  </button>
                )
              }
            >
              <p>
                {filtered
                  ? "Try fewer filters, or search for the start of a name or an email address."
                  : "Invite the people who work with you. Each one picks a password and sets up an authenticator app."}
              </p>
            </EmptyState>
          }
        />
      )}

      {list.state === "ready" && rows.length > 0 && (
        <Pager
          noun="people"
          from={offset + 1}
          to={offset + rows.length}
          hasPrev={list.data.prev !== null}
          hasNext={list.data.next !== null}
          onPrev={() =>
            pageNo <= 2
              ? set({}) // back to the first page itself (no cursor), where pending invites are listed
              : set({ before: list.data.prev, after: null, page: String(pageNo - 1) }, true)
          }
          onNext={() => set({ after: list.data.next, before: null, page: String(pageNo + 1) }, true)}
          pageSize={size}
          onPageSize={(n) => set({ size: n === 50 ? "50" : null })}
        />
      )}
      {invites.state === "failed" && list.state === "ready" && (
        <Notice tone="error">
          Pending invites didn't load, so people who haven't joined yet aren't listed.{" "}
          {errorText(invites.error)}
        </Notice>
      )}
      {newInvites > 0 && (
        <p className="hint hint--below">
          {newInvites === 1 ? "1 invite is" : `${newInvites} invites are`} waiting to be accepted. Each link
          works once, for 48 hours.
        </p>
      )}

      <InviteDialog open={inviting} onClose={() => setInviting(false)} onDone={reload} />

      <RoleDialog
        row={pending?.kind === "role" ? pending.row : null}
        code={pending?.code ?? false}
        onClose={close}
        onChanged={(r, newRole, changed) =>
          done(
            changed
              ? `${displayName(r)} is now ${ROLE_LABELS[newRole]}. They've been signed out.`
              : "No change: that's already their role.",
          )
        }
      />

      <ConfirmDialog
        open={pending?.kind === "deactivate"}
        title={`Deactivate ${name}?`}
        tone="danger"
        confirmLabel="Deactivate"
        busyLabel="Deactivating…"
        stepUp={pending?.code}
        onClose={close}
        onConfirm={async (code) => {
          if (!row?.member) return undefined;
          const m = row.member;
          await withCode(code, () => api.deactivate(m.id));
          done(`${displayName(row)} is deactivated and signed out everywhere.`);
          return undefined;
        }}
      >
        <p>
          They're signed out everywhere straight away and can't sign in again. Their past activity stays in
          the records, and you can reactivate them later.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "reset"}
        title={`Reset sign-in for ${name}?`}
        tone="danger"
        confirmLabel="Reset and make a link"
        resultTitle="Sign-in reset"
        busyLabel="Resetting…"
        stepUp={pending?.code}
        onClose={() => {
          close();
          reload();
        }}
        onConfirm={async (code) => {
          if (!row?.member) return undefined;
          const m = row.member;
          const link = await withCode(code, () => api.resetTwoStep(m.id));
          return <LinkResult link={link} email={row.email} what="reset" />;
        }}
      >
        <p>
          Their password, authenticator app and recovery codes stop working, and they're signed out
          everywhere. You'll get a new 48-hour link to send them, so they can choose a new password and set up
          their app again.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "reactivate"}
        title={`Reactivate ${name}?`}
        confirmLabel="Reactivate"
        busyLabel="Reactivating…"
        stepUp={pending?.code}
        onClose={close}
        onConfirm={async (code) => {
          if (!row?.member) return undefined;
          const m = row.member;
          await withCode(code, () => api.reactivate(m.id));
          done(`${displayName(row)} can sign in again, as ${ROLE_LABELS[row.role]}.`);
          return undefined;
        }}
      >
        <p>
          They can sign in again with their password and authenticator app, as{" "}
          {row ? ROLE_LABELS[row.role] : ""}. If they've lost either, reset their sign-in afterwards.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "resend"}
        title="Send the invite again?"
        confirmLabel="Send a new invite"
        resultTitle="Invite sent"
        busyLabel="Sending…"
        stepUp={pending?.code}
        onClose={() => {
          close();
          reload();
        }}
        onConfirm={async (code) => {
          if (!row) return undefined;
          const link = await withCode(code, () => api.invite(row.email, row.role));
          return <LinkResult link={link} email={row.email} what="invite" />;
        }}
      >
        {row && (
          <p>
            A new link goes to <strong className="break">{row.email}</strong>, as {ROLE_LABELS[row.role]},
            valid for 48 hours. The link sent before stops working.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "revoke"}
        title="Revoke this invite?"
        tone="danger"
        confirmLabel="Revoke invite"
        busyLabel="Revoking…"
        stepUp={pending?.code}
        onClose={close}
        onConfirm={async (code) => {
          if (!row?.invite) return undefined;
          const hash = row.invite.token_hash;
          await withCode(code, () => api.revokeInvite(hash));
          done(`The invite for ${row.email} no longer works.`);
          return undefined;
        }}
      >
        {row && (
          <p>
            The link sent to <strong className="break">{row.email}</strong> stops working. You can invite them
            again later.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "everyone"}
        title="Sign out everyone except you?"
        tone="danger"
        confirmLabel="Sign out everyone else"
        busyLabel="Signing out…"
        stepUp={pending?.code}
        onClose={close}
        onConfirm={async (code) => {
          await withCode(code, () => api.revokeAllStaff());
          done("Everyone except you has been signed out.");
          return undefined;
        }}
      >
        <p>
          Every other staff member is signed out on every device, straight away. You stay signed in here. They
          can sign in again with their password and authenticator app.
        </p>
      </ConfirmDialog>
    </>
  );
}

/** After an invite or a reset: the email is on its way (invites), and the link is shown once as a fallback. */
function LinkResult({ link, email, what }: { link: InviteLink; email: string; what: "invite" | "reset" }) {
  const id = useId();
  return (
    <>
      <Notice tone="success">
        {what === "invite" ? (
          <>
            Invite sent to <strong className="break">{email}</strong>. If the email doesn't arrive, send them
            this link yourself.
          </>
        ) : (
          <>
            Sign-in reset. Send this link to <strong className="break">{email}</strong> yourself.
          </>
        )}
      </Notice>
      <ShownOnce id={id} label={what === "invite" ? "Invite link" : "Reset link"} value={link.link}>
        <p className="hint">
          Works once, until {when(link.expires_at)}. You won't see this link again; if it's lost, revoke it
          and make a new one.
        </p>
      </ShownOnce>
    </>
  );
}

function RoleRadios(props: {
  name: string;
  value: Role | null;
  current?: Role;
  onChange: (r: Role) => void;
}) {
  return (
    <div className="role-options">
      {ROLES.map((r) => (
        <label key={r} className="role-option">
          <input
            type="radio"
            name={props.name}
            value={r}
            checked={props.value === r}
            onChange={() => props.onChange(r)}
          />
          <span>
            <span className="role-option__name">
              {ROLE_LABELS[r]}
              {props.current === r && <span className="radio__note"> (current)</span>}
            </span>
            <span className="role-option__help">{ROLE_HELP[r]}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function InviteDialog(props: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [needCode, setNeedCode] = useState(false);
  const [sent, setSent] = useState<{ link: InviteLink; email: string } | null>(null);
  const [shown, setShown] = useState(false);
  const legend = useId();

  // Each time it opens: a clean form, and the code field only if no step-up is active.
  if (props.open !== shown) {
    setShown(props.open);
    if (props.open) {
      setEmail("");
      setRole("staff");
      setEmailError(null);
      setError(null);
      setCode("");
      setCodeError(null);
      setSent(null);
      setNeedCode(!stepUpActive());
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setEmailError("Enter an email address, like name@example.com.");
      document.getElementById("invite-email")?.focus();
      return;
    }
    setEmailError(null);
    if (needCode && code.length !== 6) {
      setCodeError("Enter the 6-digit code from your authenticator app.");
      document.getElementById("invite-code")?.focus();
      return;
    }
    setCodeError(null);
    setBusy(true);
    setError(null);
    try {
      const link = await withCode(needCode ? code : undefined, () => api.invite(v, role));
      setSent({ link, email: v });
      props.onDone();
    } catch (err) {
      setCode("");
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={props.open}
      title={sent ? "Invite sent" : "Invite someone"}
      onClose={props.onClose}
      busy={busy}
    >
      {sent ? (
        <>
          <div className="dialog__body">
            <LinkResult link={sent.link} email={sent.email} what="invite" />
          </div>
          <div className="dialog__actions">
            <button type="button" className="btn btn--primary" onClick={props.onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="dialog__body">
            <p className="hint">
              We email them a link that works once, for 48 hours. They choose their name, password and
              authenticator app when they open it.
            </p>
            {error && <Notice tone="error">{error}</Notice>}
            <FormField id="invite-email" label="Email" error={emailError}>
              {(a) => (
                <input
                  {...a}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </FormField>
            <fieldset className="radios" aria-describedby={legend}>
              <legend>Role</legend>
              <RoleRadios name="invite-role" value={role} onChange={setRole} />
            </fieldset>
            <p className="hint" id={legend}>
              You can change their role later.
            </p>
            {needCode && (
              <CodeField
                id="invite-code"
                label="Authenticator code"
                hint="A fresh code from your authenticator app confirms it's you."
                value={code}
                onChange={setCode}
                error={codeError}
              />
            )}
          </div>
          <div className="dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
              {busy ? "Sending…" : "Send invite"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RoleDialog(props: {
  row: UserRow | null;
  code: boolean;
  onClose: () => void;
  onChanged: (r: UserRow, role: Role, changed: boolean) => void;
}) {
  const r = props.row;
  const [role, setRole] = useState<Role | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  if (r && shown !== r.key) {
    setShown(r.key);
    setRole(r.role);
  }
  return (
    <ConfirmDialog
      open={!!r}
      title={r ? `Change role for ${displayName(r)}` : ""}
      confirmLabel="Change role"
      busyLabel="Changing…"
      disabled={!role || role === r?.role}
      stepUp={props.code}
      onClose={() => {
        setShown(null);
        props.onClose();
      }}
      onConfirm={async (code) => {
        if (!r?.member || !role) return undefined;
        const m = r.member;
        const res = await withCode(code, () => api.changeRole(m.id, role));
        props.onChanged(r, role, res.changed);
        return undefined;
      }}
    >
      <fieldset className="radios">
        <legend>New role</legend>
        {r && <RoleRadios name="new-role" value={role} current={r.role} onChange={setRole} />}
      </fieldset>
      <p className="hint">They're signed out everywhere when their role changes.</p>
    </ConfirmDialog>
  );
}
