// T4 and T10 (rt2; ADM-INV-01, ADM-INV-06, JOB-PDF-01) in the render step. L4: a credit note, a debit note and an invoice for a payment received are never rendered
// without the signature they must carry (`pdf.refused`, code `signature_required`, the owners' bell, no Browser Run call, no retry); a PDF already stored is adopted
// first; a plain tax invoice without a signature renders as before. T10: a tax invoice sealed with a Udyam number must print 07-ZC line 6 as ONE text node or it is
// refused like any statutory line. Researched 2026-10-30, Rule 53(1A) CGST Rules (08-C RA-22); s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-17); MSMED
// ss.15–16 (08-C RB-39(a)). The layout that prints the line is the designer's: here the page is the real layout with the line added or left out (`htmlOf`).
import { env as realEnv } from "cloudflare:workers";
import { type PdfMessage, pdfKeys } from "@techaust/core/pdf-jobs";
import { renderDocumentHtml } from "@techaust/pdf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubPdf } from "../src/browser.ts";
import type { Clock } from "../src/pacer.ts";
import { processRender, processSnapshot } from "../src/pdf.ts";
import { seedIssuedInvoice } from "./pdf-invoice-seed.ts";
import { seedIssuedNote } from "./pdf-note-seed.ts";

const T0 = Date.UTC(2026, 9, 28, 6, 0, 0);
const UDYAM = { number: "UDYAM-WB-01-0012345", category: "micro" } as const;
const LINE = "Udyam Registration No. UDYAM-WB-01-0012345 (Micro enterprise)";

const clockAt = (): Clock => {
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
const snapshot = async (id: string) =>
  expect(
    await processSnapshot(envWith({}), { v: 1, kind: "pdf.snapshot", documentId: id, reason: "send" }),
  ).toBe("queued");
const render = (b: ReturnType<typeof browser>, id: string, htmlOf?: Parameters<typeof processRender>[4]) =>
  processRender(
    envWith(b.binding),
    { v: 1, kind: "pdf.render", documentId: id, hop: 0 },
    T0,
    clockAt(),
    htmlOf,
  );
const refusedBells = async (id: string) =>
  (
    await realEnv.DB.prepare(
      "SELECT title, link FROM notifications WHERE entity_id = ?1 AND kind = 'pdf.refused'",
    )
      .bind(id)
      .all<{ title: string; link: string }>()
  ).results;
/** The structured log lines of `pdf.refused`, by code. */
const refusedCodes = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(String(c[0])) as { message?: string; event?: string; code?: string };
      } catch {
        return {};
      }
    })
    .filter((l) => JSON.stringify(l).includes("pdf.refused"))
    .map((l) => l.code);
const pdfStored = async (key: string) => (await realEnv.DOCS.head(key)) !== null;

beforeEach(async () => {
  await realEnv.DB.prepare("DELETE FROM notifications").run();
  vi.restoreAllMocks();
});

