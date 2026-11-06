// M7.4's admin screens (ADM-SET-09, ADM-CLI-05, FRM-05, POR-11; run file G): the requests inbox with its reply clock and filters, one request's steps
// and close (Export sent, a decline reason), "Log a request" (DateField with onValidity, an address not in our records), the legal hold on a lead (set
// and lift, banner and history), a lead's data tools (withdraw consent, export, erase), Settings › Data retention (six figures, the trial report, the
// real-deletion switch, the erased-address lift), and the erase dialog's "in parts" state (the API answers mocked: >10 offers can't be seeded cheaply).
// axe (WCAG 2.2 AA) at 390 and 1280 px, in-app light and dark against the OS's other theme, no sideways scroll. Sample data only, written to the LOCAL
// database as the portal and the jobs Worker would write it.
//   pnpm --filter @techaust/admin exec playwright test e2e/m74-data-protection.spec.ts   (through tools/heavy.sh; M74_SHOTS=<dir> saves screenshots)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { requestDueAtSql } from "@techaust/core/dsr";
import { ORIGIN } from "../playwright.config.ts";
import { totpAt } from "./sample-data.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SHOTS = process.env.M74_SHOTS ?? "";
const DAY = 86_400_000;
const run = Date.now().toString(36).toUpperCase();

function d1(sql: string) {
  const jobs = here("../../jobs/");
  const wrangler = join(jobs, "node_modules", "wrangler", "bin", "wrangler.js");
  const dir = mkdtempSync(join(tmpdir(), "admin-e2e-m74-"));
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

const LEAD = `lead-m74-${run}`;
const LEAD_REF = `L-M74-${run}`;

test.beforeAll(() => {
  const now = Date.now();
  // Portal requests from the first live contacts (the portal's own rows: identity checked by the sign-in, when they arrived), one per kind, at ages that
  // give each state: overdue (35 days), due soon (27 days), not acknowledged (3 days), on time (1 day).
  const portal = (kind: string, ageDays: number, details: string | null, offset: number) => {
    const at = now - ageDays * DAY;
    return `INSERT INTO client_requests (id, client_id, contact_id, contact_ref, kind, details, status, created_at, updated_at, received_at, due_at, ack_due_at, identity_checked_at)
      SELECT 'req-m74-${run}-${kind}', c.client_id, c.id, c.id, '${kind}', ${details ? `'${details}'` : "NULL"}, 'open', ${at}, ${at}, ${at}, ${requestDueAtSql(String(at))}, ${at} + 172800000, ${at}
        FROM contacts c JOIN clients cl ON cl.id = c.client_id
       WHERE c.anonymised_at IS NULL AND cl.anonymised_at IS NULL AND c.legal_hold = 0 AND cl.legal_hold = 0
         AND NOT EXISTS (SELECT 1 FROM client_requests r WHERE r.contact_id = c.id AND r.kind = '${kind}' AND r.status = 'open')
       ORDER BY c.email LIMIT 1 OFFSET ${offset};`;
  };
  // A finished trial run of yesterday night (the switch can turn on) and an older one, with sample counts per family.
  const families = [
    "email_log",
    "email_events",
    "access_log",
    "audit_ip",
    "sessions",
    "counters",
    "bells",
    "stats",
    "requests",
    "consent",
    "runs",
  ];
  const runRow = (id: string, at: number) =>
    `INSERT OR IGNORE INTO retention_runs (id, as_of, mode, started_at, finished_at, families) VALUES ('${id}', ${at}, 'dry_run', ${at}, ${at + 60_000}, ${families.length});
     INSERT OR IGNORE INTO retention_run_counts (run_id, family, due, held_skipped, oldest_at, done) VALUES ${families
       .map(
         (f, i) =>
           `('${id}', '${f}', ${f === "sessions" ? 38 : f === "counters" ? 412 : f === "bells" ? 17 : 0}, ${f === "bells" ? 2 : 0}, ${f === "sessions" || f === "counters" || f === "bells" ? at - (40 + i) * DAY : "NULL"}, 1)`,
       )
       .join(", ")};`;
  d1(
    [
      portal("data_access", 35, null, 0),
      portal("grievance", 27, "We got an email meant for another company (sample).", 0),
      portal("data_correction", 3, "My phone number on your records is old (sample).", 1),
      portal("contact_change", 1, "Please add our accountant Meera Das (sample) to the portal.", 1),
      // a manual lead with a consent record, for its data tools and its legal hold
      `INSERT INTO leads (id, ref, stage, source, contact_name, contact_email, consent, created_at, updated_at, last_activity_at)
        VALUES ('${LEAD}', '${LEAD_REF}', 'new', 'manual', 'Ravi Kumar (sample)', 'ravi.${run.toLowerCase()}@example.test',
          '{"noticeVersion":"0.3","purposes":["respond_to_enquiry","marketing_updates"],"at":${now - 5 * DAY},"marketing":true}', ${now - 5 * DAY}, ${now - 5 * DAY}, ${now - 5 * DAY});`,
      runRow(`rr-m74-${run}-a`, now - 9 * DAY),
      runRow(`rr-m74-${run}-b`, now - 20 * 3_600_000),
    ].join("\n"),
  );
});

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}
const noSideways = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const shot = async (page: Page, name: string, fullPage = true) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};

