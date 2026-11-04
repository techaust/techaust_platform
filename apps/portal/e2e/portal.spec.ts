// The M7.1 signed-in portal (POR-04, POR-07 to POR-11; run file I "E2E"), on the labelled sample API (`?sample=on`: sample data only, nothing saved or
// sent; preview/sample-m71.ts), so no sign-in or database is needed: home → a project → a download (one no longer shared) → the profile (save, a stale save)
// → a request (C21, C22, C24) → receipts → an invoice's "I've paid"; a contact without finance sees no money; every screen passes axe (WCAG 2.2 AA) at 390
// and 1280 px in the light and the dark theme, with no sideways scroll. The real-stack payment (finance `GATEWAY_TRANSPORT=stub` and
// scripts/pay-simulate.mjs) is not in this file: see the run file's designer report.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// 07-ZP is owner-approved (2026-11-05): the lines show unmarked
const P = "";

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("#sample-label")
    .analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("home shows the money, the projects and what is shared", async ({ page }) => {
  await page.goto("/?sample=on");
  await expect(page.getByRole("heading", { level: 1, name: "Kestrel Distributors (sample)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: `${P}Invoices to pay` })).toBeVisible();
  await expect(page.getByRole("heading", { name: `${P}Recent receipts` })).toBeVisible();
  await expect(page.getByRole("heading", { name: `${P}Your projects` })).toBeVisible();
  await expect(page.getByRole("heading", { name: `${P}Shared with you` })).toBeVisible();
  // a Pay link per invoice to pay, each named by its number
  await expect(page.getByRole("link", { name: "Pay now TH/INV/2627/0007" })).toBeVisible();
  // Receipts is in the navigation for a finance contact
  await expect(
    page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: `${P}Receipts` }),
  ).toBeVisible();
});

test("a contact without finance sees no money anywhere", async ({ page }) => {
  await page.goto("/?sample=nofinance");
  await expect(page.getByRole("heading", { name: `${P}Your projects` })).toBeVisible();
  await expect(page.getByRole("heading", { name: `${P}Invoices to pay` })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: `${P}Recent receipts` })).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Portal" });
  await expect(nav.getByRole("link", { name: "Invoices" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: `${P}Receipts` })).toHaveCount(0);
  await page.goto("/projects/prj-web?sample=nofinance");
  await expect(page.getByRole("heading", { level: 1, name: "Website rebuild (sample)" })).toBeVisible();
  await expect(page.getByText("₹50,000.00")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /View invoice/ })).toHaveCount(0);
  await page.goto("/receipts?sample=nofinance");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});

