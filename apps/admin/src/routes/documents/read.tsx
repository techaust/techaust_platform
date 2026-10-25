// A proposal or estimate to read (M4.3, ADM-PROP-05, ADM-EST-02): a sent version exactly as it was frozen (`computed`, never worked out
// again), or a draft for a role that may read but not change it. The page reads like the document: its sections in order, the estimate
// section with the lines, the tax preview and the payment schedule. Beside it: what can happen next (a new version, or for an accepted
// estimate an invoice draft or a care plan) and the versions.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "../../components/display.tsx";
import { Calendar as CalendarIcon, FileText, Receipt } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import {
  DOC_COPY,
  DOC_PENDING,
  DOC_TOASTS,
  dayText,
  formatIstDay,
  moneyText,
  sectionLabel,
  TYPE_LABELS,
  titleOf,
} from "../../lib/documents.ts";
import { type DocumentView, documentsApi } from "../../lib/documents-api.ts";
import { useUser } from "../../session.tsx";
import { CareDialog, InvoiceDialog, ReviseDialog } from "./dialogs.tsx";
import { LinesTable, ScheduleTable, SectionBody, TaxPreview } from "./money.tsx";
import { crumbsFor, DocPill, docHref } from "./parts.tsx";
import { VersionsPanel } from "./side.tsx";

