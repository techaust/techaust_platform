// T11 (POR-05; RB-38(a)): the signed deed on the accepted proposal's page and the `deed.signed` email, on the labelled sample API (`?sample=on`; nothing is
// saved or sent; the deed's number, eSign moment and transaction ID are made up):
//   - "Accepted by you" shows the deed card under the summary (07-ZJ lines 3 to 6), the download asks by request body and saves the file;
//   - a version that isn't accepted, and the emailed link's view, show no card;
//   - axe (WCAG 2.2 AA), both colour schemes, 1280 and 390 px; the email preview in both schemes.
// Screenshots only when T11_SHOTS names a folder (absolute path). Run: T11_SHOTS=<abs dir> bash tools/heavy.sh --log t11-portal pnpm --filter @techaust/portal exec playwright test e2e/t11-deed.spec.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const SHOTS = process.env.T11_SHOTS ?? "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const FAILING = new Set(["moderate", "serious", "critical"]);
const VIEWS = [
  { width: 1280, scheme: "light" },
  { width: 1280, scheme: "dark" },
  { width: 390, scheme: "light" },
  { width: 390, scheme: "dark" },
] as const;

async function axe(page: Page, where: string) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const bad = r.violations.filter((v) => FAILING.has(v.impact ?? ""));
  expect(bad.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual(
    [],
  );
}

test("the signed deed on 'Accepted by you': card, download, axe, both schemes and widths", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  for (const v of VIEWS) {
    await page.setViewportSize({ width: v.width, height: 900 });
    await page.emulateMedia({ colorScheme: v.scheme, reducedMotion: "reduce" });
    await page.goto("/proposals/sample-accepted?sample=on");
    const card = page.locator(".deedcard");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2 })).toHaveText(/Deed of assignment$/);
    await expect(card).toContainText("TH/DA/2627/0001");
    await expect(card).toContainText("Signed with Aadhaar eSign on 03 Nov 2026, 14:05 IST");
    await expect(card).toContainText("SAMPLE-ESIGN-7F3K-29QD");
    const button = card.getByRole("button", { name: /Download signed deed$/ });
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => document.fonts.ready);
    await axe(page, `accepted ${v.width} ${v.scheme}`);
    if (SHOTS) {
      await page.screenshot({
        path: join(SHOTS, `portal-deed-${v.width}-${v.scheme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await card.screenshot({
        path: join(SHOTS, `portal-deed-card-${v.width}-${v.scheme}.png`),
        animations: "disabled",
      });
    }
  }
  // The download names the deed in the request body, never in the address, and saves the file the server names.
  const req = page.waitForRequest((r) => r.url().endsWith("/api/v1/deeds/pdf"));
  const dl = page.waitForEvent("download");
  await page
    .locator(".deedcard")
    .getByRole("button", { name: /Download signed deed$/ })
    .click();
  expect((await req).postDataJSON()).toEqual({ id: "sample-deed" });
  expect((await dl).suggestedFilename()).toBe("TH-DA-2627-0001-signed.pdf");
  // Keyboard: the button is reachable and shows the focus ring.
  await page
    .locator(".deedcard")
    .getByRole("button", { name: /Download signed deed$/ })
    .focus();
  expect(await page.locator(":focus").evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  expect(errors).toEqual([]);
});

test("no deed card on a version that isn't accepted, nor on the emailed link's view", async ({ page }) => {
  await page.goto("/proposals/sample-sent?sample=on");
  await expect(page.locator("#acceptance")).toBeVisible();
  await expect(page.locator(".deedcard")).toHaveCount(0);
  await page.goto("/proposals/sample-accepted-other?sample=on");
  await expect(page.locator(".docside__card")).toBeVisible();
  await expect(page.locator(".deedcard")).toHaveCount(0);
});

test("the deed.signed email in the preview, both schemes", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/preview/email");
    const one = page.locator("section.pv-email__one", { has: page.locator("#deed-signed-h") });
    await expect(one).toBeVisible();
    await expect(one.locator("iframe")).toBeVisible();
    await page.waitForTimeout(500);
    if (SHOTS)
      await one.screenshot({ path: join(SHOTS, `email-deed-signed-${scheme}.png`), animations: "disabled" });
  }
});
