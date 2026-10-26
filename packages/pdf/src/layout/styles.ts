// Template CSS of the proposal and estimate layout (M4.4; docs/06 §7.1 to §7.4). Colours, sizes and fonts come from the print.css
// custom properties (packages/ui tokens); the only lengths written here are the page geometry of §7.1 (the 12-column grid on the
// 178 mm text width, 4 mm gutters) and spacing. Bold is 600, never 700 (the fonts stop at 600). No url() except data: URIs and no
// @import: everything is inline (the CSP of render.ts refuses anything else).
//
// Page breaks (06 §7.1, §7.4):
// - table headers repeat (print.css), rows never split (print.css), the totals block and each small table stay whole;
// - a heading always stays with its first block (`.sec__head` is unbreakable);
// - "a proposal section starts on a new page only if less than 40 % of the current page remains" has no CSS equivalent. It is
//   approximated: a proposal's `.sec__head` reserves 95 mm of empty padding under itself (taken back with a negative margin), so the
//   heading moves to the next page when less than about 40 % of the 263 mm text height is left below it. Short sections near the end
//   of a page therefore also move, as the rule asks; orphans and widows keep at least 3 lines together.
import { PDF_SYMBOL } from "../generated/assets.ts";
import type { PdfView } from "../types.ts";
import { PDF_COPY as C } from "./copy.ts";

/** The symbol mark as a data URI for the page footer (the only image a margin box can carry). Built once per isolate. */
const SYMBOL_URI = `data:image/svg+xml,${encodeURIComponent(PDF_SYMBOL)}`;

/** A CSS string literal: every character that could end the string, the rule or the style element is written as a hex escape. */
export function cssString(s: string): string {
  return `"${s.replace(/[\\"'\n\r\f<>&]/g, (c) => `\\${(c.codePointAt(0) as number).toString(16)} `)}"`;
}

/** The page footer of one document, in CSS page-margin boxes (every page): the symbol and the 07-P line on the left; the number and
 * version with "Page X of Y" on the right. */
export function pageCss(view: PdfView): string {
  const number = `${view.numberDisplay} v${view.version}`;
  return `@page {
  @bottom-left {
    content: ${cssString(C.footer.brand)};
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
    content: ${cssString(`${number}   ${C.page.word} `)} counter(page) ${cssString(` ${C.page.of} `)} counter(pages);
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

export const TEMPLATE_CSS = `
html { font-kerning: normal; text-rendering: optimizeLegibility; }
body { margin: 0; font-weight: 400; overflow-wrap: break-word; }
strong, b, th { font-weight: 600; }
p { margin: 0 0 2.4mm; orphans: 3; widows: 3; text-wrap: pretty; }
p:last-child { margin-bottom: 0; }
ul, ol { margin: 0 0 2.4mm; padding-left: 5mm; }
ul:last-child, ol:last-child { margin-bottom: 0; }
li { margin: 0 0 1mm; padding-left: 0.6mm; break-inside: avoid; }
li::marker { color: var(--color-text-muted); }
a { color: inherit; text-decoration: underline; text-decoration-thickness: 0.15mm; text-underline-offset: 0.5mm; }
code, pre { font-family: var(--font-mono); font-size: var(--print-small); }
pre { white-space: pre-wrap; margin: 0 0 2.4mm; }
h1, h2, h3 { margin: 0; }

.doc--proposal { font-size: var(--print-proposal-body); line-height: var(--print-proposal-leading); }

/* the block label ("From", "Prepared for", "Document"): sentence case, small, muted; it names the block, nothing more */
.label, .cover__for-label {
  font-size: var(--print-small);
  line-height: 1.3;
  font-weight: 600;
  color: var(--color-text-muted);
  margin: 0 0 1.6mm;
}

/* ---- the shared header (06 §7.2) ---- */
.masthead {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 8mm;
  padding-bottom: 4mm;
  border-bottom: var(--print-swoosh-rule) solid var(--color-accent-decor);
  margin: 0 0 5mm;
}
.masthead__logo { width: var(--print-logo-width); flex: none; margin: 0; }
.masthead__logo svg { display: block; width: 100%; height: auto; }
.masthead__title {
  font-family: var(--font-display);
  font-stretch: 116%;
  font-weight: 560;
  font-size: var(--print-title);
  line-height: 1;
  color: var(--color-text);
  margin: 0;
  text-align: right;
}

.parties {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  column-gap: var(--print-gutter);
  padding-bottom: 5mm;
  border-bottom: 0.2mm solid var(--color-border);
  break-inside: avoid;
  font-size: var(--print-table);
  line-height: 1.4;
}
.party { grid-column: span 4; min-width: 0; }
.party--doc { grid-column: 9 / -1; }
.party__name { font-weight: 600; font-size: var(--print-body); line-height: var(--print-body-leading); margin: 0 0 0.8mm; overflow-wrap: anywhere; }
.party__line { margin: 0; overflow-wrap: anywhere; }
.keep { white-space: nowrap; }
.party__attention { margin-top: 1.6mm; }
.status {
  display: inline-block;
  margin-left: 1.6mm;
  padding: 0 1.2mm;
  border: 0.2mm solid currentColor;
  border-radius: 0.8mm;
  font-weight: 500;
}
.facts { margin: 0; display: grid; grid-template-columns: auto 1fr; column-gap: 3mm; row-gap: 0.4mm; }
.facts div { display: contents; }
.facts dt { color: var(--color-text-muted); }
.facts dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums lining-nums; white-space: nowrap; }