test("home's read failed: the page's title, the reason and a way to reload", async ({ page }) => {
  await page.goto("/?sample=fail");
  await expect(page.getByRole("heading", { level: 1, name: "Kestrel Distributors (sample)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("a project: milestones in order, notes, files, and a file no longer shared", async ({ page }) => {
  await page.goto("/?sample=on");
  await page.getByRole("link", { name: "Website rebuild (sample)" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Website rebuild (sample)" })).toBeVisible();
  const track = page.locator(".m71-track > li");
  await expect(track).toHaveCount(4);
  await expect(track.first()).toContainText("Discovery and site plan");
  await expect(page.getByRole("link", { name: `${P}View invoice TH/INV/2627/0002` })).toBeVisible();
  // the note's Markdown: its heading is a heading under the Notes h2 (h3), never an h1 or h2
  await expect(page.getByRole("heading", { level: 3, name: "Week 6 update" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: `${P}Download Sitemap v2 (sample).pdf` })
    .first()
    .click();
  expect((await download).suggestedFilename()).toBe("Sitemap v2 (sample).pdf");
  await page
    .getByRole("button", { name: `${P}Download Old brief (sample, no longer shared).pdf` })
    .first()
    .click();
  await expect(
    page.getByText(`${P}This file is no longer shared. Ask us if you still need it.`).first(),
  ).toBeVisible();
});

test("another client's project is the plain Page not found", async ({ page }) => {
  await page.goto("/projects/another-client?sample=on");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});

test("profile: save, a stale save, and a new request", async ({ page }) => {
  await page.goto("/profile?sample=on");
  const name = page.getByRole("textbox", { name: `${P}Name` });
  await expect(name).toHaveValue("Asha Iyer (sample)");
  // the email is shown, never a field
  await expect(page.getByRole("textbox", { name: `${P}Email` })).toHaveCount(0);
  await name.fill("Asha R. Iyer (sample)");
  await page.getByRole("button", { name: `${P}Save` }).click();
  await expect(page.getByRole("status").filter({ hasText: `${P}Saved.` })).toBeVisible();
  await name.fill("stale (sample)");
  await page.getByRole("button", { name: `${P}Save` }).click();
  await expect(
    page.getByText(`${P}Your details changed in another window. Reload to see them.`),
  ).toBeVisible();

  // a new request: the kind is required, the erasure line shows for an erasure, the details for a correction
  await page.getByRole("button", { name: `${P}New request` }).click();
  const dialog = page.getByRole("dialog", { name: `${P}New request` });
  await dialog.getByRole("radio", { name: `${P}Erase my personal data` }).check();
  await expect(
    dialog.getByText(
      `${P}Some records, such as invoices, must be kept by law even after an erasure request.`,
    ),
  ).toBeVisible();
  await dialog.getByRole("radio", { name: `${P}Correct my personal data` }).check();
  await dialog.getByRole("button", { name: `${P}Send` }).click();
  await expect(dialog.locator(".field-error")).toBeVisible();
  await dialog
    .getByRole("textbox", { name: `${P}Details` })
    .fill("My phone number on your records is old (sample).");
  await dialog.getByRole("button", { name: `${P}Send` }).click();
  await expect(page.getByText(`${P}Request sent. We'll reply by email within 30 days.`)).toBeVisible();
  await expect(page.locator(".m71-req").first()).toContainText(`${P}Correct my personal data`);

  // a second open request of a kind is refused by its code (C24)
  await page.getByRole("button", { name: `${P}New request` }).click();
  await dialog.getByRole("radio", { name: `${P}Add, remove or change a person's access` }).check();
  await dialog.getByRole("textbox", { name: `${P}Details` }).fill("Remove Zara (sample).");
  await dialog.getByRole("button", { name: `${P}Send` }).click();
  await expect(
    dialog.getByText(`${P}You already have an open request of this kind. We'll answer it first.`),
  ).toBeVisible();
});

test("receipts and credit notes, with the receipt that lists more invoices than it names", async ({
  page,
}) => {
  await page.goto("/receipts?sample=on");
  await expect(page.getByRole("heading", { level: 1, name: `${P}Receipts` })).toBeVisible();
  await expect(page.getByText(`${P}and 2 more`).first()).toBeVisible();
  // a credit note's invoice is a link to its page
  await expect(page.getByRole("link", { name: "TH/INV/2627/0002" }).first()).toBeVisible();
});

test("I've paid: the form's checks, a refusal by its code, then the thanks", async ({ page }) => {
  await page.goto("/invoices/inv-due?sample=on");
  await page.getByRole("button", { name: `${P}Bank transfer` }).click();
  await expect(page.getByRole("heading", { name: "How to pay" })).toBeFocused();
  await page.getByRole("button", { name: `${P}I've paid` }).click();
  const dialog = page.getByRole("dialog", { name: `${P}Tell us about your payment` });
  await expect(dialog.getByText(`${P}Never type card or bank account numbers here.`)).toBeVisible();
  // no card or bank-account field anywhere (ADM-PAY-12)
  await expect(
    dialog.locator("input[autocomplete^='cc-'], input[name*='card' i], input[name*='account' i]"),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: `${P}Send` }).click();
  await expect(dialog.locator(".field-error")).toHaveCount(3);
  await dialog.getByRole("textbox", { name: `${P}Amount paid` }).fill("99,99,999");
  await dialog.locator(".datefield__input").fill("03/11/2026");
  await dialog
    .getByRole("textbox", { name: `${P}Transaction reference (UTR or similar)` })
    .fill("UTR0000000001");
  await dialog.getByRole("button", { name: `${P}Send` }).click();
  await expect(dialog.getByText(`${P}That's more than the balance due (₹23,600.00).`)).toBeVisible();
  await dialog.getByRole("textbox", { name: `${P}Amount paid` }).fill("23,600");
  await dialog.getByRole("textbox", { name: `${P}Transaction reference (UTR or similar)` }).fill("DUP-1");
  await dialog.getByRole("button", { name: `${P}Send` }).click();
  await expect(dialog.getByText(`${P}We already have a notice with this reference.`)).toBeVisible();
  await dialog
    .getByRole("textbox", { name: `${P}Transaction reference (UTR or similar)` })
    .fill("UTR0000000001");
  await dialog.getByRole("button", { name: `${P}Send` }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(
      `${P}Thanks. We'll check our bank and confirm the payment. Until then the balance stays as it is.`,
    ),
  ).toBeVisible();
});

test("a withdrawn payment request offers no way to pay at all", async ({ page }) => {
  await page.goto("/invoices/pro-withdrawn?sample=on");
  await expect(page.getByRole("button", { name: `${P}Bank transfer` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `${P}I've paid` })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "How to pay" })).toHaveCount(0);
});

const SCREENS = [
  "/?sample=on",
  "/?sample=empty",
  "/?sample=nofinance",
  "/projects?sample=on",
  "/projects?sample=empty",
  "/projects/prj-web?sample=on",
  "/projects/prj-care?sample=on",
  "/receipts?sample=on",
  "/receipts?sample=empty",
  "/profile?sample=on",
  "/invoices/inv-due?sample=on",
];
for (const scheme of ["light", "dark"] as const)
  for (const width of [390, 1280] as const)
    test(`every M7.1 screen passes axe at ${width} px in the ${scheme} theme, with no sideways scroll`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      for (const path of SCREENS) {
        await page.goto(path);
        await expect(page.locator("main h1")).toBeVisible();
        await page.waitForLoadState("networkidle");
        expect(await axe(page), path).toEqual([]);
        expect(await noSideways(page), path).toBe(true);
      }
      // the two dialogs, open
      await page.goto("/profile?sample=on");
      await page.getByRole("button", { name: `${P}New request` }).click();
      expect(await axe(page), "new request").toEqual([]);
      await page.goto("/invoices/inv-due?sample=on");
      await page.getByRole("button", { name: `${P}I've paid` }).click();
      expect(await axe(page), "I've paid").toEqual([]);
    });
