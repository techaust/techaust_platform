// JOB-PDF-01 for an issued invoice (M5.1 stage B2): the snapshot step writes the invoice envelope once, the render step prints the plain skeleton from it,
// refused envelopes and signatures ring a bell and never retry or pin the sweep, an anonymised client is skipped, a voided invoice renders from its
// issued snapshot. Invoices are issued through the real issue statements (test/pdf-invoice-seed.ts); Browser Run is a fake binding, the clock is fake.
import { env as realEnv } from "cloudflare:workers";
import { type PdfMessage, pdfKeys } from "@techaust/core/pdf-jobs";
import { SIGNATURE_MAX_BYTES as CORE_SIGNATURE_MAX_BYTES } from "@techaust/core/settings";
import { toBase64 } from "@techaust/email";
import { parseInvoiceEnvelope, serializeInvoiceEnvelope, verifyInvoiceEnvelope } from "@techaust/pdf";
import { beforeEach, describe, expect, it } from "vitest";
import { stubPdf } from "../src/browser.ts";
import type { Clock } from "../src/pacer.ts";
import {
  BELL_COPY,
  processPdf,
  processPdfDeadLetter,
  processRender,
  processSnapshot,
  processSweep,
  SIGNATURE_MAX_BYTES,
  SWEEP_GRACE_MS,
  SWEEP_SQL,
} from "../src/pdf.ts";
import { hexOf, PNG_BYTES, type SeededInvoice, seedIssuedInvoice } from "./pdf-invoice-seed.ts";

const T0 = Date.UTC(2026, 9, 28, 6, 0, 0);
const GONE = "UPDATE clients SET anonymised_at = 1 WHERE id = ?";
const integrityBell = (s: SeededInvoice) =>
  `The PDF of ${s.numberDisplay} didn't match its saved copy, so it wasn't made. A developer needs to look at it.`; // 07-R §3 (review 11), not 07-P's proposal line

type Sent = { body: PdfMessage; delaySeconds?: number };
const fakeQueue = () => {
  const sent: Sent[] = [];
  return {
    sent,
    send: async (body: PdfMessage, o?: { delaySeconds?: number }) => {
      sent.push(o?.delaySeconds === undefined ? { body } : { body, delaySeconds: o.delaySeconds });
    },
    sendBatch: async (items: { body: PdfMessage }[]) => {
      for (const i of items) sent.push({ body: i.body });
    },
  };
};

type Call = { at: number; options: Record<string, unknown> };
function fakeBrowser(clock: Clock) {
  const calls: Call[] = [];
  return {
    calls,
    binding: {
      quickAction: async (_a: "pdf", options: Record<string, unknown>) => {
        calls.push({ at: clock.now(), options });
        return new Response(stubPdf(), {
          status: 200,
          headers: { "content-type": "application/pdf", "x-browser-ms-used": "1500" },
        });
      },
    },
  };
}

function fakeClock(start = T0) {
  let t = start;
  const clock: Clock = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
  return clock;
}

function makeEnv(browser: unknown, queue = fakeQueue()) {
  const env = {
    DB: realEnv.DB,
    DOCS: realEnv.DOCS,
    ENVIRONMENT: "local",
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    BROWSER: browser,
    PDF_QUEUE: queue,
  } as unknown as Env;
  return { env, queue };
}

const one = <T>(sql: string, ...p: unknown[]) =>
  realEnv.DB.prepare(sql)
    .bind(...p)
    .first<T>();
const all = async <T>(sql: string, ...p: unknown[]) =>
  (
    await realEnv.DB.prepare(sql)
      .bind(...p)
      .all<T>()
  ).results;

const keysOf = (s: SeededInvoice) =>
  pdfKeys({ type: "tax_invoice", fy: "2026-27", number: s.number, version: 1 });
const snapshotMsg = (documentId: string) =>
  ({ v: 1, kind: "pdf.snapshot", documentId, reason: "send" }) as const;
