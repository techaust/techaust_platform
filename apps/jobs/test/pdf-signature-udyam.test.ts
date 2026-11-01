// T4 and T10 (rt2; ADM-INV-01, ADM-INV-06, JOB-PDF-01) in the render step. L4: a credit note, a debit note and an invoice for a payment received are never rendered
// without the signature they must carry (`pdf.refused`, code `signature_required`, the owners' bell, no Browser Run call, no retry); a PDF already stored is adopted
// first; a plain tax invoice without a signature renders as before. T10: a tax invoice sealed with a Udyam number must print 07-ZC line 6 as ONE text node or it is
// refused like any statutory line. Researched 2026-10-30, Rule 53(1A) CGST Rules (08-C RA-22); s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-17); MSMED
// ss.15–16 (08-C RB-39(a)). The page is the real layout (`@techaust/pdf`, which prints the line under the GSTIN line); the refusals take the line out of it or split it
// (`htmlOf`). F1 of the early check: the passing case runs the real layout untouched, so a layout that stops printing the line fails here.
import { env as realEnv } from "cloudflare:workers";
import { type PdfMessage, pdfKeys } from "@techaust/core/pdf-jobs";
import { signedIssuerSql } from "@techaust/db/sql-rules";
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
/** The codes of the structured `pdf.refused` log lines (`logEvent` writes one JSON object per `console.log` call). */
const refusedCodes = (calls: readonly (readonly unknown[])[]): (string | undefined)[] =>
  calls
    .map((c): { ev?: string; code?: string } => {
      try {
        return JSON.parse(String(c[0])) as { ev?: string; code?: string };
      } catch {
        return {};
      }
    })
    .filter((l) => l.ev === "pdf.refused")
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
      const b = browser();
      expect(await render(b, s.id)).toBe("refused");
      expect(b.calls).toHaveLength(0);
      expect(
        await pdfStored(pdfKeys({ type: s.type, fy: "2026-27", number: s.number, version: 1 }).pdf),
      ).toBe(false);
      const bells = await refusedBells(s.id);
      expect(bells.length).toBeGreaterThan(0);
      expect(bells[0]?.link).toBe(`/invoices/${s.id}`);
      expect(refusedCodes(log.mock.calls)).toContain("signature_required");
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

  it("M6.2: the automatic invoice for a proforma paid online (gateway_auto: the company as sender, no issued_by) signed renders; unsigned is refused (early check 2, finding 6)", async () => {
    const auto = await seedIssuedInvoice({ advance: true, signature: {}, systemSender: true });
    const row = await realEnv.DB.prepare(
      `SELECT issued_by, json_extract(issuer, '$.sender.staffId') AS sender, ${signedIssuerSql("issuer")} AS signed FROM documents WHERE id = ?1`,
    )
      .bind(auto.id)
      .first<{ issued_by: string | null; sender: string; signed: number }>();
    expect(row).toEqual({ issued_by: null, sender: "system", signed: 1 });
    await snapshot(auto.id);
    const b = browser();
    expect(await render(b, auto.id)).toBe("rendered");
    expect(b.calls).toHaveLength(1);
    expect(await refusedBells(auto.id)).toEqual([]);
    const unsigned = await seedIssuedInvoice({ advance: true, systemSender: true });
    await snapshot(unsigned.id);
    expect(await render(browser(), unsigned.id)).toBe("refused");
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
  type View = Parameters<typeof renderDocumentHtml>[0];

  it("a tax invoice sealed with a number renders with the real layout, which prints it once as one text node", async () => {
    const s = await seedIssuedInvoice({ udyam: UDYAM });
    await snapshot(s.id);
    const b = browser();
    expect(await render(b, s.id)).toBe("rendered");
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]).toContain(`>${LINE}<`);
    expect(b.calls[0]?.split(LINE)).toHaveLength(2);
    expect(await refusedBells(s.id)).toEqual([]);
  });

  it("a page without the line, or with it split, is refused (statutory_udyam): no Browser Run call, one bell", async () => {
    /** The real layout with its line swapped for `to` (the real page must have the line, or the case would prove nothing). */
    const swapped = (to: string) => (v: View) => {
      const html = renderDocumentHtml(v);
      expect(html).toContain(`>${LINE}<`);
      return html.replace(`>${LINE}<`, `>${to}<`);
    };
    for (const htmlOf of [
      swapped("Udyam"),
      swapped("Udyam Registration No. <b>UDYAM-WB-01-0012345</b> (Micro enterprise)"),
    ]) {
      const s = await seedIssuedInvoice({ udyam: UDYAM });
      await snapshot(s.id);
      const b = browser();
      expect(await render(b, s.id, htmlOf)).toBe("refused");
      expect(b.calls).toHaveLength(0);
      expect((await refusedBells(s.id)).length).toBeGreaterThan(0);
    }
  });

  it("a block sealed under an older format or category list still renders its line as sealed (final re-check; OPEN 08-C RB-39)", async () => {
    // a number and a category today's settings rule refuses: the seal protects them, the envelope reads them by their shape only
    const old = { number: "UDYAM-WB-001-00123456", category: "tiny" };
    const oldLine = "Udyam Registration No. UDYAM-WB-001-00123456 (tiny)";
    const s = await seedIssuedInvoice({ udyam: old });
    await snapshot(s.id);
    const b = browser();
    expect(await render(b, s.id)).toBe("rendered");
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]?.split(`>${oldLine}<`)).toHaveLength(2);
    expect(await refusedBells(s.id)).toEqual([]);
  });

  it("a block of the wrong shape, or one on another type, never reaches the page: the envelope is refused", async () => {
    for (const o of [
      { udyam: { number: "", category: "micro" } },
      { udyam: { number: "U".repeat(41), category: "micro" } },
      { udyam: { number: "UDYAM-WB-01-0012345", category: 1 } },
      { type: "proforma" as const, udyam: UDYAM },
    ]) {
      // (the rows reproduce what was sealed, so the snapshot is written; the render reads it back and refuses it)
      const s = await seedIssuedInvoice(o);
      await snapshot(s.id);
      const b = browser();
      const outcome = await render(b, s.id);
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