.doc-title {
  font-family: var(--font-display);
  font-stretch: 116%;
  font-weight: 560;
  font-size: 13pt;
  line-height: 1.25;
  margin: 6mm 0 0;
  max-width: 132mm;
  text-wrap: balance;
}
.notice {
  margin: 4mm 0 0;
  padding: 1.4mm 0 1.4mm 3mm;
  border-left: 0.8mm solid var(--color-text);
  font-weight: 600;
}

/* ---- sections: the heading in the first 3 of 12 columns, the text in the other 9 ---- */
.sec { margin-top: 8mm; }
.sec__head {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  column-gap: var(--print-gutter);
  break-inside: avoid;
}
.sec__head h2 {
  grid-column: 1 / span 3;
  font-family: var(--font-display);
  font-stretch: 116%;
  font-weight: 560;
  font-size: 11pt;
  line-height: 14pt;
  text-wrap: balance;
  padding-right: 2mm;
}
.sec__first { grid-column: 4 / -1; min-width: 0; }
.sec__text { margin-left: calc((100% + var(--print-gutter)) / 4); margin-top: 2.4mm; }
.sec__wide { margin-top: 5mm; }
.doc--proposal .sec { margin-top: 10mm; }
.doc--proposal .sec__head { padding-bottom: 95mm; margin-bottom: -95mm; }

/* ---- the money ---- */
table.grid { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: var(--print-table); line-height: 1.35; }
.grid th, .grid td { padding: 1.5mm 1.4mm; text-align: left; vertical-align: top; }
.grid th:first-child, .grid td:first-child { padding-left: 0; }
.grid th:last-child, .grid td:last-child { padding-right: 0; }
.grid thead th {
  font-size: var(--print-small);
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-text-muted);
  vertical-align: bottom;
  border-bottom: 0.3mm solid var(--color-text);
}
.grid tbody td { border-bottom: 0.2mm solid var(--color-border); }
.grid .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums lining-nums; }
.grid .sub { display: block; margin-top: 0.4mm; font-size: var(--print-small); color: var(--color-text-muted); }
.desc { font-weight: 500; }
.items .c-n { width: 6mm; color: var(--color-text-muted); }
.items .c-qty { width: 10mm; }
.items .c-unit { width: 13mm; }
.items .c-rate { width: 22mm; }
.items .c-disc { width: 15mm; }
.items .c-taxable { width: 25mm; }
.items .c-gst { width: 11mm; }
.items .c-desc { overflow-wrap: anywhere; }

