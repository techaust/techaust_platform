// JOB-PDF-01 (M4.4): the snapshot step, the render step with its error table, the sweep, the dead-letter bell, the routing, the burst, and
// log hygiene. Documents are sent through the real send statements (test/pdf-seed.ts); Browser Run is a fake binding, the clock is fake.
import { env as realEnv } from "cloudflare:workers";
import { nextUtcMidnight, type PdfMessage, pdfKeys } from "@techaust/core/pdf-jobs";
import { parseEnvelope, verifyEnvelope } from "@techaust/pdf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPdf } from "../src/browser.ts";
import worker from "../src/index.ts";
import type { Clock } from "../src/pacer.ts";
import {
  BELL_COPY,
  BROWSER_ALERT_MS,
  documentLabel,
  enqueueSweep,
  processPdf,
  processPdfDeadLetter,
  processRender,
  processSnapshot,
  processSweep,
  SWEEP_GRACE_MS,
  SWEEP_SQL,
  viewOf,
} from "../src/pdf.ts";
import { PURGE_CRON } from "../src/purge.ts";
import { handleQueue } from "../src/queue.ts";
import { type Seeded, seedSent } from "./pdf-seed.ts";

const T0 = Date.UTC(2026, 9, 26, 6, 0, 0);
/** The owner's integrity line (07-Q Q9, 2026-10-26), word for word, with the document's number. */
const integrityBell = (s: Seeded) =>
  `The PDF of ${s.numberDisplay} didn't match its saved copy, so it wasn't sent. A developer needs to look at it before it can be sent.`;
const failedBell = (s: Seeded) =>
  `The PDF for ${s.numberDisplay} v1 could not be made. Open it to try again.`;
