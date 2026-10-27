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
import { statementBody, statementCss } from "./layout/statement-skeleton.ts";
import { pageCss, TEMPLATE_CSS } from "./layout/styles.ts";
import type { PdfView, StatementView } from "./types.ts";

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

/** The whole HTML document of a statement of account (same page rules as a document: inline fonts and CSS, no network). */
export function renderStatementHtml(view: StatementView): string {
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">
<title>${esc(`Statement of account ${view.from} to ${view.to}`)}</title>
<style>
${TECHAUST_PDF_FONT_DATA}
${PDF_PRINT_CSS}
${TEMPLATE_CSS}
${statementCss(view)}
</style>
</head>
<body>
${statementBody(view)}
</body>
</html>
`;
}

/**
 * The content hash of a statement (`statement_pdfs.view_sha256`, and the R2 key `statements/<clientId>/<hash>.pdf`): the SHA-256 of the canonical JSON of the view
 * WITHOUT `generatedOn`, so the same data made on two days is the same object (LD79). The layout id is inside the view: a new layout is a new object.
 */
export async function statementViewSha256(view: StatementView): Promise<string> {
  const { generatedOn: _generatedOn, ...content } = view;
  return sha256Hex(canonicalJson(content));
}
