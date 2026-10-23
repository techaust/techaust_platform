// Routes and layout stability: the services hub links all resolve, the flagged-off S3 page is a 404 (WEB-G-17), and the
// currency swap moves nothing (CLS, WEB-G-06, NFR-1).
import { expect, test } from "@playwright/test";

test.describe("services hub", () => {
  test("every link on it resolves, and none points at the flagged-off DPDP page", async ({
    page,
    request,
  }) => {
    await page.goto("/services");
    const hrefs = await page
      .locator("main a[href^='/']")
      .evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""))]);
    expect(hrefs.length).toBeGreaterThan(10);
    expect(hrefs.filter((h) => h.includes("dpdp"))).toEqual([]);
    for (const href of hrefs) {
      const path = href.split("#")[0] ?? "";
      if (!path) continue;
      const res = await request.get(path);
      expect(res.status(), `${href} should resolve`).toBe(200);
    }
  });

  test("every service in the menu has a live page", async ({ page, request }) => {
    await page.goto("/");
    const hrefs = await page
      .locator("#hd-services a[href^='/services/']")
      .evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""))]);
    expect(hrefs.length).toBe(14);
    for (const href of hrefs) expect((await request.get(href)).status(), href).toBe(200);
  });
});

test.describe("flagged-off pages (WEB-G-17)", () => {
  test("the S3 page returns 404 while S3_DPDP_PAGE is off, and is not in the sitemap", async ({
    request,
  }) => {
    const res = await request.get("/services/dpdp-readiness");
    expect(res.status()).toBe(404);
    expect(await res.text()).toContain("<h1");
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).not.toContain("dpdp");
  });

  test("unknown paths show the 404 page, and the machine files are served", async ({ request }) => {
    expect((await request.get("/no-such-page")).status()).toBe(404);
    for (const f of ["/sitemap.xml", "/robots.txt", "/llms.txt", "/rss.xml"]) {
      expect((await request.get(f)).status(), f).toBe(200);
    }
  });
});

test.describe("currency swap does not shift the layout (CLS <= 0.05)", () => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 800 },
  ]) {
    for (const path of ["/pricing", "/services/app-rescue"]) {
      test(`${path} at ${viewport.width}px`, async ({ browser }) => {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        // A first visit from outside India: no stored choice, so /api/geo answers USD after the first paint.
        let asked = false;
        await page.route("**/api/geo", async (route) => {
          asked = true;
          await new Promise((r) => setTimeout(r, 400));
          await route.fulfill({ json: { currency: "USD" }, headers: { "Cache-Control": "no-store" } });
        });
        await page.addInitScript(() => {
          const w = window as unknown as { __cls: number };
          w.__cls = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
              if (!e.hadRecentInput) w.__cls += e.value;
          }).observe({ type: "layout-shift", buffered: true });
        });
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("data-currency", "usd");
        expect(asked).toBe(true);
        await page.waitForTimeout(1500);
        const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
        expect(cls).toBeLessThanOrEqual(0.05);
        await context.close();
      });
    }
  }
});

// Lighthouse's Best Practices counts every DevTools issue ("inspector-issues"). On the form pages zod's eval probe was
// blocked by our CSP (it scored 96; src/scripts/zod-jitless.ts turns the probe off): this keeps any CSP violation, on
// the pages that run scripts, from coming back unnoticed.
test.describe("no Content Security Policy violations (WEB-G-13)", () => {
  for (const path of ["/contact", "/get-a-quote", "/", "/pricing", "/services/app-rescue"]) {
    test(path, async ({ page, context }) => {
      const cdp = await context.newCDPSession(page);
      const issues: string[] = [];
      cdp.on("Audits.issueAdded", (e) => {
        if (e.issue.code === "ContentSecurityPolicyIssue") issues.push(JSON.stringify(e.issue.details));
      });
      await cdp.send("Audits.enable");
      await page.addInitScript(() => {
        const w = window as unknown as { __csp: string[] };
        w.__csp = [];
        document.addEventListener("securitypolicyviolation", (e) =>
          w.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.columnNumber}`),
        );
      });
      // "load", then a short settle: Turnstile keeps a connection open on the form pages, so "networkidle" never comes.
      await page.goto(path, { waitUntil: "load" });
      await page.waitForTimeout(2000);
      // Use the form a little, so its schemas have been built and run.
      if (path === "/contact") {
        await page.locator("#f-name").fill("Sample Visitor");
        await page.locator("#f-message").focus();
      }
      const fromPage = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
      expect([...fromPage, ...issues]).toEqual([]);
    });
  }
});
