// Preview: the users list (ADM-G-03 list pattern, users management from M1.5 moved into the shell).
// Filters, sort and the keyset cursor live in the URL. Sample data only; actions change this page's copy and toast.
import { ROLES, type Role } from "@techaust/core/permissions";
import { type FormEvent, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { type Column, DataTable, FilterBar, Pager, type Sort } from "../components/data-table.tsx";
import { Modal } from "../components/dialog.tsx";
import { EmptyState, PageHeader, StatusPill, When } from "../components/display.tsx";
import { FormField } from "../components/form.tsx";
import { Ban, Mail, Pencil, RotateCcw, Search, UserPlus, X } from "../components/icons.tsx";
import { MenuButton, type MenuItem } from "../components/popover.tsx";
import { useToast } from "../components/toast.tsx";
import { ROLE_LABELS } from "../lib/format.ts";
import { PreviewControls } from "./controls.tsx";
import { LONG, NOW, type SampleUser, type Status, USERS } from "./sample.ts";

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  invited: "Invited",
  deactivated: "Deactivated",
};

export const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including users, settings, bank details, issuing invoices and refunds.",
  staff: "Leads, clients, projects and care plans; drafts invoices for the owner to issue.",
  sales: "Leads, clients and proposals, without finance details.",
  accountant: "Reads clients and documents; reports, GST exports and finance events in the audit log.",
};

export function UserStatus({ status }: { status: Status }) {
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

const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);
const display = (u: SampleUser) => u.name || u.email;

type Pending = {
  kind: "role" | "reset" | "deactivate" | "reactivate" | "resend" | "revoke";
  user: SampleUser;
} | null;

