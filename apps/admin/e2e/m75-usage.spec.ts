// M7.5's screens (run file G; A1's M1.5 M2): the dashboard's Free-plan usage tile (Owner; the Accountant sees the same tile, Staff and Sales none: lib/usage.test.ts)
// at 390 and 1280 px in both themes, the in-app theme set against the OS theme, axe (WCAG 2.2 AA) and no sideways scroll; its loading, empty, stale and error
// states (the API answer replaced in the browser); the strips as one keyboard stop each with the readout following the arrow keys, the table toggle; and the
// dialog focus fallback: a step-up cancelled over a confirm dialog whose button is disabled while busy hands the focus to that dialog, never to <body>.
// Sample rows, clearly fake, LOCAL database only: 30 UTC days of `cf.*` account totals in `stats_daily` (two days not read, one day without D1 figures).
//   pnpm --filter @techaust/admin exec playwright test e2e/m75-usage.spec.ts   (through tools/heavy.sh; M75_SHOTS=<folder> saves screenshots)
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
  const dir = mkdtempSync(join(tmpdir(), "admin-e2e-m75-"));
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

const SHOTS = process.env.M75_SHOTS ?? "";
const DAY = 86_400_000;
/**
 * The newest day the real job has read by now, and the 29 before it (L50: as the jobs Worker does it). `usage.daily` runs at 06:00 IST (00:30 UTC) and
 * reads the UTC day that has just ended, so from 00:30 UTC the newest is yesterday (UTC), before it the day before (Cloudflare's limits reset at 00:00 UTC).
 */
const READ_AT_MS = 30 * 60_000;
const utcDay = (back: number) =>
  new Date(Date.now() - READ_AT_MS - (back + 1) * DAY).toISOString().slice(0, 10);

/** Made-up daily totals (sample only): a quiet month, a busy day nine days back, and a heavy yesterday (the benchmark day). */
function sample(back: number): Record<string, number> | null {
  if (back === 11 || back === 12) return null; // the nightly reading missed two days
  const wave = (n: number, lo: number, hi: number) => lo + (((n * 7919) % 97) / 97) * (hi - lo);
  if (back === 0)
    return {
      "cf.requests": 82_003,
      "cf.d1.rows_read": 1_240_500,
      "cf.d1.rows_written": 3_812,
      "cf.queue.operations": 5_410,
      "cf.exceeded_resources": 3,
    };
  const day: Record<string, number> = {
    "cf.requests": Math.round(back === 9 ? 51_200 : wave(back, 3_800, 12_500)),
    "cf.d1.rows_read": Math.round(back === 9 ? 2_150_000 : wave(back + 3, 280_000, 920_000)),
    "cf.d1.rows_written": Math.round(wave(back + 5, 700, 2_600)),
    "cf.queue.operations": Math.round(back === 9 ? 4_100 : wave(back + 7, 380, 1_900)),
    "cf.exceeded_resources": back === 9 ? 1 : 0,
  };
  if (back === 5) {
    // that night the D1 dataset didn't answer: no D1 figures, never zeros
    delete day["cf.d1.rows_read"];
    delete day["cf.d1.rows_written"];
  }
  return day;
}

test.beforeAll(() => {
  const now = Date.now();
  const rows: string[] = [];
  for (let back = 0; back < 30; back++) {
    const day = sample(back);
    if (!day) continue;
    for (const [metric, value] of Object.entries(day))
      rows.push(`('${utcDay(back)}', '${metric}', '', ${value}, ${now})`);
  }
  d1(
    `DELETE FROM stats_daily WHERE metric LIKE 'cf.%';
     INSERT INTO stats_daily (date, metric, dimension, value, updated_at) VALUES ${rows.join(",\n")};`,
  );
});

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function noSideways(page: Page, at: string) {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scroll, `${at}: ${scroll} > ${client}`).toBeLessThanOrEqual(client ?? 0);
}

const tileOf = (page: Page) => page.getByRole("region", { name: "Free plan usage" });

async function open(page: Page, width: number, theme: "light" | "dark") {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
  await page.addInitScript((t) => localStorage.setItem("ta-admin-theme", t), theme);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  expect(await page.locator("html").getAttribute("data-theme")).toBe(theme);
}

