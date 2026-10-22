// Lead and email pipeline in workerd with a real D1 [FRM-02, FRM-05, FRM-06, FRM-07, ADM-LEAD-01]. The email queue and the
// transport are recording fakes; the database is the real one with every migration applied.
import { env as realEnv } from "cloudflare:workers";
import { type EmailMessage, generateLeadRef, type LeadMessage } from "@techaust/core";
import type { SendInput, SendResult, Transport } from "@techaust/email";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLAIM_TIMEOUT_MS, emailLogId, processDeadLetter, processEmail } from "../src/email.ts";
import { processLead } from "../src/leads.ts";
import { dlqRetryDelay, handleQueue } from "../src/queue.ts";

const T0 = 1_760_000_000_000;
const HASH = "a".repeat(64);

let queued: EmailMessage[];
const makeEnv = (over: Record<string, unknown> = {}) =>
  ({
    DB: realEnv.DB,
    ENVIRONMENT: "local",
    LEAD_ALERT_TO: "owner@example.test",
    EMAIL_ALLOWED_RECIPIENTS: "",
    EMAIL_TRANSPORT: "log",
    ADMIN_URL: "https://admin.example/",
    EMAIL_ASSET_BASE: "https://assets.example.test/brand/",
    EMAIL_QUEUE: {
      sendBatch: async (items: { body: EmailMessage }[]) => {
        for (const i of items) queued.push(i.body);
      },
    },
    ...over,
  }) as unknown as Env;

const recorder = (results: SendResult[] = []) => {
  const sent: SendInput[] = [];
  const transport: Transport = {
    async send(input) {
      sent.push(input);
      return results.shift() ?? { kind: "sent", messageId: `m-${sent.length}` };
    },
  };
  return { sent, transport };
};

const contactMessage = (over: Partial<LeadMessage> = {}, email = "asha@example.com"): LeadMessage =>
  ({
    kind: "contact",
    payload: {
      name: "Asha Rao",
      email,
      message: "We need our invoices to flow into Tally automatically.",
      marketing: true,
    },
    ref: generateLeadRef(),
    ipHash: HASH,
    formVersion: "contact-1",
    noticeVersion: "0.1",
    sourcePage: "/contact",
    referrerHost: "www.google.com",
    utm: { source: "newsletter", campaign: "launch" },
    submittedAt: T0,
    ...over,
  }) as LeadMessage;

const quoteMessage = (): LeadMessage =>
  ({
    kind: "quote",
    payload: {
      service: "S5",
      goals: "Replace the spreadsheet we use today for orders.",
      tools: ["tally", "excel-sheets"],
      currency: "INR",
      budget: "1l-3l",
      timeline: "asap",
      name: "Meera Iyer",
      email: "meera@example.com",
      country: "IN",
      callWindow: "Weekdays 4 to 6 pm IST",
      marketing: false,
    },
    ref: generateLeadRef(),
    ipHash: "b".repeat(64),
    formVersion: "quote-1",
    noticeVersion: "0.1",
    utm: {},
    currency: "INR",
    submittedAt: T0,
  }) as LeadMessage;

const rows = async <T>(sql: string, ...p: unknown[]) =>
  (
    await realEnv.DB.prepare(sql)
      .bind(...p)
      .all<T>()
  ).results;
