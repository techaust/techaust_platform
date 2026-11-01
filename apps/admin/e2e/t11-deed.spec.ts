// T11 in the browser [ADM-PRJ-04; RB-38(a)]: the project's Deed tab in every state, axe (WCAG 2.2 AA) on each, both themes (the in-app theme against the
// opposite OS theme), a desktop and a phone width, the keyboard order of the draft's form, and no console error. Signed in as global-setup's Owner on the
// LOCAL database with E2E_SAMPLE=1's sample project (e2e/sample-data.ts).
//   - "waiting" is the server's own answer for the sample project (active, not started from an accepted proposal): REAL.
//   - Every other state is the deed API's answer in the browser (shots named SIMULATED): a project that is completed and paid in full needs an accepted
//     proposal, issued invoices and confirmed payments the sample data doesn't have. The answers are in the shape of apps/admin/worker/deeds.ts `deedView`, the
//     deed's text is core `deedText` over a made-up snapshot (sample names, numbers and amounts only), and the writes are answered here too (nothing is saved).
// Screenshots only when T11_SHOTS names a folder (absolute path); the checks run either way. Run through the queue:
//   E2E_SAMPLE=1 T11_SHOTS=<abs dir> bash tools/heavy.sh --log t11-e2e pnpm --filter @techaust/admin exec playwright test e2e/t11-deed.spec.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";
import { type DeedSnapshot, deedText } from "@techaust/core/deeds";

const FAILING = new Set(["moderate", "serious", "critical"]);
const SHOTS = process.env.T11_SHOTS ?? "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
type View = { readonly width: number; readonly theme: "light" | "dark" };
const VIEWS: readonly View[] = [
  { width: 1280, theme: "light" },
  { width: 1280, theme: "dark" },
  { width: 390, theme: "light" },
  { width: 390, theme: "dark" },
];
// biome-ignore lint/suspicious/noExplicitAny: API answers are read loosely here, as in the other specs
type J = Record<string, any>;

async function settled(page: Page) {
  // Not "networkidle": on this loaded PC the dev server's background requests sometimes kept it from ever settling (two 10-minute timeouts).
  await expect(page.locator(".deed-head")).toBeVisible({ timeout: 60_000 });
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
  await page.addInitScript((t) => localStorage.setItem("ta-admin-theme", t), v.theme);
  await page.emulateMedia({ colorScheme: v.theme === "light" ? "dark" : "light", reducedMotion: "reduce" });
}

async function shot(page: Page, name: string, v: View) {
  if (!SHOTS) return;
  await page.screenshot({
    path: join(SHOTS, `${name}-${v.width}-${v.theme}.png`),
    fullPage: true,
    animations: "disabled",
    // A page taller than the window is stitched from several scrolls: the sticky shell and side column would be drawn mid-page, so they aren't sticky for it.
    style: ".topbar, .shell__rail > .rail, .lead-page__side { position: static !important; }",
  });
}

// ---- the simulated answers (sample data only) -------------------------------------------------------------------------------------------------------------

