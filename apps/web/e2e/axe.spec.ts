// axe on every built page, light and dark, at the desktop width and at 375 px (the smallest phone, audit A2 finding 1): no
// moderate, serious or critical violation (WCAG 2.2 AA is the target; NFR-1, WEB-G-16; moderate too since audit A2 finding 5).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { builtPages } from "./pages";

const pages = builtPages();

/** The impacts that fail a page: everything but "minor". */
const FAILING = new Set(["moderate", "serious", "critical"]);

/** Desktop (the project's Desktop Chrome width) and the smallest phone. */
const WIDTHS = [
  { width: 1280, height: 720 },
  { width: 375, height: 800 },
] as const;

test.describe("axe", () => {
  test("covers the whole site", () => {
    expect(pages.length).toBeGreaterThan(30);
  });

  for (const viewport of WIDTHS) {
    for (const scheme of ["light", "dark"] as const) {
      for (const { name, url } of pages) {
        test(`${name} (${scheme}, ${viewport.width}px) has no moderate, serious or critical violations`, async ({
          page,
        }) => {
          await page.setViewportSize(viewport);
          // The head script reads this before the first paint, so the page is drawn in the chosen theme.
          await page.addInitScript((s) => localStorage.setItem("ta_theme", s), scheme);
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
          await page.goto(url);
          await page.evaluate(() => document.fonts.ready);
          expect(await page.locator("html").getAttribute("data-theme")).toBe(scheme);
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
            .analyze();
          const bad = results.violations
            .filter((v) => FAILING.has(v.impact ?? ""))
            .map(
              (v) =>
                `${v.id} (${v.impact}): ${v.nodes
                  .slice(0, 3)
                  .map((n) => n.target.join(" "))
                  .join(" | ")}`,
            );
          expect(bad).toEqual([]);
        });
      }
    }
  }
});