const count = async (table: string) =>
  (await realEnv.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;

beforeEach(async () => {
  queued = [];
  await realEnv.DB.batch([
    realEnv.DB.prepare("DELETE FROM leads"),
    realEnv.DB.prepare("DELETE FROM email_log"),
    realEnv.DB.prepare("DELETE FROM email_suppressions"),
    realEnv.DB.prepare("DELETE FROM auth_attempts"),
  ]);
});

describe("lead pipeline [ADM-LEAD-01, FRM-05, FRM-06]", () => {
  it("makes the lead with its consent receipt and attribution, then two emails that end up in email_log", async () => {
    const m = contactMessage();
    expect(await processLead(makeEnv(), m, T0)).toBe("created");

    const [lead] = await rows<Record<string, string | number | null>>("SELECT * FROM leads");
    expect(lead).toMatchObject({
      ref: m.ref,
      source: "web",
      stage: "new",
      form_version: "contact-1",
      contact_name: "Asha Rao",
      contact_email: "asha@example.com",
      source_page: "/contact",
      referrer_host: "www.google.com",
    });
    expect(JSON.parse(lead?.utm as string)).toEqual({ source: "newsletter", campaign: "launch" });
    expect(JSON.parse(lead?.consent as string)).toEqual({
      noticeVersion: "0.1",
      purposes: ["respond_to_enquiry", "marketing_updates"],
      at: T0,
      ipHash: HASH,
      marketing: true,
      withdrawnAt: null,
    });
    // delete_after = submission + 12 months (retention.leadsMonths default)
    expect(new Date(lead?.delete_after as number).toISOString()).toBe(
      new Date(new Date(T0).setUTCMonth(new Date(T0).getUTCMonth() + 12)).toISOString(),
    );

    expect(queued.map((q) => [q.template, q.to])).toEqual([
      ["lead.acknowledgement", "asha@example.com"],
      ["lead.alert", "owner@example.test"],
    ]);
    expect(queued.every((q) => q.entity.type === "lead" && q.entity.id === m.ref)).toBe(true);
    expect(queued[0]?.data.first_name).toBe("Asha");

    const { sent, transport } = recorder();
    for (const q of queued) expect(await processEmail(makeEnv(), q, transport, T0)).toBe("sent");
    expect(sent.map((s) => s.to)).toEqual(["asha@example.com", "owner@example.test"]);
    expect(sent[0]).toMatchObject({
      from: { address: "hello@techaust.com" },
      replyTo: "hello@techaust.com",
      subject: `We've received your request (${m.ref})`,
    });
    const log = await rows<{ status: string; template: string; entity_id: string; ses_message_id: string }>(
      "SELECT * FROM email_log ORDER BY template",
    );
    expect(log.map((r) => [r.template, r.status, r.entity_id])).toEqual([
      ["lead.acknowledgement", "sent", m.ref],
      ["lead.alert", "sent", m.ref],
    ]);
    expect(log[0]?.ses_message_id).toBe("m-1");
  });

  it("stores a quote with its service, budget, tools and call window, and names the service in the emails", async () => {
    const m = quoteMessage();
    expect(await processLead(makeEnv(), m, T0)).toBe("created");
    const [lead] = await rows<Record<string, string | null>>("SELECT * FROM leads");
    expect(lead).toMatchObject({
      service_code: "S5",
      budget_band: "1l-3l",
      timeline: "asap",
      currency: "INR",
      contact_country: "IN",
      call_window: "Weekdays 4 to 6 pm IST",
    });
    expect(JSON.parse(lead?.tools as string)).toEqual(["tally", "excel-sheets"]);
    expect(JSON.parse(lead?.consent as string).purposes).toEqual(["respond_to_enquiry"]);
    expect(queued[1]?.data.service_name).toBe("Custom Web Apps and Business Portals");
  });

  it("the alert shows words, not codes: budget band, timeline, tools, country and currency", async () => {
    await processLead(makeEnv(), quoteMessage(), T0);
    expect(queued[1]?.data).toMatchObject({
      budget_band: "₹1,00,000 to ₹3,00,000",
      timeline: "As soon as possible",
      tools: "Tally, Excel/Sheets",
      country: "India",
      currency: "INR",
      call_window: "Weekdays 4 to 6 pm IST",
    });
    const { sent, transport } = recorder();
    await processEmail(makeEnv(), queued[1] as EmailMessage, transport, T0);
    expect(sent[0]?.subject).toContain("₹1,00,000 to ₹3,00,000 · India");
    expect(sent[0]?.text).not.toMatch(/\b1l-3l\b|\basap\b|excel-sheets/);
    // the logos come from the Worker's EMAIL_ASSET_BASE
    expect(sent[0]?.html).toContain("https://assets.example.test/brand/logo-email-badge%402x.png");
  });

  it("stores the quote link's type and plan on the lead and shows them in the alert", async () => {
    const m = { ...quoteMessage(), type: "pilot", plan: "essential" } as LeadMessage;
    await processLead(makeEnv(), m, T0);
    const [lead] = await rows<Record<string, string | null>>("SELECT request_type, plan FROM leads");
    expect(lead).toEqual({ request_type: "pilot", plan: "essential" });
    expect(queued[1]?.data).toMatchObject({ type: "pilot", plan: "essential" });
  });

  it("keeps no raw address anywhere: the lead, the counters and the queued emails hold only the hash", async () => {
    await processLead(makeEnv(), contactMessage(), T0);
    const dump = JSON.stringify([
      await rows("SELECT * FROM leads"),
      await rows("SELECT * FROM auth_attempts"),
      queued,
    ]);
    expect(dump).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(dump).toContain(HASH);
  });

  it("the 6th submission in 10 minutes from one address creates no lead and no email", async () => {
    const env = makeEnv();
    for (let i = 0; i < 5; i++)
      expect(await processLead(env, contactMessage({}, `a${i}@example.com`), T0 + i)).toBe("created");
    expect(await count("leads")).toBe(5);
    expect(queued).toHaveLength(10);
    expect(await processLead(env, contactMessage({}, "a6@example.com"), T0 + 6)).toBe("limited");
    expect(await count("leads")).toBe(5);
    expect(queued).toHaveLength(10);
    // another address is unaffected, and the window restarts after 10 minutes
    expect(await processLead(env, contactMessage({ ipHash: "c".repeat(64) }, "x@example.com"), T0 + 7)).toBe(
      "created",
    );
    expect(await processLead(env, contactMessage({}, "a7@example.com"), T0 + 10 * 60_000 + 10)).toBe(
      "created",
    );
  });

  it("the 51st submission in a day creates no lead and no email", async () => {
    const env = makeEnv();
    for (let i = 0; i < 50; i++)
      expect(await processLead(env, contactMessage({}, `d${i}@example.com`), T0 + i * 11 * 60_000)).toBe(
        "created",
      );
    expect(await processLead(env, contactMessage({}, "d51@example.com"), T0 + 50 * 11 * 60_000)).toBe(
      "limited",
    );
    expect(await count("leads")).toBe(50);
    expect(queued).toHaveLength(100);
  });

  it("a redelivered message makes no second lead and no second pair of emails", async () => {
    const env = makeEnv();
    const m = contactMessage();
    expect(await processLead(env, m, T0)).toBe("created");
    expect(await processLead(env, m, T0 + 5_000)).toBe("duplicate");
    expect(await count("leads")).toBe(1);
    // the emails are queued again (a crash may have lost them), and the email consumer sends each only once
    const { sent, transport } = recorder();
    for (const q of queued) await processEmail(env, q, transport, T0);
    expect(queued).toHaveLength(4);
    expect(sent).toHaveLength(2);
    expect(await count("email_log")).toBe(2);
    // a redelivery does not move the counters
    const [c] = await rows<{ failures: number }>(
      "SELECT failures FROM auth_attempts WHERE key = ?1",
      `f:10m:${HASH}`,
    );
    expect(c?.failures).toBe(1);
  });

  it("a retry after the emails could not be queued counts once, and makes no second lead", async () => {
    let fail = true;
    const env = makeEnv({
      EMAIL_QUEUE: {
        sendBatch: async (items: { body: EmailMessage }[]) => {
          if (fail) throw new Error("queue down");
          for (const i of items) queued.push(i.body);
        },
      },
    });
    const m = contactMessage();
    await expect(processLead(env, m, T0)).rejects.toThrow("queue down");
    fail = false;
    expect(await processLead(env, m, T0 + 30_000)).toBe("duplicate");
    expect(await count("leads")).toBe(1);
    expect(queued).toHaveLength(2);
    const [c] = await rows<{ failures: number }>(
      "SELECT failures FROM auth_attempts WHERE key = ?1",
      `f:10m:${HASH}`,
    );
    expect(c?.failures).toBe(1);
  });

  it("a redelivery after a reference clash is still found: no third lead, no extra count", async () => {
    const env = makeEnv();
    const first = contactMessage({}, "first@example.com");
    await processLead(env, first, T0);
    const second = contactMessage({ ref: first.ref, submittedAt: T0 + 1 }, "second@example.com");
    expect(await processLead(env, second, T0 + 1)).toBe("created");
    expect(await processLead(env, second, T0 + 2)).toBe("duplicate");
    expect(await count("leads")).toBe(2);
    const [c] = await rows<{ failures: number }>(
      "SELECT failures FROM auth_attempts WHERE key = ?1",
      `f:10m:${HASH}`,
    );
    expect(c?.failures).toBe(2);
    // the redelivered emails carry the lead's real (new) reference
    const stored = await rows<{ ref: string }>(
      "SELECT ref FROM leads WHERE contact_email = 'second@example.com'",
    );
    expect(queued.at(-1)?.entity.id).toBe(stored[0]?.ref);
  });

  it("a reference clash with a different submission gets a new reference, carried by the acknowledgement", async () => {
    const env = makeEnv();
    const first = contactMessage({}, "first@example.com");
    await processLead(env, first, T0);
    queued = [];
    const second = contactMessage({ ref: first.ref, submittedAt: T0 + 1 }, "second@example.com");
    expect(await processLead(env, second, T0 + 1)).toBe("created");
    expect(await count("leads")).toBe(2);
    const refs = await rows<{ ref: string }>("SELECT ref FROM leads ORDER BY created_at, ref");
    expect(new Set(refs.map((r) => r.ref)).size).toBe(2);
    const newRef = queued[0]?.entity.id;
    expect(newRef).not.toBe(first.ref);
    expect(queued[0]?.data.ref).toBe(newRef);
  });

  it("an invalid message is acknowledged and logged, never turned into a lead", async () => {
    const bad = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await processLead(makeEnv(), { kind: "contact", payload: { name: "x" } }, T0)).toBe("invalid");
    expect(await processLead(makeEnv(), "not even an object", T0)).toBe("invalid");
    expect(await count("leads")).toBe(0);
    expect(bad.mock.calls.join("")).not.toContain("not even");
    bad.mockRestore();
  });
});