const SNAPSHOT: DeedSnapshot = {
  layout: "deed-v1",
  madeOn: "2026-11-02",
  supplier: {
    address: "12 Sample Road, Balurghat, Dakshin Dinajpur, West Bengal 733101",
    gstin: "19ABCDE1234F1Z5",
  },
  client: {
    legalName: "Sample client A (fake) Private Limited",
    address: "4 Sample Street, Salt Lake, Kolkata, West Bengal, 700091, India",
    reg: "19AAACS1234A1Z2",
  },
  offer: { docType: "proposal", number: "TH/PRP/2627/0004", version: 2, acceptedOn: "2026-08-05" },
  payment: {
    invoiceNumbers: ["TH/INV/2627/0009", "TH/INV/2627/0014"],
    amountPaidMinor: 29_500_000,
    currency: "INR",
  },
  schedule1: {
    deliverables: "Website source code\nDesign files\nDeployment notes",
    location: "Private Git repository handed over on 28 Oct 2026",
    deliveredDates: "14 Oct 2026, 28 Oct 2026",
  },
  schedule2: { tools: "None", thirdParty: "Astro (MIT licence)\nTailwind CSS (MIT licence)" },
};
const SCHEDULES = {
  deliverables: SNAPSHOT.schedule1.deliverables,
  location: SNAPSHOT.schedule1.location,
  deliveredDates: SNAPSHOT.schedule1.deliveredDates,
  tools: SNAPSHOT.schedule2.tools,
  thirdParty: SNAPSHOT.schedule2.thirdParty,
};
const BLANK = { deliverables: null, location: null, deliveredDates: null, tools: null, thirdParty: null };
const NOW = Date.UTC(2026, 10, 2, 6, 0);
const ELIGIBLE = {
  eligible: true,
  blockers: [],
  settledMinor: 29_500_000,
  acceptedTotalMinor: 31_000_000,
  creditedMinor: 1_500_000,
  targetMinor: 29_500_000,
  shortfallMinor: 0,
  currency: "INR",
};
const DOCS = [
  {
    id: "sample-inv-9",
    number: "TH/INV/2627/0009",
    type: "tax_invoice",
    currency: "INR",
    counted: true,
    totalMinor: 11_800_000,
    paidMinor: 11_800_000,
    tdsMinor: 0,
    creditedMinor: 0,
    balanceMinor: 0,
    settledMinor: 11_800_000,
  },
  {
    id: "sample-inv-14",
    number: "TH/INV/2627/0014",
    type: "tax_invoice",
    currency: "INR",
    counted: true,
    totalMinor: 19_200_000,
    paidMinor: 17_400_000,
    tdsMinor: 300_000,
    creditedMinor: 1_500_000,
    balanceMinor: 0,
    settledMinor: 17_700_000,
  },
];
const CAN = {
  editSchedules: false,
  finalise: false,
  uploadSigned: false,
  cancel: false,
  recheck: false,
  renderPdf: false,
};

function deed(o: J): J {
  return {
    id: "deed_sample",
    status: "draft",
    number: null,
    fy: null,
    madeOn: null,
    schedules: SCHEDULES,
    blankSchedules: [],
    preview: { ok: true },
    text: deedText(SNAPSHOT, ""),
    sealed: null,
    notFullyPaid: false,
    unsignedPdf: false,
    signed: null,
    finalisedAt: null,
    finalisedByName: null,
    cancelled: null,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW,
    ...o,
  };
}

function pageOf(projectId: string, o: J): J {
  return {
    project: { id: projectId, code: "PRJ-X0001", status: "completed", sourceDocumentId: "sample-proposal" },
    clientAnonymised: false,
    eligibility: ELIGIBLE,
    documents: DOCS,
    deed: null,
    history: [],
    can: CAN,
    ...o,
  };
}

const FINAL = {
  status: "final",
  number: "TH/DA/2627/0001",
  fy: "2627",
  madeOn: "2026-11-02",
  text: deedText(SNAPSHOT, "TH/DA/2627/0001"),
  preview: null,
  sealed: { ok: true, sha256: "3f9a6c1e8b2d47f0a5c9e1b3d7f2a4c6e8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8" },
  finalisedAt: NOW,
  finalisedByName: "Sample Owner",
};

