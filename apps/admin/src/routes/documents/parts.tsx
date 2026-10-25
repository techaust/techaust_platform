// Pieces the proposal and estimate screens share (M4.3): the access gate, the breadcrumbs, the status pill, the document's name cell and
// its address. The styles: the M3.2 panels (leads.css), the M3.3 strip and tables (clients.css), the M4.1 schedule bar (catalogue.css)
// and documents.css, loaded with these screens only.
import "../../leads.css";
import "../../clients.css";
import "../../projects.css";
import "../../catalogue.css";
import "../../documents.css";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Column } from "../../components/data-table.tsx";
import { StatusPill } from "../../components/display.tsx";
import { NoAccess } from "../../components/states.tsx";
import { allowed } from "../../lib/access.ts";
import {
  APPROVAL_LABELS,
  APPROVAL_PILLS,
  DOC_COPY,
  DOC_PENDING,
  dayText,
  moneyText,
  STATUS_LABELS,
  STATUS_PILLS,
  shownStatus,
  TYPE_LABELS,
  titleOf,
} from "../../lib/documents.ts";
import type { ApprovalState, ListRow, QuoteStatus, QuoteType } from "../../lib/documents-api.ts";
import { useUser } from "../../session.tsx";

export const LIST_CRUMB = { label: DOC_COPY.listHeading, to: "/proposals" };
export const crumbsFor = (type: QuoteType) => [
  {
    label: type === "estimate" ? "Estimates" : "Proposals",
    to: type === "estimate" ? "/estimates" : "/proposals",
  },
];

/** Where a document lives in the admin: under its rail section (Proposals or Estimates). */
export const docHref = (d: { id: string; type: QuoteType }) =>
  `/${d.type === "estimate" ? "estimates" : "proposals"}/${encodeURIComponent(d.id)}`;

export function DocsGate({ children }: { children: ReactNode }) {
  const user = useUser();
  if (!allowed(user.role, "proposals.read")) return <NoAccess what={DOC_COPY.listHeading} />;
  return <>{children}</>;
}

/** The version's state, with "Pending approval" for a draft that waits for the owner (docs/06 §5.5). */
export function DocPill({ status, approval }: { status: QuoteStatus; approval: ApprovalState }) {
  const s = shownStatus(status, approval);
  const p = STATUS_PILLS[s];
  return (
    <StatusPill tone={p.tone} icon={p.icon} outline={p.outline}>
      {STATUS_LABELS[s]}
    </StatusPill>
  );
}

export function ApprovalPill({ state }: { state: Exclude<ApprovalState, "none"> }) {
  const p = APPROVAL_PILLS[state];
  return (
    <StatusPill tone={p.tone} icon={p.icon}>
      {APPROVAL_LABELS[state]}
    </StatusPill>
  );
}

/** The title (a link) with the number and version underneath; a draft that was never sent has no number yet. */
export function DocName(props: {
  doc: { id: string; type: QuoteType; title: string | null; number: string | null; version: number };
  withType?: boolean;
}) {
  const d = props.doc;
  return (
    <span className="person client-name doc-name">
      <Link className="person__name client-name__link" to={docHref(d)}>
        {titleOf(d.title)}
      </Link>
      <span className="client-name__code doc-name__meta">
        {props.withType && <span>{TYPE_LABELS[d.type]}</span>}
        {d.number && <span className="docno">{d.number}</span>}
        <span className="docno">v{d.version}</span>
      </span>
    </span>
  );
}

/** The columns of a list of documents (this screen and the client page's tab). */
export function documentColumns(withClient: boolean): Column<ListRow>[] {
  return [
    {
      key: "doc",
      header: DOC_COPY.colDocument,
      card: "title",
      width: withClient ? "28%" : "34%",
      cell: (r) => <DocName doc={r} withType />,
    },
    ...(withClient
      ? [
          {
            key: "client",
            header: "Client",
            cell: (r: ListRow) => (
              <span className="person client-name">
                <span className="person__name">{r.clientName}</span>
                <span className="client-name__code">
                  <span className="docno">{r.clientCode}</span>
                </span>
              </span>
            ),
          },
        ]
      : []),
    { key: "status", header: "Status", cell: (r) => <DocPill status={r.status} approval={r.approval} /> },
    {
      key: "total",
      header: DOC_COPY.colTotal,
      align: "end",
      cell: (r) => (
        <span className="doc-amount">
          <span className="tnum">{moneyText(r.totalMinor, r.currency)}</span>
          {r.customLines > 0 && (
            <span className="doc-amount__custom">
              {DOC_PENDING.customLinesCount(r.customLines)}, {moneyText(r.customTaxableMinor, r.currency)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "valid",
      header: "Valid until",
      cell: (r) => {
        const d = dayText(r.validUntil);
        return d ? (
          <time dateTime={r.validUntil ?? undefined}>{d}</time>
        ) : (
          <span className="muted">Not sent</span>
        );
      },
    },
  ];
}
