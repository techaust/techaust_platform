// The DUPLICATE FOR SUPPLIER copy [Q11, owner 2026-10-28; Rule 48(2) CGST Rules; Researched 2026-10-28, 08-C RA-07]: jobs renders a second PDF of the SAME frozen envelope for every tax invoice,
// export invoice, credit note and debit note (never a proforma), after the original, as its own queue message, write-once in DOCS under its own key. It is never attached, emailed or
// linked to a client: no row names it and no email message is queued for it.
import { env as realEnv } from "cloudflare:workers";
import { type PdfMessage, pdfKeys, supplierPdfKey } from "@techaust/core/pdf-jobs";
import { beforeEach, describe, expect, it } from "vitest";
import { stubPdf } from "../src/browser.ts";
import type { Clock } from "../src/pacer.ts";
import {
  processPdf,
  processPdfDeadLetter,
  processRender,
  processSnapshot,
  processSupplierCopy,
} from "../src/pdf.ts";
import { type SeededInvoice, seedIssuedInvoice } from "./pdf-invoice-seed.ts";
import { seedIssuedNote } from "./pdf-note-seed.ts";

const T0 = Date.UTC(2026, 9, 28, 6, 0, 0);
type Sent = { body: PdfMessage };
const fakeQueue = () => {
  const sent: Sent[] = [];
  return {
    sent,
    send: async (body: PdfMessage) => {
      sent.push({ body });
    },
    sendBatch: async (items: { body: PdfMessage }[]) => {
      for (const i of items) sent.push({ body: i.body });
    },
  };
};
const fakeClock = (): Clock => {
  let t = T0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
};
const fakeBrowser = () => {
  const htmls: string[] = [];
  return {
    htmls,
    binding: {
      quickAction: async (_a: "pdf", o: Record<string, unknown>) => {
        htmls.push(String(o.html));
        return new Response(stubPdf(), {
          status: 200,
          headers: { "content-type": "application/pdf", "x-browser-ms-used": "1500" },
        });
      },
    },
  };
};
const makeEnv = (browser: unknown = {}, queue = fakeQueue()) => ({
  env: {
    DB: realEnv.DB,
    DOCS: realEnv.DOCS,
    ENVIRONMENT: "local",
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    BROWSER: browser,
    PDF_QUEUE: queue,
  } as unknown as Env,
  queue,
});

const row = (id: string) =>
  realEnv.DB.prepare("SELECT pdf_r2_key, pdf_sha256, snapshot_r2_key FROM documents WHERE id = ?1")
    .bind(id)
    .first<{ pdf_r2_key: string | null; pdf_sha256: string | null; snapshot_r2_key: string | null }>();

/** An issued document with its envelope, as far as the original's PDF. */
async function renderedOriginal(s: SeededInvoice) {
  const { env, queue } = makeEnv();
  await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" });
  const b = fakeBrowser();
  const made = makeEnv(b.binding, queue);
  await processRender(made.env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 }, T0, fakeClock());
  return { b, queue, env: made.env };
}

beforeEach(async () => {
  await realEnv.DB.prepare("DELETE FROM notifications").run();
});

