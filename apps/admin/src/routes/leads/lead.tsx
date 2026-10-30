// One lead (M3.2, ADM-LEAD-02..06): what was asked (service, budget, timeline, message, page, UTM; the consent record
// read-only), the pipeline panel (stage with "Move to…", owner, next action), the contact (editable), the linked
// records (client, draft proposal, the same email within 30 days), and the timeline with notes, replies, stage changes
// and edits (keyset "Show older"). Reply and Convert open their dialogs (reply.tsx, convert.tsx).
// Every edit sends the `updatedAt` it was loaded with and only the fields the person changed (drafts.ts); a 409
// `stale_version`, or a reload that brings someone else's change to a field a draft holds, shows the shared "changed
// by someone else" notice, keeps nothing half-saved and offers the latest. Leaving with unsaved edits asks first
// (ADM-G-04).
// FX-3 fix round 2 (B, D): a reload never starts the page again. The view stays mounted and takes the new copy as props, so the
// open forms, their drafts and the keyboard focus stay where they were; a control that goes away with a save or a cancel hands
// the focus to the control that opened its form, or to its panel's heading (`focusAfter`).
import { formatDate, formatIstDateTime, istDate } from "@techaust/core/dates";
import {
  budgetBandLabel,
  countryName,
  labelOf,
  TIMELINE_LABELS,
  TOOL_LABELS,
} from "@techaust/core/form-labels";
import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
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
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
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
import { dateError } from "../../lib/date-field.ts";
import { relative } from "../../lib/format.ts";
import {
  answerText,
  type Change,
  countryOptions,
  FIELD_LABELS,
  LOST_REASON_LABELS,
  msToDate,
  readActivity,
  SOURCE_LABELS,
  STAGE_LABELS,
} from "../../lib/leads.ts";
import { REASON_LABEL, reasonText } from "../../lib/offer-words.ts";
import { personLabel, personLabels } from "../../lib/people.ts";
import { useUser } from "../../session.tsx";
import { ANSWERS_COPY, type Answers, AnswersFields, answersPatch } from "./answers.tsx";
import { ConvertDialog } from "./convert.tsx";
import {
  type Contact,
  contactPatch,
  type DraftAction,
  type Drafts,
  drafts as draftsReducer,
  type Follow,
  followPatch,
  hasConflict,
  NO_DRAFTS,
} from "./drafts.ts";
import { CRUMBS, LeadsGate, LostDialog, MoveMenu, StagePill } from "./parts.tsx";
import { ReplyDialog } from "./reply.tsx";

export function Component() {
  const { id = "" } = useParams();
  return (
    <LeadsGate>
      {/* Another lead is a fresh page: its drafts start empty. */}
      <LeadScreen key={id} id={id} />
    </LeadsGate>
  );
}

