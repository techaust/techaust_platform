// JOB-PDF-01 for an issued credit or debit note (M5.3 stage B2; ADM-INV-11; LD54; VERIFY WITH CA/LEGAL): the snapshot step writes the note's envelope once (the seal and the
// content hash reproduce from the rows), the render step prints the page ONLY when it names the invoice the note is against as one text node (Rule 53(1A)), else the owners'
// bell rings once and nothing is stored or retried; an anonymised client takes no PDF; the sweep picks a note without a PDF. The notes are written the way the freeze leaves
// them (test/pdf-note-seed.ts); Browser Run is a fake binding, the clock is fake.
import { env as realEnv } from "cloudflare:workers";
import { type PdfMessage, pdfKeys } from "@techaust/core/pdf-jobs";
import { parseInvoiceEnvelope, verifyInvoiceEnvelope } from "@techaust/pdf";
import { beforeEach, describe, expect, it } from "vitest";
import { NOTE_FIXTURE_NAMES } from "../../../packages/pdf/test/fixtures/notes.ts";
import { stubPdf } from "../src/browser.ts";
import type { Clock } from "../src/pacer.ts";
import { processRender, processSnapshot, processSweep, SWEEP_GRACE_MS } from "../src/pdf.ts";
import { type SeededNote, seedIssuedNote } from "./pdf-note-seed.ts";

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
const fakeBrowser = () => {
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
const makeEnv = (browser: unknown) => {
  const sent: { body: PdfMessage }[] = [];
  const env = {
    DB: realEnv.DB,
    DOCS: realEnv.DOCS,
    ENVIRONMENT: "local",
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    BROWSER: browser,
    PDF_QUEUE: {
      send: async (body: PdfMessage) => {
        sent.push({ body });
      },
      sendBatch: async (items: { body: PdfMessage }[]) => {
        for (const i of items) sent.push({ body: i.body });
      },
    },
  } as unknown as Env;
  return { env, sent };
};
const keysOf = (s: SeededNote, type: string) =>
  pdfKeys({ type, fy: "2026-27", number: s.number, version: 1 });
const snapshot = (env: Env, id: string) =>
  processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: id, reason: "send" });
const render = (env: Env, id: string, htmlOf?: Parameters<typeof processRender>[4]) =>
  processRender(env, { v: 1, kind: "pdf.render", documentId: id, hop: 0 }, T0, fakeClock(), htmlOf);
/** A page that names the invoice as a node of its own (what the designer's layout will print). */
const naming = (parentNumber: string) => () =>
  `<html><body><h1>Note</h1><dl><dd>${parentNumber}</dd></dl></body></html>`;
const bellsOf = (id: string) =>
  realEnv.DB.prepare("SELECT kind, link FROM notifications WHERE entity_id = ?1").bind(id).all<{
    kind: string;
    link: string;
  }>();

beforeEach(async () => {
  await realEnv.DB.prepare("DELETE FROM notifications").run();
});

describe("the snapshot step for a note [LD39]", () => {
  it.each(NOTE_FIXTURE_NAMES)(
    "%s: the envelope is written once (the rows reproduce the seal and the content hash), verifies, and a render is queued",
    async (name) => {
      const s = await seedIssuedNote(name);
      const { env, sent } = makeEnv({});
      expect(await snapshot(env, s.id)).toBe("queued");
      expect(sent).toEqual([{ body: { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 } }]);
      const stored = await realEnv.DOCS.get(keysOf(s, s.type).snapshot);
      const envelope = parseInvoiceEnvelope((await stored?.text()) ?? "");
      expect(envelope).not.toBeNull();
      expect(envelope?.numberDisplay).toBe(s.numberDisplay);
      expect(envelope?.snapshot.header.noteOf?.parent.number).toBe(s.parentNumber);
      expect(await verifyInvoiceEnvelope(envelope as NonNullable<typeof envelope>)).toEqual({ ok: true });
      // a second run writes nothing new (the same bytes)
      expect(await snapshot(env, s.id)).toBe("queued");
    },
  );

  it("a note whose rows no longer reproduce its seal is refused: nothing is written, the owners are told, no render is queued", async () => {
    // frozen without its sealed request (a damaged copy): the rows cannot give the seal back
    const s = await seedIssuedNote("credit_lines", { dropFrozenExtras: true });
    const { env, sent } = makeEnv({});
    expect(await snapshot(env, s.id)).toBe("refused");
    expect(sent).toEqual([]);
    expect(await realEnv.DOCS.head(keysOf(s, s.type).snapshot)).toBeNull();
  });

  it("an anonymised client takes no envelope, no message and no bell", async () => {
    const s = await seedIssuedNote("credit_lines");
    await realEnv.DB.prepare("UPDATE clients SET anonymised_at = 1 WHERE id = ?1").bind(s.clientId).run();
    const { env, sent } = makeEnv({});
    expect(await snapshot(env, s.id)).toBe("skipped");
    expect(sent).toEqual([]);
    expect(await realEnv.DOCS.head(keysOf(s, s.type).snapshot)).toBeNull();
    expect((await bellsOf(s.id)).results).toEqual([]);
  });
});