describe("email consumer [FRM-07]", () => {
  const msg = (to = "asha@example.com", id = "L-AAAAA"): EmailMessage => ({
    template: "lead.acknowledgement",
    to,
    data: { first_name: "Asha", service_name: "Discovery Sprint", ref: id },
    entity: { type: "lead", id },
  });

  it("a suppressed recipient is skipped and never sent", async () => {
    await realEnv.DB.prepare(
      "INSERT INTO email_suppressions (email, reason, at) VALUES ('asha@example.com', 'bounce', ?1)",
    )
      .bind(T0)
      .run();
    const { sent, transport } = recorder();
    expect(await processEmail(makeEnv(), msg("Asha@Example.com"), transport, T0)).toBe("skipped");
    expect(sent).toHaveLength(0);
    const [r] = await rows<{ status: string; error: string }>("SELECT status, error FROM email_log");
    expect(r).toMatchObject({ status: "skipped", error: "suppressed" });
  });

  it("on staging only allow-listed recipients are emailed; others are skipped, not retried", async () => {
    const env = makeEnv({
      ENVIRONMENT: "staging",
      EMAIL_ALLOWED_RECIPIENTS: "admin@techaust.com, Tester@Example.com",
    });
    const { sent, transport } = recorder();
    expect(await processEmail(env, msg("stranger@example.com", "L-BBBBB"), transport, T0)).toBe("skipped");
    expect(await processEmail(env, msg("tester@example.com", "L-CCCCC"), transport, T0)).toBe("sent");
    expect(sent.map((s) => s.to)).toEqual(["tester@example.com"]);
    const log = await rows<{ to_email: string; status: string }>(
      "SELECT to_email, status FROM email_log ORDER BY to_email",
    );
    expect(log.map((r) => [r.to_email, r.status])).toEqual([
      ["stranger@example.com", "skipped"],
      ["tester@example.com", "sent"],
    ]);
  });

  it("a permanent SES error is logged failed and acknowledged; a 5xx stays queued for a retry", async () => {
    const env = makeEnv();
    const perm = recorder([{ kind: "permanent", error: "400 MessageRejected" }]);
    expect(await processEmail(env, msg("a@example.com", "L-DDDDD"), perm.transport, T0)).toBe("failed");
    const retry = recorder([
      { kind: "retry", error: "503" },
      { kind: "sent", messageId: "ok" },
    ]);
    expect(await processEmail(env, msg("b@example.com", "L-EEEEE"), retry.transport, T0)).toBe("retry");
    const mid = await rows<{ to_email: string; status: string; error: string | null }>(
      "SELECT to_email, status, error FROM email_log ORDER BY to_email",
    );
    expect(mid.map((r) => [r.to_email, r.status])).toEqual([
      ["a@example.com", "failed"],
      ["b@example.com", "queued"],
    ]);
    expect(mid[0]?.error).toBe("400 MessageRejected");
    // the redelivery after the 5xx sends it
    expect(await processEmail(env, msg("b@example.com", "L-EEEEE"), retry.transport, T0 + 1)).toBe("sent");
    expect(retry.sent).toHaveLength(2);
    // a message that already ended (failed) is not sent again
    expect(await processEmail(env, msg("a@example.com", "L-DDDDD"), perm.transport, T0 + 2)).toBe(
      "duplicate",
    );
    expect(perm.sent).toHaveLength(1);
  });

  it("an unknown template or a malformed message is dropped as invalid (retrying cannot help)", async () => {
    const { transport } = recorder();
    const odd = { ...msg("c@example.com", "L-FFFFF"), template: "lead.alert" as const, data: {} };
    // 'lead.alert' with no data still renders; force a render error with a template the renderer lacks
    const unknown = { ...odd, template: "nope" } as unknown as EmailMessage;
    expect(await processEmail(makeEnv(), unknown, transport, T0)).toBe("invalid");
    expect(await processEmail(makeEnv(), { to: "x" }, transport, T0)).toBe("invalid");
    expect(await count("email_log")).toBe(0);
  });

  it("a failed status write after a successful send does not send again on redelivery", async () => {
    const { sent, transport } = recorder();
    const flaky = makeEnv({
      // The email consumer only calls prepare(); the write that records `sent` fails once, as a D1 blip would.
      DB: {
        prepare: (sql: string) => {
          const stmt = realEnv.DB.prepare(sql);
          if (!sql.startsWith("UPDATE email_log SET status = ?2")) return stmt;
          return {
            bind: (...args: unknown[]) => ({
              run: async () => {
                if (args[1] === "sent") throw new Error("D1 blip");
                return stmt.bind(...args).run();
              },
            }),
          };
        },
      },
    });
    const m = msg("a@example.com", "L-IIIII");
    expect(await processEmail(flaky, m, transport, T0)).toBe("sent");
    expect(sent).toHaveLength(1);
    // a redelivery of the same message finds the claim still held: "busy" (retried later), nothing is sent now
    expect(await processEmail(makeEnv(), m, transport, T0 + 1_000)).toBe("busy");
    expect(sent).toHaveLength(1);
  });

  it("a database error after the claim gives the claim back, so the redelivery sends exactly once", async () => {
    const { sent, transport } = recorder();
    let fail = true;
    const flaky = makeEnv({
      DB: {
        prepare: (sql: string) => {
          if (fail && sql.includes("FROM email_suppressions")) {
            fail = false;
            throw new Error("D1 blip");
          }
          return realEnv.DB.prepare(sql);
        },
      },
    });
    const m = msg("e@example.com", "L-MMMMM");
    await expect(processEmail(flaky, m, transport, T0)).rejects.toThrow("D1 blip");
    expect(sent).toHaveLength(0);
    expect(await processEmail(makeEnv(), m, transport, T0 + 20_000)).toBe("sent");
    expect(await processEmail(makeEnv(), m, transport, T0 + 40_000)).toBe("duplicate");
    expect(sent).toHaveLength(1);
  });

  it("a claim left behind by a delivery that threw is busy until stale, then sent once (never acked unsent)", async () => {
    const { sent, transport } = recorder();
    const m = msg("f@example.com", "L-NNNNN");
    await realEnv.DB.prepare(
      `INSERT INTO email_log (id, to_email, template, entity_type, entity_id, status, created_at, updated_at)
       VALUES (?1, 'f@example.com', 'lead.acknowledgement', 'lead', 'L-NNNNN', 'sending', ?2, ?2)`,
    )
      .bind(emailLogId(m), Date.now()) // handleQueue uses the real clock: a claim made just now
      .run();
    const busy = { id: "1", timestamp: new Date(), body: m, attempts: 2, ack: vi.fn(), retry: vi.fn() };
    await handleQueue(
      { queue: "techaust-local-email", messages: [busy] } as unknown as MessageBatch<unknown>,
      makeEnv(),
    );
    expect(busy.ack).not.toHaveBeenCalled();
    expect(busy.retry).toHaveBeenCalledWith({ delaySeconds: CLAIM_TIMEOUT_MS / 1_000 + 30 });
    expect(await processEmail(makeEnv(), m, transport, Date.now() + CLAIM_TIMEOUT_MS + 1)).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("two concurrent deliveries of one message send it once", async () => {
    const { sent, transport } = recorder();
    const m = msg("c@example.com", "L-JJJJJ");
    const results = await Promise.all([
      processEmail(makeEnv(), m, transport, T0),
      processEmail(makeEnv(), m, transport, T0),
      processEmail(makeEnv(), m, transport, T0),
    ]);
    expect(results.filter((r) => r === "sent")).toHaveLength(1);
    // the others find the claim held ("busy", retried later) or the email already sent ("duplicate")
    expect(results.filter((r) => r === "busy" || r === "duplicate")).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });

  it("an abandoned claim (older than 5 minutes) can be taken again; a fresh one cannot", async () => {
    const { sent, transport } = recorder();
    const m = msg("d@example.com", "L-KKKKK");
    await realEnv.DB.prepare(
      `INSERT INTO email_log (id, to_email, template, entity_type, entity_id, status, created_at, updated_at)
       VALUES (?1, 'd@example.com', 'lead.acknowledgement', 'lead', 'L-KKKKK', 'sending', ?2, ?2)`,
    )
      .bind(emailLogId(m), T0)
      .run();
    expect(await processEmail(makeEnv(), m, transport, T0 + CLAIM_TIMEOUT_MS - 1)).toBe("busy");
    expect(await processEmail(makeEnv(), m, transport, T0 + CLAIM_TIMEOUT_MS + 1)).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("the queue handler acknowledges a sent email and retries one whose consumer threw", async () => {
    const mk = (body: unknown) => ({
      id: "1",
      timestamp: new Date(),
      body,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    });
    const ok = mk(msg("ok@example.com", "L-GGGGG"));
    await handleQueue(
      { queue: "techaust-local-email", messages: [ok] } as unknown as MessageBatch<unknown>,
      makeEnv(),
    );
    expect(ok.ack).toHaveBeenCalled();
    expect(ok.retry).not.toHaveBeenCalled();

    const broken = mk(msg("boom@example.com", "L-HHHHH"));
    const env = makeEnv({
      DB: {
        prepare: () => {
          throw new Error("D1 down");
        },
      },
    });
    await handleQueue(
      { queue: "techaust-local-email", messages: [broken] } as unknown as MessageBatch<unknown>,
      env,
    );
    expect(broken.retry).toHaveBeenCalled();
    expect(broken.ack).not.toHaveBeenCalled();
  });

  it("unknown queues are acknowledged", async () => {
    const m = { id: "1", timestamp: new Date(), body: {}, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    await handleQueue({ queue: "other", messages: [m] } as unknown as MessageBatch<unknown>, makeEnv());
    expect(m.ack).toHaveBeenCalled();
  });
});

describe("dead-letter queues [FRM-07]", () => {
  it("writes a log line without personal data and alerts LEAD_ALERT_TO directly", async () => {
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sent, transport } = recorder();
    expect(
      await processDeadLetter(makeEnv(), "techaust-staging-leads-dlq", { anything: "x" }, transport),
    ).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "owner@example.test", from: { address: "hello@techaust.com" } });
    expect(sent[0]?.text).toContain("A lead or email failed after 5 tries: open the admin.");
    expect(sent[0]?.text).toContain("https://admin.example/");
    expect(lines.mock.calls.flat().join("")).toContain("queue.dead_letter");
    lines.mockRestore();
  });

  it("the handler acknowledges a dead letter once the alert is sent, and retries when it cannot be sent", async () => {
    const mk = () => ({
      id: "1",
      timestamp: new Date(),
      body: { anything: "x" },
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    });
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    const dead = mk();
    await handleQueue(
      { queue: "techaust-local-leads-dlq", messages: [dead] } as unknown as MessageBatch<unknown>,
      makeEnv(),
    );
    expect(dead.ack).toHaveBeenCalled();

    const failing = recorder([{ kind: "permanent", error: "400" }]);
    expect(await processDeadLetter(makeEnv(), "techaust-local-email-dlq", {}, failing.transport)).toBe(false);
    quiet.mockRestore();
  });

  it("a dead-lettered lead is alerted with its whole summary and the reference in the subject [NFR-7]", async () => {
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});
    const m = { ...quoteMessage(), type: "pilot", plan: "essential" } as LeadMessage;
    const { sent, transport } = recorder();
    expect(await processDeadLetter(makeEnv(), "techaust-staging-leads-dlq", m, transport)).toBe(true);
    const mail = sent[0];
    expect(mail?.to).toBe("owner@example.test");
    expect(mail?.subject).toContain(m.ref);
    expect(mail?.subject).toContain("Failed after 5 tries (techaust-staging-leads-dlq)");
    for (const field of [
      "Meera Iyer",
      "meera@example.com",
      "Replace the spreadsheet we use today for orders.",
      "₹1,00,000 to ₹3,00,000",
      "As soon as possible",
      "Tally, Excel/Sheets",
      "India",
      "Weekdays 4 to 6 pm IST",
      "Type: pilot",
      "Plan: essential",
    ])
      expect(mail?.text, field).toContain(field);
    // the log line carries the reference only
    const logged = lines.mock.calls.flat().join("");
    expect(logged).toContain(m.ref);
    expect(logged).not.toContain("meera");
    expect(logged).not.toContain("Meera");
    lines.mockRestore();
  });

  it("a dead-lettered email names its template and lead reference, not the address", async () => {
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sent, transport } = recorder();
    const body: EmailMessage = {
      template: "lead.alert",
      to: "owner@example.test",
      data: {},
      entity: { type: "lead", id: "L-ABCDE" },
    };
    await realEnv.DB.prepare(
      `INSERT INTO email_log (id, to_email, template, entity_type, entity_id, status, error, created_at, updated_at)
       VALUES (?1, 'owner@example.test', 'lead.alert', 'lead', 'L-ABCDE', 'queued', 'retry: 503', ?2, ?2)`,
    )
      .bind(emailLogId(body), T0)
      .run();
    await processDeadLetter(makeEnv(), "techaust-staging-email-dlq", body, transport);
    expect(sent[0]?.subject).toBe("Failed after 5 tries (techaust-staging-email-dlq): L-ABCDE");
    expect(sent[0]?.text).toContain("Email: lead.alert");
    expect(sent[0]?.text).toContain("Lead: L-ABCDE");
    // its log row ends as failed, never pending
    const row = await realEnv.DB.prepare("SELECT status, error FROM email_log WHERE id = ?1")
      .bind(emailLogId(body))
      .first<{ status: string; error: string }>();
    expect(row).toEqual({ status: "failed", error: "dead-lettered" });
    quiet.mockRestore();
  });

  it("a dead letter whose alert fails is retried with a long delay, not acknowledged", async () => {
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("down", { status: 503 }));
    const env = makeEnv({
      EMAIL_TRANSPORT: "ses",
      SES_ACCESS_KEY_ID: "AKIATEST",
      SES_SECRET_ACCESS_KEY: "secret",
      SES_REGION: "ap-south-1",
      SES_CONFIGURATION_SET: "set",
    });
    const dead = {
      id: "1",
      timestamp: new Date(),
      body: contactMessage(),
      attempts: 3,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await handleQueue(
      { queue: "techaust-staging-leads-dlq", messages: [dead] } as unknown as MessageBatch<unknown>,
      env,
    );
    expect(dead.ack).not.toHaveBeenCalled();
    expect(dead.retry).toHaveBeenCalledWith({ delaySeconds: dlqRetryDelay(3) });
    expect(dlqRetryDelay(1)).toBe(300);
    expect(dlqRetryDelay(3)).toBe(1_200);
    expect(dlqRetryDelay(50)).toBe(4 * 3_600);

    // a throw inside the consumer also retries with the long delay
    const thrown = { ...dead, attempts: 2, ack: vi.fn(), retry: vi.fn(), body: "x" };
    await handleQueue(
      { queue: "techaust-staging-email-dlq", messages: [thrown] } as unknown as MessageBatch<unknown>,
      { ...env, LEAD_ALERT_TO: undefined, ADMIN_URL: undefined } as unknown as Env,
    );
    expect(thrown.ack).not.toHaveBeenCalled();
    expect(thrown.retry).toHaveBeenCalledWith({ delaySeconds: dlqRetryDelay(2) });
    vi.restoreAllMocks();
    quiet.mockRestore();
  });
});