.totals {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  column-gap: var(--print-gutter);
  margin-top: 4mm;
  break-inside: avoid;
}
.totals__notes { grid-column: 1 / span 7; font-size: var(--print-table); line-height: 1.4; }
.totals__notes .words { font-weight: 500; margin-bottom: 2mm; }
.totals__notes .note { color: var(--color-text-muted); font-size: var(--print-small); margin-bottom: 1mm; }
.totals__table { grid-column: 8 / -1; width: 100%; border-collapse: collapse; font-size: var(--print-table); }
.totals__table th, .totals__table td { padding: 0.6mm 0; vertical-align: baseline; }
.totals__table th { text-align: left; font-weight: 400; color: var(--color-text-muted); }
.totals__table td { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums lining-nums; }
.totals__table .grand th, .totals__table .grand td { border-top: 0.4mm solid var(--color-text); padding-top: 2mm; color: var(--color-text); }
.totals__table .grand th { font-size: var(--print-totals); font-weight: 600; }
.totals__table .grand td { font-size: var(--print-grand-total); font-weight: 600; line-height: 1.1; }

.block { margin-top: 6mm; break-inside: avoid; }
.block h3 { font-size: var(--print-body); line-height: var(--print-body-leading); font-weight: 600; margin: 0 0 1.6mm; break-after: avoid; }
.summary .c-rate { width: 16mm; }
.summary .c-amt { width: 30mm; }
.schedule .c-share { width: 16mm; }
.schedule .c-amount { width: 30mm; }
.timeline { margin-top: 3mm; }
.timeline .c-date { width: 22mm; }
.timeline .c-pay { width: 16mm; }

/* ---- terms ---- */
.terms { font-size: var(--print-table); line-height: 1.45; }
.terms__line { margin-bottom: 2.4mm; }

/* ---- the acceptance box: an ink outline with the mark's 45° cut on its top-right corner ---- */
.accept {
  position: relative;
  margin-top: 3mm;
  padding: 5mm 12mm 5mm 5mm;
  border: 0.4mm solid var(--color-text);
  clip-path: polygon(0 0, calc(100% - 7mm) 0, 100% 7mm, 100% 100%, 0 100%);
  break-inside: avoid;
}
.accept::after {
  content: "";
  position: absolute;
  top: -0.4mm;
  left: calc(100% - 6.6mm);
  width: 10.4mm;
  height: 0.4mm;
  background: var(--color-text);
  transform-origin: 0 0;
  transform: rotate(45deg);
}
.accept__online { font-weight: 600; margin-bottom: 1.6mm; }
.accept__link { font-weight: 600; white-space: nowrap; }
.accept__record { color: var(--color-text-muted); font-size: var(--print-table); margin: 0; }

/* ---- the last line ---- */
.integrity {
  margin: 10mm 0 0;
  padding-top: 2mm;
  border-top: 0.2mm solid var(--color-border);
  font-size: var(--print-small);
  line-height: 1.4;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums lining-nums;
  break-inside: avoid;
}

/* ---- the proposal cover (06 §7.4: a full page) ---- */
.cover { height: 262mm; display: flex; flex-direction: column; break-after: page; }
.cover .masthead { margin-bottom: 0; }
.cover__main { margin-top: 62mm; max-width: 140mm; }
.cover__title {
  font-family: var(--font-display);
  font-stretch: 116%;
  font-weight: 560;
  font-size: var(--print-proposal-title);
  line-height: 1.08;
  letter-spacing: -0.01em;
  text-wrap: balance;
  overflow-wrap: anywhere;
}
.cover__lede { margin-top: 8mm; max-width: 120mm; font-size: 12pt; line-height: 17pt; }
.cover__facts {
  margin-top: auto;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  column-gap: var(--print-gutter);
  padding-top: 5mm;
  border-top: 0.2mm solid var(--color-border);
}
.cover__for { grid-column: 1 / span 7; margin: 0; }
.cover__for-label { display: block; }
.cover__client {
  display: block;
  font-family: var(--font-display);
  font-stretch: 116%;
  font-weight: 560;
  font-size: 14pt;
  line-height: 1.2;
  text-wrap: balance;
  overflow-wrap: anywhere;
}
.cover__meta { grid-column: 9 / -1; list-style: none; margin: 0; padding: 0; font-variant-numeric: tabular-nums lining-nums; }
.cover__meta li { margin: 0 0 0.6mm; padding: 0; }
.cover__contact { grid-column: 1 / -1; margin: 6mm 0 0; color: var(--color-text-muted); font-size: var(--print-table); }
`;
