// M7.2's admin screens (ADM-G-09, ADM-MAIL-01, ADM-MAIL-02; run file G1 to G4): the email log and one email with its delivery updates and "Emails stopped",
// the Owner's "Allow emails again", Your account › Notifications (a switch saved and read back), and a contact's "Emails stopped" badge; axe (WCAG 2.2 AA) and
// no sideways scroll at 390, 768 and 1280 px in both themes, the in-app theme set against the OS theme. The email rows, their SES events and the suppressions
// are written straight to the LOCAL tables, as the jobs Worker's SES hook writes them (sample addresses on example.test only).
//   E2E_SAMPLE=1 pnpm --filter @techaust/admin exec playwright test e2e/m72-notifications.spec.ts   (through tools/heavy.sh; M72_SHOTS=<folder> saves screenshots)
import { execFileSync } from "node:child_process";
import { argon2Sync, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createInviteStatements } from "../../../scripts/create-invite-sql.mjs";
import { ORIGIN } from "../playwright.config.ts";
import { totpAt } from "./sample-data.ts";

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
const NOT_SENT = `ml-e2e-${run}-n`;
const NOT_SENT_TO = `not-sent-${run}@example.test`;
const BOUNCE_TO = `bounce-${run}@example.test`;
const SHOTS = process.env.M72_SHOTS ?? "";
const headers = { Origin: ORIGIN };

test.beforeAll(() => {
  const now = Date.now();
  d1(
    `INSERT INTO email_log (id, to_email, template, entity_type, entity_id, ses_message_id, status, created_at, updated_at, last_event_at, bounce_type) VALUES
       ('${BOUNCED}', '${BOUNCE_TO}', 'invoice.sent', 'document_send', 'e2e-${run}-1', 'msg-${run}-b', 'bounced', ${now - 3_600_000}, ${now - 60_000}, ${now - 60_000}, 'permanent'),
       ('${DELIVERED}', 'delivered-${run}@example.test', 'receipt.sent', 'document_send', 'e2e-${run}-2', 'msg-${run}-d', 'delivered', ${now - 7_200_000}, ${now - 120_000}, ${now - 120_000}, NULL),
       ('${QUEUED}', 'a.long.sample.address.${run}.for.layout@subdomain.example.test', 'digest.weekly', 'digest', 'e2e-${run}:2026-11-02', NULL, 'queued', ${now - 30_000}, ${now - 30_000}, NULL, NULL),
       ('${NOT_SENT}', '${NOT_SENT_TO}', 'reminder.sent', 'reminder', 'e2e-${run}-3', NULL, 'skipped', ${now - 90_000}, ${now - 90_000}, NULL, NULL);
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

// ---- Review 1, findings 6 and 15 (designer D2) ----

test("the Sent column shows a time only once an email left: Queued before, nothing for one never sent (finding 15)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/emails");
  await expect(page.getByText(BOUNCE_TO).first()).toBeVisible();
  const heads = await page.locator("thead th").allTextContents();
  const sent = heads.findIndex((h) => h.trim() === "Sent");
  expect(sent, "the Sent column").toBeGreaterThanOrEqual(0);
  // the row's cells in column order (the address is the row's header cell)
  const cell = (hasText: string) =>
    page.locator("tbody tr", { hasText }).locator(":scope > th, :scope > td").nth(sent);
  await expect(cell("for.layout@")).toHaveText("Queued");
  await expect(cell(BOUNCE_TO)).toContainText("IST");
  await expect(cell(BOUNCE_TO)).not.toContainText("Last update");
  // a dash on screen (hidden from screen readers), "Not sent" for them
  await expect(cell(NOT_SENT_TO).locator('[aria-hidden="true"]')).toHaveText("—");
  await expect(cell(NOT_SENT_TO)).toContainText("Not sent");
  await expect(cell(NOT_SENT_TO)).not.toContainText("IST");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-emails-sent-column-1280.png`, fullPage: true });
});

