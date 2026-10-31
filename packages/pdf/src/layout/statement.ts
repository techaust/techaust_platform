// The statement of account layout (M5.5b; ADM-CLI-04, JOB-PDF-01, LD79; docs/06 §7.1, §7.2, §7.3; wording 07-V §6.1 in ./copy.ts). The same system as
// every document: the A4 page and its 12 columns, the shared header (logo, title, the verdigris rule, then the blocks), ink on white, tabular figures.
// What is the statement's own:
//   - the third header block is the statement's identity: the period first (a statement is known by its dates), then the currency;
//   - the four figures it is about stand in one band under the header: opening balance, total debits, total credits and the closing balance, the last
//     on the accountant's double rule (the closing figure of a ledger), and "Amount due" beside it only when the client owes something;
//   - the entries are a ledger: Date · Document · Details · Debit · Credit · Balance, with the opening balance as the first row and the closing
//     balance as the last (the same rows as the `statement-v1` CSV); the header repeats on every page and a row never splits;
//   - the footer line names billing@ (statements come from billing@, docs/13 2026-10-07; docs/06 §7.1), with "Page X of Y"; the last lines say where
//     to write and when the statement was made. No bank block, no signature: a statement asks for nothing new.
// Statements are capped at 200 entries (STATEMENT_PDF_MAX_ENTRIES), so the longest is about six pages.
//
// No logic beyond formatting: every value is a pre-formatted string of the view (the jobs Worker formats through core). Every dynamic string goes through
// `esc`. Data-testids (tests and the visual suite): `opening`, `closing`, `amount-due`, `entry`, `generated`, `rupee`, `currency-symbol`.
import { esc } from "../escape.ts";
import { PDF_LOGOS, PDF_PRINT_CSS, PDF_SYMBOL, TECHAUST_PDF_FONT_DATA } from "../generated/assets.ts";
import { STATEMENT_PDF_COPY as C } from "./copy.ts";
import { cssString, TEMPLATE_CSS } from "./styles.ts";

/** The CSP of every document page (render.ts has the same): nothing external, inline styles only. */
const DOCUMENT_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

/** What a line of the statement is. */
export type StatementLineKind = "tax_invoice" | "export_invoice" | "debit_note" | "credit_note" | "receipt" | "tds";

/**
 * What the layout prints, every value already formatted (dates as the PDFs write them, amounts with their currency sign). The jobs Worker's view
 * (`statementView()` in ../view.ts, M5.5b stage B) produces it; this type is the layout's contract with that view.
 */
export type StatementLayoutView = {
  /** The page's `<title>`: "Statement of account C001 01 Apr 26 to 28 Oct 26". */
  title: string;
  /** The brand logo file (as the other documents: Settings › Company). */
  logo: string;
  /** The supplier's block as frozen at the request (`statement_pdfs.issuer`): name, then its lines (address, GSTIN and State, email). */
  company: { name: string; lines: readonly string[] };
  /** The client's block: name, then its lines (address; GSTIN when registered). */
  client: { name: string; lines: readonly string[] };
  /** The client's code (the page footer carries it beside the page count). */
  clientCode: string;
  period: { from: string; to: string };
  currency: string;
  opening: string;
  debits: string;
  credits: string;
  closing: string;
  /** The closing balance when it is above zero (07-V: "Amount due" only then), else null. */
  amountDue: string | null;
  entries: readonly {
    date: string;
    number: string;
    kind: StatementLineKind;
    /** A credit or debit note's invoice ("Credit note against {number}", "Debit note against {number}"); null when the view has none. */
    againstNumber: string | null;
    /** Null for the side a line is not on. */
    debit: string | null;
    credit: string | null;
    balance: string;
  }[];
  /** The day the PDF was made (IST), as the PDFs write dates. */
  generatedOn: string;
  /** The address statements are sent from and asked about (billing@). */
  email: string;
  /** The page footer's left line (`footerLine(email)`). */
  footerBrand: string;
};

const p = (cls: string, text: string, attrs = "") => `<p class="${cls}"${attrs}>${esc(text)}</p>`;

/** A formatted amount with its currency sign in its own span (the visual suite asks the font of that glyph). */
function amountHtml(value: string): string {
  const sign = value.includes("₹") ? "₹" : value.includes("$") ? "$" : null;
  if (sign === null) return esc(value);
  const at = value.indexOf(sign);
  const testid = sign === "₹" ? "rupee" : "currency-symbol";
  return `${esc(value.slice(0, at))}<span data-testid="${testid}">${sign}</span>${esc(value.slice(at + 1))}`;
}

/**
 * The words of a line's "Details" (07-V §6): a credit note names its invoice when the view has the number, else it reads "" (nothing is guessed). A debit note names
 * its invoice too when the view has the number (FX-4, full audit A5 7), else it keeps 07-V's "Debit note".
 */
