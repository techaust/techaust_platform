// Keyboard paths of the shell and the page parts (WCAG 2.1.1, 2.4.1, 2.4.3, 2.4.7): the skip link, the menus (Escape and
// focus return), the FAQ disclosure, the currency switch.
import { expect, test } from "@playwright/test";

test.describe("skip link", () => {
  test("is the first Tab stop, visible when focused, and moves focus to the main landmark", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.locator("a.skip-link");
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator("main#main")).toBeFocused();
  });
});

test.describe("desktop menus", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Services opens with Enter, closes with Escape and keeps focus on its button", async ({ page }) => {
    await page.goto("/");
    const button = page.locator("button.nav-trigger", { hasText: "Services" });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#hd-services")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator("#hd-services").locator("a").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
  });

  test("opening Industries closes Services", async ({ page }) => {
    await page.goto("/");
    const services = page.locator("button.nav-trigger", { hasText: "Services" });
    const industries = page.locator("button.nav-trigger", { hasText: "Industries" });
    await services.focus();
    await page.keyboard.press("Enter");
    await industries.focus();
    await page.keyboard.press("Enter");
    await expect(industries).toHaveAttribute("aria-expanded", "true");
    await expect(services).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("phone menu", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("opens as a dialog with focus inside, Escape closes it and focus returns to the Menu button", async ({
    page,
  }) => {
    await page.goto("/");
    const trigger = page.locator("button.menu-trigger", { hasText: "Menu" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator("dialog.mobile-dialog");
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);
    // Focus never reaches the page behind while Tab is pressed through the dialog (a modal dialog makes the page inert;
    // at its end Tab leaves for the browser's own controls, which shows as the body being active).
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const behind = await page.evaluate(() => {
        const el = document.activeElement;
        return el !== null && el !== document.body && el.closest("dialog") === null;
      });
      expect(behind, `Tab press ${i + 1} reached the page behind the menu`).toBe(false);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("FAQ disclosure", () => {
  test("opens and closes with Enter and Space", async ({ page }) => {
    await page.goto("/services/app-rescue");
    const summary = page.locator("summary.faq__q").first();
    const item = page.locator("details.faq__item").first();
    await summary.focus();
    await expect(item).not.toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(item).toHaveAttribute("open", "");
    await page.keyboard.press("Space");
    await expect(item).not.toHaveAttribute("open", "");
    await page.keyboard.press("Space");
    await expect(item).toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(item).not.toHaveAttribute("open", "");
  });

  test("focus moves question to question with Tab, in reading order", async ({ page }) => {
    await page.goto("/services/app-rescue");
    const first = page.locator("summary.faq__q").first();
    await first.focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("summary.faq__q").nth(1)).toBeFocused();
  });
});

test.describe("currency switch", () => {
  test("the footer radios change the currency with the arrow keys and remember the choice", async ({
    page,
  }) => {
    // The footer's radios are named currency-ft-cur; INR first.
    await page.route("**/api/geo", (r) => r.fulfill({ json: { currency: "INR" } }));
    await page.goto("/pricing");
    await expect(page.locator("html")).toHaveAttribute("data-currency", "inr");
    const inr = page.locator('input[name="currency-ft-cur"][value="inr"]');
    const usd = page.locator('input[name="currency-ft-cur"][value="usd"]');
    await inr.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("html")).toHaveAttribute("data-currency", "usd");
    await expect(usd).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem("ta_currency"))).toBe("usd");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-currency", "usd");
    await usd.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("html")).toHaveAttribute("data-currency", "inr");
    await expect(inr).toBeChecked();
  });

  test("the switch beside the prices works from the keyboard", async ({ page }) => {
    await page.route("**/api/geo", (r) => r.fulfill({ json: { currency: "INR" } }));
    await page.goto("/pricing");
    const note = page.locator("[data-currency-switch]").first();
    await note.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-currency", "usd");
  });
});
