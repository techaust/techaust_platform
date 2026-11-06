// M7.4 early check 2, low 4 [FRM-05, ADM-CLI-05; run file docs/runs/m7.4-data-protection.md L23]: a jobs Worker without ERASURE_HASH_KEY still makes a new
// website lead, writing its consent receipt with a NULL hash (the nightly `consent.hash` fills it once the key is set) and logging `erasure.key_missing`; its
// emails stay fail-closed (retried, never sent unchecked), and the queue consumer logs that failure as `erasure.key_missing`, not as a plain `queue.error`.
// Invented data only.
import { env as realEnv } from "cloudflare:workers";
import { type EmailMessage, generateLeadRef, type LeadMessage } from "@techaust/core";
import { addressHash } from "@techaust/core/hmac";
import type { Transport } from "@techaust/email";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processEmail } from "../src/email.ts";
import { ErasureKeyMissing, isErasureKeyMissing, leadHashOrNull } from "../src/erasure.ts";
import { leadId, processLead } from "../src/leads.ts";
import { handleQueue } from "../src/queue.ts";
import { processDp } from "../src/retention.ts";

const KEY = (realEnv as unknown as { ERASURE_HASH_KEY: string }).ERASURE_HASH_KEY;

let queued: unknown[] = [];
const makeEnv = (over: Record<string, unknown> = {}) =>
  ({
    DB: realEnv.DB,
    ENVIRONMENT: "local",
    ERASURE_HASH_KEY: KEY,
    LEAD_ALERT_TO: "owner@example.test",
    EMAIL_ALLOWED_RECIPIENTS: "",
    EMAIL_TRANSPORT: "log",
    ADMIN_URL: "https://admin.example/",
    EMAIL_ASSET_BASE: "https://assets.example.test/brand/",
    EMAIL_QUEUE: {
      sendBatch: async (items: { body: unknown }[]) => {
        for (const i of items) queued.push(i.body);
      },
    },
    LEADS_QUEUE: {
      send: async (body: unknown) => void queued.push(body),
      sendBatch: async (items: { body: unknown }[]) => {
        for (const i of items) queued.push(i.body);
      },
    },
    ...over,
  }) as unknown as Env;
const noKey = () => makeEnv({ ERASURE_HASH_KEY: undefined });

let logs: string[] = [];
const spy = () => {
  logs = [];
  return vi
    .spyOn(console, "log")
    .mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
};
const events = (ev: string) =>
  logs.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.ev === ev);
afterEach(() => {
  vi.restoreAllMocks();
  queued = [];
});

const lead = (email: string): LeadMessage =>
  ({
    kind: "contact",
    payload: {
      name: "Asha Rao",
      email,
      message: "We need our invoices to flow into Tally automatically.",
      marketing: false,
    },
    ref: generateLeadRef(),
    ipHash: "b".repeat(64),
    formVersion: "contact-1",
    noticeVersion: "0.1",
    sourcePage: "/contact",
    submittedAt: Date.now(),
  }) as LeadMessage;

describe("ERASURE_HASH_KEY missing on jobs (early check 2, low 4)", () => {
  it("the helpers: a short or missing key is ErasureKeyMissing; a lead's hash is null then", async () => {
    expect(await leadHashOrNull({}, "a@example.test")).toBeNull();
    expect(await leadHashOrNull({ ERASURE_HASH_KEY: "short" }, "a@example.test")).toBeNull();
    expect(await leadHashOrNull({ ERASURE_HASH_KEY: KEY }, "A@Example.test")).toBe(
      await addressHash(KEY, "a@example.test"),
    );
    expect(isErasureKeyMissing(new ErasureKeyMissing())).toBe(true);
    expect(isErasureKeyMissing(new Error("D1 down"))).toBe(false);
  });

  it("a new website lead is made; its receipt waits with a NULL hash and `erasure.key_missing` is logged; the nightly hash fill stamps it once the key is set", async () => {
    const m = lead(`keyless-${crypto.randomUUID()}@example.test`);
    spy();
    expect(await processLead(noKey(), m)).toBe("created");
    expect(events("erasure.key_missing")).toEqual([expect.objectContaining({ where: "lead", f: 1 })]);
    // no address in the log line
    expect(logs.join("\n")).not.toContain(m.payload.email);
    const receipt = () =>
      realEnv.DB.prepare("SELECT subject_hash, event FROM consent_receipts WHERE lead_id = ?1")
        .bind(leadId(m))
        .first<{ subject_hash: string | null; event: string }>();
    expect(await receipt()).toEqual({ subject_hash: null, event: "grant" });
    // the lead's emails are queued as ever (the email consumer decides)
    expect(queued.length).toBeGreaterThan(0);
    // the key is set: the nightly `consent.hash` fills it (pages of 50, oldest first, so run it until the row has its hash)
    for (let i = 0; i < 20 && (await receipt())?.subject_hash === null; i++)
      await processDp(makeEnv(), { v: 1, kind: "consent.hash" });
    expect((await receipt())?.subject_hash).toBe(await addressHash(KEY, m.payload.email));
  });

  it("emails stay fail-closed: the consumer throws, the queue retries it and logs `erasure.key_missing` with the kind, never `queue.error`", async () => {
    const to = `keyless-mail-${crypto.randomUUID()}@example.test`;
    const email: EmailMessage = {
      template: "lead.acknowledgement",
      to,
      data: { first_name: "Asha", service_name: "Discovery Sprint", ref: "L-KKKKK" },
      entity: { type: "lead", id: "L-KKKKK" },
    };
    const sent: unknown[] = [];
    const transport: Transport = {
      async send(input) {
        sent.push(input);
        return { kind: "sent", messageId: "m-1" };
      },
    };
    await expect(processEmail(noKey(), email, transport)).rejects.toBeInstanceOf(ErasureKeyMissing);
    expect(sent).toEqual([]);
    const message = {
      id: "1",
      timestamp: new Date(),
      body: email,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    spy();
    await handleQueue(
      { queue: "techaust-local-email", messages: [message] } as unknown as MessageBatch<unknown>,
      noKey(),
    );
    expect(message.retry).toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
    expect(events("erasure.key_missing")).toEqual([
      expect.objectContaining({
        queue: "techaust-local-email",
        attempts: 1,
        kind: "lead.acknowledgement",
        f: 1,
      }),
    ]);
    expect(events("queue.error")).toEqual([]);
    expect(logs.join("\n")).not.toContain(to);
  });
});
