// One lead (M3.2, ADM-LEAD-02..06): what was asked (service, budget, timeline, message, page, UTM; the consent record
// read-only), the pipeline panel (stage with "Move to…", owner, next action), the contact (editable), the linked
// records (client, draft proposal, the same email within 30 days), and the timeline with notes, replies, stage changes
// and edits (keyset "Show older"). Reply and Convert open their dialogs (reply.tsx, convert.tsx).
// Every edit sends the `updatedAt` it was loaded with; a 409 `stale_version` shows the shared "changed by someone else"
// notice, keeps nothing half-saved and offers the latest. Leaving with unsaved edits asks first (ADM-G-04).
import { formatDate, istDate } from "@techaust/core/dates";
import {
  budgetBandLabel,
  countryName,
  labelOf,
  TIMELINE_LABELS,
  TOOL_LABELS,
} from "@techaust/core/form-labels";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Link, useParams } from "react-router";
import {
  type Assignee,
  api,
  errorText,
  type LeadActivity,
  type LeadDetail,
  type LeadPage as LeadPageData,
  type LeadPatch,
  type LeadStage,
  RequestError,
} from "../../api.ts";
import { EmptyState, PageHeader, Skeleton, StatusPill, When } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import {
  ArrowRight,
  Building,
  Clock,
  FileText,
  Flag,
  Inbox,
  Mail,
  Pencil,
  Plus,
} from "../../components/icons.tsx";
import { LoadFailed, NotFound, StaleNotice, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { allowed } from "../../lib/access.ts";
import { relative } from "../../lib/format.ts";
import {
  type Change,
  countryOptions,
  dateToMs,
  FIELD_LABELS,
  LOST_REASON_LABELS,
  msToDate,
  readActivity,
  SOURCE_LABELS,
  STAGE_LABELS,
} from "../../lib/leads.ts";
import { useUser } from "../../session.tsx";
import { ConvertDialog } from "./convert.tsx";
import { CRUMBS, LeadsGate, LostDialog, MoveMenu, StagePill } from "./parts.tsx";
import { ReplyDialog } from "./reply.tsx";

export function Component() {
  return (
    <LeadsGate>
      <LeadScreen />
    </LeadsGate>
  );
}

function LeadScreen() {
  const { id = "" } = useParams();
  const page = useLoad(() => api.lead(id), id);
  const people = useLoad(() => api.leadAssignees(), "");

  if (page.state === "failed") {
    if (page.error instanceof RequestError && page.error.status === 404) return <NotFound />;
    return (
      <>
        <PageHeader title="Lead" crumbs={CRUMBS} />
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      </>
    );
  }
  if (page.state === "loading") return <LeadSkeleton />;
  return (
    <LeadView
      // A fresh copy of the lead (after a save or a reload) starts the forms again from what's stored.
      key={page.data.lead.updatedAt}
      data={page.data}
      assignees={people.data?.assignees ?? []}
      reload={() => page.reload(true)}
    />
  );
}

type Follow = { ownerId: string; date: string; note: string };
type Contact = { name: string; email: string; phone: string; company: string; country: string };

const followOf = (l: LeadDetail): Follow => ({
  ownerId: l.ownerId ?? "",
  date: msToDate(l.nextActionAt),
  note: l.nextActionNote ?? "",
});
const contactOf = (l: LeadDetail): Contact => ({
  name: l.name,
  email: l.email,
  phone: l.phone ?? "",
  company: l.company ?? "",
  country: l.country ?? "",
});
const nullable = (v: string) => (v.trim() ? v.trim() : null);

function LeadView({
  data,
  assignees,
  reload,
}: {
  data: LeadPageData;
  assignees: Assignee[];
  reload: () => void;
}) {
  const user = useUser();
  const toast = useToast();
  const lead = data.lead;
  const canWrite = allowed(user.role, "leads.write");
  const canConvert = allowed(user.role, "clients.write") && allowed(user.role, "proposals.draft");
  const [stale, setStale] = useState(false);
  const [follow, setFollow] = useState<Follow>(() => followOf(lead));
  const [contact, setContact] = useState<Contact>(() => contactOf(lead));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"follow" | "contact" | null>(null);
  const [error, setError] = useState<{ where: "follow" | "contact"; text: string } | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [lost, setLost] = useState(false);
  const [replying, setReplying] = useState(false);
  const [converting, setConverting] = useState(false);

  const followDirty = JSON.stringify(follow) !== JSON.stringify(followOf(lead));
  const contactDirty = editing && JSON.stringify(contact) !== JSON.stringify(contactOf(lead));
  const dirty = followDirty || contactDirty || note.trim() !== "";

  const names = new Map<string, string>(assignees.map((a) => [a.id, a.name]));
  if (lead.ownerId && lead.ownerName) names.set(lead.ownerId, lead.ownerName);

  async function save(where: "follow" | "contact", patch: Omit<LeadPatch, "expectedUpdatedAt">) {
    setBusy(where);
    setError(null);
    try {
      const r = await api.updateLead(lead.id, { ...patch, expectedUpdatedAt: lead.updatedAt });
      toast("success", r.changed ? "Saved." : "No change: that's already saved.");
      if (where === "contact") setEditing(false);
      reload();
    } catch (e) {
      if (e instanceof RequestError && e.code === "stale_version") setStale(true);
      else setError({ where, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  function saveFollow(e: FormEvent) {
    e.preventDefault();
    const was = followOf(lead);
    const patch: Omit<LeadPatch, "expectedUpdatedAt"> = {};
    if (follow.ownerId !== was.ownerId) patch.ownerId = follow.ownerId || null;
    if (follow.date !== was.date) patch.nextActionAt = follow.date ? dateToMs(follow.date) : null;
    if (follow.note !== was.note) patch.nextActionNote = nullable(follow.note);
    save("follow", patch);
  }

  function saveContact(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) {
      setEmailError("Enter an email address, like name@example.com.");
      document.getElementById("lead-email")?.focus();
      return;
    }
    if (!contact.name.trim()) {
      document.getElementById("lead-name")?.focus();
      return;
    }
    setEmailError(null);
    const was = contactOf(lead);
    const patch: Omit<LeadPatch, "expectedUpdatedAt"> = {};
    if (contact.name.trim() !== was.name) patch.name = contact.name.trim();
    if (contact.email.trim().toLowerCase() !== was.email) patch.email = contact.email.trim();
    if (contact.phone.trim() !== was.phone) patch.phone = nullable(contact.phone);
    if (contact.company.trim() !== was.company) patch.company = nullable(contact.company);
    if (contact.country !== was.country) patch.country = contact.country || null;
    save("contact", patch);
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    const text = note.trim();
    if (!text) {
      document.getElementById("lead-note")?.focus();
      return;
    }
    try {
      await api.addLeadNote(lead.id, text);
      setNote("");
      toast("success", "Note added.");
      reload();
    } catch (err) {
      toast("error", `The note wasn't saved. ${errorText(err)}`);
    }
  }

  async function moveStage(to: LeadStage) {
    if (to === "lost") {
      setLost(true);
      return;
    }
    try {
      await api.setLeadStage(lead.id, to);
      toast("success", `Moved to ${STAGE_LABELS[to]}.`);
      reload();
    } catch (err) {
      toast("error", `The stage wasn't changed. ${errorText(err)}`);
    }
  }

  const converted = data.client !== null;
  return (
    <>
      <UnsavedChangesGuard dirty={dirty && !stale} what="this lead" />
      <PageHeader
        title={lead.name}
        crumbs={CRUMBS}
        status={<StagePill stage={lead.stage} reason={lead.lostReason} />}
        action={
          canWrite ? (
            <>
              {canConvert && !converted && (
                <button type="button" className="btn btn--secondary" onClick={() => setConverting(true)}>
                  <Building />
                  Convert to client
                </button>
              )}
              <button type="button" className="btn btn--primary" onClick={() => setReplying(true)}>
                <Mail />
                Reply
              </button>
            </>
          ) : undefined
        }
      />
      {stale && <StaleNotice title="Someone else changed this lead." onReload={reload} />}
      {lead.scheduledForDeletion && lead.deleteAfter !== null && (
        <Notice tone="info">
          Scheduled for deletion on <strong>{formatDate(istDate(lead.deleteAfter))}</strong>, when its
          retention period ends. A new note, reply or change moves the date on.
        </Notice>
      )}

      <div className="lead-page">
        <aside className="lead-page__side" aria-label="Pipeline and contact">
          <section className="lead-panel" aria-labelledby="pipeline-h">
            <h2 id="pipeline-h" className="lead-panel__title">
              Pipeline
            </h2>
            <div className="lead-stage">
              <div>
                <p className="lead-stage__label" id="stage-label">
                  Stage
                </p>
                <StagePill stage={lead.stage} reason={lead.lostReason} />
              </div>
              {canWrite && <MoveMenu lead={lead} onMove={moveStage} />}
            </div>
            {canWrite ? (
              <form className="lead-follow" onSubmit={saveFollow} noValidate>
                {error?.where === "follow" && <Notice tone="error">{error.text}</Notice>}
                <FormField id="lead-owner" label="Owner">
                  {(a) => (
                    <select
                      {...a}
                      value={follow.ownerId}
                      onChange={(e) => setFollow({ ...follow, ownerId: e.target.value })}
                    >
                      <option value="">Unassigned</option>
                      {assignees.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || "Name not set yet"}
                        </option>
                      ))}
                      {lead.ownerId && !assignees.some((p) => p.id === lead.ownerId) && (
                        <option value={lead.ownerId}>{lead.ownerName ?? "A former staff member"}</option>
                      )}
                    </select>
                  )}
                </FormField>
                <FormField
                  id="lead-next"
                  label="Next action"
                  optional
                  status={
                    lead.nextActionOverdue && !followDirty ? (
                      <StatusPill tone="danger" icon="clock">
                        Overdue
                      </StatusPill>
                    ) : undefined
                  }
                >
                  {(a) => (
                    <input
                      {...a}
                      type="date"
                      value={follow.date}
                      onChange={(e) => setFollow({ ...follow, date: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField id="lead-next-note" label="Next action note" optional>
                  {(a) => (
                    <textarea
                      {...a}
                      rows={2}
                      maxLength={500}
                      value={follow.note}
                      onChange={(e) => setFollow({ ...follow, note: e.target.value })}
                    />
                  )}
                </FormField>
                {followDirty && (
                  <div className="lead-panel__actions">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setFollow(followOf(lead))}
                      disabled={busy === "follow"}
                    >
                      Discard
                    </button>
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={busy === "follow"}
                      aria-busy={busy === "follow" || undefined}
                    >
                      {busy === "follow" ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                )}
              </form>
            ) : (
              <dl className="facts">
                <Fact label="Owner">{lead.ownerName ?? <span className="muted">Unassigned</span>}</Fact>
                <Fact label="Next action">
                  {lead.nextActionAt === null ? (
                    <span className="muted">None</span>
                  ) : (
                    formatDate(istDate(lead.nextActionAt))
                  )}
                </Fact>
              </dl>
            )}
          </section>

          <section className="lead-panel" aria-labelledby="contact-h">
            <div className="lead-panel__head">
              <h2 id="contact-h" className="lead-panel__title">
                Contact
              </h2>
              {canWrite && !editing && (
                <button
                  type="button"
                  className="btn btn--text"
                  onClick={() => {
                    setContact(contactOf(lead));
                    setEditing(true);
                  }}
                >
                  <Pencil size={16} />
                  Edit<span className="visually-hidden"> contact</span>
                </button>
              )}
            </div>
            {editing ? (
              <form className="lead-contact" onSubmit={saveContact} noValidate>
                {error?.where === "contact" && <Notice tone="error">{error.text}</Notice>}
                <FormField id="lead-name" label="Name" error={contact.name.trim() ? null : "Enter a name."}>
                  {(a) => (
                    <input
                      {...a}
                      autoComplete="off"
                      maxLength={100}
                      value={contact.name}
                      onChange={(e) => setContact({ ...contact, name: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField id="lead-email" label="Email" error={emailError}>
                  {(a) => (
                    <input
                      {...a}
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      spellCheck={false}
                      autoCapitalize="none"
                      value={contact.email}
                      onChange={(e) => setContact({ ...contact, email: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField id="lead-phone" label="Phone" optional>
                  {(a) => (
                    <input
                      {...a}
                      type="tel"
                      autoComplete="off"
                      maxLength={40}
                      value={contact.phone}
                      onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField id="lead-company" label="Company" optional>
                  {(a) => (
                    <input
                      {...a}
                      autoComplete="off"
                      maxLength={120}
                      value={contact.company}
                      onChange={(e) => setContact({ ...contact, company: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField id="lead-country" label="Country" optional>
                  {(a) => (
                    <select
                      {...a}
                      value={contact.country}
                      onChange={(e) => setContact({ ...contact, country: e.target.value })}
                    >
                      <option value="">Not given</option>
                      {countryOptions().map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
                <div className="lead-panel__actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => {
                      setEditing(false);
                      setEmailError(null);
                      setError(null);
                    }}
                    disabled={busy === "contact"}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={busy === "contact"}
                    aria-busy={busy === "contact" || undefined}
                  >
                    {busy === "contact" ? "Saving…" : "Save contact"}
                  </button>
                </div>
              </form>
            ) : (
              <dl className="facts">
                <Fact label="Name">{lead.name}</Fact>
                <Fact label="Email">
                  <a href={`mailto:${lead.email}`} className="break">
                    {lead.email}
                  </a>
                </Fact>
                <Fact label="Phone">{lead.phone ?? <span className="muted">Not given</span>}</Fact>
                <Fact label="Company">{lead.company ?? <span className="muted">Not given</span>}</Fact>
                <Fact label="Country">
                  {lead.country ? countryName(lead.country) : <span className="muted">Not given</span>}
                </Fact>
              </dl>
            )}
          </section>

          <Linked data={data} />
        </aside>

        <div className="lead-page__main">
          <Enquiry lead={lead} />
          <Timeline
            leadId={lead.id}
            first={data.timeline}
            lead={lead}
            names={names}
            noteForm={
              canWrite ? (
                <form className="lead-note" onSubmit={addNote} noValidate>
                  <FormField id="lead-note" label="Add a note">
                    {(a) => (
                      <textarea
                        {...a}
                        rows={3}
                        maxLength={2000}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    )}
                  </FormField>
                  <button type="submit" className="btn btn--secondary" disabled={!note.trim()}>
                    <Plus />
                    Add note
                  </button>
                </form>
              ) : null
            }
          />
        </div>
      </div>

      <LostDialog
        lead={lost ? lead : null}
        onClose={() => setLost(false)}
        onMoved={() => {
          setLost(false);
          toast("success", "Moved to Lost.");
          reload();
        }}
      />
      <ReplyDialog
        open={replying}
        lead={lead}
        onClose={() => setReplying(false)}
        onSent={() => {
          setReplying(false);
          reload();
        }}
      />
      {canConvert && !converted && (
        <ConvertDialog
          open={converting}
          lead={lead}
          onClose={() => setConverting(false)}
          onConverted={() => {
            setConverting(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Client and draft proposal once converted; the same email within 30 days (linked, never merged: FRM-04). */
function Linked({ data }: { data: LeadPageData }) {
  const earlier = data.duplicates.filter((d) => d.relation === "earlier");
  const later = data.duplicates.filter((d) => d.relation === "later");
  if (!data.client && !data.proposal && data.duplicates.length === 0) return null;
  return (
    <section className="lead-panel" aria-labelledby="linked-h">
      <h2 id="linked-h" className="lead-panel__title">
        Linked records
      </h2>
      <ul className="lead-links">
        {data.client && (
          <li>
            <Building size={20} />
            <span>
              <span className="lead-links__label">Client</span>
              <Link to={`/clients/${data.client.id}`}>
                {data.client.name ?? "Client"}
                {data.client.code && <span className="docno"> {data.client.code}</span>}
              </Link>
            </span>
          </li>
        )}
        {data.proposal && (
          <li>
            <FileText size={20} />
            <span>
              <span className="lead-links__label">Proposal</span>
              <Link to={`/proposals/${data.proposal.id}`}>
                {data.proposal.status === "draft" ? "Draft proposal" : "Proposal"}
              </Link>
            </span>
          </li>
        )}
        {[...earlier, ...later].map((d) => (
          <li key={d.id}>
            <Inbox size={20} />
            <span>
              <span className="lead-links__label">
                {d.relation === "earlier" ? "Earlier lead, same email" : "Later lead, same email"}
              </span>
              <Link to={`/leads/${d.id}`}>
                <span className="docno">{d.ref}</span>, {formatDate(istDate(d.createdAt))},{" "}
                {STAGE_LABELS[d.stage]}
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const UTM_LABELS: Record<string, string> = {
  source: "UTM source",
  medium: "UTM medium",
  campaign: "UTM campaign",
  term: "UTM term",
  content: "UTM content",
};

/** What was asked, in the internal lead alert's words (packages/email leadAlert), plus the consent record, read-only. */
function Enquiry({ lead }: { lead: LeadDetail }) {
  const facts: [string, ReactNode][] = [
    [
      "Reference",
      <span key="r" className="docno">
        {lead.ref}
      </span>,
    ],
    ["Source", SOURCE_LABELS[lead.source]],
    ["Service", lead.serviceName ?? "General enquiry"],
  ];
  const add = (label: string, v: ReactNode | null | undefined) => {
    if (v !== null && v !== undefined && v !== "") facts.push([label, v]);
  };
  add("Type", lead.requestType?.replaceAll("-", " "));
  add("Plan", lead.plan);
  add(
    "Budget",
    lead.budgetBand
      ? lead.currency
        ? budgetBandLabel(lead.currency, lead.budgetBand)
        : lead.budgetBand
      : null,
  );
  add("Timeline", lead.timeline ? labelOf(TIMELINE_LABELS, lead.timeline) : null);
  add("Currency", lead.currency);
  add("Tools", lead.tools?.length ? lead.tools.map((t) => labelOf(TOOL_LABELS, t)).join(", ") : null);
  add("Best time for a call", lead.callWindow);
  add("Page", lead.sourcePage);
  add("Referrer", lead.referrerHost);
  for (const [k, label] of Object.entries(UTM_LABELS)) add(label, lead.utm?.[k]);
  facts.push(["Created", <When key="c" ms={lead.createdAt} inline />]);
  const c = lead.consent;
  return (
    <>
      <section className="lead-panel" aria-labelledby="enquiry-h">
        <h2 id="enquiry-h" className="lead-panel__title">
          Enquiry
        </h2>
        <dl className="facts facts--two">
          {facts.map(([label, v]) => (
            <Fact key={label} label={label}>
              {v}
            </Fact>
          ))}
        </dl>
        <h3 className="lead-panel__sub">Message</h3>
        {lead.message ? (
          <p className="prewrap lead-message">{lead.message}</p>
        ) : (
          <p className="muted">No message</p>
        )}
      </section>
      {c && (
        <section className="lead-panel" aria-labelledby="consent-h">
          <h2 id="consent-h" className="lead-panel__title">
            Consent record
          </h2>
          <dl className="facts facts--two">
            {c.noticeVersion && <Fact label="Notice version">{c.noticeVersion}</Fact>}
            {c.purposes && c.purposes.length > 0 && <Fact label="Purposes">{c.purposes.join(", ")}</Fact>}
            {c.at && (
              <Fact label="Given">
                <When ms={c.at} inline />
              </Fact>
            )}
            <Fact label="Marketing emails">{c.marketing ? "Yes" : "No"}</Fact>
            {c.withdrawnAt && (
              <Fact label="Withdrawn">
                <When ms={c.withdrawnAt} inline />
              </Fact>
            )}
          </dl>
        </section>
      )}
    </>
  );
}

// ---- the timeline ---------------------------------------------------------------------------------------------------

function Timeline(props: {
  leadId: string;
  lead: LeadDetail;
  first: { items: LeadActivity[]; next: string | null };
  names: ReadonlyMap<string, string>;
  noteForm: ReactNode;
}) {
  const [older, setOlder] = useState<LeadActivity[]>([]);
  const [next, setNext] = useState(props.first.next);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = [...props.first.items, ...older.filter((o) => !props.first.items.some((f) => f.id === o.id))];
  const now = Date.now();
  const titleId = useId();

  async function more() {
    if (!next) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.leadActivities(props.leadId, next);
      setOlder((o) => [...o, ...r.items]);
      setNext(r.next);
    } catch (e) {
      setError(`Older entries didn't load. ${errorText(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="lead-panel lead-timeline" aria-labelledby={titleId}>
      <h2 id={titleId} className="lead-panel__title">
        Timeline
      </h2>
      {props.noteForm}
      {items.length === 0 && props.lead.source === "manual" ? (
        <EmptyState title="Nothing on the timeline yet" headingLevel={3}>
          <p>Notes, replies and stage changes appear here.</p>
        </EmptyState>
      ) : (
        <ol className="lead-timeline__list">
          {items.map((a) => (
            <Activity key={a.id} a={a} names={props.names} now={now} />
          ))}
          {!next && props.lead.source === "web" && (
            <li className="entry">
              <div className="entry__time">
                <time dateTime={new Date(props.lead.createdAt).toISOString()}>
                  {formatDate(istDate(props.lead.createdAt))}
                </time>
                <span className="entry__rel">{relative(props.lead.createdAt, now)}</span>
              </div>
              <div className="entry__body act">
                <span className="act__icon" aria-hidden="true">
                  <Inbox size={16} />
                </span>
                <p className="entry__what">
                  <strong>The website form</strong> sent this enquiry
                </p>
              </div>
            </li>
          )}
        </ol>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {next && (
        <button
          type="button"
          className="btn btn--secondary lead-timeline__more"
          onClick={more}
          disabled={loading}
          aria-busy={loading || undefined}
        >
          {loading ? "Loading…" : "Show older"}
        </button>
      )}
    </section>
  );
}

function Activity({ a, names, now }: { a: LeadActivity; names: ReadonlyMap<string, string>; now: number }) {
  const v = readActivity(a);
  const who = a.actorId ? a.actorName || "A former staff member" : "The system";
  const icon =
    v.kind === "note" ? (
      <Pencil size={16} />
    ) : v.kind === "reply" ? (
      <Mail size={16} />
    ) : v.kind === "stage" ? (
      <Flag size={16} />
    ) : a.kind === "converted" ? (
      <Building size={16} />
    ) : v.kind === "updated" ? (
      <Pencil size={16} />
    ) : (
      <Clock size={16} />
    );
  let what: ReactNode;
  let detail: ReactNode = null;
  if (v.kind === "note") {
    what = "added a note";
    detail = <p className="prewrap act__text">{v.text}</p>;
  } else if (v.kind === "reply") {
    what = "sent a reply";
    detail = (
      <div className="act__mail">
        <p className="act__subject">{v.subject}</p>
        <p className="act__excerpt">{v.excerpt}</p>
      </div>
    );
  } else if (v.kind === "stage") {
    what = v.auto
      ? `moved it to ${v.to ? STAGE_LABELS[v.to] : "another stage"} (${v.auto})`
      : "changed the stage";
    if (!v.auto)
      detail = (
        <p className="act__move">
          {v.from ? STAGE_LABELS[v.from] : "?"}
          <ArrowRight size={16} />
          <span className="visually-hidden"> to </span>
          {v.to ? STAGE_LABELS[v.to] : "?"}
          {v.reason && <span className="muted">, lost reason: {LOST_REASON_LABELS[v.reason]}</span>}
        </p>
      );
  } else if (v.kind === "updated") {
    what = `changed ${v.changes.map((c) => (FIELD_LABELS[c.field] ?? c.field).toLowerCase()).join(", ")}`;
    detail = <ChangeTable changes={v.changes} names={names} />;
  } else {
    what = a.kind === "created" ? "added the lead" : a.kind === "converted" ? "converted the lead" : "";
    detail = v.text ? <p className="act__text">{v.text}</p> : null;
  }
  return (
    <li className="entry">
      <div className="entry__time">
        <time dateTime={new Date(a.createdAt).toISOString()}>{formatDate(istDate(a.createdAt))}</time>
        <span className="entry__rel">{relative(a.createdAt, now)}</span>
      </div>
      <div className="entry__body act">
        <span className="act__icon" aria-hidden="true">
          {icon}
        </span>
        <div className="act__main">
          <p className="entry__what">
            <strong>{who}</strong> {what}
          </p>
          {detail}
        </div>
      </div>
    </li>
  );
}

function shown(field: string, value: unknown, names: ReadonlyMap<string, string>): string {
  if (value === null || value === undefined || value === "") return "None";
  if (field === "owner") return names.get(String(value)) ?? "A former staff member";
  if (field === "next_action_at" && typeof value === "number") return formatDate(istDate(value));
  if (field === "country") return countryName(String(value));
  return String(value);
}

function ChangeTable({ changes, names }: { changes: Change[]; names: ReadonlyMap<string, string> }) {
  return (
    <table className="diff__table act__diff">
      <caption className="visually-hidden">Before and after</caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Before</th>
          <th scope="col">
            <span className="visually-hidden">changed to</span>
          </th>
          <th scope="col">After</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.field}>
            <th scope="row">{FIELD_LABELS[c.field] ?? c.field}</th>
            <td className="diff__before">{shown(c.field, c.from, names)}</td>
            <td className="diff__arrow" aria-hidden="true">
              <ArrowRight size={16} />
            </td>
            <td className="diff__after">{shown(c.field, c.to, names)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LeadSkeleton() {
  return (
    <>
      <PageHeader title="Lead" crumbs={CRUMBS} />
      <p className="visually-hidden" role="status">
        Loading the lead
      </p>
      <div className="lead-page" aria-hidden="true">
        <div className="lead-page__side">
          <div className="lead-panel stack-sm">
            <Skeleton width="40%" />
            <Skeleton width="70%" />
            <Skeleton width="55%" />
          </div>
        </div>
        <div className="lead-page__main">
          <div className="lead-panel stack-sm">
            <Skeleton width="30%" />
            <Skeleton width="80%" />
            <Skeleton width="65%" />
            <Skeleton width="75%" />
          </div>
        </div>
      </div>
    </>
  );
}
