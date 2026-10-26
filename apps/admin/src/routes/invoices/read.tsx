// An issued invoice (M5.1, ADM-INV-02, -03, -07), and a draft for a role that only reads it: the number as the page's title (set in tabular
// figures, struck through once void: it keeps its number), the locked banner, the PDF, the void action for the owner, and the lines and totals
// as frozen. Nothing here can change the invoice except the void, which keeps the number and the record (Rule 56(8), VERIFY WITH CA/LEGAL).
import type { Role } from "@techaust/core/permissions";
import { useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "../../components/display.tsx";
import { Ban, FolderKanban, Lock } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { allowed } from "../../lib/access.ts";
import { dayText, formatIstDay } from "../../lib/documents.ts";
import type { ViewLine } from "../../lib/documents-api.ts";
import {
  badgeOf,
  draftTitle,
  frozenBanner,
  INV_COPY,
  INV_PLACEHOLDER,
  moneyText,
  typeLabel,
  voidBlockedText,
  voidedLine,
} from "../../lib/invoices.ts";
import { type InvoiceView, invoicePdfHref, invoicesApi } from "../../lib/invoices-api.ts";
import { PDF_COPY } from "../../lib/pdf.ts";
import { LinesTable, TaxPreview } from "../documents/money.tsx";
import { PdfPanel, type PdfSource, type PdfWords } from "../documents/pdf-panel.tsx";
import { VoidDialog } from "./dialogs.tsx";
import { INVOICES_CRUMB, InvoiceBadge, NumberMark } from "./parts.tsx";

const PDF_WORDS: PdfWords = {
  // 07-R has no heading for a ready PDF: the approved 07-P one stands in (it says the same thing).
  ready: PDF_COPY.ready,
  making: INV_COPY.pdfPreparing,
  slow: INV_COPY.pdfFailed,
  download: INV_COPY.pdfDownload,
  tryAgain: INV_COPY.pdfTryAgain,
};
const PDF_SOURCE: PdfSource = {
  load: (id) => invoicesApi.get(id),
  retry: (id) => invoicesApi.retryPdf(id),
  href: invoicePdfHref,
};

/** The invoice's lines in the shape the read-only table draws (the same columns as a sent proposal). */
const asViewLines = (v: InvoiceView): ViewLine[] =>
  v.lines.map((l) => ({ ...l, catalogueRateMinor: null, catalogueLine: null }));

/** Who issued it: the staff member frozen into the issuer block (the approver, when an owner approved a request). */
const issuedBy = (v: InvoiceView) => v.issuer?.sender?.name ?? INV_PLACEHOLDER;

export function InvoiceRead({ view, reload, role }: { view: InvoiceView; reload: () => void; role: Role }) {
  const toast = useToast();
  const [voiding, setVoiding] = useState(false);
  const v = view;
  const badge = badgeOf(v);
  const isVoid = v.status === "void";
  const ownerVoids = allowed(role, "invoices.void");
  const voidWhy = ownerVoids && v.frozen && !isVoid ? voidBlockedText(v.void.blockers) : null;
  const title = v.number ?? draftTitle(v.client.name);

  return (
    <>
      <PageHeader
        title={title}
        crumbs={INVOICES_CRUMB}
        status={<InvoiceBadge badge={badge} />}
        lede={v.frozen ? undefined : INV_COPY.draftLede}
        more={
          v.frozen && ownerVoids && !isVoid && v.void.canVoid
            ? [
                {
                  label: INV_COPY.voidButton,
                  icon: <Ban size={16} />,
                  tone: "danger",
                  onSelect: () => setVoiding(true),
                },
              ]
            : undefined
        }
      />
      <dl className="client-strip doc-strip inv-strip">
        {!v.frozen && (
          <div className="client-strip__fact">
            <dt>{INV_COPY.colNumber}</dt>
            <dd>
              <NumberMark number={null} />
            </dd>
          </div>
        )}
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
        {v.issueDate && (
          <div className="client-strip__fact">
            <dt>{INV_COPY.colIssued}</dt>
            <dd>{dayText(v.issueDate)}</dd>
          </div>
        )}
        {v.dueDate && (
          <div className="client-strip__fact">
            <dt>{INV_COPY.colDue}</dt>
            <dd className={v.overdue && !isVoid ? "inv-due--late" : undefined}>{dayText(v.dueDate)}</dd>
          </div>
        )}
        {v.totals && (
          <div className="client-strip__fact">
            <dt>{INV_COPY.colTotal}</dt>
            <dd className="tnum">{moneyText(v.totals.totalMinor, v.currency)}</dd>
          </div>
        )}
        {v.frozen && !isVoid && (
          <div className="client-strip__fact">
            <dt>{INV_COPY.colBalance}</dt>
            <dd className="tnum">{moneyText(v.balanceMinor, v.currency)}</dd>
          </div>
        )}
      </dl>

      {v.frozen && (
        <div className="notice notice--info inv-lock" role="status">
          {isVoid ? <Ban size={20} /> : <Lock size={20} />}
          <div>
            {isVoid && v.void.voidedAt !== null && (
              <p className="inv-lock__void">
                {voidedLine(formatIstDay(v.void.voidedAt), INV_PLACEHOLDER, v.void.reason ?? "")}
              </p>
            )}
            <p>{frozenBanner(v.issueDate ? (dayText(v.issueDate) ?? v.issueDate) : "", issuedBy(v))}</p>
            {voidWhy && <p className="inv-lock__why">{voidWhy}</p>}
          </div>
        </div>
      )}

      <div className="doc-page doc-page--read inv-page">
        <div className="doc-page__send">
          {v.frozen && v.pdf.state !== "none" && (
            <PdfPanel
              key={v.id}
              id={v.id}
              sentAt={v.frozenAt}
              initial={v.pdf}
              canRetry={allowed(role, "invoices.draft") && !v.client.anonymised}
              words={PDF_WORDS}
              source={PDF_SOURCE}
            />
          )}
        </div>

        <div className="doc-page__main">
          {v.milestone && (
            <p className="inv-origin">
              <FolderKanban size={16} />
              <span>
                {allowed(role, "projects.read") ? (
                  <Link to={`/projects/${encodeURIComponent(v.milestone.projectId)}`}>
                    {v.milestone.title}
                  </Link>
                ) : (
                  v.milestone.title
                )}
              </span>
            </p>
          )}
          <section className="lead-panel doc-sheet inv-sheet" aria-labelledby="inv-sheet-h">
            <h2 id="inv-sheet-h" className="visually-hidden">
              {INV_COPY.lines}
            </h2>
            <div className="inv-sheet__head">
              <NumberMark number={v.number} void={isVoid} size="lead" />
              <span className="inv-sheet__type">{typeLabel(v.type)}</span>
            </div>
            <LinesTable lines={asViewLines(v)} currency={v.currency} supply={v.supply} />
            <TaxPreview totals={v.totals} supply={v.supply} currency={v.currency} frozen={v.frozen} />
          </section>
        </div>
      </div>

      {v.number && (
        <VoidDialog
          open={voiding}
          number={v.number}
          onClose={() => setVoiding(false)}
          onVoid={async (reason) => {
            await invoicesApi.void(v.id, v.updatedAt, reason);
            setVoiding(false);
            if (v.milestone) toast("success", INV_COPY.milestoneBack);
            reload();
          }}
        />
      )}
    </>
  );
}
