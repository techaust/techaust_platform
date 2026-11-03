// M6.3 staging fixes, part 3 (ADM-INV-01, JOB-PDF-01): page counts, and the last line of a document never alone on a page. The owner's export invoice for a
// payment received (one line, IGST, the INR block, a signature, the tax summary) printed a second page holding only the integrity line. Every fixture is
// printed by Chromium (as checks.ts does) and its pages counted with pdf-lib:
//   - the count is pinned per fixture, so a one-page document that grows a page fails here first;
//   - the last page holds more than the closing line: its marked-content ids (the tagged PDF marks every run of text with one) outnumber those of the
//     closing line printed on its own;
//   - a sweep pushes the block before the closing line down a few millimetres at a time across the foot of a page, and at no step is the line left
//     alone on the last page (the page break moves to before that block instead: `break-before: avoid` on the line).
// Sample data only. Runs in CI (ci.yml, after the browser setup); locally: bash tools/heavy.sh --log pdf-visual pnpm --filter @techaust/pdf test:visual
import { PDFDocument } from "@cantoo/pdf-lib";
import { expect, type Page, test } from "@playwright/test";
import type { InvoiceEnvelope } from "../src/invoice-types.ts";
import { toInvoiceView } from "../src/invoice-view.ts";
import { renderReceiptHtml } from "../src/layout/receipt.ts";
import { renderDeedHtml, renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG, toPdfView } from "../src/view.ts";
import { type DeedFixtureName, deedFixture } from "../test/fixtures/deed.ts";
import { buildFixture, type FixtureName } from "../test/fixtures/index.ts";
import {
  buildInvoiceLayoutFixture,
  type InvoiceLayoutFixture,
  SAMPLE_SIGNATURE_PNG,
} from "../test/fixtures/invoice-layout.ts";
import { buildNoteFixture, type NoteFixtureName } from "../test/fixtures/notes.ts";
import { type ReceiptFixtureName, receiptFixture } from "../test/fixtures/receipt.ts";
import { marksPerPage } from "./pdf-pages.ts";

/** Pages per fixture, as printed on 2026-11-02 after the fix (Chromium of @playwright/test 1.64.1). */
const INVOICE_PAGES: Record<InvoiceLayoutFixture, number> = {
  short: 1,
  intra: 2,
  inter: 1,
  long: 4,
  "long-names": 2,
  bare: 1,
  signed: 1,
  // Two pages on purpose (lead, 2026-11-02): 2 lines, the full SWIFT block and a delivery address run 18.3 mm past page 1; the tax summary and the
  // integrity line go over together. Fitting it would take a visible change to the approved page, not a spacing tweak.
  "export-lut": 2,
  "export-igst": 1,
  proforma: 1,
  advance: 1,
  "advance-export": 1,
  "advance-export-igst": 1,
  udyam: 1,
};
const NOTE_PAGES: Record<NoteFixtureName, number> = {
  credit_lines: 1,
  credit_amount: 1,
  credit_full: 1,
  credit_usd_lut: 1,
  credit_usd_igst: 1,
  credit_other: 1,
  debit: 1,
  debit_usd_lut: 1,
};
const DOCUMENT_PAGES: Record<FixtureName, number> = {
  "short-intra-inr": 3,
  "long-inter-inr": 9,
  // Two pages on purpose (lead, 2026-11-02): the Acceptance section (34 mm, kept whole) and the integrity line go over together. Page 1 is short by
  // 29.7 mm (usd-export), 52.9 mm (inter-estimate) and 70.5 mm (intra-estimate): no spacing tweak closes that without a visible change.
  "usd-export": 2,
  "intra-estimate": 2,
  "inter-estimate": 2,
  "long-names": 3,
};
const DEED_PAGES: Record<DeedFixtureName, number> = { "short-inr": 2, "long-inr": 2, usd: 2 };
/**
 * M6.5: the receipt (designer, 2026-11-03): one page up to ten Applied to lines with a long client name; the longest list (50 lines, "and 10 more" and the
 * credit) runs to three, the last line, "and 10 more", the credit and the closing line going over together.
 */
const RECEIPT_PAGES: Record<ReceiptFixtureName, number> = {
  "inr-one": 1,
  "usd-credit": 1,
  "long-ten": 1,
  longest: 3,
};

const INTEGRITY = "[data-testid=integrity]";
const DEED_FOOTER = "[data-testid=deed-footer]";
const RECEIPT_NOTICE = "[data-testid=receipt-notice]";
const signature = {
  mime: "image/png" as const,
  base64: Buffer.from(SAMPLE_SIGNATURE_PNG).toString("base64"),
};

const invoiceHtml = (envelope: InvoiceEnvelope, sig = signature) =>
  renderDocumentHtml(
    toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { signature: sig, portalLink: "portal.techaust.com" }),
  );

async function invoiceFixtureHtml(name: InvoiceLayoutFixture): Promise<string> {
  const { envelope, signature: sig } = await buildInvoiceLayoutFixture(name);
  return renderDocumentHtml(
    toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { signature: sig, portalLink: "portal.techaust.com" }),
  );
}

/** Prints the page's document as Browser Run is asked to (A4 from the page rules, tagged, backgrounds) and loads the PDF. */
async function print(page: Page, html: string, css = ""): Promise<PDFDocument> {
  await page.emulateMedia({ media: "print" });
  await page.setContent(html, { waitUntil: "load" });
  if (css) await page.addStyleTag({ content: css });
  await page.evaluate("document.fonts.ready.then(() => true)");
  return PDFDocument.load(await page.pdf({ preferCSSPageSize: true, tagged: true, printBackground: true }));
}

