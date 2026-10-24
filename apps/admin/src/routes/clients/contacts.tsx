// The client page's Contacts tab (M3.3, ADM-CLI-02, -05): every contact with its flags, added and edited in a dialog
// (primary, billing, portal access with the 07-J line, can see finance following billing until set, marketing consent);
// `email_in_use` lands on the email field, a 409 `stale_version` offers the latest. The owner's data tools (export,
// erase or anonymise, both with step-up) open from each contact's menu (data-tools.tsx). An anonymised contact reads
// "Removed contact" and can't be changed. Emails are unique per client (the API lower-cases them).
import { type FormEvent, useState } from "react";
import {
  api,
  type ClientPage,
  type ContactInput,
  type ContactPatch,
  type ContactView,
  errorText,
  RequestError,
} from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { EmptyState, StatusPill, When } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { MoreHorizontal, Pencil, Plus, Users } from "../../components/icons.tsx";
import { MenuButton } from "../../components/popover.tsx";
import { StaleNotice } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import { type ContactsExtras, contactsCursor } from "../../lib/clients.ts";
import { sentence } from "../../lib/format.ts";
import { useUser } from "../../session.tsx";
import { EraseDialog, ExportDialog } from "./data-tools.tsx";
import { ContactFlags, ContactSwitches } from "./parts.tsx";

export function Contacts(props: { data: ClientPage; reload: () => void }) {
  const user = useUser();
  const canWrite = allowed(user.role, "clients.write");
  const canExport = allowed(user.role, "clients.dataExport");
  const canErase = allowed(user.role, "clients.dataErase");
  const [editing, setEditing] = useState<ContactView | "new" | null>(null);
  const [exporting, setExporting] = useState<ContactView | null>(null);
  const [erasing, setErasing] = useState<ContactView | null>(null);
  const [more, setMore] = useState<{ list: ContactView[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const first = props.data.contacts;
  const list = [...first, ...(more?.list ?? []).filter((c) => !first.some((f) => f.id === c.id))];
  const hasMore = more ? more.next !== null : props.data.moreContacts;

  async function loadMore() {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const last = list.at(-1);
      // The page holds the first 100 by email. The API's `contactsNext` continues right after them; without it (before
      // the API fix), the list endpoint pages on from the start, so walk it to the end of ours.
      const pageCursor = contactsCursor(props.data as ClientPage & ContactsExtras);
      let r = await api.clientContacts(props.data.client.id, more?.next ?? pageCursor ?? undefined);
      let acc = [...(more?.list ?? []), ...r.contacts];
      while (!more && !pageCursor && r.next && last && !acc.some((c) => c.id === last.id)) {
        r = await api.clientContacts(props.data.client.id, r.next);
        acc = [...acc, ...r.contacts];
      }
      setMore({ list: acc, next: r.next });
    } catch (e) {
      setMoreError(`More contacts didn't load. ${errorText(e)}`);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="lead-panel contacts-panel" aria-labelledby="contacts-h">
      <div className="lead-panel__head">
        <h2 id="contacts-h" className="lead-panel__title">
          Contacts
        </h2>
        {canWrite && (
          <button type="button" className="btn btn--secondary" onClick={() => setEditing("new")}>
            <Plus />
            Add contact
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<Users />} title="No contacts yet" headingLevel={3}>
          <p>The people you deal with at this client, who can be given access to the client portal.</p>
        </EmptyState>
      ) : (
        <ul className="contact-list">
          {list.map((c) => (
            <ContactRow
              key={c.id}
              c={c}
              canWrite={canWrite}
              canExport={canExport}
              canErase={canErase}
              onEdit={() => setEditing(c)}
              onExport={() => setExporting(c)}
              onErase={() => setErasing(c)}
            />
          ))}
        </ul>
      )}
      {moreError && <Notice tone="error">{moreError}</Notice>}
      {hasMore && (
        <button
          type="button"
          className="btn btn--secondary lead-timeline__more"
          onClick={loadMore}
          disabled={loadingMore}
          aria-busy={loadingMore || undefined}
        >
          {loadingMore ? "Loading…" : "Show more contacts"}
        </button>
      )}
      <ContactDialog
        clientId={props.data.client.id}
        contact={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setMore(null);
          props.reload();
        }}
      />
      {canExport && <ExportDialog contact={exporting} onClose={() => setExporting(null)} />}
      {canErase && (
        <EraseDialog
          contact={erasing}
          onClose={() => setErasing(null)}
          onDone={() => {
            setErasing(null);
            setMore(null);
            props.reload();
          }}
        />
      )}
    </section>
  );
}

