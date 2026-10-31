// Home (POR-04) and the proposals-and-estimates list (POR-05), with the sections a later milestone builds (invoices M5 to M7, projects
// and the profile M7.1) as calm "coming soon" panels. A card per document awaiting a decision: what it is, its title, number and
// version, total and validity, and one "View" action. Words: the brief, copy.ts and 07-N §1 (PENDING the owner's approval). T6 (07-ZE line 1):
// a validity date says "(IST)" (`validityDateIst`); a decision's date and time are already IST-labelled and stay as they are.
import { validityDateIst } from "@techaust/core/offers";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { OfferItem } from "../api.ts";
import { ArrowRight, FileText, FolderKanban, Receipt, User } from "../components/icons.tsx";
import { PageTitle } from "../components/shell/portal-shell.tsx";
import { StatusPill } from "../components/status-pill.tsx";
import { N, PENDING, WORDS } from "../copy-documents.ts";
import { dateText, formatIstDateTime, titleOf } from "../lib/offers.ts";

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
            <dd className="nowrap">{validityDateIst(dateText(doc.validUntil))}</dd>
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

/** A later section, for a card on home or as a whole screen. */
export function ComingSoon(props: {
  title: string;
  icon: ReactNode;
  body: string;
  level: 2 | 3;
  /** The "Coming soon" line under the title (off where the title already says it). */
  tag?: boolean | undefined;
}) {
  const H = props.level === 2 ? "h2" : "h3";
  return (
    <section className="soon">
      <span className="soon__icon">{props.icon}</span>
      <div>
        <H className="soon__title">{props.title}</H>
        {props.tag !== false && <p className="soon__tag">{WORDS.comingSoon}</p>}
        <p className="soon__body">{props.body}</p>
      </div>
    </section>
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

function Awaiting(props: { docs: OfferItem[]; hrefOf: (d: OfferItem) => string; more?: ReactNode }) {
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

export function HomeScreen(props: {
  org: string;
  contactName: string;
  awaiting: OfferItem[];
  /** True when the organisation has decided documents (the link to the full list is offered). */
  hasDecided: boolean;
  hrefOf: (d: OfferItem) => string;
  listHref: string;
  /** M5.4: the invoices tile (a contact who can see finance); otherwise the section stays "coming soon". */
  invoicesTile?: ReactNode;
}) {
  return (
    <div className="screen">
      <header className="screen__head">
        <PageTitle text={props.org} className="screen__title">
          {props.org}
        </PageTitle>
        <p className="screen__lede">
          {WORDS.signedInAs} <strong>{props.contactName}</strong>
        </p>
      </header>
      <Awaiting
        docs={props.awaiting}
        hrefOf={props.hrefOf}
        more={
          props.hasDecided ? (
            <p className="block__more">
              <Link to={props.listHref} className="textlink">
                {N.backToList}
                <ArrowRight size={16} />
              </Link>
            </p>
          ) : null
        }
      />
      <section className="block" aria-labelledby="also-h">
        <h2 id="also-h" className="block__title">
          {N.alsoTitle}
        </h2>
        <div className="soons">
          {/* 07-ZA item 12: no Invoices tile for a contact who can't see finance (the route passes none for them). */}
          {props.invoicesTile}
          <ComingSoon
            level={3}
            title={WORDS.nav.projects}
            icon={<FolderKanban size={24} />}
            body={N.soon.projects}
          />
        </div>
      </section>
    </div>
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
                      {d.decidedAt ? formatIstDateTime(d.decidedAt) : validityDateIst(dateText(d.validUntil))}
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

const SOON = {
  invoices: { icon: <Receipt size={24} />, body: N.soon.invoices },
  projects: { icon: <FolderKanban size={24} />, body: N.soon.projects },
  profile: { icon: <User size={24} />, body: N.soon.profile },
} as const;

/** A whole section that a later milestone builds. */
export function SoonScreen(props: { section: keyof typeof SOON }) {
  const s = SOON[props.section];
  const title = WORDS.nav[props.section];
  return (
    <div className="screen">
      <header className="screen__head">
        <PageTitle text={title} className="screen__title">
          {title}
        </PageTitle>
      </header>
      <ComingSoon level={2} title={WORDS.comingSoon} tag={false} icon={s.icon} body={s.body} />
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
