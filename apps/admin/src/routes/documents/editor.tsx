// A draft proposal or estimate (M4.3, ADM-PROP-01..05, ADM-APR-01..02, ADM-G-04): the details, the lines, the totals with the tax
// preview, the payment schedule and the sections, with the send panel beside them. Every change saves itself a moment after the person
// stops typing, through PATCH with only the parts that changed; the answer's figures (totals, each line's tax, the instalments, the
// discount guard, the approval, what still stops a send) are put beside what was typed without touching the text. Someone else's save
// shows the "saved at the same moment" notice and stops saving until the latest is loaded.
import { istDate } from "@techaust/core/dates";
import { validUntil } from "@techaust/core/documents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, RequestError } from "../../api.ts";
import { PageHeader } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { FileText, Info, RefreshCw, Trash } from "../../components/icons.tsx";
import { StaleNotice, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { allowed } from "../../lib/access.ts";
import {
  buildPatch,
  DOC_COPY,
  DOC_ERRORS,
  DOC_PENDING,
  DOC_TOASTS,
  dayText,
  docErrorText,
  type EditorAction,
  type EditorState,
  editor,
  fieldErrors,
  formatIstDay,
  GAP_COPY,
  gapGroups,
  initEditor,
  isDirty,
  newerTerms,
  notSaved,
  sentAs,
  TYPE_LABELS,
  titleOf,
  unresolvedItems,
  validFor,
  waitForInflight,
} from "../../lib/documents.ts";
import { type DocumentView, documentsApi } from "../../lib/documents-api.ts";
import { OFFER_COPY } from "../../lib/offers.ts";
import { useUser } from "../../session.tsx";
import { DiscardDialog, RequestDialog } from "./dialogs.tsx";
import { LinesPanel } from "./lines.tsx";
import { TaxPreview } from "./money.tsx";
import { crumbsFor, DocPill } from "./parts.tsx";
import { SchedulePanel } from "./schedule.tsx";
import { SectionsPanel } from "./sections.tsx";
import { SendDialog } from "./send-dialog.tsx";
import { SendPanel, VersionsPanel } from "./side.tsx";

/** 07-O's stale_version sentence, its first sentence as the notice's title and the rest as its body. */
const STALE = ((t: string) => {
  const i = t.indexOf(". ");
  return [t.slice(0, i + 1), t.slice(i + 2)] as const;
})(DOC_ERRORS.stale_version);

/** The last valid day if the draft were sent today (the send's own rule, core `validUntil`), for the email preview; null while the days are not valid. */
function sendValidUntil(days: string): string | null {
  const n = Number(days);
  return Number.isInteger(n) && n >= 1 && n <= 90 ? dayText(validUntil(istDate(Date.now()), n)) : null;
}

/** How long after the last keystroke a draft saves itself (lead, review fix 2: fewer D1 writes); leaving a field saves at once. */
const AUTOSAVE_MS = 3000;

export function DraftEditor({ view, reload }: { view: DocumentView; reload: () => void }) {
  const user = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [s, setS] = useState<EditorState>(() => initEditor(view));
  // The newest state, also between renders: a save builds its request from it, and a send waits for it.
  const ref = useRef(s);
  const dispatch = useCallback((a: EditorAction) => {
    ref.current = editor(ref.current, a);
    setS(ref.current);
  }, []);
  const inflight = useRef<Promise<unknown> | null>(null);
  // Stable readers of the newest lists, so the memoised panels are not drawn again by a new function each render.
  const currentLines = useCallback(() => ref.current.lines, []);
  const currentSteps = useCallback(() => ref.current.schedule, []);
  const currentSections = useCallback(() => ref.current.sections, []);
  const [dialog, setDialog] = useState<"send" | "request" | "discard" | null>(null);
  const canWrite = allowed(user.role, "proposals.draft");
  const canSendRole = allowed(user.role, "proposals.send");
  const save = useCallback(async (): Promise<boolean> => {
    // Every request in flight, not only the first one seen (round 4, L5).
    await waitForInflight(inflight);
    const cur = ref.current;
    if (cur.status === "stale" || cur.status === "frozen") return false;
    const b = buildPatch(cur);
    if (!b.ok) {
      dispatch({ type: "invalid", error: b.error });
      return false;
    }
    if (!b.patch) return true;
    // A save the server writes sections in (the first service line fills the service values, a new contact renames the Acceptance text)
    // answers with those sections (`sectionsChanged`), and `applySave` puts them on screen: no second read (review round 2, finding 5).
    dispatch({ type: "saving" });
    const p = documentsApi.save(cur.id, b.patch);
    inflight.current = p;
    try {
      const answer = await p;
      dispatch({ type: "saved", answer, sent: b.sent });
      return true;
    } catch (e) {
      const code = e instanceof RequestError ? e.code : "";
      if (code === "stale_version")
        dispatch({ type: "failed", status: "stale", error: DOC_ERRORS.stale_version });
      else if (code === "frozen" || code === "not_draft")
        dispatch({ type: "failed", status: "frozen", error: DOC_ERRORS.frozen });
      else dispatch({ type: "failed", status: "error", error: docErrorText(e) });
      return false;
    } finally {
      // Only its own promise (review round 3, finding 5): a fill or a save started meanwhile keeps its place, so a later save still waits for it.
      if (inflight.current === p) inflight.current = null;
    }
  }, [dispatch]);

  /** Everything typed is saved; resolves with the `updatedAt` a send or a request must carry, or null when it could not save. */
  const flush = useCallback(async (): Promise<number | null> => {
    await waitForInflight(inflight);
    for (let i = 0; i < 3 && isDirty(ref.current); i++) if (!(await save())) return null;
    const cur = ref.current;
    return cur.status === "stale" || cur.status === "frozen" || isDirty(cur) ? null : cur.updatedAt;
  }, [save]);

  // Autosave: a moment after the last change. A refused input waits for the next change; a stale or sent draft stops saving.
  useEffect(() => {
    if (
      !canWrite ||
      !isDirty(s) ||
      s.saving ||
      s.status === "stale" ||
      s.status === "frozen" ||
      s.status === "error"
    )
      return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [s, save, canWrite]);
  // A refused input is tried again once the person changes something.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each edit (the revisions), not on each save answer
  useEffect(() => {
    if (ref.current.status !== "error" || !isDirty(ref.current)) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [s.rev, save]);
  // Leaving a field saves at once (review fix 2): a focusout anywhere in the editing column. Nothing is sent when nothing changed.
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mainRef.current;
    if (!el || !canWrite) return;
    const onLeave = (e: FocusEvent) => {
      const t = e.target;
      if (
        !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)
      )
        return;
      const cur = ref.current;
      if (!isDirty(cur) || cur.saving || cur.status === "stale" || cur.status === "frozen") return;
      void save();
    };
    el.addEventListener("focusout", onLeave);
    return () => el.removeEventListener("focusout", onLeave);
  }, [canWrite, save]);
  // `section_empty`'s links: open that section and put the cursor in its text.
  const [openSection, setOpenSection] = useState<{ uid: string; n: number } | null>(null);
  const onOpenSection = useCallback(
    (u: string) => setOpenSection((o) => ({ uid: u, n: (o?.n ?? 0) + 1 })),
    [],
  );

  // The send check in plain words and the Catalogue gaps (07-X): worked out from the server's answer and what is on screen now.
  const f = s.figures;
  const holesBlocker = f.blockers.find((b) => b.code === "unresolved_placeholders");
  const holes = useMemo(
    () =>
      holesBlocker
        ? unresolvedItems(holesBlocker, {
            title: s.fields.title,
            lines: s.lines,
            sections: s.sections,
            schedule: s.schedule,
            contactId: s.fields.contactId,
          })
        : [],
    [holesBlocker, s.fields.title, s.lines, s.sections, s.schedule, s.fields.contactId],
  );
  const gaps = useMemo(() => gapGroups(f.gaps, s.sections, s.gapBase), [f.gaps, s.sections, s.gapBase]);
  // "Add a service line" and "Choose a contact": put the cursor on the control that fills the value.
  const onFix = useCallback((fix: "service" | "contact") => {
    const el = document.getElementById(fix === "service" ? "doc-add-catalogue" : "doc-contact");
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  }, []);
  // "Use Catalogue text": everything typed is saved first (the route takes the version it saw); its answer is a save answer whose
  // `sectionsChanged` holds the filled section, applied like a save's (no re-read, so nothing typed meanwhile is lost; review round 2, finding 5).
  // An autosave waits for it (`inflight`), so it never sends the old version. The section is read-only from the click until the answer is on
  // screen (review round 3, finding 4): text typed into it meanwhile would keep the fill off the screen and the next save would overwrite it.
  const [filling, setFilling] = useState<string | null>(null);
  const onFill = useCallback(
    async (sectionId: string) => {
      if (filling) return;
      setFilling(sectionId);
      let p: Promise<unknown> | null = null;
      try {
        const at = await flush();
        if (at === null) {
          toast("error", ref.current.error ?? DOC_ERRORS.stale_version);
          return;
        }
        const before = ref.current;
        const call = documentsApi.fillFromCatalogue(before.id, sectionId, at);
        p = call;
        inflight.current = call;
        const answer = await call;
        const sectionsAt = Object.fromEntries(before.sections.map((x) => [x.uid, x]));
        dispatch({
          type: "saved",
          answer,
          sent: { parts: [], rev: { ...before.rev }, uids: {}, sectionsAt },
        });
        toast("success", GAP_COPY.filled);
      } catch (e) {
        toast("error", docErrorText(e));
      } finally {
        if (p !== null && inflight.current === p) inflight.current = null;
        setFilling(null);
      }
    },
    [dispatch, filling, flush, toast],
  );

  const contacts = useLoad(() => api.clientContacts(view.client.id), view.client.id);
  const live = (contacts.data?.contacts ?? []).filter((c) => c.anonymisedAt === null);
  const chosen = live.find((c) => c.id === s.fields.contactId);
  const title = titleOf(s.fields.title);
  const dirty = isDirty(s);
  const saveLine =
    s.status === "saving"
      ? DOC_COPY.saving
      : (s.status === "error" || s.status === "stale" || s.status === "frozen") && s.error
        ? notSaved(s.error)
        : s.status === "saved"
          ? DOC_COPY.saved
          : dirty
            ? DOC_COPY.saving
            : null;
  const fErr = fieldErrors(s.fields, s.currency);
  const listPath = view.type === "estimate" ? "/estimates" : "/proposals";
  const latestFrozen = view.versions.filter((v) => v.id !== view.id && v.number).at(-1);

  return (
    <>
      <PageHeader
        title={title}
        crumbs={crumbsFor(view.type)}
        status={<DocPill status="draft" approval={f.approval.state} />}
        more={
          canWrite
            ? [
                {
                  label: "Discard draft",
                  icon: <Trash size={16} />,
                  tone: "danger",
                  onSelect: () => setDialog("discard"),
                },
              ]
            : undefined
        }
      />
      <dl className="client-strip doc-strip">
        <div className="client-strip__fact">
          <dt>Client</dt>
          <dd>
            <Link to={`/clients/${encodeURIComponent(view.client.id)}`}>{view.client.name}</Link>{" "}
            <span className="docno">{view.client.code}</span>
          </dd>
        </div>
        <div className="client-strip__fact">
          <dt>{DOC_COPY.type}</dt>
          <dd>
            {TYPE_LABELS[view.type]}, v{view.version}
            {latestFrozen?.number && <span className="docno"> {latestFrozen.number}</span>}
          </dd>
        </div>
        <div className="client-strip__fact">
          <dt>Currency</dt>
          <dd className="docno">{view.currency}</dd>
        </div>
        <div className="client-strip__fact">
          <dt>Created</dt>
          <dd>{formatIstDay(view.createdAt)}</dd>
        </div>
      </dl>

      <div className="doc-page">
        <div className="doc-page__send">
          <SendPanel
            role={user.role}
            guard={f.guard}
            approval={f.approval}
            blockers={f.blockers}
            canSend={f.canSend && !dirty && !s.saving}
            saveStatus={s.status}
            saveLine={saveLine}
            dirty={dirty}
            canWrite={canWrite}
            canSendRole={canSendRole}
            onSend={() => setDialog("send")}
            onRequest={() => setDialog("request")}
            sections={s.sections}
            onOpenSection={onOpenSection}
            type={view.type}
            holes={holes}
            gaps={gaps}
            onFix={onFix}
            onFill={onFill}
            filling={filling}
          />
        </div>

        <div className="doc-page__main" ref={mainRef}>
          {s.status === "stale" && <StaleNotice title={STALE[0]} body={STALE[1]} onReload={reload} />}
          {s.status === "frozen" && (
            <div className="notice notice--info" role="status">
              <Info size={20} />
              <div>
                <p>{DOC_ERRORS.frozen}</p>
                <button type="button" className="btn btn--secondary" onClick={reload}>
                  <RefreshCw size={20} />
                  Reload the latest
                </button>
              </div>
            </div>
          )}
          {!canWrite && <Notice tone="info">{DOC_PENDING.readOnlyDraft}</Notice>}
          {f.needsResave && (
            <div className="notice notice--info" role="status">
              <Info size={20} />
              <div>
                <p>{DOC_COPY.needsResave}</p>
                {canWrite && (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => dispatch({ type: "fields", patch: {} })}
                  >
                    Save
                  </button>
                )}
              </div>
            </div>
          )}
          {f.termsOutdated && f.newestTermsVersion !== null && (
            <div className="notice notice--info" role="status">
              <FileText size={20} />
              <div>
                <p>{newerTerms(f.newestTermsVersion)}</p>
                {canWrite && (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => dispatch({ type: "fields", patch: { refreshTerms: true } })}
                  >
                    {DOC_COPY.useNewerTerms}
                  </button>
                )}
              </div>
            </div>
          )}

          <section className="lead-panel doc-details" aria-labelledby="doc-details-h">
            <h2 id="doc-details-h" className="visually-hidden">
              {DOC_COPY.type}
            </h2>
            <FormField id="doc-title" label="Title">
              {(a) => (
                <input
                  {...a}
                  className="doc-title-in"
                  autoComplete="off"
                  maxLength={200}
                  value={s.fields.title}
                  readOnly={!canWrite}
                  onChange={(e) => dispatch({ type: "fields", patch: { title: e.target.value } })}
                />
              )}
            </FormField>
            <div className="doc-details__row">
              <FormField
                id="doc-contact"
                label={DOC_COPY.sendTo}
                hint={
                  s.fields.contactId === null
                    ? DOC_COPY.noContact
                    : chosen && !chosen.portalAccess
                      ? OFFER_COPY.noPortal
                      : undefined
                }
              >
                {(a) => (
                  <select
                    {...a}
                    value={s.fields.contactId ?? ""}
                    disabled={!canWrite}
                    onChange={(e) =>
                      dispatch({ type: "fields", patch: { contactId: e.target.value || null } })
                    }
                  >
                    <option value="">None</option>
                    {view.contact && !contacts.data?.contacts.some((c) => c.id === view.contact?.id) && (
                      <option value={view.contact.id}>{view.contact.name}</option>
                    )}
                    {/* Finding 14: only a contact with portal access can receive the offer, so those without it are grouped apart, under
                        the send dialog's own words for them. They stay choosable: the name still fills the Acceptance text. */}
                    {live
                      .filter((c) => c.portalAccess)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}, {c.email}
                        </option>
                      ))}
                    {live.some((c) => !c.portalAccess) && (
                      <optgroup label={OFFER_COPY.noPortal}>
                        {live
                          .filter((c) => !c.portalAccess)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}, {c.email}
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </FormField>
              <FormField
                id="doc-validity"
                label="Validity"
                error={
                  fErr.validityDays && (s.showErrors || s.fields.validityDays !== "")
                    ? fErr.validityDays
                    : undefined
                }
                status={
                  !fErr.validityDays && s.fields.validityDays !== ""
                    ? validFor(Number(s.fields.validityDays))
                    : undefined
                }
              >
                {(a) => (
                  <div className="number-unit">
                    <input
                      {...a}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={2}
                      value={s.fields.validityDays}
                      readOnly={!canWrite}
                      onChange={(e) => dispatch({ type: "fields", patch: { validityDays: e.target.value } })}
                    />
                    <span className="number-unit__unit" aria-hidden="true">
                      days
                    </span>
                  </div>
                )}
              </FormField>
            </div>
          </section>

          <LinesPanel
            lines={s.lines}
            figures={f.lines}
            currency={s.currency}
            supply={f.supply}
            warnings={f.warnings}
            showErrors={s.showErrors}
            type={view.type}
            dispatch={dispatch}
            current={currentLines}
          />

          <section className="lead-panel doc-totals" aria-labelledby="doc-totals-h">
            <h2 id="doc-totals-h" className="lead-panel__title">
              {DOC_COPY.total}
            </h2>
            <div className="doc-totals__grid">
              <div className="doc-totals__disc">
                <FormField
                  id="doc-disc"
                  label={DOC_COPY.documentDiscount}
                  optional
                  error={fErr.disc && (s.showErrors || s.fields.disc !== "") ? fErr.disc : undefined}
                >
                  {(a) => (
                    <div className="disc-in">
                      <select
                        aria-label={`${DOC_COPY.documentDiscount}: ${DOC_COPY.fixed} or ${DOC_COPY.percent}`}
                        value={s.fields.discKind}
                        disabled={!canWrite}
                        onChange={(e) =>
                          dispatch({
                            type: "fields",
                            patch: { discKind: e.target.value as "fixed" | "percent" },
                          })
                        }
                      >
                        <option value="percent">{DOC_COPY.percent}</option>
                        <option value="fixed">{DOC_COPY.fixed}</option>
                      </select>
                      <input
                        {...a}
                        className="tnum disc-in__value"
                        inputMode="decimal"
                        autoComplete="off"
                        value={s.fields.disc}
                        readOnly={!canWrite}
                        onChange={(e) => dispatch({ type: "fields", patch: { disc: e.target.value } })}
                      />
                    </div>
                  )}
                </FormField>
              </div>
              <TaxPreview totals={f.totals} supply={f.supply} currency={s.currency} busy={s.saving} />
            </div>
          </section>

          <SchedulePanel
            steps={s.schedule}
            amounts={f.steps}
            currency={s.currency}
            showErrors={s.showErrors}
            dispatch={dispatch}
            current={currentSteps}
          />

          <SectionsPanel
            sections={s.sections}
            dispatch={dispatch}
            current={currentSections}
            openRequest={openSection}
            gaps={gaps}
            onFill={onFill}
            filling={filling}
          />
        </div>

        <div className="doc-page__versions">
          <VersionsPanel versions={view.versions} type={view.type} />
        </div>
      </div>

      <UnsavedChangesGuard dirty={canWrite && (dirty || s.saving)} what="this draft" />

      <SendDialog
        open={dialog === "send"}
        mode="send"
        type={view.type}
        number={view.number ?? null}
        title={title}
        version={view.version}
        totalMinor={f.totals?.totalMinor ?? null}
        currency={s.currency}
        clientId={view.client.id}
        clientName={view.client.name}
        attachPdfDefault={view.attachPdfDefault}
        preferredContactId={s.fields.contactId}
        validUntil={sendValidUntil(s.fields.validityDays)}
        onClose={() => setDialog(null)}
        onSend={async (contactIds, attachPdf) => {
          const at = await flush();
          if (at === null)
            throw new RequestError(409, "stale_version", ref.current.error ?? DOC_ERRORS.stale_version);
          const r = await documentsApi.send(view.id, at, contactIds, attachPdf);
          setDialog(null);
          toast("success", `${sentAs(r.number ?? "", r.version)} ${OFFER_COPY.sentTo(contactIds.length)}`);
          reload();
        }}
      />
      <RequestDialog
        open={dialog === "request"}
        onClose={() => setDialog(null)}
        onSend={async (reason) => {
          const at = await flush();
          if (at === null) throw new RequestError(409, "stale_version", DOC_ERRORS.stale_version);
          const r = await documentsApi.requestApproval(view.id, at, reason || undefined);
          dispatch({
            type: "approval",
            approval: {
              ...ref.current.figures.approval,
              state: "pending",
              id: r.id,
              requestedAt: Date.now(),
              decidedAt: null,
              decidedBy: null,
              decidedByName: null,
              note: null,
            },
          });
          toast("success", DOC_TOASTS.requested);
        }}
      />
      <DiscardDialog
        open={dialog === "discard"}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          // Every request in flight, including one started while waiting (round 4 re-check, finding 5).
          await waitForInflight(inflight);
          await documentsApi.discard(view.id, ref.current.updatedAt);
          // Nothing is left to save: leaving must not ask about unsaved changes.
          ref.current = { ...ref.current, savedRev: { ...ref.current.rev } };
          setS(ref.current);
          setDialog(null);
          toast("success", DOC_TOASTS.discarded);
          setTimeout(() => navigate(listPath), 0);
        }}
      />
    </>
  );
}
