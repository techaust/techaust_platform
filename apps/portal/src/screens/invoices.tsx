// The client's invoices (M5.4; POR-06, Q49, LD62): the list, one document's page (the same for the emailed link and the signed-in contact), and the
// home tile. Every figure is the server's, from the document's frozen row (amounts formatted through core); the full document is the PDF. Nothing here
// pays or marks anything paid (M6, M7.1). Words: copy-invoices.ts (07-U §3, marked until approved; the PDF's own words for the lines and totals).
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { InvoiceItem, InvoiceSummary } from "../api.ts";
import { RTable } from "../components/document/rtable.tsx";
import {
  Alert,
  ArrowRight,
  CheckCircle,
  Clock,
  Download,
  Landmark,
  Receipt,
  XCircle,
} from "../components/icons.tsx";
import { PageTitle } from "../components/shell/portal-shell.tsx";
import { INV } from "../copy-invoices.ts";
import {
  type ClientInvoiceStatus,
  clientStatus,
  moneyText,
  qtyText,
  statusLabel,
  todayIst,
  totalsRows,
  typeLabel,
} from "../lib/invoices.ts";
import { dateText } from "../lib/offers.ts";

const LOOK = {
  due: { tone: "info", Icon: Clock },
  overdue: { tone: "warning", Icon: Alert },
  paid: { tone: "success", Icon: CheckCircle },
  credited: { tone: "muted", Icon: CheckCircle },
  void: { tone: "muted", Icon: XCircle },
} as const;

/** 07-U §3's status, icon and words (never colour alone); a credit note has none. */
export function InvoiceStatusPill({ status }: { status: ClientInvoiceStatus }) {
  if (status === null) return null;
  const { tone, Icon } = LOOK[status];
  return (
    <span className={`spill spill--${tone}`}>
      <Icon size={16} />
      {statusLabel(status)}
    </span>
  );
}

export const invoiceHref = (id: string) => `/invoices/${encodeURIComponent(id)}`;

/** The organisation's invoices, payment requests and notes, newest first (a table from md up, a card per document on phones). */
export function InvoicesScreen(props: { items: InvoiceItem[]; more?: ReactNode; now?: number }) {
  const today = todayIst(props.now);
  return (
    <div className="screen inv-sheet">
      <header className="screen__head">
        <PageTitle text={INV.title} className="screen__title">
          {INV.title}
        </PageTitle>
      </header>
      {props.items.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <Receipt size={24} />
          </span>
          <p className="muted">{INV.empty}</p>
        </div>
      ) : (
        <RTable
          caption={INV.title}
          className="inv-table"
          rowKey={(d) => d.id}
          rows={props.items}
          columns={[
            {
              key: "number",
              label: INV.cols.number,
              lead: true,
              cell: (d) => (
                <Link to={invoiceHref(d.id)} className="inv-table__link">
                  {d.numberDisplay ?? "–"}
                </Link>
              ),
            },
            { key: "type", label: INV.cols.type, cell: (d) => typeLabel(d.type) },
            {
              key: "issued",
              label: INV.cols.issued,
              cell: (d) => <span className="nowrap">{dateText(d.issueDate)}</span>,
            },
            {
              key: "due",
              label: INV.cols.due,
              cell: (d) =>
                d.type === "credit_note" || !d.dueDate ? (
                  "–"
                ) : (
                  <span className="nowrap">{dateText(d.dueDate)}</span>
                ),
            },
            { key: "total", label: INV.cols.total, num: true, cell: (d) => d.total },
            {
              key: "balance",
              label: INV.cols.balance,
              num: true,
              cell: (d) => (d.type === "credit_note" ? "–" : d.balance),
            },
            {
              key: "status",
              label: INV.cols.status,
              // a credit note owes nothing: no status of its own, a dash as in its Due and Balance cells
              cell: (d) => {
                const s = clientStatus(d, today);
                return s === null ? "–" : <InvoiceStatusPill status={s} />;
              },
            },
          ]}
        />
      )}
      {props.more}
    </div>
  );
}

