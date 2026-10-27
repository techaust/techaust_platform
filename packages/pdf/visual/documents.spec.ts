// The proposal and estimate fixtures through the five checks of ./checks.ts (the tax invoice layout has its own file, ./invoices.spec.ts).
import type { Page } from "@playwright/test";
import { renderDocumentHtml } from "../src/render.ts";
import { toPdfView } from "../src/view.ts";
import { buildFixture, FIXTURE_NAMES, type FixtureName } from "../test/fixtures/index.ts";
import { describeDocument } from "./checks.ts";

const MIN_PAGES: Partial<Record<FixtureName, number>> = { "long-inter-inr": 3 };

async function open(page: Page, name: FixtureName) {
  const { envelope } = await buildFixture(name);
  const view = toPdfView(envelope);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.emulateMedia({ media: "print" });
  await page.setContent(renderDocumentHtml(view), { waitUntil: "load" });
  return { view, requests };
}

for (const name of FIXTURE_NAMES) describeDocument(name, (page) => open(page, name), MIN_PAGES[name] ?? 1);
