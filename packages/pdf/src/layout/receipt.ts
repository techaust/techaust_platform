// M6.5 (ADM-PAY-09, JOB-PDF-01; run file D, G8, L4): the payment receipt's PDF, in the house system of every document (docs/06 §7.1 to §7.3): the A4 page and its
// 12 columns, the shared masthead (logo, title, the verdigris rule), the party blocks, ink on white, tabular figures, the page footer in the margin boxes.
// What is the receipt's own:
//   - the third header block is its identity: the receipt number and date as two facts (the number outside the seal, as an invoice's);
//   - one band says what the page is about: the amount received, large, on the accountant's double rule (the closing figure of a ledger, as the statement's
//     closing balance), the amount in words under it, and how the money came (received on, paid by, reference) as facts beside it;
//   - "Applied to" is a ledger of the invoices the money went on (Invoice · Amount), at most 50 lines with "and {n} more" under them; the credit the payment
//     leaves closes it as its last row, on a hairline, so the column always adds up to the amount above;
//   - the closing line says what the page is not: "This is a receipt for a payment we received. It is not a tax invoice." and "Computer-generated receipt."
//     It never stands alone on a page (`break-before: avoid`, the #160 rule) and it is the last block.
// Never a tax document and never titled a voucher: no tax line, no GST summary, no HSN/SAC, no place of supply (Researched 2026-11-03, s.31(3)(d) CGST Act and Rule
// 50 CGST Rules (08-C RA-39)). No signature block and no stamp, and no line claims either (OPEN (08-C RB-21): is an emailed, computer-generated receipt
// chargeable to stamp duty? So no claim either way). The words are 07-ZO's (`RECEIPT_COPY`, `@techaust/core/copy-zo`; "[Placeholder]" until the owner approves).
//
// No logic beyond formatting: every value is a pre-formatted string of `receiptView` (../receipt-view.ts); every dynamic string goes through `esc`; nothing is
// loaded from outside (the CSP). The contract the tests rely on: data-testid="receipt-title", "receipt-number", "receipt-amount", "receipt-words",
// "receipt-applied" (one per line), "receipt-more", "receipt-credit", "receipt-notice", "rupee" / "currency-symbol" (the visual suite's glyph check).
import { RECEIPT_COPY } from "@techaust/core/copy-zo";
import { esc } from "../escape.ts";
import { PDF_LOGOS, PDF_PRINT_CSS, PDF_SYMBOL, TECHAUST_PDF_FONT_DATA } from "../generated/assets.ts";
import { PDF_COPY } from "./copy.ts";
import { cssString, TEMPLATE_CSS } from "./styles.ts";

/** True while the page is the builder's placeholder. The designer's layout (2026-11-03) is the real page: receipts render and are stored everywhere. */
export const RECEIPT_LAYOUT_PLACEHOLDER = false;
/** The page's layout id (core `RECEIPT_LAYOUT_ID` is the id of the SEALED data shape; this is the page's, logged with each render). */
export const RECEIPT_PDF_LAYOUT_ID = "receipt-page-1";

const DOCUMENT_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

/** What the page prints, every value already formatted (`receiptView`). */
export type ReceiptLayoutView = {
  number: string;
  issuedOn: string;
  issuer: { name: string; lines: readonly string[] };
  receivedFrom: { name: string; gstin: string | null };
  amount: string;
  amountWords: string;
  receivedOn: string;
  paidBy: string;
  reference: string | null;
  appliedTo: readonly { number: string; amount: string }[];
  appliedMore: number;
  heldAsCredit: string | null;
  /** The brand logo file (the default colour logo when absent). */
  logo?: string | undefined;
  /** The page footer's left line (`footerLine(email)`); none when absent. */
  footerBrand?: string | undefined;
};

/** A formatted amount with its currency sign in its own span (the visual suite asks the font of that glyph). */
function amountHtml(value: string): string {
  const sign = value.includes("₹") ? "₹" : value.includes("$") ? "$" : null;
  if (sign === null) return esc(value);
  const at = value.indexOf(sign);
  const testid = sign === "₹" ? "rupee" : "currency-symbol";
  return `${esc(value.slice(0, at))}<span data-testid="${testid}">${sign}</span>${esc(value.slice(at + 1))}`;
}

const fact = (label: string, value: string, testid = "") =>
  `<div><dt>${esc(label)}</dt><dd${testid ? ` data-testid="${testid}"` : ""}>${esc(value)}</dd></div>`;

