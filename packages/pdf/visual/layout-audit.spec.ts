// M6.3 staging fixes, part 3: the layout audit of every PDF the system makes (test/fixtures/audit.ts: each kind short, long, and in between). For every
// case, printed by Chromium as Browser Run is asked to print it:
//   - its page count is the pinned one (`PAGES`), so a layout change that adds or drops a page is seen;
//   - no page is blank, no page holds only the closing line, no heading ends a page with its content overleaf, and no block that must stay whole
//     (`WHOLE`: the totals with the signature, the tax summary, the acceptance box, the statement's figures and last lines, the deed's signature block, the
//     certificate's "Accepted by" box, the header blocks) is split over two pages;
//   - the sweep: the content is pushed down a few millimetres at a time (a spacer under the header blocks) through most of a page, so the end of the
//     document and every block boundary crosses the foot of a page at every height; at every step the same rules hold (the whole-block rule for the
//     totals, the acceptance box, the deed's signature and the statement's last lines, the blocks nearest the end).
// How a block's pages are read: everything else is made `visibility: hidden` (the layout does not change) and the pages that still carry marked content
// are the block's. AUDIT_OUT=<folder> also writes each case's PDF there (for looking at by eye; never commit them). Sample data only.
// Run: bash tools/heavy.sh --log pdf-audit pnpm --filter @techaust/pdf exec playwright test -c playwright.config.ts visual/layout-audit.spec.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import { expect, type Page, test } from "@playwright/test";
import { AUDIT_CASES, type AuditCase, auditSlug } from "../test/fixtures/audit.ts";
import { headingAtFoot, marksPerPage, structure } from "./pdf-pages.ts";

/** Pages per case (printed 2026-11-02 after the fixes; Chromium of @playwright/test 1.64.1). */
const PAGES: Record<string, number> = {
  "proposal-short": 3,
  "proposal-long": 9,
  "proposal-usd": 2,
  "proposal-long-names": 3,
  "estimate-intra": 2,
  "estimate-inter": 2,
  "certificate-short": 1,
  "certificate-long": 2,
  "tax-invoice-inr-intra-short": 1,
  "tax-invoice-inr-intra-several-lines-and-notes": 2,
  "tax-invoice-inr-intra-long-signed": 4,
  "tax-invoice-inr-intra-long-signatory-off": 4,
  "tax-invoice-inr-intra-short-signatory-off": 1,
  "tax-invoice-inr-intra-udyam-line": 1,
  "tax-invoice-inr-intra-long-names": 2,
  "tax-invoice-inr-intra-bare-no-bank-no-signature": 1,
  "tax-invoice-inr-inter-short": 1,
  "tax-invoice-inr-inter-long-40-lines": 4,
  "export-invoice-lut-short": 2,
  "export-invoice-lut-long": 4,
  "export-invoice-igst-short": 1,
  "export-invoice-igst-long": 3,
  "proforma-inr-short": 1,
  "proforma-inr-long": 4,
  "proforma-usd-short": 1,
  "proforma-usd-long-igst-route": 4,
  "invoice-for-a-payment-received-inr": 1,
  "invoice-for-a-payment-received-export-lut": 1,
  "invoice-for-a-payment-received-export-igst-owner-s-case": 1,
  "credit-note-short-lines": 1,
  "credit-note-by-amount": 1,
  "credit-note-usd-igst": 1,
  "credit-note-long": 2,
  "debit-note-short": 1,
  "debit-note-usd-lut": 1,
  "debit-note-tax-only": 1,
  "debit-note-long": 2,
  "duplicate-for-supplier-short": 1,
  "duplicate-for-supplier-export-lut": 2,
  "duplicate-for-supplier-long": 4,
  "statement-short-3-entries": 1,
  "statement-long-200-entries": 8,
  "statement-long-names": 1,
  "deed-short-inr": 2,
  "deed-long-inr": 2,
  "deed-usd": 2,
};

/** The blocks that must never be split over two pages (each checked where the document has one). */
const WHOLE = [
  ".parties",
  ".inv-band",
  ".totals",
  ".inv-summary-block",
  ".sec--acceptance",
  ".stm-band",
  ".stm-foot",
  ".deed .sign",
  ".cert__who",
];
/** The ones the sweep checks at every step (the blocks nearest the end of a document, where a page break lands). */
const WHOLE_IN_SWEEP = [".totals", ".sec--acceptance", ".stm-foot", ".deed .sign"];

async function print(page: Page, html: string, css = ""): Promise<{ pdf: PDFDocument; bytes: Buffer }> {
  await page.emulateMedia({ media: "print" });
  await page.setContent(html, { waitUntil: "load" });
  if (css) await page.addStyleTag({ content: css });
  await page.evaluate("document.fonts.ready.then(() => true)");
  const bytes = await page.pdf({ preferCSSPageSize: true, tagged: true, printBackground: true });
  return { pdf: await PDFDocument.load(bytes), bytes };
}