/** CSS that leaves only the closing line visible (the layout unchanged), to count its own marks. */
const onlyCss = (selector: string) =>
  `body * { visibility: hidden !important; } :is(${selector}), :is(${selector}) * { visibility: visible !important; }`;

async function marksOfLineAlone(page: Page, html: string, selector: string): Promise<number> {
  const pdf = await print(page, html, onlyCss(selector));
  const marks = marksPerPage(pdf).filter((m) => m > 0);
  expect(marks).toHaveLength(1);
  return marks[0] as number;
}

/** The two checks of one document: its pinned page count, and a last page with more on it than the closing line. */
async function checkDocument(page: Page, html: string, pages: number, selector: string): Promise<void> {
  const alone = await marksOfLineAlone(page, html, selector);
  expect(alone).toBeGreaterThan(0);
  const pdf = await print(page, html);
  expect(pdf.getPageCount()).toBe(pages);
  const last = marksPerPage(pdf).at(-1) as number;
  expect(last, "the last page holds only the closing line").toBeGreaterThan(alone);
}

/** Pushes the block right before the closing line down by 0 to `upTo` mm in `step` mm steps; the page counts seen must be exactly `counts` (the sweep crossed a page boundary). */
async function sweep(
  page: Page,
  html: string,
  selector: string,
  upTo: number,
  step: number,
  counts: number[],
): Promise<void> {
  const alone = await marksOfLineAlone(page, html, selector);
  const seen = new Set<number>();
  for (let mm = 0; mm <= upTo; mm += step) {
    const pdf = await print(page, html, `:has(+ ${selector}) { margin-top: ${mm}mm !important; }`);
    seen.add(pdf.getPageCount());
    expect(marksPerPage(pdf).at(-1) as number, `pushed ${mm} mm`).toBeGreaterThan(alone);
  }
  expect([...seen].sort((a, b) => a - b)).toEqual(counts);
}

test.describe("page counts, and the closing line never alone on a page", () => {
  for (const [name, pages] of Object.entries(INVOICE_PAGES) as [InvoiceLayoutFixture, number][])
    test(`invoice ${name}: ${pages} page(s)`, async ({ page }) => {
      await checkDocument(page, await invoiceFixtureHtml(name), pages, INTEGRITY);
    });

  for (const [name, pages] of Object.entries(NOTE_PAGES) as [NoteFixtureName, number][])
    test(`note ${name}: ${pages} page(s)`, async ({ page }) => {
      const { envelope } = await buildNoteFixture(name);
      await checkDocument(page, invoiceHtml(envelope), pages, INTEGRITY);
    });

  for (const [name, pages] of Object.entries(DOCUMENT_PAGES) as [FixtureName, number][])
    test(`document ${name}: ${pages} page(s)`, async ({ page }) => {
      const { envelope } = await buildFixture(name);
      await checkDocument(page, renderDocumentHtml(toPdfView(envelope)), pages, INTEGRITY);
    });

  for (const [name, pages] of Object.entries(DEED_PAGES) as [DeedFixtureName, number][])
    test(`deed ${name}: ${pages} page(s)`, async ({ page }) => {
      await checkDocument(page, renderDeedHtml(deedFixture(name)), pages, DEED_FOOTER);
    });

  for (const [name, pages] of Object.entries(RECEIPT_PAGES) as [ReceiptFixtureName, number][])
    test(`receipt ${name}: ${pages} page(s)`, async ({ page }) => {
      await checkDocument(page, renderReceiptHtml(receiptFixture(name)), pages, RECEIPT_NOTICE);
    });
});

test.describe("the owner's staging case (an export invoice for a payment received, IGST route)", () => {
  test("is one page, with the integrity line on it", async ({ page }) => {
    await checkDocument(page, await invoiceFixtureHtml("advance-export-igst"), 1, INTEGRITY);
  });

  // The longest variant: the Q37 sentence (IGST because no LUT was in place for the receipt's FY) adds a line under the title, and the fixture's client has a
  // delivery address too. It runs to two pages, and the tax summary goes over with the integrity line.
  test("with the Q37 sentence it is two pages, the tax summary going over with the integrity line", async ({
    page,
  }) => {
    const { envelope } = await buildInvoiceLayoutFixture("advance-export-igst");
    const header = envelope.snapshot.header;
    if (!header.advance) throw new Error("fixture has no advance header");
    const withSentence: InvoiceEnvelope = {
      ...envelope,
      snapshot: {
        ...envelope.snapshot,
        header: { ...header, advance: { ...header.advance, igstNoLutFy: "2026-27" } },
      },
    };
    const html = invoiceHtml(withSentence);
    expect(html).toContain("no LUT was in place for FY 2026-27");
    await checkDocument(page, html, 2, INTEGRITY);
  });

  // The sweeps: the block before the closing line is pushed down a few millimetres at a time, so the end of the document crosses the foot of a page at
  // every height. Whatever the step, the last page holds more than the closing line (where it no longer fits, the block before it goes over with it).
  test("the invoice, pushed down across the foot of the page, never leaves the line alone on the last page", async ({
    page,
  }) => {
    await sweep(page, await invoiceFixtureHtml("advance-export-igst"), INTEGRITY, 40, 2, [1, 2]);
  });

  test("a proposal's integrity line goes over with the acceptance section, never alone", async ({ page }) => {
    const { envelope } = await buildFixture("intra-estimate");
    await sweep(page, renderDocumentHtml(toPdfView(envelope)), INTEGRITY, 270, 6, [2, 3]);
  });

  test("a deed's closing line goes over with the second Schedule, never alone", async ({ page }) => {
    await sweep(page, renderDeedHtml(deedFixture("short-inr")), DEED_FOOTER, 270, 6, [2, 3]);
  });
});
