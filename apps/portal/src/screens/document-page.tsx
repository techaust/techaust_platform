// The proposal or estimate page (POR-05): any notice about the version first (opened from an older version's link,
// expired, opened from an email link), then the document beside a short summary that stays in view on wide screens
// (status, total, validity, the next step, the PDF and the contents). On phones everything is one column: the summary,
// then the document, then the acceptance block at its end.
import { formatDate, formatIstDateTime } from "@techaust/core";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PENDING, WORDS } from "../copy-documents.ts";
import { DecisionPanel, type DecisionProps } from "../components/decision/decision-panel.tsx";
import { DocumentPaper, SECTIONS } from "../components/document/document-paper.tsx";
import { Alert, ArrowLeft, ArrowRight, Download, Info } from "../components/icons.tsx";
import { Ph } from "../components/pending.tsx";
import { StatusPill } from "../components/status-pill.tsx";
import { amount, type DocumentView } from "../lib/document-view.ts";

function Aside(props: { doc: DocumentView; onDownload: () => void }) {
  const { doc } = props;
  const open = doc.status === "sent" || doc.status === "viewed";
  return (
    <aside className="docside" aria-labelledby="docside-h">
      <div className="docside__card">
        <div className="docside__top">
          <h2 id="docside-h" className="docside__kind">
            {WORDS.kind[doc.kind]} {doc.number}
          </h2>
          <StatusPill status={doc.status} />
        </div>
        <p className="docside__label">{WORDS.doc.total}</p>
        <p className="docside__total">{amount(doc.computed.totalMinor, doc.currency)}</p>
        <p className="docside__when">
          {doc.status === "accepted" && doc.acceptance ? (
            <>
              {WORDS.status.accepted}{" "}
              <strong className="nowrap">{formatIstDateTime(doc.acceptance.atMs)}</strong>
            </>
          ) : (
            <>
              {WORDS.doc.validUntil} <strong className="nowrap">{formatDate(doc.validUntil)}</strong>
            </>
          )}
          <span className="block">
            {WORDS.doc.version} {doc.version}
          </span>
        </p>
        <div className="docside__actions">
          {open && (
            <a href="#acceptance" className="btn btn--primary btn--block">
              {WORDS.reviewAndAccept}
              <ArrowRight size={20} />
            </a>
          )}
          <button type="button" className="btn btn--secondary btn--block" onClick={props.onDownload}>
            <Download size={20} />
            {WORDS.downloadPdf}
          </button>
        </div>
      </div>
      <nav className="toc" aria-label={PENDING.docNav}>
        <p className="toc__title" aria-hidden="true">
          {PENDING.contents}
        </p>
        <ol>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.label}</a>
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  );
}

export function DocumentPage(
  props: DecisionProps & {
    /** The list to go back to; null on the token view (no list there). */
    backHref: string | null;
    onDownloadPdf: () => void;
    /** Extra notices above the document (the token view's sign-in offer). */
    notices?: ReactNode | undefined;
  },
) {
  const { doc } = props;
  const kind = WORDS.kind[doc.kind].toLowerCase();
  return (
    <div className="docpage">
      {props.backHref && (
        <Link to={props.backHref} className="back">
          <ArrowLeft size={16} />
          {PENDING.backToList}
        </Link>
      )}
      {(props.notices || doc.replaced || doc.status === "expired") && (
        <div className="docpage__notices">
          {props.notices}
          {doc.replaced && (
            <div className="notice notice--info" role="note">
              <Info size={20} />
              <div>
                <Ph>{PENDING.replaced(doc.replaced.version, doc.version, formatDate(doc.replaced.on))}</Ph>
              </div>
            </div>
          )}
          {doc.status === "expired" && (
            <div className="notice notice--warning" role="note">
              <Alert size={20} />
              <div>
                <Ph>{PENDING.expired(kind, formatDate(doc.validUntil))}</Ph>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="docpage__grid">
        <Aside doc={doc} onDownload={props.onDownloadPdf} />
        <DocumentPaper doc={doc} onDownload={props.onDownloadPdf} decision={<DecisionPanel {...props} />} />
      </div>
    </div>
  );
}
