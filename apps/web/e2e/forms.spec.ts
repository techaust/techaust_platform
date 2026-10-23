// Both forms, reached and submitted with the keyboard only (FRM-01 to FRM-07, WCAG 2.1.1). Turnstile runs with
// Cloudflare's always-pass TEST key (the local wrangler vars and `pnpm dev:secrets`); a good submission ends on /thanks.
// The address limit is 2 submissions a minute, which these two tests use exactly: do not add a third submission.
import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

/** Stored choices that keep the page deterministic: INR prices, so the INR budget bands are the visible ones. */
async function prepare(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ta_currency", "inr"));
  await page.route("**/api/geo", (r) => r.fulfill({ json: { currency: "INR" } }));
}

/** Types into the focused field the way a person does. */
const type = (page: Page, text: string) => page.keyboard.type(text, { delay: 5 });

test("the contact form is reachable and submittable by keyboard", async ({ page }) => {
  await prepare(page);
  await page.goto("/contact");
  // Reachable: Tab from the top of the page gets to the first field without a mouse.
  const first = page.locator("#f-name");
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await first.evaluate((el) => el === document.activeElement);
  }
  expect(reached, "Tab reaches the name field").toBe(true);
  await type(page, "Test Person");
  await page.keyboard.press("Tab");
  await type(page, "test.person@example.test");
  await page.keyboard.press("Tab"); // company
  await page.keyboard.press("Tab"); // phone
  await page.keyboard.press("Tab"); // message
  await expect(page.locator("#f-message")).toBeFocused();
  await type(page, "We would like to automate our month-end invoice matching.");
  const submit = page.locator("[data-submit]");
  await submit.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/thanks\?ref=/, { timeout: 40_000 });
  await expect(page.locator("h1")).toBeVisible();
});

test("an invalid contact form shows the error summary and puts focus on it, with the keyboard", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/contact");
  await page.locator("[data-submit]").focus();
  await page.keyboard.press("Enter");
  const summary = page.locator("#contact-errors, [data-error-summary]").first();
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();
  await expect(page).toHaveURL(/\/contact$/);
});

test("the quote form runs through its four steps and submits by keyboard", async ({ page }) => {
  await prepare(page);
  await page.goto("/get-a-quote");
  const next = (n: number) => page.locator(`[data-qstep="${n}"] [data-next]`);
  // Step 1: a service. Space ticks the focused radio.
  await page.locator("#c-service-S1").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#c-service-S1")).toBeChecked();
  await next(1).focus();
  await page.keyboard.press("Enter");
  // Step 2: goals. Focus lands on the step's heading.
  await expect(page.locator('[data-qstep="2"] [data-step-title]')).toBeFocused();
  await page.locator("#f-goals").focus();
  await type(page, "Match supplier invoices to purchase orders and post them to Tally without retyping.");
  await next(2).focus();
  await page.keyboard.press("Enter");
  // Step 3: budget and timeline.
  await expect(page.locator('[data-qstep="3"] [data-step-title]')).toBeFocused();
  await page.locator("#c-budget-INR-not-sure").focus();
  await page.keyboard.press("Space");
  await page.locator("#c-timeline-exploring").focus();
  await page.keyboard.press("Space");
  await next(3).focus();
  await page.keyboard.press("Enter");
  // Step 4: details, then submit.
  await expect(page.locator('[data-qstep="4"] [data-step-title]')).toBeFocused();
  await page.locator("#q-name").focus();
  await type(page, "Test Person");
  await page.keyboard.press("Tab");
  await type(page, "test.person@example.test");
  await page.locator("#q-country").focus();
  await page.keyboard.type("India");
  await expect(page.locator("#q-country")).toHaveValue("IN");
  await page.locator("[data-submit]").focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/thanks\?ref=/, { timeout: 40_000 });
});
