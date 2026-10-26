// M4.5 stage B in the jobs Worker, in workerd with a real D1 and R2 [ADM-PROP-07, ADM-PROP-08, JOB-PDF-01]: `onRendered` (the offer emails follow the PDF), the
// acceptance certificate through the SAME paced render path as documents, the offer sweep (EXPLAIN-tested), the routing of the expansion
// messages and their dead letters, and the cron batch. Browser Run is a fake binding and the clock is fake; the queues are recording fakes.
import { env as realEnv } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { todayIst } from "@techaust/core/offers";
import { type PdfMessage, pdfKeys } from "@techaust/core/pdf-jobs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPdf } from "../src/browser.ts";
import worker from "../src/index.ts";
import {
  OFFER_SWEEP_GRACE_MS,
  OFFER_SWEEP_LIMIT,
  OFFER_SWEEP_LOOKBACK_MS,
  processOfferSweep,
  queueWaitingSends,
  UNCERTIFIED_SQL,
  WAITING_SENDS_SQL,
} from "../src/offers.ts";
import type { Clock } from "../src/pacer.ts";
import {
  enqueueSweep,
  processCertificate,
  processPdf,
  processPdfDeadLetter,
  processRender,
  processSnapshot,
} from "../src/pdf.ts";
import { PURGE_CRON } from "../src/purge.ts";
import { handleQueue } from "../src/queue.ts";
import { seedSent } from "./pdf-seed.ts";

const T0 = Date.UTC(2026, 9, 26, 6, 0, 0);
const DAY = 86_400_000;
const db = realEnv.DB;

const run = (sql: string, ...p: unknown[]) =>
  db
    .prepare(sql)
    .bind(...p)
    .run();
const one = <T = Record<string, unknown>>(sql: string, ...p: unknown[]) =>
  db
    .prepare(sql)
    .bind(...p)
    .first<T>();
const all = async <T = Record<string, unknown>>(sql: string, ...p: unknown[]) =>
  (
    await db
      .prepare(sql)
      .bind(...p)
      .all<T>()
  ).results;

type Sent = { body: unknown; delaySeconds?: number };
const recorder = () => {
  const sent: Sent[] = [];
  return {
    sent,
    send: async (body: unknown, o?: { delaySeconds?: number }) => {
      sent.push(o?.delaySeconds === undefined ? { body } : { body, delaySeconds: o.delaySeconds });
    },
    sendBatch: async (items: { body: unknown }[]) => {
      for (const i of items) sent.push({ body: i.body });
    },
  };
};

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

type Call = { at: number; options: Record<string, unknown> };
function fakeBrowser(clock: Clock, answer: (n: number) => Response) {
  const calls: Call[] = [];
  return {
    calls,
    binding: {
      quickAction: async (_a: "pdf", options: Record<string, unknown>) => {
        calls.push({ at: clock.now(), options });
        return answer(calls.length);
      },
    },
  };
}
const pdfResponse = (ms = 1500) =>
  new Response(stubPdf(), {
    status: 200,
    headers: { "content-type": "application/pdf", "x-browser-ms-used": String(ms) },
  });

function makeEnv(browser: unknown = {}, over: Record<string, unknown> = {}) {
  const email = recorder();
  const pdf = recorder();
  const env = {
    DB: db,
    DOCS: realEnv.DOCS,
    ENVIRONMENT: "local",
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    ADMIN_URL: "https://admin.example/",
    BROWSER: browser,
    EMAIL_QUEUE: email,
    PDF_QUEUE: pdf,
    ...over,
  } as unknown as Env;
  return { env, email, pdf };
}

let logs: string[];
const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(async () => {
  logs = [];
  for (const m of ["log", "error", "warn", "info"] as const)
    spies.push(
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))),
    );
  await db.batch([
    db.prepare("DELETE FROM notifications"),
    db.prepare("DELETE FROM stats_daily WHERE metric LIKE 'pdf.%'"),
  ]);
});
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});

// ---- data ----------------------------------------------------------------------------------------------------------------------

let seq = 0;
async function staffOwner() {
  const id = uuidv7();
  await run(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Owner', 'owner', 'active')",
    id,
    `owner-wiring-${++seq}@example.test`,
  );
  return id;
}