const GONE = "UPDATE clients SET anonymised_at = 1 WHERE id = ?";

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
function fakeBrowser(clock: Clock, answer: (n: number, at: number) => Response | Error) {
  const calls: Call[] = [];
  return {
    calls,
    binding: {
      quickAction: async (_a: "pdf", options: Record<string, unknown>) => {
        calls.push({ at: clock.now(), options });
        const r = answer(calls.length, clock.now());
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

const pdfResponse = (ms = 1500) =>
  new Response(stubPdf(), {
    status: 200,
    headers: { "content-type": "application/pdf", "x-browser-ms-used": String(ms) },
  });

function fakeClock(start = T0) {
  let t = start;
  const clock: Clock = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
  return { clock, at: () => t };
}

function makeEnv(browser: unknown, queue = fakeQueue(), extra: Record<string, string> = {}) {
  const env = {
    DB: realEnv.DB,
    DOCS: realEnv.DOCS,
    ENVIRONMENT: "local",
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    BROWSER: browser,
    PDF_QUEUE: queue,
    ...extra,
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

const keysOf = (s: Seeded, type = "proposal") =>
  pdfKeys({ type, fy: "2026-27", number: s.number, version: 1 });

beforeEach(async () => {
  await realEnv.DB.batch([
    realEnv.DB.prepare("DELETE FROM notifications"),
    realEnv.DB.prepare("DELETE FROM stats_daily WHERE metric LIKE 'pdf.%'"),
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe("R2 If-None-Match on this runtime", () => {
  it("a put with etagDoesNotMatch '*' creates a missing key and returns null for an existing one (Miniflare)", async () => {
    const key = "docs/test/if-none-match.txt";
    const created = await realEnv.DOCS.put(key, "first", { onlyIf: { etagDoesNotMatch: "*" } });
    expect(created).not.toBeNull();
    const again = await realEnv.DOCS.put(key, "second", { onlyIf: { etagDoesNotMatch: "*" } });
    expect(again).toBeNull();
    expect(await (await realEnv.DOCS.get(key))?.text()).toBe("first");
  });
});

describe("the integrity bell's document name", () => {
  it('is the number, else "Untitled" (never the title)', () => {
    expect(documentLabel("TH/PRP/2627/0003")).toBe("TH/PRP/2627/0003");
    expect(documentLabel(null)).toBe("Untitled");
    expect(documentLabel("  ")).toBe("Untitled");
    expect(documentLabel("")).toBe("Untitled");
    expect(BELL_COPY.integrity("Untitled")).toBe(
      "The PDF of Untitled didn't match its saved copy, so it wasn't sent. A developer needs to look at it before it can be sent.",
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the snapshot step", () => {
  it("writes a verified envelope once, sets snapshot_r2_key and queues the render", async () => {
    const s = await seedSent();
    const f = fakeClock();
    const { env, queue } = makeEnv(fakeBrowser(f.clock, () => pdfResponse()).binding);
    expect(await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" })).toBe(
      "queued",
    );
    const keys = keysOf(s);
    const obj = await realEnv.DOCS.get(keys.snapshot);
    expect(obj).not.toBeNull();
    const envelope = parseEnvelope(await (obj as R2ObjectBody).text());
    expect(envelope?.documentId).toBe(s.id);
    expect(envelope?.numberDisplay).toBe(s.numberDisplay);
    expect(envelope?.fy).toBe("2026-27");
    expect(await verifyEnvelope(envelope as NonNullable<typeof envelope>)).toEqual({ ok: true });
    expect(
      (await one<{ snapshot_r2_key: string }>("SELECT snapshot_r2_key FROM documents WHERE id = ?", s.id))
        ?.snapshot_r2_key,
    ).toBe(keys.snapshot);
    expect(queue.sent).toEqual([{ body: { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 } }]);
  });

  it("is idempotent: a second run writes nothing again and queues the render again", async () => {
    const s = await seedSent();
    const { env, queue } = makeEnv({});
    const msg = { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "retry" } as const;
    await processSnapshot(env, msg);
    const first = await realEnv.DOCS.get(keysOf(s).snapshot);
    const etag = first?.etag;
    const text = await first?.text();
    expect(await processSnapshot(env, msg)).toBe("queued");
    const second = await realEnv.DOCS.get(keysOf(s).snapshot);
    expect(second?.etag).toBe(etag);
    expect(await second?.text()).toBe(text);
    expect(queue.sent).toHaveLength(2);
  });

  it("never overwrites: a different object on the key refuses, rings the owners' bell and queues nothing", async () => {
    const s = await seedSent();
    await realEnv.DOCS.put(keysOf(s).snapshot, "something else");
    const { env, queue } = makeEnv({});
    expect(await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" })).toBe(
      "refused",
    );
    expect(await (await realEnv.DOCS.get(keysOf(s).snapshot))?.text()).toBe("something else");
    expect(queue.sent).toEqual([]);
    expect(await all("SELECT kind, title FROM notifications WHERE entity_id = ?", s.id)).toEqual([
      { kind: "pdf.failed", title: integrityBell(s) },
    ]);
  });

  it("refuses rows that no longer match their terms hash: nothing is written, the owners are told", async () => {
    const s = await seedSent({ badTermsHash: true });
    const { env, queue } = makeEnv({});
    expect(await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" })).toBe(
      "refused",
    );
    expect(await realEnv.DOCS.head(keysOf(s).snapshot)).toBeNull();
    expect(queue.sent).toEqual([]);
    expect((await all("SELECT user_id FROM notifications WHERE kind = 'pdf.failed'")).length).toBeGreaterThan(
      0,
    );
  });

  it("skips a document whose client is anonymised: no envelope, no queue message, no bell", async () => {
    const s = await seedSent();
    await realEnv.DB.prepare(GONE).bind(s.clientId).run();
    const { env, queue } = makeEnv({});
    expect(
      await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "retry" }),
    ).toBe("skipped");
    expect(await realEnv.DOCS.head(keysOf(s).snapshot)).toBeNull();
    expect(queue.sent).toEqual([]);
    expect(await all("SELECT 1 FROM notifications WHERE entity_id = ?", s.id)).toHaveLength(0);
  });

  it("skips a missing document, a draft and one that already has its PDF", async () => {
    const { env, queue } = makeEnv({});
    const msg = (documentId: string) =>
      ({ v: 1, kind: "pdf.snapshot", documentId, reason: "sweep" }) as const;
    expect(await processSnapshot(env, msg("no-such-id"))).toBe("skipped");
    const s = await seedSent();
    await realEnv.DB.prepare("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = 'h' WHERE id = ?")
      .bind(s.id)
      .run();
    expect(await processSnapshot(env, msg(s.id))).toBe("skipped");
    await realEnv.DB.prepare(
      "INSERT INTO documents (id, type, status, client_id, version_group_id, version, currency) VALUES ('draft-pdf', 'proposal', 'draft', ?1, 'draft-pdf', 1, 'INR')",
    )
      .bind(s.clientId)
      .run();
    expect(await processSnapshot(env, msg("draft-pdf"))).toBe("skipped");
    expect(queue.sent).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the render step", () => {
  const render = (documentId: string, hop = 0) => ({ v: 1, kind: "pdf.render", documentId, hop }) as const;

  async function readyDoc() {
    const s = await seedSent();
    const { env: e0 } = makeEnv({});
    await processSnapshot(e0, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" });
    return s;
  }

  it("skips a render whose client was anonymised while it waited: no browser call, no PDF, no row change", async () => {
    const s = await readyDoc();
    await realEnv.DB.prepare(GONE).bind(s.clientId).run();
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => pdfResponse(2500));
    const { env } = makeEnv(b.binding);
    expect(await processRender(env, render(s.id), T0, f.clock)).toBe("skipped");
    expect(b.calls).toHaveLength(0);
    expect(await realEnv.DOCS.head(keysOf(s).pdf)).toBeNull();
    expect(await one("SELECT 1 FROM documents WHERE id = ? AND pdf_sha256 IS NULL", s.id)).not.toBeNull();
  });

  it("renders from the R2 envelope, stores the PDF once, sets the row and counts it", async () => {
    const s = await readyDoc();
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => pdfResponse(2500));
    const { env } = makeEnv(b.binding);
    expect(await processRender(env, render(s.id), T0, f.clock)).toBe("rendered");
    expect(b.calls).toHaveLength(1);
    const call = b.calls[0] as Call;
    expect(call.options).toMatchObject({ setJavaScriptEnabled: false, cacheTTL: 0 });
    expect(call.options.pdfOptions).toMatchObject({ preferCSSPageSize: true, tagged: true, outline: true });
    const html = String(call.options.html);
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain(s.numberDisplay);
    // without PORTAL_URL the acceptance box names the production portal
    expect(html).toContain('<span class="accept__link">portal.techaust.com</span>');
    const row = await one<{ pdf_r2_key: string; pdf_sha256: string }>(
      "SELECT pdf_r2_key, pdf_sha256 FROM documents WHERE id = ?",
      s.id,
    );
    expect(row?.pdf_r2_key).toBe(keysOf(s).pdf);
    const stored = await realEnv.DOCS.get(keysOf(s).pdf);
    const bytes = new Uint8Array(await (stored as R2ObjectBody).arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
    expect(row?.pdf_sha256).toBe(digest);
    const stats = await all<{ metric: string; value: number; date: string }>(
      "SELECT metric, value, date FROM stats_daily WHERE metric LIKE 'pdf.%' ORDER BY metric",
    );
    expect(stats).toEqual([
      { metric: "pdf.browser_ms", value: 2500, date: "2026-10-26" },
      { metric: "pdf.renders", value: 1, date: "2026-10-26" },
    ]);
  });

  it("prints the host of PORTAL_URL in the acceptance box (no scheme, no trailing slash)", async () => {
    const s = await readyDoc();
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => pdfResponse());
    const { env } = makeEnv(b.binding, fakeQueue(), {
      PORTAL_URL: "https://techaust-platform-portal-staging.techaust-technologies-153.workers.dev/",
    });
    expect(await processRender(env, render(s.id), T0, f.clock)).toBe("rendered");
    const html = String((b.calls[0] as Call).options.html);
    expect(html).toContain(
      '<span class="accept__link">techaust-platform-portal-staging.techaust-technologies-153.workers.dev</span>',
    );
    expect(html).not.toContain("https://techaust-platform-portal-staging");
    // the local value from wrangler.jsonc, through the same helper
    const stored = parseEnvelope(await ((await realEnv.DOCS.get(keysOf(s).snapshot)) as R2ObjectBody).text());
    expect(stored).not.toBeNull();
    expect(viewOf(realEnv, stored as NonNullable<typeof stored>).portalLink).toBe("localhost:5174");
  });

  it("never renders twice: a second message finds the PDF done, and an orphaned PDF in R2 is adopted", async () => {
    const s = await readyDoc();
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => pdfResponse());
    const { env } = makeEnv(b.binding);
    await processRender(env, render(s.id), T0, f.clock);
    expect(await processRender(env, render(s.id), T0, f.clock)).toBe("skipped");
    expect(b.calls).toHaveLength(1);

    const orphan = await readyDoc();
    await realEnv.DOCS.put(keysOf(orphan).pdf, stubPdf());
    expect(await processRender(env, render(orphan.id), T0, f.clock)).toBe("adopted");
    expect(b.calls).toHaveLength(1);
    expect(
      (await one<{ pdf_sha256: string | null }>("SELECT pdf_sha256 FROM documents WHERE id = ?", orphan.id))
        ?.pdf_sha256,
    ).toHaveLength(64);
  });

  it("a rate limit sends a delayed copy (Retry-After, at least 10 s), counts a hop and acknowledges", async () => {
    const s = await readyDoc();
    const f = fakeClock();
    const b = fakeBrowser(f.clock, (n) =>
      n === 1
        ? new Response("Too many requests", { status: 429, headers: { "retry-after": "37" } })
        : new Response("Too many requests", { status: 429, headers: { "retry-after": "3" } }),
    );
    const { env, queue } = makeEnv(b.binding);
    expect(await processRender(env, render(s.id, 4), T0, f.clock)).toBe("delayed");
    expect(queue.sent).toEqual([{ body: render(s.id, 5), delaySeconds: 37 }]);
    expect(await processRender(env, render(s.id, 5), T0, f.clock)).toBe("delayed");
    expect(queue.sent[1]).toEqual({ body: render(s.id, 6), delaySeconds: 10 });
    expect(await one("SELECT 1 AS x FROM stats_daily WHERE metric = 'pdf.renders'")).toBeNull();
  });

  it("the daily quota waits for the next UTC midnight plus 120 s, counts the hit and rings the bell once a day", async () => {
    const s = await readyDoc();
    const f = fakeClock();
    const b = fakeBrowser(
      f.clock,
      () => new Response("Browser time limit exceeded for today", { status: 429 }),
    );
    const { env, queue } = makeEnv(b.binding);
    const now = Date.UTC(2026, 9, 26, 23, 0, 0);
    expect(await processRender(env, render(s.id), now, f.clock)).toBe("delayed");
    expect(await processRender(env, render(s.id, 1), now + 1000, f.clock)).toBe("delayed");
    const expected = Math.ceil((nextUtcMidnight(now) + 120_000 - now) / 1000);
    expect(queue.sent[0]).toEqual({ body: render(s.id, 1), delaySeconds: expected });
    expect(expected).toBe(3600 + 120);
    expect(
      (await one<{ value: number }>("SELECT value FROM stats_daily WHERE metric = 'pdf.quota_hits'"))?.value,
    ).toBe(2);
    const bells = await all<{ kind: string; entity_id: string; title: string }>(
      "SELECT kind, entity_id, title FROM notifications",
    );
    expect(bells).toEqual([
      {
        kind: "pdf.quota",
        entity_id: "2026-10-26",
        title: "Today's PDF allowance is used up. Waiting PDFs are made tomorrow.",
      },
    ]);
  });

  it("a quota wait never passes the queue's 24-hour delay limit", async () => {
    const s = await readyDoc();
    const f = fakeClock();
    const b = fakeBrowser(
      f.clock,
      () => new Response("Browser time limit exceeded for today", { status: 429 }),
    );
    const { env, queue } = makeEnv(b.binding);
    await processRender(env, render(s.id), Date.UTC(2026, 9, 26, 0, 0, 1), f.clock);
    // 23 h: an hour under the queue's 24 h retention (midnight is 23 h 59 m away here, so the cap applies).
    expect(queue.sent[0]?.delaySeconds).toBe(82_800);
  });

  it("gives up pacing at the hop cap (the queue's own retries and the dead-letter queue take over)", async () => {
    const s = await readyDoc();
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => new Response("Too many requests", { status: 429 }));
    const { env, queue } = makeEnv(b.binding);
    await expect(processRender(env, render(s.id, 30), T0, f.clock)).rejects.toThrow();
    expect(queue.sent).toEqual([]);
  });

  it.each([
    ["a rejected render (422)", () => new Response("bad", { status: 422 })],
    ["an upstream error (503)", () => new Response("down", { status: 503 })],
    ["a thrown network error", () => new Error("network")],
    [
      "something that is not a PDF",
      () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    ],
  ])("%s throws so the queue retries, and stores nothing", async (_n, answer) => {
    const s = await readyDoc();
    const f = fakeClock();
    const b = fakeBrowser(f.clock, answer);
    const { env, queue } = makeEnv(b.binding);
    await expect(processRender(env, render(s.id), T0, f.clock)).rejects.toThrow();
    expect(await realEnv.DOCS.head(keysOf(s).pdf)).toBeNull();
    expect(queue.sent).toEqual([]);
    expect(
      (await one<{ pdf_sha256: string | null }>("SELECT pdf_sha256 FROM documents WHERE id = ?", s.id))
        ?.pdf_sha256,
    ).toBeNull();
  });

  it("never renders an envelope that fails verification: the owners are told and the browser is not called", async () => {
    const s = await readyDoc();
    const key = keysOf(s).snapshot;
    const text = await (await realEnv.DOCS.get(key))?.text();
    const tampered = JSON.parse(text as string);
    tampered.snapshot.lines[0].description = "Changed after the send";
    await realEnv.DOCS.put(key, JSON.stringify(tampered));
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => pdfResponse());
    const { env } = makeEnv(b.binding);
    expect(await processRender(env, render(s.id), T0, f.clock)).toBe("refused");
    expect(b.calls).toHaveLength(0);
    expect(await all("SELECT kind, title FROM notifications WHERE entity_id = ?", s.id)).toEqual([
      { kind: "pdf.failed", title: integrityBell(s) },
    ]);
  });

  it("asks for the snapshot again when the row has no envelope key; skips what is not a quote", async () => {
    const s = await seedSent();
    const { env, queue } = makeEnv({});
    expect(await processRender(env, render(s.id), T0)).toBe("resnapshot");
    expect(queue.sent).toEqual([{ body: { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "retry" } }]);
    expect(await processRender(env, render("no-such-id"), T0)).toBe("skipped");
  });

  it("rings the half-day bell once, when the day's browser time first reaches 50 %", async () => {
    const a = await readyDoc();
    const b2 = await readyDoc();
    const c = await readyDoc();
    await realEnv.DB.prepare(
      "INSERT INTO stats_daily (date, metric, dimension, value, updated_at) VALUES ('2026-10-26', 'pdf.browser_ms', '', ?1, 1)",
    )
      .bind(BROWSER_ALERT_MS - 3000)
      .run();
    const f = fakeClock();
    const br = fakeBrowser(f.clock, () => pdfResponse(2000));
    const { env } = makeEnv(br.binding);
    await processRender(env, render(a.id), T0, f.clock);
    expect(await all("SELECT 1 FROM notifications WHERE kind = 'pdf.browser_half'")).toHaveLength(0);
    await processRender(env, render(b2.id), T0, f.clock);
    expect(await all("SELECT entity_id, title FROM notifications WHERE kind = 'pdf.browser_half'")).toEqual([
      { entity_id: "2026-10-26", title: "Half of today's PDF allowance is used." },
    ]);
    await processRender(env, render(c.id), T0, f.clock);
    expect(await all("SELECT 1 FROM notifications WHERE kind = 'pdf.browser_half'")).toHaveLength(1);
  });

  it("uses the local stub only when ENVIRONMENT is local", async () => {
    const s = await readyDoc();
    const f = fakeClock();
    const stubbed = makeEnv(undefined, fakeQueue(), { PDF_RENDERER: "stub", ENVIRONMENT: "staging" });
    await expect(processRender(stubbed.env, render(s.id), T0, f.clock)).rejects.toThrow();
    const local = makeEnv(undefined, fakeQueue(), { PDF_RENDERER: "stub", ENVIRONMENT: "local" });
    expect(await processRender(local.env, render(s.id), T0, f.clock)).toBe("rendered");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the sweep", () => {
  it("picks the sent documents without a PDF, oldest first, at most 20, only those older than the grace", async () => {
    const base = Date.now() - 3_600_000;
    const ids: string[] = [];
    for (let i = 0; i < 23; i++) ids.push((await seedSent({ now: base + i * 1000 })).id);
    const fresh = await seedSent({ now: base + 3_000_000 });
    const queue = fakeQueue();
    const { env } = makeEnv({}, queue);
    const picked = await processSweep(env, {
      v: 1,
      kind: "pdf.sweep",
      asOf: base + 3_000_000 + SWEEP_GRACE_MS - 1,
    });
    expect(picked).toBe(20);
    const sent = queue.sent.map((x) => x.body);
    expect(sent.every((b) => b.kind === "pdf.snapshot")).toBe(true);
    const sweepIds = sent.map((b) => (b as { documentId: string }).documentId);
    expect(sweepIds).not.toContain(fresh.id);
    // oldest first: the first 20 of the 23, in order
    expect(sweepIds).toEqual(ids.slice(0, 20));
    expect(sent.every((b) => (b as { reason: string }).reason === "sweep")).toBe(true);
  });

  it("leaves out a document of an anonymised client", async () => {
    const s = await seedSent({ now: Date.now() - 3_600_000 });
    await realEnv.DB.prepare(GONE).bind(s.clientId).run();
    const queue = fakeQueue();
    const { env } = makeEnv({}, queue);
    await processSweep(env, { v: 1, kind: "pdf.sweep", asOf: Date.now() });
    expect(queue.sent.map((x) => (x.body as { documentId?: string }).documentId)).not.toContain(s.id);
  });

  it("leaves out a document that has its PDF", async () => {
    const s = await seedSent({ now: Date.now() - 3_600_000 });
    await realEnv.DB.prepare("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = 'h' WHERE id = ?")
      .bind(s.id)
      .run();
    const queue = fakeQueue();
    const { env } = makeEnv({}, queue);
    await processSweep(env, { v: 1, kind: "pdf.sweep", asOf: Date.now() });
    expect(queue.sent.map((x) => (x.body as { documentId?: string }).documentId)).not.toContain(s.id);
  });

  it("is a single index range scan on documents_pdf_pending", async () => {
    const plan = (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${SWEEP_SQL.replace("?1", "1")}`)).map(
      (r) => r.detail,
    );
    expect(plan.join("\n")).toContain("documents_pdf_pending");
    expect(plan.join("\n")).not.toMatch(/SCAN documents(?! USING)/);
    expect(plan.join("\n")).not.toContain("TEMP B-TREE");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the cron", () => {
  it("enqueues ONE pdf.sweep and ONE offer.sweep (one sendBatch) for its own cron and reads no D1 for them", async () => {
    const dead = new Proxy({}, { get: () => () => Promise.reject(new Error("D1 must not be read")) });
    const { env, queue } = makeEnv({}, fakeQueue(), {});
    await enqueueSweep({ ...env, DB: dead } as unknown as Env, T0);
    expect(queue.sent).toEqual([
      { body: { v: 1, kind: "pdf.sweep", asOf: T0 } },
      { body: { v: 1, kind: "offer.sweep", asOf: T0 } },
    ]);
  });

  it("the scheduled handler sends the sweep with the daily run and nothing for another cron", async () => {
    const q = fakeQueue();
    const base = makeEnv({}, q).env as unknown as Record<string, unknown>;
    const env = {
      ...base,
      LEADS_QUEUE: { sendBatch: async () => undefined },
      EMAIL_QUEUE: { sendBatch: async () => undefined },
      LEAD_PURGE_MODE: "dry_run",
    } as unknown as Env;
    await worker.scheduled?.(
      { cron: "5 4 * * *", scheduledTime: T0 } as ScheduledController,
      env,
      {} as ExecutionContext,
    );
    expect(q.sent).toEqual([]);
    await worker.scheduled?.(
      { cron: PURGE_CRON, scheduledTime: T0 } as ScheduledController,
      env,
      {} as ExecutionContext,
    );
    expect(q.sent).toEqual([
      { body: { v: 1, kind: "pdf.sweep", asOf: T0 } },
      { body: { v: 1, kind: "offer.sweep", asOf: T0 } },
    ]);
  });
});

describe("the queues", () => {
  const batchOf = (queue: string, body: unknown) => {
    const calls = { ack: 0, retry: 0, delay: undefined as number | undefined };
    const batch = {
      queue,
      messages: [
        {
          id: "m1",
          body,
          attempts: 1,
          ack: () => calls.ack++,
          retry: (o?: { delaySeconds?: number }) => {
            calls.retry++;
            calls.delay = o?.delaySeconds;
          },
        },
      ],
    } as unknown as MessageBatch<unknown>;
    return { batch, calls };
  };

  it("routes a snapshot message of techaust-*-pdf to the snapshot step and acknowledges it", async () => {
    const s = await seedSent();
    const { env, queue } = makeEnv({});
    const { batch, calls } = batchOf("techaust-local-pdf", {
      v: 1,
      kind: "pdf.snapshot",
      documentId: s.id,
      reason: "send",
    });
    await handleQueue(batch, env);
    expect(calls.ack).toBe(1);
    expect(queue.sent[0]?.body).toMatchObject({ kind: "pdf.render", documentId: s.id });
  });

  it("acknowledges a PDF body it cannot use, and a PDF body that arrives on the leads queue never becomes a lead", async () => {
    const { env } = makeEnv({});
    const before = (await one<{ n: number }>("SELECT count(*) AS n FROM leads"))?.n;
    for (const [queue, body] of [
      ["techaust-local-pdf", { v: 1, kind: "pdf.render", documentId: "", hop: 0 }],
      ["techaust-local-pdf", { v: 9, kind: "pdf.mystery" }],
      ["techaust-local-leads", { v: 1, kind: "pdf.render", documentId: "x", hop: 0 }],
      ["techaust-local-leads", { kind: "pdf.nonsense" }],
    ] as const) {
      const { batch, calls } = batchOf(queue, body);
      await handleQueue(batch, env);
      expect(calls).toMatchObject({ ack: 1, retry: 0 });
    }
    expect((await one<{ n: number }>("SELECT count(*) AS n FROM leads"))?.n).toBe(before);
  });

  it("a failing render is retried with a delay; the dead-letter queue rings the owners' bell and acknowledges", async () => {
    const s = await seedSent();
    const { env } = makeEnv({});
    const failing = batchOf("techaust-local-pdf", { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 });
    // no envelope key yet: it re-queues the snapshot (an ack); make it throw instead with a missing envelope object
    await realEnv.DB.prepare("UPDATE documents SET snapshot_r2_key = 'docs/missing.json' WHERE id = ?")
      .bind(s.id)
      .run();
    await handleQueue(failing.batch, env);
    expect(failing.calls.retry).toBe(1);
    expect(failing.calls.delay).toBeGreaterThan(0);

    const dead = batchOf("techaust-local-pdf-dlq", { v: 1, kind: "pdf.render", documentId: s.id, hop: 3 });
    await handleQueue(dead.batch, env);
    expect(dead.calls).toMatchObject({ ack: 1, retry: 0 });
    expect(await all("SELECT kind, entity_id FROM notifications WHERE kind = 'pdf.failed'")).toEqual([
      { kind: "pdf.failed", entity_id: s.id },
    ]);
  });

  it("a dead sweep is only logged", async () => {
    const { env } = makeEnv({});
    await processPdfDeadLetter(env, { v: 1, kind: "pdf.sweep", asOf: 1 });
    expect(await all("SELECT 1 FROM notifications")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("JOB-PDF-01 burst: 20 sends", () => {
  it("never calls Browser Run more than once in 10 s, and dead-letters nothing", async () => {
    const f = fakeClock();
    const queue = fakeQueue();
    // the fake behaves like the Free plan: a call less than 10 s after the previous one is a 429
    let last = -Infinity;
    let throttled = 0;
    const b = fakeBrowser(f.clock, (_n, at) => {
      if (at - last < 10_000) {
        throttled++;
        return new Response("Too many requests", { status: 429, headers: { "retry-after": "10" } });
      }
      last = at;
      return pdfResponse(1000);
    });
    const { env } = makeEnv(b.binding, queue, { PDF_MIN_SPACING_MS: "10000" });
    const sent: Seeded[] = [];
    for (let i = 0; i < 20; i++) sent.push(await seedSent());
    // the consumer works one message at a time (max_concurrency 1): drain the queue in order
    for (const s of sent) {
      queue.sent.push({ body: { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" } });
    }
    let handled = 0;
    let dead = 0;
    while (queue.sent.length > 0 && handled < 200) {
      const m = queue.sent.shift() as Sent;
      handled++;
      try {
        await processPdf(env, m.body, f.at(), f.clock);
      } catch {
        dead++;
      }
    }
    expect(throttled).toBe(0);
    expect(dead).toBe(0);
    expect(b.calls).toHaveLength(20);
    for (let i = 1; i < b.calls.length; i++) {
      expect((b.calls[i] as Call).at - (b.calls[i - 1] as Call).at).toBeGreaterThanOrEqual(10_000);
    }
    const done = await one<{ n: number }>(
      `SELECT count(*) AS n FROM documents WHERE id IN (${sent.map(() => "?").join(",")}) AND pdf_sha256 IS NOT NULL`,
      ...sent.map((s) => s.id),
    );
    expect(done?.n).toBe(20);
    expect(await all("SELECT 1 FROM notifications WHERE kind = 'pdf.failed'")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("log hygiene", () => {
  it("no client name, address, GSTIN, terms text or section text reaches a log line", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void lines.push(a.join(" ")));
    const s = await seedSent();
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => pdfResponse());
    const { env } = makeEnv(b.binding);
    await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" });
    await processRender(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 }, T0, f.clock);
    await processSweep(env, { v: 1, kind: "pdf.sweep", asOf: Date.now() });
    await processPdfDeadLetter(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 1 });
    const text = lines.join("\n");
    expect(text.length).toBeGreaterThan(0);
    for (const forbidden of [
      "Sample Client",
      "example.test",
      "19ABCDE",
      "Sample terms",
      "sample summary",
      "Sample Proprietor",
      "Balurghat",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("the dead-letter bell [07-P §4]", () => {
  it("uses the 'PDF failed' line with the number and version read by id, for a render and a snapshot", async () => {
    const s = await seedSent();
    const { env } = makeEnv({});
    await processPdfDeadLetter(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 1 });
    await processPdfDeadLetter(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" });
    const titles = await all<{ title: string }>(
      "SELECT DISTINCT title FROM notifications WHERE entity_id = ? AND kind = 'pdf.failed'",
      s.id,
    );
    expect(titles).toEqual([{ title: failedBell(s) }]);
  });

  it("rings no bell for a document whose client is anonymised", async () => {
    const s = await seedSent();
    await realEnv.DB.prepare(GONE).bind(s.clientId).run();
    const { env } = makeEnv({});
    await processPdfDeadLetter(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 1 });
    expect(await all("SELECT 1 FROM notifications WHERE entity_id = ?", s.id)).toHaveLength(0);
  });
});
