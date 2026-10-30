// rt1 screens in the browser [ADM-INV-11, ADM-INV-18, ADM-REP-04, ADM-SET-03]: 07-ZD's lines where they are drawn, axe (WCAG 2.2 AA) on each, both themes,
// a desktop, a tablet and a phone width. Signed in as global-setup's Owner on the LOCAL database, with E2E_SAMPLE=1's sample invoices (e2e/sample-data.ts).
//   - Settings › Tax: "GSTR-1 filing" (line 1) is saved and read back (Monthly, then Quarterly again), through the real API.
//   - The credit-note deadline on the sample tax invoice: the server's own banner (before the deadline, line 2), then the warning (line 4) with the quarterly
//     line (line 3) and the passed line (line 5). The local clock can't reach a 2027 deadline, so those two answers are the server's view with only
//     `creditDeadline` changed in the browser (SIMULATED in the shot names).
//   - `debit_lut_missing` (line 6) through the real server: the LUT list is emptied, a debit draft is made on the sample export invoice, its page names the
//     FY and links "Settings › Tax" to the LUT list; the LUT and the draft are put back as they were.
//   - Reports › GST exports: the 3B held row (line 7) and the panel's line (line 8). The register is answered in the browser with clearly fake rows
//     (an invoice and three credit notes to "Sample client A (fake)", two not accepted in IMS), and the step-up is taken as fresh (SIMULATED).
//   - rt1 review 2 and 3, laid out by their own width: every Settings list's rows go side by side only when the words keep at least 16rem (768 px has
//     the menu and the settings menu beside them), and no part of an issued note's row in the invoice's notes ledger lies over another, at 768, 1024,
//     1280 and 1920; the same for the note switch of an export invoice draft (made for the test and deleted after).
// Screenshots only when RT1_SHOTS names a folder (absolute path); the checks run either way. Run through the queue:
//   E2E_SAMPLE=1 RT1_SHOTS=<abs dir> bash tools/heavy.sh --log rt1-e2e pnpm --filter @techaust/admin exec playwright test e2e/rt1-screens.spec.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const FAILING = new Set(["moderate", "serious", "critical"]);
const SHOTS = process.env.RT1_SHOTS ?? "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
/** `menu: "open"`: the side menu kept open at a width where it starts as icons (below 1024 px), as a person can choose; the narrowest content. */
type View = { readonly width: number; readonly theme: "light" | "dark"; readonly menu?: "open" };
const VIEWS = [
  { width: 1280, theme: "light" },
  { width: 1280, theme: "dark" },
  // rt1 review: the tablet width, where the menu leaves the content a phone's width
  { width: 768, theme: "light" },
  { width: 768, theme: "dark" },
  { width: 390, theme: "light" },
  { width: 390, theme: "dark" },
] as const satisfies readonly View[];
/** The layout checks of the review fixes: the four widths (768 with the menu as icons and kept open, as the review saw it), the theme alternating (each
 *  against the opposite OS theme). */
const LAYOUT_VIEWS = [
  { width: 768, theme: "light", menu: "open" },
  { width: 768, theme: "dark" },
  { width: 1024, theme: "dark" },
  { width: 1280, theme: "light" },
  { width: 1920, theme: "dark" },
] as const satisfies readonly View[];
/** Every Settings page whose rows are a `settings-rows` list (shell.css `.setting`). */
const SETTINGS_ROW_PAGES = [
  "/settings/tax",
  "/settings/payment-terms",
  "/settings/email",
  "/settings/retention",
  "/settings/flags",
];

// biome-ignore lint/suspicious/noExplicitAny: API answers are read loosely here, as in the sample data
type J = Record<string, any>;

async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton, [aria-busy='true']")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

async function axe(page: Page, where: string) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const bad = r.violations.filter((v) => FAILING.has(v.impact ?? ""));
  expect(bad.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual(
    [],
  );
}