export function detailsOf(kind: StatementLineKind, againstNumber: string | null): string {
  if (kind === "credit_note") return againstNumber ? C.kinds.credit_note(againstNumber) : "";
  if (kind === "debit_note" && againstNumber) return C.kinds.debitNoteAgainst(againstNumber);
  return C.kinds[kind];
}

function logoHtml(view: StatementLayoutView): string {
  const logos = PDF_LOGOS as Record<string, string | undefined>;
  return `<div class="masthead__logo">${logos[view.logo] ?? logos["logo-primary-color.svg"] ?? ""}</div>`;
}

function header(view: StatementLayoutView): string {
  const from = `<div class="party"><p class="label">${esc(C.from)}</p>${p("party__name", view.company.name)}${view.company.lines
    .map((l) => p("party__line", l))
    .join("")}</div>`;
  const to = `<div class="party">${p("party__name stm-client", view.client.name)}${view.client.lines
    .map((l) => p("party__line", l))
    .join("")}</div>`;
  const doc = `<div class="party party--doc stm-doc">${p("stm-period", C.period(view.period.from, view.period.to), ' data-testid="period"')}${p(
    "stm-currency",
    C.currency(view.currency),
  )}</div>`;
  return `<header class="masthead">${logoHtml(view)}<h1 class="masthead__title">${esc(C.title)}</h1></header>
<section class="parties" aria-label="${esc(C.title)}">${from}${to}${doc}</section>`;
}

/** The four figures, the closing one on the double rule; "Amount due" beside them only when something is owed. */
function balances(view: StatementLayoutView): string {
  const fig = (label: string, value: string, cls: string, testid: string) =>
    `<div class="stm-fig ${cls}"><dt>${esc(label)}</dt><dd data-testid="${testid}">${amountHtml(value)}</dd></div>`;
  const due = view.amountDue ? p("stm-due", C.amountDue(view.amountDue), ' data-testid="amount-due"') : "";
  return `<section class="stm-band"><dl class="stm-figs">${fig(C.opening, view.opening, "", "opening")}${fig(
    C.debits,
    view.debits,
    "",
    "debits",
  )}${fig(C.credits, view.credits, "", "credits")}${fig(C.closing, view.closing, "stm-fig--closing", "closing")}</dl>${due}</section>`;
}

function ledger(view: StatementLayoutView): string {
  const K = C.columns;
  const th = (cls: string, text: string) => `<th scope="col" class="${cls}">${esc(text)}</th>`;
  const head = `<tr>${th("c-date", K.date)}${th("c-doc", K.document)}${th("c-details", K.details)}${th("num c-amt", K.debit)}${th(
    "num c-amt",
    K.credit,
  )}${th("num c-bal", K.balance)}</tr>`;
  const cell = (v: string | null) => `<td class="num">${v === null ? "" : esc(v)}</td>`;
  const edge = (date: string, label: string, balance: string, cls: string) =>
    `<tr class="${cls}"><td class="c-date">${esc(date)}</td><td></td><th scope="row" class="c-details">${esc(label)}</th><td class="num"></td><td class="num"></td><td class="num">${esc(balance)}</td></tr>`;
  const rows = view.entries
    .map(
      (e) =>
        `<tr data-testid="entry"><td class="c-date">${esc(e.date)}</td><td class="c-doc">${esc(e.number)}</td><td class="c-details">${esc(
          detailsOf(e.kind, e.againstNumber),
        )}</td>${cell(e.debit)}${cell(e.credit)}<td class="num">${esc(e.balance)}</td></tr>`,
    )
    .join("");
  return `<table class="grid stm-ledger"><thead>${head}</thead><tbody>${edge(view.period.from, C.opening, view.opening, "stm-edge")}${rows}${edge(
    view.period.to,
    C.closing,
    view.closing,
    "stm-edge stm-edge--closing",
  )}</tbody></table>`;
}

/** The body of a statement (inside `<body>`). */
export function statementBody(view: StatementLayoutView): string {
  return `<div class="doc doc--statement">${header(view)}
${balances(view)}
${ledger(view)}
<footer class="stm-foot">${p("stm-questions", C.questions(view.email))}${p("stm-generated", C.generatedOn(view.generatedOn), ' data-testid="generated"')}</footer></div>`;
}

/** The symbol mark as a data URI for the page footer (the only image a margin box can carry). */
const SYMBOL_URI = `data:image/svg+xml,${encodeURIComponent(PDF_SYMBOL)}`;

