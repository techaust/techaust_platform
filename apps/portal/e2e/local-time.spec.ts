// Times of day in the client's own clock (owner, 2026-11-01; run file docs/runs/portal-local-time.md) [POR-05]: on the labelled sample
// API (`?sample=on`; nothing saved or sent), the acceptance record, the summary's "Accepted" line, the decline record, the list's decided rows and the
// deed card's eSign moment read in the browser's zone with its short name, one time only (an IST clock reads IST). Dates alone keep "(IST)".
// axe (WCAG 2.2 AA) in both colour schemes at 1280 and 390 px for India and London, and once for Los Angeles and Tokyo (the date before and after).
// Screenshots only when LOCAL_SHOTS names a folder (absolute path). Run:
//   LOCAL_SHOTS=<abs dir> bash tools/heavy.sh --log local-time-e2e pnpm --filter @techaust/portal exec playwright test e2e/local-time.spec.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const SHOTS = process.env.LOCAL_SHOTS ?? "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const FAILING = new Set(["moderate", "serious", "critical"]);
const ALL_VIEWS = [
  { width: 1280, scheme: "light" },
  { width: 1280, scheme: "dark" },
  { width: 390, scheme: "light" },
  { width: 390, scheme: "dark" },
] as const;

/** A moment as the screen writes it, ending in one of the zone's short names (the sample decisions are days old: either side of a clock change). */
const moment = (zones: readonly string[]) =>
  new RegExp(
    `^\\d{2} [A-Z][a-z]{2} \\d{4}, \\d{2}:\\d{2} (?:${zones.map((z) => z.replaceAll("+", "\\+")).join("|")})$`,
  );

const ZONES = [
  // The sample deed was signed at 08:35 UTC on 03 Nov 2026.
  {
    id: "Asia/Kolkata",
    locale: "en-IN",
    zones: ["IST"],
    deed: "03 Nov 2026, 14:05 IST",
    views: ALL_VIEWS,
    slug: "kolkata",
  },
  {
    id: "Europe/London",
    locale: "en-GB",
    zones: ["GMT", "BST"],
    deed: "03 Nov 2026, 08:35 GMT",
    views: ALL_VIEWS,
    slug: "london",
  },
  {
    id: "America/Los_Angeles",
    locale: "en-US",
    zones: ["PST", "PDT"],
    deed: "03 Nov 2026, 00:35 PST",
    views: [ALL_VIEWS[0]],
    slug: "los-angeles",
  },
  {
    id: "Asia/Tokyo",
    locale: "en-US",
    zones: ["GMT+9"],
    deed: "03 Nov 2026, 17:35 GMT+9",
    views: [ALL_VIEWS[0]],
    slug: "tokyo",
  },
] as const;

async function axe(page: Page, where: string) {
  // The preview's "sample data" bar (dev only, never built) is taken out before the check, as in t11-deed.spec.ts.
  await page.evaluate(() => document.getElementById("sample-label")?.remove());
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const bad = r.violations.filter((v) => FAILING.has(v.impact ?? ""));
  expect(bad.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual(
    [],
  );
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true, animations: "disabled" });
}

for (const z of ZONES) {
  test.describe(`clock ${z.id}`, () => {
    test.use({ timezoneId: z.id, locale: z.locale });

    test(`times of day in ${z.zones.join(" or ")}, dates alone in IST`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      for (const v of z.views) {
        const tag = `${z.slug}-${v.width}-${v.scheme}`;
        await page.setViewportSize({ width: v.width, height: 900 });
        await page.emulateMedia({ colorScheme: v.scheme, reducedMotion: "reduce" });

        // Accepted by you: the summary's line, the record's "When", the deed card.
        await page.goto("/proposals/sample-accepted?sample=on");
        await expect(page.locator(".deedcard")).toContainText(`Signed with Aadhaar eSign on ${z.deed}`);
        await expect(page.locator(".docside__when strong")).toHaveText(moment(z.zones));
        const when = page.locator(".facts--record div", { hasText: "Date and time" }).locator("dd");
        await expect(when).toHaveText(moment(z.zones));
        await shot(page, `accepted-${tag}`);
        await axe(page, `accepted ${tag}`);

        // Declined: the record's "When".
        await page.goto("/proposals/sample-declined?sample=on");
        await expect(
          page.locator(".facts--record div", { hasText: "Date and time" }).locator("dd"),
        ).toHaveText(moment(z.zones));
        await shot(page, `declined-${tag}`);
        await axe(page, `declined ${tag}`);

        // Proposals and estimates: decided rows carry the local moment; a row without a decision keeps its validity "(IST)".
        await page.goto("/proposals?sample=on");
        // The expectation follows the row's status, so a decided row that fell back to its validity text fails.
        const rows = page.locator(".drow__status");
        await expect(rows.first()).toBeVisible();
        let decided = 0;
        for (const row of await rows.all()) {
          const when = ((await row.locator(".drow__when").textContent()) ?? "").trim();
          const status = ((await row.textContent()) ?? "").replace(when, "");
          if (/accepted|declined/i.test(status)) {
            decided += 1;
            expect(when).toMatch(moment(z.zones));
          } else {
            expect(when).toMatch(/\(IST\)$/);
          }
        }
        expect(decided).toBeGreaterThan(0);
        await shot(page, `list-${tag}`);
        await axe(page, `list ${tag}`);
      }
      expect(errors).toEqual([]);
    });
  });
}