/** Where a document comes from and how its PDF is fetched: the session's routes or the link's token. */
export type InvoiceSource = {
  load: () => Promise<{ document: InvoiceSummary }>;
  pdf: () => Promise<void>;
};

/** One bank account, as the document prints it (07-R §6 and 07-S §1 labels). */
function BankBlock({ bank }: { bank: NonNullable<InvoiceSummary["bank"]> }) {
  const rows: [string, string][] = [];
  let lead: string;
  if ("swift" in bank) {
    const b = bank.swift;
    if (!b) return null;
    lead = INV.pdf.swiftLine;
    rows.push(
      [INV.pdf.beneficiary, b.accountName],
      [INV.pdf.accountNumber, b.accountNo],
      [INV.pdf.swiftBic, b.swift],
    );
    rows.push([INV.pdf.bankAndBranch, b.branch ? `${b.bankName}, ${b.branch}` : b.bankName]);
    if (b.bankAddress) rows.push([INV.pdf.bankAddress, b.bankAddress]);
    if (b.intermediary) rows.push([INV.pdf.intermediary, b.intermediary]);
  } else {
    const b = bank.inr;
    if (!b) return null;
    lead = INV.pdf.bankLine;
    rows.push([INV.pdf.accountName, b.accountName], [INV.pdf.accountNumber, b.accountNo]);
    if (b.ifsc) rows.push([INV.pdf.ifsc, b.ifsc]);
    rows.push([INV.pdf.bankAndBranch, b.branch ? `${b.bankName}, ${b.branch}` : b.bankName]);
  }
  const purpose = "swift" in bank ? bank.swift?.purposeCode : null;
  return (
    <>
      <p className="inv-pay__lead">{lead}</p>
      <dl className="inv-pay__bank">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {purpose && <p className="inv-pay__lead">{INV.pdf.purposeCode(purpose)}</p>}
    </>
  );
}

/**
 * One document: its number as the heading, the summary slip (issued, due, total and the balance due as the page's one large figure), Download PDF,
 * how to pay while something is owed, then the lines and totals as on the PDF.
 */
