// T11: the deed of assignment's unsigned PDF (run file docs/runs/t11-deed.md, L4, L5; 08-C RB-38(a), RB-21). PLACEHOLDER LAYOUT built by the builder so the
// `pdf.deed` pipeline can be tested end to end: a plain A4 page in the house fonts with every part of 07-ZE's filled text in order, a banner saying it is a
// placeholder, and the empty signature space. The DESIGNER replaces this file (one page where it fits, the house PDF style; the Schedules may run to a second
// page; fixed words in ./copy.ts) and then sets `DEED_LAYOUT_PLACEHOLDER` to false: while it is true the jobs Worker renders deeds only when ENVIRONMENT is
// "local", so no placeholder PDF is ever stored write-once on staging or production.
//
// The words are core `deedText`'s (07-ZE, approved word for word): this file adds none of its own except the placeholder banner. Every dynamic string goes
// through `esc`. L5: the signature sentence is printed and the space below it left empty (the eSign provider's own signature appearance carries the time and
// the transaction inside the signed copy). The footer is the stamp-duty line (owner-approved; OPEN (08-C RB-21): West Bengal stamp duty on a deed of assignment
// of copyright was not read).
import type { DeedText } from "@techaust/core/deeds";
import { esc } from "../escape.ts";
import { PDF_PRINT_CSS, TECHAUST_PDF_FONT_DATA } from "../generated/assets.ts";

/** True while this file is the builder's placeholder (the designer sets it to false with the real layout). */
export const DEED_LAYOUT_PLACEHOLDER = true;

/** The layout's id, printed nowhere: a new layout takes a new id (the jobs Worker logs it with each render). */
export const DEED_PDF_LAYOUT_ID = "deed-placeholder-v0";

/** The CSP of every document page (render.ts has the same): nothing external, inline styles only. */
const DOCUMENT_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

const CSS = `
@page { size: A4; margin: 20mm 18mm 22mm; }
body { font-family: "Archivo", sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; }
.placeholder { border: 1px dashed #999; padding: 4mm; margin-bottom: 6mm; font-family: "IBM Plex Mono", monospace; font-size: 9pt; }
h1 { font-size: 15pt; margin: 0 0 5mm; }
h2 { font-size: 11pt; margin: 6mm 0 2mm; }
p { margin: 0 0 3mm; }
.sign { margin-top: 8mm; }
.sign-space { height: 30mm; }
.footer { margin-top: 8mm; font-size: 9pt; }
`;

const runs = (t: DeedText) =>
  t.parties.map((r) => (r.bold ? `<strong>${esc(r.text)}</strong>` : esc(r.text))).join("");

/** The whole HTML document of a deed's unsigned PDF (placeholder layout). */
export function renderDeedHtml(t: DeedText): string {
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
</style>
</head>
<body>
<div class="placeholder" data-testid="deed-placeholder">[Placeholder] layout: the designer replaces this page (${esc(DEED_PDF_LAYOUT_ID)}).</div>
<h1>${esc(t.title)}</h1>
<p data-testid="deed-parties">${runs(t)}</p>
${t.clauses.map((c) => `<p data-testid="deed-clause"><strong>${c.n}. ${esc(c.heading)}</strong> ${esc(c.body)}</p>`).join("\n")}
<div class="sign"><p data-testid="deed-signature">${esc(t.signatureLead)}</p><div class="sign-space"></div></div>
<h2>${esc(t.schedule1.heading)}</h2>
<p>${esc(t.schedule1.deliverables)}</p>
<p>${esc(t.schedule1.location)}</p>
<p>${esc(t.schedule1.deliveredDates)}</p>
<h2>${esc(t.schedule2.heading)}</h2>
<p>${esc(t.schedule2.tools)}</p>
<p>${esc(t.schedule2.thirdParty)}</p>
<p class="footer" data-testid="deed-footer">${esc(t.footer)}</p>
</body>
</html>
`;
}
