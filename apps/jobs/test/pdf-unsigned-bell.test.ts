// F2 of the rt2 early check (L7, lead 2026-10-31; ADM-INV-01, JOB-PDF-01): when the render step refuses a document that must carry the signature and froze none
// (`signature_required`), the owners' bell says so in 07-ZC line 7, word for word, never the "didn't match its saved copy" line of a tampered envelope. The kind stays
// `pdf.refused` (the nightly sweep leaves the document alone) and the link is the invoice's page (the document is frozen: the fix is not in Settings). Code review 1:
// the supplier copy of such a document whose recipient PDF is already stored is made, not refused.
import { env as realEnv } from "cloudflare:workers";
import { type PdfMessage, supplierPdfKey } from "@techaust/core/pdf-jobs";
import { beforeEach, describe, expect, it } from "vitest";
import { stubPdf } from "../src/browser.ts";
import type { Clock } from "../src/pacer.ts";
import { BELL_COPY, documentLabel, processRender, processSnapshot, processSupplierCopy } from "../src/pdf.ts";
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

describe("code review 1: the supplier copy of an older unsigned document whose PDF is stored [ADM-INV-01, JOB-PDF-01]", () => {
  it.each([
    ["a credit note", () => seedIssuedNote("credit_lines", { unsigned: true })],
    ["a debit note", () => seedIssuedNote("debit", { unsigned: true })],
    ["an invoice for a payment received", () => seedIssuedInvoice({ advance: true })],
  ] as const)(
    "%s: the recipient render still refuses; once its PDF is stored (made before the rule), the supplier copy renders with no bell",
    async (_n, seed) => {
      const s = await seed();
      // the recipient PDF is refused as before, with its bell
      expect(await snapshotAndRender(s.id)).toBe("refused");
      expect((await bellsOf(s.id)).length).toBeGreaterThan(0);
      // the supplier copy waits for the recipient PDF: nothing is rendered and no bell rings
      const ask = () =>
        processSupplierCopy(envWith(), { v: 1, kind: "pdf.supplier", documentId: s.id, hop: 0 }, T0, clock());
      expect(await ask()).toBe("skipped");
      // an older document whose recipient PDF was stored before the rule (`pdf_sha256` set): its supplier copy is made, not refused at every ask
      await realEnv.DB.prepare(
        "UPDATE documents SET pdf_r2_key = 'pdf/pre-rule.pdf', pdf_sha256 = ?2 WHERE id = ?1 AND pdf_sha256 IS NULL",
      )
        .bind(s.id, "ab".repeat(32))
        .run();
      await realEnv.DB.prepare("DELETE FROM notifications").run();
      expect(await ask()).toBe("rendered");
      expect(browserCalls).toHaveLength(1);
      expect(browserCalls[0]).toContain("DUPLICATE FOR SUPPLIER");
      expect(await bellsOf(s.id)).toEqual([]);
      const row = await realEnv.DB.prepare("SELECT type, fy, number FROM documents WHERE id = ?1")
        .bind(s.id)
        .first<{ type: string; fy: string; number: number }>();
      if (!row) throw new Error("the seeded row is gone");
      const key = supplierPdfKey({
        type: row.type as never,
        // the row keeps the FY token (2627); the keys take its long form (2026-27)
        fy: `20${row.fy.slice(0, 2)}-${row.fy.slice(2)}`,
        number: row.number,
        version: 1,
      });
      expect(await realEnv.DOCS.head(key)).not.toBeNull();
    },
  );
});