/** The API's CSRF check compares the Origin of every write with the admin's own. */
const headers = { Origin: ORIGIN };
const secret = () => Buffer.from(readFileSync(here("../.e2e/owner-totp.hex"), "utf8"), "hex");
/** A step-up for this session (so the dialogs ask for no code), unless one is still good for two minutes. */
async function stepUp(page: Page) {
  const me = await page.request.get("/api/v1/auth/me");
  const until = ((await me.json()) as { stepUpUntil: number | null }).stepUpUntil;
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

test("the inbox: the clock and the filters, a request's steps, and its close with Export sent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/requests");
  await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  // the open count is on Requests in the navigation, its words read out
  await expect(
    page
      .getByRole("navigation")
      .getByText(/open requests?$/)
      .first(),
  ).toBeAttached();
  const overdue = page
    .locator("tr", { hasText: "Copy of their personal data" })
    .filter({ hasText: "overdue" });
  await expect(overdue.first()).toBeVisible();
  await expect(overdue.first().getByText("Overdue", { exact: true })).toBeVisible();
  await shot(page, "inbox-open-1280");
  // Show › Due within 5 days: only the grievance received 27 days ago
  await page.getByRole("radio", { name: "Due within 5 days" }).click();
  await expect(page).toHaveURL(/show=due_soon/);
  await expect(
    page
      .locator("tr", { hasText: "We got an email meant for another company (sample)." })
      .or(page.locator("tr", { hasText: "Concern about how we handle their data" }))
      .first(),
  ).toBeVisible();
  await expect(page.locator("tbody tr", { hasText: "Copy of their personal data" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Not acknowledged" }).click();
  await expect(
    page.locator("tbody tr", { hasText: "Correction of their personal data" }).first(),
  ).toBeVisible();
  await shot(page, "inbox-ack-overdue-1280");
  // Kind narrows within the choice; an empty result says so in words
  await page
    .getByRole("combobox", { name: "Kind" })
    .selectOption({ label: "Nomination of someone to act for them" });
  await expect(page.getByRole("heading", { name: "Every open request has been acknowledged" })).toBeVisible();
  await shot(page, "inbox-empty-1280");

  // the overdue access request: open it, acknowledge it, close it as done with the export emailed
  await page.goto("/requests?show=overdue");
  await page
    .locator("tbody tr", { hasText: "Copy of their personal data" })
    .first()
    .getByRole("link")
    .click();
  const dialog = page.getByRole("dialog", { name: "Copy of their personal data" });
  await expect(dialog.getByRole("heading", { name: "Steps" })).toBeVisible();
  await expect(dialog.getByText("By their sign-in to the client portal")).toBeVisible();
  await shot(page, "request-dialog-1280", false);
  await dialog.getByRole("button", { name: "Mark as acknowledged" }).click();
  await expect(page.getByText("Marked as acknowledged.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Mark as acknowledged" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close request" }).click();
  const close = page.getByRole("dialog", { name: "Close this request?" });
  await close.getByRole("button", { name: "Close request" }).click();
  await expect(close.getByText("Choose Done or Declined.")).toBeVisible();
  await close.getByRole("radio", { name: "Done: we did what was asked" }).check();
  await close.getByRole("checkbox", { name: "We emailed them the export" }).check();
  await expect(close.getByRole("textbox", { name: "Emailed on" })).toBeVisible();
  await shot(page, "request-close-done-1280", false);
  await close.getByRole("button", { name: "Close request" }).click();
  await expect(page.getByText("Request closed.")).toBeVisible();
  await page.goto("/requests?show=closed");
  await expect(page.locator("tbody tr", { hasText: "Copy of their personal data" }).first()).toBeVisible();
});

test("Log a request: the checks, an erasure from someone not in our records, and its decline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/requests");
  await page.getByRole("button", { name: "Log a request" }).click();
  const dialog = page.getByRole("dialog", { name: "Log a request" });
  await dialog.getByRole("button", { name: "Log request" }).click();
  await expect(dialog.getByText("Choose what they asked for.")).toBeVisible();
  await expect(dialog.getByText("Choose how it reached us.")).toBeVisible();
  await expect(dialog.getByText("Choose who it's from.")).toBeVisible();
  await shot(page, "log-errors-1280", false);
  // an unreadable day blocks the log with the owner's date line
  const day = dialog.getByRole("textbox", { name: "Received on" });
  await day.fill("31/02/2026");
  await dialog
    .getByRole("combobox", { name: "What they asked for" })
    .selectOption({ label: "Erasure of their personal data" });
  await dialog.getByText("Email", { exact: true }).click();
  await dialog.getByRole("radio", { name: "Someone not in our records" }).check();
  await expect(dialog.getByText(/can only be declined/)).toBeVisible();
  await dialog.getByRole("textbox", { name: "Their email address" }).fill(`Someone.${run}@Example.test`);
  await dialog.getByRole("button", { name: "Log request" }).click();
  await expect(dialog.getByText("Enter the date as DD/MM/YYYY, for example 26/10/2026.")).toBeVisible();
  const yesterday = new Date(Date.now() + 19_800_000 - DAY)
    .toISOString()
    .slice(0, 10)
    .split("-")
    .reverse()
    .join("/");
  await day.fill(yesterday);
  await shot(page, "log-filled-1280", false);
  await dialog.getByRole("button", { name: "Log request" }).click();
  await expect(page.getByText("Request logged.")).toBeVisible();
  // the new request opens: logged by email, identity not checked, Done not offered for an address-only erasure
  const req = page.getByRole("dialog", { name: "Erasure of their personal data" });
  await expect(req.getByText(`someone.${run.toLowerCase()}@example.test`)).toBeVisible();
  await expect(req.getByRole("button", { name: "Record the identity check" })).toBeVisible();
  await req.getByRole("button", { name: "Close request" }).click();
  const close = page.getByRole("dialog", { name: "Close this request?" });
  await expect(close.getByRole("radio", { name: "Done: we did what was asked" })).toBeDisabled();
  await expect(close.getByText(/can only be declined/)).toBeVisible();
  // L28: only the four reasons an address-only erasure can take
  await expect(close.getByRole("radio", { name: "A legal hold stands on their records" })).toHaveCount(0);
  await close.getByRole("button", { name: "Close request" }).click();
  await expect(close.getByText("Choose why it's declined.")).toBeVisible();
  await close.getByRole("radio", { name: "We hold no data about them" }).check();
  await shot(page, "request-close-declined-1280", false);
  await close.getByRole("button", { name: "Close request" }).click();
  await expect(page.getByText("Request closed.")).toBeVisible();
});

test("a lead: legal hold set and lifted, consent withdrawn, the export, then the erase", async ({ page }) => {
  await stepUp(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/leads/${LEAD}`);
  await expect(page.getByRole("heading", { level: 1, name: "Ravi Kumar (sample)" })).toBeVisible();
  const panel = page.getByRole("region", { name: "Legal hold" });
  await expect(panel.getByText("No hold has been set on this record.")).toBeVisible();
  await panel.getByRole("button", { name: "Set a legal hold" }).click();
  const set = page.getByRole("dialog", { name: /^Set a legal hold on / });
  await set.getByRole("button", { name: "Set legal hold" }).click();
  await expect(set.getByText("Enter the reason.")).toBeVisible();
  await set.getByRole("textbox", { name: "Reason" }).fill("GST assessment notice for FY 2025-26 (sample).");
  await shot(page, "hold-set-dialog-1280", false);
  await set.getByRole("button", { name: "Set legal hold" }).click();
  await expect(page.getByText("Legal hold set.")).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "Legal hold is on." })).toBeVisible();
  await expect(panel.getByText("GST assessment notice for FY 2025-26 (sample).")).toBeVisible();
  await shot(page, "lead-held-1280");
  // a held lead's erase is refused in words
  await page.getByRole("button", { name: /^Data tools/ }).click();
  await page.getByRole("menuitem", { name: "Erase this lead" }).click();
  const erase = page.getByRole("dialog", { name: "Erase Ravi Kumar (sample)?" });
  await erase.getByRole("radio", { name: "They asked to be erased" }).check();
  await erase.getByRole("button", { name: "Erase lead" }).click();
  await expect(erase.getByText("A legal hold stands on this person. Lift it before erasing.")).toBeVisible();
  await erase.getByRole("button", { name: "Cancel" }).click();
  // lift it
  await panel.getByRole("button", { name: "Lift the legal hold" }).click();
  const lift = page.getByRole("dialog", { name: /^Lift the legal hold on / });
  await lift.getByRole("textbox", { name: "Reason" }).fill("Assessment closed (sample).");
  await lift.getByRole("button", { name: "Lift legal hold" }).click();
  await expect(page.getByText("Legal hold lifted.")).toBeVisible();
  await expect(panel.getByText("Lifted by", { exact: false })).toBeVisible();

  // withdraw consent
  await page.getByRole("button", { name: /^Data tools/ }).click();
  await page.getByRole("menuitem", { name: "Withdraw marketing consent" }).click();
  const w = page.getByRole("dialog", { name: "Withdraw Ravi Kumar (sample)'s marketing consent?" });
  await w.getByRole("button", { name: "Withdraw consent" }).click();
  await expect(page.getByText("Consent withdrawn.")).toBeVisible();
  // the export downloads a file
  await page.getByRole("button", { name: /^Data tools/ }).click();
  await expect(page.getByRole("menuitem", { name: "Withdraw marketing consent" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Export their data" }).click();
  const exp = page.getByRole("dialog", { name: "Export Ravi Kumar (sample)'s data" });
  const download = page.waitForEvent("download");
  await exp.getByRole("button", { name: "Export data" }).click();
  expect((await download).suggestedFilename()).toBe(
    `techaust-data-export-${LEAD_REF}-${new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)}.json`,
  );
  await expect(exp.getByText(/^Downloaded /)).toBeVisible();
  await exp.getByRole("button", { name: "Close" }).click();
  // erase it: back to the leads list with the toast
  await page.getByRole("button", { name: /^Data tools/ }).click();
  await page.getByRole("menuitem", { name: "Erase this lead" }).click();
  await erase.getByRole("radio", { name: "They asked to be erased" }).check();
  await shot(page, "lead-erase-1280", false);
  await erase.getByRole("button", { name: "Erase lead" }).click();
  await expect(page.getByText("Lead erased.")).toBeVisible();
  await expect(page).toHaveURL(/\/leads$/);
});

test("Settings › Data retention: six figures, the trial report, real deletion on and off, the lift refused", async ({
  page,
}) => {
  await stepUp(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings/retention#dp-report");
  for (const label of [
    "Unconverted leads",
    "Email logs",
    "Security and access logs",
    "Closed data requests",
    "Consent records",
    "Audit log and financial records",
  ])
    await expect(page.locator(".settings-rows").getByText(label, { exact: true })).toBeVisible();
  const report = page.getByRole("region", { name: "Clean-up reports" });
  await expect(report.getByRole("rowheader", { name: "Expired sign-in sessions and links" })).toBeVisible();
  await expect(report.getByRole("columnheader", { name: "Would delete" })).toBeVisible();
  await shot(page, "retention-1280");
  // the switch: on (confirm), then off
  const sw = page.getByRole("switch", { name: "Real deletion" });
  await expect(sw).toBeEnabled();
  await sw.click();
  const on = page.getByRole("dialog", { name: "Turn on real deletion?" });
  await shot(page, "retention-on-confirm-1280", false);
  await on.getByRole("button", { name: "Turn on real deletion" }).click();
  await expect(page.getByText("Real deletion is on.")).toBeVisible();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/Real deletion has been on since/)).toBeVisible();
  await shot(page, "retention-live-1280");
  await sw.click();
  await page
    .getByRole("dialog", { name: "Turn off real deletion?" })
    .getByRole("button", { name: "Turn off real deletion" })
    .click();
  await expect(page.getByText("Real deletion is off. The clean-up only reports.")).toBeVisible();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  // the lift: an address not on the erased list is refused in S9's words
  await page.getByRole("button", { name: "Allow emails again" }).click();
  await expect(page.getByText("Enter the email address.")).toBeVisible();
  await page.getByRole("textbox", { name: "Email address" }).fill(`nobody.${run}@example.test`);
  await page.getByRole("button", { name: "Allow emails again" }).click();
  const confirm = page.getByRole("dialog", { name: /^Allow emails again to / });
  await confirm.getByRole("button", { name: "Allow emails again" }).click();
  await expect(confirm.getByText("This address isn't on the erased list.")).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
});

test("the erase dialog's in-parts state (F5; the API's answers mocked)", async ({ page }) => {
  await stepUp(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  let parts = 0;
  // the second part waits until the test has seen the progress line (released below)
  let release: () => void = () => {};
  const seen = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/v1/contacts/*/erase", async (route) => {
    const body = route.request().postDataJSON() as { mode: string; part?: string };
    if (body.part === "offers") {
      parts++;
      if (parts === 2) await seen;
      return route.fulfill({
        json: { ok: true, mode: "anonymise", part: "offers", redacted: 10, more: parts < 2 },
      });
    }
    if (parts === 0)
      return route.fulfill({ status: 409, json: { error: { code: "too_many_offers", message: "x" } } });
    return route.fulfill({ json: { ok: true, mode: "anonymise" } });
  });
  await page.goto("/clients");
  await page
    .locator(".dtable a[href^='/clients/']:not([href$='/new'])")
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole("tab", { name: "Contacts" }).click();
  await page
    .getByRole("button", { name: /^Data tools/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Erase or anonymise" }).click();
  const dialog = page.getByRole("dialog", { name: /^Erase or anonymise / });
  await dialog.getByText("Anonymise", { exact: true }).click();
  await dialog.getByRole("radio", { name: "They asked to be erased" }).check();
  await dialog.getByRole("button", { name: "Anonymise contact" }).click();
  await expect(dialog.getByText(/so they're anonymised in parts/)).toBeVisible();
  await shot(page, "erase-parts-offer-1280", false);
  await dialog.getByRole("button", { name: "Anonymise in parts" }).click();
  await expect(dialog.getByText("Details removed from 10 offers so far.")).toBeVisible();
  await shot(page, "erase-parts-running-1280", false);
  release();
  await expect(page.getByText("Contact anonymised.")).toBeVisible();
  expect(parts).toBe(2);
});

test("the keyboard: Show by arrow keys, a request opened with Enter, Escape back to its link, a visible focus ring", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/requests");
  await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  const open = page.getByRole("radio", { name: "Open" });
  await open.focus();
  // the focus ring is drawn around the chosen pill (2 px, the focus colour)
  const ring = await page.evaluate(() => {
    const opt = document.activeElement?.closest("label");
    return opt ? getComputedStyle(opt).outlineWidth : "";
  });
  expect(ring).toBe("2px");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Overdue" })).toBeChecked();
  await expect(page).toHaveURL(/show=overdue/);
  const link = page.locator("tbody .dp-row-open").first();
  await link.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Tab stays inside the dialog
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/id=/);
  await expect(link).toBeFocused();
});

for (const theme of ["light", "dark"] as const)
  for (const width of [390, 1280] as const)
    test(`the M7.4 screens pass axe at ${width} px, in-app ${theme} against the OS's other theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
      await page.addInitScript((t) => localStorage.setItem("ta-admin-theme", t), theme);
      await page.setViewportSize({ width, height: 900 });
      const tag = `${width}-${theme}`;
      await page.goto("/requests");
      await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await axe(page), "inbox").toEqual([]);
      await noSideways(page);
      await shot(page, `inbox-${tag}`);
      // one request
      await page.locator(".dp-row-open, .dtable a").filter({ visible: true }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await axe(page), "request").toEqual([]);
      await shot(page, `request-${tag}`, false);
      await page.keyboard.press("Escape");
      // the log dialog
      await page.getByRole("button", { name: "Log a request" }).click();
      await page
        .getByRole("dialog", { name: "Log a request" })
        .getByRole("radio", { name: "A lead" })
        .check();
      expect(await axe(page), "log").toEqual([]);
      await shot(page, `log-${tag}`, false);
      await page.keyboard.press("Escape");
      // Settings › Data retention
      await page.goto("/settings/retention");
      await expect(page.getByRole("region", { name: "Clean-up reports" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await axe(page), "retention").toEqual([]);
      await noSideways(page);
      await shot(page, `retention-${tag}`);
      // a client's overview with its legal-hold panel
      await page.goto("/clients");
      await page
        .locator(".dtable a[href^='/clients/']:not([href$='/new'])")
        .filter({ visible: true })
        .first()
        .click();
      await expect(page.getByRole("region", { name: "Legal hold" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await axe(page), "client").toEqual([]);
      await noSideways(page);
      await shot(page, `client-hold-${tag}`);
    });
