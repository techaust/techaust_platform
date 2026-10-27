// A draft invoice (M5.1, ADM-INV-01, -03, -04, -07, ADM-APR-01, ADM-PRJ-02): the contact, the lines (the proposal line editor), the document
// discount with the tax preview, and the due date it would get today (read-only: "Net N" from the client's terms, else Settings). Beside it, the
// issue panel: where the draft stands, what still stops it (each line links to where it is fixed), and the one button that issues it (the owner)
// or asks the owner to (Staff). Every change saves itself a moment after the person stops typing; "Save draft" saves at once. A draft whose
// figures are out of date (a converted or "Start project" draft has no stored hash) is saved first when it is issued.
import { issueDateOf } from "@techaust/core/invoices";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, RequestError } from "../../api.ts";
import { DateField } from "../../components/date-field.tsx";
import { PageHeader } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import {
  Alert,
  CheckCircle,
  Clock,
  FileCheck,
  Info,
  RefreshCw,
  Send,
  Trash,
} from "../../components/icons.tsx";
import { StaleNotice, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { allowed } from "../../lib/access.ts";
import {
  DOC_COPY,
  DOC_PENDING,
  dayText,
  type EditorAction,
  formatIstDay,
  notSaved,
} from "../../lib/documents.ts";
import {
  buildInvoicePatch,
  discountError,
  draftTitle,
  dueNote,
  INV_COPY,
  INV_ERRORS,
  INV_PLACEHOLDER,
  type InvAction,
  type InvEditorState,
  initInvoiceEditor,
  invErrorText,
  invIsDirty,
  invoiceEditor,
  issuedToast,
  requestLine,
  typeLabel,
} from "../../lib/invoices.ts";
import { type InvoicePatch, type InvoiceView, invoicesApi } from "../../lib/invoices-api.ts";
import { useUser } from "../../session.tsx";
import { LinesPanel } from "../documents/lines.tsx";
import { TaxPreview } from "../documents/money.tsx";
import { BlockerList, DeleteDraftDialog, IssueDialog, RequestIssueDialog } from "./dialogs.tsx";
import { INVOICES_CRUMB, InvoiceBadge, MilestoneOrigin, NumberMark } from "./parts.tsx";
import { ExportPanel, FxDialog, FxPanel, SERVICE_DATE_LABEL, StatutoryBand } from "./types-parts.tsx";

/** 07-R's stale_version sentence: its first sentence as the notice's title, the rest as its body. */
const STALE = ((t: string) => {
  const i = t.indexOf(". ");
  return [t.slice(0, i + 1), t.slice(i + 2)] as const;
})(INV_ERRORS.stale_version);

/** How long after the last keystroke a draft saves itself (the proposals' rule); leaving a field saves at once. */
const AUTOSAVE_MS = 3000;

export function InvoiceEditor({ view, reload }: { view: InvoiceView; reload: () => void }) {
  const user = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [s, setS] = useState<InvEditorState>(() => initInvoiceEditor(view));
  const ref = useRef(s);
  const dispatch = useCallback((a: InvAction) => {
    ref.current = invoiceEditor(ref.current, a);
    setS(ref.current);
  }, []);
  // The line editor speaks the proposals' actions; only its line edits reach this editor.
  const linesDispatch = useCallback(
    (a: EditorAction) => {
      if (a.type === "line" || a.type === "lines") dispatch(a);
    },
    [dispatch],
  );
  const currentLines = useCallback(() => ref.current.lines, []);
  const inflight = useRef<Promise<unknown> | null>(null);
  const [dialog, setDialog] = useState<"issue" | "request" | "delete" | "fx" | null>(null);
  const canWrite = allowed(user.role, "invoices.draft") && !view.client.anonymised;
  const v = s.view;
  const decision = v.issue.decision;
  const isOwner = decision === "step-up" || decision === "allow";
  const asks = decision === "approval";

  const save = useCallback(
    async (force = false): Promise<boolean> => {
      if (inflight.current) await inflight.current.catch(() => null);
      const cur = ref.current;
      if (cur.status === "stale" || cur.status === "frozen") return false;
      const b = buildInvoicePatch(cur, force);
      if (!b.ok) {
        dispatch({ type: "invalid", error: b.error });
        return false;
      }
      if (!b.patch) return true;
      dispatch({ type: "saving" });
      const p = invoicesApi.save(cur.id, b.patch);
      inflight.current = p;
      try {
        const answer = await p;
        dispatch({ type: "saved", answer, sent: b.sent });
        return true;
      } catch (e) {
        const code = e instanceof RequestError ? e.code : "";
        if (code === "stale_version")
          dispatch({ type: "failed", status: "stale", error: INV_ERRORS.stale_version });
        else if (code === "frozen" || code === "not_draft")
          dispatch({ type: "failed", status: "frozen", error: invErrorText(e) });
        else dispatch({ type: "failed", status: "error", error: invErrorText(e) });
        return false;
      } finally {
        inflight.current = null;
      }
    },
    [dispatch],
  );

  /** Everything typed is saved (and an out-of-date draft saved once); resolves with the newest view, or null when it couldn't save. */
  const prepare = useCallback(async (): Promise<InvoiceView | null> => {
    if (inflight.current) await inflight.current.catch(() => null);
    for (let i = 0; i < 3 && invIsDirty(ref.current); i++) if (!(await save())) return null;
    if (ref.current.view.needsResave && !(await save(true))) return null;
    const cur = ref.current;
    return cur.status === "stale" || cur.status === "frozen" || invIsDirty(cur) ? null : cur.view;
  }, [save]);

  /**
   * M5.2: a field that is not typed into the line editor (the export route, the rate, the service date, the export note) saves at once: what was
   * typed is saved first, then this one PATCH; its answer replaces the view (the figures, the blockers) and typing stays.
   */
  const [extraError, setExtraError] = useState<string | null>(null);
  const saveExtra = useCallback(
    async (fields: NonNullable<InvoicePatch["fields"]>) => {
      setExtraError(null);
      const ready = await prepare();
      if (!ready) throw new RequestError(409, "stale_version", INV_ERRORS.stale_version);
      dispatch({ type: "saving" });
      try {
        const answer = await invoicesApi.save(ready.id, { expectedUpdatedAt: ref.current.updatedAt, fields });
        dispatch({ type: "saved", answer, sent: { parts: [], rev: { ...ref.current.rev }, uids: null } });
      } catch (e) {
        const code = e instanceof RequestError ? e.code : "";
        dispatch({
          type: "failed",
          status: code === "stale_version" ? "stale" : "error",
          error: invErrorText(e),
        });
        throw e;
      }
    },
    [prepare, dispatch],
  );
  /** The same, for a control that shows its own failure next to it (the route, the note, the service date). */
  const saveExtraHere = useCallback(
    async (fields: NonNullable<InvoicePatch["fields"]>) => {
      try {
        await saveExtra(fields);
      } catch (e) {
        setExtraError(invErrorText(e));
      }
    },
    [saveExtra],
  );

  // Autosave a moment after the last change; a refused input waits for the next change; a stale draft stops saving.
  useEffect(() => {
    if (!canWrite || !invIsDirty(s) || s.saving || s.status === "stale" || s.status === "frozen") return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [s, save, canWrite]);
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
      if (!invIsDirty(cur) || cur.saving || cur.status === "stale" || cur.status === "frozen") return;
      void save();
    };
    el.addEventListener("focusout", onLeave);
    return () => el.removeEventListener("focusout", onLeave);
  }, [canWrite, save]);

  const focusLines = useCallback(() => {
    const el = document.getElementById("ln-add-custom");
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  }, []);
  // A line's blocker: the cursor goes where that line is fixed (its description in the row; its SAC in the line's details).
  const [showSac, setShowSac] = useState<{ uid: string; at: number } | null>(null);
  const focusLine = useCallback(
    (n: number, field: "description" | "sac" = "description") => {
      const l = ref.current.lines[n - 1];
      if (l && field === "sac" && l.catalogueItemId === null) {
        setShowSac({ uid: l.uid, at: Date.now() });
        return;
      }
      const el = l ? document.getElementById(`ln-${l.uid}-description`) : null;
      if (el) {
        el.focus();
        el.scrollIntoView({ block: "center" });
      } else focusLines();
    },
    [focusLines],
  );

  const contacts = useLoad(() => api.clientContacts(view.client.id), view.client.id);
  const dirty = invIsDirty(s);
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
  const discErr = discountError(s.fields, s.currency);
  const waiting = requestLine(v.issue.approval);
  const blocked = s.status === "stale" || s.status === "frozen";
  // The view names the project (M5.1 review fix 6); an older API did not, so the project is read for roles that may open it.
  const fetchedProject = useProjectName(
    v.milestone && !v.milestone.projectName ? v.milestone.projectId : null,
    allowed(user.role, "projects.read"),
  );
  const projectName = v.milestone?.projectName || fetchedProject;

  return (
    <>
      <PageHeader
        title={draftTitle(v.client.name)}
        crumbs={INVOICES_CRUMB}
        status={<InvoiceBadge badge="draft" />}
        lede={INV_COPY.draftLede}
        more={
          canWrite
            ? [
                {
                  label: INV_COPY.deleteDraft,
                  icon: <Trash size={16} />,
                  tone: "danger",
                  onSelect: () => setDialog("delete"),
                },
              ]
            : undefined
        }
      />
      <dl className="client-strip doc-strip inv-strip">
        <div className="client-strip__fact">
          <dt>{INV_COPY.colNumber}</dt>
          <dd>
            <NumberMark number={null} />
          </dd>
        </div>
        <div className="client-strip__fact">
          <dt>{INV_COPY.colClient}</dt>
          <dd>
            <Link to={`/clients/${encodeURIComponent(v.client.id)}`}>{v.client.name}</Link>{" "}
            <span className="docno">{v.client.code}</span>
          </dd>
        </div>
        <div className="client-strip__fact">
          <dt>{INV_COPY.filterType}</dt>
          <dd>{typeLabel(v.type)}</dd>
        </div>
        <div className="client-strip__fact">
          <dt>Currency</dt>
          <dd className="docno">{v.currency}</dd>
        </div>
        <div className="client-strip__fact">
          <dt>Created</dt>
          <dd>{formatIstDay(v.createdAt)}</dd>
        </div>
      </dl>

      <div className="doc-page inv-page">
        <div className="doc-page__send">
          <section className="lead-panel send-panel inv-issue-panel" aria-labelledby="inv-issue-h">
            <div className="lead-panel__head">
              <h2 id="inv-issue-h" className="lead-panel__title">
                {INV_COPY.issueTitle}
              </h2>
              {saveLine && (
                <p className="save-state" data-state={s.status} role="status">
                  {s.status === "saved" ? (
                    <CheckCircle size={16} />
                  ) : s.status === "error" ? (
                    <Alert size={16} />
                  ) : null}
                  {saveLine}
                </p>
              )}
            </div>
            <BlockerList
              blockers={v.blockers}
              clientId={v.client.id}
              currency={v.client.currency}
              maxAgeDays={v.fx?.maxAgeDays}
              onLine={focusLine}
              onLines={focusLines}
              onFx={canWrite ? () => setDialog("fx") : undefined}
            />
            {!v.typeIssuable && v.blockers.length === 0 && (
              <p className="approval-line" data-state="expired">
                <Alert size={16} />
                <span>{INV_ERRORS.type_not_issuable}</span>
              </p>
            )}
            {waiting && (
              <p className="approval-line" data-state="pending">
                <Clock size={16} />
                <span>{waiting}</span>
              </p>
            )}
            <dl className="inv-due">
              <dt>{INV_COPY.dueDate}</dt>
              <dd>
                {v.dueDatePreview
                  ? dueNote(dayText(v.dueDatePreview) ?? v.dueDatePreview, v.dueDays)
                  : INV_PLACEHOLDER}
              </dd>
            </dl>
            <div className="send-panel__actions">
              {canWrite && isOwner && (
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={() => setDialog("issue")}
                  disabled={blocked || s.saving || !v.typeIssuable}
                >
                  <FileCheck size={20} />
                  {INV_COPY.issue}
                </button>
              )}
              {canWrite && asks && v.issue.approval.state !== "pending" && (
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={() => setDialog("request")}
                  disabled={blocked || s.saving || !v.typeIssuable}
                >
                  <Send size={20} />
                  {INV_COPY.requestIssue}
                </button>
              )}
              {canWrite && (
                <button
                  type="button"
                  className="btn btn--secondary btn--block"
                  onClick={() => void save(v.needsResave)}
                  disabled={blocked || s.saving || (!dirty && !v.needsResave)}
                >
                  {INV_COPY.saveDraft}
                </button>
              )}
            </div>
          </section>
        </div>

        <div className="doc-page__main" ref={mainRef}>
          {s.status === "stale" && <StaleNotice title={STALE[0]} body={STALE[1]} onReload={reload} />}
          {s.status === "frozen" && (
            <div className="notice notice--info" role="status">
              <Info size={20} />
              <div>
                <p>{s.error}</p>
                <button type="button" className="btn btn--secondary" onClick={reload}>
                  <RefreshCw size={20} />
                  Reload the latest
                </button>
              </div>
            </div>
          )}
          {view.client.anonymised && <Notice tone="info">{INV_ERRORS.client_anonymised}</Notice>}
          {!view.client.anonymised && !allowed(user.role, "invoices.draft") && (
            <Notice tone="info">{DOC_PENDING.readOnlyDraft}</Notice>
          )}
          {v.needsResave && (
            <div className="notice notice--info" role="status">
              <Info size={20} />
              <div>
                <p>{DOC_COPY.needsResave}</p>
              </div>
            </div>
          )}
          {v.milestone && (
            <MilestoneOrigin
              milestone={v.milestone.title}
              project={projectName ?? INV_PLACEHOLDER}
              href={
                allowed(user.role, "projects.read")
                  ? `/projects/${encodeURIComponent(v.milestone.projectId)}`
                  : null
              }
            />
          )}

          {v.proforma?.notice && <StatutoryBand line={v.proforma.notice} />}
          {extraError && <Notice tone="error">{extraError}</Notice>}

          <section className="lead-panel doc-details" aria-labelledby="inv-details-h">
            <h2 id="inv-details-h" className="visually-hidden">
              {INV_COPY.contact}
            </h2>
            <div className="doc-details__row">
              <FormField id="inv-contact" label={INV_COPY.contact}>
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
                    {v.contact?.id &&
                      !contacts.data?.contacts.some((c) => c.id === v.contact?.id) &&
                      v.contact.name !== null && <option value={v.contact.id}>{v.contact.name}</option>}
                    {(contacts.data?.contacts ?? [])
                      .filter((c) => c.anonymisedAt === null)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}, {c.email}
                        </option>
                      ))}
                  </select>
                )}
              </FormField>
              {(v.type === "tax_invoice" || v.type === "export_invoice") &&
                v.serviceCompletedOn !== undefined && (
                  <FormField id="inv-service-draft" label={SERVICE_DATE_LABEL} optional>
                    {(a) => (
                      <DateField
                        {...a}
                        keepLastValid
                        value={v.serviceCompletedOn ?? ""}
                        max={todayIso()}
                        disabled={!canWrite || s.saving}
                        onChange={(iso) => void saveExtraHere({ serviceCompletedOn: iso || null })}
                      />
                    )}
                  </FormField>
                )}
            </div>
          </section>

          <ExportPanel view={v} canWrite={canWrite} busy={s.saving} saveFields={saveExtraHere} />

          <LinesPanel
            lines={s.lines}
            figures={s.figures}
            currency={s.currency}
            supply={v.supply}
            warnings={v.warnings}
            showErrors={s.showErrors}
            type="estimate"
            dispatch={linesDispatch}
            current={currentLines}
            showSac={showSac}
            sacRequired
          />

          <section className="lead-panel doc-totals" aria-labelledby="inv-totals-h">
            <h2 id="inv-totals-h" className="lead-panel__title">
              {DOC_COPY.total}
            </h2>
            <div className="doc-totals__grid">
              <div className="doc-totals__disc">
                <FormField
                  id="inv-disc"
                  label={INV_COPY.documentDiscount}
                  optional
                  error={discErr && (s.showErrors || s.fields.disc !== "") ? discErr : undefined}
                >
                  {(a) => (
                    <div className="disc-in">
                      <select
                        aria-label={`${INV_COPY.documentDiscount}: ${DOC_COPY.fixed} or ${DOC_COPY.percent}`}
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
              <TaxPreview totals={v.totals} supply={v.supply} currency={s.currency} busy={s.saving} />
            </div>
          </section>

          <FxPanel view={v} canWrite={canWrite} busy={s.saving} onOpen={() => setDialog("fx")} />
        </div>
      </div>

      <FxDialog
        open={dialog === "fx"}
        view={v}
        onClose={() => setDialog(null)}
        onSave={(fx) => saveExtra({ fx })}
      />

      <UnsavedChangesGuard dirty={canWrite && (dirty || s.saving)} what="this draft" />

      <IssueDialog
        open={dialog === "issue"}
        view={v}
        issueDate={dayText(todayIso()) ?? todayIso()}
        onClose={() => setDialog(null)}
        prepare={prepare}
        onLine={focusLine}
        onLines={focusLines}
        onFx={() => setDialog("fx")}
        issue={async (ready) => {
          try {
            // Q8: the dialog asked "Issue it in INR anyway?" before it got here, so an INR export goes with the explicit yes.
            const r = await invoicesApi.issue(
              ready.id,
              ready.updatedAt,
              ready.contentSha256 ?? "",
              ready.needsInrConfirm === true,
            );
            setDialog(null);
            toast("success", issuedToast(r.number ?? ""));
            setExtraError(null);
            reload();
          } catch (e) {
            // Blocked or changed under the owner: the panel and the dialog show the server's newest view.
            if (e instanceof RequestError && (e.code === "issue_blocked" || e.code === "content_changed"))
              void refresh();
            if (e instanceof RequestError && e.code === "already_issued") reload();
            throw e;
          }
        }}
      />
      <RequestIssueDialog
        open={dialog === "request"}
        view={v}
        onClose={() => setDialog(null)}
        onLine={focusLine}
        onLines={focusLines}
        onSend={async () => {
          const ready = await prepare();
          if (!ready) throw new RequestError(409, "stale_version", INV_ERRORS.stale_version);
          const r = await invoicesApi.requestIssue(ready.id, ready.updatedAt);
          dispatch({
            type: "approval",
            approval: {
              ...ready.issue.approval,
              state: "pending",
              id: r.id,
              requestedAt: Date.now(),
              decidedAt: null,
              decidedBy: null,
              decidedByName: null,
              note: null,
            },
          });
          toast("success", INV_COPY.requested);
        }}
      />
      <DeleteDraftDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onDelete={async () => {
          if (inflight.current) await inflight.current.catch(() => null);
          await invoicesApi.discard(view.id, ref.current.updatedAt);
          ref.current = { ...ref.current, savedRev: { ...ref.current.rev } };
          setS(ref.current);
          setDialog(null);
          setTimeout(() => navigate("/invoices"), 0);
        }}
      />
    </>
  );

  /** The server's newest view of this draft (after a refused issue): the figures and blockers change, what was typed stays. */
  async function refresh() {
    try {
      const fresh = await invoicesApi.get(view.id);
      if (fresh.updatedAt === ref.current.updatedAt) {
        ref.current = { ...ref.current, view: fresh };
        setS(ref.current);
      }
    } catch {
      // The dialog already says what went wrong.
    }
  }
}

/** Today's IST date (the issue date the dialog names; the server takes its own at issue, the same rule). */
const todayIso = () => issueDateOf(Date.now());

/** The project's name for the "Created from the milestone" line (one read, for roles that can open projects). */
function useProjectName(projectId: string | null, canRead: boolean): string | null {
  const p = useLoad(
    () => (projectId && canRead ? api.project(projectId) : Promise.resolve(null)),
    `${projectId ?? ""}:${canRead}`,
  );
  return p.state === "ready" && p.data ? p.data.project.name : null;
}
