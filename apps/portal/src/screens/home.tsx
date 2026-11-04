// The proposals-and-estimates list (POR-05) and the pieces Home shares with it (M7.1's Home is screens/m71/home.tsx): a card per document awaiting a
// decision: what it is, its title, number and version, total and validity, and one "View" action. Words: the brief, copy.ts and 07-N §1 (PENDING the owner's approval). T6 (07-ZE line 1):
// a validity date says "(IST)" (`validityDateIst`); a decision's date and time are in the client's own clock with its zone's name (lib/local-time.ts).
import { validityDateIst } from "@techaust/core/offers";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { OfferItem } from "../api.ts";
import { ArrowRight, FileText } from "../components/icons.tsx";
import { Moment } from "../components/moment.tsx";
import { PageTitle } from "../components/shell/portal-shell.tsx";
import { StatusPill } from "../components/status-pill.tsx";
import { N, PENDING, WORDS } from "../copy-documents.ts";
import { dateText, titleOf } from "../lib/offers.ts";

/**
 * A validity date with its "(IST)" (07-ZE line 1). The date's own spaces don't break, so on a narrow card only "(IST)" can move to the next
 * line, never half the date.
 */
const validityText = (iso: string | null) => validityDateIst(dateText(iso).replaceAll(" ", "\u00a0"));

export function DocCard(props: { doc: OfferItem; href: string }) {
  const { doc } = props;
  const titleId = `card-${doc.id}`;
  return (
    <article className="dcard" aria-labelledby={titleId}>
      <div className="dcard__top">
        <p className="dcard__kind">
          <FileText size={20} />
          {WORDS.kind[doc.kind]}
        </p>
        <StatusPill status={doc.status} />
      </div>
      <h3 className="dcard__title" id={titleId}>
        {titleOf(doc)}
      </h3>
      <dl className="dcard__facts">
        <div>
          <dt>{WORDS.doc.number}</dt>
          <dd className="nowrap">{doc.numberDisplay}</dd>
        </div>
        <div>
          <dt>{WORDS.doc.version}</dt>
          <dd>{doc.version}</dd>
        </div>
        <div className="dcard__total">
          <dt>{WORDS.doc.total}</dt>
          <dd>{doc.total}</dd>
        </div>
        {doc.validUntil && (
          <div>
            <dt>{WORDS.doc.validUntil}</dt>
            <dd>{validityText(doc.validUntil)}</dd>
          </div>
        )}
      </dl>
      {doc.status === "revised" && <p className="dcard__note">{N.preparing}</p>}
      <Link to={props.href} className="btn btn--primary dcard__view" aria-describedby={titleId}>
        {WORDS.view}
        <ArrowRight size={20} />
      </Link>
    </article>
  );
}

/** "Show more" under a list that has another page. */
export function MoreButton(props: { onMore: () => void; busy: boolean }) {
  return (
    <div className="more">
      <button
        type="button"
        className="btn btn--secondary"
        onClick={props.onMore}
        disabled={props.busy}
        aria-busy={props.busy || undefined}
      >
        {PENDING.showMore}
      </button>
    </div>
  );
}

/** The documents awaiting a decision (07-N §1): a card each, or the empty state; Home and the list both show it. */
export function Awaiting(props: { docs: OfferItem[]; hrefOf: (d: OfferItem) => string; more?: ReactNode }) {
  return (
    <section className="block" aria-labelledby="awaiting-h">
      <h2 id="awaiting-h" className="block__title">
        {N.awaitingTitle}
        {props.docs.length > 0 && <span className="count">{props.docs.length}</span>}
      </h2>
      {props.docs.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <FileText size={24} />
          </span>
          <div>
            <h3 className="empty__title">{N.emptyTitle}</h3>
            <p className="muted">{N.emptyBody}</p>
          </div>
        </div>
      ) : (
        <ul className="dcards">
          {props.docs.map((d) => (
            <li key={d.id}>
              <DocCard doc={d} href={props.hrefOf(d)} />
            </li>
          ))}
        </ul>
      )}
      {props.more}
    </section>
  );
}

export function DocumentsScreen(props: {
  awaiting: OfferItem[];
  decided: OfferItem[];
  hrefOf: (d: OfferItem) => string;
  more?: ReactNode;
}) {
  return (
    <div className="screen">
      <header className="screen__head">
        <PageTitle text={WORDS.nav.documents} className="screen__title">
          {WORDS.nav.documents}
        </PageTitle>
      </header>
      <Awaiting docs={props.awaiting} hrefOf={props.hrefOf} />
      <section className="block" aria-labelledby="decided-h">
        <h2 id="decided-h" className="block__title">
          {N.decidedTitle}
        </h2>
        {props.decided.length === 0 ? (
          <p className="muted">{N.decidedEmpty}</p>
        ) : (
          <ul className="drows">
            {props.decided.map((d) => (
              <li key={d.id}>
                <Link to={props.hrefOf(d)} className="drow">
                  <span className="drow__main">
                    <span className="drow__title">{titleOf(d)}</span>
                    <span className="drow__meta">
                      {WORDS.kind[d.kind]} <span className="nowrap">{d.numberDisplay}</span>,{" "}
                      {/* "version 1" never splits across lines (final sweep P6). */}
                      <span className="nowrap">
                        {WORDS.doc.version.toLowerCase()} {d.version}
                      </span>
                    </span>
                  </span>
                  <span className="drow__status">
                    <StatusPill status={d.status} />
                    <span className="drow__when">
                      {d.decidedAt ? <Moment at={d.decidedAt} /> : validityText(d.validUntil)}
                    </span>
                  </span>
                  <span className="drow__total">{d.total}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {props.more}
      </section>
    </div>
  );
}

/** Another client's document, or an address with nothing at it: the same "not found" (POR-03, a 404 across clients). */
export function NotFoundScreen(props: { homeHref: string }) {
  return (
    <div className="screen screen--narrow">
      <header className="screen__head">
        <PageTitle text={WORDS.notFound.title} className="screen__title">
          {WORDS.notFound.title}
        </PageTitle>
      </header>
      <p>{WORDS.notFound.body}</p>
      <Link to={props.homeHref} className="btn btn--secondary">
        {WORDS.notFound.home}
      </Link>
    </div>
  );
}

/** While a screen's data loads: quiet placeholders, no spinner (docs/06 §5.3). */
export function ScreenSkeleton(props: { label: string }) {
  return (
    <div className="screen" aria-busy="true">
      <p className="visually-hidden" role="status">
        {props.label}
      </p>
      <div aria-hidden="true">
        <span className="skeleton skeleton--title" />
        <span className="skeleton skeleton--line" />
        <span className="skeleton skeleton--line skeleton--short" />
      </div>
    </div>
  );
}