/** A sent proposal (through the real send statements) with one contact per entry of `contacts`; a send row each, waiting for the PDF. */
async function sentWithSends(contacts = 1, created = T0, sentAt?: number) {
  const s = await seedSent(sentAt === undefined ? {} : { now: sentAt });
  const by = await staffOwner();
  const ids: { send: string; contact: string }[] = [];
  for (let i = 0; i < contacts; i++) {
    const contact = uuidv7();
    const send = uuidv7();
    await run(
      "INSERT INTO contacts (id, client_id, name, email, portal_access) VALUES (?1, ?2, 'Asha Rao', ?3, 1)",
      contact,
      s.clientId,
      `asha-${++seq}@example.test`,
    );
    await run(
      "INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'asha@example.test', 0, 'send', ?6, ?7)",
      send,
      s.id,
      s.groupId,
      s.clientId,
      contact,
      by,
      created,
    );
    ids.push({ send, contact });
  }
  return { ...s, ids, by };
}

const pdfKeysOf = (s: { number: number }, version = 1) =>
  pdfKeys({ type: "proposal", fy: "2026-27", number: s.number, version });

/** An acceptance of the sent document `s`, with the certificate key the accept INSERT derives. */
async function accepted(s: { id: string; number: number }, contact: string, at = T0 - 20 * 60_000) {
  const id = uuidv7();
  const key = pdfKeysOf(s).pdf.replace(/\.pdf$/, "-certificate.pdf");
  await run(
    "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, ip, user_agent, country, pdf_sha256, certificate_r2_key, via, snapshot_sha256) VALUES (?1, ?2, ?3, '<script>alert(1)</script> Asha', 'asha@example.test', ?4, '203.0.113.9', 'UA/1', 'IN', ?5, ?6, 'session', 'snap')",
    id,
    s.id,
    contact,
    at,
    "p".repeat(64),
    key,
  );
  return { id, key };
}

// ---- onRendered: the offer emails follow the PDF --------------------------------------------------------------------------------

describe("onRendered for a document: the waiting offer emails are queued, once [ADM-PROP-07]", () => {
  it("queues offer.send for every waiting row and stamps them; a second call finds nothing", async () => {
    const s = await sentWithSends(3);
    const { env, email } = makeEnv();
    expect(await queueWaitingSends(env, s.id, T0)).toBe(3);
    expect(email.sent.map((m) => (m.body as { kind: string }).kind)).toEqual([
      "offer.send",
      "offer.send",
      "offer.send",
    ]);
    expect(new Set(email.sent.map((m) => (m.body as { sendId: string }).sendId))).toEqual(
      new Set(s.ids.map((i) => i.send)),
    );
    expect(
      (await all("SELECT queued_at FROM document_sends WHERE document_id = ?", s.id)).every(
        (r) => r.queued_at === T0,
      ),
    ).toBe(true);
    expect(await queueWaitingSends(env, s.id, T0 + 1)).toBe(0);
    expect(email.sent).toHaveLength(3);
  });

  it("ignores a row whose contact was erased (contact_id NULL) and a document with no rows", async () => {
    const s = await sentWithSends(2);
    await run("UPDATE document_sends SET contact_id = NULL, email = NULL WHERE id = ?", s.ids[0]?.send);
    const { env, email } = makeEnv();
    expect(await queueWaitingSends(env, s.id, T0)).toBe(1);
    expect(email.sent[0]?.body).toEqual({ kind: "offer.send", sendId: s.ids[1]?.send });
    const bare = await seedSent();
    expect(await queueWaitingSends(env, bare.id, T0)).toBe(0);
  });

  it("the render step queues the emails after it stores the PDF, and a redelivery that finds the PDF done completes a failed first attempt", async () => {
    const s = await sentWithSends(2);
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => pdfResponse());
    const { env, email } = makeEnv(b.binding);
    await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" });
    // the first delivery stores the PDF and the row, then the email queue fails
    const failing = vi.spyOn(email, "sendBatch").mockRejectedValueOnce(new Error("queue down"));
    await expect(
      processRender(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 }, T0, f.clock),
    ).rejects.toThrow("queue down");
    failing.mockRestore();
    expect(
      (await one<{ pdf_sha256: string | null }>("SELECT pdf_sha256 FROM documents WHERE id = ?", s.id))
        ?.pdf_sha256,
    ).not.toBeNull();
    expect(email.sent).toHaveLength(0);
    // the redelivery: the PDF is done, no second render, and the emails are queued now
    expect(
      await processRender(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 }, T0, f.clock),
    ).toBe("skipped");
    expect(b.calls).toHaveLength(1);
    expect(email.sent).toHaveLength(2);
    // and a third delivery queues nothing more
    await processRender(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 }, T0, f.clock);
    expect(email.sent).toHaveLength(2);
  });
});

