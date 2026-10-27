// The project page's Overview tab, the project dashboard (M3.4, ADM-PRJ-05): the details (edited through PATCH /projects/:id by
// owner and staff, sending only what changed and the `updatedAt` it was loaded with; a 409 shows the shared stale notice), the
// milestones timeline with the total against the budget, the five newest notes and files, and the hours logged (07-K words instead of a
// zero before time logs). The old "billed and paid" placeholder is gone with M5.1: each milestone links its invoice on the Milestones tab.
import { type Dispatch, type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, fileDownloadHref, type ProjectPage, RequestError } from "../../api.ts";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { When } from "../../components/display.tsx";
import { AlertTriangle, Clock, Download, FileText, Pencil } from "../../components/icons.tsx";
import { Markdown } from "../../components/markdown.tsx";
import { useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import { hoursLoggedLine } from "../../lib/care.ts";
import { OPEN_IT } from "../../lib/documents.ts";
import {
  COPY,
  type DetailsErrors,
  type DetailsForm,
  detailsErrors,
  detailsOf,
  detailsPatch,
  moneyText,
  PENDING,
  type ProjectDraftAction,
  type ProjectDrafts,
  percentText,
  projectErrorText,
  sizeText,
  TOASTS,
  totalsWarning,
  typeName,
} from "../../lib/projects.ts";
import { useUser } from "../../session.tsx";
import { Fact } from "../clients/overview.tsx";
import { Day, MilestonePill, MoneyIn, VisibilityPill } from "./parts.tsx";
import type { Reload, TabKey } from "./project.tsx";

export function Overview(props: {
  data: ProjectPage;
  drafts: ProjectDrafts;
  draft: Dispatch<ProjectDraftAction>;
  reload: Reload;
  onStale: () => void;
  onTab: (k: TabKey) => void;
  /** Reports whether a Details date field holds text that is not a date, so the page's unsaved-changes guard counts it. */
  onUnreadDates?: (any: boolean) => void;
}) {
  const user = useUser();
  const canWrite = allowed(user.role, "projects.write") && !props.data.clientAnonymised;
  return (
    <div className="lead-page project-overview client-overview">
      <div className="lead-page__main">
        <Details {...props} canWrite={canWrite} />
        <Timeline data={props.data} onOpen={() => props.onTab("milestones")} />
        <RecentNotes data={props.data} onOpen={() => props.onTab("notes")} />
        <RecentFiles data={props.data} onOpen={() => props.onTab("files")} />
      </div>
      <aside className="lead-page__side" aria-label="Summary">
        <section className="lead-panel" aria-labelledby="figures-h">
          <h2 id="figures-h" className="lead-panel__title">
            Figures
          </h2>
          <dl className="facts figures">
            <Fact label="Hours logged">
              {props.data.figures.hours.available ? (
                <span className="panel-empty hours-figure">
                  <Clock size={20} />
                  <span className="tnum">
                    {hoursLoggedLine(
                      props.data.figures.hours.totalMinutes,
                      props.data.figures.hours.billableMinutes,
                    )}
                  </span>
                </span>
              ) : (
                <span className="panel-empty">
                  <Clock size={20} />
                  <span>{COPY.hoursLogged}</span>
                </span>
              )}
            </Fact>
          </dl>
        </section>
        <section className="lead-panel" aria-labelledby="linked-h">
          <h2 id="linked-h" className="lead-panel__title">
            Linked records
          </h2>
          <dl className="facts figures">
            <Fact label="Proposal">
              {props.data.project.sourceDocumentId ? (
                <Link to={`/documents/${encodeURIComponent(props.data.project.sourceDocumentId)}`}>
                  {OPEN_IT}
                </Link>
              ) : (
                <span className="panel-empty">
                  <FileText size={20} />
                  <span>{COPY.linkedProposal}</span>
                </span>
              )}
            </Fact>
          </dl>
        </section>
      </aside>
    </div>
  );
}

// ---- details ------------------------------------------------------------------------------------------------------------------

const FIELD_OF: Record<string, keyof DetailsForm> = {
  dates_order: "targetDate",
  bad_owner: "ownerId",
  budget_locked: "budget",
};

function Details(props: Parameters<typeof Overview>[0] & { canWrite: boolean }) {
  const toast = useToast();
  const { project } = props.data;
  const stored = detailsOf(project);
  const d = props.drafts.details;
  const editing = d !== null;
  const f = d?.value ?? stored;
  const setF = (value: DetailsForm | null) => props.draft({ type: "details", value, base: stored });
  const [errors, setErrors] = useState<DetailsErrors>({});
  const dates = useUnreadDates<"startDate" | "targetDate">();
  const { onUnreadDates } = props;
  useEffect(() => {
    onUnreadDates?.(dates.any);
    return () => onUnreadDates?.(false);
  }, [onUnreadDates, dates.any]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const people = useLoad(() => (props.canWrite ? api.leadAssignees() : Promise.resolve(null)), "");

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!d) return;
    const errs = detailsErrors(f, project.currency, dates.unread);
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(`pd-${first}`)?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.updateProject(project.id, {
        ...detailsPatch(d, project.currency),
        expectedUpdatedAt: project.updatedAt,
      });
      toast("success", r.changed ? TOASTS.projectSaved : "No change: that's already saved.");
      setF(null);
      dates.reset();
      props.reload();
    } catch (err) {
      const field = err instanceof RequestError ? FIELD_OF[err.code] : undefined;
      if (err instanceof RequestError && err.code === "stale_version") props.onStale();
      else if (field) {
        setErrors({ [field]: projectErrorText(err) });
        document.getElementById(`pd-${field}`)?.focus();
      } else setFailure(projectErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const err = (k: keyof DetailsForm) =>
    errors[k] ? <FieldError id={`pd-${k}-error`}>{errors[k]}</FieldError> : null;
  const a11y = (k: keyof DetailsForm) => ({
    id: `pd-${k}`,
    ...(errors[k] ? { "aria-invalid": true as const, "aria-describedby": `pd-${k}-error` } : {}),
  });

  return (
    <section className="lead-panel" aria-labelledby="details-h">
      <div className="lead-panel__head">
        <h2 id="details-h" className="lead-panel__title">
          Details
        </h2>
        {props.canWrite && !editing && (
          <button type="button" className="btn btn--text" onClick={() => setF(stored)}>
            <Pencil size={16} />
            Edit<span className="visually-hidden"> details</span>
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} noValidate className="panel-form">
          {failure && <Notice tone="error">{failure}</Notice>}
          <div className="field">
            <label htmlFor="pd-name">Name</label>
            <input
              {...a11y("name")}
              autoComplete="off"
              maxLength={200}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
            {err("name")}
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pd-ownerId">
                Owner<span className="field__optional"> (optional)</span>
              </label>
              <select
                {...a11y("ownerId")}
                value={f.ownerId}
                onChange={(e) => setF({ ...f, ownerId: e.target.value })}
              >
                <option value="">No owner</option>
                {project.ownerId && !people.data?.assignees.some((p) => p.id === project.ownerId) && (
                  <option value={project.ownerId}>{project.ownerName ?? "A former staff member"}</option>
                )}
                {(people.data?.assignees ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || "Name not set yet"}
                  </option>
                ))}
              </select>
              {err("ownerId")}
            </div>
            <div className="field">
              <label htmlFor="pd-budget">
                Budget<span className="field__optional"> (optional)</span>
              </label>
              <MoneyIn
                a11y={a11y("budget")}
                currency={project.currency}
                value={f.budget}
                onChange={(v) => setF({ ...f, budget: v })}
              />
              {err("budget")}
            </div>
            <div className="field">
              <label htmlFor="pd-startDate" id="pd-startDate-label">
                Start date<span className="field__optional"> (optional)</span>
              </label>
              <DateField
                {...a11y("startDate")}
                {...dates.bind("startDate")}
                value={f.startDate}
                onChange={(v) => setF({ ...f, startDate: v })}
              />
              {err("startDate")}
            </div>
            <div className="field">
              <label htmlFor="pd-targetDate" id="pd-targetDate-label">
                Target date<span className="field__optional"> (optional)</span>
              </label>
              <DateField
                {...a11y("targetDate")}
                {...dates.bind("targetDate")}
                min={f.startDate || undefined}
                value={f.targetDate}
                onChange={(v) => setF({ ...f, targetDate: v })}
              />
              {err("targetDate")}
            </div>
          </div>
          <div className="lead-panel__actions">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => {
                setF(null);
                dates.reset();
                setErrors({});
                setFailure(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
              {busy ? "Saving…" : "Save details"}
            </button>
          </div>
        </form>
      ) : (
        <dl className="facts facts--two">
          <Fact label="Name">{project.name}</Fact>
          <Fact label="Code">
            <span className="docno">{project.code}</span>
          </Fact>
          <Fact label="Owner">{project.ownerName ?? <span className="muted">No owner</span>}</Fact>
          <Fact label="Budget">
            {project.budgetMinor === null ? (
              <span className="muted">Not set</span>
            ) : (
              <span className="tnum">{moneyText(project.budgetMinor, project.currency)}</span>
            )}
          </Fact>
          <Fact label="Start date">
            <Day iso={project.startDate} />
          </Fact>
          <Fact label="Target date">
            <Day iso={project.targetDate} />
          </Fact>
        </dl>
      )}
    </section>
  );
}

// ---- the milestones timeline ----------------------------------------------------------------------------------------------

function Timeline({ data, onOpen }: { data: ProjectPage; onOpen: () => void }) {
  const { project, milestones, milestoneTotals } = data;
  const warning = totalsWarning(milestoneTotals, project.budgetMinor, project.currency);
  return (
    <section className="lead-panel" aria-labelledby="ms-timeline-h">
      <div className="lead-panel__head">
        <h2 id="ms-timeline-h" className="lead-panel__title">
          Milestones
        </h2>
        <button type="button" className="btn btn--text" onClick={onOpen}>
          Open milestones
        </button>
      </div>
      {milestones.length === 0 ? (
        <p className="muted">{PENDING.milestonesEmpty}</p>
      ) : (
        <>
          <ol className="ms-timeline">
            {milestones.map((m) => (
              <li key={m.id} className="ms-timeline__item" data-status={m.status}>
                <span className="ms-timeline__dot" aria-hidden="true" />
                <div className="ms-timeline__body">
                  <p className="ms-timeline__title">{m.title}</p>
                  <p className="ms-timeline__meta">
                    <span>
                      <span className="visually-hidden">Due </span>
                      <Day iso={m.dueDate} none="No due date" />
                    </span>
                    <span className="tnum">
                      {m.resolvedMinor !== null ? (
                        moneyText(m.resolvedMinor, project.currency)
                      ) : (
                        <span className="muted">{m.pctBp !== null ? percentText(m.pctBp) : ""}</span>
                      )}
                    </span>
                  </p>
                </div>
                <MilestonePill status={m.status} />
              </li>
            ))}
          </ol>
          <dl className="ledger-sum">
            <div>
              <dt>Total</dt>
              <dd className="tnum">{moneyText(milestoneTotals.totalMinor, project.currency)}</dd>
            </div>
            <div>
              <dt>Budget</dt>
              <dd className="tnum">
                {project.budgetMinor === null ? (
                  <span className="muted">Not set</span>
                ) : (
                  moneyText(project.budgetMinor, project.currency)
                )}
              </dd>
            </div>
          </dl>
          {warning && (
            <p className="field-warning ledger-warning">
              <AlertTriangle size={16} />
              {warning}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ---- recent notes and files -----------------------------------------------------------------------------------------------

function RecentNotes({ data, onOpen }: { data: ProjectPage; onOpen: () => void }) {
  return (
    <section className="lead-panel" aria-labelledby="recent-notes-h">
      <div className="lead-panel__head">
        <h2 id="recent-notes-h" className="lead-panel__title">
          Recent notes
        </h2>
        <button type="button" className="btn btn--text" onClick={onOpen}>
          All notes
        </button>
      </div>
      {data.recentNotes.length === 0 ? (
        <p className="muted">{PENDING.notesEmpty}</p>
      ) : (
        <ul className="note-list note-list--compact">
          {data.recentNotes.map((n) => (
            <li key={n.id} className="note">
              <p className="note__meta">
                <span className="note__author">{n.authorName ?? "A former staff member"}</span>
                <When ms={n.createdAt} inline />
                <VisibilityPill shared={n.visibility === "shared"} />
              </p>
              <Markdown source={n.bodyMd} className="note__body" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentFiles({ data, onOpen }: { data: ProjectPage; onOpen: () => void }) {
  return (
    <section className="lead-panel" aria-labelledby="recent-files-h">
      <div className="lead-panel__head">
        <h2 id="recent-files-h" className="lead-panel__title">
          Recent files
        </h2>
        <button type="button" className="btn btn--text" onClick={onOpen}>
          All files
        </button>
      </div>
      {data.recentFiles.length === 0 ? (
        <p className="muted">{PENDING.filesEmpty}</p>
      ) : (
        <ul className="file-list file-list--compact">
          {data.recentFiles.map((f) => (
            <li key={f.id} className="file">
              <a className="file__name" href={fileDownloadHref(f.id)} download>
                <Download size={16} />
                <span className="visually-hidden">Download </span>
                <span className="break">{f.filename}</span>
              </a>
              <span className="file__meta">
                {typeName(f.mime)}, {sizeText(f.size)}
                {f.shared && <VisibilityPill shared />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