function ContactRow(props: {
  c: ContactView;
  canWrite: boolean;
  canExport: boolean;
  canErase: boolean;
  onEdit: () => void;
  onExport: () => void;
  onErase: () => void;
}) {
  const { c } = props;
  const gone = c.anonymisedAt !== null;
  const tools = !gone && (props.canExport || props.canErase);
  return (
    <li className={gone ? "contact contact--gone" : "contact"}>
      <div className="contact__who">
        <p className="contact__name">
          {c.name}
          {c.title && <span className="contact__title">{c.title}</span>}
        </p>
        {gone ? (
          <p className="contact__meta">
            <StatusPill tone="muted" icon="ban">
              Anonymised
            </StatusPill>
            <span className="muted">
              <When ms={c.anonymisedAt} inline />
            </span>
          </p>
        ) : (
          <p className="contact__meta">
            <a href={`mailto:${c.email}`} className="break contact__email">
              {c.email}
            </a>
            {c.phone && <span>{c.phone}</span>}
          </p>
        )}
        {!gone && (
          <div className="contact__flags">
            <ContactFlags
              isPrimary={c.isPrimary}
              isBilling={c.isBilling}
              portalAccess={c.portalAccess}
              canSeeFinance={c.canSeeFinance}
            />
            {c.bouncedAt !== null && (
              <StatusPill tone="danger" icon="ban">
                Email bounced
              </StatusPill>
            )}
            {c.legalHold && (
              <StatusPill tone="warning" icon="lock">
                Legal hold
              </StatusPill>
            )}
            {c.marketingConsent?.granted && (
              <span className="contact__consent muted">Marketing consent given</span>
            )}
          </div>
        )}
      </div>
      {!gone && (props.canWrite || tools) && (
        <div className="contact__actions">
          {props.canWrite && (
            <button type="button" className="btn btn--text" onClick={props.onEdit}>
              <Pencil size={16} />
              Edit<span className="visually-hidden"> {c.name}</span>
            </button>
          )}
          {tools && (
            <MenuButton
              label={`Data tools for ${c.name}`}
              text="Data tools"
              hiddenText={` for ${c.name}`}
              buttonClass="btn btn--text"
              icon={<MoreHorizontal size={16} />}
              items={[
                ...(props.canExport ? [{ label: "Export their data", onSelect: props.onExport }] : []),
                ...(props.canErase
                  ? [{ label: "Erase or anonymise", onSelect: props.onErase, tone: "danger" as const }]
                  : []),
              ]}
            />
          )}
        </div>
      )}
    </li>
  );
}

type Form = {
  name: string;
  email: string;
  phone: string;
  title: string;
  isPrimary: boolean;
  isBilling: boolean;
  portalAccess: boolean;
  canSeeFinance: boolean | null;
  marketingConsent: boolean;
};

const formOf = (c: ContactView | null): Form =>
  c
    ? {
        name: c.name,
        email: c.email,
        phone: c.phone ?? "",
        title: c.title ?? "",
        isPrimary: c.isPrimary,
        isBilling: c.isBilling,
        portalAccess: c.portalAccess,
        canSeeFinance: c.canSeeFinance,
        marketingConsent: c.marketingConsent?.granted === true,
      }
    : {
        name: "",
        email: "",
        phone: "",
        title: "",
        isPrimary: false,
        isBilling: false,
        portalAccess: false,
        canSeeFinance: null,
        marketingConsent: false,
      };
const opt = (v: string) => (v.trim() ? v.trim() : null);

/** Only what changed from the contact as loaded (the M3.2 drafts rule). */
export function contactChanges(base: Form, f: Form): Omit<ContactPatch, "expectedUpdatedAt"> {
  const p: Omit<ContactPatch, "expectedUpdatedAt"> = {};
  if (f.name.trim() !== base.name) p.name = f.name.trim();
  if (f.email.trim().toLowerCase() !== base.email) p.email = f.email.trim();
  if (f.phone.trim() !== base.phone) p.phone = opt(f.phone);
  if (f.title.trim() !== base.title) p.title = opt(f.title);
  if (f.isPrimary && !base.isPrimary) p.isPrimary = true;
  if (f.isBilling !== base.isBilling) p.isBilling = f.isBilling;
  if (f.portalAccess !== base.portalAccess) p.portalAccess = f.portalAccess;
  const see = f.canSeeFinance ?? f.isBilling;
  if (see !== base.canSeeFinance) p.canSeeFinance = see;
  if (f.marketingConsent !== base.marketingConsent) p.marketingConsent = f.marketingConsent;
  return p;
}