const STATES: { name: string; page: (id: string) => J }[] = [
  {
    name: "qualifies",
    page: (id) => pageOf(id, { can: { ...CAN, recheck: true } }),
  },
  {
    name: "draft-blank",
    page: (id) =>
      pageOf(id, {
        deed: deed({
          schedules: BLANK,
          blankSchedules: ["deliverables", "location", "deliveredDates", "tools", "thirdParty"],
          preview: {
            ok: false,
            problems: ["schedules_blank"],
            blankFields: ["deliverables", "location", "deliveredDates", "tools", "thirdParty"],
          },
          text: null,
        }),
        can: { ...CAN, editSchedules: true, finalise: true, cancel: true },
      }),
  },
  {
    name: "draft-filled",
    page: (id) =>
      pageOf(id, { deed: deed({}), can: { ...CAN, editSchedules: true, finalise: true, cancel: true } }),
  },
  {
    name: "final-making",
    page: (id) => pageOf(id, { deed: deed(FINAL), can: { ...CAN, uploadSigned: true, renderPdf: true } }),
  },
  {
    name: "final-not-fully-paid",
    page: (id) =>
      pageOf(id, {
        eligibility: {
          ...ELIGIBLE,
          eligible: false,
          blockers: ["balance_due", "short_paid"],
          settledMinor: 26_500_000,
          shortfallMinor: 3_000_000,
        },
        deed: deed({ ...FINAL, unsignedPdf: true, notFullyPaid: true }),
        can: { ...CAN, uploadSigned: true },
      }),
  },
  {
    name: "signed",
    page: (id) =>
      pageOf(id, {
        deed: deed({
          ...FINAL,
          status: "signed",
          unsignedPdf: true,
          signed: {
            size: 245_812,
            sha256: "a".repeat(64),
            esignAt: NOW + 3_600_000,
            esignMoment: "02 Nov 2026, 12:30 IST",
            esignTxn: "SAMPLE-ESIGN-7F3K-29QD",
            signatureLine:
              "Signed by the assignor with an Aadhaar-based electronic signature (eSign): Rupak Sarkar, sole proprietor, TecHaust Technologies · 02 Nov 2026, 12:30 IST · SAMPLE-ESIGN-7F3K-29QD.",
            signedAt: NOW + 4_000_000,
            signedByName: "Sample Owner",
          },
        }),
      }),
  },
  {
    name: "cancelled",
    page: (id) =>
      pageOf(id, {
        deed: deed({
          status: "cancelled",
          cancelled: {
            at: NOW,
            byName: "Sample Owner",
            reason: "Schedules were for the wrong project (sample).",
          },
        }),
        history: [
          {
            id: "deed_c1",
            createdAt: NOW - 86_400_000,
            cancelledAt: NOW,
            cancelledByName: "Sample Owner",
            reason: "Schedules were for the wrong project (sample).",
          },
        ],
        can: { ...CAN, recheck: true },
      }),
  },
];

/** Answers the deed API in the browser with `answer` (GET) and an "ok" for every write. */
async function simulate(page: Page, answer: J) {
  await page.route(/\/api\/v1\/(projects\/[^/]+\/deed|deeds\/).*/, (route: Route) => {
    const r = route.request();
    if (r.method() === "GET" && /\/deed$/.test(new URL(r.url()).pathname))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
    if (/\/recheck$/.test(r.url()))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ created: false, ...answer }),
      });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, updatedAt: NOW + 1 }),
    });
  });
}

async function sampleProject(page: Page): Promise<string> {
  const res = await page.request.get("/api/v1/projects");
  expect(res.status()).toBe(200);
  const data = (await res.json()) as J;
  const p = (data.projects as J[]).find((x) => x.code === "PRJ-X0001") ?? (data.projects as J[])[0];
  expect(p, "the sample data has a project").toBeTruthy();
  return p.id as string;
}

