// The admin sweep (FX-3, audit A3 1 and 2; ADM-G-03, NFR-1): every route, signed in as an Owner, at 768 and 1024 px.
//   - The page never scrolls sideways: `scrollWidth` ≤ `clientWidth` on the document (a wide table scrolls inside its own box).
//   - axe finds no moderate, serious or critical violation (WCAG 2.2 AA), in the light and the dark theme. This includes
//     `scrollable-region-focusable`: a box that scrolls sideways is a keyboard stop (components/scroll-region.ts).
//   - A box that does scroll sideways takes focus from the keyboard and moves with the arrow keys.
// The record pages are found from the lists (the first client, project, lead, care plan, document, invoice, catalogue item and
// template the local database holds); a list that is empty in this database is checked as its empty state.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const FAILING = new Set(["moderate", "serious", "critical"]);
const WIDTHS = [768, 1024] as const;
const THEMES = ["light", "dark"] as const;

const LISTS = [
  "/",
  "/leads",
  "/leads/new",
  "/clients",
  "/clients/new",
  "/projects",
  "/projects/new",
  "/care-plans",
  "/care-plans/new",
  "/time",
  "/proposals",
  "/estimates",
  "/invoices",
  "/approvals",
  "/catalogue",
  "/catalogue?tab=templates",
  "/catalogue?tab=publish",
  "/catalogue/new",
  "/reports/gst",
  "/reports/sales-register",
  "/reports/edf",
  "/reports/realisation",
  "/audit",
  "/account",
  "/settings",
  "/settings/users",
  "/settings/company",
  "/settings/bank",
  "/settings/tax",
  "/settings/numbering",
  "/settings/payment-terms",
  "/settings/gateways",
  "/settings/email",
  "/settings/terms",
  "/settings/retention",
  "/settings/flags",
];

/** The first record of each list, by its API (null when the local database has none). */
async function records(page: Page): Promise<string[]> {
  const first = async (path: string, key: string, to: (id: string) => string) => {
    const res = await page.request.get(`/api/v1${path}`);
    if (!res.ok()) return null;
    const body = (await res.json()) as Record<string, { id: string }[] | undefined>;
    const id = body[key]?.[0]?.id;
    return id ? to(encodeURIComponent(id)) : null;
  };
  const found = await Promise.all([
    first("/leads?limit=1", "leads", (id) => `/leads/${id}`),
    first("/clients?limit=1", "clients", (id) => `/clients/${id}`),
    first("/projects?limit=1", "projects", (id) => `/projects/${id}`),
    first("/care-plans?limit=1", "carePlans", (id) => `/care-plans/${id}`),
    first("/documents?limit=1", "documents", (id) => `/documents/${id}`),
    first("/invoices?limit=1", "invoices", (id) => `/invoices/${id}`),
    first("/catalogue?limit=1", "items", (id) => `/catalogue/${id}`),
    first("/templates?limit=1", "templates", (id) => `/catalogue/templates/${id}`),
  ]);
  return found.filter((p): p is string => p !== null);
}

/** Waits until the route has drawn its content: no skeleton and nothing busy (the lists load after the shell). */
async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton, [aria-busy='true']")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

test.describe("admin sweep", () => {
  let routes: string[] = [];
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/");
    routes = [...LISTS, ...(await records(page))];
    await page.close();
  });

  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      test(`every route at ${width} px, ${theme}: no sideways page scroll and no axe violations`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        // The in-app theme (stored on this device) against the opposite OS theme: the app's choice must win.
        await page.addInitScript((t) => localStorage.setItem("ta-admin-theme", t), theme);
        await page.emulateMedia({
          colorScheme: theme === "light" ? "dark" : "light",
          reducedMotion: "reduce",
        });
        const problems: string[] = [];
        for (const route of routes) {
          await page.goto(route);
          await settled(page);
          expect(await page.locator("html").getAttribute("data-theme"), route).toBe(theme);
          const sideways = await page.evaluate(() => {
            const d = document.documentElement;
            return { scroll: d.scrollWidth, client: d.clientWidth };
          });
          if (sideways.scroll > sideways.client)
            problems.push(`${route}: the page scrolls sideways (${sideways.scroll} > ${sideways.client})`);
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
            .analyze();
          for (const v of results.violations.filter((x) => FAILING.has(x.impact ?? "")))
            problems.push(
              `${route}: ${v.id} (${v.impact}) ${v.nodes
                .slice(0, 3)
                .map((n) => n.target.join(" "))
                .join(" | ")}`,
            );
        }
        expect(problems, problems.join("\n")).toEqual([]);
      });
    }
  }

  test("a table wider than its box is a keyboard stop that the arrow keys scroll", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    for (const route of routes) {
      await page.goto(route);
      await settled(page);
      const regions = page.locator("[data-scrolls]");
      const n = await regions.count();
      for (let i = 0; i < n; i++) {
        const r = regions.nth(i);
        if (!(await r.isVisible())) continue;
        await expect(r, route).toHaveAttribute("tabindex", "0");
        await expect(r, route).toHaveAttribute("role", "region");
        expect(await r.getAttribute("aria-label"), route).toBeTruthy();
        await r.focus();
        const before = await r.evaluate((el) => el.scrollLeft);
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowRight");
        await expect
          .poll(() => r.evaluate((el) => el.scrollLeft), { message: route })
          .toBeGreaterThan(before);
      }
    }
  });
});
