// F2 of the rt2 early check (L7, lead 2026-10-31; ADM-INV-01, JOB-PDF-01): when the render step refuses a document that must carry the signature and froze none
// (`signature_required`), the owners' bell says so in 07-ZC line 7, word for word, never the "didn't match its saved copy" line of a tampered envelope. The kind stays
// `pdf.refused` (the nightly sweep leaves the document alone) and the link is the invoice's page (the document is frozen: the fix is not in Settings).
import { env as realEnv } from "cloudflare:workers";
import type { PdfMessage } from "@techaust/core/pdf-jobs";
import { beforeEach, describe, expect, it } from "vitest";
import { stubPdf } from "../src/browser.ts";
import type { Clock } from "../src/pacer.ts";
import { BELL_COPY, documentLabel, processRender, processSnapshot } from "../src/pdf.ts";
import { seedIssuedInvoice } from "./pdf-invoice-seed.ts";
import { seedIssuedNote } from "./pdf-note-seed.ts";

const T0 = Date.UTC(2026, 9, 28, 6, 0, 0);

const clock = (): Clock => {
  let t = T0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
};
const browserCalls: string[] = [];
const envWith = () =>
  ({
    DB: realEnv.DB,
    DOCS: realEnv.DOCS,
    ENVIRONMENT: "local",
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    BROWSER: {
      quickAction: async (_a: "pdf", o: Record<string, unknown>) => {
        browserCalls.push(String(o.html));
        return new Response(stubPdf(), {
          status: 200,
          headers: { "content-type": "application/pdf", "x-browser-ms-used": "1500" },
        });
      },
    },
    PDF_QUEUE: { send: async (_b: PdfMessage) => {}, sendBatch: async () => {} },
  }) as unknown as Env;

const snapshotAndRender = async (id: string) => {
  expect(
    await processSnapshot(envWith(), { v: 1, kind: "pdf.snapshot", documentId: id, reason: "send" }),
  ).toBe("queued");
  return processRender(envWith(), { v: 1, kind: "pdf.render", documentId: id, hop: 0 }, T0, clock());
};
const bellsOf = async (id: string) =>
  (
    await realEnv.DB.prepare(
      "SELECT kind, entity_type, title, link FROM notifications WHERE entity_id = ?1 ORDER BY kind",
    )
      .bind(id)
      .all<{ kind: string; entity_type: string; title: string; link: string }>()
  ).results;

beforeEach(async () => {
  await realEnv.DB.prepare("DELETE FROM notifications").run();
  browserCalls.length = 0;
});

describe("L7: the unsigned refusal rings its own line (07-ZC line 7) [ADM-INV-01, JOB-PDF-01]", () => {
  it("the line is 07-ZC line 7 word for word", () => {
    expect(BELL_COPY.invoiceUnsigned("TH/CN/2627/0001")).toBe(
      "The PDF of TH/CN/2627/0001 wasn't made because it was issued without the signature. Credit notes, debit notes and invoices for a payment received always carry it. A developer needs to look at it.",
    );
  });

  it.each([
    ["a credit note", () => seedIssuedNote("credit_lines", { unsigned: true })],
    ["a debit note", () => seedIssuedNote("debit", { unsigned: true })],
    ["an invoice for a payment received", () => seedIssuedInvoice({ advance: true })],
  ] as const)(
    "%s issued without the signature: kind pdf.refused, the invoice's page, never the saved-copy line",
    async (_n, seed) => {
      const s = await seed();
      expect(await snapshotAndRender(s.id)).toBe("refused");
      expect(browserCalls).toHaveLength(0);
      const bells = await bellsOf(s.id);
      expect(bells.length).toBeGreaterThan(0);
      for (const b of bells) {
        expect(b).toEqual({
          kind: "pdf.refused",
          entity_type: "document",
          title: BELL_COPY.invoiceUnsigned(documentLabel(s.numberDisplay)),
          link: `/invoices/${s.id}`,
        });
        expect(b.title).not.toContain("saved copy");
      }
    },
  );
});
