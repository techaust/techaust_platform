// Both forms, reached and submitted with the keyboard only (FRM-01 to FRM-07, WCAG 2.1.1). Turnstile runs with
// Cloudflare's always-pass TEST key (the local wrangler vars and `pnpm dev:secrets`); a good submission ends on /thanks.
// The address limit is 2 submissions a minute, which these two tests use exactly: do not add a third submission.
// Focus moves only by Tab (Shift+Tab to come back, arrow keys inside a radio group): never `.focus()`.
import { expect, type Locator, type Page, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

/** Stored choices that keep the page deterministic: INR prices, so the INR budget bands are the visible ones. */
async function prepare(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ta_currency", "inr"));
  await page.route("**/api/geo", (r) => r.fulfill({ json: { currency: "INR" } }));
}

/**
 * Moves focus to `target` with the keyboard only (Tab, or Shift+Tab to come back). A radio group is one Tab stop, so
 * inside the target's own group the arrow keys move to it.
 */
async function reach(page: Page, target: Locator, direction: "Tab" | "Shift+Tab" = "Tab") {
  const group = await target.getAttribute("name");
  for (let i = 0; i < 80; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    const sameGroup =
      group !== null &&
      (await page.evaluate((g) => {
        const a = document.activeElement;
        return a instanceof HTMLInputElement && a.type === "radio" && a.name === g;
      }, group));
    await page.keyboard.press(sameGroup ? "ArrowDown" : direction);
  }
  throw new Error("the keyboard never reached the field");
}

/** Types into the focused field the way a person does. */
const type = (page: Page, text: string) => page.keyboard.type(text, { delay: 5 });

test("the contact form is reachable and submittable by keyboard", async ({ page }) => {
  await prepare(page);
  await page.goto("/contact");
  // Reachable: Tab from the top of the page gets to the first field without a mouse.
  await reach(page, page.locator("#f-name"));
  await type(page, "Test Person");
  await reach(page, page.locator("#f-email"));
  await type(page, "test.person@example.test");
  await reach(page, page.locator("#f-message")); // company and phone sit between: Tab passes them
  await type(page, "We would like to automate our month-end invoice matching.");
  // Shift+Tab goes back up the form and Tab forward again, to prove the order both ways.
  await reach(page, page.locator("#f-email"), "Shift+Tab");
  await reach(page, page.locator("#f-message"));
  await reach(page, page.locator("[data-submit]"));
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/thanks\?ref=/, { timeout: 40_000 });
  await expect(page.locator("h1")).toBeVisible();
});

test("an invalid contact form shows the error summary and puts focus on it, with the keyboard", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/contact");
  await reach(page, page.locator("[data-submit]"));
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
  await reach(page, page.locator("#c-service-S1"));
  await page.keyboard.press("Space");
  await expect(page.locator("#c-service-S1")).toBeChecked();
  await reach(page, next(1));
  await page.keyboard.press("Enter");
  // Step 2: goals. Focus lands on the step's heading.
  await expect(page.locator('[data-qstep="2"] [data-step-title]')).toBeFocused();
  await reach(page, page.locator("#f-goals"));
  await type(page, "Match supplier invoices to purchase orders and post them to Tally without retyping.");
  await reach(page, next(2));
  await page.keyboard.press("Enter");
  // Step 3: budget and timeline.
  await expect(page.locator('[data-qstep="3"] [data-step-title]')).toBeFocused();
  await reach(page, page.locator("#c-budget-INR-not-sure"));
  await page.keyboard.press("Space");
  await reach(page, page.locator("#c-timeline-exploring"));
  await page.keyboard.press("Space");
  await reach(page, next(3));
  await page.keyboard.press("Enter");
  // Step 4: details, then submit.
  await expect(page.locator('[data-qstep="4"] [data-step-title]')).toBeFocused();
  await reach(page, page.locator("#q-name"));
  await type(page, "Test Person");
  await reach(page, page.locator("#q-email"));
  await type(page, "test.person@example.test");
  await reach(page, page.locator("#q-country"));
  await page.keyboard.type("India");
  await expect(page.locator("#q-country")).toHaveValue("IN");
  await reach(page, page.locator("[data-submit]"));
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/thanks\?ref=/, { timeout: 40_000 });
});