/** The page footer of a statement: the symbol and the billing@ line on the left; the client's code with "Page X of Y" on the right. */
export function statementPageCss(view: StatementLayoutView): string {
  return `@page {
  @bottom-left {
    content: ${cssString(view.footerBrand)};
    padding-left: 6mm;
    background: url("${SYMBOL_URI}") no-repeat left center / 3.6mm 3.6mm;
    font-family: var(--font-sans);
    font-size: var(--print-small);
    font-weight: 400;
    line-height: 1;
    color: var(--color-text-muted);
    vertical-align: middle;
    width: 120mm;
  }
  @bottom-right {
    content: ${cssString(`${view.clientCode}   ${C.page.word} `)} counter(page) ${cssString(` ${C.page.of} `)} counter(pages);
    white-space: pre;
    font-family: var(--font-sans);
    font-size: var(--print-small);
    font-weight: 400;
    font-variant-numeric: tabular-nums lining-nums;
    line-height: 1;
    color: var(--color-text-muted);
    text-align: right;
    vertical-align: middle;
  }
}`;
}

/**
 * What the statement adds to the shared template CSS (./styles.ts), all under `.doc--statement`. Sizes, colours and fonts are the print tokens; the
 * lengths are column widths and spacing on the 178 mm text width. Bold is 600 (the fonts stop there).
 */
export const STATEMENT_CSS = `
.doc--statement { font-size: var(--print-body); line-height: var(--print-body-leading); }
.doc--statement .stm-client { margin-top: calc(var(--print-small) * 1.3 + 1.6mm); }
.doc--statement .stm-doc { text-align: right; }
.doc--statement .stm-period {
  margin: 0 0 1.2mm;
  font-size: var(--print-body);
  line-height: 1.3;
  font-weight: 600;
  font-variant-numeric: tabular-nums lining-nums;
}
.doc--statement .stm-currency { margin: 0; color: var(--color-text-muted); }

/* the four figures, read across; the closing one on the double rule */
.doc--statement .stm-band {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 6mm;
  margin: 5mm 0 6mm;
  break-inside: avoid;
}
.doc--statement .stm-figs {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  column-gap: var(--print-gutter);
  margin: 0;
}
.doc--statement .stm-fig dt { margin: 0 0 0.8mm; font-size: var(--print-small); line-height: 1.3; font-weight: 600; color: var(--color-text-muted); }
.doc--statement .stm-fig dd {
  margin: 0;
  font-size: var(--print-totals);
  line-height: 1.2;
  font-weight: 500;
  font-variant-numeric: tabular-nums lining-nums;
  white-space: nowrap;
}
.doc--statement .stm-fig--closing dd {
  display: inline-block;
  font-weight: 600;
  padding-bottom: 0.6mm;
  border-bottom: 0.9mm double var(--color-text);
}
.doc--statement .stm-due {
  flex: none;
  margin: 0;
  padding: 2mm 3.4mm;
  border: 0.3mm solid var(--color-text);
  font-size: var(--print-totals);
  line-height: 1.2;
  font-weight: 600;
  font-variant-numeric: tabular-nums lining-nums;
  white-space: nowrap;
}

/* the ledger: Date · Document · Details · Debit · Credit · Balance */
.doc--statement .stm-ledger .c-date { width: 19mm; white-space: nowrap; font-variant-numeric: tabular-nums lining-nums; }
.doc--statement .stm-ledger .c-doc { width: 36mm; white-space: nowrap; font-variant-numeric: tabular-nums lining-nums; }
.doc--statement .stm-ledger .c-details { overflow-wrap: anywhere; }
.doc--statement .stm-ledger tbody th { font-weight: 400; border-bottom: 0.2mm solid var(--color-border); }
.doc--statement .stm-ledger .c-amt { width: 26mm; }
.doc--statement .stm-ledger .c-bal { width: 28mm; }
.doc--statement .stm-ledger tbody td.num:last-child { font-weight: 500; }
.doc--statement .stm-ledger .stm-edge td,
.doc--statement .stm-ledger .stm-edge th { color: var(--color-text-muted); font-weight: 500; }
.doc--statement .stm-ledger .stm-edge--closing td,
.doc--statement .stm-ledger .stm-edge--closing th {
  color: var(--color-text);
  font-weight: 600;
  border-top: 0.3mm solid var(--color-text);
  border-bottom: 0.9mm double var(--color-text);
}

.doc--statement .stm-foot { margin-top: 6mm; font-size: var(--print-table); line-height: 1.4; break-inside: avoid; }
.doc--statement .stm-foot p { margin: 0 0 1mm; }
.doc--statement .stm-generated { color: var(--color-text-muted); }
`;

/** The whole HTML document of a statement (the same page rules as every document: inline fonts and CSS, no network). */
export function renderStatementHtml(view: StatementLayoutView): string {
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">
<title>${esc(view.title)}</title>
<style>
${TECHAUST_PDF_FONT_DATA}
${PDF_PRINT_CSS}
${TEMPLATE_CSS}
${STATEMENT_CSS}
${statementPageCss(view)}
</style>
</head>
<body>
${statementBody(view)}
</body>
</html>
`;
}