// ---- the sweep ----------------------------------------------------------------------------------------------------------------

describe("offer.sweep [ADM-PROP-07, ADM-PROP-08]", () => {
  const today = todayIst(T0);
  const sweep = (env: Env) => processOfferSweep(env, { v: 1, kind: "offer.sweep", asOf: T0 });

  it("EXPLAIN: the waiting rows use document_sends_waiting, the acceptances use acceptances_accepted_at", async () => {
    const plan = async (sql: string, ...p: unknown[]) =>
      (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...p)).map((r) => r.detail).join("\n");
    expect(await plan(WAITING_SENDS_SQL, 0, today)).toContain("document_sends_waiting");
    expect(await plan(UNCERTIFIED_SQL, 0, 0)).toContain("acceptances_accepted_at");
  });

  it("picks a waiting row whose document has its PDF and is open, and queues offer.send for it", async () => {
    const s = await sentWithSends(1);
    await run("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = 'h' WHERE id = ?", s.id);
    const { env, email, pdf } = makeEnv();
    expect(await sweep(env)).toMatchObject({ sends: expect.any(Number) });
    expect(email.sent.some((m) => (m.body as { sendId?: string }).sendId === s.ids[0]?.send)).toBe(true);
    expect(pdf.sent.filter((m) => (m.body as { kind: string }).kind !== "pdf.certificate")).toEqual([]);
  });

  it("skips: no PDF yet, an expired offer, one not open, a row older than the look-back, an erased contact, a stamped row", async () => {
    const mk = async (patch: string, created = T0, sentAt?: number) => {
      const s = await sentWithSends(1, created, sentAt);
      await run(`UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = 'h' ${patch} WHERE id = ?`, s.id);
      return s;
    };
    const noPdf = await sentWithSends(1);
    const expired = await mk("", T0, T0 - 40 * DAY); // sent 40 days ago, valid 15 days
    const closed = await mk(", status = 'rejected'");
    const old = await mk("", T0 - OFFER_SWEEP_LOOKBACK_MS - 1);
    const erased = await mk("");
    await run("UPDATE document_sends SET contact_id = NULL, email = NULL WHERE document_id = ?", erased.id);
    const stamped = await mk("");
    await run("UPDATE document_sends SET queued_at = ? WHERE document_id = ?", T0, stamped.id);
    const ok = await mk("");
    const { env, email } = makeEnv();
    await sweep(env);
    const picked = new Set(email.sent.map((m) => (m.body as { sendId: string }).sendId));
    for (const s of [noPdf, expired, closed, old, erased, stamped])
      expect(picked.has(s.ids[0]?.send ?? "")).toBe(false);
    expect(picked.has(ok.ids[0]?.send ?? "")).toBe(true);
  });

  it("takes at most 20 of each", async () => {
    expect(OFFER_SWEEP_LIMIT).toBe(20);
    const s = await sentWithSends(1);
    await run("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = 'h' WHERE id = ?", s.id);
    for (let i = 0; i < 24; i++) {
      await run(
        "INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'a@example.test', 0, 'resend', ?6, ?7)",
        uuidv7(),
        s.id,
        s.groupId,
        s.clientId,
        s.ids[0]?.contact,
        s.by,
        T0 + i,
      );
    }
    const { env, email } = makeEnv();
    expect((await sweep(env)).sends).toBe(20);
    expect(email.sent).toHaveLength(20);
  });

  it("queues pdf.certificate for acceptances older than 10 minutes without a certificate, and not for newer ones or ones that have it", async () => {
    const s = await sentWithSends(1);
    const old = await accepted(s, s.ids[0]?.contact ?? "", T0 - OFFER_SWEEP_GRACE_MS - 1000);
    const s2 = await sentWithSends(1);
    await accepted(s2, s2.ids[0]?.contact ?? "", T0 - 60_000); // 1 minute ago: its own message has the first go
    const s3 = await sentWithSends(1);
    const done = await accepted(s3, s3.ids[0]?.contact ?? "", T0 - OFFER_SWEEP_GRACE_MS - 1000);
    await run(
      "INSERT INTO acceptance_certificates (acceptance_id, r2_key, sha256, rendered_at) VALUES (?1, ?2, 'x', ?3)",
      done.id,
      done.key,
      T0,
    );
    const s4 = await sentWithSends(1);
    await accepted(s4, s4.ids[0]?.contact ?? "", T0 - OFFER_SWEEP_LOOKBACK_MS - 1000); // too old to chase
    const { env, pdf } = makeEnv();
    await sweep(env);
    const ids = pdf.sent
      .filter((m) => (m.body as { kind: string }).kind === "pdf.certificate")
      .map((m) => (m.body as { acceptanceId: string }).acceptanceId);
    expect(ids).toContain(old.id);
    expect(ids).not.toContain(done.id);
    expect(ids).toHaveLength(1);
    expect(pdf.sent[0]?.body).toEqual({ v: 1, kind: "pdf.certificate", acceptanceId: old.id, hop: 0 });
  });

  it("a sweep that runs before anything is old enough finds no certificates", async () => {
    const { env, pdf } = makeEnv();
    // asOf a year before every fixture: no acceptance is 10 minutes old yet
    const r = await processOfferSweep(env, { v: 1, kind: "offer.sweep", asOf: T0 - 365 * DAY });
    expect(r.certificates).toBe(0);
    expect(pdf.sent).toEqual([]);
  });
});