test.describe("T11 deed tab", () => {
  test.describe.configure({ timeout: 4 * 60_000 });

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

  test("waiting: the server's own answer for the sample project (REAL)", async ({ page }) => {
    await page.goto("/");
    const id = await sampleProject(page);
    for (const v of VIEWS) {
      await view(page, v);
      await page.goto(`/projects/${id}?tab=deed`);
      await settled(page);
      await expect(page.getByRole("tab", { name: /Deed$/ })).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".deed-head")).toBeVisible();
      await expect(page.locator(".deed-rail__step--here")).toHaveCount(0);
      await axe(page, `waiting ${v.width} ${v.theme}`);
      await shot(page, "deed-waiting", v);
    }
  });

  for (const s of STATES)
    test(`${s.name} (SIMULATED)`, async ({ page }) => {
      await page.goto("/");
      const id = await sampleProject(page);
      await simulate(page, s.page(id));
      for (const v of VIEWS) {
        await view(page, v);
        await page.goto(`/projects/${id}?tab=deed`);
        await settled(page);
        if (s.name === "draft-filled" || s.name === "signed") {
          await page.locator(".deed-read__details").evaluate((d) => {
            (d as HTMLDetailsElement).open = true;
          });
          await expect(page.locator(".deed-sheet")).toBeVisible();
        }
        await axe(page, `${s.name} ${v.width} ${v.theme}`);
        await shot(page, `deed-${s.name}-SIMULATED`, v);
      }
    });

  test("draft: the keyboard order, None, save; Finalise and Cancel ask first (SIMULATED)", async ({
    page,
  }) => {
    await page.goto("/");
    const id = await sampleProject(page);
    const answer = STATES.find((s) => s.name === "draft-blank")?.page(id) as J;
    await simulate(page, answer);
    const v = VIEWS[0] as View;
    await view(page, v);
    await page.goto(`/projects/${id}?tab=deed`);
    await settled(page);
    // Tab order through Schedule 1 and into Schedule 2: deliverables, location, the date, its calendar, add a date, tools, None, third-party, None, Save.
    await page.locator("#deed-deliverables").focus();
    const order: string[] = [];
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          return el.id || el.textContent?.trim() || el.getAttribute("aria-label") || el.tagName;
        }),
      );
    }
    expect(order[0]).toBe("deed-location");
    expect(order[1]).toBe("deed-date-0");
    expect(order).toContain("deed-tools");
    expect(order).toContain("deed-thirdParty");
    const focused = page.locator(":focus");
    expect(await focused.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    // None fills Schedule 2's field explicitly and shows as pressed.
    await page.locator("#deed-tools").fill("");
    const none = page.locator(".deed-with-none").first().getByRole("button");
    await none.click();
    await expect(page.locator("#deed-tools")).toHaveValue("None");
    await expect(none).toHaveAttribute("aria-pressed", "true");
    await page.locator("#deed-deliverables").fill("Website source code");
    await page.locator("#deed-date-0").fill("14/10/2026");
    await page.locator("#deed-date-0").blur();
    await shot(page, "deed-draft-form-filling-SIMULATED", v);
    const put = page.waitForRequest((r) => r.method() === "PUT" && /\/schedules$/.test(r.url()));
    await page.getByRole("button", { name: /Save Schedules$/ }).click();
    const body = JSON.parse((await put).postData() ?? "{}") as J;
    expect(body).toMatchObject({
      deliverables: "Website source code",
      deliveredDates: "14 Oct 2026",
      tools: "None",
      thirdParty: null,
    });
    // The draft can't be finalised while the Schedules are blank: the button is off and the reason is listed.
    await expect(page.getByRole("button", { name: /Finalise deed$/ })).toBeDisabled();
    // Cancel asks for a reason first.
    await page
      .getByRole("button", { name: /Cancel draft$/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Cancel draft$/ }).click();
    await expect(dialog.locator("#deed-cancel-reason-error")).toBeVisible();
    await axe(page, "cancel dialog");
    await shot(page, "deed-cancel-dialog-SIMULATED", v);
  });

  test("draft filled: Finalise asks with the code slot (SIMULATED)", async ({ page }) => {
    await page.goto("/");
    const id = await sampleProject(page);
    await simulate(page, STATES.find((s) => s.name === "draft-filled")?.page(id) as J);
    for (const v of [VIEWS[0], VIEWS[3]] as View[]) {
      await view(page, v);
      await page.goto(`/projects/${id}?tab=deed`);
      await settled(page);
      await page.getByRole("button", { name: /Finalise deed$/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await axe(page, `finalise dialog ${v.width} ${v.theme}`);
      await shot(page, "deed-finalise-dialog-SIMULATED", v);
      await page.keyboard.press("Escape");
    }
  });

  test("final: the upload form checks its fields before asking for a code (SIMULATED)", async ({ page }) => {
    await page.goto("/");
    const id = await sampleProject(page);
    await simulate(page, STATES.find((s) => s.name === "final-making")?.page(id) as J);
    for (const v of [VIEWS[0], VIEWS[3]] as View[]) {
      await view(page, v);
      await page.goto(`/projects/${id}?tab=deed`);
      await settled(page);
      await page.locator("#deed-esign-time").fill("2:5");
      await page.getByRole("button", { name: /Upload signed deed$/ }).click();
      await expect(page.locator("#deed-esign-file-error")).toBeVisible();
      await expect(page.locator("#deed-esign-time-error")).toBeVisible();
      await expect(page.locator("#deed-esign-txn-error")).toBeVisible();
      await axe(page, `upload errors ${v.width} ${v.theme}`);
      await shot(page, "deed-upload-errors-SIMULATED", v);
    }
  });
});
