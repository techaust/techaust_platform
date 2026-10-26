// Prints every fixture to a PDF with the local Playwright Chromium, for looking at the real pages by eye (the visual suite compares
// the print-media HTML; the page-margin footer and the page breaks only exist in the PDF). Development only; sample data only.
// Run: node scripts/proof.ts <output folder>    (one <fixture>.pdf per fixture; the folder is created; never commit the output)
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { renderDocumentHtml } from "../src/render.ts";
import { toPdfView } from "../src/view.ts";
import { buildFixture, FIXTURE_NAMES } from "../test/fixtures/index.ts";

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
  for (const name of FIXTURE_NAMES) {
    const { envelope } = await buildFixture(name);
    await page.setContent(renderDocumentHtml(toPdfView(envelope)), { waitUntil: "load" });
    await page.evaluate("document.fonts.ready.then(() => true)");
    const bytes = await page.pdf({ preferCSSPageSize: true, tagged: true, printBackground: true });
    writeFileSync(join(dir, `${name}.pdf`), bytes);
    console.log(`${name}.pdf ${bytes.length} bytes`);
  }
} finally {
  await browser.close();
}
