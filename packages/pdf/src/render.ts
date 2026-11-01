// The document HTML: one self-contained page (fonts, print CSS and template CSS inline; no network). Browser Run renders it with
// JavaScript off, and the CSP meta below would refuse anything external even if it were present.
import { esc } from "./escape.ts";
import { PDF_PRINT_CSS, TECHAUST_PDF_FONT_DATA } from "./generated/assets.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import type { InvoiceView } from "./invoice-types.ts";
import {
  type CertificateView,
  certificateBody,
  certificateCss,
  certificateFooter,
} from "./layout/certificate-skeleton.ts";
import { documentBody } from "./layout/document.ts";
import { INVOICE_SKELETON_CSS, invoiceBody, invoicePageCss } from "./layout/invoice-skeleton.ts";
import { pageCss, TEMPLATE_CSS } from "./layout/styles.ts";
import { STATEMENT_LAYOUT_ID, type StatementView } from "./statement-view.ts";
import type { PdfView } from "./types.ts";

export const DOCUMENT_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

/** The view of an invoice-family document (M5.1) as opposed to a proposal's or an estimate's. */
export const isInvoiceView = (view: PdfView | InvoiceView): view is InvoiceView =>
  "kind" in view && view.kind === "invoice";

/** The whole HTML document of a view: the proposal and estimate layout, or (an invoice view) the invoice layout. */
export function renderDocumentHtml(view: PdfView | InvoiceView): string {
  if (isInvoiceView(view)) return renderInvoiceHtml(view);
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
${pageCss(view)}
</style>
</head>
<body>
${documentBody(view)}
</body>
</html>
`;
}

function renderInvoiceHtml(view: InvoiceView): string {
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
${INVOICE_SKELETON_CSS}
${invoicePageCss(view)}
</style>
</head>
<body>
${invoiceBody(view)}
</body>
</html>
`;
}

/** The whole HTML document of an acceptance certificate (same page rules as a document: inline fonts and CSS, no network). */
export function renderCertificateHtml(view: CertificateView): string {
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">
<title>${esc(`Acceptance certificate ${view.number} v${view.version}`)}</title>
<style>
${TECHAUST_PDF_FONT_DATA}
${PDF_PRINT_CSS}
${certificateCss(certificateFooter(view))}
</style>
</head>
<body>
${certificateBody(view)}
</body>
</html>
`;
}

/**
 * The content hash of a statement (`statement_pdfs.view_sha256`, and the R2 key `statements/<clientId>/<hash>.pdf`): the SHA-256 of the canonical JSON of the view
 * INCLUDING `generatedOn` (the IST day, as the page prints it), so the same data made on the same day is the same object and a request on a later day renders afresh with its own "Generated on" date (review round, finding 5; LD79). The layout id (`STATEMENT_LAYOUT_ID`) is inside the hash: a new layout is a new object.
 */
export async function statementViewSha256(view: StatementView): Promise<string> {
  return sha256Hex(canonicalJson({ layout: STATEMENT_LAYOUT_ID, ...view }));
}

/** T11: the deed of assignment's unsigned PDF (`layout/deed.ts`; a builder's placeholder until the designer's layout replaces it). */
export { DEED_LAYOUT_PLACEHOLDER, DEED_PDF_LAYOUT_ID, renderDeedHtml } from "./layout/deed.ts";
/** The whole HTML document of a statement of account: the designer's layout (`layout/statement.ts`). */
export { renderStatementHtml } from "./layout/statement.ts";