function header(v: ReceiptLayoutView): string {
  const C = RECEIPT_COPY;
  const logos = PDF_LOGOS as Record<string, string | undefined>;
  const logo = logos[v.logo ?? ""] ?? logos["logo-primary-color.svg"] ?? "";
  const issuer = `<div class="party"><p class="party__name">${esc(v.issuer.name)}</p>${v.issuer.lines
    // each " · " part on its own line, wrapping inside the column (a long address never runs into the next block)
    .flatMap((l) => l.split(" · "))
    .map((l) => `<p class="party__line">${esc(l)}</p>`)
    .join("")}</div>`;
  const client = `<div class="party"><p class="label">${esc(C.receivedFrom)}</p><p class="party__name">${esc(v.receivedFrom.name)}</p>${
    v.receivedFrom.gstin ? `<p class="party__line">GSTIN ${esc(v.receivedFrom.gstin)}</p>` : ""
  }</div>`;
  const doc = `<div class="party party--doc"><dl class="facts rct-ids">${fact(C.number, v.number, "receipt-number")}${fact(C.date, v.issuedOn)}</dl></div>`;
  return `<header class="masthead"><div class="masthead__logo">${logo}</div><h1 class="masthead__title" data-testid="receipt-title">${esc(C.title)}</h1></header>
<section class="parties" aria-label="${esc(C.title)}">${issuer}${client}${doc}</section>`;
}

/** The amount received on the double rule, its words, and how it came. */
function band(v: ReceiptLayoutView): string {
  const C = RECEIPT_COPY;
  return `<section class="rct-band">
<div class="rct-amount"><p class="label">${esc(C.amountReceived)}</p><p class="rct-amount__figure" data-testid="receipt-amount">${amountHtml(v.amount)}</p>
<p class="label rct-words__label">${esc(C.amountInWords)}</p><p class="rct-words" data-testid="receipt-words">${esc(v.amountWords)}</p></div>
<dl class="rct-how">${fact(C.receivedOn, v.receivedOn)}${fact(C.paidBy, v.paidBy)}${v.reference ? fact(C.reference, v.reference) : ""}</dl>
</section>`;
}

/**
 * "Applied to" and the closing line. The invoices the money went on, then the credit it leaves as the closing row. The page-break rule (#160): the last invoice
 * line, "and {n} more", the credit row and the closing line are one unbreakable block (`.rct-close`), so the closing line always ends a page that holds more
 * than itself; the lines before them are an ordinary table whose header repeats on every page. When there is only one line, the heading and the column header
 * go into that block too, so they never stand alone at the foot of a page.
 */
function appliedAndClose(v: ReceiptLayoutView): string {
  const C = RECEIPT_COPY;
  const line = (a: { number: string; amount: string }) =>
    `<tr data-testid="receipt-applied"><td class="c-inv">${esc(a.number)}</td><td class="num">${amountHtml(a.amount)}</td></tr>`;
  const head = `<thead><tr><th scope="col" class="c-inv">${esc(C.invoice)}</th><th scope="col" class="num c-amt">${esc(C.amount)}</th></tr></thead>`;
  const title = `<h2 class="rct-h">${esc(C.appliedTo)}</h2>`;
  const notice = `<p class="rct-notice" data-testid="receipt-notice"><span>${esc(C.notTaxInvoice)}</span><span>${esc(C.computerGenerated)}</span></p>`;
  const lines = v.appliedTo;
  const before = lines.slice(0, -1);
  const last = lines.at(-1);
  // The tail is drawn as rows of blocks, not table rows: Chromium breaks between table rows even inside an unbreakable block, never inside a block row.
  const tailRow = (cls: string, testid: string, left: string, right: string) =>
    `<div class="rct-row ${cls}" data-testid="${testid}"><span class="rct-row__inv">${left}</span><span class="rct-row__amt">${right}</span></div>`;
  const tail = [
    last && before.length > 0
      ? tailRow("", "receipt-applied", esc(last.number), amountHtml(last.amount))
      : "",
    v.appliedMore > 0 ? tailRow("rct-more", "receipt-more", esc(C.appliedMore(v.appliedMore)), "") : "",
    v.heldAsCredit === null
      ? ""
      : tailRow("rct-credit", "receipt-credit", esc(C.heldAsCredit), amountHtml(v.heldAsCredit)),
  ].join("");
  const main =
    before.length > 0
      ? `<section class="rct-applied">${title}<table class="grid rct-grid">${head}<tbody>${before.map(line).join("")}</tbody></table></section>`
      : "";
  // A single line keeps its heading and column header with it, inside the unbreakable block.
  const single =
    before.length === 0 && last
      ? `${title}<table class="grid rct-grid">${head}<tbody>${line(last)}</tbody></table>`
      : "";
  return `${main}<div class="rct-close">${single}${tail}${notice}</div>`;
}

/** The symbol mark as a data URI for the page footer (the only image a margin box can carry). */
const SYMBOL_URI = `data:image/svg+xml,${encodeURIComponent(PDF_SYMBOL)}`;

