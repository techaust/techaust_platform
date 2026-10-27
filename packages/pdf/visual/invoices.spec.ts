// The tax invoice layout (M5.1 phase 2; docs/06 §7.5) through the five checks of ./checks.ts, one fixture each: short, intra-state (CGST and
// SGST), inter-state (IGST), long (3+ pages), long names, no bank block and no signature, and a signature image. Sample data only.
import type { Page } from "@playwright/test";
import { toInvoiceView } from "../src/invoice-view.ts";
import { renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG } from "../src/view.ts";
import {
  buildInvoiceLayoutFixture,
  INVOICE_LAYOUT_FIXTURES,
  INVOICE_MIN_PAGES,
  type InvoiceLayoutFixture,
} from "../test/fixtures/invoice-layout.ts";
import { describeDocument } from "./checks.ts";

async function open(page: Page, name: InvoiceLayoutFixture) {
  const { envelope, signature } = await buildInvoiceLayoutFixture(name);
  const view = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { signature });
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.emulateMedia({ media: "print" });
  await page.setContent(renderDocumentHtml(view), { waitUntil: "load" });
  return { view, requests };
}

for (const name of INVOICE_LAYOUT_FIXTURES)
  describeDocument(`invoice-${name}`, (page) => open(page, name), INVOICE_MIN_PAGES[name] ?? 1);
