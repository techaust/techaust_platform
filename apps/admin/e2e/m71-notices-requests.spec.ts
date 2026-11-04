// M7.1's admin screens (ADM-PAY-05, POR-09, POR-11; run file G.7, I "E2E"): the Payments "Notices" tab, "Record payment" filled in from a notice, the
// dismiss, the client page's Requests panel with its Close dialog and the Clients count in the navigation; axe (WCAG 2.2 AA) at 390 and 1280 px in both
// themes, the in-app theme set against the OS theme included. Needs the realistic sample data (`E2E_SAMPLE=1`, e2e/sample-data.ts) for an issued invoice
// with a contact: the notices and requests are written straight to the LOCAL table here, as a client's portal would make them (sample words only).
//   E2E_SAMPLE=1 pnpm --filter @techaust/admin exec playwright test e2e/m71-notices-requests.spec.ts   (through tools/heavy.sh)
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { ORIGIN } from "../playwright.config.ts";
import { totpAt } from "./sample-data.ts";

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
/** A notice id as the portal makes them (uuidv7: `POST /payments` takes `noticeId` only in that form; review 1's tests record from one). */
function uuid7(): string {
  const t = Date.now().toString(16).padStart(12, "0");
  const r = randomUUID().replaceAll("-", "");
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${r.slice(13, 16)}-${(8 | (Number.parseInt(r[16] ?? "0", 16) & 3)).toString(16)}${r.slice(17, 20)}-${r.slice(20, 32)}`;
}
const NOTICE_1 = uuid7();
const NOTICE_2 = uuid7();

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
      notice(NOTICE_1, "portal", `UTR${run}1`, "Paid from our current account (sample).", now - 3_600_000),
      notice(NOTICE_2, "link", `UTR${run}2`, null, now - 60_000),
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

// ---- Review 1 (M2, M3, M5, L2): Record payment from a notice, a recorded notice whose payment was withdrawn, a proforma's notice ----
// These run after the tests above (they record the first notice, which the Requests test reads from the Open tab).

/** The API's CSRF check compares the Origin of every write with the admin's own (as the browser sends it). */
const headers = { Origin: ORIGIN };
// biome-ignore lint/suspicious/noExplicitAny: API answers are read loosely here, as in the sample data
type J = Record<string, any>;
const secret = () => Buffer.from(readFileSync(here("../.e2e/owner-totp.hex"), "utf8"), "hex");

/** A step-up for this session, unless one is still good for two minutes; a refused code waits for the next 30-second step (signature-udyam.spec.ts). */
async function stepUp(page: Page) {
  const me = await page.request.get("/api/v1/auth/me");
  const until = ((await me.json()) as J).stepUpUntil as number | null;
  if (until !== null && until - Date.now() > 120_000) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await page.request.post("/api/v1/auth/step-up", {
      headers,
      data: { code: totpAt(secret(), Math.floor(Date.now() / 30_000)) },
    });
    if (res.ok()) return;
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  }
  throw new Error("e2e: no step-up after three steps");
}

async function api(page: Page, method: "GET" | "POST", path: string, data?: unknown) {
  const res = await page.request.fetch(`/api/v1${path}`, {
    method,
    headers,
    ...(data === undefined ? {} : { data }),
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as J };
}

/** The page never scrolls sideways. */
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("review 1, M2: Record payment from a notice starts its invoice row from the notice, and words a refusal from its code", async ({
  page,
}) => {
  await stepUp(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/payments?tab=notices");
  const row = page.locator("tr", { hasText: `UTR${run}1` });
  await row.getByRole("button", { name: /Record payment/ }).click();
  const dialog = page.getByRole("dialog", { name: "Record a payment" });
  const amount = dialog.getByRole("textbox", { name: "Amount the client paid" });
  const onInvoice = dialog.getByRole("textbox", { name: /^Amount on this invoice/ });
  // the notice's amount is at most the balance (beforeAll), so the row starts at the whole amount, never 0.00
  await expect(onInvoice).toHaveValue(await amount.inputValue());
  expect(Number((await onInvoice.inputValue()).replaceAll(",", ""))).toBeGreaterThan(0);
  // kept in step with the amount until a person types in the row
  await amount.fill("1500");
  await expect(onInvoice).toHaveValue("1500.00");
  // the row emptied: the server's 409 `notice_mismatch` is worded by its code under the row (S8) and wraps inside the dialog
  await onInvoice.fill("");
  await dialog.getByRole("combobox", { name: "How it was paid" }).selectOption({ label: "NEFT" });
  await dialog.getByRole("button", { name: "Record a payment" }).click();
  await expect(
    dialog.getByText("The notice is about this invoice: put the payment, or part of it, on this invoice."),
  ).toBeVisible();
  await expect(dialog.getByText("That notice is about a document this payment is not put on")).toHaveCount(0);
  for (const width of [1280, 768, 390] as const) {
    await page.setViewportSize({ width, height: 900 });
    expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth + 1), `dialog at ${width}`).toBe(true);
    await noSideways(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-record-mismatch-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  // put back on the invoice: recorded and confirmed (the Owner), and the notice moves to Recorded
  await onInvoice.fill("1500");
  await dialog.getByRole("button", { name: "Record a payment" }).click();
  await expect(page.getByText(/The notice is marked as recorded\./)).toBeVisible();
});

test("review 1, M5: a recorded notice whose payment was withdrawn says so, and the withdraw dialog names the notice", async ({
  page,
}) => {
  await stepUp(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/payments?tab=notices");
  await page.getByRole("tab", { name: "Recorded" }).click();
  const link = page.locator("tr", { hasText: `UTR${run}1` }).getByRole("link", { name: /^Payment: / });
  await expect(link).toHaveText("Payment: Confirmed");
  await page.goto((await link.getAttribute("href")) ?? "");
  await page.getByRole("dialog").getByRole("button", { name: "Withdraw" }).click();
  const dialog = page.getByRole("dialog", { name: "Withdraw this payment" });
  await expect(
    dialog.getByText(/^This entry was recorded from the client's notice of .* \(Portal\)\./),
  ).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-withdraw-from-notice-1280.png` });
  await dialog.getByRole("textbox", { name: "Why it is withdrawn" }).fill("Entered in error (sample).");
  await dialog.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("Payment withdrawn.")).toBeVisible();
  for (const theme of ["light", "dark"] as const)
    for (const width of [1280, 768, 390] as const) {
      await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/payments?tab=notices");
      await page.evaluate((t) => localStorage.setItem("ta-admin-theme", t), theme);
      await page.reload();
      await page.getByRole("tab", { name: "Recorded" }).click();
      await expect(
        page.getByRole("link", { name: "Payment withdrawn later" }).filter({ visible: true }).first(),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await axe(page), `recorded ${width} ${theme}`).toEqual([]);
      await noSideways(page);
      if (SHOTS)
        await page.screenshot({ path: `${SHOTS}/admin-recorded-${width}-${theme}.png`, fullPage: true });
    }
});

