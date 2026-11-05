// M7.2's admin screens (ADM-G-09, ADM-MAIL-01, ADM-MAIL-02; run file G1 to G4): the email log and one email with its delivery updates and "Emails stopped",
// the Owner's "Allow emails again", Your account › Notifications (a switch saved and read back), and a contact's "Emails stopped" badge; axe (WCAG 2.2 AA) and
// no sideways scroll at 390, 768 and 1280 px in both themes, the in-app theme set against the OS theme. The email rows, their SES events and the suppressions
// are written straight to the LOCAL tables, as the jobs Worker's SES hook writes them (sample addresses on example.test only).
//   E2E_SAMPLE=1 pnpm --filter @techaust/admin exec playwright test e2e/m72-notifications.spec.ts   (through tools/heavy.sh; M72_SHOTS=<folder> saves screenshots)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { ORIGIN } from "../playwright.config.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

function d1(sql: string) {
  const jobs = here("../../jobs/");
  const wrangler = join(jobs, "node_modules", "wrangler", "bin", "wrangler.js");
  const dir = mkdtempSync(join(tmpdir(), "admin-e2e-m72-"));
  try {
    const file = join(dir, "q.sql");
    writeFileSync(file, sql);
    execFileSync(
      process.execPath,
      [wrangler, "d1", "execute", "DB", "--local", "--persist-to", "../../.wrangler/state", "--file", file],
      { cwd: jobs, stdio: ["ignore", "ignore", "inherit"] },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const run = Date.now().toString(36);
const BOUNCED = `ml-e2e-${run}-b`;
const DELIVERED = `ml-e2e-${run}-d`;
const QUEUED = `ml-e2e-${run}-q`;
const BOUNCE_TO = `bounce-${run}@example.test`;
const SHOTS = process.env.M72_SHOTS ?? "";
const headers = { Origin: ORIGIN };

test.beforeAll(() => {
  const now = Date.now();
  d1(
    `INSERT INTO email_log (id, to_email, template, entity_type, entity_id, ses_message_id, status, created_at, updated_at, last_event_at, bounce_type) VALUES
       ('${BOUNCED}', '${BOUNCE_TO}', 'invoice.sent', 'document_send', 'e2e-${run}-1', 'msg-${run}-b', 'bounced', ${now - 3_600_000}, ${now - 60_000}, ${now - 60_000}, 'permanent'),
       ('${DELIVERED}', 'delivered-${run}@example.test', 'receipt.sent', 'document_send', 'e2e-${run}-2', 'msg-${run}-d', 'delivered', ${now - 7_200_000}, ${now - 120_000}, ${now - 120_000}, NULL),
       ('${QUEUED}', 'a.long.sample.address.${run}.for.layout@subdomain.example.test', 'digest.weekly', 'digest', 'e2e-${run}:2026-11-02', NULL, 'queued', ${now - 30_000}, ${now - 30_000}, NULL, NULL);
     INSERT INTO email_events (id, ses_message_id, type, bounce_type, bounce_sub_type, email_log_id, outcome, received_at) VALUES
       ('ev-${run}-1', 'msg-${run}-b', 'delivery', NULL, NULL, '${BOUNCED}', 'applied', ${now - 3_000_000}),
       ('ev-${run}-2', 'msg-${run}-b', 'bounce', 'permanent', 'General', '${BOUNCED}', 'applied', ${now - 60_000}),
       ('ev-${run}-3', 'msg-${run}-d', 'delivery', NULL, NULL, '${DELIVERED}', 'applied', ${now - 120_000});
     INSERT OR IGNORE INTO email_suppressions (email, reason, at) VALUES ('${BOUNCE_TO}', 'hard_bounce', ${now - 60_000});`,
  );
});

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/** The page never scrolls sideways, and no table region scrolls either. */
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".dtable")].every((d) => d.scrollWidth <= d.clientWidth + 1),
    ),
  ).toBe(true);
}

test("the email log lists the emails with their S12 status, and a recipient filter finds one address", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/emails");
  await expect(page.getByRole("heading", { name: "Emails", level: 1 })).toBeVisible();
  const row = page.locator("tr", { hasText: BOUNCE_TO });
  await expect(row).toContainText("Bounced");
  await expect(row).toContainText("Last update");
  // a malformed address is refused under the field, nothing is asked of the server
  await page.getByRole("textbox", { name: "Recipient" }).fill("not-an-address");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText("Enter a full email address, for example name@example.com.")).toBeVisible();
  await page.getByRole("textbox", { name: "Recipient" }).fill(BOUNCE_TO.toUpperCase());
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page).toHaveURL(new RegExp(`to=${encodeURIComponent(BOUNCE_TO)}`));
  await expect(page.locator("tbody tr")).toHaveCount(1);
  // an address nobody was emailed: the full-width empty state with a way out
  await page.goto(`/emails?to=${encodeURIComponent(`nobody-${run}@example.test`)}`);
  await expect(page.getByRole("heading", { name: "No emails match these filters" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).last().click();
  await expect(page.locator("tr", { hasText: BOUNCE_TO })).toBeVisible();
});

