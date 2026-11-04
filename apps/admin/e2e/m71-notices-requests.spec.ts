// M7.1's admin screens (ADM-PAY-05, POR-09, POR-11; run file G.7, I "E2E"): the Payments "Notices" tab, "Record payment" filled in from a notice, the
// dismiss, the client page's Requests panel with its Close dialog and the Clients count in the navigation; axe (WCAG 2.2 AA) at 390 and 1280 px in both
// themes, the in-app theme set against the OS theme included. Needs the realistic sample data (`E2E_SAMPLE=1`, e2e/sample-data.ts) for an issued invoice
// with a contact: the notices and requests are written straight to the LOCAL table here, as a client's portal would make them (sample words only).
//   E2E_SAMPLE=1 pnpm --filter @techaust/admin exec playwright test e2e/m71-notices-requests.spec.ts   (through tools/heavy.sh)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

function d1(sql: string) {
  const jobs = here("../../jobs/");
  const wrangler = join(jobs, "node_modules", "wrangler", "bin", "wrangler.js");
  const dir = mkdtempSync(join(tmpdir(), "admin-e2e-m71-"));
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

const today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
const run = Date.now().toString(36).toUpperCase();

test.beforeAll(() => {
  const now = Date.now();
  // Two open notices on the sample's first issued, unpaid INR tax invoice that has a contact (one from the portal with a note, one from an emailed link),
  // and three requests from that contact: a contact change and a grievance (Staff may close) and an erasure (the Owner's), plus one already closed.
  const notice = (id: string, via: string, ref: string, note: string | null, at: number) => `
    INSERT INTO payment_notices (id, client_id, document_id, contact_id, via, amount_minor, currency, paid_on, reference, reference_norm, note, status, created_at)
    SELECT '${id}', d.client_id, d.id, c.id, '${via}', min(d.balance_minor, 1000000), d.currency, '${today}', '${ref}', '${ref}', ${note ? `'${note}'` : "NULL"}, 'open', ${at}
      FROM documents d JOIN contacts c ON c.client_id = d.client_id AND c.anonymised_at IS NULL
     WHERE d.type = 'tax_invoice' AND d.frozen_at IS NOT NULL AND d.voided_at IS NULL AND d.balance_minor > 0 AND d.currency = 'INR'
     ORDER BY d.issue_date, d.id LIMIT 1;`;
  const request = (id: string, kind: string, details: string | null, at: number) => `
    INSERT INTO client_requests (id, client_id, contact_id, contact_ref, kind, details, status, created_at, updated_at)
    SELECT '${id}', c.client_id, c.id, c.id, '${kind}', ${details ? `'${details}'` : "NULL"}, 'open', ${at}, ${at}
      FROM contacts c JOIN documents d ON d.client_id = c.client_id
     WHERE d.type = 'tax_invoice' AND d.frozen_at IS NOT NULL AND c.anonymised_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM client_requests r WHERE r.contact_id = c.id AND r.kind = '${kind}' AND r.status = 'open')
     ORDER BY d.issue_date, d.id LIMIT 1;`;
  d1(
    [
      notice(
        `ntc-${run}-1`,
        "portal",
        `UTR${run}1`,
        "Paid from our current account (sample).",
        now - 3_600_000,
      ),
      notice(`ntc-${run}-2`, "link", `UTR${run}2`, null, now - 60_000),
      request(
        `req-${run}-1`,
        "contact_change",
        "Please add our accountant Meera Das (sample) to the portal.",
        now - 7_200_000,
      ),
      request(`req-${run}-2`, "data_erasure", null, now - 3_600_000),
      request(
        `req-${run}-3`,
        "grievance",
        "We got an email meant for another company (sample).",
        now - 60_000,
      ),
    ].join("\n"),
  );
});

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const SHOTS = process.env.M71_SHOTS ?? "";

test("the Notices tab: the open notices, Record payment filled in from one, and the dismiss", async ({
  page,
}) => {
  await page.goto("/payments?tab=notices");
  await expect(page.getByRole("tab", { name: /Notices/ })).toHaveAttribute("aria-selected", "true");
  const row = page.locator("tr", { hasText: `UTR${run}1` });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Paid from our current account (sample).");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-notices-1280.png`, fullPage: true });
  await row.getByRole("button", { name: /Record payment/ }).click();
  const dialog = page.getByRole("dialog", { name: "Record a payment" });
  await expect(dialog.getByText(/Filled in from .*'s notice of/)).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Bank reference (UTR)" })).toHaveValue(`UTR${run}1`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-record-from-notice-1280.png` });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const second = page.locator("tr", { hasText: `UTR${run}2` });
  await second.getByRole("button", { name: /Dismiss/ }).click();
  const confirm = page.getByRole("dialog", { name: "Dismiss this notice?" });
  await expect(confirm.getByText("Don't include personal data.")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-dismiss-1280.png` });
  await confirm.getByRole("button", { name: "Dismiss notice" }).click();
  await expect(page.getByText("Notice dismissed.")).toBeVisible();
  await expect(page.locator("tr", { hasText: `UTR${run}2` })).toHaveCount(0);
  await page.getByRole("tab", { name: "Dismissed" }).click();
  await expect(page.locator("tr", { hasText: `UTR${run}2` })).toBeVisible();
});

test("the client's Requests panel: close one, and the Clients count", async ({ page }) => {
  await page.goto("/payments?tab=notices");
  const link = page
    .locator("tr", { hasText: `UTR${run}1` })
    .getByRole("link")
    .first();
  const href = (await link.getAttribute("href")) ?? "";
  await page.goto(`${href}?tab=requests`);
  await expect(page.getByRole("heading", { name: "Requests", level: 2 })).toBeVisible();
  // the open count on Clients in the navigation, its words read out
  await expect(
    page
      .getByRole("navigation")
      .getByText(/open client request/)
      .first(),
  ).toBeAttached();
  const row = page.locator("tr", { hasText: "We got an email meant for another company (sample)." });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-requests-1280.png`, fullPage: true });
  await row.getByRole("button", { name: /Close/ }).click();
  const dialog = page.getByRole("dialog", { name: "Close this request?" });
  await dialog.getByRole("button", { name: "Close request" }).click();
  await expect(dialog.getByText("Choose Done or Declined.")).toBeVisible();
  await dialog.getByRole("radio", { name: "Done: we did what was asked" }).check();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-close-request-1280.png` });
  await dialog.getByRole("button", { name: "Close request" }).click();
  await expect(page.getByText("Request closed.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const)
  for (const width of [390, 1280] as const)
    test(`the Notices tab and the Requests panel pass axe at ${width} px, in-app ${theme} against the OS's other theme`, async ({
      page,
    }) => {
      // the in-app theme set against the OS theme (the logo and every colour follow `data-theme`, never only the media query)
      await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
      await page.addInitScript((t) => localStorage.setItem("ta-admin-theme", t), theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/payments?tab=notices");
      // a table from md up, a card per row on phones: the reference, whichever is shown
      await expect(page.getByText(`UTR${run}1`).filter({ visible: true }).first()).toBeVisible();
      expect(await axe(page), "notices").toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
        true,
      );
      if (SHOTS)
        await page.screenshot({ path: `${SHOTS}/admin-notices-${width}-${theme}.png`, fullPage: true });
      const href =
        (await page.locator('a[href^="/clients/"]').filter({ visible: true }).first().getAttribute("href")) ??
        "";
      await page.goto(`${href}?tab=requests`);
      await expect(page.getByRole("heading", { name: "Requests", level: 2 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await axe(page), "requests").toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
        true,
      );
      if (SHOTS)
        await page.screenshot({ path: `${SHOTS}/admin-requests-${width}-${theme}.png`, fullPage: true });
    });
