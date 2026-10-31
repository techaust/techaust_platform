// T11: the deed of assignment's unsigned PDF (run file docs/runs/t11-deed.md, L4, L5; 08-C RB-38(a), RB-21), in the house document system of docs/06 §7: A4, the
// logo over the verdigris rule, Archivo Expanded for the title and the Schedule headings, Archivo for the rest, ink on white, legible in grayscale.
//
// The page reads as an instrument, not a form: the title and its number; the parties as one lede paragraph; clauses 1 to 8 with their numbers hanging in the
// first of the 12 columns and the heading run into the text (as 07-ZE writes them); the signature sentence, then the EMPTY space the eSign provider's own
// signature appearance goes into, marked only by four corner ticks (the top-right one is the mark's 45° cut), never by words; then Schedules 1 and 2; and,
// last, the stamp-duty line in the small closing style the other documents give their final line (06 §7.1 "Integrity"). The deed proper fits page 1; the
// Schedules may run onto page 2 (a Schedule's heading never sits alone at the foot of a page). The page footer is the house one: the symbol and the 07-P line
// on the left, the deed number with "Page X of Y" on the right.
//
// Words: every sentence is core `deedText`'s (07-ZE, approved word for word). The layout adds no words of its own except the footer (07-P, ./copy.ts) and,
// once approved, the Schedule labels of 07-ZJ line 2 (`DEED_PDF_COPY`); until then the values print without labels, so no "[Placeholder]" is ever stored in a
// write-once PDF. 07-ZJ line 1 (lead decision 5): the signature sentence ends "TecHaust Technologies." with the space below it. The title's " · " becomes a
// line break between the title and its number (the words are unchanged; the PDF's metadata title keeps the whole line).
//
// L5: the signature space is left empty: the eSign provider's signature appearance carries the time and the transaction inside the signed copy, and the admin
// and portal show the stored values next to it. The footer line: OPEN (08-C RB-21): West Bengal stamp duty on a deed of assignment of copyright was not read.
//
// The contract the tests rely on: data-testid="deed-title", "deed-number", "deed-parties", "deed-clause" (one per clause), "deed-signature",
// "deed-sign-space" (empty), "deed-schedule" (two), "deed-footer", and "rupee" on the amount's ₹ (the visual suite asks its font). Every value goes through
// `esc`; nothing is loaded from outside (the page's CSP refuses it anyway).
import type { DeedText } from "@techaust/core/deeds";
import { esc } from "../escape.ts";
import { PDF_LOGOS, PDF_PRINT_CSS, PDF_SYMBOL, TECHAUST_PDF_FONT_DATA } from "../generated/assets.ts";
import { DEED_PDF_COPY, PDF_COPY } from "./copy.ts";
import { cssString } from "./styles.ts";

/** False: this is the designed layout (the jobs Worker renders and stores deeds in every environment). */
export const DEED_LAYOUT_PLACEHOLDER = false;

/** The layout's id, printed nowhere: a new layout takes a new id (the jobs Worker logs it with each render). */
export const DEED_PDF_LAYOUT_ID = "deed-v1";

/** The CSP of every document page (render.ts has the same): nothing external, inline styles only. */
const DOCUMENT_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

const SYMBOL_URI = `data:image/svg+xml,${encodeURIComponent(PDF_SYMBOL)}`;
const RUPEE = "₹";

/**
 * The signature space's four corner ticks, in millimetres (84 × 32 mm, room for an eSign provider's signature appearance): plain corners, except the top
 * right, which takes the mark's 45° cut. Muted ink, 0.3 mm; decoration only, no words.
 */
const SIGN_TICKS = `<svg viewBox="0 0 84 32" xmlns="http://www.w3.org/2000/svg" focusable="false"><g fill="none" stroke="currentColor" stroke-width="0.3" stroke-linecap="square"><path d="M0 5V0H5"/><path d="M77 0H80.5L84 3.5V7"/><path d="M0 27V32H5"/><path d="M79 32H84V27"/></g></svg>`;

