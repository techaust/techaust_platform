// M7.3's admin screens (ADM-REP-01, -02, -03, -05, -06; ADM-DASH-01; ADM-G-05; run file G): Revenue and collections (by month, category and kind, the clients
// below), Outstanding and ageing, Pipeline and win rate, Care plan hours, dashboard v2 (deltas in words, the overdue bar, the leads sparkline, the Reports
// tile) and the offer list's search; axe (WCAG 2.2 AA) and no sideways scroll at 390, 768 and 1280 px in both themes, the in-app theme set against the OS
// theme; the chart marks are one keyboard stop with the arrow keys moving and the readout following.
// Sample rows, clearly fake, LOCAL database only: confirmed manual payments over this FY's months (INR to "Riverside Traders (sample)", USD with and without
// a bank-advice INR amount to "Northwind Labs (sample)", one TDS entry), leads across stages, sources and lost reasons with made-up @example.test addresses, and
// 30 days of nightly `leads.open` counts. The invoices, the care plan and the clients come from e2e/sample-data.ts (E2E_SAMPLE=1).
//   E2E_SAMPLE=1 pnpm --filter @techaust/admin exec playwright test e2e/m73-reports.spec.ts   (through tools/heavy.sh; M73_SHOTS=<folder> saves screenshots)
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
  const dir = mkdtempSync(join(tmpdir(), "admin-e2e-m73-"));
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

const SHOTS = process.env.M73_SHOTS ?? "";
const run = Date.now().toString(36);
const DAY = 86_400_000;
const istToday = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const fyStart = () => {
  const t = istToday();
  const y = Number(t.slice(0, 4));
  return `${Number(t.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
};
const OWNER =
  "(SELECT id FROM staff_users WHERE role = 'owner' AND status = 'active' ORDER BY created_at DESC LIMIT 1)";
const CLIENT = (code: string) => `(SELECT id FROM clients WHERE code = '${code}')`;

test.beforeAll(() => {
  const now = Date.now();
  const today = istToday();
  const start = fyStart();
  // payments: one or two a month from the FY's start to today
  const pays: string[] = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + m, 12);
    const day = d.toISOString().slice(0, 10);
    if (day > today) break;
    const amount = 4_000_000 + ((m * 1_370_000) % 9_000_000);
    pays.push(
      `('pay-e2e-${run}-${m}', ${CLIENT("X0001")}, 'payment', 'manual', 'confirmed', 'INR', ${amount}, '${day}', 'neft', ${OWNER}, ${now}, ${OWNER}, ${now}, NULL)`,
    );
    if (m % 3 === 1)
      pays.push(
        `('pay-e2e-${run}-u${m}', ${CLIENT("X0002")}, 'payment', 'manual', 'confirmed', 'USD', ${120_000 + m * 10_000}, '${day}', 'swift', ${OWNER}, ${now}, ${OWNER}, ${now}, ${m === 4 ? "NULL" : (120_000 + m * 10_000) * 85})`,
      );
  }
  // leads: across stages, sources and lost reasons, created over the last five months (made-up names and addresses)
  const stages = [
    "new",
    "qualified",
    "proposal_sent",
    "won",
    "lost",
    "won",
    "lost",
    "new",
    "qualified",
    "won",
    "lost",
    "new",
    "proposal_sent",
    "lost",
  ];
  const reasons = ["price", "timing", "no_response", "competitor", "scope_fit"];
  const pages = [
    "/services/automation?utm_source=x",
    "/contact",
    "/pricing#care",
    "/services/web-apps",
    "/contact",
  ];
  const leads = stages.map((s, i) => {
    const created = now - (i * 11 + 2) * DAY;
    return `('lead-e2e-${run}-${i}', 'L-E2E-${run}-${i}', '${s}', ${s === "lost" ? `'${reasons[i % reasons.length]}'` : "NULL"}, '${i % 3 === 0 ? "manual" : "web"}', 'Sample person ${i}', 'sample-${run}-${i}@example.test', ${i % 3 === 0 ? "NULL" : `'${pages[i % pages.length]}'`}, ${created}, ${created}, ${created})`;
  });
  // nightly open-lead counts for the last 30 days, per open stage
  const stats: string[] = [];
  for (let i = 0; i < 30; i++) {
    const date = addDays(today, -i);
    stats.push(`('${date}', 'leads.open', 'new', ${3 + ((i * 7) % 5)}, ${now})`);
    stats.push(`('${date}', 'leads.open', 'qualified', ${2 + ((i * 3) % 4)}, ${now})`);
  }
  d1(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at, inr_received_minor) VALUES ${pays.join(",\n")};
     INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, tds_section, tds_rate_bp, recorded_by, recorded_at, verified_by, verified_at)
       VALUES ('pay-e2e-${run}-tds', ${CLIENT("X0001")}, 'tds', 'manual', 'confirmed', 'INR', 250000, '${today}', '194J', 1000, ${OWNER}, ${now}, ${OWNER}, ${now});
     INSERT INTO leads (id, ref, stage, lost_reason, source, contact_name, contact_email, source_page, created_at, updated_at, last_activity_at) VALUES ${leads.join(",\n")};
     INSERT OR REPLACE INTO stats_daily (date, metric, dimension, value, updated_at) VALUES ${stats.join(",\n")};`,
  );
});

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/** The page never scrolls sideways (a wide table scrolls inside its own box, a named keyboard stop). */
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