test("one email: its delivery updates, Emails stopped, and the Owner's Allow emails again", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/emails/${BOUNCED}`);
  await expect(page.getByRole("heading", { name: "Invoice sent", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Emails stopped" })).toBeVisible();
  const updates = page
    .getByRole("list")
    .filter({ hasText: "Permanent: the address doesn't exist or refuses mail" });
  await expect(updates.getByRole("listitem")).toHaveCount(2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-email-bounced-1280.png`, fullPage: true });
  await page.getByRole("button", { name: /Allow emails again/ }).click();
  const dialog = page.getByRole("dialog", { name: "Allow emails to this address again?" });
  await expect(dialog).toContainText("Amazon SES keeps its own list");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-allow-dialog-1280.png` });
  await dialog.getByRole("button", { name: "Allow emails again" }).click();
  await expect(page.getByText(`Emails to ${BOUNCE_TO} are allowed again.`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Emails stopped" })).toHaveCount(0);
  // the server agrees, and a second allow is worded from its code
  const again = await page.request.post(`/api/v1/emails/${BOUNCED}/unsuppress`, { headers, data: {} });
  expect(again.status()).toBe(409);
  expect(((await again.json()) as { error?: { code?: string } }).error?.code).toBe("not_suppressed");
  // an email still waiting to go has no updates yet
  await page.goto(`/emails/${QUEUED}`);
  await expect(page.getByText("No delivery updates yet.")).toBeVisible();
});

test("Your account › Notifications: a switch saved with the save bar is read back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/account");
  await page.getByRole("link", { name: "Notifications" }).last().click();
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  const sw = page.getByRole("switch", { name: /Proposal and estimate opened/ });
  const was = (await sw.getAttribute("aria-checked")) === "true";
  await sw.click();
  await expect(page.getByRole("region", { name: "Unsaved changes" })).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Notification settings saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: /Proposal and estimate opened/ })).toHaveAttribute(
    "aria-checked",
    String(!was),
  );
  // the Owner has the digest switch; put the first one back
  await expect(page.getByRole("switch", { name: "Send me the weekly digest" })).toBeVisible();
  await page.getByRole("switch", { name: /Proposal and estimate opened/ }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Notification settings saved.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const)
  for (const width of [390, 768, 1280] as const)
    test(`the M7.2 screens pass axe at ${width} px, in-app ${theme} against the OS's other theme, with no sideways scroll`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
      await page.addInitScript((t) => localStorage.setItem("ta-admin-theme", t), theme);
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path, ready] of [
        ["emails", "/emails", page.getByText(BOUNCE_TO).filter({ visible: true }).first()],
        ["email", `/emails/${DELIVERED}`, page.getByRole("heading", { name: "Delivery updates" })],
        ["email-queued", `/emails/${QUEUED}`, page.getByRole("heading", { name: "Delivery updates" })],
        ["notifications", "/account/notifications", page.getByRole("heading", { name: "Alert emails" })],
      ] as const) {
        await page.goto(path);
        await expect(ready).toBeVisible();
        await page.waitForLoadState("networkidle");
        expect(await axe(page), name).toEqual([]);
        await noSideways(page);
        expect(await page.locator("html").getAttribute("data-theme")).toBe(theme);
        if (SHOTS)
          await page.screenshot({ path: `${SHOTS}/e2e-${name}-${width}-${theme}.png`, fullPage: true });
      }
    });

test("a keyboard user reaches every filter and the first email in order, with a visible focus ring", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/emails");
  await expect(page.getByText(BOUNCE_TO).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Status" }).focus();
  const order: string[] = [];
  for (let i = 0; i < 7; i++) {
    order.push(
      await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        const ring = a
          ? getComputedStyle(a).outlineStyle !== "none" || getComputedStyle(a).boxShadow !== "none"
          : false;
        return `${a?.id || a?.textContent?.trim().slice(0, 12) || a?.tagName}:${ring}`;
      }),
    );
    await page.keyboard.press("Tab");
  }
  expect(order.slice(0, 2)).toEqual(["ml-status:true", "ml-template:true"]);
  expect(order).toContain("ml-to:true");
  expect(order.some((o) => o.startsWith("Find"))).toBe(true);
});