/** The page footer: the symbol and the 07-P line on the left; the deed number and "Page X of Y" on the right (as every house document). */
const pageCss = (number: string) => `@page {
  @bottom-left {
    content: ${cssString(PDF_COPY.footer.brand)};
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
    content: ${cssString(`${number}   ${PDF_COPY.page.word} `)} counter(page) ${cssString(` ${PDF_COPY.page.of} `)} counter(pages);
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

const CSS = `
html { font-kerning: normal; text-rendering: optimizeLegibility; }
body { margin: 0; font-weight: 400; overflow-wrap: break-word; }
strong { font-weight: 600; }
p { margin: 0; orphans: 3; widows: 3; text-wrap: pretty; }
h1, h2 { margin: 0; }
.deed { font-size: var(--print-body); line-height: var(--print-body-leading); }
.deed__mast { padding-bottom: 4mm; border-bottom: var(--print-swoosh-rule) solid var(--color-accent-decor); }
.deed__logo svg { display: block; width: var(--print-logo-width); height: auto; }
.deed__head { margin: 8mm 0 0; }
.deed__title { font-family: var(--font-display); font-stretch: 116%; font-weight: 560; font-size: var(--print-title); line-height: 1.1; letter-spacing: -0.005em; }
.deed__title span { display: block; }
.deed__number { margin-top: 2.2mm; font-family: var(--font-sans); font-stretch: 100%; font-weight: 500; font-size: 11pt; line-height: 1.2; letter-spacing: 0; font-variant-numeric: tabular-nums lining-nums; }
.deed__parties { margin: 6mm 0 0; padding-bottom: 5mm; border-bottom: 0.2mm solid var(--color-border); font-size: 10.5pt; line-height: 15pt; overflow-wrap: anywhere; }
.clauses { list-style: none; margin: 4.5mm 0 0; padding: 0; }
.clause { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: var(--print-gutter); margin: 0 0 2.6mm; break-inside: avoid; }
.clause__n { grid-column: 1; font-family: var(--font-display); font-stretch: 116%; font-weight: 560; font-variant-numeric: tabular-nums lining-nums; color: var(--color-text-muted); }
.clause__text { grid-column: 2 / -1; min-width: 0; overflow-wrap: anywhere; }
.sign { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: var(--print-gutter); margin-top: 5mm; padding-top: 4mm; border-top: 0.2mm solid var(--color-border); break-inside: avoid; }
.sign__lead { grid-column: 2 / -1; font-weight: 500; }
.sign__space { grid-column: 2 / -1; height: 32mm; margin-top: 3mm; color: var(--color-text-muted); }
.sign__space svg { display: block; width: 84mm; height: 32mm; overflow: visible; }
.sched { margin-top: 9mm; break-inside: avoid; }
.sched__head { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: var(--print-gutter); padding-bottom: 2mm; border-bottom: 0.3mm solid var(--color-text); break-after: avoid; }
.sched__head h2 { grid-column: 2 / -1; font-family: var(--font-display); font-stretch: 116%; font-weight: 560; font-size: 11pt; line-height: 14pt; }
.sched__row { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: var(--print-gutter); padding: 2mm 0; border-bottom: 0.2mm solid var(--color-border); break-inside: avoid; }
.sched__label { grid-column: 2 / span 3; color: var(--color-text-muted); }
.sched__value { grid-column: 2 / -1; min-width: 0; white-space: pre-line; overflow-wrap: anywhere; }
.sched__label + .sched__value { grid-column: 5 / -1; }
.deed__footer { margin: 9mm 0 0; padding-top: 2mm; border-top: 0.2mm solid var(--color-border); font-size: var(--print-small); line-height: 1.4; color: var(--color-text-muted); break-inside: avoid; }
`;

/** The title's two parts ("Deed of assignment of copyright", "No. TH/DA/2627/0001"): 07-ZE joins them with " · "; the page sets them on two lines. */
export function deedTitleParts(title: string): { title: string; number: string | null } {
  const at = title.lastIndexOf(" · ");
  return at < 0 ? { title, number: null } : { title: title.slice(0, at), number: title.slice(at + 3) };
}

/** A text with its first ₹ in its own span (the visual suite asks the font of that glyph); everything else escaped. */
const withRupee = (s: string): string => {
  const at = s.indexOf(RUPEE);
  if (at < 0) return esc(s);
  return `${esc(s.slice(0, at))}<span data-testid="rupee">${RUPEE}</span>${esc(s.slice(at + 1))}`;
};

const runs = (t: DeedText) =>
  t.parties.map((r) => (r.bold ? `<strong>${esc(r.text)}</strong>` : esc(r.text))).join("");

/** One Schedule row: the value, with its 07-ZJ label once approved (the value's own line breaks kept: a deliverables list is typed one per line). */
const schedRow = (label: string | null, value: string) =>
  `<div class="sched__row">${label === null ? "" : `<p class="sched__label">${esc(label)}</p>`}<p class="sched__value">${esc(value)}</p></div>`;

const schedule = (heading: string, rows: [string | null, string][]) =>
  `<section class="sched" data-testid="deed-schedule"><div class="sched__head"><h2>${esc(heading)}</h2></div>${rows.map(([l, v]) => schedRow(l, v)).join("")}</section>`;

/** 07-ZJ line 1: the unsigned PDF's signature sentence ends in a full stop (the eSign details follow it only on the screens). */
export const unsignedSignatureLine = (lead: string): string => (lead.endsWith(".") ? lead : `${lead}.`);

/** The body of a deed (inside `<body>`). */
export function deedBody(t: DeedText): string {
  const { title, number } = deedTitleParts(t.title);
  const logo = PDF_LOGOS["logo-primary-color.svg"] ?? "";
  const L = DEED_PDF_COPY.labels;
  return `<div class="deed">
