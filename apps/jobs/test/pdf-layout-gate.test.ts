// The M5.2 review gate (LD33; review finding 5) with the REAL layout: the render step builds the page with `renderDocumentHtml` (the default `htmlOf`
// of `processRender`, nothing replaced), and an export invoice under LUT, an export invoice with IGST paid and a proforma pass the statutory-line check
// and reach Browser Run. An export invoice issued for a payment received (Q9) is checked through the same `missingStatutoryLine` the render step calls,
// on the envelope the pdf package seals with the issue route's own functions (the seed here issues no Q9 invoice). The statutory lines are LITERALS.
import { env as realEnv } from "cloudflare:workers";
import { type PdfMessage, pdfKeys } from "@techaust/core/pdf-jobs";
import { DEFAULT_VIEW_CONFIG, missingStatutoryLine, renderDocumentHtml, toInvoiceView } from "@techaust/pdf";
import { beforeEach, describe, expect, it } from "vitest";
import { buildInvoiceFixture } from "../../../packages/pdf/test/fixtures/invoice.ts";
import { buildNoteFixture, PARENT_NUMBER } from "../../../packages/pdf/test/fixtures/notes.ts";
import { stubPdf } from "../src/browser.ts";
import type { Clock } from "../src/pacer.ts";
import { processRender, processSnapshot } from "../src/pdf.ts";
import {
  LITERAL_ENDORSEMENT,
  LITERAL_PROFORMA_NOTICE,
  type SeededInvoice,
  seedIssuedInvoice,
} from "./pdf-invoice-seed.ts";
import { seedIssuedNote } from "./pdf-note-seed.ts";

const T0 = Date.UTC(2026, 9, 28, 6, 0, 0);
const fakeClock = (): Clock => {
  let t = T0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
};
const browser = () => {
  const calls: string[] = [];
  return {
    calls,
    binding: {
      quickAction: async (_a: "pdf", o: Record<string, unknown>) => {
        calls.push(String(o.html));
        return new Response(stubPdf(), {
          status: 200,
          headers: { "content-type": "application/pdf", "x-browser-ms-used": "1500" },
        });
      },
    },
  };
};
const envWith = (b: unknown) =>
  ({
    DB: realEnv.DB,
    DOCS: realEnv.DOCS,
    ENVIRONMENT: "local",
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    BROWSER: b,
    PDF_QUEUE: { send: async (_b: PdfMessage) => {}, sendBatch: async () => {} },
  }) as unknown as Env;
const keysOf = (s: SeededInvoice) => pdfKeys({ type: s.type, fy: "2026-27", number: s.number, version: 1 });

beforeEach(async () => {
  await realEnv.DB.prepare("DELETE FROM notifications").run();
});

