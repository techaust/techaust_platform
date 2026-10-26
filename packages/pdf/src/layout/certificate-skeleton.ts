// The acceptance certificate (M4.5, ADM-PROP-08; VERIFY WITH CA/LEGAL), one A4 page in the document system of docs/06 §7: the logo over
// the verdigris rule, the title, the statement of what the page records, then three blocks: the document (what was accepted, with its
// frozen total), who accepted it and when (IST and UTC), and the evidence (the IP address, the browser, how the person reached it, and the
// fingerprints in full). Grayscale-safe: nothing is said by colour; the rule and hairlines read as black and grey. The total's rupee sign
// comes from the embedded Archivo's own U+20B9 face (the same `TECHAUST_PDF_FONT_DATA` the documents use), so it never falls back.
//
// Words: 07-N §5 and 07-P §1 ("Prepared for", the footer line), with the labels 07-N lacked as approved in 07-Q (CERT lines).
//
// The contract the tests rely on:
//   data-testid="typed-name"  the name the person typed
//   data-testid="time"        the acceptance time, IST and UTC
//   data-testid="sha"         the fingerprints (the accepted PDF, the sent copy, the terms)
// Every value goes through `esc`; nothing is loaded from outside (the page's CSP refuses it anyway). The IP address, the user agent and the
// country are printed because they ARE the evidence (docs/08 L-11).
import { esc } from "../escape.ts";
import { PDF_LOGOS, PDF_SYMBOL } from "../generated/assets.ts";
import { PDF_COPY } from "./copy.ts";
import { cssString } from "./styles.ts";

/** What the certificate prints, as text already formatted by the jobs Worker (`buildCertificateView`). */
export type CertificateView = {
  /** "TH/PRP/2627/0003" */
  number: string;
  version: string;
  /** The frozen total, formatted by core `formatMoney` in the jobs Worker: "₹2,95,000.00" or "$1,200.00". */
  total: string;
  /** "Proposal" or "Estimate" */
  kind: string;
  title: string;
  clientLegalName: string;
  typedName: string;
  email: string;
  /** "26 Oct 2026, 10:30 IST" and "2026-10-26 05:00:00 UTC": both are printed. */
  acceptedAtIst: string;
  acceptedAtUtc: string;
  ip: string;
  userAgent: string;
  country: string;
  /** "session" (signed in to the portal) or "link" (the emailed link). */
  via: string;
  pdfSha256: string;
  snapshotSha256: string;
  termsVersion: string;
  termsSha256: string;
};

/** 07-N §5, word for word, plus the labels of 07-Q. */
export const CERTIFICATE_COPY = {
  title: "Acceptance certificate",
  statement: "This certificate records an electronic acceptance through the TecHaust client portal.",
  document: "Document",
  numberAndVersion: "Number and version",
  total: "Total",
  preparedFor: PDF_COPY.blocks.preparedFor,
  acceptedBy: "Accepted by",
  email: "Email",
  ist: "Date and time (IST)",
  utc: "Date and time (UTC)",
  ip: "IP address",
  browser: "Browser",
  country: "Country",
  how: "How it was accepted",
  viaLink: "From the emailed link",
  viaSession: "Signed in to the client portal",
  evidence: "Evidence",
  pdfSha: "Document fingerprint (SHA-256 of the accepted PDF)",
  snapshotSha: "Fingerprint of the sent copy (SHA-256)",
  termsVersion: "Terms version",
  termsSha: "Terms fingerprint (SHA-256)",
} as const;

const C = CERTIFICATE_COPY;
const SYMBOL_URI = `data:image/svg+xml,${encodeURIComponent(PDF_SYMBOL)}`;