function LeadScreen({ id }: { id: string }) {
  const page = useLoad(() => api.lead(id), id);
  const people = useLoad(() => api.leadAssignees(), "");
  const [drafts, draft] = useReducer(draftsReducer, NO_DRAFTS);
  // Every fresh copy of the lead carries the drafts onto it before it is shown (re-check R1): untouched fields take
  // the stored values, and a field someone else changed too drops only that edit, with the stale notice.
  const [seen, setSeen] = useState<LeadPageData | null>(null);
  if (page.state === "ready" && page.data !== seen) {
    setSeen(page.data);
    draft({
      type: "loaded",
      contact: contactOf(page.data.lead),
      follow: followOf(page.data.lead),
      answers: answersOf(page.data.lead),
    });
  }

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
      // A fresh copy of the lead (after a save or a reload) is new props for the same view, never a new page (fix round 2, B and D):
      // what the person has typed and not saved (the drafts) is held here, above the reload, and carried onto it; open forms and
      // the focus stay.
      data={page.data}
      assignees={people.data?.assignees ?? []}
      drafts={drafts}
      draft={draft}
      reload={(cause = "own") => {
        if (cause === "stale") draft({ type: "reloaded-latest" });
        page.reload(true);
      }}
    />
  );
}

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
function LeadView({
  data,
  assignees,
  drafts,
  draft,
  reload,
}: {
  data: LeadPageData;
  assignees: Assignee[];
  drafts: Drafts;
  draft: Dispatch<DraftAction>;
  reload: (cause?: "own" | "stale") => void;
}) {
  const user = useUser();
  const toast = useToast();
  const lead = data.lead;
  const canWrite = allowed(user.role, "leads.write");
  const canConvert = allowed(user.role, "clients.write") && allowed(user.role, "proposals.draft");
  const [saveStale, setStale] = useState(false);
  const [error, setError] = useState<{ where: Where; text: string } | null>(null);
  const stale = saveStale || hasConflict(drafts);
  const follow = drafts.follow?.value ?? followOf(lead);
  const followBase = drafts.follow?.base ?? followOf(lead);
  const setFollow = (value: Follow | null) => draft({ type: "follow", value, base: followOf(lead) });
  const editing = drafts.contact !== null;
  const contact = drafts.contact?.value ?? contactOf(lead);
  const contactBase = drafts.contact?.base ?? contactOf(lead);
  const setContact = (value: Contact | null) => draft({ type: "contact", value, base: contactOf(lead) });
  const [busy, setBusy] = useState<Where | null>(null);
  // FX-3 (A3 8): a manual lead's quote answers, edited on the Enquiry panel (null while shown read-only); a draft above the reload
  // (fix round 2, B), so "Stay" after a convert keeps it.
  const answers = drafts.answers;
  const setAnswers = (value: AnswersDraft | null) =>
    draft({ type: "answers", value: value?.value ?? null, base: value?.base ?? answersOf(lead) });
  const answersDirty = answers !== null && JSON.stringify(answers.value) !== JSON.stringify(answers.base);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [nextDateError, setNextDateError] = useState<string | null>(null);
  const dates = useUnreadDates<"date">();

  // The email and the follow date as the person last saw them, so a new copy can tell whether the reload replaced them (fix round 3, 2).
  const shown = useRef({ email: contact.email, date: follow.date });
  useEffect(() => {
    shown.current = { email: contact.email, date: follow.date };
  });
  // A new copy of the lead: a refused save's 409 and a failed save's line belonged to the old copy (the drafts were carried onto
  // the new one), as when the page used to start again. A field line goes only with the text it was about: when the reload put
  // another value in the email or the follow date (someone else changed it, and the person's edit was set aside), its line goes,
  // and the date's unread text with it (fix round 3, 2); a line under the person's own kept text stays.
  const [version, setVersion] = useState(lead.updatedAt);
  if (version !== lead.updatedAt) {
    setVersion(lead.updatedAt);
    setStale(false);
    setError(null);
    if (contact.email !== shown.current.email) setEmailError(null);
    if (follow.date !== shown.current.date) {
      setNextDateError(null);
      dates.reset();
    }
  }
  // A stale reload sets the edits aside (the answers too: `reloaded-latest`), so unreadable date text and every field line go with
  // them. The notice and its button go too: the focus moves to the page's heading, the top of the latest copy.
  const reloadStale = () => {
    dates.reset();
    setNextDateError(null);
    setEmailError(null);
    focusLater(() => document.querySelector<HTMLElement>("#main h1"));
    reload("stale");
  };
  const note = drafts.note;
  const setNote = (text: string) => draft({ type: "note", text });
  const [lost, setLost] = useState(false);
  const [replying, setReplying] = useState(false);
  const [converting, setConverting] = useState(false);
  // Converted, and the proposal is opening: the lead reloads only if the leave question is answered "Stay" (FX-3 review 2).
  const [convertedAway, setConvertedAway] = useState(false);

  // Where the focus goes once a save or a cancel has taken away the control that had it (fix round 2, D): the control that opened
  // the form, or the panel's heading. Taken as soon as that element is on the page (after the reload for one that only the new copy
  // shows, such as Linked records after a convert).
  // A waiting target lapses once the person has moved the focus somewhere themselves (fix round 3, 5): a key or a pointer pressed
  // since it was set, and the focus now on an element other than the page itself. A focus the code moves meanwhile (a dialog handing
  // it back to its opener as it closes) doesn't count, so Linked records still takes it after a convert.
  const focusAfter = useRef<{ target: () => HTMLElement | null; acted: boolean } | null>(null);
  function focusLater(target: string | (() => HTMLElement | null)) {
    focusAfter.current = {
      target: typeof target === "string" ? () => document.getElementById(target) : target,
      acted: false,
    };
  }
  useEffect(() => {
    const acted = () => {
      if (focusAfter.current) focusAfter.current.acted = true;
    };
    document.addEventListener("keydown", acted, true);
    document.addEventListener("pointerdown", acted, true);
    return () => {
      document.removeEventListener("keydown", acted, true);
      document.removeEventListener("pointerdown", acted, true);
    };
  }, []);
  useEffect(() => {
    const waiting = focusAfter.current;
    if (!waiting) return;
    const active = document.activeElement;
    if (waiting.acted && active && active !== document.body) {
      focusAfter.current = null;
      return;
    }
    const el = waiting.target();
    if (!el) return;
    focusAfter.current = null;
    el.focus();
  });

  // Text in the Next action field that can't be read is a change too: Save shows the line, Discard takes it back.
  const followDirty = dates.any || JSON.stringify(follow) !== JSON.stringify(followBase);
  const contactDirty = editing && JSON.stringify(contact) !== JSON.stringify(contactBase);
  const dirty = followDirty || contactDirty || answersDirty || note.trim() !== "";

  const names = new Map<string, string>(assignees.map((a) => [a.id, a.name]));
  // Two people with one name are told apart by their work email in the Owner menu (final sweep A20).
  const ownerLabels = personLabels(assignees);
  if (lead.ownerId && lead.ownerName) names.set(lead.ownerId, lead.ownerName);

  async function save(where: Where, patch: Omit<LeadPatch, "expectedUpdatedAt">) {
    setBusy(where);
    setError(null);
    try {
      const r = await api.updateLead(lead.id, { ...patch, expectedUpdatedAt: lead.updatedAt });
      toast("success", r.changed ? "Saved." : "No change: that's already saved.");
      if (where === "contact") closeContact();
      else if (where === "answers") closeAnswers();
      else discardFollow();
      reload();
    } catch (e) {
      if (e instanceof RequestError && e.code === "stale_version") setStale(true);
      else if (e instanceof RequestError && e.code === "lead_answers_fixed")
        setError({ where, text: ANSWERS_COPY.answersFixed });
      else setError({ where, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  // Discard (and a save) drops the draft, an unread date and its line together (re-check N3).
  function discardFollow() {
    setFollow(null);
    dates.reset();
    setNextDateError(null);
    focusLater("pipeline-h");
  }

  // The contact and Enquiry forms close back onto their own Edit button.
  function closeContact() {
    setContact(null);
    setEmailError(null);
    focusLater("lead-contact-edit");
  }
  function closeAnswers() {
    setAnswers(null);
    focusLater("lead-answers-edit");
  }

  function saveFollow(e: FormEvent) {
    e.preventDefault();
    const dateErr = dateError(dates.unread.date);
    setNextDateError(dateErr);
    if (dateErr) {
      document.getElementById("lead-next")?.focus();
      return;
    }
    // Only what differs from the draft's base is sent (re-check R1).
    save("follow", followPatch({ base: followBase, value: follow }));
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
    save("contact", contactPatch({ base: contactBase, value: contact }));
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
      // "Add note" is disabled while the field is empty, so the field keeps the focus, ready for the next note.
      focusLater("lead-note");
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
      {/* Drafts survive a draft conflict, so they stay guarded; only a refused save (409) lifts it, the note still guarded. */}
      <UnsavedChangesGuard
        dirty={note.trim() !== "" || (dirty && !saveStale)}
        what="this lead"
        // Converted with unsaved edits, and the person stays: now the lead is read again and shows the client and the proposal.
        onStay={() => {
          if (!convertedAway) return;
          setConvertedAway(false);
          // The Convert button goes; Linked records then shows the client and the proposal.
          focusLater("linked-h");
          reload();
        }}
      />
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
      {stale &&
        (saveStale ? (
          <StaleNotice title="Someone else changed this lead." onReload={reloadStale} />
        ) : (
          // A reload found someone else's change to a field a draft held (owner's wording, 2026-10-25).
          <StaleNotice
            title="Someone else changed this lead while you were editing it."
            body="Your unsaved changes to those fields were set aside so theirs aren't overwritten; anything you had already saved is kept, and so is your note. Reload to see the latest, then make your change again."
            onReload={reloadStale}
          />
        ))}
      {lead.scheduledForDeletion && lead.deleteAfter !== null && (
        <Notice tone="info">
          Scheduled for deletion on <strong>{formatDate(istDate(lead.deleteAfter))}</strong>, when its
          retention period ends. A new note, reply or change moves the date on.
        </Notice>
      )}

      <div className="lead-page">
        <aside className="lead-page__side" aria-label="Pipeline and contact">
          <section className="lead-panel" aria-labelledby="pipeline-h">
            <h2 id="pipeline-h" className="lead-panel__title" tabIndex={-1}>
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
                          {personLabel(ownerLabels, p)}
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
                  error={nextDateError}
                  status={
                    lead.nextActionOverdue && !followDirty ? (
                      <StatusPill tone="danger" icon="clock">
                        Overdue
                      </StatusPill>
                    ) : undefined
                  }
                >
                  {(a) => (
                    <DateField
                      {...a}
                      {...dates.bind("date")}
                      value={follow.date}
                      onChange={(v) => setFollow({ ...follow, date: v })}
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
                      onClick={discardFollow}
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
                  id="lead-contact-edit"
                  className="btn btn--text"
                  onClick={() => {
                    // The Edit button goes as the form opens: the focus moves to its first field (fix round 3, 8).
                    setEmailError(null);
                    setContact(contactOf(lead));
                    focusLater("lead-name");
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
                      closeContact();
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
          <Enquiry
            lead={lead}
            canEdit={canWrite && lead.source === "manual"}
            answers={answers}
            onAnswers={setAnswers}
            onOpen={() => {
              // The Edit button goes as the form opens: the focus moves to its first field (fix round 3, 8).
              setAnswers({ base: answersOf(lead), value: answersOf(lead) });
              focusLater("lead-currency");
            }}
            busy={busy === "answers"}
            error={error?.where === "answers" ? error.text : null}
            onCancel={() => {
              closeAnswers();
              setError(null);
            }}
            onSave={(base, value) => save("answers", answersPatch(base, value))}
          />
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
            focusLater("linked-h");
            reload();
          }}
          onOpening={() => {
            setConverting(false);
            setConvertedAway(true);
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

/**
 * The client's decision on the proposal (M4.5, ADM-PROP-10): accepted, or declined with the client's reason in the client's words
 * (07-N §3) and their note. A decline also moved the lead to Lost (owner, 2026-10-26); staff can move it back.
 */
function DecisionLine({ decision: d }: { decision: NonNullable<LeadPageData["decision"]> }) {
  const accepted = d.status === "accepted" || d.status === "converted";
  return (
    <span className="lead-decision">
      <span className="lead-decision__head">
        <StatusPill tone={accepted ? "success" : "muted"} icon={accepted ? "check" : "ban"}>
          {accepted ? "Accepted" : "Declined"}
        </StatusPill>
        <span className="lead-decision__when">
          {formatIstDateTime(d.at)}
          {d.contactName ? `, ${d.contactName}` : ""}
        </span>
      </span>
      {!accepted && d.reason && (
        <span className="lead-decision__why">
          {REASON_LABEL}: {reasonText(d.reason)}
          {d.note && <span className="offer-sub muted">{d.note}</span>}
        </span>
      )}
    </span>
  );
}

/** Client and draft proposal once converted; the same email within 30 days (linked, never merged: FRM-04). */
function Linked({ data }: { data: LeadPageData }) {
  const earlier = data.duplicates.filter((d) => d.relation === "earlier");
  const later = data.duplicates.filter((d) => d.relation === "later");
  if (!data.client && !data.proposal && data.duplicates.length === 0) return null;
  return (
    <section className="lead-panel" aria-labelledby="linked-h">
      <h2 id="linked-h" className="lead-panel__title" tabIndex={-1}>
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
              {data.decision && <DecisionLine decision={data.decision} />}
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

type Where = "follow" | "contact" | "answers";
type AnswersDraft = { base: Answers; value: Answers };

const answersOf = (l: LeadDetail): Answers => ({
  currency: l.currency ?? "",
  band: l.budgetBand ?? "",
  timeline: l.timeline ?? "",
});

/**
 * What was asked, in the internal lead alert's words (packages/email leadAlert), plus the consent record, read-only. A manual lead's
 * currency, budget and timeline can be edited here (FX-3, A3 8); a website lead's are the visitor's own and stay as given.
 */
function Enquiry({
  lead,
  canEdit,
  answers,
  onAnswers,
  onOpen,
  busy,
  error,
  onCancel,
  onSave,
}: {
  lead: LeadDetail;
  canEdit: boolean;
  answers: AnswersDraft | null;
  onAnswers: (a: AnswersDraft | null) => void;
  /** Opens the edit (from the stored answers) and moves the focus into it. */
  onOpen: () => void;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (base: Answers, value: Answers) => void;
}) {
  const editing = answers !== null;
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
  if (!editing) {
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
  }
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
        <div className="lead-panel__head">
          <h2 id="enquiry-h" className="lead-panel__title">
            Enquiry
          </h2>
          {canEdit && !editing && (
            <button type="button" id="lead-answers-edit" className="btn btn--text" onClick={onOpen}>
              <Pencil size={16} />
              Edit<span className="visually-hidden"> enquiry</span>
            </button>
          )}
        </div>
        {answers && (
          <form
            className="lead-answers"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              onSave(answers.base, answers.value);
            }}
          >
            {error && <Notice tone="error">{error}</Notice>}
            <AnswersFields
              idPrefix="lead"
              value={answers.value}
              onChange={(value) => onAnswers({ ...answers, value })}
            />
            <div className="lead-panel__actions">
              <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={busy}
                aria-busy={busy || undefined}
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        )}
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
  // Each "Show older" request's number: only the latest one may show its answer or end the loading state.
  const asked = useRef(0);
  // A reload brings a new first page (fix round 2: the view is no longer started again): older pages and the cursor start over from
  // it, so a new entry that pushed one off the first page never leaves a gap before "Show older".
  const [first, setFirst] = useState(props.first);
  if (first !== props.first) {
    setFirst(props.first);
    setOlder([]);
    setNext(props.first.next);
    setError(null);
    // A "Show older" still on its way belongs to the old page (fix round 3, 6): the button is ready again at once, and that answer,
    // whenever it comes, changes nothing (`asked` below).
    setLoading(false);
    // and that answer is no longer the latest, even in the moment before the effect below records the new first page (re-check of
    // round 3, L3)
    asked.current++;
  }
  const items = [...props.first.items, ...older.filter((o) => !props.first.items.some((f) => f.id === o.id))];
  const now = Date.now();
  const titleId = useId();

  // The first page an answer belongs to: a page that arrives after a reload replaced it is dropped (its cursor is the old one's).
  const shownFirst = useRef(props.first);
  useEffect(() => {
    shownFirst.current = props.first;
  }, [props.first]);

  async function more() {
    if (!next) return;
    const from = props.first;
    const ask = ++asked.current;
    const current = () => asked.current === ask && shownFirst.current === from;
    setLoading(true);
    setError(null);
    try {
      const r = await api.leadActivities(props.leadId, next);
      if (!current()) return;
      setOlder((o) => [...o, ...r.items]);
      setNext(r.next);
    } catch (e) {
      if (current()) setError(`Older entries didn't load. ${errorText(e)}`);
    } finally {
      if (asked.current === ask) setLoading(false);
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
  return answerText(field, String(value));
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