async function view(page: Page, v: View) {
  await page.setViewportSize({ width: v.width, height: 900 });
  // the in-app theme against the opposite OS theme: the app's choice must win
  await page.addInitScript((t) => localStorage.setItem("ta-admin-theme", t), v.theme);
  // the side menu: kept open, or as the shell chooses by width (init scripts run in order, so the last view's choice wins)
  await page.addInitScript((open) => {
    if (open) localStorage.setItem("ta-admin-nav", "expanded");
    else localStorage.removeItem("ta-admin-nav");
  }, v.menu === "open");
  await page.emulateMedia({ colorScheme: v.theme === "light" ? "dark" : "light", reducedMotion: "reduce" });
}

/** An element's screenshot (and the page's at 1280 when `page` is asked), named by what it shows, the width and the theme. */
async function shot(page: Page, name: string, v: View, target?: string) {
  if (!SHOTS) return;
  const file = join(SHOTS, `${name}-${v.width}${v.menu === "open" ? "-menu-open" : ""}-${v.theme}.png`);
  if (target) {
    const el = page.locator(target).first();
    await el.scrollIntoViewIfNeeded();
    // A section taller than the window is stitched from several scrolls: the sticky top bar would be drawn over it, so it is not sticky for the shot.
    await el.screenshot({
      path: file,
      animations: "disabled",
      style: ".topbar { position: static !important; }",
    });
  } else await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
}

async function api(page: Page, path: string, init: { method?: string; body?: unknown } = {}) {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const res = await page.request.fetch(`/api/v1${path}`, {
    method,
    headers: { Origin: new URL(page.url() || "http://localhost").origin },
    ...(init.body === undefined ? {} : { data: init.body }),
  });
  return { status: res.status(), data: (await res.json().catch(() => ({}))) as J };
}

async function invoices(page: Page): Promise<J[]> {
  const r = await api(page, "/invoices");
  expect(r.status).toBe(200);
  return r.data.invoices ?? [];
}