describe("the supplier copy of an invoice [Q11]", () => {
  it("the original's render queues one pdf.supplier message (its own unit of work); the copy is rendered after it with the other mark, stored write-once under its own key, and no row names it", async () => {
    const s = await seedIssuedInvoice();
    const { b, queue } = await renderedOriginal(s);
    const supplierMsgs = queue.sent.filter((m) => m.body.kind === "pdf.supplier");
    expect(supplierMsgs).toEqual([{ body: { v: 1, kind: "pdf.supplier", documentId: s.id, hop: 0 } }]);
    // the original carries the recipient's mark
    expect(b.htmls).toHaveLength(1);
    expect(b.htmls[0]).toContain("ORIGINAL FOR RECIPIENT");
    expect(b.htmls[0]).not.toContain("DUPLICATE FOR SUPPLIER");
    const original = await row(s.id);
    // the copy
    const copy = fakeBrowser();
    const key = supplierPdfKey({ type: "tax_invoice", fy: "2026-27", number: s.number, version: 1 });
    expect(key).toBe(
      `${pdfKeys({ type: "tax_invoice", fy: "2026-27", number: s.number, version: 1 }).pdf.slice(0, -4)}-supplier.pdf`,
    );
    expect(await realEnv.DOCS.head(key)).toBeNull();
    const { env } = makeEnv(copy.binding);
    expect(
      await processSupplierCopy(
        env,
        { v: 1, kind: "pdf.supplier", documentId: s.id, hop: 0 },
        T0,
        fakeClock(),
      ),
    ).toBe("rendered");
    expect(copy.htmls).toHaveLength(1);
    expect(copy.htmls[0]).toContain("DUPLICATE FOR SUPPLIER");
    expect(copy.htmls[0]).not.toContain("ORIGINAL FOR RECIPIENT");
    expect(await realEnv.DOCS.head(key)).not.toBeNull();
    // the original's row and key are untouched: nothing in the database names the copy
    expect(await row(s.id)).toEqual(original);
    // a second run adopts the stored copy: no second render
    const again = fakeBrowser();
    expect(
      await processSupplierCopy(
        makeEnv(again.binding).env,
        { v: 1, kind: "pdf.supplier", documentId: s.id, hop: 0 },
        T0,
        fakeClock(),
      ),
    ).toBe("adopted");
    expect(again.htmls).toEqual([]);
  });

  it("no email message is queued for it, and it counts in the render statistics", async () => {
    const s = await seedIssuedInvoice();
    const { queue } = await renderedOriginal(s);
    const { env } = makeEnv(fakeBrowser().binding, queue);
    const before = await realEnv.DB.prepare(
      "SELECT coalesce(sum(value), 0) AS v FROM stats_daily WHERE metric = 'pdf.renders'",
    ).first<{ v: number }>();
    await processSupplierCopy(env, { v: 1, kind: "pdf.supplier", documentId: s.id, hop: 0 }, T0, fakeClock());
    const after = await realEnv.DB.prepare(
      "SELECT coalesce(sum(value), 0) AS v FROM stats_daily WHERE metric = 'pdf.renders'",
    ).first<{ v: number }>();
    expect(after?.v).toBe((before?.v ?? 0) + 1);
    expect(queue.sent.every((m) => m.body.kind.startsWith("pdf."))).toBe(true);
  });

  it("an export invoice has a copy too; a proforma has none, and a copy waits until the original's PDF exists", async () => {
    const exp = await seedIssuedInvoice({ type: "export_invoice" });
    await renderedOriginal(exp);
    const copy = fakeBrowser();
    expect(
      await processSupplierCopy(
        makeEnv(copy.binding).env,
        { v: 1, kind: "pdf.supplier", documentId: exp.id, hop: 0 },
        T0,
        fakeClock(),
      ),
    ).toBe("rendered");
    expect(copy.htmls[0]).toContain("DUPLICATE FOR SUPPLIER");
    const pf = await seedIssuedInvoice({ type: "proforma" });
    const { queue } = await renderedOriginal(pf);
    expect(queue.sent.filter((m) => m.body.kind === "pdf.supplier")).toEqual([]);
    const none = fakeBrowser();
    expect(
      await processSupplierCopy(
        makeEnv(none.binding).env,
        { v: 1, kind: "pdf.supplier", documentId: pf.id, hop: 0 },
        T0,
        fakeClock(),
      ),
    ).toBe("skipped");
    expect(none.htmls).toEqual([]);
    // an invoice whose original has no PDF yet: nothing to copy
    const fresh = await seedIssuedInvoice();
    await processSnapshot(makeEnv().env, {
      v: 1,
      kind: "pdf.snapshot",
      documentId: fresh.id,
      reason: "send",
    });
    expect(
      await processSupplierCopy(
        makeEnv(none.binding).env,
        { v: 1, kind: "pdf.supplier", documentId: fresh.id, hop: 0 },
        T0,
        fakeClock(),
      ),
    ).toBe("skipped");
    expect(none.htmls).toEqual([]);
  });

  it("an anonymised client takes no copy; an unknown id is skipped", async () => {
    const s = await seedIssuedInvoice();
    await renderedOriginal(s);
    await realEnv.DB.prepare("UPDATE clients SET anonymised_at = 1 WHERE id = ?1").bind(s.clientId).run();
    const b = fakeBrowser();
    const { env } = makeEnv(b.binding);
    expect(
      await processSupplierCopy(
        env,
        { v: 1, kind: "pdf.supplier", documentId: s.id, hop: 0 },
        T0,
        fakeClock(),
      ),
    ).toBe("skipped");
    expect(
      await processSupplierCopy(
        env,
        { v: 1, kind: "pdf.supplier", documentId: "nope", hop: 0 },
        T0,
        fakeClock(),
      ),
    ).toBe("skipped");
    expect(b.htmls).toEqual([]);
  });

  it("the same statutory checks as the original: a page without the frozen endorsement is refused before Browser Run (the bell rings once)", async () => {
    const s = await seedIssuedInvoice({ type: "export_invoice" });
    await renderedOriginal(s);
    const b = fakeBrowser();
    const outcome = await processSupplierCopy(
      makeEnv(b.binding).env,
      { v: 1, kind: "pdf.supplier", documentId: s.id, hop: 0 },
      T0,
      fakeClock(),
      () => "<html><body>no endorsement here</body></html>",
    );
    expect(outcome).toBe("refused");
    expect(b.htmls).toEqual([]);
  });

  it("routed by the queue consumer (processPdf); a dead letter rings no bell (07 has no line) and is only logged", async () => {
    const s = await seedIssuedInvoice();
    await renderedOriginal(s);
    const b = fakeBrowser();
    await processPdf(
      makeEnv(b.binding).env,
      { v: 1, kind: "pdf.supplier", documentId: s.id, hop: 0 },
      T0,
      fakeClock(),
    );
    expect(b.htmls).toHaveLength(1);
    await processPdfDeadLetter(makeEnv().env, { v: 1, kind: "pdf.supplier", documentId: s.id, hop: 0 }, T0);
    const bells = await realEnv.DB.prepare("SELECT kind FROM notifications WHERE entity_id = ?1")
      .bind(s.id)
      .all();
    expect(bells.results).toEqual([]);
  });
});

describe("the supplier copy of a note [Q11]", () => {
  it.each(["credit_lines", "debit"] as const)(
    "%s: rendered from its own envelope with the other mark",
    async (name) => {
      const n = await seedIssuedNote(name);
      const { env: e1 } = makeEnv();
      await processSnapshot(e1, { v: 1, kind: "pdf.snapshot", documentId: n.id, reason: "send" });
      const naming = () => `<html><body><dd>${n.parentNumber}</dd></body></html>`;
      await processRender(
        makeEnv(fakeBrowser().binding).env,
        { v: 1, kind: "pdf.render", documentId: n.id, hop: 0 },
        T0,
        fakeClock(),
        naming,
      );
      const b = fakeBrowser();
      const outcome = await processSupplierCopy(
        makeEnv(b.binding).env,
        { v: 1, kind: "pdf.supplier", documentId: n.id, hop: 0 },
        T0,
        fakeClock(),
        (view) =>
          `<html><body><p>${(view as { copyLabel?: string | null }).copyLabel}</p><dd>${n.parentNumber}</dd></body></html>`,
      );
      expect(outcome).toBe("rendered");
      expect(b.htmls[0]).toContain("<p>DUPLICATE FOR SUPPLIER</p>");
    },
  );
});
