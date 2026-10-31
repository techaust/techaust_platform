// rt2 (T4, T10; ADM-SET-01, ADM-INV-06, ADM-INV-07): the screens of the signature rule and the Udyam number, against the admin's own dev server and the local
// database (run with E2E_SAMPLE=1 so the sample company, clients and invoices exist; see playwright.config.ts). Signed in as global-setup's throwaway Owner.
//   - Settings › Company: the Udyam number and category through FormField (07-ZC lines 4 and 5), the error on leaving the field, the save (the key is always
//     sent: L8), the signature hint (line 2); keyboard order and visible focus. Typing inside a filled Udyam number or GSTIN keeps the caret (kept as
//     typed, shown in capitals, stored in capitals on leaving: second review 2); the category waits for a number and never makes the form dirty alone (4).
//   - Settings › Tax: the signatory switch's added line (line 3), in the switch's accessible description.
//   - With no signature saved: a draft debit note lists `signature_missing` (line 1) with "Settings › Company" as a link; its note dialog and the advance
//     dialog of an issued proforma are refused by the server with the same line and link, in a `role="alert"` box that takes the focus (visual review 1).
//   - The saved full number fits its field at every width, and at 1024 with the side menu open or closed (visual review 2); a field reached by Tab
//     stops clear of the "Unsaved changes" bar (visual review 3).
// axe (WCAG 2.2 AA) on every state, both in-app themes against the opposite OS theme, at 1280 and 390 px; no console errors. With RT2_SHOTS=<absolute folder>
// each state is also saved as a screenshot (for the designer's review; never committed). Sample data only; the signature is put back at the end.
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { ORIGIN } from "../playwright.config.ts";
import { sampleSignaturePng, totpAt } from "./sample-data.ts";

const FAILING = new Set(["moderate", "serious", "critical"]);
const THEMES = ["light", "dark"] as const;
// RT2_ALL_WIDTHS=1 runs every state at the five review widths (the visual review); by default the two ends
const WIDTHS = process.env.RT2_ALL_WIDTHS ? [390, 768, 1024, 1280, 1920] : [1280, 390];
const SHOTS = process.env.RT2_SHOTS;
const LINE1 =
  "Add the signature in Settings › Company. Credit notes, debit notes and invoices for a payment received always carry it.";
const LINE2 = `Credit notes, debit notes and invoices for a payment received always carry the signature. Other invoices you send electronically don't need one (GST Rule 46). If you add one, it prints above "Authorised signatory".`;
const LINE3 = "This switch covers tax invoices, export invoices and proformas only.";
const ERROR = "Enter the number as UDYAM-XX-00-0000000.";

/** The API's CSRF check compares the Origin of every write with the admin's own (as the browser sends it). */
const headers = { Origin: ORIGIN };

// biome-ignore lint/suspicious/noExplicitAny: API answers are read loosely here, as in the Worker tests
type J = Record<string, any>;

const secret = () =>
  Buffer.from(readFileSync(new URL("../.e2e/owner-totp.hex", import.meta.url), "utf8"), "hex");

/**
 * A step-up for this session, unless one is still good for two minutes (`/auth/me`). The codes' replay guard refuses a step already used, so a refused
 * code waits for the next 30-second step (one try per step, never a burst of wrong codes).
 */
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

async function api(page: Page, method: "GET" | "PUT" | "POST" | "DELETE", path: string, data?: unknown) {
  const res = await page.request.fetch(`/api/v1${path}`, {
    method,
    headers,
    ...(data === undefined ? {} : { data }),
  });
  const body = (await res.json().catch(() => ({}))) as J;
  return { status: res.status(), body };
}

