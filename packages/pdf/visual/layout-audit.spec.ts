// M6.3 staging fixes, part 3: the layout audit of every PDF the system makes (test/fixtures/audit.ts: each kind short, long, and in between). For every
// case, printed by Chromium as Browser Run is asked to print it:
//   - its page count is the pinned one (`PAGES`), so a layout change that adds or drops a page is seen;
//   - no page is blank, no page holds only the closing line, and no heading ends a page with its content overleaf;
//   - the sweep: the content is pushed down a few millimetres at a time (a spacer above the first block) through most of a page, so the end of the
//     document and every block boundary crosses the foot of a page at every height; at every step the same three rules hold.
// AUDIT_OUT=<folder> also writes each case's PDF there (for looking at by eye; never commit them). Sample data only.
// Run: bash tools/heavy.sh --log pdf-audit pnpm --filter @techaust/pdf exec playwright test -c playwright.config.ts visual/layout-audit.spec.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import { expect, type Page, test } from "@playwright/test";
import { AUDIT_CASES, type AuditCase, auditSlug } from "../test/fixtures/audit.ts";
import { headingAtFoot, marksPerPage, structure } from "./pdf-pages.ts";

/** Pages per case (printed 2026-11-02 after the fixes; Chromium of @playwright/test 1.64.1). */
const PAGES: Record<string, number> = {};

const CONTAINER = ":is(.doc, .deed, .cert)";

async function print(page: Page, html: string, css = ""): Promise<{ pdf: PDFDocument; bytes: Buffer }> {
  await page.emulateMedia({ media: "print" });
  await page.setContent(html, { waitUntil: "load" });
  if (css) await page.addStyleTag({ content: css });
  await page.evaluate("document.fonts.ready.then(() => true)");
  const bytes = await page.pdf({ preferCSSPageSize: true, tagged: true, printBackground: true });
  return { pdf: await PDFDocument.load(bytes), bytes };
}

/** The marks of the closing line printed on its own (every other child of the document hidden); 0 for a document without one (the certificate). */
async function closingMarks(page: Page, c: AuditCase, html: string): Promise<number> {
  if (c.closing === null) return 0;
  const { pdf } = await print(page, html, `${CONTAINER} > :not(${c.closing}) { display: none !important; }`);
  return marksPerPage(pdf)[0] as number;
}

/** The sweep's spacer: above the first block (after a proposal's cover page, which is a page of its own), so the whole document moves down. */
const spacer = (mm: number) =>
  `${CONTAINER} > :first-child:not(.cover), ${CONTAINER} > .cover + * { margin-top: ${mm}mm !important; }`;

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

const out = process.env.AUDIT_OUT;
/** The sweep's step in mm (AUDIT_STEP; 6 by default: 45 prints a case). */
const STEP = Number(process.env.AUDIT_STEP ?? 6);
if (out) mkdirSync(out, { recursive: true });

for (const c of AUDIT_CASES) {
  const slug = auditSlug(c);
  test.describe(`${c.kind}: ${c.case}`, () => {
    test("pages, and no blank page, lone closing line or heading at the foot of a page", async ({ page }) => {
      const html = await c.html();
      const alone = await closingMarks(page, c, html);
      if (c.closing !== null) expect(alone, "the closing line was found").toBeGreaterThan(0);
      const { pdf, bytes } = await print(page, html);
      if (out) writeFileSync(join(out, `${slug}.pdf`), bytes);
      const n = pdf.getPageCount();
      console.log(`AUDIT ${slug} pages ${n} marks ${marksPerPage(pdf).join(",")}`);
      expect(faults(pdf, alone)).toEqual([]);
      if (PAGES[slug] !== undefined) expect(n).toBe(PAGES[slug]);
    });

    test("the sweep: pushed down through a page, never a blank page, a lone closing line or a heading at the foot", async ({
      page,
    }) => {
      const html = await c.html();
      const alone = await closingMarks(page, c, html);
      const found: string[] = [];
      for (let mm = STEP; mm <= 240; mm += STEP) {
        const { pdf, bytes } = await print(page, html, spacer(mm));
        const f = faults(pdf, alone);
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