test.describe("rt1 screens", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  // No console error on any of these screens (a request this spec answers itself never fails).
  let consoleErrors: string[] = [];
  test.beforeEach(({ page }) => {
    consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(e.message));
  });
  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("Settings › Tax: GSTR-1 filing (07-ZD line 1) saves and reads back", async ({ page }) => {
    // Keyboard: the field sits in the Tab order right after the cut-off it works with, and shows the focus ring.
    await view(page, VIEWS[0]);
    await page.goto("/settings/tax");
    await settled(page);
    await page.locator("#f-creditNoteCutoff-month").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#f-gstr1Frequency")).toBeFocused();
    expect(
      await page.locator("#f-gstr1Frequency").evaluate((el) => getComputedStyle(el).outlineStyle),
    ).not.toBe("none");
    await shot(page, "keyboard-tax-gstr1-focus", VIEWS[0], ".setting:has(#f-gstr1Frequency)");
    for (const v of VIEWS) {
      await view(page, v);
      await page.goto("/settings/tax");
      await settled(page);
      const field = page.getByLabel("GSTR-1 filing", { exact: true });
      await expect(field).toHaveValue("quarterly");
      await expect(field.locator("option")).toHaveText(["Quarterly (QRMP scheme)", "Monthly"]);
      await expect(page.locator("#tax-gstr1-desc")).toHaveText(
        "Sets the last day for credit notes on last year's invoices: 31 October for GST-registered clients, and 30 September for other clients if you file quarterly.",
      );
      await expect(field).toHaveAttribute("aria-describedby", "tax-gstr1-desc");
      // 07-ZD line 9 (rt1 review 1): the cut-off's hint, which points at this field
      await expect(page.locator("#tax-cn-desc")).toHaveText(
        "Credit notes on last year's invoices are blocked after the last GST return period that ends before this date (see GSTR-1 filing below).",
      );
      await axe(page, `/settings/tax ${v.width} ${v.theme}`);
      await shot(page, "tax-gstr1-filing", v, ".settings-rows:has(#f-gstr1Frequency)");
    }
    // Monthly is saved and read back; then Quarterly again (the default), so the database is left as it was.
    await view(page, VIEWS[0]);
    for (const value of ["monthly", "quarterly"] as const) {
      await page.goto("/settings/tax");
      await settled(page);
      await page.getByLabel("GSTR-1 filing", { exact: true }).selectOption(value);
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Tax settings saved. They apply to new documents only.")).toBeVisible();
      await page.reload();
      await settled(page);
      await expect(page.getByLabel("GSTR-1 filing", { exact: true })).toHaveValue(value);
      const stored = await api(page, "/settings/groups/tax");
      expect(stored.data.value.gstr1Frequency).toBe(value);
    }
  });

  test("the credit-note deadline banner (07-ZD lines 2 to 5): before, warning with the quarterly basis, passed", async ({
    page,
  }) => {
    await page.goto("/");
    const list = await invoices(page);
    const inv = list.find((r) => r.type === "tax_invoice" && r.status !== "void" && r.status !== "draft");
    expect(inv, "the sample data has an issued tax invoice").toBeTruthy();
    const href = `/invoices/${encodeURIComponent(inv?.id)}`;
    const BEFORE_Q =
      /^Issue any credit note for this invoice by 30 Sep 2027, so it goes into a GST return filed by 30 Nov 2027\.$/;
    const QUARTER =
      /^This client isn't GST registered, so the note goes in your quarterly GSTR-1, not a monthly IFF\.$/;
    const states: { name: string; patch: J | null; tone: string; lines: RegExp[] }[] = [
      // The server's own answer: an FY 2026-27 invoice to the sample's unregistered client, quarterly filing (the default): the quarter end before
      // 30 Nov 2027 is 30 Sep 2027, and the basis line says why.
      { name: "deadline-before", patch: null, tone: "info", lines: [BEFORE_Q, QUARTER] },
      // A registered client (or monthly filing): the month end, and no basis line.
      {
        name: "deadline-before-month-SIMULATED",
        patch: { lastDay: "2027-10-31", period: "month" },
        tone: "info",
        lines: [
          /^Issue any credit note for this invoice by 31 Oct 2027, so it goes into a GST return filed by 30 Nov 2027\.$/,
        ],
      },
      {
        name: "deadline-warning-SIMULATED",
        patch: { daysLeft: 12, deadlineWarnFrom: "2026-08-01" },
        tone: "warning",
        lines: [/^Only 12 days left to issue a credit note on this invoice\.$/, BEFORE_Q, QUARTER],
      },
      {
        name: "deadline-passed-SIMULATED",
        patch: { passed: true, daysLeft: -3 },
        tone: "danger",
        lines: [
          /^The last day for a credit note on this invoice was 30 Sep 2027\. A refund now can't reduce the GST already paid\.$/,
        ],
      },
    ];
    for (const s of states) {
      for (const v of VIEWS) {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        if (s.patch) {
          const patch = s.patch;
          await page.route(
            (u) => u.pathname === `/api/v1${href}`,
            async (route) => {
              const res = await route.fetch();
              const body = (await res.json()) as J;
              body.creditDeadline = { ...body.creditDeadline, ...patch };
              // once passed, the server takes the credit action away, as it would on that day
              if (patch.passed) body.actions.credit = { allowed: false, reasons: ["credit_deadline_passed"] };
              await route.fulfill({ response: res, json: body });
            },
          );
        }
        await view(page, v);
        await page.goto(href);
        await settled(page);
        const banner = page.locator(".notes-deadline");
        await expect(banner).toHaveClass(new RegExp(`notes-deadline--${s.tone}`));
        const ps = banner.locator("p");
        await expect(ps).toHaveCount(s.lines.length);
        for (const [i, re] of s.lines.entries()) await expect(ps.nth(i)).toHaveText(re);
        await expect(banner).not.toContainText("30 November");
        await expect(banner).not.toContainText(/\bCA\b/);
        await axe(page, `${href} ${s.name} ${v.width} ${v.theme}`);
        await shot(page, s.name, v, ".notes-panel");
      }
    }
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("a debit note on an LUT export dated in a year without a LUT (07-ZD line 6), through the real server", async ({
    page,
  }) => {
    await page.goto("/");
    const exp = (await invoices(page)).find((r) => r.type === "export_invoice" && r.status !== "void");
    expect(exp, "the sample data has an issued export invoice").toBeTruthy();
    const taxDoc = await api(page, "/settings/groups/tax");
    expect(taxDoc.status).toBe(200);
    const luts = taxDoc.data.value.luts as J[];
    expect(luts.length, "the sample data saved a LUT").toBeGreaterThan(0);
    // The LUT list emptied for this test only; put back in `finally`.
    const empty = await api(page, "/settings/groups/tax", {
      method: "PUT",
      body: { version: taxDoc.data.version, value: { ...taxDoc.data.value, luts: [] } },
    });
    expect(empty.status).toBe(200);
    let draftId: string | null = null;
    try {
      const parent = await api(page, `/invoices/${encodeURIComponent(exp?.id)}`);
      const made = await api(page, `/invoices/${encodeURIComponent(exp?.id)}/debit-note`, {
        body: {
          expectedParentUpdatedAt: parent.data.updatedAt,
          lines: [{ line: 0, taxableMinor: 10_00 }],
          reasonCode: "price_correction",
        },
      });
      draftId = made.status === 409 ? (made.data.draftId ?? null) : (made.data.id ?? null);
      expect(draftId, `debit draft (${made.status})`).toBeTruthy();
      const fy = "2026-27"; // today's FY: the draft's issue day, the year whose LUT is gone
      for (const v of VIEWS) {
        await view(page, v);
        await page.goto(`/invoices/${encodeURIComponent(draftId as string)}`);
        await settled(page);
        const row = page.locator(".blockers__item[data-code='debit_lut_missing']");
        await expect(row).toHaveText(
          `This debit note is dated in FY ${fy} and the invoice was exported under LUT. Save your LUT for FY ${fy} in Settings › Tax first.`,
        );
        const link = row.getByRole("link", { name: "Settings › Tax" });
        await expect(link).toHaveAttribute("href", "/settings/tax#luts");
        // the whole row is the link's target (44 px)
        expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await axe(page, `debit draft ${v.width} ${v.theme}`);
        await shot(page, "blocker-debit-lut-missing", v, ".inv-issue-panel");
      }
      // Keyboard: Tab from the top of the page reaches the link (no trap on the way), its focus ring shows, and Enter lands on the LUT list.
      await view(page, VIEWS[0]);
      await page.goto(`/invoices/${encodeURIComponent(draftId as string)}`);
      await settled(page);
      const link = page
        .locator(".blockers__item[data-code='debit_lut_missing']")
        .getByRole("link", { name: "Settings › Tax" });
      let reached = false;
      for (let i = 0; i < 80 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await link.evaluate((el) => el === document.activeElement);
      }
      expect(reached, "Tab reaches the Settings › Tax link").toBe(true);
      await shot(page, "keyboard-blocker-link-focus", VIEWS[0], ".inv-issue-panel");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/settings\/tax#luts$/);
      await expect(page.locator("#luts")).toBeInViewport();
    } finally {
      const now = await api(page, "/settings/groups/tax");
      await api(page, "/settings/groups/tax", {
        method: "PUT",
        body: { version: now.data.version, value: { ...now.data.value, luts } },
      });
      if (draftId) {
        const d = await api(page, `/invoices/${encodeURIComponent(draftId)}`);
        await api(page, `/invoices/${encodeURIComponent(draftId)}?expectedUpdatedAt=${d.data.updatedAt}`, {
          method: "DELETE",
        });
      }
    }
    expect((await api(page, "/settings/groups/tax")).data.value.luts).toEqual(luts);
  });

  test("Reports › GST exports: the 3B held row (07-ZD line 7) and the panel's line (line 8), positive amounts", async ({
    page,
  }) => {
    for (const v of VIEWS) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await registerAnswer(page);
      await view(page, v);
      await page.goto("/reports/gst");
      await settled(page);
      await page.getByRole("button", { name: "Make files" }).click();
      await expect(page.locator("#gst-done")).toBeVisible();
      const held = page.locator(".ledger--3b .ledger__held");
      await expect(held.locator("th")).toHaveText(
        "Credit notes to registered clients not yet accepted in IMS (not deducted)",
      );
      // two held notes of ₹1,000.00 taxable and ₹90.00 CGST and SGST each: positive, never "-"
      await expect(held.locator("td")).toHaveText(["₹2,000.00", "₹0.00", "₹180.00", "₹180.00"]);
      await expect(page.locator("#gst-3b-held-line")).toHaveText(
        "2 credit notes aren't deducted until your client accepts them in IMS. Check the GST portal's GSTR-3B figures before you file.",
      );
      await expect(page.getByRole("list", { name: /credit notes aren't deducted/ }).locator("li")).toHaveText(
        ["TH/CN/2627/0001", "TH/CN/2627/0003"],
      );
      await axe(page, `/reports/gst ${v.width} ${v.theme}`);
      await shot(page, "gst-3b-held-SIMULATED", v, ".report-block[data-block='gst-3b']");
    }
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("Reports › Sales register: with the 3B file on offer (a whole quarter), the same line 8", async ({
    page,
  }) => {
    for (const v of VIEWS) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await registerAnswer(page);
      await view(page, v);
      await page.goto("/reports/sales-register");
      await settled(page);
      await page.locator("#sales-from").fill("01/07/2026");
      await page.locator("#sales-to").fill("30/09/2026");
      await page.getByRole("button", { name: "Show" }).click();
      await expect(page.locator("#sales-3b-held-line")).toHaveText(
        "2 credit notes aren't deducted until your client accepts them in IMS. Check the GST portal's GSTR-3B figures before you file.",
      );
      await axe(page, `/reports/sales-register ${v.width} ${v.theme}`);
      await shot(page, "sales-3b-held-SIMULATED", v, ".report-results");
    }
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("rt1 review 2 and 3: the Settings rows and the notes ledger are laid out by their own width (768, 1024, 1280, 1920)", async ({
    page,
  }) => {
    await page.goto("/");
    const inv = (await invoices(page)).find(
      (r) => r.type === "tax_invoice" && r.status !== "void" && r.status !== "draft",
    );
    expect(inv, "the sample data has an issued tax invoice").toBeTruthy();
    const href = `/invoices/${encodeURIComponent(inv?.id)}`;
    const rem = 16;
    for (const v of LAYOUT_VIEWS) {
      await view(page, v);
      for (const route of SETTINGS_ROW_PAGES) {
        await page.goto(route);
        await settled(page);
        const rows = await page.locator(".settings-rows .setting").evaluateAll((els) =>
          els.map((el) => {
            const t = el.querySelector(".setting__text")?.getBoundingClientRect();
            const c = el.querySelector(".setting__control")?.getBoundingClientRect();
            // the container's content box, as the container query measures it
            const l = el.closest(".settings-rows");
            const cs = l ? getComputedStyle(l) : null;
            return {
              label: el.querySelector(".setting__label")?.textContent ?? "",
              words: t?.width ?? 0,
              list: l && cs ? l.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : 0,
              // side by side when the control starts to the right of the words, on the same line
              beside: !!t && !!c && c.left >= t.right && c.top < t.bottom,
            };
          }),
        );
        expect(rows.length, `${route} has settings rows`).toBeGreaterThan(0);
        for (const r of rows) {
          // the words never get a column narrower than 16rem (a hint of 30 or so characters a line), side by side or stacked
          expect(r.words, `${route} ${v.width} "${r.label}" words`).toBeGreaterThanOrEqual(16 * rem - 1);
          // side by side only in a list of at least 40rem (shell.css `@container setting-rows`)
          expect(r.beside, `${route} ${v.width} "${r.label}" in a ${Math.round(r.list)} px list`).toBe(
            r.list >= 40 * rem,
          );
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
          `${route} ${v.width}: no sideways scroll`,
        ).toBe(true);
        await axe(page, `${route} ${v.width} ${v.theme}`);
        await shot(page, `settings-rows${route.replace("/settings/", "-")}`, v, ".settings-rows");
      }
      // The notes ledger: no part of an issued note's row lies over another (the review saw the type and date under the amount at 768).
      await page.goto(href);
      await settled(page);
      const overlaps = await page.locator(".notes-row:not(.notes-row--draft)").evaluateAll((els) =>
        els.flatMap((row) => {
          const parts = [...row.children].map((c) => ({ name: c.className, r: c.getBoundingClientRect() }));
          const out: string[] = [];
          for (const [i, a] of parts.entries())
            for (const b of parts.slice(i + 1)) {
              const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
              const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
              if (x > 1 && y > 1) out.push(`${a.name} over ${b.name}`);
            }
          // and the type's words keep their own width (the date under them at most)
          const what = row.querySelector(".notes-row__type")?.getBoundingClientRect();
          if (what && what.width < 40) out.push(`type ${what.width} px`);
          return out;
        }),
      );
      expect(
        await page.locator(".notes-row:not(.notes-row--draft)").count(),
        "an issued note",
      ).toBeGreaterThan(0);
      expect(overlaps, `${href} ${v.width}`).toEqual([]);
      await axe(page, `${href} notes ${v.width} ${v.theme}`);
      await shot(page, "notes-ledger", v, ".notes-panel");
    }
  });

  test("rt1 review 3: the export invoice draft's note switch is a settings row laid out by its panel's width", async ({
    page,
  }) => {
    await page.goto("/");
    const exp = (await invoices(page)).find((r) => r.type === "export_invoice" && r.status !== "void");
    expect(exp?.clientId, "the sample data has an export invoice").toBeTruthy();
    const cat = await api(page, "/catalogue");
    const services = (cat.data.items as J[])
      .filter((i) => i.active !== false && i.priceInrMinor && i.priceUsdMinor)
      .slice(0, 1)
      .map((i) => ({ catalogueItemId: i.id }));
    const made = await api(page, "/invoices", { body: { clientId: exp?.clientId, services } });
    expect(made.status, "an export draft").toBe(201);
    const id = made.data.id as string;
    try {
      for (const v of LAYOUT_VIEWS) {
        await view(page, v);
        await page.goto(`/invoices/${encodeURIComponent(id)}`);
        await settled(page);
        await expect(page.locator(".inv-export")).toBeVisible();
        const row = page.locator(".inv-export .setting");
        if (await row.count()) {
          const g = await row.evaluate((el) => {
            const t = el.querySelector(".setting__text")?.getBoundingClientRect();
            const c = el.querySelector(".setting__control")?.getBoundingClientRect();
            // the container's content box, as the container query measures it
            const p = el.closest(".inv-export");
            const cs = p ? getComputedStyle(p) : null;
            return {
              words: t?.width ?? 0,
              panel: p && cs ? p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : 0,
              beside: !!t && !!c && c.left >= t.right && c.top < t.bottom,
            };
          });
          expect(g.words, `${v.width}: the note's words`).toBeGreaterThanOrEqual(16 * 16 - 1);
          expect(g.beside, `${v.width}: in a ${Math.round(g.panel)} px panel`).toBe(g.panel >= 40 * 16);
        }
        await axe(page, `export draft ${v.width} ${v.theme}`);
        await shot(page, "export-draft-panel", v, ".inv-export");
      }
    } finally {
      const d = await api(page, `/invoices/${encodeURIComponent(id)}`);
      await api(page, `/invoices/${encodeURIComponent(id)}?expectedUpdatedAt=${d.data.updatedAt}`, {
        method: "DELETE",
      });
    }
  });
});

/**
 * The register of the last complete quarter (Jul to Sep 2026), answered in the browser with fake rows: an invoice to "Sample client A (fake)" and three
 * credit notes against it, IMS pending, accepted and not answered. `/auth/me` reports a fresh step-up, so "Make files" asks no code.
 */
async function registerAnswer(page: Page) {
  await page.route(
    (u) => u.pathname === "/api/v1/auth/me",
    async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as J;
      await route.fulfill({ response: res, json: { ...body, stepUpUntil: Date.now() + 10 * 60_000 } });
    },
  );
  const recipient = {
    status: "registered",
    gstin: "19ABCDE1234F1ZX",
    name: "Sample client A (fake)",
    address: "1 Sample Road, Kolkata",
    stateCode: "19",
    countryCode: "IN",
  };
  const base = {
    voided: false,
    currency: "INR",
    roundOffInrMinor: 0,
    fxRateMicros: null,
    supplyType: "intra",
    placeOfSupplyCode: "19",
    reverseCharge: false,
    recipient,
    purposeCode: null,
    fy: "2627",
    clientId: "c-sample",
    clientCode: "C001",
  };
  const inv = {
    ...base,
    id: "d-sample-1",
    number: "TH/INV/2627/0001",
    kind: "tax_invoice",
    series: "invoice",
    seq: 1,
    issueDate: { year: 2026, month: 7, day: 5 },
    totalMinor: 11_800_00,
    totalInrMinor: 11_800_00,
    outstandingMinor: 11_800_00,
    rates: [
      {
        sac: "998314",
        rateBp: 1800,
        taxableMinor: 10_000_00,
        igstMinor: 0,
        cgstMinor: 900_00,
        sgstMinor: 900_00,
      },
    ],
    noteOf: null,
    imsStatus: null,
  };
  const credit = (n: number, imsStatus: string | null) => ({
    ...base,
    id: `n-sample-${n}`,
    number: `TH/CN/2627/000${n}`,
    kind: "credit_note",
    series: "creditNote",
    seq: n,
    issueDate: { year: 2026, month: 8, day: n + 2 },
    totalMinor: 1_180_00,
    totalInrMinor: 1_180_00,
    outstandingMinor: 0,
    rates: [
      {
        sac: "998314",
        rateBp: 1800,
        taxableMinor: 1_000_00,
        igstMinor: 0,
        cgstMinor: 90_00,
        sgstMinor: 90_00,
      },
    ],
    noteOf: {
      number: "TH/INV/2627/0001",
      issueDate: { year: 2026, month: 7, day: 5 },
      supplyType: "intra",
      recipientStatus: "registered",
      placeOfSupplyCode: "19",
      totalInrMinor: 11_800_00,
    },
    imsStatus,
  });
  await page.route(
    (u) => u.pathname === "/api/v1/reports/registers",
    (route) =>
      route.fulfill({
        json: {
          rows: [inv, credit(1, "pending"), credit(2, "accepted"), credit(3, null)],
          meta: {
            today: { year: 2026, month: 10, day: 31 },
            supplierStateCode: "19",
            b2clThresholdInrMinor: 1_00_000_00,
            realisation: { warnMonths: 9, inrMonths: 12, escalateMonths: 12, escalateExtraDays: 15 },
          },
          next: null,
        },
      }),
  );
}