const renderMsg = (documentId: string) => ({ v: 1, kind: "pdf.render", documentId, hop: 0 }) as const;

/** Issues an invoice and runs its snapshot step, so the render step has its envelope. */
async function ready(o: Parameters<typeof seedIssuedInvoice>[0] = {}) {
  const s = await seedIssuedInvoice(o);
  const { env } = makeEnv({});
  expect(await processSnapshot(env, snapshotMsg(s.id))).toBe("queued");
  return s;
}

beforeEach(async () => {
  await realEnv.DB.batch([
    realEnv.DB.prepare("DELETE FROM notifications"),
    realEnv.DB.prepare("DELETE FROM stats_daily WHERE metric LIKE 'pdf.%'"),
  ]);
});

describe("the signature cap", () => {
  it("is the Settings route's own (core SIGNATURE_MAX_BYTES)", () => {
    expect(SIGNATURE_MAX_BYTES).toBe(CORE_SIGNATURE_MAX_BYTES);
  });
});

describe("the invoice snapshot step", () => {
  it("writes a verified invoice envelope once at docs/tax_invoice/<fy>/<nnnn>-v1.json, sets snapshot_r2_key and queues the render", async () => {
    const s = await seedIssuedInvoice({ terms: true, bank: true });
    const { env, queue } = makeEnv({});
    expect(await processSnapshot(env, snapshotMsg(s.id))).toBe("queued");
    const keys = keysOf(s);
    expect(keys.snapshot).toBe(`docs/tax_invoice/2026-27/${String(s.number).padStart(4, "0")}-v1.json`);
    const obj = await realEnv.DOCS.get(keys.snapshot);
    expect(obj).not.toBeNull();
    const envelope = parseInvoiceEnvelope(await (obj as R2ObjectBody).text());
    expect(envelope).toMatchObject({
      v: 3,
      kind: "invoice",
      documentId: s.id,
      numberDisplay: s.numberDisplay,
      fy: "2026-27",
    });
    expect(await verifyInvoiceEnvelope(envelope as NonNullable<typeof envelope>)).toEqual({ ok: true });
    expect(envelope?.snapshot.header.issuer.reverseChargeText).toBe("Tax payable on reverse charge: No");
    expect(
      (await one<{ snapshot_r2_key: string }>("SELECT snapshot_r2_key FROM documents WHERE id = ?", s.id))
        ?.snapshot_r2_key,
    ).toBe(keys.snapshot);
    expect(queue.sent).toEqual([{ body: { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 } }]);
  });

  it("is idempotent: a second run writes nothing again and queues the render again", async () => {
    const s = await seedIssuedInvoice();
    const { env, queue } = makeEnv({});
    await processSnapshot(env, snapshotMsg(s.id));
    const first = await realEnv.DOCS.get(keysOf(s).snapshot);
    const etag = first?.etag;
    const text = await first?.text();
    expect(await processSnapshot(env, { ...snapshotMsg(s.id), reason: "retry" })).toBe("queued");
    const second = await realEnv.DOCS.get(keysOf(s).snapshot);
    expect(second?.etag).toBe(etag);
    expect(await second?.text()).toBe(text);
    expect(queue.sent).toHaveLength(2);
  });

  it("never overwrites: a different object on the key refuses, rings the owners' bell once (pdf.refused) and queues nothing", async () => {
    const s = await seedIssuedInvoice();
    await realEnv.DOCS.put(keysOf(s).snapshot, "something else");
    const { env, queue } = makeEnv({});
    expect(await processSnapshot(env, snapshotMsg(s.id))).toBe("refused");
    expect(await (await realEnv.DOCS.get(keysOf(s).snapshot))?.text()).toBe("something else");
    expect(queue.sent).toEqual([]);
    const bells = await all<{ kind: string; title: string; link: string; entity_type: string }>(
      "SELECT kind, title, link, entity_type FROM notifications WHERE entity_id = ?",
      s.id,
    );
    expect(bells.length).toBeGreaterThan(0);
    for (const b of bells)
      expect(b).toEqual({
        kind: "pdf.refused",
        title: integrityBell(s),
        link: `/invoices/${s.id}`,
        entity_type: "document",
      });
  });

  it("skips a document whose client is anonymised (no envelope, no message, no bell), a missing one, a draft and one that already has its PDF", async () => {
    const gone = await seedIssuedInvoice();
    await realEnv.DB.prepare(GONE).bind(gone.clientId).run();
    const { env, queue } = makeEnv({});
    expect(await processSnapshot(env, snapshotMsg(gone.id))).toBe("skipped");
    expect(await realEnv.DOCS.head(keysOf(gone).snapshot)).toBeNull();
    expect(await all("SELECT 1 FROM notifications WHERE entity_id = ?", gone.id)).toHaveLength(0);
    expect(await processSnapshot(env, snapshotMsg("no-such-invoice"))).toBe("skipped");
    const done = await seedIssuedInvoice();
    await realEnv.DB.prepare("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = 'h' WHERE id = ?")
      .bind(done.id)
      .run();
    expect(await processSnapshot(env, snapshotMsg(done.id))).toBe("skipped");
    await realEnv.DB.prepare(
      "INSERT INTO documents (id, type, status, client_id, currency) VALUES ('draft-inv', 'tax_invoice', 'draft', ?1, 'INR')",
    )
      .bind(done.clientId)
      .run();
    expect(await processSnapshot(env, snapshotMsg("draft-inv"))).toBe("skipped");
    expect(queue.sent).toEqual([]);
  });

  it("an invoice that was voided before its snapshot is made from its issued rows: the same envelope, no void in it", async () => {
    const s = await seedIssuedInvoice();
    await realEnv.DB.prepare(
      "UPDATE documents SET status = 'void', voided_at = ?2, void_reason = 'Issued in error' WHERE id = ?1",
    )
      .bind(s.id, T0)
      .run();
    const { env } = makeEnv({});
    expect(await processSnapshot(env, snapshotMsg(s.id))).toBe("queued");
    const text = await (await realEnv.DOCS.get(keysOf(s).snapshot))?.text();
    expect(text).not.toMatch(/void/i);
    expect(
      await verifyInvoiceEnvelope(
        parseInvoiceEnvelope(text ?? "") as NonNullable<ReturnType<typeof parseInvoiceEnvelope>>,
      ),
    ).toEqual({ ok: true });
  });
});