function ContactDialog(props: {
  clientId: string;
  contact: ContactView | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const open = props.contact !== null;
  const existing = props.contact === "new" ? null : props.contact;
  const [f, setF] = useState<Form>(formOf(existing));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<ContactView | "new" | null>(null);
  if (props.contact !== shown) {
    setShown(props.contact);
    setF(formOf(existing));
    setErrors({});
    setFailure(null);
    setStale(false);
  }
  const set = (patch: Partial<Form>) => {
    setF((x) => ({ ...x, ...patch }));
    setFailure(null);
  };
  const base = formOf(existing);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs["ct-name"] = "Enter the contact's name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))
      errs["ct-email"] = "Enter an email address, like name@example.com.";
    setErrors(errs);
    const firstErr = Object.keys(errs)[0];
    if (firstErr) {
      document.getElementById(firstErr)?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      if (existing) {
        const patch = contactChanges(base, f);
        const r = await api.updateContact(existing.id, { ...patch, expectedUpdatedAt: existing.updatedAt });
        toast("success", r.changed ? "Contact saved." : "No change: that's already saved.");
      } else {
        const body: ContactInput = {
          name: f.name.trim(),
          email: f.email.trim(),
          phone: opt(f.phone),
          title: opt(f.title),
          ...(f.isPrimary ? { isPrimary: true as const } : {}),
          isBilling: f.isBilling,
          portalAccess: f.portalAccess,
          canSeeFinance: f.canSeeFinance ?? f.isBilling,
          marketingConsent: f.marketingConsent,
        };
        await api.addContact(props.clientId, body);
        toast("success", "Contact added.");
      }
      props.onSaved();
    } catch (err) {
      if (err instanceof RequestError && err.code === "email_in_use") {
        setErrors({ "ct-email": sentence(err.message) });
        document.getElementById("ct-email")?.focus();
      } else if (err instanceof RequestError && err.code === "stale_version") setStale(true);
      else setFailure(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={existing ? `Edit ${existing.name}` : "Add contact"}
      onClose={props.onClose}
      busy={busy}
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog__body contact-form">
          {stale && <StaleNotice title="Someone else changed this contact." onReload={props.onSaved} />}
          {failure && <Notice tone="error">{failure}</Notice>}
          <FormField id="ct-name" label="Name" error={errors["ct-name"]}>
            {(a) => (
              <input
                {...a}
                autoComplete="off"
                maxLength={100}
                value={f.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </FormField>
          <FormField id="ct-email" label="Email" error={errors["ct-email"]}>
            {(a) => (
              <input
                {...a}
                type="email"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                value={f.email}
                onChange={(e) => {
                  set({ email: e.target.value });
                  setErrors((x) => ({ ...x, "ct-email": "" }));
                }}
              />
            )}
          </FormField>
          <div className="form-grid">
            <FormField id="ct-phone" label="Phone" optional>
              {(a) => (
                <input
                  {...a}
                  type="tel"
                  autoComplete="off"
                  maxLength={40}
                  value={f.phone}
                  onChange={(e) => set({ phone: e.target.value })}
                />
              )}
            </FormField>
            <FormField id="ct-title" label="Role or title" optional>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={80}
                  value={f.title}
                  onChange={(e) => set({ title: e.target.value })}
                />
              )}
            </FormField>
          </div>
          {existing?.isPrimary ? (
            <p className="hint contact-form__primary">
              <StatusPill tone="info" icon="flag">
                Primary
              </StatusPill>
              Make another contact primary to change this.
            </p>
          ) : (
            <label className="check">
              <input
                type="checkbox"
                checked={f.isPrimary}
                onChange={(e) => set({ isPrimary: e.target.checked })}
              />
              Make this the primary contact
            </label>
          )}
          <ContactSwitches
            prefix="ct"
            isBilling={f.isBilling}
            portalAccess={f.portalAccess}
            canSeeFinance={f.canSeeFinance ?? f.isBilling}
            marketingConsent={f.marketingConsent}
            onChange={(patch) => set(patch)}
          />
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || stale}
            aria-busy={busy || undefined}
          >
            {busy ? "Saving…" : existing ? "Save contact" : "Add contact"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
