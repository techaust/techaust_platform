// The Puppeteer-style `pdfOptions` sent to Browser Run's /pdf for a document. The page size and margins come from the CSS `@page`
// rule (`preferCSSPageSize`). The PDF title is the HTML `<title>`; tagging and the outline make the file accessible.
// `displayHeaderFooter` stays off: the page footer is drawn by CSS page-margin boxes (the designer's), and `footerTemplate` is the
// fallback if staging shows they are not supported.
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

export function pdfOptionsFor(_view: PdfView): DocumentPdfOptions {
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