export const CERTIFICATE_CSS = `
html { font-kerning: normal; text-rendering: optimizeLegibility; }
body { margin: 0; font-weight: 400; overflow-wrap: break-word; }
p { margin: 0; }
h1, h2 { margin: 0; }
@page {
  @bottom-left {
    content: ${cssString(PDF_COPY.footer.brand)};
    padding-left: 6mm;
    background: url("${SYMBOL_URI}") no-repeat left center / 3.6mm 3.6mm;
    font-family: var(--font-sans);
    font-size: var(--print-small);
    line-height: 1;
    color: var(--color-text-muted);
    vertical-align: middle;
    width: 140mm;
  }
}
.cert { font-size: var(--print-body); line-height: var(--print-body-leading); }
.cert__mast { padding-bottom: 4mm; border-bottom: var(--print-swoosh-rule) solid var(--color-accent-decor); }
.cert__logo svg { display: block; width: var(--print-logo-width); height: auto; }
.cert__title {
  margin: 9mm 0 2mm;
  font-family: var(--font-display);
  font-stretch: 116%;
  font-weight: 600;
  font-size: var(--print-title);
  line-height: 1.15;
}
.cert__statement { color: var(--color-text-muted); max-width: 140mm; }
.cert__block { margin-top: 9mm; break-inside: avoid; }
.cert__label {
  margin: 0 0 2mm;
  font-size: var(--print-small);
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-text-muted);
}
.cert__doc-title { margin-bottom: 3mm; font-family: var(--font-display); font-stretch: 116%; font-weight: 600; font-size: 13pt; line-height: 1.3; }
.cert__who { padding: 5mm 6mm; border: 0.3mm solid var(--color-border); border-left: 1.2mm solid var(--color-text); }
.cert__name { font-family: var(--font-display); font-stretch: 116%; font-weight: 600; font-size: 18pt; line-height: 1.2; margin-bottom: 1.5mm; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 1.6mm 0; text-align: left; vertical-align: top; border-bottom: 0.2mm solid var(--color-border); }
tr:first-child th, tr:first-child td { border-top: 0.2mm solid var(--color-border); }
th { width: 58mm; padding-right: 6mm; font-weight: 400; color: var(--color-text-muted); }
td { font-variant-numeric: tabular-nums lining-nums; }
.cert__who table { margin-top: 3mm; }
.cert__who th { width: 50.8mm; }
.mono { font-family: var(--font-mono); font-size: var(--print-small); word-break: break-all; line-height: 1.5; }
`;

const row = (label: string, value: string, cls = ""): string =>
  `<tr><th scope="row">${esc(label)}</th><td${cls ? ` class="${cls}"` : ""}>${esc(value)}</td></tr>`;

/** The body of the certificate (inside `<body>`). */
export function certificateBody(v: CertificateView): string {
  const logo = PDF_LOGOS["logo-primary-color.svg"] ?? "";
  return `<div class="cert">
<header class="cert__mast"><div class="cert__logo">${logo}</div></header>
<h1 class="cert__title">${esc(C.title)}</h1>
<p class="cert__statement">${esc(C.statement)}</p>

<section class="cert__block" aria-label="${esc(C.document)}">
<p class="cert__label">${esc(C.document)}</p>
<p class="cert__doc-title">${esc(v.kind)}: ${esc(v.title)}</p>
<table>
${row(C.numberAndVersion, `${v.number} v${v.version}`)}${row(C.total, v.total)}${row(C.preparedFor, v.clientLegalName)}
</table>
</section>

<section class="cert__block cert__who" aria-label="${esc(C.acceptedBy)}">
<p class="cert__label">${esc(C.acceptedBy)}</p>
<p class="cert__name" data-testid="typed-name">${esc(v.typedName)}</p>
<table>
${row(C.email, v.email)}
<tr><th scope="row">${esc(C.ist)}</th><td data-testid="time">${esc(v.acceptedAtIst)}<br>${esc(C.utc)}: ${esc(v.acceptedAtUtc)}</td></tr>
</table>
</section>

<section class="cert__block" aria-label="${esc(C.evidence)}">
<p class="cert__label">${esc(C.evidence)}</p>
<table>
${row(C.how, v.via === "link" ? C.viaLink : C.viaSession)}${row(C.ip, v.ip)}${row(C.country, v.country)}${row(C.browser, v.userAgent)}
</table>
<table data-testid="sha">
${row(C.pdfSha, v.pdfSha256, "mono")}${row(C.snapshotSha, v.snapshotSha256, "mono")}${row(C.termsVersion, v.termsVersion)}${row(C.termsSha, v.termsSha256, "mono")}
</table>
</section>
</div>`;
}
