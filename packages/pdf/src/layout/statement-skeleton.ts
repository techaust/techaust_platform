// The plain statement-of-account skeleton (M5.5b stage B; ADM-CLI-04, JOB-PDF-01): the company and the client, the period, the lines with a running balance, the totals and
// the amount due, on one or more A4 pages, in the classes the invoice and proposal layouts already style, and nothing designed. The designer replaces it with `layout/statement.ts`
// (docs/06 §7) and gives its layout its own id (`StatementView.layout`), which makes the next PDF of the same data a new object. The words are 07-V §6 and §6.1, PENDING the owner's
// word-for-word approval; they live here because `layout/copy.ts` is the designer's. A statement lists what the books show (Q58, VERIFY WITH CA/LEGAL): it is not a tax document.
// No logic beyond formatting: every value is a pre-formatted string of the view; every dynamic string goes through `esc`.
import { esc } from "../escape.ts";
import { PDF_LOGOS, PDF_SYMBOL } from "../generated/assets.ts";
import type { StatementView } from "../types.ts";
import { cssString } from "./styles.ts";

/** 07-V §6 and §6.1 (pending approval). */
export const STATEMENT_COPY = {
  title: "Statement of account",
  period: (from: string, to: string) => `Period: ${from} to ${to}`,
  currency: (c: string) => `Currency: ${c}`,
  billedTo: "Statement for",
  columns: {
    date: "Date",
    document: "Document",
    details: "Details",
    debit: "Debit",
    credit: "Credit",
    balance: "Balance",
  },
  kinds: {
    tax_invoice: "Invoice",
    export_invoice: "Export invoice",
    debit_note: "Debit note",
    credit_note: (against: string) => `Credit note against ${against}`,
    receipt: "Payment received",
  },
  opening: "Opening balance",
  closing: "Closing balance",
  totalDebits: "Total debits",
  totalCredits: "Total credits",
  amountDue: (amount: string) => `Amount due: ${amount}`,
  questions: (email: string) => `Questions about this statement? Write to ${email}.`,
  generated: (date: string) => `Generated on ${date}.`,
  page: { word: "Page", of: "of" },
} as const;

const C = STATEMENT_COPY;
const SYMBOL_URI = `data:image/svg+xml,${encodeURIComponent(PDF_SYMBOL)}`;

const detailsOf = (e: StatementView["entries"][number]): string =>
  e.kind === "credit_note" ? C.kinds.credit_note(e.againstNumber ?? "") : C.kinds[e.kind];

function logoHtml(logo: string): string {
  const logos = PDF_LOGOS as Record<string, string | undefined>;
  return `<div class="masthead__logo">${logos[logo] ?? logos["logo-primary-color.svg"] ?? ""}</div>`;
}

/** The body (inside `<body>`). */
export function statementBody(view: StatementView): string {
  const line = (t: string) => `<p class="party__line">${esc(t)}</p>`;
  const from = `<div class="party"><p class="party__name">${esc(view.company.name)}</p>${view.company.lines.map(line).join("")}</div>`;
  const to = `<div class="party"><p class="label">${esc(C.billedTo)}</p><p class="party__name">${esc(view.client.name)}</p>${view.client.lines.map(line).join("")}</div>`;
  const facts = `<div class="party party--doc">${line(C.period(view.from, view.to))}${line(C.currency(view.currency))}</div>`;
  const th = (cls: string, text: string) => `<th scope="col" class="${cls}">${esc(text)}</th>`;
  const head = [
    th("c-date", C.columns.date),
    th("c-doc", C.columns.document),
    th("c-desc", C.columns.details),
    th("num", C.columns.debit),
    th("num", C.columns.credit),
    th("num", C.columns.balance),
  ].join("");
  const money = (v: string) => `<td class="num">${esc(v)}</td>`;
  const rows = view.entries
    .map(
      (e) =>
        `<tr data-testid="entry"><td>${esc(e.date)}</td><td>${esc(e.document)}</td><td>${esc(detailsOf(e))}</td>${money(e.debit)}${money(e.credit)}${money(e.balance)}</tr>`,
    )
    .join("");
  const edge = (label: string, value: string, testid: string) =>
    `<tr class="edge"><td colspan="5">${esc(label)}</td><td class="num" data-testid="${testid}">${esc(value)}</td></tr>`;
  const table = `<table class="grid statement"><thead><tr>${head}</tr></thead><tbody>${edge(C.opening, view.opening, "opening")}${rows}${edge(C.closing, view.closing, "closing")}</tbody></table>`;
  const totals = `<table class="totals__table statement__totals"><tr><th scope="row">${esc(C.totalDebits)}</th><td class="num" data-testid="total-debits">${esc(view.totalDebits)}</td></tr><tr><th scope="row">${esc(C.totalCredits)}</th><td class="num" data-testid="total-credits">${esc(view.totalCredits)}</td></tr>${
    view.amountDue === null
      ? ""
      : `<tr class="grand"><th scope="row" colspan="2" data-testid="amount-due">${esc(C.amountDue(view.amountDue))}</th></tr>`
  }</table>`;
  return `<div class="doc doc--statement"><header class="masthead">${logoHtml(view.company.logo)}<h1 class="masthead__title">${esc(C.title)}</h1></header>
<section class="parties" aria-label="${esc(C.title)}">${from}${to}${facts}</section>
${table}
${totals}
<p class="party__line" data-testid="questions">${esc(C.questions(view.billingEmail))}</p>
<p class="party__line" data-testid="generated">${esc(C.generated(view.generatedOn))}</p></div>`;
}

/** The skeleton's CSS on top of the template CSS: the body size, the table and the footer boxes (the questions line left, "Page X of Y" right). */
export const statementCss = (
  view: StatementView,
): string => `.doc--statement { font-size: var(--print-proposal-body); line-height: var(--print-proposal-leading); }
.doc--statement .parties { display: grid; grid-template-columns: repeat(3, 1fr); column-gap: var(--print-gutter); margin: 0 0 6mm; }
.statement .c-date { width: 22mm; }
.statement .c-doc { width: 38mm; }
.statement .edge td { font-weight: 600; }
.statement tr { break-inside: avoid; }
.statement__totals { width: 80mm; margin: 6mm 0 6mm auto; }
@page {
  @bottom-left {
    content: ${cssString(C.questions(view.billingEmail))};
    padding-left: 6mm;
    background: url("${SYMBOL_URI}") no-repeat left center / 3.6mm 3.6mm;
    font-family: var(--font-sans);
    font-size: var(--print-small);
    line-height: 1;
    color: var(--color-text-muted);
    vertical-align: middle;
    width: 120mm;
  }
  @bottom-right {
    content: ${cssString(`${C.page.word} `)} counter(page) ${cssString(` ${C.page.of} `)} counter(pages);
    white-space: pre;
    font-family: var(--font-sans);
    font-size: var(--print-small);
    font-variant-numeric: tabular-nums lining-nums;
    line-height: 1;
    color: var(--color-text-muted);
    text-align: right;
    vertical-align: middle;
  }
}`;
