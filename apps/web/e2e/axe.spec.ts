// axe on every built page, light and dark: no serious or critical violation (WCAG 2.2 AA is the target; NFR-1).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { builtPages } from "./pages";

const pages = builtPages();

test.describe("axe", () => {
  test("covers the whole site", () => {
    expect(pages.length).toBeGreaterThan(30);
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const { name, url } of pages) {
      test(`${name} (${scheme}) has no serious or critical violations`, async ({ page }) => {
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
          .filter((v) => v.impact === "serious" || v.impact === "critical")
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
});