describe("LD33 with the real layout: the statutory line is on the page, so Browser Run renders it", () => {
  const cases: [string, Parameters<typeof seedIssuedInvoice>[0], string][] = [
    ["an export invoice under LUT", { type: "export_invoice", exportMode: "lut" }, LITERAL_ENDORSEMENT.lut],
    [
      "an export invoice with IGST paid",
      { type: "export_invoice", exportMode: "igst_paid" },
      LITERAL_ENDORSEMENT.igst_paid,
    ],
    ["a proforma", { type: "proforma" }, LITERAL_PROFORMA_NOTICE],
  ];
  it.each(cases)(
    "%s renders: one Browser Run call, the line as one text node, the PDF stored",
    async (_label, o, line) => {
      const s = await seedIssuedInvoice(o);
      expect(
        await processSnapshot(envWith({}), { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" }),
      ).toBe("queued");
      const b = browser();
      // no `htmlOf`: the default, the real layout
      expect(
        await processRender(
          envWith(b.binding),
          { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 },
          T0,
          fakeClock(),
        ),
      ).toBe("rendered");
      expect(b.calls).toHaveLength(1);
      expect(b.calls[0]).toMatch(new RegExp(`>${line.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}<`));
      expect(await realEnv.DOCS.head(keysOf(s).pdf)).not.toBeNull();
      const bells = await realEnv.DB.prepare(
        "SELECT kind FROM notifications WHERE entity_id = ?1 AND kind = 'pdf.refused'",
      )
        .bind(s.id)
        .all();
      expect(bells.results).toHaveLength(0);
    },
  );
});

describe("LD33 for the invoice issued for a payment received (Q9)", () => {
  it.each(["advance_export", "advance", "export_note"] as const)(
    "%s: the real layout carries what the check asks for",
    async (name) => {
      const { envelope } = await buildInvoiceFixture(name);
      const html = renderDocumentHtml(toInvoiceView(envelope, DEFAULT_VIEW_CONFIG));
      expect(missingStatutoryLine(envelope, html)).toBeNull();
      if (envelope.type === "export_invoice") expect(html).toContain(`>${LITERAL_ENDORSEMENT.lut}<`);
      if (envelope.snapshot.header.advance) expect(html).toContain("Against proforma TH/PI/2627/0003");
    },
  );
});

// ---- M5.3 (LD54): a credit or debit note must name the invoice it is against, as one text node of its own ----------------------------------------------------
// The gate is `missingStatutoryLine`, the same check the render step calls. The REAL layout (`renderDocumentHtml`, nothing replaced) does not print the number of the invoice
// yet: that is the M5.3 designer's (07-T §1: "Against invoice {invoice number}"), so until it does, a note's render is refused by this very gate (the owners' bell rings, nothing
// reaches Browser Run) and the last case shows what the page must carry. When the layout prints the number as a node of its own, flip `LAYOUT_PRINTS_PARENT` to `true`: every
// note then renders with the real layout, and the other cases of this block stay as they are.
const LAYOUT_PRINTS_PARENT = false;

describe("LD54 with the real layout: the invoice's number on a note's page", () => {
  const names = ["credit_lines", "credit_usd_lut", "debit", "debit_usd_lut"] as const;
  it.each(names)("%s: the gate and the real layout agree", async (name) => {
    const { envelope } = await buildNoteFixture(name);
    const html = renderDocumentHtml(toInvoiceView(envelope, DEFAULT_VIEW_CONFIG));
    expect(missingStatutoryLine(envelope, html)).toBe(LAYOUT_PRINTS_PARENT ? null : "parent_number");
    if (LAYOUT_PRINTS_PARENT) expect(html).toContain(`>${PARENT_NUMBER}<`);
  });

  it("through the render step with the real `renderDocumentHtml`: a note is refused, or rendered once the layout prints the number", async () => {
    const s = await seedIssuedNote("credit_lines");
    expect(
      await processSnapshot(envWith({}), { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" }),
    ).toBe("queued");
    const b = browser();
    // no `htmlOf`: the default, the real layout
    const outcome = await processRender(
      envWith(b.binding),
      { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 },
      T0,
      fakeClock(),
    );
    expect(outcome).toBe(LAYOUT_PRINTS_PARENT ? "rendered" : "refused");
    expect(b.calls).toHaveLength(LAYOUT_PRINTS_PARENT ? 1 : 0);
    const bells = await realEnv.DB.prepare(
      "SELECT kind FROM notifications WHERE entity_id = ?1 AND kind = 'pdf.refused'",
    )
      .bind(s.id)
      .all();
    // (one bell per active owner: this file's seeds make more than one)
    expect(bells.results.length > 0).toBe(!LAYOUT_PRINTS_PARENT);
  });

  it("what the designer must write: the real page plus the invoice's number as a node of its own renders", async () => {
    const s = await seedIssuedNote("debit");
    await processSnapshot(envWith({}), { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" });
    const b = browser();
    const outcome = await processRender(
      envWith(b.binding),
      { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 },
      T0,
      fakeClock(),
      (view) => renderDocumentHtml(view).replace("</body>", `<p>${s.parentNumber}</p></body>`),
    );
    expect(outcome).toBe("rendered");
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]).toContain(`>${s.parentNumber}<`);
  });
});