<header class="deed__mast"><div class="deed__logo">${logo}</div></header>
<div class="deed__head">
<h1 class="deed__title" data-testid="deed-title"><span>${esc(title)}</span>${number === null ? "" : `<span class="deed__number" data-testid="deed-number">${esc(number)}</span>`}</h1>
</div>
<p class="deed__parties" data-testid="deed-parties">${runs(t)}</p>
<ol class="clauses">
${t.clauses.map((c) => `<li class="clause" data-testid="deed-clause"><span class="clause__n">${c.n}.</span><p class="clause__text"><strong>${esc(c.heading)}</strong> ${withRupee(c.body)}</p></li>`).join("\n")}
</ol>
<div class="sign">
<p class="sign__lead" data-testid="deed-signature">${esc(unsignedSignatureLine(t.signatureLead))}</p>
<div class="sign__space" data-testid="deed-sign-space" aria-hidden="true">${SIGN_TICKS}</div>
</div>
${schedule(t.schedule1.heading, [
  [L?.deliverables ?? null, t.schedule1.deliverables],
  [L?.location ?? null, t.schedule1.location],
  [L?.deliveredDates ?? null, t.schedule1.deliveredDates],
])}
${schedule(t.schedule2.heading, [
  [L?.tools ?? null, t.schedule2.tools],
  [L?.thirdParty ?? null, t.schedule2.thirdParty],
])}
<p class="deed__footer" data-testid="deed-footer">${esc(t.footer)}</p>
</div>`;
}

/** The whole HTML document of a deed's unsigned PDF. */
export function renderDeedHtml(t: DeedText): string {
  const { number } = deedTitleParts(t.title);
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">
<title>${esc(t.title)}</title>
<style>
${TECHAUST_PDF_FONT_DATA}
${PDF_PRINT_CSS}
${CSS}
${pageCss(number ?? "")}
</style>
</head>
<body>
${deedBody(t)}
</body>
</html>
`;
}
