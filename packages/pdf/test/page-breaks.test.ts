// M6.3 staging fixes, part 3 (ADM-INV-01, JOB-PDF-01): the closing line of every document never stands alone on a page. The pages themselves are counted by
// Chromium in the visual suite (visual/page-count.spec.ts: the owner's export invoice for a payment received is one page, every fixture's count is pinned,
// and sweeps push the end of each layout across the foot of a page; visual/layout-audit.spec.ts does the same for every PDF kind); this file holds the
// rules that make it so, where CI runs without a browser.
import { describe, expect, it } from "vitest";
import { INVOICE_SKELETON_CSS } from "../src/layout/invoice-skeleton.ts";
import { STATEMENT_CSS } from "../src/layout/statement.ts";
import { TEMPLATE_CSS } from "../src/layout/styles.ts";
import { renderDeedHtml } from "../src/render.ts";
import { AUDIT_CASES } from "./fixtures/audit.ts";
import { deedFixture } from "./fixtures/deed.ts";

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const at = css.search(new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`));
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("the closing line keeps to the content before it", () => {
  it("the integrity line (proposals, estimates and every invoice) avoids a break before it and never splits", () => {
    const r = rule(TEMPLATE_CSS, ".integrity");
    expect(r).toContain("break-before: avoid");
    expect(r).toContain("break-inside: avoid");
  });

  it("an invoice sets its integrity line 5 mm under the content (a one-page invoice ends on its one page)", () => {
    expect(rule(INVOICE_SKELETON_CSS, ".doc--tax-invoice .integrity")).toContain("margin-top: 5mm");
    // the signatory column's spacing, the other half of the room the owner's case needed; the INR block keeps its 4 mm under the totals
    expect(rule(INVOICE_SKELETON_CSS, ".doc--tax-invoice .inv-side")).toContain("gap: 5mm");
    expect(rule(INVOICE_SKELETON_CSS, ".doc--tax-invoice .inv-inr")).toContain("margin-top: -1mm");
  });

  it("the statement's last lines and the deed's closing line avoid a break before them too", () => {
    expect(rule(STATEMENT_CSS, ".doc--statement .stm-foot")).toContain("break-before: avoid");
    const deed = renderDeedHtml(deedFixture("short-inr"));
    expect(rule(deed, ".deed__footer")).toContain("break-before: avoid");
  });
});

describe("the layout audit's fixes (M6.3 staging fixes, part 3)", () => {
  const caseHtml = (kind: string, c: string) => {
    const found = AUDIT_CASES.find((x) => x.kind === kind && x.case === c);
    if (!found) throw new Error(`no audit case ${kind}: ${c}`);
    return found.html();
  };

  it("an invoice's notes end together: the last block and a list's last item keep to the one before", () => {
    expect(
      rule(
        INVOICE_SKELETON_CSS,
        [
          ".doc--tax-invoice .inv-notes .terms > :last-child,",
          ".doc--tax-invoice .inv-notes li:last-child",
        ].join("\n"),
      ),
    ).toContain("break-before: avoid");
  });

  it("the statement's registration line breaks between its parts, never inside 'State West Bengal (19)'", async () => {
    const html = await caseHtml("statement", "short (3 entries)");
    expect(html).toContain(
      '<span class="keep">GSTIN 19ABCDE1234F1ZX</span><br><span class="keep">State West Bengal (19)</span>',
    );
    expect(html).not.toContain("</span> · <span");
  });

  it("the certificate prints the document's number with 'Page X of Y', as every other document", async () => {
    const html = await caseHtml("certificate", "short");
    expect(html).toContain('"TH/PRP/2627/0003 v2   Page " counter(page) " of " counter(pages)');
  });
});