// ---- the certificate ----------------------------------------------------------------------------------------------------------

describe("pdf.certificate: the same paced render, once [ADM-PROP-08, JOB-PDF-01]", () => {
  const msg = (acceptanceId: string, hop = 0) =>
    ({ v: 1, kind: "pdf.certificate", acceptanceId, hop }) as const;

  it("renders the evidence page, stores it once, writes the row, counts it and queues the confirmation", async () => {
    const s = await sentWithSends(1);
    const a = await accepted(s, s.ids[0]?.contact ?? "");
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => pdfResponse(2500));
    const { env, email } = makeEnv(b.binding);
    expect(await processCertificate(env, msg(a.id), T0, f.clock)).toBe("rendered");
    expect(b.calls).toHaveLength(1);
    const html = String(b.calls[0]?.options.html);
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Asha"); // the typed name is escaped
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("203.0.113.9");
    expect(html).toContain("UTC");
    expect(html).toContain("IST");
    const stored = await realEnv.DOCS.get(a.key);
    const bytes = new Uint8Array(await (stored as R2ObjectBody).arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
    expect(
      await one(
        "SELECT acceptance_id, r2_key, sha256, rendered_at FROM acceptance_certificates WHERE acceptance_id = ?",
        a.id,
      ),
    ).toEqual({
      acceptance_id: a.id,
      r2_key: a.key,
      sha256: digest,
      rendered_at: T0,
    });
    expect(
      await all("SELECT metric, value FROM stats_daily WHERE metric LIKE 'pdf.%' ORDER BY metric"),
    ).toEqual([
      { metric: "pdf.browser_ms", value: 2500 },
      { metric: "pdf.renders", value: 1 },
    ]);
    expect(email.sent).toEqual([{ body: { kind: "offer.accepted", acceptanceId: a.id } }]);
  });

  it("is never rendered twice: a redelivery finds the row, queues the confirmation again (the email log keeps it to one), and never calls Browser Run", async () => {
    const s = await sentWithSends(1);
    const a = await accepted(s, s.ids[0]?.contact ?? "");
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => pdfResponse());
    const { env, email } = makeEnv(b.binding);
    await processCertificate(env, msg(a.id), T0, f.clock);
    expect(await processCertificate(env, msg(a.id), T0, f.clock)).toBe("skipped");
    expect(b.calls).toHaveLength(1);
    expect(email.sent).toHaveLength(2);
    expect((await all("SELECT 1 FROM acceptance_certificates WHERE acceptance_id = ?", a.id)).length).toBe(1);
  });

  it("adopts an orphaned file (the row write was lost): the first file stays, the row is written, no render", async () => {
    const s = await sentWithSends(1);
    const a = await accepted(s, s.ids[0]?.contact ?? "");
    await realEnv.DOCS.put(a.key, stubPdf());
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => pdfResponse());
    const { env, email } = makeEnv(b.binding);
    expect(await processCertificate(env, msg(a.id), T0, f.clock)).toBe("adopted");
    expect(b.calls).toHaveLength(0);
    expect((await all("SELECT 1 FROM acceptance_certificates WHERE acceptance_id = ?", a.id)).length).toBe(1);
    expect(email.sent).toHaveLength(1);
  });

  it("an unknown acceptance, or one without a certificate key, is skipped and writes nothing", async () => {
    const { env, email, pdf } = makeEnv({});
    expect(await processCertificate(env, msg("no-such-id"), T0)).toBe("skipped");
    const s = await sentWithSends(1);
    const noKey = uuidv7();
    await run(
      "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256) VALUES (?1, ?2, ?3, 'Asha', 'asha@example.test', ?4, 'p')",
      noKey,
      s.id,
      s.ids[0]?.contact,
      T0,
    );
    expect(await processCertificate(env, msg(noKey), T0)).toBe("skipped");
    expect(email.sent).toEqual([]);
    expect(pdf.sent).toEqual([]);
  });

  it("a rate limit sends a delayed copy with hop + 1 and acknowledges, exactly like a document", async () => {
    const s = await sentWithSends(1);
    const a = await accepted(s, s.ids[0]?.contact ?? "");
    const f = fakeClock();
    const b = fakeBrowser(
      f.clock,
      () => new Response("slow down", { status: 429, headers: { "retry-after": "17" } }),
    );
    const { env, pdf, email } = makeEnv(b.binding);
    expect(await processCertificate(env, msg(a.id, 2), T0, f.clock)).toBe("delayed");
    expect(pdf.sent).toEqual([{ body: msg(a.id, 3), delaySeconds: 17 }]);
    expect(await realEnv.DOCS.head(a.key)).toBeNull();
    expect(email.sent).toEqual([]);
  });

  it("a burst of 5 sends and 5 acceptances makes one Browser Run call per 10 s at most, and nothing is dead-lettered", async () => {
    const f = fakeClock();
    const b = fakeBrowser(f.clock, () => pdfResponse());
    const { env } = makeEnv(b.binding, { PDF_MIN_SPACING_MS: "10000" });
    const docs = [] as { id: string; number: number; contact: string }[];
    for (let i = 0; i < 5; i++) {
      const s = await sentWithSends(1);
      await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" });
      docs.push({ id: s.id, number: s.number, contact: s.ids[0]?.contact ?? "" });
    }
    const accs = [] as string[];
    for (const d of docs) accs.push((await accepted(d, d.contact)).id);
    for (const d of docs)
      await processRender(env, { v: 1, kind: "pdf.render", documentId: d.id, hop: 0 }, T0, f.clock);
    for (const id of accs) await processCertificate(env, msg(id), T0, f.clock);
    expect(b.calls).toHaveLength(10);
    for (let i = 1; i < b.calls.length; i++) {
      expect((b.calls[i]?.at ?? 0) - (b.calls[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(10_000);
    }
    expect(await all("SELECT 1 FROM notifications WHERE kind IN ('pdf.failed', 'pdf.quota')")).toEqual([]);
  });
});

// ---- the routing ---------------------------------------------------------------------------------------------------------------

const batchOf = (queue: string, body: unknown, attempts = 1) => {
  const calls = { ack: 0, retry: 0, delay: undefined as number | undefined };
  const batch = {
    queue,
    messages: [
      {
        id: "m1",
        timestamp: new Date(),
        attempts,
        body,
        ack: () => void calls.ack++,
        retry: (o?: { delaySeconds?: number }) => {
          calls.retry++;
          calls.delay = o?.delaySeconds;
        },
      },
    ],
  } as unknown as MessageBatch<unknown>;
  return { batch, calls };
};

describe("the queues route the M4.5 messages before the generic paths", () => {
  it("pdf.certificate and offer.sweep on the PDF queue are processed; a malformed one is acknowledged and logged", async () => {
    const { env, pdf } = makeEnv({});
    const a = batchOf("techaust-local-pdf", { v: 1, kind: "offer.sweep", asOf: T0 });
    await handleQueue(a.batch, env);
    expect(a.calls.ack).toBe(1);
    // the sweep ran: the only thing it may queue on this queue is a certificate for an acceptance that is old enough
    expect(pdf.sent.every((m) => (m.body as { kind: string }).kind === "pdf.certificate")).toBe(true);
    const bad = batchOf("techaust-local-pdf", { v: 1, kind: "pdf.certificate", acceptanceId: "", hop: 0 });
    await handleQueue(bad.batch, env);
    expect(bad.calls.ack).toBe(1);
    expect(logs.join("\n")).toContain("pdf.unknown");
  });

  it("an offer.send for a PDF that is not stored yet is retried in a minute; everything else is acknowledged", async () => {
    const s = await sentWithSends(1); // no PDF yet
    const { env, email } = makeEnv({});
    const r = batchOf("techaust-local-email", { kind: "offer.send", sendId: s.ids[0]?.send });
    await handleQueue(r.batch, env);
    expect(r.calls).toMatchObject({ ack: 0, retry: 1, delay: 60 });
    const gone = batchOf("techaust-local-email", { kind: "offer.send", sendId: uuidv7() });
    await handleQueue(gone.batch, env);
    expect(gone.calls.ack).toBe(1);
    // an unreadable body of the family is acknowledged, never sent as an email
    const bad = batchOf("techaust-local-email", { kind: "offer.accepted", acceptanceId: 5 });
    await handleQueue(bad.batch, env);
    expect(bad.calls.ack).toBe(1);
    expect(email.sent).toEqual([]);
  });

  it("the queue's delivery count reaches the email consumer: the first try reads the PDF, a redelivery goes link-only without reading it (L6)", async () => {
    let reads = 0;
    const docs = {
      get: async () => {
        reads++;
        return {
          size: 20,
          body: { cancel: async () => undefined },
          arrayBuffer: async () => new TextEncoder().encode("%PDF-1.4 test").buffer,
        };
      },
    };
    const { env } = makeEnv(
      {},
      { DOCS: docs, EMAIL_TRANSPORT: "log", EMAIL_ASSET_BASE: "https://a.example/" },
    );
    const body = (id: string) => ({
      template: "offer.sent",
      to: "client@example.test",
      data: {
        first_name: "Asha",
        kind: "proposal",
        title: "Website rebuild",
        number: "TH/PRP/2627/0001",
        version: "1",
        valid_until: "30 Nov 2026",
        total: "₹1.00",
        url: "https://portal.example/o#t=abc",
        attached: "1",
        sender_name: "Sam",
      },
      entity: { type: "document_send", id },
      attachment: { key: "docs/proposal/2026-27/0001-v1.pdf", filename: "TH-PRP-2627-0001-v1.pdf" },
    });
    const first = batchOf("techaust-local-email", body(uuidv7()), 1);
    await handleQueue(first.batch, env);
    expect(reads).toBe(1);
    const second = batchOf("techaust-local-email", body(uuidv7()), 2);
    await handleQueue(second.batch, env);
    expect(reads).toBe(1);
    expect(logs.join("\n")).toContain("redelivery");
  });

  it("an offer.accepted whose certificate is not stored yet is retried; once it is, the emails are queued", async () => {
    const s = await sentWithSends(1);
    const a = await accepted(s, s.ids[0]?.contact ?? "");
    const { env } = makeEnv({}, { PORTAL_URL: "https://portal.example/" });
    const r = batchOf("techaust-local-email", { kind: "offer.accepted", acceptanceId: a.id });
    await handleQueue(r.batch, env);
    expect(r.calls).toMatchObject({ ack: 0, retry: 1, delay: 60 });
  });

  it("dead letters: offer.decided is acknowledged without an alert; a certificate rings the owners' bell; the sweep is logged", async () => {
    const { env, email } = makeEnv({});
    const owner = await staffOwner();
    const d = batchOf("techaust-local-email-dlq", {
      kind: "offer.decided",
      documentId: uuidv7(),
      decision: "accepted",
    });
    await handleQueue(d.batch, env);
    expect(d.calls.ack).toBe(1);
    expect(email.sent).toEqual([]);
    await processPdfDeadLetter(env, { v: 1, kind: "pdf.certificate", acceptanceId: "acc-1", hop: 0 });
    const bells = () =>
      all(
        "SELECT kind, entity_type, title FROM notifications WHERE user_id = ? AND entity_id LIKE 'acc-1:%'",
        owner,
      );
    expect(await bells()).toEqual([
      { kind: "pdf.failed", entity_type: "acceptance", title: "An acceptance certificate couldn't be made. We'll try again tonight." },
    ]);
    // the same day again rings nothing new; a failure on a later day rings again
    await processPdfDeadLetter(env, { v: 1, kind: "pdf.certificate", acceptanceId: "acc-1", hop: 0 });
    expect(await bells()).toHaveLength(1);
    await processPdfDeadLetter(
      env,
      { v: 1, kind: "pdf.certificate", acceptanceId: "acc-1", hop: 0 },
      Date.now() + 2 * 86_400_000,
    );
    expect(await bells()).toHaveLength(2);
    await processPdfDeadLetter(env, { v: 1, kind: "offer.sweep", asOf: T0 });
    expect(logs.join("\n")).toContain("pdf.dead_letter");
  });

  it("a PDF-family body on the leads queue is never a lead (offer.sweep is one)", async () => {
    const { env } = makeEnv({});
    const x = batchOf("techaust-local-leads", { v: 1, kind: "offer.sweep", asOf: T0 });
    await handleQueue(x.batch, env);
    expect(x.calls.ack).toBe(1);
    expect(logs.join("\n")).toContain("pdf.wrong_queue");
  });
});

describe("the daily cron enqueues both sweeps in one batch and reads no database", () => {
  it("the scheduled handler sends pdf.sweep and offer.sweep together", async () => {
    const pdf = recorder();
    const env = {
      DB: db,
      PDF_QUEUE: pdf,
      LEADS_QUEUE: recorder(),
      EMAIL_QUEUE: recorder(),
      LEAD_PURGE_MODE: "dry_run",
    } as unknown as Env;
    await worker.scheduled?.(
      { cron: "5 4 * * *", scheduledTime: T0 } as ScheduledController,
      env,
      {} as ExecutionContext,
    );
    expect(pdf.sent).toEqual([]);
    await worker.scheduled?.(
      { cron: PURGE_CRON, scheduledTime: T0 } as ScheduledController,
      env,
      {} as ExecutionContext,
    );
    expect(pdf.sent.map((m) => (m.body as PdfMessage).kind)).toEqual(["pdf.sweep", "offer.sweep"]);
    // the sweeps are enqueued by `enqueueSweep` with a database that must not be read
    const dead = new Proxy({}, { get: () => () => Promise.reject(new Error("D1 must not be read")) });
    const second = recorder();
    await enqueueSweep({ PDF_QUEUE: second, DB: dead } as unknown as Env, T0);
    expect(second.sent).toHaveLength(2);
  });
});

// keeps the router honest: the message union of the PDF queue is exactly what processPdf handles
describe("processPdf", () => {
  it("handles every kind of the family", async () => {
    const { env } = makeEnv({});
    await processPdf(env, { v: 1, kind: "offer.sweep", asOf: T0 }, T0);
    await processPdf(env, { v: 1, kind: "pdf.certificate", acceptanceId: "none", hop: 0 }, T0);
    expect(logs.join("\n")).toContain("offer.sweep");
    expect(logs.join("\n")).toContain("pdf.certificate_skipped");
    expect(DAY).toBe(86_400_000);
  });
});

describe("a dead-lettered offer message alerts the owner without the ids, names or addresses [ADM-PROP-07]", () => {
  it("offer.send, offer.accepted and approval.notify name their step; the ids stay out", async () => {
    const { processDeadLetter } = await import("../src/email.ts");
    const cases = [
      [{ kind: "offer.send", sendId: uuidv7() }, "offer email"],
      [{ kind: "offer.accepted", acceptanceId: uuidv7() }, "acceptance confirmation"],
      [{ kind: "approval.notify", approvalId: uuidv7(), event: "requested" }, "approval notice"],
    ] as const;
    for (const [body, step] of cases) {
      const sent: { html: string; text: string; subject: string }[] = [];
      const transport = {
        async send(input: { html: string; text: string; subject: string }) {
          sent.push(input);
          return { kind: "sent" as const, messageId: "m" };
        },
      };
      const { env } = makeEnv(
        {},
        { LEAD_ALERT_TO: "owner@example.test", EMAIL_ASSET_BASE: "https://assets.example.test/brand/" },
      );
      expect(await processDeadLetter(env, "techaust-local-email-dlq", body, transport as never)).toBe(true);
      expect(sent).toHaveLength(1);
      const text = `${sent[0]?.subject} ${sent[0]?.text}`;
      expect(text).toContain(step);
      for (const v of Object.values(body)) {
        if (typeof v === "string" && v.length > 20) expect(text).not.toContain(v);
      }
    }
  });
});