/** The page footer: the symbol and the brand line on the left; the receipt number with "Page X of Y" on the right. */
export function receiptPageCss(v: ReceiptLayoutView): string {
  const P = PDF_COPY.page;
  const left = v.footerBrand
    ? `@bottom-left {
    content: ${cssString(v.footerBrand)};
    padding-left: 6mm;
    background: url("${SYMBOL_URI}") no-repeat left center / 3.6mm 3.6mm;
    font-family: var(--font-sans);
    font-size: var(--print-small);
    font-weight: 400;
    line-height: 1;
    color: var(--color-text-muted);
    vertical-align: middle;
    width: 120mm;
  }`
    : "";
  return `@page {
  ${left}
  @bottom-right {
    content: ${cssString(`${v.number}   ${P.word} `)} counter(page) ${cssString(` ${P.of} `)} counter(pages);
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
 * What the receipt adds to the shared template CSS (./styles.ts), all under `.doc--receipt`. Sizes, colours and fonts are the print tokens; the lengths are
 * column widths and spacing on the 178 mm text width. Bold is 600 (the fonts stop there).
 */
export const RECEIPT_CSS = `
.doc--receipt { font-size: var(--print-body); line-height: var(--print-body-leading); }
.doc--receipt .rct-ids { row-gap: 1mm; }
.doc--receipt .rct-ids dd { font-weight: 600; }

/* the band: the amount on the double rule with its words (7 of 12 columns), how it came beside it (the last 4) */
.doc--receipt .rct-band {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  column-gap: var(--print-gutter);
  align-items: start;
  margin: 7mm 0 8mm;
  break-inside: avoid;
}
.doc--receipt .rct-amount { grid-column: 1 / span 7; min-width: 0; }
.doc--receipt .rct-amount__figure {
  display: inline-block;
  margin: 0 0 4mm;
  padding-bottom: 1mm;
  border-bottom: 0.9mm double var(--color-text);
  font-family: var(--font-display);
  font-stretch: 116%;
  font-weight: 560;
  font-size: var(--print-title);
  line-height: 1.1;
  font-variant-numeric: tabular-nums lining-nums;
  white-space: nowrap;
}
.doc--receipt .rct-words__label { margin-bottom: 0.8mm; }
.doc--receipt .rct-words { margin: 0; font-weight: 500; max-width: 104mm; text-wrap: pretty; overflow-wrap: anywhere; }
.doc--receipt .rct-how {
  grid-column: 8 / -1;
  margin: 0;
  padding-left: 4mm;
  border-left: 0.2mm solid var(--color-border);
  font-size: var(--print-table);
  line-height: 1.4;
}
.doc--receipt .rct-how div { margin: 0 0 2.4mm; break-inside: avoid; }
.doc--receipt .rct-how div:last-child { margin-bottom: 0; }
.doc--receipt .rct-how dt { font-size: var(--print-small); line-height: 1.3; font-weight: 600; color: var(--color-text-muted); margin: 0 0 0.4mm; }
.doc--receipt .rct-how dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums lining-nums; }

/* "Applied to": the invoices, then the credit left as the closing row */
.doc--receipt .rct-h {
  font-size: var(--print-body);
  line-height: var(--print-body-leading);
  font-weight: 600;
  margin: 0 0 1.6mm;
  break-after: avoid;
}
.doc--receipt .rct-grid .c-inv { overflow-wrap: anywhere; font-variant-numeric: tabular-nums lining-nums; }
.doc--receipt .rct-grid .c-amt { width: 36mm; }
.doc--receipt .rct-grid thead { break-after: avoid; }
/* the tail rows: the table's row in blocks (same padding, rule and figures) */
.doc--receipt .rct-row {
  display: flex;
  justify-content: space-between;
  gap: 4mm;
  padding: 1.5mm 0;
  border-bottom: 0.2mm solid var(--color-border);
  font-size: var(--print-table);
  line-height: 1.35;
}
.doc--receipt .rct-row__inv { min-width: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums lining-nums; }
.doc--receipt .rct-row__amt { flex: none; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums lining-nums; }
.doc--receipt .rct-more { color: var(--color-text-muted); }
.doc--receipt .rct-credit {
  border-top: 0.3mm solid var(--color-text);
  border-bottom: 0;
  margin-top: -0.2mm;
  padding-top: 2mm;
  font-weight: 600;
}

/* the last line, "and n more", the credit and the closing line: one block, so the closing line never stands alone on a page */
.doc--receipt .rct-close { break-inside: avoid; break-before: avoid; }
/* the closing line: what this page is, and is not; it ends the last page */
.doc--receipt .rct-notice {
  margin: 10mm 0 0;
  padding-top: 2mm;
  border-top: 0.2mm solid var(--color-border);
  font-size: var(--print-small);
  line-height: 1.4;
  color: var(--color-text-muted);
  break-inside: avoid;
  break-before: avoid;
}
.doc--receipt .rct-notice span { display: block; }
`;

/** The body of a receipt (inside `<body>`). */
export function receiptBody(v: ReceiptLayoutView): string {
  return `<div class="doc doc--receipt">${header(v)}
${band(v)}
${appliedAndClose(v)}</div>`;
}

/** The whole HTML document of a receipt's PDF (the same page rules as every document: inline fonts and CSS, no network). */
export function renderReceiptHtml(v: ReceiptLayoutView): string {
  const C = RECEIPT_COPY;
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">
<title>${esc(`${C.title} ${v.number}`)}</title>
<style>
${TECHAUST_PDF_FONT_DATA}
${PDF_PRINT_CSS}
${TEMPLATE_CSS}
${RECEIPT_CSS}
${receiptPageCss(v)}
</style>
</head>
<body>
${receiptBody(v)}
</body>
</html>
`;
}
