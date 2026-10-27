// The credit and debit notes in the designed invoice layout (M5.3; docs/06 §7.3, §7.5; words 07-T §1) through the five checks of ./checks.ts, one
// fixture each (test/fixtures/notes.ts, built through core's real engine): a credit note by lines, by an amount (a reason with words), the whole
// invoice, in USD under LUT and with IGST paid, an "Other" reason; a debit note in INR and in USD. Sample data only.
import type { Page } from "@playwright/test";
import { toInvoiceView } from "../src/invoice-view.ts";
import { renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG } from "../src/view.ts";
import { buildNoteFixture, NOTE_FIXTURE_NAMES, type NoteFixtureName } from "../test/fixtures/notes.ts";
import { describeDocument } from "./checks.ts";

async function open(page: Page, name: NoteFixtureName) {
  const { envelope } = await buildNoteFixture(name);
  const view = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { portalLink: "portal.techaust.com" });
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.emulateMedia({ media: "print" });
  await page.setContent(renderDocumentHtml(view), { waitUntil: "load" });
  return { view, requests };
}

for (const name of NOTE_FIXTURE_NAMES) describeDocument(`note-${name}`, (page) => open(page, name), 1);
