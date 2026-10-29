// The accept form (FX-3; audit A4 1, 2, 7, 8, 9; POR-05), on the labelled sample API (`?sample=on`; nothing is saved or sent):
//   - A4 1: after the form was checked, correcting the name clears its error as it is typed, so the first press of Accept is not lost to a
//     line vanishing under the pointer (the old error went on blur and the button moved);
//   - A4 8: the whole agreement row is the checkbox's label, at least 44 px tall;
//   - A4 2: at 375 px the document number in the confirmation stays on one line;
//   - A4 7: once a version is decided, the Acceptance section's own "Accept this offer…" text is gone;
//   - A4 9: a newer version still being prepared ends the decision with its own line.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const ACCEPT_TEXT = "Accept this offer in the client portal.";

async function open(page: Page, id: string) {
  await page.goto(`/proposals/${id}?sample=on`);
  await expect(page.locator("#acceptance")).toBeVisible();
  await page.locator("#acceptance").scrollIntoViewIfNeeded();
}

const form = (page: Page) => page.locator(".decide__form");
const acceptButton = (page: Page) => form(page).getByRole("button", { name: "Accept", exact: true });
const nameField = (page: Page) => form(page).getByRole("textbox", { name: "Full name" });

test("A4 1: the first press of Accept after correcting the name opens the confirmation", async ({ page }) => {
  await open(page, "sample-sent");
  await acceptButton(page).click();
  await expect(page.locator(".error-summary")).toBeVisible();
  // Tick first, then type the name and press Accept straight away (no blur in between): one press is enough.
  await form(page).getByText("I have read and agree to the terms").click();
  await nameField(page).fill("Asha Iyer");
  await expect(form(page).locator(".field-error")).toHaveCount(0);
  await acceptButton(page).click();
  await expect(page.getByRole("dialog", { name: /Accept this proposal\?/ })).toBeVisible();
});

test("A4 1: the name's error follows the field as it is typed, never on blur", async ({ page }) => {
  await open(page, "sample-sent");
  await acceptButton(page).click();
  const error = form(page).locator(".field").getByText("Type your full name.");
  await expect(error).toBeVisible();
  await nameField(page).fill("A");
  await expect(error).toBeVisible();
  await nameField(page).fill("As");
  await expect(error).toHaveCount(0);
  // Leaving the field changes nothing.
  await page.keyboard.press("Tab");
  await expect(error).toHaveCount(0);
});

test("A4 8: the whole agreement row is the label, a 44 px target", async ({ page }) => {
  await open(page, "sample-sent");
  const row = form(page).locator("label.check");
  const h = (await row.boundingBox())?.height ?? 0;
  expect(h).toBeGreaterThanOrEqual(44);
  const box = form(page).getByRole("checkbox", { name: "I have read and agree to the terms" });
  await expect(box).not.toBeChecked();
  // A press on the row's far end, away from the box and the words' start, still ticks it.
  const b = await row.boundingBox();
  if (!b) throw new Error("no row");
  await page.mouse.click(b.x + b.width - 4, b.y + b.height / 2);
  await expect(box).toBeChecked();
});

test("A4 2: at 375 px the document number in the confirmation stays on one line", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await open(page, "sample-names");
  await form(page).getByText("I have read and agree to the terms").click();
  await nameField(page).fill("Asha Iyer");
  await acceptButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const number = dialog.locator(".facts--confirm .nowrap").first();
  const lines = await number.evaluate((el) => el.getClientRects().length);
  expect(lines).toBe(1);
  // The dialog's buttons stay in view.
  await expect(dialog.getByRole("button", { name: "Accept", exact: true })).toBeInViewport();
  const fits = await number.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const d = (el.closest("dialog") as HTMLElement).getBoundingClientRect();
    return r.right <= d.right && r.left >= d.left;
  });
  expect(fits).toBe(true);
});

test("A4 7: a decided version no longer says how to accept it", async ({ page }) => {
  await open(page, "sample-sent");
  await expect(page.locator("#acceptance").getByText(ACCEPT_TEXT)).toBeVisible();
  for (const id of ["sample-accepted", "sample-declined", "sample-expired"]) {
    await open(page, id);
    await expect(page.locator("#acceptance").getByText(ACCEPT_TEXT), id).toHaveCount(0);
  }
});

test("A4 9: a newer version being prepared ends the decision with its own line", async ({ page }) => {
  await open(page, "sample-pending");
  await form(page).getByText("I have read and agree to the terms").click();
  await nameField(page).fill("Asha Iyer");
  await acceptButton(page).click();
  await page.getByRole("dialog").getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.locator(".decide__problem")).toContainText(
    "This version can no longer be accepted: a newer one is being prepared.",
  );
  await expect(form(page)).toHaveCount(0);
});

for (const width of [375, 768, 1024] as const)
  test(`the accept form and its confirmation pass axe at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "sample-sent");
    await acceptButton(page).click();
    const scan = async () =>
      (
        await new AxeBuilder({ page })
          .include("#acceptance")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations.filter((v) => v.impact !== "minor");
    expect(await scan()).toEqual([]);
  });