const SCREENS: [string, string, string][] = [
  ["dashboard", "/", "Dashboard"],
  ["revenue-month", "/reports/revenue", "Revenue and collections"],
  ["revenue-category", "/reports/revenue?by=category", "Revenue and collections"],
  ["revenue-kind", "/reports/revenue?by=kind", "Revenue and collections"],
  ["revenue-usd", "/reports/revenue?currency=USD", "Revenue and collections"],
  ["ageing", "/reports/ageing", "Outstanding and ageing"],
  ["pipeline", "/reports/pipeline", "Pipeline and win rate"],
  ["care-hours", "/reports/care-hours", "Care plan hours"],
];

for (const theme of ["light", "dark"] as const)
  for (const width of [390, 768, 1280] as const)
    test(`the M7.3 screens pass axe at ${width} px, in-app ${theme} against the OS's other theme, with no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
      await page.addInitScript((t) => localStorage.setItem("ta-admin-theme", t), theme);
      for (const [name, path, heading] of SCREENS) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
        // the data has arrived (no skeleton left)
        await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
        // the dashboard's skeleton is hidden from assistive technology: wait for a tile's heading instead
        if (name === "dashboard")
          await expect(page.getByRole("heading", { name: "Reports", level: 2 })).toBeVisible();
        expect(await page.locator("html").getAttribute("data-theme")).toBe(theme);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${width}-${theme}.png`, fullPage: true });
        await noSideways(page);
        expect.soft(await axe(page), `${name} at ${width} (${theme})`).toEqual([]);
      }
    });

test("revenue: the year by month as paired columns with its table and total, the views and the currency in the URL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/reports\/revenue$/);
  await expect(page.getByText("Management figures, not a GST return.")).toBeVisible();
  const chart = page.getByRole("figure", { name: /Invoiced and collected by month, INR/ });
  await expect(chart).toBeVisible();
  await expect(chart.getByText("Invoiced (with GST)").first()).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /Total for \d{4}-\d{2}/ })).toBeVisible();
  // one keyboard stop: Tab reaches the first month, the arrow moves to the next, the readout follows
  const marks = chart.locator(".chart-hit");
  await marks.first().focus();
  await expect(page.locator(".chart-tip")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(marks.nth(1)).toBeFocused();
  await expect(marks.nth(1)).toHaveAttribute("tabindex", "0");
  await expect(marks.first()).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("Escape");
  await expect(page.locator(".chart-tip")).toHaveCount(0);
  await page.getByText("Category", { exact: true }).click();
  await expect(page).toHaveURL(/by=category/);
  await expect(page.getByText("A service's category is today's category in the catalogue.")).toBeVisible();
  await page.getByText("Kind of work", { exact: true }).click();
  await expect(page).toHaveURL(/by=kind/);
  await page.getByText("USD", { exact: true }).click();
  await expect(page).toHaveURL(/currency=USD/);
  await page.getByText("Month", { exact: true }).click();
  await expect(page).not.toHaveURL(/by=/);
  await expect(page.getByText(/INR equivalent: invoices at the rate on the invoice/)).toBeVisible();
});

