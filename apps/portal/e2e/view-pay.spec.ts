// The emailed "View & pay" link (POR-06; run file I "E2E", C12 to C15, C25), on the labelled sample API (`?sample=on`; nothing saved or sent): the token page
// with its bank-transfer way and "I've paid" (the token only in the request body), the footer's way to sign in, a withdrawn payment request with nothing
// payable, and axe (WCAG 2.2 AA) at 390 and 1280 px in both themes. The stub gateway payment from the link (finance `GATEWAY_TRANSPORT=stub`,
// scripts/pay-simulate.mjs) needs the whole local stack and is not in this file (run file, designer report).
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const P = "[Placeholder] ";
const TOKEN = `I${"a".repeat(42)}`;
const WITHDRAWN = `W${"a".repeat(42)}`;

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("#sample-label")
    .analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("the link's page: Bank transfer, I've paid with the token in the body, and the footer", async ({
  page,
}) => {
  await page.goto(`/i?sample=on#t=${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // the token left the address at once (lib/invoices.ts)
  expect(page.url()).not.toContain(TOKEN);
  await page.getByRole("button", { name: `${P}Bank transfer` }).click();
  await expect(page.getByRole("heading", { name: "How to pay" })).toBeFocused();
  // the jump never puts a hash in the address (the link's page reloads on one)
  expect(new URL(page.url()).hash).toBe("");
  // the sample API answers inside the page (no network), so the calls are read from a wrapper around its fetch
  await page.evaluate(() => {
    const w = window as unknown as { __calls: { url: string; body: string }[] };
    w.__calls = [];
    const f = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      w.__calls.push({ url: String(input), body: typeof init?.body === "string" ? init.body : "" });
      return f(input, init);
    };
  });
  await page.getByRole("button", { name: `${P}I've paid` }).click();
  const dialog = page.getByRole("dialog", { name: `${P}Tell us about your payment` });
  await dialog.getByRole("textbox", { name: `${P}Amount paid` }).fill("1,000");
  await dialog.locator(".datefield__input").fill("03/11/2026");
  await dialog
    .getByRole("textbox", { name: `${P}Transaction reference (UTR or similar)` })
    .fill("UTR0000000002");
  await dialog.getByRole("button", { name: `${P}Send` }).click();
  await expect(dialog).toBeHidden();
  const calls = await page.evaluate(
    () => (window as unknown as { __calls: { url: string; body: string }[] }).__calls,
  );
  const sent = calls.find((c) => c.url.endsWith("/api/v1/t/document/paid-notice"));
  expect(sent, "the notice went to the link's route, with no query").toBeTruthy();
  const body = JSON.parse(sent?.body ?? "{}") as Record<string, unknown>;
  expect(body.token).toBe(TOKEN);
  expect(body.amountMinor).toBe(100_000);
  expect(body.paidOn).toBe("2026-11-03");
  await expect(page.getByText(/^\[Placeholder\] Thanks\. We'll check our bank/)).toBeVisible();
  await expect(page.getByText(`${P}Sign in to see all your invoices, receipts and projects.`)).toBeVisible();
});

test("a withdrawn payment request from its link: nothing payable", async ({ page }) => {
  await page.goto(`/i?sample=on#t=${WITHDRAWN}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: `${P}Bank transfer` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `${P}I've paid` })).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const)
  for (const width of [390, 1280] as const)
    test(`the link's page and its dialog pass axe at ${width} px in the ${scheme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/i?sample=on#t=${TOKEN}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
        true,
      );
      await page.getByRole("button", { name: `${P}I've paid` }).click();
      expect(await axe(page)).toEqual([]);
    });