for (const theme of ["light", "dark"] as const)
  for (const width of [390, 1280] as const)
    test(`the usage tile at ${width} px, in-app ${theme} against the OS's other theme: rows, strips, axe, no sideways scroll`, async ({
      page,
    }) => {
      const consoleErrors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
      });
      page.on("pageerror", (e) => consoleErrors.push(e.message));
      await open(page, width, theme);
      const tile = tileOf(page);
      await expect(tile.getByText("Worker requests", { exact: true })).toBeVisible();
      await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
      // yesterday against each limit, in en-IN figures, with the status words beside the share
      await expect(tile.getByText("82,003 of 1,00,000")).toBeVisible();
      await expect(tile.getByText("82 %", { exact: true })).toBeVisible();
      await expect(tile.getByText("80 % reached")).toBeVisible();
      await expect(tile.getByText("5,410 of 10,000")).toBeVisible();
      await expect(tile.getByText("50 % reached")).toBeVisible();
      await expect(tile.getByText("12,40,500 of 50,00,000")).toBeVisible();
      await expect(
        tile.getByRole("img", { name: /^Worker requests over the last 30 days: highest 82,003/ }),
      ).toBeVisible();
      await expect(tile.getByRole("img", { name: /28 of 30 days read\.$/ }).first()).toBeVisible();
      await expect(tile.getByText("Requests stopped at a Free-plan limit")).toBeVisible();
      if (SHOTS) {
        await page.screenshot({ path: `${SHOTS}/dashboard-${width}-${theme}.png`, fullPage: true });
        await tile.screenshot({ path: `${SHOTS}/tile-${width}-${theme}.png` });
      }
      await noSideways(page, `dashboard at ${width} (${theme})`);
      expect.soft(await axe(page), `dashboard at ${width} (${theme})`).toEqual([]);

      // the 30 days as a table, behind its toggle
      const toggle = tile.getByRole("button", { name: "Show the 30 days as a table" });
      await toggle.click();
      await expect(tile.getByRole("button", { name: "Hide the table" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      if (width === 1280)
        await expect(
          tile.getByRole("table", { name: /Free plan usage over the last 30 days/ }),
        ).toBeVisible();
      // the table on a desktop, its cards on a phone: either way the day without D1 figures says so
      await expect(tile.getByText("Not read").filter({ visible: true }).first()).toBeVisible();
      if (SHOTS) await tile.screenshot({ path: `${SHOTS}/tile-table-${width}-${theme}.png` });
      await noSideways(page, `table at ${width} (${theme})`);
      expect.soft(await axe(page), `table at ${width} (${theme})`).toEqual([]);
      expect(consoleErrors, "no console errors").toEqual([]);
    });

test("each strip is one keyboard stop: the arrow keys walk the days read, the readout follows, Escape hides it", async ({
  page,
}) => {
  await open(page, 1280, "light");
  const tile = tileOf(page);
  const strip = tile.getByRole("img", { name: /^Worker requests over the last 30 days/ });
  await strip.focus();
  await expect(strip).toBeFocused();
  const tip = tile.locator(".chart-tip").first();
  await expect(tip).toContainText("82,003");
  await expect(tip).toContainText("82 % of the limit");
  await page.keyboard.press("ArrowLeft");
  await expect(tip).not.toContainText("82,003");
  await page.keyboard.press("End");
  await expect(tip).toContainText("82,003");
  if (SHOTS) await tile.screenshot({ path: `${SHOTS}/tile-readout-1280-light.png` });
  await page.keyboard.press("Escape");
  await expect(tile.locator(".chart-tip")).toHaveCount(0);
  // Tab moves on to the next strip (one stop each), then out
  await page.keyboard.press("Tab");
  await expect(tile.getByRole("img", { name: /^D1 rows read over the last 30 days/ })).toBeFocused();
  // the focus ring shows
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
  expect(outline).toBe("solid");
  if (SHOTS) await tile.screenshot({ path: `${SHOTS}/tile-focus-1280-light.png` });
});

for (const [name, theme, width] of [
  ["1280-light", "light", 1280],
  ["390-dark", "dark", 390],
] as const)
  test(`the tile's other states (${name}): loading, empty, stale and error; each passes axe`, async ({
    page,
  }) => {
    // loading: the answer held back
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/api/v1/dashboard/usage", async (route) => {
      await held;
      await route.continue();
    });
    await open(page, width, theme);
    const tile = tileOf(page);
    await expect(tile).toHaveAttribute("aria-busy", "true");
    await expect(tile.getByRole("status")).toHaveText("Loading Free plan usage");
    if (SHOTS) await tile.screenshot({ path: `${SHOTS}/state-loading-${name}.png` });
    expect.soft(await axe(page), `loading ${name}`).toEqual([]);
    release();
    await expect(tile.getByText("Worker requests", { exact: true })).toBeVisible();
    await page.unroute("**/api/v1/dashboard/usage");

    // empty: no reading yet (before the first nightly run, or no analytics token)
    await page.route("**/api/v1/dashboard/usage", (route) =>
      route.fulfill({
        json: { limits: {}, thresholds: [50, 80], days: [], newest: null },
      }),
    );
    await page.reload();
    await expect(tile.getByText(/^No readings yet\./)).toBeVisible();
    if (SHOTS) await tile.screenshot({ path: `${SHOTS}/state-empty-${name}.png` });
    expect.soft(await axe(page), `empty ${name}`).toEqual([]);
    await page.unroute("**/api/v1/dashboard/usage");

    // stale: the newest reading is four days old
    const four = utcDay(4);
    await page.route("**/api/v1/dashboard/usage", (route) =>
      route.fulfill({
        json: {
          limits: {
            "cf.requests": 100_000,
            "cf.d1.rows_read": 5_000_000,
            "cf.d1.rows_written": 100_000,
            "cf.queue.operations": 10_000,
          },
          thresholds: [50, 80],
          days: [
            { date: utcDay(6), values: { "cf.requests": 6_100, "cf.d1.rows_read": 410_000 } },
            {
              date: four,
              values: { "cf.requests": 7_240, "cf.d1.rows_read": 512_000, "cf.queue.operations": 0 },
            },
          ],
          newest: four,
        },
      }),
    );
    await page.reload();
    await expect(tile.getByText(/^No reading since /)).toBeVisible();
    await expect(tile.getByText("Not read").first()).toBeVisible();
    if (SHOTS) await tile.screenshot({ path: `${SHOTS}/state-stale-${name}.png` });
    expect.soft(await axe(page), `stale ${name}`).toEqual([]);
    await page.unroute("**/api/v1/dashboard/usage");

    // error: the server answers 500, then "Try again" loads it
    let fail = true;
    await page.route("**/api/v1/dashboard/usage", (route) =>
      fail
        ? route.fulfill({
            status: 500,
            json: { error: { code: "internal", message: "Something went wrong." } },
          })
        : route.continue(),
    );
    await page.reload();
    await expect(tile.getByRole("alert")).toContainText("The usage figures didn't load.");
    // the rest of the dashboard is unaffected
    await expect(page.getByRole("heading", { name: "Recent activity", level: 2 })).toBeVisible();
    if (SHOTS) await tile.screenshot({ path: `${SHOTS}/state-error-${name}.png` });
    expect.soft(await axe(page), `error ${name}`).toEqual([]);
    fail = false;
    await tile.getByRole("button", { name: "Try again" }).click();
    await expect(tile.getByText("82,003 of 1,00,000")).toBeVisible();
  });