test("review 1, M3 and L2: a proforma's notice keeps both actions in view, and its advance dialog says the amount is the client's", async ({
  page,
}) => {
  await stepUp(page);
  // a proforma for the notices' client, made and issued through the API as the screens do
  const listed = await api(page, "GET", "/payments/notices?status=recorded");
  const clientId = ((listed.body.items as J[]).find((n) => n.reference === `UTR${run}1`)?.client?.id ??
    "") as string;
  expect(clientId).not.toBe("");
  const cat = await api(page, "GET", "/catalogue");
  const services = (cat.body.items as J[])
    .filter((i) => i.active !== false && i.priceInrMinor)
    .slice(0, 1)
    .map((i) => ({ catalogueItemId: i.id }));
  const draft = await api(page, "POST", "/invoices", { clientId, services, kind: "proforma" });
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const d = (await api(page, "GET", `/invoices/${draft.body.id}`)).body;
  const issued = await api(page, "POST", `/invoices/${draft.body.id}/issue`, {
    expectedUpdatedAt: d.updatedAt,
    expectedContentSha256: d.contentSha256,
  });
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  d1(`
    INSERT INTO payment_notices (id, client_id, document_id, contact_id, via, amount_minor, currency, paid_on, reference, reference_norm, note, status, created_at)
    SELECT '${uuid7()}', d.client_id, d.id, c.id, 'portal', min(d.balance_minor, 500000), d.currency, '${today}', 'PF${run}', 'PF${run}', NULL, 'open', ${Date.now()}
      FROM documents d JOIN contacts c ON c.client_id = d.client_id AND c.anonymised_at IS NULL
     WHERE d.id = '${draft.body.id}' LIMIT 1;`);
  const issueName = /^Issue tax invoice for the payment received, /;
  for (const theme of ["light", "dark"] as const)
    for (const width of [1280, 768, 390] as const) {
      await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/payments?tab=notices");
      await page.evaluate((t) => localStorage.setItem("ta-admin-theme", t), theme);
      await page.reload();
      const issue = page.getByRole("link", { name: issueName }).filter({ visible: true });
      await expect(issue).toBeVisible();
      await expect(issue).toHaveText(/^Issue tax invoice/);
      // every action drawn lies inside the viewport (M3: Dismiss was at x = 1364 at 1280 with the menu expanded)
      const actions = [
        issue,
        ...(await page
          .getByRole("button", { name: /^Dismiss / })
          .filter({ visible: true })
          .all()),
      ];
      for (const b of actions) {
        const box = await b.boundingBox();
        expect(box, "an action is drawn").not.toBeNull();
        if (box) expect(box.x + box.width, `an action's right edge at ${width}`).toBeLessThanOrEqual(width);
      }
      await page.waitForLoadState("networkidle");
      expect(await axe(page), `proforma notice ${width} ${theme}`).toEqual([]);
      await noSideways(page);
      if (SHOTS)
        await page.screenshot({
          path: `${SHOTS}/admin-notices-proforma-${width}-${theme}.png`,
          fullPage: true,
        });
    }
  // L2: the advance dialog started from the notice says the amount is the client's word (S1's line)
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/payments?tab=notices");
  await page.getByRole("link", { name: issueName }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText(
        /^Filled in from .*'s notice of .*\. Check the money reached the bank before you record it\.$/,
      ),
  ).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-advance-from-notice-1280.png` });
});