export function ReadView({ view, reload }: { view: DocumentView; reload: () => void }) {
  const user = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"revise" | "invoice" | "care" | null>(null);
  const v = view;
  const accepted = v.versions.some((x) => x.status === "accepted");
  const newer = v.versions.filter((x) => x.version > v.version).at(-1);
  const latestSent = Math.max(
    0,
    ...v.versions.filter((x) => x.number !== null || x.sentAt !== null).map((x) => x.version),
  );
  const canRevise =
    v.frozen &&
    allowed(user.role, "proposals.draft") &&
    !accepted &&
    !newer &&
    v.version === latestSent &&
    !v.client.anonymised;
  const canInvoice = v.type === "estimate" && v.status === "accepted" && allowed(user.role, "invoices.draft");
  const canCare = v.type === "estimate" && v.status === "accepted" && allowed(user.role, "carePlans.write");
  const hasMonthly = v.lines.some((l) => l.unit === "month");
  const number = v.number ?? titleOf(v.title);
  const sections = v.sections.filter((s) => !s.hidden);
  const hasEstimate = sections.some((s) => s.kind === "estimate");

  const estimateBlock = (
    <div className="doc-sheet__estimate">
      <LinesTable lines={v.lines} currency={v.currency} supply={v.supply} />
      <TaxPreview totals={v.totals} supply={v.supply} currency={v.currency} frozen={v.frozen} />
      {v.schedule.length > 0 && (
        <>
          <h3 className="doc-sheet__h3">Payment schedule</h3>
          <ScheduleTable steps={v.schedule} currency={v.currency} />
        </>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        title={titleOf(v.title)}
        crumbs={crumbsFor(v.type)}
        status={<DocPill status={v.status} approval={v.frozen ? "none" : v.approval.state} />}
      />
      <dl className="client-strip doc-strip">
        <div className="client-strip__fact">
          <dt>Client</dt>
          <dd>
            <Link to={`/clients/${encodeURIComponent(v.client.id)}`}>{v.client.name}</Link>{" "}
            <span className="docno">{v.client.code}</span>
          </dd>
        </div>
        <div className="client-strip__fact">
          <dt>{TYPE_LABELS[v.type]}</dt>
          <dd>
            {v.number ? <span className="docno">{v.number}</span> : null} v{v.version}
          </dd>
        </div>
        {v.sentAt && (
          <div className="client-strip__fact">
            <dt>{DOC_PENDING.sentHeading}</dt>
            <dd>{formatIstDay(v.sentAt)}</dd>
          </div>
        )}
        {v.validUntil && (
          <div className="client-strip__fact">
            <dt>Valid until</dt>
            <dd>{dayText(v.validUntil)}</dd>
          </div>
        )}
        {v.totals && (
          <div className="client-strip__fact">
            <dt>{DOC_COPY.total}</dt>
            <dd className="tnum">{moneyText(v.totals.totalMinor, v.currency)}</dd>
          </div>
        )}
      </dl>

      <div className="doc-page doc-page--read">
        <div className="doc-page__send">
          {(canRevise || canInvoice || canCare || newer) && (
            <section className="lead-panel send-panel" aria-labelledby="next-h">
              <h2 id="next-h" className="lead-panel__title">
                {DOC_PENDING.nextHeading}
              </h2>
              {newer && (
                <p className="next-line">
                  <FileText size={16} />
                  <span>
                    {DOC_PENDING.newerDraftExists}{" "}
                    <Link to={docHref({ id: newer.id, type: v.type })}>{DOC_PENDING.openLatest}</Link>
                  </span>
                </p>
              )}
              <div className="send-panel__actions">
                {canRevise && (
                  <button
                    type="button"
                    className="btn btn--primary btn--block"
                    onClick={() => setDialog("revise")}
                  >
                    {DOC_COPY.reviseButton}
                  </button>
                )}
                {canCare && (
                  <button
                    type="button"
                    className={hasMonthly ? "btn btn--primary btn--block" : "btn btn--secondary btn--block"}
                    onClick={() => setDialog("care")}
                  >
                    <CalendarIcon size={20} />
                    {DOC_COPY.careButton}
                  </button>
                )}
                {canInvoice && (
                  <button
                    type="button"
                    className={hasMonthly ? "btn btn--secondary btn--block" : "btn btn--primary btn--block"}
                    onClick={() => setDialog("invoice")}
                  >
                    <Receipt size={20} />
                    {DOC_COPY.invoiceButton}
                  </button>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="doc-page__main">
          {!v.frozen && <Notice tone="info">{DOC_PENDING.readOnlyDraft}</Notice>}
          <article className="lead-panel doc-sheet" aria-labelledby="sheet-h">
            <header className="doc-sheet__head">
              <p className="doc-sheet__kind">
                {TYPE_LABELS[v.type]}
                {v.number && <span className="docno">{v.number}</span>}
                <span className="docno">v{v.version}</span>
              </p>
              <h2 id="sheet-h" className="doc-sheet__title">
                {titleOf(v.title)}
              </h2>
              <p className="doc-sheet__for">
                {v.client.name}
                {v.contact && <span>, {v.contact.name}</span>}
              </p>
            </header>
            {sections.map((s) => (
              <section key={s.id} className="doc-sheet__section" aria-labelledby={`rs-${s.id}`}>
                <h3 id={`rs-${s.id}`} className="doc-sheet__h">
                  {s.title?.trim() || sectionLabel(s.kind)}
                </h3>
                <SectionBody bodyMd={s.bodyMd} />
                {s.kind === "estimate" && estimateBlock}
              </section>
            ))}
            {!hasEstimate && estimateBlock}
          </article>
        </div>

        <div className="doc-page__versions">
          <VersionsPanel versions={v.versions} type={v.type} />
        </div>
      </div>

      <ReviseDialog
        open={dialog === "revise"}
        version={v.version}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          const r = await documentsApi.revise(v.id);
          setDialog(null);
          toast("success", DOC_TOASTS.revised);
          navigate(docHref({ id: r.id, type: v.type }));
        }}
      />
      <InvoiceDialog
        open={dialog === "invoice"}
        id={v.id}
        number={number}
        version={v.version}
        onDone={reload}
        onClose={() => setDialog(null)}
      />
      <CareDialog
        open={dialog === "care"}
        id={v.id}
        number={number}
        version={v.version}
        clientCode={v.client.code}
        onDone={reload}
        onClose={() => setDialog(null)}
      />
    </>
  );
}
