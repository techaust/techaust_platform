// A credit or debit note that is still a draft (M5.3; ADM-INV-11, ADM-APR-01): `/invoices/:id` for a role that drafts. Its lines come from its invoice
// and are never edited here (`note_lines_derived`): the page shows the request as it was saved (the reason in the band the PDF prints, the lines against
// the invoice's, the totals, the effect on the invoice), what still stops the issue, and a waiting request; "Issue credit note" (or "Request issue")
// opens the note dialog again on this draft, and the draft can be deleted (it has no number yet).
import type { Role } from "@techaust/core/permissions";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "../../components/display.tsx";
import { Clock, FileCheck, Send, Trash } from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { allowed } from "../../lib/access.ts";
import { INV_COPY, moneyText, requestLine, typeLabel } from "../../lib/invoices.ts";
import { invoicesApi } from "../../lib/invoices-api.ts";
import { issueLabel, NOTE_COPY, noteDialogTitle } from "../../lib/notes.ts";
import type { InvoiceWithNotes } from "../../lib/notes-api.ts";
import { DeleteDraftDialog } from "./dialogs.tsx";
import { NoteDialog } from "./note-dialog.tsx";
import {
  AgainstInvoice,
  NoteBlockerList,
  NoteFacts,
  NoteLinesTable,
  NoteTotals,
  noteKindOfView,
} from "./notes-parts.tsx";
import { INVOICES_CRUMB, InvoiceBadge, invoiceHref, NumberMark } from "./parts.tsx";

export function NoteDraft({
  view,
  role,
  reload,
}: {
  view: InvoiceWithNotes;
  role: Role;
  reload: () => void;
}) {
  const v = view;
  const navigate = useNavigate();
  const kind = noteKindOfView(v);
  const [dialog, setDialog] = useState<"issue" | "delete" | null>(null);
  const parentId = v.parentLink?.id ?? v.parentId;
  // The invoice the note is against: what the dialog picks from (what is left on each line, the deadline) is the invoice's.
  const parent = useLoad(
    () => (parentId ? invoicesApi.get(parentId) : Promise.resolve(null)),
    `${parentId ?? ""}:${v.updatedAt}`,
  );
  const canWrite = allowed(role, "invoices.draft") && !v.client.anonymised;
  const asks = v.issue.decision === "approval";
  const owner = v.issue.decision === "step-up" || v.issue.decision === "allow";
  const waiting = requestLine(v.issue.approval);
  const parentNumber = v.parentLink?.number ?? v.noteOf?.parent.number ?? "";
  const ready = parent.state === "ready" && parent.data !== null;

  return (
    <>
      <PageHeader
        title={noteDialogTitle(kind, parentNumber)}
        crumbs={INVOICES_CRUMB}
        status={<InvoiceBadge badge="draft" />}
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
        <AgainstInvoice view={v} />
        {v.totals && (
          <div className="client-strip__fact">
            <dt>{INV_COPY.colTotal}</dt>
            <dd className="tnum">{moneyText(v.totals.totalMinor, v.currency)}</dd>
          </div>
        )}
      </dl>

      <div className="doc-page inv-page">
        <div className="doc-page__send">
          <section className="lead-panel send-panel inv-issue-panel" aria-labelledby="note-issue-h">
            <div className="lead-panel__head">
              <h2 id="note-issue-h" className="lead-panel__title">
                {issueLabel(kind)}
              </h2>
            </div>
            <NoteBlockerList blockers={v.blockers} kind={kind} currency={v.currency} />
            {waiting && (
              <p className="approval-line" data-state="pending">
                <Clock size={16} />
                <span>{waiting}</span>
              </p>
            )}
            <div className="send-panel__actions">
              {canWrite && owner && (
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={() => setDialog("issue")}
                  disabled={!ready}
                >
                  <FileCheck size={20} />
                  {issueLabel(kind)}
                </button>
              )}
              {canWrite && asks && v.issue.approval.state !== "pending" && (
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={() => setDialog("issue")}
                  disabled={!ready}
                >
                  <Send size={20} />
                  {NOTE_COPY.requestIssue}
                </button>
              )}
            </div>
          </section>
        </div>

        <div className="doc-page__main">
          <NoteFacts view={v} />
          {/* Named by its number and type, not "Lines": the lines table inside is its own region named "Lines" (final sweep A4, axe landmark-unique). */}
          <section className="lead-panel doc-sheet inv-sheet" aria-labelledby="note-sheet-name">
            <h2 className="visually-hidden">{INV_COPY.lines}</h2>
            <div className="inv-sheet__head" id="note-sheet-name">
              <NumberMark number={null} size="lead" />
              <span className="inv-sheet__type">{typeLabel(v.type)}</span>
            </div>
            <NoteLinesTable view={v} />
            {v.totals && (
              <NoteTotals
                kind={kind}
                currency={v.currency}
                supplyType={v.supply?.type ?? null}
                totals={v.totals}
              />
            )}
          </section>
        </div>
      </div>

      {ready && parent.data && (
        <NoteDialog
          open={dialog === "issue"}
          kind={kind}
          parent={parent.data as InvoiceWithNotes}
          draftId={v.id}
          onClose={() => setDialog(null)}
          onDone={reload}
        />
      )}
      <DeleteDraftDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onDelete={async () => {
          await invoicesApi.discard(v.id, v.updatedAt);
          setDialog(null);
          setTimeout(() => navigate(parentId ? invoiceHref(parentId) : "/invoices"), 0);
        }}
      />
    </>
  );
}