/** A throwaway member of `role`, enrolled over the API as global-setup.ts enrols the Owner (local database only; sample address, random password). */
async function memberCookies(role: "staff" | "accountant") {
  const email = `e2e-${role}-${run}@example.test`;
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  d1(
    createInviteStatements({
      email,
      role,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      now,
      expiresAt: now + 3_600_000,
      auditId: randomUUID(),
    }).join("\n"),
  );
  const call = async (route: string, body: unknown) => {
    const res = await fetch(`${ORIGIN}/api/v1/auth${route}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: res.status,
      data: (await res.json().catch(() => ({}))) as Record<string, unknown>,
      cookies: res.headers.getSetCookie(),
    };
  };
  const start = await call("/invite/start", { token });
  expect(start.status, `${role} invite/start`).toBe(200);
  const p = start.data.params as { m: number; t: number; p: number };
  const clientHash = argon2Sync("argon2id", {
    message: randomBytes(18).toString("base64url").normalize("NFKC"),
    nonce: Buffer.from(start.data.salt as string, "base64url"),
    parallelism: p.p,
    passes: p.t,
    memory: p.m,
    tagLength: 32,
  }).toString("base64url");
  const finish = await call("/invite/finish", { token, clientHash, name: `E2E ${role} (sample)` });
  expect(finish.status, `${role} invite/finish`).toBe(200);
  const done = await call("/invite/totp", {
    challenge: finish.data.challenge,
    code: totpAt(base32(finish.data.secret as string), Math.floor(Date.now() / 30_000)),
  });
  expect(done.status, `${role} invite/totp`).toBe(200);
  return done.cookies.map((c) => {
    const [pair = ""] = c.split(";");
    const at = pair.indexOf("=");
    return {
      name: pair.slice(0, at),
      value: pair.slice(at + 1),
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: /;\s*secure/i.test(c),
      sameSite: "Strict" as const,
    };
  });
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(s: string): Buffer {
  let bits = "";
  for (const c of s.replace(/=+$/, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
}

/** A UUIDv7 (`POST /payments` takes its idempotency key only in that form). */
function uuid7(): string {
  const t = Date.now().toString(16).padStart(12, "0");
  const r = randomUUID().replaceAll("-", "");
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${r.slice(13, 16)}-${(8 | (Number.parseInt(r[16] ?? "0", 16) & 3)).toString(16)}${r.slice(17, 20)}-${r.slice(20, 32)}`;
}

/** A step-up for this session, unless one is still good for two minutes; a refused code waits for the next 30-second step (m71's helper). */
async function stepUp(page: Page) {
  const me = await page.request.get("/api/v1/auth/me");
  const until = ((await me.json()) as { stepUpUntil?: number | null }).stepUpUntil ?? null;
  if (until !== null && until - Date.now() > 120_000) return;
  const secret = Buffer.from(readFileSync(here("../.e2e/owner-totp.hex"), "utf8"), "hex");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await page.request.post("/api/v1/auth/step-up", {
      headers,
      data: { code: totpAt(secret, Math.floor(Date.now() / 30_000)) },
    });
    if (res.ok()) return;
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  }
  throw new Error("e2e: no step-up after three steps");
}

test("Send receipt again: offered while the payment holds money, refused and then hidden once it is refunded in full (finding 5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await stepUp(page);
  // the sample's INR client (E2E_SAMPLE), with one contact who can get receipts (portal access and Can see finance; a sample address)
  const found = await page.request.get("/api/v1/clients?q=X0001");
  const clientId = (
    ((await found.json()) as { clients?: { id: string; code: string }[] }).clients ?? []
  ).find((c) => c.code === "X0001")?.id;
  expect(clientId, "the sample's INR client").toBeTruthy();
  const contactName = `Receipt Contact ${run} (sample)`;
  const contactId = randomUUID();
  d1(
    `INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance) VALUES ('${contactId}', '${clientId}', '${contactName}', 'receipt-${run}@example.test', 1, 1);`,
  );
  // a confirmed payment held as credit (the Owner's entry is confirmed at once)
  const paymentId = uuid7();
  const rec = await page.request.post("/api/v1/payments", {
    headers,
    data: {
      id: paymentId,
      clientId,
      kind: "payment",
      currency: "INR",
      amountMinor: 1_234_00,
      receivedOn: "2026-11-04",
      mode: "neft",
      reference: `UTRE2E${run.toUpperCase()}`,
    },
  });
  expect(rec.status(), await rec.text()).toBe(201);
  // its receipt, written as the invoices Worker's issue batch writes it (local dev doesn't run jobs' `receipt.issue`); a sample number in the receipt series
  const no = 5000 + (Date.now() % 4000);
  d1(
    `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, issue_date, total_minor, header_extras, snapshot_sha256, frozen_at, created_at, updated_at)
       SELECT 'rct_' || p.id, 'receipt', 'issued', p.client_id, p.currency, 'receipt', '2627', ${no}, 'TH/RCT/2627/${no}', '2026-11-05', p.amount_minor, NULL, '${"0".repeat(63)}9', ${Date.now()}, ${Date.now()}, ${Date.now()}
       FROM payments p WHERE p.id = '${paymentId}';
     UPDATE payments SET receipt_document_id = 'rct_' || id WHERE id = '${paymentId}' AND receipt_document_id IS NULL;`,
  );
  await page.goto(`/payments/${paymentId}`);
  const entry = page.getByRole("dialog", { name: "Payment" });
  await entry.getByRole("button", { name: /Send receipt again/ }).click();
  const send = page.getByRole("dialog", { name: `Send receipt TH/RCT/2627/${no} again` });
  await send.getByRole("checkbox", { name: new RegExp(contactName.replace(/[()]/g, "\\$&")) }).check();
  // the money goes back in full while the dialog is open: the send is refused by its code, and the dialog can only be closed
  const refund = await page.request.post(`/api/v1/payments/${paymentId}/refunds`, {
    headers,
    data: {
      id: uuid7(),
      amountMinor: 1_234_00,
      from: "credit",
      reasonCode: "overpayment",
      note: "Sample refund (e2e)",
      manual: {
        mode: "neft",
        reference: `UTRRF${run.toUpperCase()}`,
        paidOn: "2026-11-05",
        paidTo: "original",
      },
    },
  });
  expect(refund.status(), await refund.text()).toBe(200);
  await send.getByRole("button", { name: "Send receipt" }).click();
  const stop = send
    .getByRole("alert")
    .filter({ hasText: "This payment was refunded in full, so its receipt can't be sent again." });
  await expect(stop).toBeVisible();
  await expect(stop).toBeFocused();
  await expect(send.getByRole("button", { name: "Send receipt" })).toHaveCount(0);
  expect(await axe(page), "the refused send").toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-receipt-refunded-stop-1280.png` });
  await send.getByRole("button", { name: "Cancel" }).click();
  // back on the entry, the receipt stays and its "Send receipt again" is gone
  await expect(entry.locator(".docno", { hasText: `TH/RCT/2627/${no}` })).toBeVisible();
  await expect(entry.getByText("Refunded on")).toBeVisible();
  await expect(entry.getByRole("button", { name: /Send receipt again/ })).toHaveCount(0);
  // the server agrees
  const again = await page.request.post(`/api/v1/receipts/rct_${paymentId}/send`, {
    headers,
    data: { contactIds: [contactId] },
  });
  expect(again.status()).toBe(409);
  expect(((await again.json()) as { error?: { code?: string } }).error?.code).toBe("receipt_refunded");
});

test("the email log is in the rail for the Owner and Staff, never the Accountant (finding 6)", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const ownerRail = page.getByRole("navigation", { name: "Main" });
  await ownerRail.getByRole("link", { name: "Emails" }).click();
  await expect(page).toHaveURL(/\/emails$/);
  await expect(page.getByRole("heading", { name: "Emails", level: 1 })).toBeVisible();
  await expect(ownerRail.getByRole("link", { name: "Emails" })).toHaveAttribute("aria-current", "page");
  // one email keeps its section marked in the rail
  await page.goto(`/emails/${DELIVERED}`);
  await expect(ownerRail.getByRole("link", { name: "Emails" })).toHaveAttribute("aria-current", "page");

  for (const [role, sees] of [
    ["staff", true],
    ["accountant", false],
  ] as const) {
    const ctx = await browser.newContext({
      baseURL: ORIGIN,
      storageState: { cookies: await memberCookies(role), origins: [] },
      viewport: { width: 1280, height: 900 },
    });
    const p = await ctx.newPage();
    await p.goto("/");
    const rail = p.getByRole("navigation", { name: "Main" });
    await expect(rail.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Emails" }), role).toHaveCount(sees ? 1 : 0);
    if (sees) {
      await rail.getByRole("link", { name: "Emails" }).click();
      await expect(p.getByRole("heading", { name: "Emails", level: 1 })).toBeVisible();
      await expect(p.getByText(BOUNCE_TO).first()).toBeVisible();
      expect(await axe(p), `${role} email log`).toEqual([]);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/e2e-emails-rail-${role}-1280.png`, fullPage: true });
    }
    await ctx.close();
  }
});
