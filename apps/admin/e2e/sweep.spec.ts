// The admin sweep (FX-3, audit A3 1 and 2; ADM-G-03, NFR-1): every route, signed in as an Owner, at 768 and 1024 px.
//   - The page never scrolls sideways: `scrollWidth` ≤ `clientWidth` on the document (a wide table scrolls inside its own box).
//   - axe finds no moderate, serious or critical violation (WCAG 2.2 AA), in the light and the dark theme. This includes
//     `scrollable-region-focusable`: a box that scrolls sideways is a keyboard stop (components/scroll-region.ts).
//   - A box that does scroll sideways takes focus from the keyboard and moves with the arrow keys.
// The record pages are found from the lists (the first client, project, lead, care plan, document, invoice, catalogue item and
// template the local database holds); a list that is empty in this database is checked as its empty state. A lead, a client and a
// template must be found (global-setup adds a sample lead when there is none), and the keyboard test must meet a scroll box.
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

/** The record pages the sweep must reach in any prepared database (the seed's templates, the sample clients, global-setup's lead). */
const REQUIRED = ["lead", "client", "template"] as const;

/**
 * The first record of each list, by its API's own first page (no `limit`: the lists take only their default page size, and any other
 * value is a 400, which once left every record page out of the sweep: FX-3 review 3). A list that answers anything but 200 fails here.
 */
async function records(page: Page): Promise<Record<string, string>> {
  const first = async (kind: string, path: string, key: string, to: (id: string) => string) => {
    const res = await page.request.get(`/api/v1${path}`);
    expect(res.status(), `GET /api/v1${path}`).toBe(200);
    const body = (await res.json()) as Record<string, { id: string }[] | undefined>;
    expect(Array.isArray(body[key]), `GET /api/v1${path} has "${key}"`).toBe(true);
    const id = body[key]?.[0]?.id;
    return [kind, id ? to(encodeURIComponent(id)) : null] as const;
  };
  const found = await Promise.all([
    first("lead", "/leads", "leads", (id) => `/leads/${id}`),
    first("client", "/clients", "clients", (id) => `/clients/${id}`),
    first("project", "/projects", "projects", (id) => `/projects/${id}`),
    first("care plan", "/care-plans", "carePlans", (id) => `/care-plans/${id}`),
    first("document", "/documents", "documents", (id) => `/documents/${id}`),
    first("invoice", "/invoices", "invoices", (id) => `/invoices/${id}`),
    first("catalogue item", "/catalogue", "items", (id) => `/catalogue/${id}`),
    first("template", "/templates", "templates", (id) => `/catalogue/templates/${id}`),
  ]);
  return Object.fromEntries(found.filter((f): f is readonly [string, string] => f[1] !== null));
}

/** Waits until the route has drawn its content: no skeleton and nothing busy (the lists load after the shell). */
async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton, [aria-busy='true']")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

test.describe("admin sweep", () => {
  // Each test visits every route (about 45), with axe on each: minutes, not seconds.
  test.describe.configure({ timeout: 15 * 60_000 });
  let routes: string[] = [];
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/");
    const found = await records(page);
    for (const kind of REQUIRED) expect(found[kind], `the sweep finds a ${kind} to visit`).toBeTruthy();
    console.log(
      `record pages swept: ${Object.entries(found)
        .map(([k, p]) => `${k} ${p}`)
        .join(", ")}`,
    );
    routes = [...LISTS, ...Object.values(found)];
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

  // The other widths of the audit's set (a phone, a laptop, a wide screen): no sideways page scroll, in the light theme.
  test("every route at 375, 1280 and 1600 px: no sideways page scroll", async ({ page }) => {
    const problems: string[] = [];
    for (const width of [375, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(route);
        await settled(page);
        const d = await page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.documentElement.clientWidth,
        ]);
        if ((d[0] ?? 0) > (d[1] ?? 0)) problems.push(`${route} at ${width}: ${d[0]} > ${d[1]}`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("a table wider than its box is a keyboard stop that the arrow keys scroll", async ({ page }) => {
    // Every route at 768, and Settings › Numbering at 1024, where its table sits beside the settings menu and is known to scroll in its
    // own box: the test must meet at least one such box, so it can't pass on none (FX-3 review 3).
    const visits = [
      ...routes.map((route) => ({ route, width: 768 })),
      { route: "/settings/numbering", width: 1024 },
    ];
    let met = 0;
    for (const { route, width } of visits) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await settled(page);
      const at = `${route} at ${width}`;
      const regions = page.locator("[data-scrolls]");
      const n = await regions.count();
      for (let i = 0; i < n; i++) {
        const r = regions.nth(i);
        if (!(await r.isVisible())) continue;
        met++;
        await expect(r, at).toHaveAttribute("tabindex", "0");
        await expect(r, at).toHaveAttribute("role", "region");
        expect(await r.getAttribute("aria-label"), at).toBeTruthy();
        await r.focus();
        const before = await r.evaluate((el) => el.scrollLeft);
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => r.evaluate((el) => el.scrollLeft), { message: at }).toBeGreaterThan(before);
      }
    }
    console.log(`scroll boxes met by the keyboard: ${met}`);
    expect(met, "the keyboard test meets at least one box that scrolls sideways").toBeGreaterThan(0);
  });
});