test("M1.5 M2: a step-up cancelled over a confirm dialog whose button is busy hands the focus to that dialog, never to <body>", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // the regenerate request needs a fresh step-up (answered here, so the test doesn't depend on the session's age)
  await page.route("**/api/v1/auth/recovery/regenerate", (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: "step_up_required", message: "Confirm it's you first." } },
    }),
  );
  await page.goto("/account");
  await page.getByRole("button", { name: "Make new codes" }).click();
  const confirm = page.getByRole("dialog", { name: "Make new recovery codes?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Make new codes" }).click();
  const stepUp = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(stepUp).toBeVisible();
  // every element that takes the focus from here on, and whether <body> ever holds it once the step-up closes
  await page.evaluate(() => {
    const w = window as unknown as { focusLog: string[] };
    w.focusLog = [];
    document.addEventListener("focusin", (e) => {
      const t = e.target as HTMLElement;
      w.focusLog.push(`${t.tagName.toLowerCase()}:${(t.textContent ?? "").trim().slice(0, 40)}`);
    });
    const stepUpDialog = [...document.querySelectorAll("dialog")].find(
      (d) => d.open && d.textContent?.includes("Confirm it's you"),
    );
    stepUpDialog?.addEventListener("close", () => {
      w.focusLog.push(`on close: ${document.activeElement === document.body ? "body" : "not body"}`);
    });
  });
  await page.keyboard.press("Escape");
  await expect(stepUp).toBeHidden();
  // the confirm dialog's title took the focus first; then its refusal line ("Cancelled. Nothing was changed.") took it, inside the same dialog
  await expect(confirm.getByText("Cancelled. Nothing was changed.")).toBeVisible();
  const log = await page.evaluate(() => (window as unknown as { focusLog: string[] }).focusLog);
  expect(log[0]).toBe("h2:Make new recovery codes?");
  expect(log).not.toContain("on close: body");
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  expect(await confirm.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/focus-fallback-1280-light.png` });
});