/** The company's Udyam block as stored (the form's PUT is the SPA's; this one puts the start state back). */
async function putUdyam(page: Page, udyam: J | null) {
  const c = await api(page, "GET", "/settings/groups/company");
  expect(c.status).toBe(200);
  const r = await api(page, "PUT", "/settings/groups/company", {
    version: c.body.version,
    value: { ...c.body.value, udyam },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton, [aria-busy='true']")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

async function axe(page: Page, where: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const bad = results.violations
    .filter((v) => FAILING.has(v.impact ?? ""))
    .map((v) => `${where}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(bad, bad.join("\n")).toEqual([]);
}

/**
 * A dialog the server refused: its refusal box is a live region (`role="alert"`) and holds the focus, which is inside the open dialog, never on
 * `<body>` (WCAG 2.4.3, 4.1.3); the signature's line is in it.
 */
async function refusalHasFocus(page: Page, line: string) {
  const box = page.getByRole("dialog").locator(".inv-issue__blocked");
  await expect(box).toHaveAttribute("role", "alert");
  await expect(box).toBeFocused();
  const where = await page.evaluate(() => {
    const a = document.activeElement;
    return { body: a === document.body, inDialog: a?.closest("dialog[open]") != null };
  });
  expect(where).toEqual({ body: false, inDialog: true });
  await expect(box.locator(".blockers__item", { hasText: "Add the signature in" })).toHaveText(line);
  // the keyboard press that issued it leaves the ring on the box (focus-visible), so a sighted keyboard user sees where focus went
  expect(await box.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
}

/** The Settings pages whose form shows the "Unsaved changes" bar (SaveBar through `GroupForm`, and Gateways). */
const BAR_PAGES = ["company", "tax", "payment-terms", "gateways", "email", "retention", "flags"] as const;
const FIELD =
  "input:not([readonly]):not([disabled]):not([type=hidden]):not([type=file]), select:not([disabled]), textarea:not([readonly]):not([disabled])";

/**
 * One change to the form's first field that can change, so the bar appears (never saved: the test discards it). False when nothing can: Gateways
 * locally, whose only fields are the test/live radios with live locked (`PAYMENTS_LIVE_ALLOWED=false`).
 */
async function makeDirty(page: Page): Promise<boolean> {
  const fields = page.locator("main form").first().locator(FIELD);
  const count = await fields.count();
  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    const kind = await field.evaluate((el) =>
      el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
    );
    if (kind === "checkbox") await field.setChecked(!(await field.isChecked()), { force: true });
    else if (kind === "radio") {
      // a radio changes only by picking another of its group
      const other = page.locator(
        `main form input[type=radio][name="${await field.getAttribute("name")}"]:not(:checked):not([disabled])`,
      );
      if ((await other.count()) === 0) continue;
      await other.first().check({ force: true });
    } else if (kind === "select") {
      const at = await field.evaluate((el: HTMLSelectElement) =>
        el.options.length > 1 ? el.selectedIndex : -1,
      );
      if (at < 0) continue;
      await field.selectOption({ index: at === 0 ? 1 : 0 });
    } else {
      await field.focus();
      await page.keyboard.press("End");
      await page.keyboard.type("1");
    }
    return true;
  }
  return false;
}

/** The saved full number is shown whole in its field: nothing scrolled out of the box (rt2 visual review 2). */
async function expectNumberFits(page: Page, where: string) {
  const number = page.getByLabel("Udyam registration number");
  await expect(number).toHaveValue("UDYAM-WB-00-0000001");
  const m = await number.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(
    m.scroll,
    `${where}: the number's text (${m.scroll}px) within its field (${m.client}px)`,
  ).toBeLessThanOrEqual(m.client);
}

async function shot(page: Page, name: string, fullPage = true) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

/** Each width and theme in turn: the in-app theme against the opposite OS theme (the app's choice must win), reduced motion. */
async function each(page: Page, run: (tag: string) => Promise<void>) {
  for (const width of WIDTHS)
    for (const theme of THEMES) {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((t) => localStorage.setItem("ta-admin-theme", t), theme);
      await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light", reducedMotion: "reduce" });
      await run(`${width}-${theme}`);
    }
}

test.describe("rt2: the signature rule and the Udyam number on screen", () => {
  test.describe.configure({ mode: "serial", timeout: 5 * 60_000 });
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    page.on("console", (m) => {
      // Chromium logs every non-2xx answer as a console error: the advance dialog's 409 `issue_blocked` is the refusal this spec provokes on purpose
      if (m.type() !== "error" || m.text().includes("responded with a status of 409 (Conflict)")) return;
      consoleErrors.push(`${page.url()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`${page.url()}: ${e.message}`));
    await page.goto("/");
    await stepUp(page);
  });

  test("Settings › Company: the Udyam fields, empty, refused and saved [ADM-SET-01]", async ({ page }) => {
    await putUdyam(page, null);
    await each(page, async (tag) => {
      await page.goto("/settings/company");
      await settled(page);
      const number = page.getByLabel("Udyam registration number");
      const category = page.getByLabel("Enterprise category");
      await expect(number).toHaveValue("");
      await expect(page.getByText("Printed on tax invoices. Leave it empty to leave it off.")).toBeVisible();
      await expect(category).toHaveValue("micro");
      // with no number the category waits for one (second review 4): it can't change, so it can't make the form dirty
      await expect(category).toBeDisabled();
      await expect(category.locator("option")).toHaveText([
        "Micro enterprise",
        "Small enterprise",
        "Medium enterprise",
      ]);
      await expect(page.getByText(LINE2)).toBeVisible();
      await axe(page, `company empty ${tag}`);
      await number.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shot(page, `company-empty-${tag}`);

      // typed in lower case with spaces, one digit short: kept as typed (shown in capitals), trimmed and upper-cased once the field is left, and refused
      await number.fill(" udyam-wb-00-000001 ");
      await expect(number).toHaveValue(" udyam-wb-00-000001 ");
      await expect(number).toHaveCSS("text-transform", "uppercase");
      await expect(category).toBeEnabled();
      await expect(page.getByText(ERROR)).toHaveCount(0);
      await category.focus();
      await expect(number).toHaveValue("UDYAM-WB-00-000001");
      await expect(page.getByText(ERROR)).toBeVisible();
      await expect(number).toHaveAttribute("aria-invalid", "true");
      expect(await number.getAttribute("aria-describedby")).toContain("f-udyam-number-error");
      await axe(page, `company error ${tag}`);
      await number.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shot(page, `company-error-${tag}`, false);
      // emptied again: no error (an empty number leaves the line off)
      await number.fill("");
      await number.blur();
      await expect(page.getByText(ERROR)).toHaveCount(0);
      await expect(category).toBeDisabled();
      // (the form is back to what was saved, so there is nothing to discard: the bar has gone)
      await expect(page.getByRole("button", { name: "Discard" })).toHaveCount(0);
    });

    // the save: what the form sends is the block (L8), stored in canonical form with the category picked
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings/company");
    await settled(page);
    await page.getByLabel("Udyam registration number").fill("udyam-wb-00-0000001");
    await page.getByLabel("Enterprise category").selectOption("small");
    const put = page.waitForRequest(
      (r) => r.method() === "PUT" && r.url().endsWith("/api/v1/settings/groups/company"),
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    const sent = (await put).postDataJSON() as J;
    expect(sent.value.udyam).toEqual({ number: "UDYAM-WB-00-0000001", category: "small" });
    await expect(page.getByText("Company profile saved. New documents use it from now on.")).toBeVisible();
    const stored = await api(page, "GET", "/settings/groups/company");
    expect(stored.body.value.udyam).toEqual({ number: "UDYAM-WB-00-0000001", category: "small" });

    await each(page, async (tag) => {
      await page.goto("/settings/company");
      await settled(page);
      await expect(page.getByLabel("Udyam registration number")).toHaveValue("UDYAM-WB-00-0000001");
      await expect(page.getByLabel("Enterprise category")).toHaveValue("small");
      await expectNumberFits(page, tag);
      await axe(page, `company filled ${tag}`);
      await page
        .getByLabel("Udyam registration number")
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shot(page, `company-filled-${tag}`);
    });

    // rt2 visual review 2: at 1024 with the side menu open (the narrowest the two-column form gets), and with it closed, the full number shows whole
    await page.setViewportSize({ width: 1024, height: 900 });
    for (const nav of ["expanded", "collapsed"]) {
      await page.addInitScript((v) => localStorage.setItem("ta-admin-nav", v), nav);
      await page.goto("/settings/company");
      await settled(page);
      await expectNumberFits(page, `1024 menu ${nav}`);
    }
    await page.addInitScript(() => localStorage.removeItem("ta-admin-nav"));

    // cleared and saved: the key is sent as null, so the number is gone (L8)
    await page.goto("/settings/company");
    await settled(page);
    await page.getByLabel("Udyam registration number").fill("");
    const put2 = page.waitForRequest(
      (r) => r.method() === "PUT" && r.url().endsWith("/api/v1/settings/groups/company"),
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    expect(((await put2).postDataJSON() as J).value.udyam).toBeNull();
    await expect(page.getByText("Company profile saved. New documents use it from now on.")).toBeVisible();
    expect((await api(page, "GET", "/settings/groups/company")).body.value.udyam ?? null).toBeNull();
  });

  test("Settings › Company: typing inside a filled number keeps the caret, and leaving the field stores capitals [ADM-SET-01]", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings/company");
    await settled(page);
    const caret = (el: HTMLInputElement) => [el.selectionStart, el.selectionEnd];

    // the Udyam number, its state letters missing: two lower-case letters typed in the middle (second review 2: the caret used to jump to the end)
    const number = page.getByLabel("Udyam registration number");
    await number.fill("UDYAM--00-0000001");
    await number.press("Home");
    for (let i = 0; i < 6; i++) await number.press("ArrowRight");
    await number.pressSequentially("wb");
    expect(await number.evaluate(caret)).toEqual([8, 8]);
    await expect(number).toHaveValue("UDYAM-wb-00-0000001");
    await number.pressSequentially("x");
    expect(await number.evaluate(caret)).toEqual([9, 9]);
    await number.press("Backspace");
    await number.blur();
    await expect(number).toHaveValue("UDYAM-WB-00-0000001");
    await expect(page.getByText(ERROR)).toHaveCount(0);
    // a category change, then the number cleared: nothing would be saved, so nothing is unsaved (second review 4)
    await page.getByLabel("Enterprise category").selectOption("medium");
    await number.fill("");
    await number.blur();
    await expect(page.getByLabel("Enterprise category")).toBeDisabled();
    await expect(page.locator(".savebar")).toHaveCount(0);

    // the GSTIN: its PAN letters retyped in lower case over a selection keep the caret after them; leaving the field gives the saved GSTIN back
    const gstin = page.getByLabel("GSTIN");
    const saved = await gstin.inputValue();
    await gstin.press("Home");
    for (let i = 0; i < 2; i++) await gstin.press("ArrowRight");
    for (let i = 0; i < 5; i++) await gstin.press("Shift+ArrowRight");
    await gstin.pressSequentially(saved.slice(2, 7).toLowerCase());
    expect(await gstin.evaluate(caret)).toEqual([7, 7]);
    await expect(gstin).toHaveValue(saved.slice(0, 2) + saved.slice(2, 7).toLowerCase() + saved.slice(7));
    await expect(page.locator(".field--gstin").first().getByText("Valid", { exact: true })).toBeVisible();
    await gstin.blur();
    await expect(gstin).toHaveValue(saved);
    await expect(page.locator(".savebar")).toHaveCount(0);
  });

  test("Settings › Company: keyboard order and visible focus through the Udyam fields", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings/company");
    await settled(page);
    // with no number the category is skipped (disabled); with one it is the next stop
    await page.getByLabel("State and code").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("f-udyam-category");
    await page.getByLabel("Udyam registration number").fill("UDYAM-WB-00-0000001");
    await page.getByLabel("State and code").focus();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const s = getComputedStyle(el);
        return { id: el.id, ring: s.outlineStyle !== "none" || s.boxShadow !== "none" };
      });
      seen.push(f.id);
      expect(f.ring, `visible focus on #${f.id}`).toBe(true);
    }
    expect(seen.slice(0, 2)).toEqual(["f-udyam-number", "f-udyam-category"]);
    await page.getByRole("button", { name: "Discard" }).click();
  });

  test("Settings: a field reached by Tab stops clear of the Unsaved changes bar, on every page that has it", async ({
    page,
  }) => {
    for (const [width, height] of [
      [1280, 900],
      [768, 1024],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const slug of BAR_PAGES) {
        await page.goto(`/settings/${slug}`);
        await settled(page);
        if (!(await makeDirty(page))) {
          expect(slug, "only Gateways has nothing to change locally").toBe("gateways");
          continue;
        }
        await expect(page.locator(".savebar")).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator("main form").first().locator(FIELD).first().focus();
        const under: string[] = [];
        for (let i = 0; i < 200; i++) {
          await page.keyboard.press("Tab");
          // two frames: the browser's own scroll, then the bar's (SaveBar measures after a frame)
          const r = await page.evaluate(async () => {
            await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
            const a = document.activeElement as HTMLElement | null;
            const bar = document.querySelector(".savebar");
            if (!a || !bar || bar.contains(a)) return null;
            const box = a.getBoundingClientRect();
            const label = `#${a.id || a.getAttribute("name") || a.tagName.toLowerCase()}`;
            return {
              label,
              bottom: Math.round(box.bottom),
              barTop: Math.round(bar.getBoundingClientRect().top),
              sized: box.height > 0,
            };
          });
          if (r === null) break; // the bar's own buttons come last: every field of the form was passed
          if (r.sized && r.bottom > r.barTop)
            under.push(`${r.label} ends at ${r.bottom}px, the bar starts at ${r.barTop}px`);
        }
        expect(under, `/settings/${slug} at ${width}: ${under.join("; ")}`).toEqual([]);
        await page.getByRole("button", { name: "Discard" }).click();
        await expect(page.locator(".savebar")).toHaveCount(0);
      }
    }
  });

  test("Settings › Tax: the signatory switch says which documents it covers [ADM-INV-06]", async ({
    page,
  }) => {
    await each(page, async (tag) => {
      await page.goto("/settings/tax");
      await settled(page);
      const sw = page.locator("#f-checklist-signatory");
      await expect(sw).toHaveAccessibleDescription(`House rule ${LINE3}`);
      await expect(page.getByText(LINE3)).toBeVisible();
      await axe(page, `tax ${tag}`);
      await sw.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shot(page, `tax-signatory-${tag}`, false);
    });
  });

  test("no signature saved: the note's blocker and the advance dialog's refusal link to Settings › Company [ADM-INV-06, ADM-INV-07]", async ({
    page,
  }) => {
    const list = await api(page, "GET", "/invoices");
    const invoices = (list.body.invoices ?? []) as J[];
    const debit = invoices.find((i) => i.type === "debit_note" && i.status === "draft");
    expect(debit, "the sample data's draft debit note").toBeTruthy();
    const taxInvoice = invoices.find(
      (i) => i.type === "tax_invoice" && i.status !== "void" && i.status !== "draft",
    );
    expect(taxInvoice, "an issued tax invoice of the sample data").toBeTruthy();

    // an issued proforma for the INR client (sample), made the way the SPA makes it
    const cat = await api(page, "GET", "/catalogue");
    const items = (cat.body.items as J[]).filter((i) => i.active !== false && i.priceInrMinor);
    const draft = await api(page, "POST", "/invoices", {
      clientId: taxInvoice?.clientId,
      kind: "proforma",
      services: [{ catalogueItemId: items[0]?.id }],
    });
    expect([200, 201], JSON.stringify(draft.body)).toContain(draft.status);
    const pf = await api(page, "GET", `/invoices/${draft.body.id}`);
    const issued = await api(page, "POST", `/invoices/${draft.body.id}/issue`, {
      expectedUpdatedAt: pf.body.updatedAt,
      expectedContentSha256: pf.body.contentSha256,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);

    expect((await api(page, "DELETE", "/settings/signature")).status).toBe(200);
    try {
      await each(page, async (tag) => {
        // the draft debit note: its blockers, the signature's first, with the place as a link
        await page.goto(`/invoices/${encodeURIComponent(debit?.id)}`);
        await settled(page);
        const item = page.locator(".blockers__item", { hasText: "Add the signature in" });
        await expect(item).toHaveText(LINE1);
        const link = item.getByRole("link", { name: "Settings › Company" });
        await expect(link).toHaveAttribute("href", "/settings/company");
        await link.focus();
        await expect(link).toBeFocused();
        await axe(page, `debit draft ${tag}`);
        await item.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await shot(page, `note-blocker-${tag}`, false);

        // the note dialog, by keyboard: the server refuses the issue; the refusal box is announced (role alert) and takes the focus, inside the dialog
        // (rt2 visual review 1: focus fell to <body> once the pressed button was disabled)
        await page.getByRole("button", { name: "Issue debit note" }).press("Enter");
        const noteDialog = page.getByRole("dialog");
        await noteDialog.getByRole("button", { name: "Issue debit note" }).press("Enter");
        await expect(noteDialog.locator(".note-final")).toBeVisible();
        await noteDialog.getByRole("button", { name: "Issue debit note" }).press("Enter");
        await refusalHasFocus(page, LINE1);
        await axe(page, `note dialog refused ${tag}`);
        await shot(page, `note-dialog-refused-${tag}`, false);
        await page.keyboard.press("Escape");
        await expect(noteDialog).toHaveCount(0);

        // the proforma's advance dialog: refused by the server with the same line and link; the same focus and role
        await page.goto(`/invoices/${encodeURIComponent(draft.body.id)}`);
        await settled(page);
        await page.getByRole("button", { name: "Issue tax invoice for payment received" }).first().click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Amount received").fill("100");
        await dialog.getByLabel("Payment reference").fill("SAMPLE-UTR-0001");
        await dialog.getByRole("button", { name: "Issue tax invoice for payment received" }).press("Enter");
        await refusalHasFocus(page, LINE1);
        const refused = dialog.locator(".blockers__item", { hasText: "Add the signature in" });
        await expect(refused.getByRole("link", { name: "Settings › Company" })).toHaveAttribute(
          "href",
          "/settings/company",
        );
        await axe(page, `advance refused ${tag}`);
        await shot(page, `advance-blocker-${tag}`, false);
        await page.keyboard.press("Escape");
      });
    } finally {
      // the sample signature back, so the sample data stays issuable
      const res = await page.request.put("/api/v1/settings/signature", {
        data: Buffer.from(sampleSignaturePng()),
        headers: { ...headers, "Content-Type": "application/octet-stream" },
      });
      expect(res.status()).toBe(200);
    }
  });

  test("no console errors on these screens", () => {
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });
});