describe("the invoice render step", () => {
  it("renders the plain skeleton from the R2 envelope, stores the PDF once, sets the row and counts it", async () => {
    const s = await ready({ terms: true, bank: true });
    const clock = fakeClock();
    const b = fakeBrowser(clock);
    const { env } = makeEnv(b.binding);
    expect(await processRender(env, renderMsg(s.id), T0, clock)).toBe("rendered");
    expect(b.calls).toHaveLength(1);
    const html = String((b.calls[0] as Call).options.html);
    for (const must of [
      "Content-Security-Policy",
      "Tax Invoice",
      s.numberDisplay,
      "ORIGINAL FOR RECIPIENT",
      "Tax payable on reverse charge: No",
      "Authorised signatory",
      "SAC 998314",
      "Place of supply: West Bengal (19)",
      "SAMPLE BANK",
      "Notes, version",
    ])
      expect(html, must).toContain(must);
    expect(html).not.toContain('<img data-testid="signature"');
    const row = await one<{ pdf_r2_key: string; pdf_sha256: string }>(
      "SELECT pdf_r2_key, pdf_sha256 FROM documents WHERE id = ?",
      s.id,
    );
    expect(row?.pdf_r2_key).toBe(keysOf(s).pdf);
    const stored = await realEnv.DOCS.get(keysOf(s).pdf);
    const bytes = new Uint8Array(await (stored as R2ObjectBody).arrayBuffer());
    expect(row?.pdf_sha256).toBe(await hexOf(bytes));
    const stats = await all<{ metric: string; value: number }>(
      "SELECT metric, value FROM stats_daily WHERE metric LIKE 'pdf.%' ORDER BY metric",
    );
    expect(stats).toEqual([
      { metric: "pdf.browser_ms", value: 1500 },
      { metric: "pdf.renders", value: 1 },
    ]);
  });

  it("never renders twice: a second message finds the PDF done, and an orphaned PDF in R2 is adopted", async () => {
    const s = await ready();
    const clock = fakeClock();
    const b = fakeBrowser(clock);
    const { env } = makeEnv(b.binding);
    await processRender(env, renderMsg(s.id), T0, clock);
    expect(await processRender(env, renderMsg(s.id), T0, clock)).toBe("skipped");
    const orphan = await ready();
    await realEnv.DOCS.put(keysOf(orphan).pdf, stubPdf());
    expect(await processRender(env, renderMsg(orphan.id), T0, clock)).toBe("adopted");
    expect(b.calls).toHaveLength(1);
  });

  it("embeds a signature only when it was frozen, its object is there and its SHA-256 is the frozen one", async () => {
    const s = await ready({ signature: {} });
    const clock = fakeClock();
    const b = fakeBrowser(clock);
    const { env } = makeEnv(b.binding);
    expect(await processRender(env, renderMsg(s.id), T0, clock)).toBe("rendered");
    const html = String((b.calls[0] as Call).options.html);
    expect(html).toContain('<img data-testid="signature"');
    expect(html).toContain(`data:image/png;base64,${btoa(String.fromCharCode(...PNG_BYTES))}`);
  });

  it("reads the signature with ONE R2 get (no head first) and embeds it through the shared base64 [review 12]", async () => {
    const s = await ready({ signature: {} });
    const clock = fakeClock();
    const b = fakeBrowser(clock);
    const { env } = makeEnv(b.binding);
    const reads: string[] = [];
    const docs = new Proxy(realEnv.DOCS, {
      get: (target, prop) => {
        const v = Reflect.get(target, prop) as unknown;
        if (typeof v !== "function") return v;
        return (...a: unknown[]) => {
          if ((prop === "head" || prop === "get") && String(a[0]).startsWith("settings/signature-"))
            reads.push(`${String(prop)}:${String(a[0])}`);
          return (v as (...x: unknown[]) => unknown).apply(target, a);
        };
      },
    });
    expect(await processRender({ ...env, DOCS: docs } as Env, renderMsg(s.id), T0, clock)).toBe("rendered");
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatch(/^get:settings\/signature-[0-9a-f]{16}\.png$/);
    expect(String((b.calls[0] as Call).options.html)).toContain(
      `data:image/png;base64,${toBase64(PNG_BYTES)}`,
    );
  });

  it("an oversized signature object is refused from its size alone, before its body is read", async () => {
    const s = await ready({ signature: {} });
    const clock = fakeClock();
    const b = fakeBrowser(clock);
    const { env } = makeEnv(b.binding);
    await realEnv.DOCS.put(s.signatureKey as string, new Uint8Array(SIGNATURE_MAX_BYTES + 1));
    expect(await processRender(env, renderMsg(s.id), T0, clock)).toBe("refused");
    expect(b.calls).toHaveLength(0);
  });

  it.each([
    ["other bytes under the frozen key", { bytes: new Uint8Array([1, 2, 3, 4]) }],
    ["no object at the frozen key", { bytes: null }],
    ["a key of another shape", { key: "files/anything.png" }],
    ["a type that is not PNG or JPEG", { mime: "image/svg+xml" }],
  ] as const)(
    "refuses a signature that cannot be shown as it was: %s (no PDF, no browser call, one bell, nothing to retry)",
    async (_n, signature) => {
      const s = await ready({ signature });
      const clock = fakeClock();
      const b = fakeBrowser(clock);
      const { env, queue } = makeEnv(b.binding);
      expect(await processRender(env, renderMsg(s.id), T0, clock)).toBe("refused");
      expect(b.calls).toHaveLength(0);
      expect(queue.sent).toEqual([]);
      expect(await realEnv.DOCS.head(keysOf(s).pdf)).toBeNull();
      expect(await one("SELECT 1 FROM documents WHERE id = ? AND pdf_sha256 IS NULL", s.id)).not.toBeNull();
      const bells = await all<{ kind: string; title: string }>(
        "SELECT kind, title FROM notifications WHERE entity_id = ?",
        s.id,
      );
      expect(bells.length).toBeGreaterThan(0);
      for (const bell of bells) expect(bell).toEqual({ kind: "pdf.refused", title: integrityBell(s) });
    },
  );

  it("refuses a signature object larger than the cap without reading it", async () => {
    const big = new Uint8Array(SIGNATURE_MAX_BYTES + 1);
    const s = await ready({ signature: { bytes: big } });
    const clock = fakeClock();
    const b = fakeBrowser(clock);
    const { env } = makeEnv(b.binding);
    expect(await processRender(env, renderMsg(s.id), T0, clock)).toBe("refused");
    expect(b.calls).toHaveLength(0);
  });

  it("a tampered envelope in R2 is refused with a bell: never rendered, never retried", async () => {
    const s = await ready();
    const key = keysOf(s).snapshot;
    const text = (await (await realEnv.DOCS.get(key))?.text()) ?? "";
    const envelope = parseInvoiceEnvelope(text) as NonNullable<ReturnType<typeof parseInvoiceEnvelope>>;
    (envelope.snapshot.header.recipient as { legalName: string }).legalName = "Someone Else";
    await realEnv.DOCS.put(key, serializeInvoiceEnvelope(envelope));
    const clock = fakeClock();
    const b = fakeBrowser(clock);
    const { env, queue } = makeEnv(b.binding);
    expect(await processRender(env, renderMsg(s.id), T0, clock)).toBe("refused");
    expect(b.calls).toHaveLength(0);
    expect(queue.sent).toEqual([]);
    expect(
      await all<{ kind: string }>("SELECT kind FROM notifications WHERE entity_id = ?", s.id),
    ).not.toHaveLength(0);
    // and one that is not an envelope at all, and one of another document
    await realEnv.DOCS.put(key, "not an envelope");
    expect(await processRender(env, renderMsg(s.id), T0, clock)).toBe("refused");
    const other = await ready();
    await realEnv.DOCS.put(key, (await (await realEnv.DOCS.get(keysOf(other).snapshot))?.text()) ?? "");
    expect(await processRender(env, renderMsg(s.id), T0, clock)).toBe("refused");
    expect(b.calls).toHaveLength(0);
  });

  it("skips a render whose client was anonymised while it waited: no browser call, no PDF", async () => {
    const s = await ready();
    await realEnv.DB.prepare(GONE).bind(s.clientId).run();
    const clock = fakeClock();
    const b = fakeBrowser(clock);
    const { env } = makeEnv(b.binding);
    expect(await processRender(env, renderMsg(s.id), T0, clock)).toBe("skipped");
    expect(b.calls).toHaveLength(0);
    expect(await realEnv.DOCS.head(keysOf(s).pdf)).toBeNull();
  });

  it("a voided invoice renders from its issued snapshot with no void stamp [LD7]", async () => {
    const s = await ready();
    await realEnv.DB.prepare(
      "UPDATE documents SET status = 'void', voided_at = ?2, void_reason = 'Issued in error' WHERE id = ?1",
    )
      .bind(s.id, T0)
      .run();
    const clock = fakeClock();
    const b = fakeBrowser(clock);
    const { env } = makeEnv(b.binding);
    expect(await processRender(env, renderMsg(s.id), T0, clock)).toBe("rendered");
    const html = String((b.calls[0] as Call).options.html);
    expect(html).toContain(s.numberDisplay);
    expect(html).not.toMatch(/\b(void|cancelled)\b|Issued in error/i);
  });

  it("routes through processPdf like a proposal's message", async () => {
    const s = await seedIssuedInvoice();
    const clock = fakeClock();
    const b = fakeBrowser(clock);
    const { env, queue } = makeEnv(b.binding);
    await processPdf(env, snapshotMsg(s.id), T0, clock);
    expect(queue.sent).toHaveLength(1);
    await processPdf(env, renderMsg(s.id), T0, clock);
    expect(b.calls).toHaveLength(1);
  });
});

