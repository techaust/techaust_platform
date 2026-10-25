// Home (POR-04) and the proposals-and-estimates list (POR-05), with the sections a later milestone builds (invoices
// M5 to M7, projects and the profile M7.1) as calm "coming soon" panels. A card per document awaiting a decision: what it
// is, its title, number and version, total and validity, and one "View" action.
import { formatDate, formatIstDateTime } from "@techaust/core";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, FileText, FolderKanban, Receipt, User } from "../components/icons.tsx";
import { Ph } from "../components/pending.tsx";
import { PageTitle } from "../components/shell/portal-shell.tsx";
import { StatusPill } from "../components/status-pill.tsx";
import { PENDING, WORDS } from "../copy-documents.ts";
import { amount, type DocumentView } from "../lib/document-view.ts";

/** What a list or home card needs (the list API returns this much per document). */
export type DocSummary = Pick<
  DocumentView,
  | "id"
  | "kind"
  | "title"
  | "number"
  | "version"
  | "status"
  | "currency"
  | "validUntil"
  | "acceptance"
  | "decline"
> & { totalMinor: number };

export function DocCard(props: { doc: DocSummary; href: string }) {
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
        {doc.title}
      </h3>
      <dl className="dcard__facts">
        <div>
          <dt>{WORDS.doc.number}</dt>
          <dd className="nowrap">{doc.number}</dd>
        </div>
        <div>
          <dt>{WORDS.doc.version}</dt>
          <dd>{doc.version}</dd>
        </div>
        <div className="dcard__total">
          <dt>{WORDS.doc.total}</dt>
          <dd>{amount(doc.totalMinor, doc.currency)}</dd>
        </div>
        <div>
          <dt>{WORDS.doc.validUntil}</dt>
          <dd className="nowrap">{formatDate(doc.validUntil)}</dd>
        </div>
      </dl>
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
        <p className="soon__body">
          <Ph>{props.body}</Ph>
        </p>
      </div>
    </section>
  );
}

function Awaiting(props: { docs: DocSummary[]; hrefOf: (d: DocSummary) => string }) {
  return (
    <section className="block" aria-labelledby="awaiting-h">
      <h2 id="awaiting-h" className="block__title">
        <Ph>{PENDING.awaitingTitle}</Ph>
        {props.docs.length > 0 && <span className="count">{props.docs.length}</span>}
      </h2>
      {props.docs.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <FileText size={24} />
          </span>
          <div>
            <h3 className="empty__title">
              <Ph>{PENDING.emptyTitle}</Ph>
            </h3>
            <p className="muted">
              <Ph>{PENDING.emptyBody}</Ph>
            </p>
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
    </section>
  );
}

export function HomeScreen(props: {
  org: string;
  contactName: string;
  awaiting: DocSummary[];
  hrefOf: (d: DocSummary) => string;
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
      <Awaiting docs={props.awaiting} hrefOf={props.hrefOf} />
      <section className="block" aria-labelledby="also-h">
        <h2 id="also-h" className="block__title">
          <Ph>{PENDING.alsoTitle}</Ph>
        </h2>
        <div className="soons">
          <ComingSoon
            level={3}
            title={WORDS.nav.invoices}
            icon={<Receipt size={24} />}
            body={PENDING.soon.invoices}
          />
          <ComingSoon
            level={3}
            title={WORDS.nav.projects}
            icon={<FolderKanban size={24} />}
            body={PENDING.soon.projects}
          />
        </div>
      </section>
    </div>
  );
}

export function DocumentsScreen(props: {
  awaiting: DocSummary[];
  decided: DocSummary[];
  hrefOf: (d: DocSummary) => string;
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
          <Ph>{PENDING.decidedTitle}</Ph>
        </h2>
        {props.decided.length === 0 ? (
          <p className="muted">
            <Ph>{PENDING.decidedEmpty}</Ph>
          </p>
        ) : (
          <ul className="drows">
            {props.decided.map((d) => (
              <li key={d.id}>
                <Link to={props.hrefOf(d)} className="drow">
                  <span className="drow__main">
                    <span className="drow__title">{d.title}</span>
                    <span className="drow__meta">
                      {WORDS.kind[d.kind]} {d.number}, {WORDS.doc.version.toLowerCase()} {d.version}
                    </span>
                  </span>
                  <span className="drow__status">
                    <StatusPill status={d.status} />
                    <span className="drow__when">
                      {d.acceptance
                        ? formatIstDateTime(d.acceptance.atMs)
                        : d.decline
                          ? formatIstDateTime(d.decline.atMs)
                          : formatDate(d.validUntil)}
                    </span>
                  </span>
                  <span className="drow__total">{amount(d.totalMinor, d.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const SOON = {
  invoices: { icon: <Receipt size={24} />, body: () => PENDING.soon.invoices },
  projects: { icon: <FolderKanban size={24} />, body: () => PENDING.soon.projects },
  profile: { icon: <User size={24} />, body: (org: string) => PENDING.soon.profile(org) },
} as const;

/** A whole section that a later milestone builds. */
export function SoonScreen(props: { section: keyof typeof SOON; org: string }) {
  const s = SOON[props.section];
  const title = WORDS.nav[props.section];
  return (
    <div className="screen">
      <header className="screen__head">
        <PageTitle text={title} className="screen__title">
          {title}
        </PageTitle>
      </header>
      <ComingSoon level={2} title={WORDS.comingSoon} tag={false} icon={s.icon} body={s.body(props.org)} />
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