/** The marks of the closing line on its own (everything else invisible, the layout unchanged); 0 for a document without one (the certificate). */
async function closingMarks(page: Page, c: AuditCase, html: string): Promise<number> {
  if (c.closing === null) return 0;
  const { pdf } = await print(page, html, visibleOnly(c.closing));
  return marksPerPage(pdf).reduce((a, b) => a + b, 0);
}

/** CSS that leaves only `selector` visible: the layout does not change, and only its content is marked in the PDF. */
const visibleOnly = (selector: string) =>
  `body * { visibility: hidden !important; } :is(${selector}), :is(${selector}) * { visibility: visible !important; }`;

/**
 * The sweep's spacer: right under the header blocks (the parties, the statement's figures, the deed's parties, the certificate's opening lines), so the
 * content after them moves down while the header stays at the top of its page, as it always is.
 */
const spacer = (mm: number) =>
  `:is(.parties, .stm-band, .deed__parties, .cert__statement + .cert__statement) + * { margin-top: ${mm}mm !important; }`;

/** The faults of one print: a blank page, a last page with only the closing line, a heading ending a page. */
function faults(pdf: PDFDocument, alone: number): string[] {
  const marks = marksPerPage(pdf);
  const out: string[] = [];
  marks.forEach((m, i) => {
    if (m === 0) out.push(`page ${i + 1} is blank`);
  });
  if (marks.length > 1 && (marks.at(-1) as number) <= alone)
    out.push("the last page holds only the closing line");
  for (const h of headingAtFoot(structure(pdf))) out.push(`${h} ends the page, its content overleaf`);
  return out;
}

/** The blocks of `selectors` the document has, each split over two pages or not (the first match of each; layout unchanged, everything else invisible). */
async function splitBlocks(page: Page, html: string, selectors: string[], css = ""): Promise<string[]> {
  await page.setContent(html, { waitUntil: "load" });
  const present: string[] = [];
  for (const s of selectors) if ((await page.locator(s).count()) > 0) present.push(s);
  const out: string[] = [];
  for (const s of present) {
    const { pdf } = await print(page, html, `${css}\n${visibleOnly(s)}`);
    const pages = marksPerPage(pdf)
      .map((m, i) => (m > 0 ? i + 1 : 0))
      .filter((p) => p > 0);
    if (pages.length > 1) out.push(`${s} is split over pages ${pages.join(", ")}`);
  }
  return out;
}

const out = process.env.AUDIT_OUT;
/** The sweep's step in mm (AUDIT_STEP; 12 by default: 20 steps a case). */
const STEP = Number(process.env.AUDIT_STEP ?? 12);
if (out) mkdirSync(out, { recursive: true });

for (const c of AUDIT_CASES) {
  const slug = auditSlug(c);
  test.describe(`${c.kind}: ${c.case}`, () => {
    test("pages; no blank page, lone closing line, heading at the foot of a page or split block", async ({
      page,
    }) => {
      const html = await c.html();
      const alone = await closingMarks(page, c, html);
      if (c.closing !== null) expect(alone, "the closing line was found").toBeGreaterThan(0);
      const { pdf, bytes } = await print(page, html);
      if (out) writeFileSync(join(out, `${slug}.pdf`), bytes);
      const n = pdf.getPageCount();
      console.log(`AUDIT ${slug} pages ${n} marks ${marksPerPage(pdf).join(",")}`);
      expect([...faults(pdf, alone), ...(await splitBlocks(page, html, WHOLE))]).toEqual([]);
      expect(n).toBe(PAGES[slug]);
    });

    test("the sweep: pushed down through a page, the same rules at every step", async ({ page }) => {
      test.setTimeout(600_000);
      const html = await c.html();
      // A document of three pages or more already breaks at many heights (the first test checks every one of them); the sweep is for the short ones.
      const { pdf: plain } = await print(page, html);
      test.skip(
        plain.getPageCount() > 2,
        "three pages or more: its own page breaks are checked by the first test",
      );
      const step = STEP;
      const alone = await closingMarks(page, c, html);
      const found: string[] = [];
      for (let mm = step; mm <= 240; mm += step) {
        const { pdf, bytes } = await print(page, html, spacer(mm));
        const f = [...faults(pdf, alone), ...(await splitBlocks(page, html, WHOLE_IN_SWEEP, spacer(mm)))];
        if (f.length > 0) {
          found.push(`+${mm} mm: ${f.join("; ")}`);
          if (out) writeFileSync(join(out, `${slug}-sweep-${mm}.pdf`), bytes);
        }
      }
      if (found.length) console.log(`SWEEP ${slug}\n  ${found.join("\n  ")}`);
      expect(found).toEqual([]);
    });
  });
}
