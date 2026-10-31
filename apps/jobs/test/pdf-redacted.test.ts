// T7 (08-C RB-37(a); Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)): an offer whose personal details were erased is never snapshotted,
// rendered or verified again, rings no bell, and an object stored while it was being redacted is deleted. [JOB-PDF-01]
import { env as realEnv } from "cloudflare:workers";
import { pdfKeys } from "@techaust/core/pdf-jobs";
import { beforeEach, describe, expect, it } from "vitest";
import { stubPdf } from "../src/browser.ts";
import type { Clock } from "../src/pacer.ts";
import {
  processPdfDeadLetter,
  processRender,
  processSnapshot,
  processSupplierCopy,
  processSweep,
  RENDER_ROW_SQL,
  SWEEP_SQL,
} from "../src/pdf.ts";
import { type Seeded, seedSent } from "./pdf-seed.ts";

const T0 = Date.UTC(2026, 9, 26, 6, 0, 0);
const clock: Clock = { now: () => T0, sleep: async () => {} };
const REDACT = "UPDATE documents SET redacted_at = ?2 WHERE id = ?1";
const redact = (id: string) => realEnv.DB.prepare(REDACT).bind(id, Date.now()).run();
const keysOf = (s: Seeded) => pdfKeys({ type: "proposal", fy: "2026-27", number: s.number, version: 1 });

const queue = () => {
  const sent: unknown[] = [];
  return {
    sent,
    send: async (b: unknown) => {
      sent.push(b);
    },
    sendBatch: async (items: { body: unknown }[]) => {
      for (const i of items) sent.push(i.body);
    },
  };
};
const browser = (before?: () => Promise<void>) => {
  const calls: unknown[] = [];
  return {
    calls,
    binding: {
      quickAction: async (_a: "pdf", options: unknown) => {
        calls.push(options);
        await before?.();
        return new Response(stubPdf(), {
          status: 200,
          headers: { "content-type": "application/pdf", "x-browser-ms-used": "1000" },
        });
      },
    },
  };
};
function makeEnv(b: unknown = {}, docs: R2Bucket = realEnv.DOCS) {
  const q = queue();
  const env = {
    DB: realEnv.DB,
    DOCS: docs,
    ENVIRONMENT: "local",
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    BROWSER: b,
    PDF_QUEUE: q,
    EMAIL_QUEUE: q,
  } as unknown as Env;
  return { env, q };
}
const bells = async (id: string) =>
  (await realEnv.DB.prepare("SELECT 1 FROM notifications WHERE entity_id = ?").bind(id).all()).results.length;
const pdfOfRow = (id: string) =>
  realEnv.DB.prepare("SELECT snapshot_r2_key, pdf_r2_key, pdf_sha256 FROM documents WHERE id = ?")
    .bind(id)
    .first();

beforeEach(async () => {
  await realEnv.DB.prepare("DELETE FROM notifications").run();
});

describe("a redacted offer and the PDF jobs", () => {
  it("the snapshot step skips it: no envelope, no render message, no bell", async () => {
    const s = await seedSent();
    await redact(s.id);
    const { env, q } = makeEnv();
    expect(
      await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "sweep" }),
    ).toBe("skipped");
    expect(await realEnv.DOCS.head(keysOf(s).snapshot)).toBeNull();
    expect(q.sent).toEqual([]);
    expect(await bells(s.id)).toBe(0);
  });

  it("redacted while its envelope was being stored: the row is unchanged, the object is deleted, nothing follows", async () => {
    const s = await seedSent();
    const docs = new Proxy(realEnv.DOCS, {
      get(target, key) {
        if (key === "put")
          return async (...a: Parameters<R2Bucket["put"]>) => {
            await redact(s.id);
            return target.put(...a);
          };
        const v = Reflect.get(target, key);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const { env, q } = makeEnv({}, docs);
    expect(await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" })).toBe(
      "skipped",
    );
    expect(await pdfOfRow(s.id)).toEqual({ snapshot_r2_key: null, pdf_r2_key: null, pdf_sha256: null });
    expect(await realEnv.DOCS.head(keysOf(s).snapshot)).toBeNull();
    expect(q.sent).toEqual([]);
  });

  it("the render step skips it without a browser call, even when its PDF was made before (no send is woken)", async () => {
    const s = await seedSent();
    await processSnapshot(makeEnv().env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" });
    await redact(s.id);
    const b = browser();
    const { env, q } = makeEnv(b.binding);
    expect(await processRender(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 }, T0, clock)).toBe(
      "skipped",
    );
    expect(b.calls).toHaveLength(0);
    expect(q.sent).toEqual([]);
    const row = await realEnv.DB.prepare(RENDER_ROW_SQL).bind(s.id).first<{ redacted: number }>();
    expect(row?.redacted).toBe(1);
    // the supplier copy (an invoice-family job) skips a redacted row too: a proposal has none anyway
    expect(
      await processSupplierCopy(env, { v: 1, kind: "pdf.supplier", documentId: s.id, hop: 0 }, T0, clock),
    ).toBe("skipped");
  });

  it("redacted while it was being rendered: the row keeps no PDF, the stored PDF is deleted, no email follows", async () => {
    const s = await seedSent();
    await processSnapshot(makeEnv().env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" });
    const b = browser(async () => {
      await redact(s.id);
    });
    const { env, q } = makeEnv(b.binding);
    await processRender(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 }, T0, clock);
    expect(b.calls).toHaveLength(1);
    expect((await pdfOfRow(s.id))?.pdf_sha256).toBeNull();
    expect(await realEnv.DOCS.head(keysOf(s).pdf)).toBeNull();
    expect(q.sent).toEqual([]);
  });

  it("the sweep leaves it out", async () => {
    const s = await seedSent({ now: Date.now() - 3_600_000 });
    await redact(s.id);
    const { env, q } = makeEnv();
    await processSweep(env, { v: 1, kind: "pdf.sweep", asOf: Date.now() });
    expect(q.sent.map((x) => (x as { documentId?: string }).documentId)).not.toContain(s.id);
    expect(SWEEP_SQL).toContain("documents.redacted_at IS NULL");
  });

  it("a dead letter rings no bell for it", async () => {
    const s = await seedSent();
    await redact(s.id);
    const { env } = makeEnv();
    await processPdfDeadLetter(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 1 });
    await processPdfDeadLetter(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" });
    expect(await bells(s.id)).toBe(0);
  });
});
