// The Puppeteer-style `pdfOptions` sent to Browser Run's /pdf for a document. The page size and margins come from the CSS `@page`
// rule (`preferCSSPageSize`). The PDF title is the HTML `<title>`; tagging and the outline make the file accessible.
// `displayHeaderFooter` stays off: the page footer is drawn by CSS page-margin boxes (the designer's), and `footerTemplate` is the
// fallback if staging shows they are not supported.
import type { InvoiceView } from "./invoice-types.ts";
import type { PdfView } from "./types.ts";

export type DocumentPdfOptions = {
  format: "a4";
  preferCSSPageSize: true;
  printBackground: true;
  tagged: true;
  outline: true;
  timeout: number;
  displayHeaderFooter: false;
};

/** The options of every document (the view is passed so a later template can vary the margins). */
export function pdfOptionsFor(_view?: PdfView | InvoiceView): DocumentPdfOptions {
  return {
    format: "a4",
    preferCSSPageSize: true,
    printBackground: true,
    tagged: true,
    outline: true,
    timeout: 30_000,
    displayHeaderFooter: false,
  };
}
