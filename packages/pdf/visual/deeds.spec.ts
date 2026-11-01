// T11: the deed of assignment fixtures through the five checks of ./checks.ts (data: URLs only and every face loaded, the ₹ in Archivo, the PDF's pages, title
// and embedded Archivo, a full-page screenshot, grayscale with every text colour at least 4.5:1). The INR fixtures only: the ₹ check needs a rupee on the page
// (the USD fixture is printed by scripts/proof.ts and checked by eye). Sample data only. Run: bash tools/heavy.sh --log pdf-visual pnpm --filter @techaust/pdf test:visual
import type { Page } from "@playwright/test";
import { renderDeedHtml } from "../src/render.ts";
import { type DeedFixtureName, deedFixture } from "../test/fixtures/deed.ts";
import { describeDocument } from "./checks.ts";

const FIXTURES: DeedFixtureName[] = ["short-inr", "long-inr"];

async function open(page: Page, name: DeedFixtureName) {
  const text = deedFixture(name);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.emulateMedia({ media: "print" });
  await page.setContent(renderDeedHtml(text), { waitUntil: "load" });
  return { view: { title: text.title }, requests };
}

// The deed proper is one page; the Schedules run onto a second.
for (const name of FIXTURES) describeDocument(`deed-${name}`, (page) => open(page, name), 2);