export function UsersPreview() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const long = params.get("rows") === "long";
  const view = params.get("view");
  const [edits, setEdits] = useState<Record<string, Partial<SampleUser>>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending>(null);
  const [inviting, setInviting] = useState(false);

  const q = params.get("q") ?? "";
  const roles = list(params.get("role"));
  const statuses = list(params.get("status"));
  const sort: Sort = {
    key: params.get("sort") ?? "name",
    dir: params.get("dir") === "desc" ? "desc" : "asc",
  };
  const size = params.get("size") === "50" ? 50 : 25;

  const set = (changes: Record<string, string | null>, resetCursor = true) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === "") n.delete(k);
          else n.set(k, v);
        }
        if (resetCursor) {
          n.delete("after");
          n.delete("before");
        }
        return n;
      },
      { replace: true },
    );

  const source = view === "empty" ? [] : long ? LONG : USERS;
  const all = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = source
      .filter((u) => !removed.includes(u.id))
      .map((u) => ({ ...u, ...edits[u.id] }))
      .filter((u) => (roles.length ? roles.includes(u.role) : true))
      .filter((u) => (statuses.length ? statuses.includes(u.status) : true))
      .filter((u) => (term ? `${u.name} ${u.email}`.toLowerCase().includes(term) : true));
    const key = (u: SampleUser): string | number =>
      sort.key === "role"
        ? ROLE_LABELS[u.role]
        : sort.key === "status"
          ? STATUS_LABEL[u.status]
          : sort.key === "last"
            ? (u.lastSignIn ?? 0)
            : display(u).toLowerCase();
    rows.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const c = x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id);
      return sort.dir === "asc" ? c : -c;
    });
    return rows;
  }, [source, removed, edits, roles, statuses, q, sort.key, sort.dir]);

  // Keyset paging over the sorted rows: ?after=<id> starts after that row, ?before=<id> ends before it.
  const after = params.get("after");
  const before = params.get("before");
  let start = 0;
  if (after) start = all.findIndex((u) => u.id === after) + 1;
  else if (before) start = Math.max(0, all.findIndex((u) => u.id === before) - size);
  const page = all.slice(start, start + size);
  const loading = view === "loading";
  const filtered = q !== "" || roles.length > 0 || statuses.length > 0;

  const toggle = (group: string, value: string) => {
    const cur = group === "role" ? roles : statuses;
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    set({ [group]: next.join(",") });
  };

  const actionsFor = (u: SampleUser) => {
    if (u.you) return <span className="pill pill--accent">You</span>;
    const items: MenuItem[] =
      u.status === "active"
        ? [
            {
              label: "Change role",
              icon: <Pencil size={16} />,
              onSelect: () => setPending({ kind: "role", user: u }),
            },
            {
              label: "Reset sign-in",
              icon: <RotateCcw size={16} />,
              onSelect: () => setPending({ kind: "reset", user: u }),
            },
            {
              label: "Deactivate",
              icon: <Ban size={16} />,
              tone: "danger",
              onSelect: () => setPending({ kind: "deactivate", user: u }),
            },
          ]
        : u.status === "invited"
          ? [
              {
                label: "Resend invite",
                icon: <Mail size={16} />,
                onSelect: () => setPending({ kind: "resend", user: u }),
              },
              {
                label: "Revoke invite",
                icon: <X size={16} />,
                tone: "danger",
                onSelect: () => setPending({ kind: "revoke", user: u }),
              },
            ]
          : [
              {
                label: "Reactivate",
                icon: <RotateCcw size={16} />,
                onSelect: () => setPending({ kind: "reactivate", user: u }),
              },
            ];
    return <MenuButton label={`Actions for ${display(u)}`} items={items} />;
  };

  const columns: Column<SampleUser>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      card: "title",
      cell: (u) => (
        <span className="person">
          <span className={u.name ? "person__name" : "person__name person__name--unset"}>
            {u.name || "Name not set yet"}
          </span>
          <span className="person__email">{u.email}</span>
        </span>
      ),
    },
    { key: "role", header: "Role", sortable: true, cell: (u) => ROLE_LABELS[u.role] },
    { key: "status", header: "Status", sortable: true, cell: (u) => <UserStatus status={u.status} /> },
    {
      key: "last",
      header: "Last sign-in",
      sortable: true,
      cell: (u) =>
        u.status === "invited" ? (
          <span className="muted">Not yet</span>
        ) : (
          <When ms={u.lastSignIn} now={NOW} />
        ),
    },
  ];

  const close = () => setPending(null);
  const after2 = (fn: () => void) =>
    new Promise<undefined>((r) =>
      setTimeout(() => {
        fn();
        r(undefined);
      }, 500),
    );
  const edit = (u: SampleUser, change: Partial<SampleUser>) =>
    setEdits((e) => ({ ...e, [u.id]: { ...e[u.id], ...change } }));

  return (
    <>
      <PageHeader
        title="Users"
        crumbs={[{ label: "Settings", to: "/preview/settings" }]}
        lede="Who can sign in to the admin, and what their role lets them do. Every change here asks for your authenticator code."
        action={
          <button type="button" className="btn btn--primary" onClick={() => setInviting(true)}>
            <UserPlus />
            Invite someone
          </button>
        }
      />

      <PreviewControls
        label="List state"
        value={loading ? "loading" : view === "empty" ? "empty" : long ? "long" : "sample"}
        options={[
          { value: "sample", label: "8 people" },
          { value: "long", label: "60 people" },
          { value: "loading", label: "Loading" },
          { value: "empty", label: "Nothing matches" },
        ]}
        onChange={(v) =>
          set({
            rows: v === "long" ? "long" : null,
            view: v === "loading" || v === "empty" ? v : null,
          })
        }
      />

      <FilterBar
        searchLabel="Search by name or email"
        query={q}
        onQuery={(v) => set({ q: v })}
        groups={[
          {
            key: "role",
            label: "Role",
            selected: roles,
            options: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
          },
          {
            key: "status",
            label: "Status",
            selected: statuses,
            options: (["active", "invited", "deactivated"] as const).map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            })),
          },
        ]}
        onToggle={toggle}
        onClear={() => set({ q: null, role: null, status: null })}
        result={loading ? "Loading…" : all.length === 1 ? "1 person" : `${all.length} people`}
      />

      <DataTable
        caption="Users"
        columns={columns}
        rows={page}
        rowKey={(u) => u.id}
        sort={sort}
        onSort={(k) => set({ sort: k, dir: sort.key === k && sort.dir === "asc" ? "desc" : "asc" })}
        loading={loading}
        skeletonRows={6}
        actions={actionsFor}
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
                ? "Try fewer filters, or search for part of a name or an email address."
                : "Invite the people who work with you. Each one picks a password and sets up an authenticator app."}
            </p>
          </EmptyState>
        }
      />

      {!loading && all.length > 0 && (
        <Pager
          noun="people"
          from={start + 1}
          to={start + page.length}
          hasPrev={start > 0}
          hasNext={start + size < all.length}
          onPrev={() => set({ before: page[0]?.id ?? null, after: null }, false)}
          onNext={() => set({ after: page[page.length - 1]?.id ?? null, before: null }, false)}
          pageSize={size}
          onPageSize={(n) => set({ size: n === 50 ? "50" : null })}
        />
      )}

      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        onSent={(email, role) => {
          setInviting(false);
          toast(
            "success",
            `Invite sent to ${email} as ${ROLE_LABELS[role]}. The link works once, for 48 hours.`,
          );
        }}
      />

      <RoleDialog
        user={pending?.kind === "role" ? pending.user : null}
        onClose={close}
        onChange={(u, role) =>
          after2(() => {
            edit(u, { role });
            toast("success", `${display(u)} is now ${ROLE_LABELS[role]}. They've been signed out.`);
          })
        }
      />

      <ConfirmDialog
        open={pending?.kind === "deactivate"}
        title={pending ? `Deactivate ${display(pending.user)}?` : ""}
        tone="danger"
        confirmLabel="Deactivate"
        busyLabel="Deactivating…"
        onClose={close}
        onConfirm={() =>
          after2(() => {
            if (!pending) return;
            edit(pending.user, { status: "deactivated" });
            toast("success", `${display(pending.user)} is deactivated and signed out everywhere.`);
          })
        }
      >
        <p>
          They're signed out everywhere straight away and can't sign in again. Their past activity stays in
          the records, and you can reactivate them later.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "reset"}
        title={pending ? `Reset sign-in for ${display(pending.user)}?` : ""}
        tone="danger"
        confirmLabel="Reset and email a link"
        busyLabel="Resetting…"
        onClose={close}
        onConfirm={() =>
          after2(() => {
            if (!pending) return;
            toast("success", `Sign-in reset. A 48-hour link is on its way to ${pending.user.email}.`);
          })
        }
      >
        <p>
          Their password, authenticator app and recovery codes stop working, and they're signed out
          everywhere. We email them a 48-hour link to choose a new password and set up their app again.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "reactivate"}
        title={pending ? `Reactivate ${display(pending.user)}?` : ""}
        confirmLabel="Reactivate"
        busyLabel="Reactivating…"
        onClose={close}
        onConfirm={() =>
          after2(() => {
            if (!pending) return;
            edit(pending.user, { status: "active" });
            toast("success", `${display(pending.user)} can sign in again, with the same role as before.`);
          })
        }
      >
        <p>
          They can sign in again with their password and authenticator app, as{" "}
          {pending ? ROLE_LABELS[pending.user.role] : ""}. If they've lost either, reset their sign-in
          afterwards.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "resend"}
        title="Send the invite again?"
        confirmLabel="Send a new invite"
        busyLabel="Sending…"
        onClose={close}
        onConfirm={() =>
          after2(() => {
            if (!pending) return;
            toast("success", `A new invite is on its way to ${pending.user.email}.`);
          })
        }
      >
        {pending && (
          <p>
            A new link goes to <strong className="break">{pending.user.email}</strong>, valid for 48 hours.
            The link sent before stops working.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "revoke"}
        title="Revoke this invite?"
        tone="danger"
        confirmLabel="Revoke invite"
        busyLabel="Revoking…"
        onClose={close}
        onConfirm={() =>
          after2(() => {
            if (!pending) return;
            setRemoved((r) => [...r, pending.user.id]);
            toast("success", `The invite for ${pending.user.email} no longer works.`);
          })
        }
      >
        {pending && (
          <p>
            The link sent to <strong className="break">{pending.user.email}</strong> stops working. You can
            invite them again later.
          </p>
        )}
      </ConfirmDialog>
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

function InviteDialog(props: {
  open: boolean;
  onClose: () => void;
  onSent: (email: string, role: Role) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const legend = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setError("Enter an email address, like name@example.com.");
      document.getElementById("invite-email")?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setEmail("");
      props.onSent(v, role);
    }, 600);
  }

  return (
    <Modal open={props.open} title="Invite someone" onClose={props.onClose} busy={busy}>
      <form onSubmit={submit} noValidate>
        <div className="dialog__body">
          <p className="hint">
            We email them a link that works once, for 48 hours. They choose their name, password and
            authenticator app when they open it.
          </p>
          <FormField id="invite-email" label="Email" error={error}>
            {(a) => (
              <input
                {...a}
                type="email"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
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
    </Modal>
  );
}

function RoleDialog(props: {
  user: SampleUser | null;
  onClose: () => void;
  onChange: (u: SampleUser, role: Role) => Promise<undefined>;
}) {
  const u = props.user;
  const [role, setRole] = useState<Role | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  if (u && shown !== u.id) {
    setShown(u.id);
    setRole(u.role);
  }
  return (
    <ConfirmDialog
      open={!!u}
      title={u ? `Change role for ${display(u)}` : ""}
      confirmLabel="Change role"
      busyLabel="Changing…"
      disabled={!role || role === u?.role}
      onClose={() => {
        setShown(null);
        props.onClose();
      }}
      onConfirm={() => (u && role ? props.onChange(u, role) : Promise.resolve(undefined))}
    >
      <fieldset className="radios">
        <legend>New role</legend>
        {u && <RoleRadios name="new-role" value={role} current={u.role} onChange={setRole} />}
      </fieldset>
      <p className="hint">They're signed out everywhere when their role changes.</p>
    </ConfirmDialog>
  );
}