describe("the sweep and the dead letter, for invoices", () => {
  it("picks an issued invoice without a PDF; leaves out an anonymised client's, one with a refusal bell, and one that has its PDF", async () => {
    const picked = await seedIssuedInvoice();
    const gone = await seedIssuedInvoice();
    await realEnv.DB.prepare(GONE).bind(gone.clientId).run();
    const refused = await seedIssuedInvoice();
    await realEnv.DB.prepare("UPDATE documents SET snapshot_r2_key = 'x' WHERE id = ?")
      .bind(refused.id)
      .run();
    await realEnv.DB.prepare(
      "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link) SELECT 'n-ref', id, 'pdf.refused', 'document', ?1, 't', '/' FROM staff_users LIMIT 1",
    )
      .bind(refused.id)
      .run();
    const done = await seedIssuedInvoice();
    await realEnv.DB.prepare("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = 'h' WHERE id = ?")
      .bind(done.id)
      .run();
    const { env, queue } = makeEnv({});
    await processSweep(env, { v: 1, kind: "pdf.sweep", asOf: Date.now() + SWEEP_GRACE_MS + 10_000 });
    const ids = queue.sent.map((m) => (m.body as { documentId: string }).documentId);
    expect(ids).toContain(picked.id);
    expect(ids).not.toContain(gone.id);
    expect(ids).not.toContain(refused.id);
    expect(ids).not.toContain(done.id);
    // the pick still uses the partial index
    const plan = await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${SWEEP_SQL}`, Date.now());
    expect(plan.map((p) => p.detail).join(" ")).toContain("documents_pdf_pending");
  });

  it("a refusal never pins the sweep: with 21 refused invoices ahead of it, a later invoice is still picked", async () => {
    const refusedIds: string[] = [];
    for (let i = 0; i < 21; i++)
      refusedIds.push((await seedIssuedInvoice({ now: Date.now() - 86_400_000 + i })).id);
    for (const id of refusedIds)
      await realEnv.DB.prepare(
        "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link) SELECT ?2, id, 'pdf.refused', 'document', ?1, 't', '/' FROM staff_users LIMIT 1",
      )
        .bind(id, `n-${id}`)
        .run();
    const later = await seedIssuedInvoice();
    const { env, queue } = makeEnv({});
    await processSweep(env, { v: 1, kind: "pdf.sweep", asOf: Date.now() + SWEEP_GRACE_MS + 10_000 });
    const ids = queue.sent.map((m) => (m.body as { documentId: string }).documentId);
    expect(ids).toContain(later.id);
    for (const id of refusedIds) expect(ids).not.toContain(id);
    // the sweep is a plain listing: a manual retry of a refused invoice still goes straight to its own snapshot message
    await realEnv.DB.prepare("DELETE FROM notifications WHERE kind = 'pdf.refused'").run();
  });

  it("a message that ran out of tries rings the owners' bell with the invoice's page and no version", async () => {
    const s = await seedIssuedInvoice();
    const { env } = makeEnv({});
    await processPdfDeadLetter(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 }, T0);
    expect(
      await all("SELECT kind, title, link FROM notifications WHERE entity_id = ? GROUP BY kind", s.id),
    ).toEqual([
      {
        kind: "pdf.failed",
        title: BELL_COPY.failedInvoice(s.numberDisplay),
        link: `/invoices/${s.id}`,
      },
    ]);
    expect(BELL_COPY.failedInvoice("TH/INV/2627/0001")).toBe(
      "The PDF for TH/INV/2627/0001 could not be made. Open it to try again.",
    );
  });
});
