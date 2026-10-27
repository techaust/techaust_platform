// Pieces the invoice screens share (M5.1): the access gate, the badge, the number (the one drawn element: an issued number set solid, a draft's
// empty slot), the list columns, an invoice's address and the "Created from the milestone" line. Styles: the M3.2 panels, the M3.3 strip and
// tables, the M4.3 documents styles, and invoices.css, loaded with these screens only.
import "../documents/parts.tsx";
import "../../invoices.css";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Column } from "../../components/data-table.tsx";
import { StatusPill } from "../../components/display.tsx";
import { FolderKanban } from "../../components/icons.tsx";
import { NoAccess } from "../../components/states.tsx";
import { allowed } from "../../lib/access.ts";
import {
  BADGE_LABELS,
  BADGE_PILLS,
  type Badge,
  badgeOf,
  dateCell,
  fromMilestone,
  INV_COPY,
  moneyText,
  splitAtPlace,
  typeLabel,
} from "../../lib/invoices.ts";
import type { InvoiceListRow } from "../../lib/invoices-api.ts";
import { useUser } from "../../session.tsx";
import { ApprovalPill } from "../documents/parts.tsx";

export const INVOICES_CRUMB = [{ label: INV_COPY.title, to: "/invoices" }];
export const invoiceHref = (id: string) => `/invoices/${encodeURIComponent(id)}`;

export function InvoicesGate({ children }: { children: ReactNode }) {
  const user = useUser();
  if (!allowed(user.role, "invoices.read")) return <NoAccess what={INV_COPY.title} />;
  return <>{children}</>;
}

/** Icon, text and colour (docs/06 §5.5); Void's label is struck through, and still read as "Void". */
export function InvoiceBadge({ badge }: { badge: Badge }) {
  const p = BADGE_PILLS[badge];
  return (
    <StatusPill tone={p.tone} icon={p.icon}>
      {badge === "void" ? <span className="inv-void-label">{BADGE_LABELS.void}</span> : BADGE_LABELS[badge]}
    </StatusPill>
  );
}

/**
 * The invoice number as the screens draw it: issued, in the number face, solid; voided, struck through (it keeps its number); a draft has an
 * empty slot with "Not issued yet", because the number is taken only at issue.
 */
export function NumberMark(props: { number: string | null; void?: boolean; size?: "row" | "lead" }) {
  const size = props.size ?? "row";
  if (!props.number)
    return (
      <span className={`inv-number inv-number--${size} inv-number--empty`}>
        <span className="inv-slot" aria-hidden="true" />
        <span>{INV_COPY.notIssued}</span>
      </span>
    );
  return (
    <span className={`inv-number inv-number--${size}${props.void ? " inv-number--void" : ""}`}>
      <span className="docno">{props.number}</span>
    </span>
  );
}

/** The columns of a list of invoices (the Invoices screen and the client's tab): 07-R §1. */
export function invoiceColumns(withClient: boolean): Column<InvoiceListRow>[] {
  return [
    {
      key: "number",
      header: INV_COPY.colNumber,
      card: "title",
      width: withClient ? "22%" : "26%",
      cell: (r) => (
        <span className="person inv-name">
          <Link className="inv-name__link" to={invoiceHref(r.id)}>
            <NumberMark number={r.number} void={r.status === "void"} />
          </Link>
          <span className="client-name__code inv-name__type">{typeLabel(r.type)}</span>
        </span>
      ),
    },
    ...(withClient
      ? [
          {
            key: "client",
            header: INV_COPY.colClient,
            cell: (r: InvoiceListRow) => (
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
    {
      key: "issued",
      header: INV_COPY.colIssued,
      cell: (r) => (r.issueDate ? <time dateTime={r.issueDate}>{dateCell(r.issueDate)}</time> : null),
    },
    {
      key: "due",
      header: INV_COPY.colDue,
      cell: (r) =>
        r.dueDate ? (
          <time
            dateTime={r.dueDate}
            className={r.overdue && r.status !== "void" ? "inv-due--late" : undefined}
          >
            {dateCell(r.dueDate)}
          </time>
        ) : null,
    },
    {
      key: "total",
      header: INV_COPY.colTotal,
      align: "end",
      cell: (r) => <span className="tnum">{moneyText(r.totalMinor, r.currency)}</span>,
    },
    {
      key: "balance",
      header: INV_COPY.colBalance,
      align: "end",
      // A draft owes nothing yet, and a void owes nothing at all: the cell stays empty (and a card leaves the fact out).
      cell: (r) =>
        r.status === "draft" || r.status === "void" ? null : (
          <span className="tnum">{moneyText(r.balanceMinor, r.currency)}</span>
        ),
    },
    {
      key: "status",
      header: INV_COPY.colStatus,
      cell: (r) => (
        <span className="inv-status">
          <InvoiceBadge badge={badgeOf(r)} />
          {r.status === "draft" && r.approval === "pending" && <ApprovalPill state="pending" />}
        </span>
      ),
    },
  ];
}

/** 07-R "Created from the milestone …": one quiet line, the project's name the link back to it (plain text for a role that can't open projects). */
export function MilestoneOrigin(props: { milestone: string; project: string; href: string | null }) {
  const line = fromMilestone(props.milestone, props.project);
  const parts = splitAtPlace(line, props.project);
  return (
    <p className="inv-origin">
      <FolderKanban size={16} />
      <span>
        {props.href === null ? (
          line
        ) : parts ? (
          <>
            {parts[0]}
            <Link to={props.href}>{parts[1]}</Link>
            {parts[2]}
          </>
        ) : (
          <Link to={props.href}>{line}</Link>
        )}
      </span>
    </p>
  );
}
