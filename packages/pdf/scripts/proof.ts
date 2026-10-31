// Prints every fixture to a PDF with the local Playwright Chromium, for looking at the real pages by eye (the visual suite compares
// the print-media HTML; the page-margin footer and the page breaks only exist in the PDF). Development only; sample data only.
// Run: node scripts/proof.ts <output folder> [invoices|deeds]    (one <fixture>.pdf per fixture, and invoice-<fixture>.pdf per tax invoice layout
// fixture; with "invoices" only the tax invoices; with "deeds" only the T11 deeds, as deed-<fixture>.pdf plus a full-page deed-<fixture>.png of the
// print-media HTML; the folder is created; never commit the output)
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { toInvoiceView } from "../src/invoice-view.ts";
import { renderDeedHtml, renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG, toPdfView } from "../src/view.ts";
import { buildFixture, FIXTURE_NAMES } from "../test/fixtures/index.ts";
import { DEED_FIXTURE_NAMES, deedFixture } from "../test/fixtures/deed.ts";
import { buildInvoiceLayoutFixture, INVOICE_LAYOUT_FIXTURES } from "../test/fixtures/invoice-layout.ts";

const out = process.argv[2];
if (!out) {
  console.error("usage: node scripts/proof.ts <output folder>");
  process.exit(2);
}
const dir = resolve(out);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.emulateMedia({ media: "print" });
  const print = async (html: string, file: string) => {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate("document.fonts.ready.then(() => true)");
    const bytes = await page.pdf({ preferCSSPageSize: true, tagged: true, printBackground: true });
    writeFileSync(join(dir, file), bytes);
    console.log(`${file} ${bytes.length} bytes`);
  };
  if (process.argv[3] === "deeds") {
    for (const name of DEED_FIXTURE_NAMES) {
      await print(renderDeedHtml(deedFixture(name)), `deed-${name}.pdf`);
      await page.setViewportSize({ width: 794, height: 1123 });
      await page.screenshot({ path: join(dir, `deed-${name}.png`), fullPage: true });
    }
  } else if (process.argv[3] !== "invoices")
    for (const name of FIXTURE_NAMES) {
      const { envelope } = await buildFixture(name);
      await print(renderDocumentHtml(toPdfView(envelope)), `${name}.pdf`);
    }
  if (process.argv[3] !== "deeds")
  for (const name of INVOICE_LAYOUT_FIXTURES) {
    const { envelope, signature } = await buildInvoiceLayoutFixture(name);
    await print(
      renderDocumentHtml(
        toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { signature, portalLink: "portal.techaust.com" }),
      ),
      `invoice-${name}.pdf`,
    );
  }
} finally {
  await browser.close();
}