test("revenue: Export CSV asks for a fresh code (cancelling makes no file), or with a live step-up saves the CSV", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/reports/revenue");
  const block = page.locator(".m73-block", { has: page.getByRole("heading", { name: /^By client, INR$/ }) });
  await expect(block.getByRole("table")).toBeVisible();
  const download = page.waitForEvent("download", { timeout: 20_000 }).catch(() => null);
  await block.getByRole("button", { name: "Export CSV" }).click();
  const dialog = page.getByRole("dialog");
  const asked = await dialog.waitFor({ timeout: 5_000 }).then(
    () => true,
    () => false,
  );
  if (asked) {
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(block.getByText("Cancelled. No file was made.")).toBeVisible();
  } else {
    const file = await download;
    expect(file?.suggestedFilename()).toMatch(/^revenue-by-client-FY\d{4}-\d{2}-INR\.csv$/);
  }
});

test("ageing: as at today, the buckets per currency with a thin bar, credit held apart, a statement link per row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/reports/ageing");
  await expect(
    page.getByText(/^As at today \(\d{2} [A-Z][a-z]{2} \d{4}\)\. Credit held is shown apart/),
  ).toBeVisible();
  for (const col of [
    "Not yet due",
    "1–30 days",
    "31–60 days",
    "61–90 days",
    "Over 90 days",
    "Credit held",
    "Statement",
  ])
    await expect(page.getByRole("columnheader", { name: col }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Open statement/ }).first()).toHaveAttribute(
    "href",
    /tab=statement/,
  );
  await expect(page.getByRole("group", { name: /Owed in INR/ })).toBeVisible();
});

test("pipeline: the tiles, the bars and a range further back than 12 months refused before asking", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const today = istToday();
  await page.goto(`/reports/pipeline?from=${addDays(today, -150)}&to=${today}`);
  for (const t of ["Leads in this period", "Won", "Conversion", "Offer win rate", "Median time to win"])
    await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Leads by stage" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Why leads were lost" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Open leads by day/ })).toBeVisible();
  // the stored page paths never carry a query string or a fragment
  await expect(page.getByText("?utm_source")).toHaveCount(0);
  const from = page.getByRole("textbox", { name: "From" });
  const old = addDays(today, -400);
  await from.fill(`${old.slice(8, 10)}/${old.slice(5, 7)}/${old.slice(0, 4)}`);
  await page.getByRole("button", { name: "Show" }).click();
  await expect(
    page.getByText(/Choose a period of up to 366 days|Leads are deleted 12 months/).first(),
  ).toBeVisible();
});

test("care plan hours: the month's periods with the used meter and the billed state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/reports/care-hours");
  await expect(page.getByText("Overage is priced on the care invoice.")).toBeVisible();
  const table = page.getByRole("table", { name: /Care plan hours/ });
  await expect(table).toBeVisible();
  for (const col of ["Period", "Included", "Used", "Over", "Billed on"])
    await expect(table.getByRole("columnheader", { name: col })).toBeVisible();
});

test("dashboard v2: deltas in words, the overdue buckets, the leads trend and the reports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByText(/(more than|less than|Same as) [A-Z][a-z]+ \d{4}/).first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Open leads over the last 30 days/ })).toBeVisible();
  const reports = page.getByRole("region", { name: "Reports" });
  for (const r of [
    "Revenue and collections",
    "Outstanding and ageing",
    "Pipeline and win rate",
    "Care plan hours",
  ])
    await expect(reports.getByRole("link", { name: r })).toBeVisible();
  await reports.getByRole("link", { name: "Pipeline and win rate" }).click();
  await expect(page).toHaveURL(/\/reports\/pipeline\?from=\d{4}-\d{2}-01&to=/);
});

test("All payments reads newest received first (C8), the date received leading each row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/payments?tab=all");
  const table = page.getByRole("table").first();
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const days = await table.locator("tbody tr > :first-child").allInnerTexts();
  // the date cell may carry words for a screen reader beside the day: read the day alone
  const iso = days
    .map((d) => /\d{2} [A-Z][a-z]{2} \d{4}/.exec(d)?.[0])
    .filter((d): d is string => d !== undefined)
    .map((d) => new Date(`${d} UTC`).toISOString().slice(0, 10));
  expect(iso.length).toBeGreaterThan(1);
  expect([...iso].sort().reverse()).toEqual(iso);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/payments-all-1280.png`, fullPage: true });
});

test("the offer list searches by a client's name, in the URL", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/proposals?type=all");
  const box = page.getByRole("searchbox", { name: "Search by number or client" });
  await box.fill("Riverside");
  await expect(page).toHaveURL(/q=Riverside/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/proposals-search-1280.png`, fullPage: true });
  await box.fill("zzzz-no-such-client");
  await expect(
    page.getByRole("heading", { name: "No proposals or estimates match these filters" }),
  ).toBeVisible();
});
