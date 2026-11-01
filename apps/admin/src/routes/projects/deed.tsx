// The project's Deed tab (T11; run file docs/runs/t11-deed.md, L2 to L8; ADM-PRJ-04; 08-C RB-38(a), RB-21), for the Owner and Staff (`deeds.view`).
// The head says where the deed is, on a three-step rail (draft, final, signed: a real sequence) with the one line of what to do next; then, by stage:
//   - no deed (or only cancelled drafts): why not yet, from L2 ("Paid in full" with the documents counted), and the Owner's "Check again";
//   - draft: the Schedules form (Owner and Staff; Schedule 2 takes an explicit "None"), the deed as it would read today, and the Owner's Finalise (fresh code)
//     and Cancel (a reason);
//   - final: the unsigned PDF (download, or "Make the PDF again" while it has none) and the Owner's upload of the copy signed on the eSign provider's website,
//     with the eSign date, time (IST) and transaction ID (fresh code);
//   - signed: the signed copy, its eSign details and both downloads.
// A final or signed deed whose project is no longer paid in full shows a warning; nothing changes on its own (L4). Every figure is the server's, formatted by
// core money; the deed's words are core `deedText`'s (07-ZE); the screen's words are 07-ZJ's (marked until approved). The side column holds the actions, the
// record and the cancelled drafts; on a phone it follows the main column.
import { formatIstDateTime } from "@techaust/core";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  deedsApi,
  ensureStepUp,
  errorText,
  RequestError,
  sha256Hex,
  stepUpActive,
  uploadSignedDeed,
} from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { type PillTone, StatusPill } from "../../components/display.tsx";
import { ErrorSummary, FormField } from "../../components/form.tsx";
import {
  AlertTriangle,
  Download,
  FileText,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash,
  Upload,
  X,
} from "../../components/icons.tsx";
import { LoadFailed, StaleNotice, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { dateError } from "../../lib/date-field.ts";
import {
  blockerLines,
  DEED_COPY as C,
  type DeedPage,
  type DeedRecord,
  type DeedStage,
  type DeedTextView,
  deedMoney,
  deedPdfWaiting,
  ESIGN_TIME,
  esignAtValue,
  formOf,
  offerKindOf,
  problemLines,
  RAIL,
  railIndex,
  type SchedulesErrors,
  type SchedulesForm,
  sameSchedules,
  schedulesBody,
  schedulesErrors,
  stageOf,
} from "../../lib/deeds.ts";
import { typeLabel } from "../../lib/invoices.ts";
import { PDF_POLL_MS } from "../../lib/pdf.ts";
import { withCode } from "../../lib/step-up.ts";
import "../../deeds.css";

/** The deed's one-line status under the heading, by stage. */
const ledeOf = (stage: DeedStage, page: DeedPage): string => {
  switch (stage) {
    case "waiting":
      return C.lede.waiting;
    case "qualifies":
      return C.lede.qualifies;
    case "draft":
      return C.lede.draft;
    case "final":
      return C.lede.final;
    case "signed":
      return C.lede.signed(offerKindOf(page.deed?.text ?? null));
    case "cancelled":
      return C.lede.cancelled;
  }
};

const PILL: Record<
  DeedStage,
  { tone: PillTone; icon: "pencil" | "fileCheck" | "check" | "xCircle" | "clock"; text: string }
> = {
  waiting: { tone: "muted", icon: "clock", text: C.states.none },
  qualifies: { tone: "muted", icon: "clock", text: C.states.none },
  draft: { tone: "neutral", icon: "pencil", text: C.states.draft },
  final: { tone: "info", icon: "fileCheck", text: C.states.final },
  signed: { tone: "success", icon: "check", text: C.states.signed },
  cancelled: { tone: "muted", icon: "xCircle", text: C.states.cancelled },
};

const day = (ms: number | null) => (ms === null ? "" : (formatIstDateTime(ms).split(",")[0] ?? ""));

export function DeedTab({ projectId }: { projectId: string }) {
  const page = useLoad(() => deedsApi.get(projectId), projectId);
  if (page.state === "loading") return <DeedSkeleton />;
  if (page.state === "failed")
    return <LoadFailed error={page.error} onRetry={() => page.reload()} headingLevel={2} />;
  return <DeedView page={page.data} reload={() => page.reload(true)} />;
}

function DeedSkeleton() {
  return (
    <div className="deed-tab" aria-busy="true">
      <p className="visually-hidden" role="status">
        {C.loading}
      </p>
      <div className="lead-panel deed-head" aria-hidden="true">
        <span className="skeleton" style={{ width: "30%" }} />
        <span className="skeleton" style={{ width: "70%" }} />
        <span className="skeleton" style={{ width: "50%" }} />
      </div>
      <div className="lead-page" aria-hidden="true">
        <div className="lead-page__main">
          <div className="lead-panel stack-sm">
            <span className="skeleton" style={{ width: "25%" }} />
            <span className="skeleton" style={{ width: "90%" }} />
            <span className="skeleton" style={{ width: "80%" }} />
          </div>
        </div>
        <div className="lead-page__side">
          <div className="lead-panel stack-sm">
            <span className="skeleton" style={{ width: "40%" }} />
            <span className="skeleton" style={{ width: "70%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Review M3: while a final or signed deed waits for its unsigned PDF, the tab reads the deed again (quietly) every 10 seconds for 5 minutes from `since`,
 * the documents' rule (`PDF_POLL_MS`, `pdfPhase` through `deedPdfWaiting`); it stops once the PDF is there or the 5 minutes are over. A failed read keeps the
 * page as it was (the quiet reload of `useLoad`). The latest `reload` is kept in a ref, so a re-render never restarts the wait.
 */
function useDeedPdfWait(deed: DeedRecord | null, since: number | null, reload: () => void) {
  const latest = useRef(reload);
  latest.current = reload;
  const waiting = deedPdfWaiting(deed, since, Date.now());
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (deedPdfWaiting(deed, since, Date.now())) latest.current();
      else window.clearInterval(timer);
    }, PDF_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, deed, since]);
}

function DeedView({ page, reload }: { page: DeedPage; reload: () => void }) {
  const stage = stageOf(page);
  const d = page.deed;
  const [stale, setStale] = useState(false);
  const [dirty, setDirty] = useState(false);
  // The wait for the unsigned PDF starts at the finalise, and again at each "Make the PDF again".
  const [askedAt, setAskedAt] = useState<number | null>(null);
  useDeedPdfWait(d, askedAt ?? d?.finalisedAt ?? null, reload);
  const onStale = () => setStale(true);
  const live = stage === "draft" || stage === "final" || stage === "signed";
  return (
    <div className="deed-tab">
      <UnsavedChangesGuard dirty={dirty && !stale} what="the deed's Schedules" />
      <DeedHead page={page} stage={stage} />
      {stale && (
        <StaleNotice
          title={C.stale}
          onReload={() => {
            setStale(false);
            setDirty(false);
            reload();
          }}
        />
      )}
      <div className="lead-page">
        <div className="lead-page__main">
          {stage === "draft" && d && (
            <SchedulesPanel
              key={`${d.id}:${d.updatedAt}`}
              deed={d}
              canEdit={page.can.editSchedules}
              reload={reload}
              onStale={onStale}
              onDirty={setDirty}
            />
          )}
          {live && d && <ReadTheDeed deed={d} />}
          {!live && <PaidPanel page={page} />}
        </div>
        {/* With a live deed the side column holds what to do next, then the record and "Paid in full": on a phone the actions come straight after the
            form or the deed, before the figures. */}
        <div className="lead-page__side">
          <ActionsPanel
            page={page}
            stage={stage}
            reload={reload}
            onStale={onStale}
            onAskedPdf={() => setAskedAt(Date.now())}
          />
          {d && (stage === "final" || stage === "signed") && <RecordPanel deed={d} />}
          {live && <PaidPanel page={page} />}
          {page.history.length > 0 && <HistoryPanel page={page} />}
        </div>
      </div>
    </div>
  );
}

// ---- the head: heading, state, number, rail, the next step --------------------------------------------------------------------------------------------------

function DeedHead({ page, stage }: { page: DeedPage; stage: DeedStage }) {
  const p = PILL[stage];
  const at = railIndex(stage);
  const d = page.deed;
  return (
    <section className="lead-panel deed-head" aria-labelledby="deed-h">
      <div className="deed-head__top">
        <h2 id="deed-h" className="deed-head__title">
          {C.heading}
        </h2>
        <StatusPill tone={p.tone} icon={p.icon}>
          {p.text}
        </StatusPill>
        {d?.number && <span className="docno deed-head__number">{d.number}</span>}
      </div>
      <ol className="deed-rail" aria-label={C.heading}>
        {RAIL.map((s, i) => {
          const state =
            stage === "cancelled" && i === 0 ? "stopped" : i < at ? "done" : i === at ? "here" : "next";
          return (
            <li
              key={s}
              className={`deed-rail__step deed-rail__step--${state}`}
              aria-current={state === "here" ? "step" : undefined}
            >
              <span className="deed-rail__node" aria-hidden="true" />
              <span className="deed-rail__label">{C.states[s]}</span>
            </li>
          );
        })}
      </ol>
      <p className="deed-head__lede">{ledeOf(stage, page)}</p>
      {page.clientAnonymised && <Notice tone="info">{C.blockers.client_anonymised}</Notice>}
      {d?.notFullyPaid && (
        <div className="notice deed-warn" role="status">
          <AlertTriangle size={20} />
          <div>{C.notFullyPaid}</div>
        </div>
      )}
    </section>
  );
}

// ---- paid in full ------------------------------------------------------------------------------------------------------------------------------------------

function PaidPanel({ page }: { page: DeedPage }) {
  const e = page.eligibility;
  const kind = offerKindOf(page.deed?.text ?? null);
  const paid = !e.blockers.some(
    (b) => b === "balance_due" || b === "short_paid" || b === "no_invoices" || b === "nothing_paid",
  );
  const lines = blockerLines(e.blockers);
  const showLines = page.deed === null || page.deed.status === "cancelled";
  return (
    <section className="lead-panel deed-paid" aria-labelledby="deed-paid-h">
      <div className="deed-paid__top">
        <h2 id="deed-paid-h" className="lead-panel__title">
          {C.paid.heading}
        </h2>
        <StatusPill tone={paid ? "success" : "warning"} icon={paid ? "check" : "clock"} outline={!paid}>
          {paid ? C.paid.yes : C.paid.no}
        </StatusPill>
      </div>
      {showLines && lines.length > 0 && (
        <ul className="deed-reasons">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {/* Without an accepted proposal or estimate there is no total to measure against: the figures would all be dashes. */}
      {e.acceptedTotalMinor !== null && (
        <dl className="deed-figures">
          <div className="deed-figures__row">
            <dt>{C.paid.accepted(kind)}</dt>
            <dd>{deedMoney(e.acceptedTotalMinor, e.currency)}</dd>
          </div>
          {e.creditedMinor > 0 && (
            <div className="deed-figures__row">
              <dt>{C.paid.credited}</dt>
              <dd>{deedMoney(-e.creditedMinor, e.currency)}</dd>
            </div>
          )}
          <div className="deed-figures__row deed-figures__row--sum">
            <dt>{C.paid.owed}</dt>
            <dd>{deedMoney(e.targetMinor, e.currency)}</dd>
          </div>
          <div className="deed-figures__row">
            <dt>{C.paid.settled}</dt>
            <dd>{deedMoney(e.settledMinor, e.currency)}</dd>
          </div>
          <div className="deed-figures__row deed-figures__row--total">
            <dt>{C.paid.short}</dt>
            <dd>{deedMoney(e.shortfallMinor, e.currency)}</dd>
          </div>
        </dl>
      )}
      {/* With no invoice, the reasons above already say so ("No issued invoice is linked…"): the table's part is left out rather than said twice. */}
      {(page.documents.length > 0 || !(showLines && e.blockers.includes("no_invoices"))) && (
        <>
          <h3 className="deed-sub">{C.docs.heading}</h3>
          {page.documents.length === 0 ? (
            <p className="panel-empty">{C.blockers.no_invoices}</p>
          ) : (
            <table className="deed-docs">
              <caption className="visually-hidden">{C.docs.heading}</caption>
              <thead>
                <tr>
                  <th scope="col">{C.docs.invoice}</th>
                  <th scope="col" className="num">
                    {C.docs.total}
                  </th>
                  <th scope="col" className="num">
                    {C.docs.paid}
                  </th>
                  <th scope="col" className="num">
                    {C.docs.credited}
                  </th>
                  <th scope="col" className="num">
                    {C.docs.balance}
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.documents.map((doc) => (
                  <tr key={doc.id} className={doc.counted ? undefined : "deed-docs__other"}>
                    <th scope="row">
                      <Link to={`/invoices/${encodeURIComponent(doc.id)}`} className="docno deed-docs__link">
                        {doc.number ?? doc.id}
                      </Link>
                      <span className="deed-docs__type">{typeLabel(doc.type)}</span>
                      {!doc.counted && (
                        <span className="deed-docs__type">{C.docs.notCounted(doc.currency)}</span>
                      )}
                    </th>
                    <td className="num tnum" data-label={C.docs.total}>
                      {deedMoney(doc.totalMinor, doc.currency)}
                    </td>
                    <td className="num tnum" data-label={C.docs.paid}>
                      {deedMoney(doc.settledMinor, doc.currency)}
                    </td>
                    <td className="num tnum" data-label={C.docs.credited}>
                      {deedMoney(doc.creditedMinor, doc.currency)}
                    </td>
                    <td className="num tnum" data-label={C.docs.balance}>
                      {deedMoney(doc.balanceMinor, doc.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint deed-paid__note">{C.docs.note}</p>
        </>
      )}
    </section>
  );
}

// ---- the Schedules -----------------------------------------------------------------------------------------------------------------------------------------

type DateKey = `date-${number}`;

function SchedulesPanel(props: {
  deed: DeedRecord;
  canEdit: boolean;
  reload: () => void;
  onStale: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const toast = useToast();
  const base = useRef(formOf(props.deed.schedules));
  const [form, setForm] = useState<SchedulesForm>(base.current);
  const [errors, setErrors] = useState<SchedulesErrors>({});
  const [summaryKey, setSummaryKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const dates = useUnreadDates<DateKey>();
  const dirty = dates.any || !sameSchedules(form, base.current);
  const { onDirty } = props;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  if (!props.canEdit) return <SchedulesRead deed={props.deed} />;

  const set = (patch: Partial<SchedulesForm>) => setForm((f) => ({ ...f, ...patch }));
  const dateErr = dateError(dates.any);

  async function save(e: FormEvent) {
    e.preventDefault();
    const found = schedulesErrors(form, false);
    setErrors(found);
    if (Object.keys(found).length > 0 || dateErr) {
      setSummaryKey((k) => k + 1);
      return;
    }
    setBusy(true);
    setRefused(null);
    try {
      await deedsApi.saveSchedules(props.deed.id, {
        ...schedulesBody(form),
        expectedUpdatedAt: props.deed.updatedAt,
      });
      toast("success", C.schedules.saved);
      onDirty(false);
      props.reload();
    } catch (err) {
      if (err instanceof RequestError && err.code === "stale_version") props.onStale();
      else setRefused(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const summary = [
    ...Object.entries(errors).map(([k, text]) => ({ id: `deed-${k}`, text: text as string })),
    ...(dateErr ? [{ id: "deed-date-0", text: dateErr }] : []),
  ];

  const none = (field: "tools" | "thirdParty") => (
    <button
      type="button"
      className="btn btn--secondary deed-none"
      aria-pressed={form[field].trim() === "None"}
      onClick={() => set({ [field]: "None" })}
    >
      {C.schedules.none}
    </button>
  );

  return (
    <section className="lead-panel deed-sched" aria-labelledby="deed-sched-h">
      <h2 id="deed-sched-h" className="visually-hidden">
        {`${C.schedules.s1}, ${C.schedules.s2}`}
      </h2>
      <form onSubmit={save} noValidate>
        <ErrorSummary errors={summary} focusKey={summaryKey} />
        <p className="hint deed-sched__all">{C.schedules.allNeeded}</p>
        {refused && <Notice tone="error">{refused}</Notice>}
        <fieldset className="deed-sched__set">
          <legend className="deed-sched__legend">{C.schedules.s1}</legend>
          <FormField
            id="deed-deliverables"
            label={C.schedules.deliverables}
            hint={C.schedules.deliverablesHint}
            error={errors.deliverables}
          >
            {(a) => (
              <textarea
                {...a}
                rows={4}
                value={form.deliverables}
                onChange={(e) => set({ deliverables: e.target.value })}
              />
            )}
          </FormField>
          <FormField
            id="deed-location"
            label={C.schedules.location}
            hint={C.schedules.locationHint}
            error={errors.location}
          >
            {(a) => (
              <input
                {...a}
                autoComplete="off"
                value={form.location}
                onChange={(e) => set({ location: e.target.value })}
              />
            )}
          </FormField>
          <fieldset className="field deed-dates" aria-describedby="deed-dates-hint">
            <legend className="deed-dates__label" id="deed-dates-label">
              {C.schedules.dates}
            </legend>
            <p className="hint deed-dates__hint" id="deed-dates-hint">
              {C.schedules.datesHint}
            </p>
            {form.datesText !== null && <p className="deed-dates__kept">{form.datesText}</p>}
            <ul className="deed-dates__list">
              {form.dates.map((v, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the fields are positions in a short list the person edits in place
                <li key={i} className="deed-dates__row">
                  <label className="visually-hidden" htmlFor={`deed-date-${i}`} id={`deed-date-${i}-label`}>
                    {`${C.schedules.dates} ${i + 1}`}
                  </label>
                  <DateField
                    id={`deed-date-${i}`}
                    value={v}
                    onChange={(iso) => {
                      const next = [...form.dates];
                      next[i] = iso;
                      set({ dates: next, datesText: null });
                    }}
                    aria-describedby={errors.deliveredDates ? "deed-deliveredDates-error" : undefined}
                    {...dates.bind(`date-${i}`)}
                  />
                  {form.dates.length > 1 && (
                    <button
                      type="button"
                      className="icon-btn deed-dates__remove"
                      aria-label={C.schedules.removeDate(v || String(i + 1))}
                      onClick={() => set({ dates: form.dates.filter((_, j) => j !== i), datesText: null })}
                    >
                      <X size={20} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {form.dates.length < 12 && (
              <button
                type="button"
                className="btn btn--text deed-dates__add"
                onClick={() => set({ dates: [...form.dates, ""] })}
              >
                <Plus size={20} />
                {C.schedules.addDate}
              </button>
            )}
            {errors.deliveredDates && (
              <p className="field-error" id="deed-deliveredDates-error">
                <AlertTriangle size={16} />
                {errors.deliveredDates}
              </p>
            )}
          </fieldset>
        </fieldset>
        <fieldset className="deed-sched__set">
          <legend className="deed-sched__legend">{C.schedules.s2}</legend>
          <p className="hint deed-sched__none-hint">{C.schedules.noneHint}</p>
          <FormField
            id="deed-tools"
            label={C.schedules.tools}
            hint={C.schedules.toolsHint}
            error={errors.tools}
          >
            {(a) => (
              <div className="deed-with-none">
                <textarea
                  {...a}
                  rows={3}
                  value={form.tools}
                  onChange={(e) => set({ tools: e.target.value })}
                />
                {none("tools")}
              </div>
            )}
          </FormField>
          <FormField
            id="deed-thirdParty"
            label={C.schedules.thirdParty}
            hint={C.schedules.thirdPartyHint}
            error={errors.thirdParty}
          >
            {(a) => (
              <div className="deed-with-none">
                <textarea
                  {...a}
                  rows={4}
                  value={form.thirdParty}
                  onChange={(e) => set({ thirdParty: e.target.value })}
                />
                {none("thirdParty")}
              </div>
            )}
          </FormField>
        </fieldset>
        <div className="deed-sched__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !dirty}
            aria-busy={busy || undefined}
          >
            {C.schedules.save}
          </button>
        </div>
      </form>
    </section>
  );
}

/** The Schedules read only (a role that can read a draft but not edit it). */
function SchedulesRead({ deed }: { deed: DeedRecord }) {
  const s = deed.schedules;
  const row = (label: string, v: string | null) => (
    <div className="deed-figures__row deed-figures__row--text">
      <dt>{label}</dt>
      <dd>{v ?? "—"}</dd>
    </div>
  );
  return (
    <section className="lead-panel" aria-labelledby="deed-sched-h">
      <h2 id="deed-sched-h" className="lead-panel__title">
        {C.schedules.s1}
      </h2>
      <dl className="deed-figures">
        {row(C.schedules.deliverables, s.deliverables)}
        {row(C.schedules.location, s.location)}
        {row(C.schedules.dates, s.deliveredDates)}
      </dl>
      <h2 className="lead-panel__title deed-sched__second">{C.schedules.s2}</h2>
      <dl className="deed-figures">
        {row(C.schedules.tools, s.tools)}
        {row(C.schedules.thirdParty, s.thirdParty)}
      </dl>
    </section>
  );
}

// ---- the deed's text ---------------------------------------------------------------------------------------------------------------------------------------

function ReadTheDeed({ deed }: { deed: DeedRecord }) {
  const problems = deed.preview && !deed.preview.ok ? problemLines(deed.preview.problems) : [];
  // A final or signed deed opens on wide screens (the deed beside its actions, as the portal shows a document); a draft, and every phone, starts closed so
  // the form and the actions come first. Decided once, when the tab opens; the person's own toggling wins after that.
  const [open] = useState(
    () =>
      deed.status !== "draft" &&
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 64rem)").matches,
  );
  return (
    <section className="lead-panel deed-read" aria-labelledby="deed-read-h">
      <details className="deed-read__details" open={open || undefined}>
        <summary className="deed-read__summary">
          <FileText size={20} />
          <h2 id="deed-read-h" className="deed-read__title">
            {C.read.heading}
          </h2>
        </summary>
        {deed.status === "draft" && <p className="hint deed-read__note">{C.read.draftNote}</p>}
        {deed.text ? (
          <DeedSheet text={deed.text} />
        ) : (
          <>
            <p className="deed-read__cannot">{C.read.cannot}</p>
            <ul className="deed-reasons">
              {problems.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  );
}

/** 07-ZE's text as the PDF sets it, on screen: the title and number, the parties, the eight clauses, the signature sentence, the Schedules, the stamp line. */
function DeedSheet({ text }: { text: DeedTextView }) {
  const at = text.title.lastIndexOf(" · ");
  const title = at < 0 ? text.title : text.title.slice(0, at);
  const number = at < 0 ? "" : text.title.slice(at + 3);
  const numbered = number.trim() !== "No.";
  return (
    <article className="deed-sheet" aria-label={title}>
      <p className="deed-sheet__title">{title}</p>
      {numbered && <p className="deed-sheet__number docno">{number}</p>}
      <p className="deed-sheet__parties">
        {text.parties.map((r, i) =>
          // biome-ignore lint/suspicious/noArrayIndexKey: the runs are a fixed sentence, in order
          r.bold ? <strong key={i}>{r.text}</strong> : <span key={i}>{r.text}</span>,
        )}
      </p>
      <ol className="deed-sheet__clauses">
        {text.clauses.map((c) => (
          <li key={c.n} className="deed-sheet__clause">
            <span className="deed-sheet__n">{c.n}.</span>
            <p>
              <strong>{c.heading}</strong> {c.body}
            </p>
          </li>
        ))}
      </ol>
      <p className="deed-sheet__sign">
        {text.signatureLead.endsWith(".") ? text.signatureLead : `${text.signatureLead}.`}
      </p>
      <SheetSchedule
        heading={text.schedule1.heading}
        rows={[
          [C.schedules.deliverables, text.schedule1.deliverables],
          [C.schedules.location, text.schedule1.location],
          [C.schedules.dates, text.schedule1.deliveredDates],
        ]}
      />
      <SheetSchedule
        heading={text.schedule2.heading}
        rows={[
          [C.schedules.tools, text.schedule2.tools],
          [C.schedules.thirdParty, text.schedule2.thirdParty],
        ]}
      />
      <p className="deed-sheet__footer">{text.footer}</p>
    </article>
  );
}

/** A Schedule with 07-ZJ line 2's labels, as the PDF prints it. */
function SheetSchedule({ heading, rows }: { heading: string; rows: [string, string][] }) {
  return (
    <div className="deed-sheet__sched">
      <p className="deed-sheet__sched-title">{heading}</p>
      <dl className="deed-sheet__rows">
        {rows.map(([label, v]) => (
          <div key={label} className="deed-sheet__row">
            <dt>{label}</dt>
            <dd className="deed-sheet__value">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---- the actions -------------------------------------------------------------------------------------------------------------------------------------------

function ActionsPanel(props: {
  page: DeedPage;
  stage: DeedStage;
  reload: () => void;
  onStale: () => void;
  /** "Make the PDF again" was accepted: the tab waits for the PDF again from now. */
  onAskedPdf: () => void;
}) {
  const { page, stage } = props;
  const d = page.deed;
  if (stage === "final" && d) return <FinalActions {...props} deed={d} />;
  if (stage === "signed" && d) return <SignedPanel deed={d} />;
  if (stage === "draft" && d) return <DraftActions {...props} deed={d} />;
  if (!page.can.recheck) return null;
  return <RecheckPanel projectId={page.project.id} reload={props.reload} />;
}

function RecheckPanel({ projectId, reload }: { projectId: string; reload: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  async function recheck() {
    setBusy(true);
    try {
      const r = await deedsApi.recheck(projectId);
      const line = r.created ? C.recheck.made : C.recheck.none;
      setSaid(line);
      toast(r.created ? "success" : "error", line);
      if (r.created) reload();
    } catch (e) {
      toast("error", errorText(e));
      setSaid(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="lead-panel deed-actions" aria-labelledby="deed-act-h">
      <h2 id="deed-act-h" className="visually-hidden">
        {C.recheck.button}
      </h2>
      <button
        type="button"
        className="btn btn--secondary btn--block"
        onClick={recheck}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        <RefreshCw size={20} />
        {C.recheck.button}
      </button>
      <p className="deed-actions__said" role="status">
        {said}
      </p>
    </section>
  );
}

function DraftActions(props: { page: DeedPage; deed: DeedRecord; reload: () => void; onStale: () => void }) {
  const { page, deed } = props;
  const toast = useToast();
  const [asking, setAsking] = useState<"finalise" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const problems = deed.preview && !deed.preview.ok ? problemLines(deed.preview.problems) : [];
  const blockers = page.eligibility.eligible ? [] : blockerLines(page.eligibility.blockers);
  const ready = problems.length === 0 && blockers.length === 0;
  const needsCode = !stepUpActive();
  if (!page.can.finalise && !page.can.cancel) return null;

  async function finalise(code?: string) {
    try {
      const r = await withCode(needsCode ? code : undefined, () =>
        deedsApi.finalise(deed.id, deed.updatedAt),
      );
      toast("success", C.finalise.done(r.number ?? ""));
      props.reload();
    } catch (e) {
      if (e instanceof RequestError && e.code === "stale_version") {
        setAsking(null);
        props.onStale();
        return undefined;
      }
      throw e;
    }
    return undefined;
  }

  async function cancel() {
    if (reason.trim() === "") {
      setReasonError(C.cancel.noReason);
      document.getElementById("deed-cancel-reason")?.focus();
      throw new Error(C.cancel.noReason);
    }
    try {
      await deedsApi.cancel(deed.id, deed.updatedAt, reason.trim());
      toast("success", C.cancel.done);
      props.reload();
    } catch (e) {
      if (e instanceof RequestError && e.code === "stale_version") {
        setAsking(null);
        props.onStale();
        return undefined;
      }
      throw e;
    }
    return undefined;
  }

  return (
    <section className="lead-panel deed-actions" aria-labelledby="deed-act-h">
      <h2 id="deed-act-h" className="lead-panel__title">
        {C.finalise.title}
      </h2>
      {!ready && (
        <ul className="deed-reasons deed-reasons--tight">
          {[...blockers, ...problems].map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {page.can.finalise && (
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={!ready}
          onClick={() => setAsking("finalise")}
        >
          {C.finalise.button}
        </button>
      )}
      {page.can.cancel && (
        <button
          type="button"
          className="btn btn--text deed-actions__cancel"
          onClick={() => setAsking("cancel")}
        >
          <Trash size={20} />
          {C.cancel.button}
        </button>
      )}
      <ConfirmDialog
        open={asking === "finalise"}
        title={C.finalise.title}
        confirmLabel={C.finalise.button}
        stepUp={needsCode}
        onClose={() => setAsking(null)}
        onConfirm={finalise}
      >
        <p>{C.finalise.body}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === "cancel"}
        title={C.cancel.title}
        tone="danger"
        confirmLabel={C.cancel.button}
        onClose={() => {
          setAsking(null);
          setReason("");
          setReasonError(null);
        }}
        onConfirm={cancel}
      >
        <p>{C.cancel.body}</p>
        <FormField id="deed-cancel-reason" label={C.cancel.reason} error={reasonError}>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError && e.target.value.trim() !== "") setReasonError(null);
              }}
            />
          )}
        </FormField>
      </ConfirmDialog>
    </section>
  );
}

function FinalActions(props: {
  page: DeedPage;
  deed: DeedRecord;
  reload: () => void;
  onStale: () => void;
  onAskedPdf: () => void;
}) {
  const { page, deed } = props;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  async function renderAgain() {
    setBusy(true);
    try {
      await deedsApi.renderPdf(deed.id);
      setAsked(true);
      props.onAskedPdf();
      toast("success", C.pdf.retried);
    } catch (e) {
      if (e instanceof RequestError && e.code === "pdf_done") {
        toast("success", C.pdf.done);
        props.reload();
      } else toast("error", errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="lead-panel deed-actions" aria-labelledby="deed-pdf-h">
        <h2 id="deed-pdf-h" className="lead-panel__title">
          {C.pdf.heading}
        </h2>
        {deed.unsignedPdf ? (
          <a className="btn btn--secondary btn--block" href={deedsApi.unsignedHref(deed.id)} download>
            <Download size={20} />
            {C.pdf.download}
          </a>
        ) : (
          <>
            <p className="deed-actions__said" role="status">
              {C.pdf.making}
            </p>
            {page.can.renderPdf && !asked && (
              <button
                type="button"
                className="btn btn--secondary btn--block"
                onClick={renderAgain}
                disabled={busy}
                aria-busy={busy || undefined}
              >
                <RotateCcw size={20} />
                {C.pdf.again}
              </button>
            )}
          </>
        )}
      </section>
      {page.can.uploadSigned && <UploadSigned deed={deed} reload={props.reload} onStale={props.onStale} />}
    </>
  );
}

type UploadErrors = { file?: string; date?: string; time?: string; txn?: string };

function UploadSigned({
  deed,
  reload,
  onStale,
}: {
  deed: DeedRecord;
  reload: () => void;
  onStale: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [txn, setTxn] = useState("");
  const [errors, setErrors] = useState<UploadErrors>({});
  const [summaryKey, setSummaryKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const dates = useUnreadDates<"esign">();
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: UploadErrors = {};
    if (!file) found.file = C.upload.noFile;
    const dErr = dateError(dates.unread.esign);
    if (dErr) found.date = dErr;
    else if (date === "") found.date = C.upload.noDate;
    if (!ESIGN_TIME.test(time.trim())) found.time = C.upload.badTime;
    if (txn.trim() === "") found.txn = C.upload.noTxn;
    setErrors(found);
    if (Object.keys(found).length > 0 || !file) {
      setSummaryKey((k) => k + 1);
      return;
    }
    const esignAt = esignAtValue(date, time) as string;
    setRefused(null);
    if (!(await ensureStepUp())) return;
    setBusy(true);
    try {
      const sha = await sha256Hex(file);
      await uploadSignedDeed(
        deed.id,
        file,
        sha,
        { expectedUpdatedAt: deed.updatedAt, esignAt, esignTxn: txn.trim() },
        (sent, total) => setProgress(total > 0 ? Math.round((sent / total) * 100) : null),
      );
      toast("success", C.upload.done);
      reload();
    } catch (err) {
      if (err instanceof RequestError && err.code === "stale_version") onStale();
      else setRefused(errorText(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const summary = Object.entries(errors).map(([k, text]) => ({
    id: k === "date" ? "deed-esign-date" : `deed-esign-${k}`,
    text: text as string,
  }));

  return (
    <section className="lead-panel deed-actions" aria-labelledby="deed-up-h">
      <h2 id="deed-up-h" className="lead-panel__title">
        {C.upload.heading}
      </h2>
      <form onSubmit={submit} noValidate>
        <ErrorSummary errors={summary} focusKey={summaryKey} />
        {refused && <Notice tone="error">{refused}</Notice>}
        <FormField id="deed-esign-file" label={C.upload.file} hint={C.upload.fileHint} error={errors.file}>
          {(a) => (
            <div className="deed-file">
              <input
                ref={input}
                {...a}
                type="file"
                className="deed-file__input"
                accept=".pdf,application/pdf"
                onChange={(ev) => {
                  setFile(ev.target.files?.[0] ?? null);
                  ev.target.value = "";
                }}
              />
              {file && (
                <span className="deed-file__chosen">
                  <Upload size={16} />
                  <span className="deed-file__name">{file.name}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => {
                      setFile(null);
                      input.current?.focus();
                    }}
                  >
                    <X size={20} />
                  </button>
                </span>
              )}
            </div>
          )}
        </FormField>
        <FormField id="deed-esign-date" label={C.upload.date} error={errors.date}>
          {(a) => (
            <DateField
              id={a.id}
              value={date}
              onChange={setDate}
              aria-describedby={a["aria-describedby"]}
              aria-invalid={a["aria-invalid"]}
              {...dates.bind("esign")}
            />
          )}
        </FormField>
        <FormField id="deed-esign-time" label={C.upload.time} hint={C.upload.timeHint} error={errors.time}>
          {(a) => (
            <input
              {...a}
              className="deed-time"
              inputMode="numeric"
              autoComplete="off"
              placeholder="HH:MM"
              maxLength={8}
              value={time}
              onChange={(ev) => setTime(ev.target.value)}
            />
          )}
        </FormField>
        <FormField id="deed-esign-txn" label={C.upload.txn} hint={C.upload.txnHint} error={errors.txn}>
          {(a) => (
            <input
              {...a}
              className="docno"
              autoComplete="off"
              spellCheck={false}
              maxLength={100}
              value={txn}
              onChange={(ev) => setTxn(ev.target.value)}
            />
          )}
        </FormField>
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={busy}
          aria-busy={busy || undefined}
        >
          <Upload size={20} />
          {C.upload.button}
        </button>
        {progress !== null && (
          <p className="deed-actions__said" role="status">
            {`${progress} %`}
          </p>
        )}
      </form>
    </section>
  );
}

function SignedPanel({ deed }: { deed: DeedRecord }) {
  const s = deed.signed;
  return (
    <section className="lead-panel deed-actions deed-signed" aria-labelledby="deed-signed-h">
      <h2 id="deed-signed-h" className="lead-panel__title">
        {C.signed.heading}
      </h2>
      {s && (
        <dl className="deed-esign">
          <div>
            <dt className="visually-hidden">{C.signed.heading}</dt>
            <dd className="deed-esign__on">{C.signed.on(s.esignMoment)}</dd>
          </div>
          <div>
            <dt>{C.signed.txn}</dt>
            <dd className="docno deed-esign__txn">{s.esignTxn}</dd>
          </div>
        </dl>
      )}
      <a className="btn btn--primary btn--block" href={deedsApi.signedHref(deed.id)} download>
        <Download size={20} />
        {C.signed.download}
      </a>
      {deed.unsignedPdf && (
        <a className="btn btn--text deed-actions__second" href={deedsApi.unsignedHref(deed.id)} download>
          <Download size={20} />
          {C.pdf.download}
        </a>
      )}
      {s?.signatureLine && <p className="deed-esign__line">{s.signatureLine}</p>}
    </section>
  );
}

function RecordPanel({ deed }: { deed: DeedRecord }) {
  const lines: ReactNode[] = [];
  if (deed.finalisedByName && deed.finalisedAt)
    lines.push(<li key="f">{C.signed.finalisedBy(deed.finalisedByName, day(deed.finalisedAt))}</li>);
  if (deed.signed?.signedByName && deed.signed.signedAt)
    lines.push(<li key="s">{C.signed.uploadedBy(deed.signed.signedByName, day(deed.signed.signedAt))}</li>);
  const sha = deed.sealed?.sha256;
  if (lines.length === 0 && !sha) return null;
  return (
    <section className="lead-panel deed-record">
      <ul className="deed-record__lines">{lines}</ul>
      {sha && (
        <p className="deed-record__sha">
          {C.signed.fingerprint} <span className="docno">{sha.slice(0, 12)}</span>
        </p>
      )}
    </section>
  );
}

function HistoryPanel({ page }: { page: DeedPage }) {
  return (
    <section className="lead-panel deed-history" aria-labelledby="deed-hist-h">
      <h2 id="deed-hist-h" className="lead-panel__title">
        {C.history.heading}
      </h2>
      <ol className="deed-history__list">
        {page.history.map((h) => (
          <li key={h.id} className="deed-history__row">
            <p className="deed-history__when">
              {C.history.row(day(h.cancelledAt), h.cancelledByName ?? "—")}
            </p>
            {h.reason && <p className="deed-history__why">{h.reason}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
