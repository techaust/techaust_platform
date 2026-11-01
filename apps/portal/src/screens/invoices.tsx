// The client's invoices (M5.4; POR-06, Q49, LD62): the list, one document's page (the same for the emailed link and the signed-in contact), and the
// home tile. Every figure is the server's, from the document's frozen row (amounts formatted through core); the full document is the PDF. Nothing here
// pays or marks anything paid (M6, M7.1). Words: copy-invoices.ts (07-U §3, marked until approved; the PDF's own words for the lines and totals).
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { InvoiceItem, InvoiceSummary } from "../api.ts";
import { RTable } from "../components/document/rtable.tsx";
import {
  Alert,
  Archive,
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
import { WITHDRAWN_ZF } from "../copy-zf.ts";
import { PAY_ZI } from "../copy-zi.ts";
import {
  type ClientInvoiceStatus,
  clientStatus,
  isWithdrawnDoc,
  minusMoneyText,
  moneyText,
  noteReasonLines,
  qtyText,
  statusLabel,
  todayIst,
  totalsRows,
  typeLabel,
} from "../lib/invoices.ts";
import { dateText } from "../lib/offers.ts";
import { istDayOf } from "../lib/pay.ts";

const LOOK = {
  due: { tone: "info", Icon: Clock },
  overdue: { tone: "warning", Icon: Alert },
  paid: { tone: "success", Icon: CheckCircle },
  credited: { tone: "muted", Icon: CheckCircle },
  void: { tone: "muted", Icon: XCircle },
  // ADM-INV-10: taken back, kept on record; muted as Void, told from it by its icon and its word.
  withdrawn: { tone: "muted", Icon: Archive },
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

/** The button that was pressed has gone: focus moves to the line that says why, so it is read out and the keyboard has a place to start. */
const focusOnShow = (el: HTMLElement | null) => el?.focus();

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
            {
              key: "total",
              label: INV.cols.total,
              num: true,
              // A credit note takes its amount off what is owed: a true minus sign, as the PDF prints a deduction (final sweep P16).
              cell: (d) => (d.type === "credit_note" ? minusMoneyText(d.totalMinor, d.currency) : d.total),
            },
            {
              key: "balance",
              label: INV.cols.balance,
              num: true,
              // a withdrawn payment request owes nothing (ADM-INV-10): no balance, a dash as a credit note's
              cell: (d) => (d.type === "credit_note" || d.balance === null ? "–" : d.balance),
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
 * how to pay while something is owed, then the lines and totals as on the PDF. ADM-INV-10 (owner 2026-10-31, Q3): a withdrawn payment request says so
 * first (07-ZF 19) and keeps its details, with no amount due, no due date, no PDF and no way to pay (the stored PDF still carries the bank details).
 */
export function InvoicePage(props: {
  doc: InvoiceSummary;
  notices?: ReactNode;
  downloading: boolean;
  /** The download's own message (the PDF isn't ready, or the request failed). */
  pdfProblem: string | null;
  onPdf: () => void;
  /**
   * The signed-in page: a note's invoice is a link to that invoice's page (final sweep P15). The emailed link opens one document only, so there the
   * invoice is named, never linked (its page would ask the reader to sign in).
   */
  linkParent?: boolean;
  now?: number;
  /** M6.2 (POR-06): Pay now, when the document can be paid online (the slip's first action; Download PDF steps back to secondary). */
  pay?: ReactNode;
  /** M6.2: back from Razorpay, the Processing state and its end (above the slip). */
  payStatus?: ReactNode;
}) {
  const d = props.doc;
  const status = clientStatus(d, todayIst(props.now));
  const credit = d.type === "credit_note";
  const withdrawn = isWithdrawnDoc(d);
  const owed = !credit && !withdrawn && d.balanceMinor !== null && d.balanceMinor > 0 && d.status !== "void";
  const number = d.numberDisplay ?? "–";
  const reason = noteReasonLines(d.noteReason);
  // 07-ZA item 11: what credit notes took off, by their numbers (final sweep P2).
  const creditNumbers = (d.creditNotes ?? []).flatMap((n) => (n.numberDisplay ? [n.numberDisplay] : []));
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
        {(status !== null || d.parentNumber) && (
          <div className="inv-doc__meta">
            <InvoiceStatusPill status={status} />
            {d.parentNumber &&
              (props.linkParent && d.parentId ? (
                <Link to={invoiceHref(d.parentId)} className="inv-doc__against inv-doc__against--link">
                  {INV.againstInvoice(d.parentNumber)}
                  <ArrowRight size={16} />
                </Link>
              ) : (
                <span className="inv-doc__against">{INV.againstInvoice(d.parentNumber)}</span>
              ))}
          </div>
        )}
        {/* A note says why it was issued, as its PDF does (07-T §1; final sweep P15). */}
        {reason && (
          <div className="inv-doc__reason">
            <p className="inv-doc__reason-line">{reason.line}</p>
            {reason.detail && <p className="inv-doc__reason-detail">{reason.detail}</p>}
          </div>
        )}
      </header>
      {withdrawn && (
        <div className="notice notice--info inv-doc__withdrawn" role="note">
          <Archive size={20} />
          <div>{WITHDRAWN_ZF.banner(d.withdrawnOn ? dateText(d.withdrawnOn) : "")}</div>
        </div>
      )}
      {props.notices}
      {props.payStatus}
      {/* 07-ZA item 15's "A tax invoice will be issued when payment is received." would contradict 07-ZF 19 on a withdrawn request: not shown there. */}
      {d.type === "proforma" && !withdrawn && (
        <p className="sheet-notice inv-doc__notice">{INV.proformaNotice}</p>
      )}

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
          {/* 07-ZA item 11: a payment shows between the total and the balance (final sweep P2). */}
          {!credit && d.paidMinor > 0 && (
            <div>
              <dt>{INV.paid}</dt>
              <dd>{moneyText(d.paidMinor, d.currency)}</dd>
            </div>
          )}
          {/* M6.1 (T8; 07-ZH line 18, approved): the TDS the client deducted, in the server's words and amount (core-formatted), after Paid. */}
          {!credit && d.tdsRow && (
            <div>
              <dt>{d.tdsRow.label}</dt>
              <dd>{d.tdsRow.amount}</dd>
            </div>
          )}
          {!credit && d.creditedMinor > 0 && (
            <div className="inv-slip__credited">
              <dt>{INV.credited(creditNumbers)}</dt>
              <dd>{moneyText(d.creditedMinor, d.currency)}</dd>
            </div>
          )}
          {!credit && !withdrawn && d.balance !== null && (
            <div className="inv-slip__balance">
              <dt>{INV.balanceDue}</dt>
              <dd>{d.balance}</dd>
            </div>
          )}
        </dl>
        {/* M6.2 (07-ZI line 16): a proforma's online payment waits for its tax invoice; said with its date, under the figures. */}
        {d.type === "proforma" && !withdrawn && d.online?.proformaPending && d.online.lastPaid && (
          <p className="inv-slip__paid">
            <Clock size={16} />
            <span>{PAY_ZI.proformaPaid(dateText(istDayOf(d.online.lastPaid.at)))}</span>
          </p>
        )}
        {/* Withdrawn while the page was open (review L3): the reloaded page keeps the download's answer, 07-ZF 20, where the button was. */}
        {withdrawn && props.pdfProblem && (
          <p className="inv-slip__note" role="status" tabIndex={-1} ref={focusOnShow}>
            {props.pdfProblem}
          </p>
        )}
        {!withdrawn && (
          <div className="inv-slip__actions">
            {props.pay}
            <button
              type="button"
              className={props.pay ? "btn btn--secondary" : "btn btn--primary"}
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
        )}
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
            // As the PDF: a Discount column only when a line has one, its text as printed ("10 %", or the amount; final sweep P3).
            ...(d.lines.some((l) => l.discount)
              ? [
                  {
                    key: "discount",
                    label: INV.pdf.lines.discount,
                    num: true,
                    cell: (l: InvoiceSummary["lines"][number]) => (
                      <span className="nowrap">{l.discount || "–"}</span>
                    ),
                  },
                ]
              : []),
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
                {/* The amount says what it is, and a "Due" pill is followed by the date alone, never "Due Due 06 Nov" (final sweep P13). */}
                <span className="inv-tile__bal">
                  <span className="inv-tile__bal-label">{INV.balanceDue}</span> {d.balance}
                </span>
                <span className="inv-tile__due">
                  <InvoiceStatusPill status={clientStatus(d, today)} />
                  {d.dueDate && (
                    <span>
                      {clientStatus(d, today) === "due"
                        ? dateText(d.dueDate)
                        : INV.dueOn(dateText(d.dueDate))}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