describe("L4: a document that must be signed and froze no signature is refused [T4]", () => {
  it.each(["credit_lines", "debit"] as const)(
    "%s issued before the rule: no Browser Run call, no PDF, one bell with the invoice's page, code signature_required",
    async (name) => {
      const s = await seedIssuedNote(name, { unsigned: true });
      await snapshot(s.id);
      const log = vi.spyOn(console, "log");
      const warn = vi.spyOn(console, "warn");
      const b = browser();
      expect(await render(b, s.id)).toBe("refused");
      expect(b.calls).toHaveLength(0);
      expect(
        await pdfStored(pdfKeys({ type: s.type, fy: "2026-27", number: s.number, version: 1 }).pdf),
      ).toBe(false);
      const bells = await refusedBells(s.id);
      expect(bells.length).toBeGreaterThan(0);
      expect(bells[0]?.link).toBe(`/invoices/${s.id}`);
      expect([...refusedCodes(log), ...refusedCodes(warn)]).toContain("signature_required");
    },
  );

  it("a signed note renders (the fixture's signature is in DOCS)", async () => {
    const s = await seedIssuedNote("credit_lines");
    await snapshot(s.id);
    const b = browser();
    expect(await render(b, s.id)).toBe("rendered");
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]).toContain('data-testid="signature"');
    expect(await refusedBells(s.id)).toEqual([]);
  });

  it("an unsigned note whose PDF is already stored is adopted, not refused", async () => {
    const s = await seedIssuedNote("debit", { unsigned: true });
    await snapshot(s.id);
    await realEnv.DOCS.put(
      pdfKeys({ type: s.type, fy: "2026-27", number: s.number, version: 1 }).pdf,
      stubPdf(),
    );
    const b = browser();
    expect(await render(b, s.id)).toBe("adopted");
    expect(b.calls).toHaveLength(0);
    expect(await refusedBells(s.id)).toEqual([]);
  });

  it("an invoice for a payment received: unsigned is refused; signed renders", async () => {
    const unsigned = await seedIssuedInvoice({ advance: true });
    await snapshot(unsigned.id);
    const b = browser();
    expect(await render(b, unsigned.id)).toBe("refused");
    expect(b.calls).toHaveLength(0);
    expect((await refusedBells(unsigned.id)).length).toBeGreaterThan(0);
    const signed = await seedIssuedInvoice({ advance: true, signature: {} });
    await snapshot(signed.id);
    expect(await render(b, signed.id)).toBe("rendered");
    expect(b.calls).toHaveLength(1);
  });

  it("a plain tax invoice without a signature, and one switched off, still render (Rule 46(q) proviso, 08-C RA-06)", async () => {
    for (const o of [{}, { signatoryOff: true }]) {
      const s = await seedIssuedInvoice(o);
      await snapshot(s.id);
      const b = browser();
      expect(await render(b, s.id), JSON.stringify(o)).toBe("rendered");
      expect(await refusedBells(s.id)).toEqual([]);
    }
  });
});

describe("T10: the Udyam line is a statutory line of the page", () => {
  /** The real layout with 07-ZC line 6 added as one text node after the body opens (what the designer's layout will print in the supplier block). */
  const withLine = (v: Parameters<typeof renderDocumentHtml>[0]) =>
    renderDocumentHtml(v).replace("<body>", `<body><p data-testid="udyam">${LINE}</p>`);

  it("a tax invoice sealed with a number renders when the page prints it as one text node", async () => {
    const s = await seedIssuedInvoice({ udyam: UDYAM });
    await snapshot(s.id);
    const b = browser();
    expect(await render(b, s.id, withLine)).toBe("rendered");
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]).toContain(`>${LINE}<`);
  });

  it("a page without the line, or with it split, is refused (statutory_udyam): no Browser Run call, one bell", async () => {
    for (const htmlOf of [
      (v: Parameters<typeof renderDocumentHtml>[0]) => renderDocumentHtml(v).replace(`>${LINE}<`, ">Udyam<"),
      (v: Parameters<typeof renderDocumentHtml>[0]) =>
        renderDocumentHtml(v).replace(
          "<body>",
          "<body><p>Udyam Registration No. <b>UDYAM-WB-01-0012345</b> (Micro enterprise)</p>",
        ),
    ]) {
      const s = await seedIssuedInvoice({ udyam: UDYAM });
      await snapshot(s.id);
      const b = browser();
      // (the real layout of today may already print the line: the first page then has it taken out by the replace)
      expect(await render(b, s.id, htmlOf)).toBe("refused");
      expect(b.calls).toHaveLength(0);
      expect((await refusedBells(s.id)).length).toBeGreaterThan(0);
    }
  });

  it("a malformed block, or one on another type, never reaches the page: the envelope is refused", async () => {
    for (const o of [
      { udyam: { number: "udyam-wb-01-0012345", category: "micro" } },
      { type: "proforma" as const, udyam: UDYAM },
    ]) {
      // (the rows reproduce what was sealed, so the snapshot is written; the render reads it back and refuses it)
      const s = await seedIssuedInvoice(o);
      await snapshot(s.id);
      const b = browser();
      const outcome = await render(b, s.id, withLine);
      expect(outcome, JSON.stringify(o)).toBe("refused");
      expect(b.calls).toHaveLength(0);
    }
  });

  it("an invoice sealed without one renders with the real layout, as before", async () => {
    const s = await seedIssuedInvoice({});
    await snapshot(s.id);
    const b = browser();
    expect(await render(b, s.id)).toBe("rendered");
    expect(b.calls[0]).not.toContain("Udyam");
  });
});