describe("the render step names the invoice, or nothing is rendered [LD54]", () => {
  it.each(["credit_lines", "credit_usd_lut", "debit", "debit_usd_lut"] as const)(
    "%s: a page with the frozen number of the invoice as one text node renders: one Browser Run call, the PDF stored and the row set",
    async (name) => {
      const s = await seedIssuedNote(name);
      await snapshot(makeEnv({}).env, s.id);
      const b = fakeBrowser();
      expect(await render(makeEnv(b.binding).env, s.id, naming(s.parentNumber))).toBe("rendered");
      expect(b.calls).toHaveLength(1);
      expect(b.calls[0]).toContain(`>${s.parentNumber}<`);
      expect(await realEnv.DOCS.head(keysOf(s, s.type).pdf)).not.toBeNull();
      const row = await realEnv.DB.prepare("SELECT pdf_r2_key FROM documents WHERE id = ?1")
        .bind(s.id)
        .first<{ pdf_r2_key: string }>();
      expect(row?.pdf_r2_key).toBe(keysOf(s, s.type).pdf);
      expect((await bellsOf(s.id)).results.filter((x) => x.kind === "pdf.refused")).toEqual([]);
    },
  );

  it("a page that lacks the number, splits it, or only mentions it in a sentence is refused BEFORE Browser Run: the bell rings once, nothing is stored, no retry is queued", async () => {
    const pages: [string, (n: string) => string][] = [
      ["lacks it", () => "<html><body><p>Credit Note</p></body></html>"],
      ["another invoice's number", () => "<dd>TH/INV/2627/0099</dd>"],
      ["split in two", (n) => `<p>${n.slice(0, 7)}</p><p>${n.slice(7)}</p>`],
      ["inside a sentence", (n) => `<p>Against invoice ${n} dated 20 Oct 26</p>`],
      ["shortened", (n) => `<dd>${n.slice(0, -1)}</dd>`],
    ];
    for (const [label, html] of pages) {
      const s = await seedIssuedNote("credit_lines");
      await snapshot(makeEnv({}).env, s.id);
      const b = fakeBrowser();
      const { env, sent } = makeEnv(b.binding);
      expect(await render(env, s.id, () => html(s.parentNumber)), label).toBe("refused");
      expect(b.calls, label).toHaveLength(0);
      expect(sent, label).toEqual([]);
      expect(await realEnv.DOCS.head(keysOf(s, s.type).pdf), label).toBeNull();
      expect(
        (
          await realEnv.DB.prepare("SELECT pdf_r2_key FROM documents WHERE id = ?1").bind(s.id).first<{
            pdf_r2_key: string | null;
          }>()
        )?.pdf_r2_key,
        label,
      ).toBeNull();
      const bells = (await bellsOf(s.id)).results;
      expect(bells, label).toEqual([{ kind: "pdf.refused", link: `/invoices/${s.id}` }]);
    }
  });

  it("the check reads the SEALED number: a stored envelope whose invoice number was changed is refused by the seal before any page is made", async () => {
    const s = await seedIssuedNote("credit_lines");
    await snapshot(makeEnv({}).env, s.id);
    const key = keysOf(s, s.type).snapshot;
    const text = (await (await realEnv.DOCS.get(key))?.text()) ?? "";
    await realEnv.DOCS.put(key, text.replace(s.parentNumber, "TH/INV/2627/0099"));
    const b = fakeBrowser();
    expect(await render(makeEnv(b.binding).env, s.id, naming("TH/INV/2627/0099"))).toBe("refused");
    expect(b.calls).toHaveLength(0);
  });

  it("an anonymised client takes no PDF even when the page is right", async () => {
    const s = await seedIssuedNote("debit");
    await snapshot(makeEnv({}).env, s.id);
    await realEnv.DB.prepare("UPDATE clients SET anonymised_at = 1 WHERE id = ?1").bind(s.clientId).run();
    const b = fakeBrowser();
    expect(await render(makeEnv(b.binding).env, s.id, naming(s.parentNumber))).toBe("skipped");
    expect(b.calls).toHaveLength(0);
    expect(await realEnv.DOCS.head(keysOf(s, s.type).pdf)).toBeNull();
  });
});

describe("the sweep takes the notes", () => {
  it("picks an issued credit note and debit note without a PDF; leaves out an anonymised client's and one with a refusal bell", async () => {
    const cn = await seedIssuedNote("credit_lines");
    const dn = await seedIssuedNote("debit");
    const gone = await seedIssuedNote("credit_full");
    await realEnv.DB.prepare("UPDATE clients SET anonymised_at = 1 WHERE id = ?1").bind(gone.clientId).run();
    const refused = await seedIssuedNote("credit_other");
    await realEnv.DB.prepare(
      "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link) SELECT 'n-note-ref', id, 'pdf.refused', 'document', ?1, 't', '/' FROM staff_users LIMIT 1",
    )
      .bind(refused.id)
      .run();
    const { env, sent } = makeEnv({});
    await processSweep(env, { v: 1, kind: "pdf.sweep", asOf: Date.now() + SWEEP_GRACE_MS + 10_000 });
    const ids = sent.map((m) => (m.body as { documentId: string }).documentId);
    expect(ids).toContain(cn.id);
    expect(ids).toContain(dn.id);
    expect(ids).not.toContain(gone.id);
    expect(ids).not.toContain(refused.id);
  });
});
