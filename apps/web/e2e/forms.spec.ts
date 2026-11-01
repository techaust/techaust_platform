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

/**
 * Waits for what a submit needs before Enter is pressed (test-hardening 1a; the 40 s timeout on main, 2026-10-31): the page script has taken the
 * form over (it sets `novalidate` first, in the same run that adds its submit handler: the HTML has none, and the contact form has no other
 * marker), and the Turnstile widget has its token (Turnstile writes it into the hidden `cf-turnstile-response` input in the
 * widget's box). The script waits at most 20 s for a token and then shows the generic error without posting, so an Enter pressed while the widget
 * was still loading from challenges.cloudflare.com could end on /contact, never /thanks. Waiting only, no input: the keyboard rule holds.
 */
async function readyToSubmit(page: Page, kind: "contact" | "quote") {
  const form = page.locator(`form[data-form="${kind}"]`);
  await expect(form).toHaveAttribute("novalidate", "");
  await expect(
    form.locator('[data-turnstile] input[name="cf-turnstile-response"]'),
    "Turnstile gave no token (is https://challenges.cloudflare.com reachable from the browser?)",
  ).toHaveValue(/\S/, { timeout: 30_000 });
}

/**
 * Presses Enter on the focused submit button and waits for the form's POST, so a refusal names its status (429: the address limit; 400/403:
 * Turnstile or the schema) instead of a bare URL timeout; then waits for /thanks.
 */
async function submitAndLand(page: Page, kind: "contact" | "quote") {
  const posted = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/forms/${kind}`,
    { timeout: 40_000 },
  );
  await page.keyboard.press("Enter");
  const res = await posted;
  // the body is read only on a refusal: after a 200 the page navigates at once and the body may be gone
  if (res.status() !== 200)
    expect(res.status(), `POST /api/forms/${kind}: ${await res.text().catch(() => "")}`).toBe(200);
  await page.waitForURL(/\/thanks\?ref=/, { timeout: 20_000 });
}

test("the contact form is reachable and submittable by keyboard", async ({ page }) => {
  // the waits below (a Turnstile token, the POST, then /thanks) can add up past the file's 60 s on a slow first load
  test.setTimeout(90_000);
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
  await readyToSubmit(page, "contact");
  await submitAndLand(page, "contact");
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
  test.setTimeout(90_000); // as the contact form's test
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
  await readyToSubmit(page, "quote");
  await submitAndLand(page, "quote");
});