export function InvoicePage(props: {
  doc: InvoiceSummary;
  notices?: ReactNode;
  downloading: boolean;
  /** The download's own message (the PDF isn't ready, or the request failed). */
  pdfProblem: string | null;
  onPdf: () => void;
  now?: number;
}) {
  const d = props.doc;
  const status = clientStatus(d, todayIst(props.now));
  const credit = d.type === "credit_note";
  const owed = !credit && d.balanceMinor > 0 && d.status !== "void";
  const number = d.numberDisplay ?? "–";
  return (
    <div className="screen inv-sheet inv-doc">
      <header className="screen__head inv-doc__head">
        <p className="dcard__kind">
          <Receipt size={20} />
          {typeLabel(d.type)}
        </p>
        <PageTitle text={number} className="screen__title inv-doc__number">
          {number}
        </PageTitle>
        <div className="inv-doc__meta">
          <InvoiceStatusPill status={status} />
          {d.parentNumber && <span className="inv-doc__against">{INV.againstInvoice(d.parentNumber)}</span>}
        </div>
      </header>
      {props.notices}

      <section className="inv-slip" aria-label={number}>
        <p className="inv-slip__dates">
          {d.issueDate && <span>{INV.issuedOn(dateText(d.issueDate))}</span>}
          {!credit && d.dueDate && (
            <span className={status === "overdue" ? "inv-slip__late" : undefined}>
              {INV.dueOn(dateText(d.dueDate))}
            </span>
          )}
        </p>
        <dl className="inv-slip__figures">
          <div>
            <dt>{INV.total}</dt>
            <dd>{d.total}</dd>
          </div>
          {!credit && (
            <div className="inv-slip__balance">
              <dt>{INV.balanceDue}</dt>
              <dd>{d.balance}</dd>
            </div>
          )}
        </dl>
        <div className="inv-slip__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={props.onPdf}
            disabled={props.downloading}
            aria-busy={props.downloading || undefined}
          >
            <Download size={20} />
            {INV.downloadPdf}
          </button>
          {(props.pdfProblem || !d.pdfReady) && (
            <p className="inv-slip__note" role="status">
              {props.pdfProblem ?? INV.pdfNotReady}
            </p>
          )}
        </div>
      </section>

      {owed && d.bank && (
        <section className="block inv-pay" aria-labelledby="inv-pay-h">
          <h2 id="inv-pay-h" className="block__title">
            <Landmark size={20} />
            {INV.pdf.howToPay}
          </h2>
          <p className="inv-pay__ref">{INV.howToPay(d.type, number)}</p>
          <BankBlock bank={d.bank} />
        </section>
      )}

      <section className="block" aria-labelledby="inv-lines-h">
        <h2 id="inv-lines-h" className="visually-hidden">
          {INV.pdf.lines.description}
        </h2>
        <RTable
          caption={INV.pdf.lines.description}
          className="rtable--lines inv-lines"
          rowKey={(l) => String(l.position)}
          rows={d.lines}
          columns={[
            {
              key: "description",
              label: INV.pdf.lines.description,
              lead: true,
              cell: (l) => (
                <span className="lcell">
                  <span className="lcell__desc">{l.description}</span>
                  {l.detail && <span className="lcell__detail">{l.detail}</span>}
                </span>
              ),
            },
            { key: "sac", label: INV.pdf.lines.sac, cell: (l) => l.sac ?? "–" },
            {
              key: "qty",
              label: INV.pdf.lines.qty,
              num: true,
              cell: (l) => <span className="nowrap">{`${qtyText(l.qtyMilli)} ${l.unit}`}</span>,
            },
            {
              key: "rate",
              label: INV.pdf.lines.rate,
              num: true,
              cell: (l) => moneyText(l.rateMinor, d.currency),
            },
            {
              key: "taxable",
              label: INV.pdf.lines.taxable,
              num: true,
              cell: (l) => moneyText(l.taxableMinor, d.currency),
            },
          ]}
          foot={totalsRows(d)}
        />
      </section>
    </div>
  );
}

/** Home: the open documents (what is owed, newest first, at most three), and the way to the list. */
export function InvoicesTile(props: { items: InvoiceItem[] | null; problem: string | null; now?: number }) {
  const today = todayIst(props.now);
  const open = (props.items ?? []).filter((d) => {
    const s = clientStatus(d, today);
    return s === "due" || s === "overdue";
  });
  return (
    <section className="inv-tile" aria-labelledby="inv-tile-h">
      <div className="inv-tile__head">
        <span className="soon__icon">
          <Receipt size={24} />
        </span>
        <h3 id="inv-tile-h" className="soon__title">
          <Link to="/invoices" className="inv-tile__link">
            {INV.title}
            <ArrowRight size={20} />
          </Link>
        </h3>
      </div>
      {props.problem ? (
        <p className="muted">{props.problem}</p>
      ) : props.items === null ? (
        <p className="visually-hidden" role="status">
          {INV.title}
        </p>
      ) : open.length === 0 ? (
        <p className="muted">{INV.empty}</p>
      ) : (
        <ul className="inv-tile__list">
          {open.slice(0, 3).map((d) => (
            <li key={d.id}>
              <Link to={invoiceHref(d.id)} className="inv-tile__row">
                <span className="inv-tile__num">{d.numberDisplay}</span>
                <span className="inv-tile__bal">{d.balance}</span>
                <span className="inv-tile__due">
                  <InvoiceStatusPill status={clientStatus(d, today)} />
                  {d.dueDate && <span>{INV.dueOn(dateText(d.dueDate))}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
