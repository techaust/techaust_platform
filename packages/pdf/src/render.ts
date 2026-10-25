// The document HTML: one self-contained page (fonts, print CSS and template CSS inline; no network). Browser Run renders it with
// JavaScript off, and the CSP meta below would refuse anything external even if it were present.
import { esc } from "./escape.ts";
import { PDF_PRINT_CSS, TECHAUST_PDF_FONT_DATA } from "./generated/assets.ts";
import { CERTIFICATE_CSS, type CertificateView, certificateBody } from "./layout/certificate-skeleton.ts";
import { skeletonBody } from "./layout/skeleton.ts";
import { TEMPLATE_CSS } from "./layout/styles.ts";
import type { PdfView } from "./types.ts";

export const DOCUMENT_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

/** The whole HTML document of a view. */
export function renderDocumentHtml(view: PdfView): string {
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
</style>
</head>
<body>
${skeletonBody(view)}
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
${CERTIFICATE_CSS}
</style>
</head>
<body>
${certificateBody(view)}
</body>
</html>
`;
}
