// The proposal or estimate page (POR-05, POR-06): any notice about the version first (a newer one replaced the link's version, it
// expired, a new version is on its way, it was opened from an email link), then the document beside a short summary that stays in
// view on wide screens (status, total, validity, the next step, the PDF and the contents). On phones everything is one column: the
// summary, then the document, then the acceptance block at its end.
import { offerExpiredNotice } from "@techaust/core/offers";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { PdfView } from "../api.ts";
import { DecisionPanel, type DecisionProps } from "../components/decision/decision-panel.tsx";
import { DocumentPaper, sheetSections } from "../components/document/document-paper.tsx";
import { Alert, ArrowLeft, ArrowRight, Clock, Download, Info } from "../components/icons.tsx";
import { Moment } from "../components/moment.tsx";
import { StatusPill } from "../components/status-pill.tsx";
import { N, WORDS } from "../copy-documents.ts";
import { kindWord } from "../lib/offers.ts";

function Aside(props: { view: PdfView; d: DecisionProps; onDownload: () => void; extra?: ReactNode }) {
  const { view } = props;
  const m = props.d.model;
  const open = m.status === "sent" || m.status === "viewed";
  return (
    <aside className="docside" aria-labelledby="docside-h">
      <div className="docside__card">
        <div className="docside__top">
          <h2 id="docside-h" className="docside__kind">
            {WORDS.kind[m.kind]} <span className="nowrap">{m.numberDisplay}</span>
          </h2>
          <StatusPill status={m.status} />
        </div>
        <p className="docside__label">{WORDS.doc.total}</p>
        <p className="docside__total">{m.total}</p>
        <p className="docside__when">
          {m.acceptance ? (
            <>
              {WORDS.status.accepted}{" "}
              <strong>
                <Moment at={m.acceptance.acceptedAt} />
              </strong>
            </>
          ) : (
            <>
              {WORDS.doc.validUntil} <strong className="nowrap">{m.validUntil}</strong>
            </>
          )}
          <span className="line">
            {WORDS.doc.version} {m.version}
          </span>
        </p>
        <div className="docside__actions">
          {open && (
            <a href="#acceptance" className="btn btn--primary btn--block">
              {WORDS.reviewAndAccept}
              <ArrowRight size={20} />
            </a>
          )}
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={props.onDownload}
            disabled={props.d.downloading === "pdf"}
            aria-busy={props.d.downloading === "pdf" || undefined}
          >
            <Download size={20} />
            {WORDS.downloadPdf}
          </button>
        </div>
      </div>
      {props.extra}
      <nav className="toc" aria-label={N.docNav}>
        <p className="toc__title" aria-hidden="true">
          {N.contents}
        </p>
        <ol>
          {sheetSections(view).map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  );
}

export function DocumentPage(
  props: DecisionProps & {
    view: PdfView;
    /** The list to go back to; null on the link view (no list there). */
    backHref: string | null;
    onDownloadPdf: () => void;
    /** The sheet's own "Download PDF" (beside the validity line): its failure is said in the acceptance block. */
    onDownloadPdfInSheet: () => void;
    /** A failed download from the acceptance block, said under it. */
    sheetAlert: ReactNode;
    /** A newer version replaced the one asked for: the version now shown (the latest). */
    replacedBy: number | null;
    /** Extra notices above the document (the link view's sign-in offer). */
    notices?: ReactNode | undefined;
    /** A refusal or download error to show at the top of the acceptance block (07-N §7). */
    problem: string | null;
    /** T11: a card under the summary (the signed deed of an accepted proposal or estimate). */
    asideExtra?: ReactNode | undefined;
  },
) {
  const m = props.model;
  const kind = kindWord(m.kind);
  const hasNotices =
    props.notices || props.replacedBy !== null || m.status === "expired" || m.status === "revised";
  return (
    <div className="docpage">
      {props.backHref && (
        <Link to={props.backHref} className="back">
          <ArrowLeft size={16} />
          {N.backToList}
        </Link>
      )}
      {hasNotices && (
        <div className="docpage__notices">
          {props.notices}
          {props.replacedBy !== null && (
            <div className="notice notice--info" role="note">
              <Info size={20} />
              <div>{N.superseded(kind, props.replacedBy)}</div>
            </div>
          )}
          {m.status === "expired" && (
            <div className="notice notice--warning" role="note">
              <Alert size={20} />
              <div>{offerExpiredNotice(m.kind, m.validUntilDate)}</div>
            </div>
          )}
          {m.status === "revised" && (
            <div className="notice notice--info" role="note">
              <Clock size={20} />
              <div>{N.preparing}</div>
            </div>
          )}
        </div>
      )}
      <div className="docpage__grid">
        <Aside view={props.view} d={props} onDownload={props.onDownloadPdf} extra={props.asideExtra} />
        <DocumentPaper
          view={props.view}
          acceptOpen={m.status === "sent" || m.status === "viewed"}
          onDownload={props.onDownloadPdfInSheet}
          downloading={props.downloading === "pdf"}
          decision={
            <>
              {props.problem && (
                <div className="notice notice--warning decide__problem" role="alert">
                  <Alert size={20} />
                  <div>{props.problem}</div>
                </div>
              )}
              <DecisionPanel {...props} />
              {props.sheetAlert && <div className="decide__alert">{props.sheetAlert}</div>}
            </>
          }
        />
      </div>
    </div>
  );
}
