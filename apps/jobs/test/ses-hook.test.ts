// M7.2 the SES events hook in the jobs Worker [ADM-MAIL-02, JOB-HOOK-01..03; run file C.3 and I "Jobs hook"]: 404 for any other method or path (no D1), 503
// unconfigured with no D1, 401 for a missing header (not counted) and a wrong token (counted, one bell and one `staff.notify` at 5, no write at 50), the previous
// token accepted, 415, 413 streamed, 400 for an unreadable event, another environment or source stored `wrong_env` with nothing else, a delivery, a bounce that
// stops the address, a delivery after a bounce staying bounced, a duplicate with no effect, and logs with no body, token, address or message id. The tokens are
// made-up values built at run time (never a secret-looking literal in the repo).
import { exports, env as realEnv } from "cloudflare:workers";
import { staffNotifyMessage } from "@techaust/core/notifications";
import { describe, expect, it } from "vitest";
import { SES_TOKEN_HEADER, sesHook, tokenMatches, WARM_SES_TOKEN, warmSesHook } from "../src/hooks/ses.ts";
import { HOOK_MAX_BYTES } from "../src/hooks/shared.ts";
import { fakes, logs, makeEnv, mkClient, mkContact, staff, useFakes } from "./billing-fixtures.ts";

useFakes();

/** The test pool's own token (vitest.config.ts builds the same value). */
const TOKEN = ["ses", "events", "token", "made", "up", "for", "tests"].join("-");
const OLD = ["ses", "previous", "token", "made", "up"].join("-");
const enc = new TextEncoder();
let seq = 0;

type HookEnv = { DB: D1Database; EMAIL_QUEUE: Queue; ENVIRONMENT: string };
const hookEnv = (over: Record<string, unknown> = {}) =>
  makeEnv({ SES_EVENTS_TOKEN: TOKEN, ...over }) as unknown as HookEnv;

/** An `email_log` row the consumer wrote for a sent email. */
async function sentLog(to: string, status = "sent") {
  const id = `log-${++seq}-${Date.now()}`;
  const messageId = `0109019a-${seq}-${Date.now()}-000000`;
  await realEnv.DB.prepare(
    "INSERT INTO email_log (id, to_email, template, entity_type, entity_id, ses_message_id, status, created_at, updated_at) VALUES (?1, ?2, 'invoice.sent', 'document_send', ?1, ?3, ?4, 1, 1)",
  )
    .bind(id, to, messageId, status)
    .run();
  return { id, messageId };
}

/** The EventBridge envelope as the SES Developer Guide shows it. */
function envelope(
  kind: "delivery" | "bounce" | "complaint",
  messageId: string,
  o: { to?: string; env?: string | null; source?: string; bounceType?: string; id?: string } = {},
) {
  const detailType = {
    delivery: "Email Delivered",
    bounce: "Email Bounced",
    complaint: "Email Complaint Received",
  }[kind];
  const eventType = { delivery: "Delivery", bounce: "Bounce", complaint: "Complaint" }[kind];
  const detail: Record<string, unknown> = {
    eventType,
    mail: {
      timestamp: "2026-11-05T04:40:02.012Z",
      source: "TecHaust <no-reply@example.test>",
      messageId,
      destination: [o.to ?? "x@example.test"],
      tags:
        o.env === null
          ? { "ses:configuration-set": ["techaust-transactional"] }
          : { env: [o.env ?? "local"] },
    },
  };
  if (kind === "delivery") detail.delivery = { recipients: [o.to ?? "x@example.test"] };
  if (kind === "bounce")
    detail.bounce = {
      bounceType: o.bounceType ?? "Permanent",
      bounceSubType: "General",
      bouncedRecipients: [
        { emailAddress: o.to ?? "x@example.test", diagnosticCode: "smtp; 550 5.1.1 user unknown" },
      ],
    };
  if (kind === "complaint")
    detail.complaint = { complainedRecipients: [{ emailAddress: o.to ?? "x@example.test" }] };
  const id = o.id ?? `${String(++seq).padStart(8, "0")}-3328-fafd-2809-a5e16004f112`;
  return {
    id,
    body: JSON.stringify({
      version: "0",
      id,
      "detail-type": detailType,
      source: o.source ?? "aws.ses",
      account: "123456789012",
      time: "2026-11-05T04:41:05Z",
      region: "ap-south-1",
      resources: [],
      detail,
    }),
  };
}

async function post(
  body: string | ReadableStream,
  headers: Record<string, string> = {},
  e = hookEnv(),
  now?: number,
) {
  return sesHook(
    new Request("https://jobs.example.test/ses", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", [SES_TOKEN_HEADER]: TOKEN, ...headers },
      body,
      ...(typeof body === "string" ? {} : { duplex: "half" }),
    } as RequestInit),
    e,
    now,
  );
}

const logOf = (id: string) =>
  realEnv.DB.prepare("SELECT status, bounce_type, last_event_at FROM email_log WHERE id = ?1")
    .bind(id)
    .first<{ status: string; bounce_type: string | null; last_event_at: number | null }>();
const eventOf = (id: string) =>
  realEnv.DB.prepare("SELECT outcome, email_log_id FROM email_events WHERE id = ?1")
    .bind(id)
    .first<{ outcome: string; email_log_id: string | null }>();
const eventCount = async () =>
  (await realEnv.DB.prepare("SELECT count(*) AS n FROM email_events").first<{ n: number }>())?.n ?? 0;
const suppressed = (email: string) =>
  realEnv.DB.prepare("SELECT reason FROM email_suppressions WHERE email = ?1")
    .bind(email)
    .first<{ reason: string }>();
const failureCount = async (now: number) =>
  (
    await realEnv.DB.prepare("SELECT count FROM hook_failures WHERE key = ?1")
      .bind(`ses:${now - (now % 3_600_000)}`)
      .first<{ count: number }>()
  )?.count ?? 0;

describe("routing (the real Worker)", () => {
  it("404 for GET /ses, /ses/x and a POST elsewhere; nothing touches D1", async () => {
    const before = await eventCount();
    for (const [method, path] of [
      ["GET", "/ses"],
      ["PUT", "/ses"],
      ["POST", "/ses/x"],
      ["POST", "/ses/"],
      ["GET", "/u"],
    ] as const) {
      const res = await exports.default.fetch(
        new Request(`https://jobs.example.test${path}`, {
          method,
          ...(method === "GET" ? {} : { body: "{}", headers: { "content-type": "application/json" } }),
        }),
      );
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(await eventCount()).toBe(before);
  });

  it("POST /ses reaches the hook through the router (401 without the header)", async () => {
    const res = await exports.default.fetch(
      new Request("https://jobs.example.test/ses", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "token_missing" } });
  });
});

describe("POST /ses: the token [JOB-HOOK-01, L1]", () => {
  it("503 when the token is not set, with nothing written", async () => {
    const before = await eventCount();
    const now = 1_950_000_000_000;
    const e = envelope("delivery", "m-unset");
    const res = await post(e.body, {}, hookEnv({ SES_EVENTS_TOKEN: "" }), now);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "hook_unconfigured" } });
    expect(await eventCount()).toBe(before);
    expect(await failureCount(now)).toBe(0);
  });

  it("401 token_missing for no header, not counted", async () => {
    const now = 1_950_100_000_000;
    const res = await post(envelope("delivery", "m").body, { [SES_TOKEN_HEADER]: "" }, hookEnv(), now);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "token_missing" } });
    expect(await failureCount(now)).toBe(0);
  });

  it("401 token_invalid for a wrong token, counted; one bell and one staff.notify at 5; no write past 50; nothing stored", async () => {
    const owner = await staff("owner");
    const now = 1_950_200_000_000;
    const before = await eventCount();
    const wrong = async () =>
      post(envelope("delivery", "m").body, { [SES_TOKEN_HEADER]: `${TOKEN}x` }, hookEnv(), now);
    for (let i = 1; i <= 4; i++) {
      const res = await wrong();
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "token_invalid" } });
    }
    expect(fakes.email).toHaveLength(0);
    await wrong();
    expect(await failureCount(now)).toBe(5);
    const key = `ses:${now - (now % 3_600_000)}`;
    const bell = await realEnv.DB.prepare(
      "SELECT kind, title FROM notifications WHERE user_id = ?1 AND entity_id = ?2",
    )
      .bind(owner.id, key)
      .all();
    expect(bell.results).toEqual([
      {
        kind: "email.hook_token",
        title: "Email delivery updates were refused 5 times this hour (wrong token).",
      },
    ]);
    expect(fakes.email.map((s) => s.body)).toEqual([
      { kind: "staff.notify", bell: "email.hook_token", entityId: key },
    ]);
    expect(staffNotifyMessage.safeParse(fakes.email[0]?.body).success).toBe(true);
    for (let i = 6; i <= 52; i++) await wrong();
    expect(await failureCount(now)).toBe(50);
    expect(fakes.email).toHaveLength(1);
    expect(await eventCount()).toBe(before);
  });

  it("the previous token is accepted; an unset previous token never matches an empty one", async () => {
    const { id, messageId } = await sentLog("prev@example.test");
    const e = envelope("delivery", messageId);
    const res = await post(e.body, { [SES_TOKEN_HEADER]: OLD }, hookEnv({ SES_EVENTS_TOKEN_PREVIOUS: OLD }));
    expect(res.status).toBe(200);
    expect((await logOf(id))?.status).toBe("delivered");
    expect(await tokenMatches("", [undefined, ""])).toBe(false);
    expect(await tokenMatches(TOKEN, [OLD, TOKEN])).toBe(true);
    expect(await tokenMatches(TOKEN.slice(0, -1), [TOKEN])).toBe(false);
    expect(await tokenMatches(`${TOKEN}${TOKEN}`, [TOKEN])).toBe(false);
  });
});

describe("POST /ses: the body", () => {
  it("415 without JSON; 413 over 64 KiB (streamed); 400 for an unreadable event; nothing written", async () => {
    const before = await eventCount();
    expect((await post("{}", { "content-type": "text/plain" })).status).toBe(415);
    const big = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`{"a":"${"x".repeat(HOOK_MAX_BYTES)}"}`));
        c.close();
      },
    });
    expect((await post(big)).status).toBe(413);
    expect((await post(`{"a":"${"x".repeat(HOOK_MAX_BYTES)}"}`)).status).toBe(413); // a declared length above the cap
    for (const body of [
      "not json",
      "[]",
      JSON.stringify({ id: "x", source: "aws.ses" }),
      '{"id":"\uD800"}',
    ]) {
      const res = await post(body);
      expect(res.status, body).toBe(400);
      expect(await res.json()).toEqual({ error: { code: "invalid_event" } });
    }
    const bad = new Uint8Array([0x7b, 0xff, 0x7d]); // not UTF-8
    expect((await post(new Blob([bad]).stream())).status).toBe(400);
    expect(await eventCount()).toBe(before);
  });

  it("another environment, no env tag, or another source: 200, stored wrong_env, the row untouched", async () => {
    const { id, messageId } = await sentLog("env@example.test");
    for (const o of [{ env: "staging" }, { env: null }, { source: "aws.sesx" }] as const) {
      const e = envelope("bounce", messageId, { to: "env@example.test", ...o });
      const res = await post(e.body);
      expect(res.status).toBe(200);
      expect(await eventOf(e.id)).toEqual({ outcome: "wrong_env", email_log_id: null });
    }
    expect((await logOf(id))?.status).toBe("sent");
    expect(await suppressed("env@example.test")).toBeNull();
    expect(logs.join("\n")).toContain('"o":"wrong_env"');
  });

  it("a type we don't handle is stored ignored_type", async () => {
    const { id, messageId } = await sentLog("open@example.test");
    const eventId = `open-${Date.now()}`;
    const res = await post(
      JSON.stringify({
        id: eventId,
        source: "aws.ses",
        "detail-type": "Email Opened",
        detail: { eventType: "Open", mail: { messageId, tags: { env: ["local"] } } },
      }),
    );
    expect(res.status).toBe(200);
    expect(await eventOf(eventId)).toEqual({ outcome: "ignored_type", email_log_id: id });
  });
});

describe("POST /ses: the events [JOB-HOOK-02, L4, L15]", () => {
  it("a delivery moves the row to delivered; a duplicate is 200 with no effect", async () => {
    const { id, messageId } = await sentLog("del@example.test");
    const e = envelope("delivery", messageId, { to: "del@example.test" });
    const now = Date.now();
    const res = await post(e.body, {}, hookEnv(), now);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await logOf(id)).toEqual({ status: "delivered", bounce_type: null, last_event_at: now });
    expect(await eventOf(e.id)).toEqual({ outcome: "applied", email_log_id: id });
    const count = await eventCount();
    const again = await post(e.body, {}, hookEnv(), now + 5_000);
    expect(again.status).toBe(200);
    expect(await eventCount()).toBe(count);
    expect((await logOf(id))?.last_event_at).toBe(now);
    expect(logs.join("\n")).toContain('"o":"duplicate"');
  });

  it("a Permanent bounce stops the address and flags the contact; a delivery after it stays bounced", async () => {
    const owner = await staff("owner");
    const email = `bounce${Date.now()}@example.test`;
    const client = await mkClient();
    const contact = await mkContact(client, { email });
    const { id, messageId } = await sentLog(email);
    const res = await post(envelope("bounce", messageId, { to: email }).body);
    expect(res.status).toBe(200);
    expect(await logOf(id)).toMatchObject({ status: "bounced", bounce_type: "permanent" });
    expect((await suppressed(email))?.reason).toBe("hard_bounce");
    const c = await realEnv.DB.prepare("SELECT bounced_at FROM contacts WHERE id = ?1")
      .bind(contact.id)
      .first<{ bounced_at: number | null }>();
    expect(c?.bounced_at).not.toBeNull();
    const bells = await realEnv.DB.prepare(
      "SELECT kind FROM notifications WHERE user_id = ?1 AND entity_id = ?2",
    )
      .bind(owner.id, id)
      .all();
    expect(bells.results).toEqual([{ kind: "email.bounced" }]);
    const late = envelope("delivery", messageId, { to: email });
    expect((await post(late.body)).status).toBe(200);
    expect((await logOf(id))?.status).toBe("bounced");
    expect((await eventOf(late.id))?.outcome).toBe("stale");
    // No email for a bounce bell (not an emailed kind).
    expect(fakes.email).toHaveLength(0);
  });

  it("a Transient bounce moves the row but stops nothing; a complaint stops the address", async () => {
    const email = `soft${Date.now()}@example.test`;
    const { id, messageId } = await sentLog(email);
    await post(envelope("bounce", messageId, { to: email, bounceType: "Transient" }).body);
    expect(await logOf(id)).toMatchObject({ status: "bounced", bounce_type: "transient" });
    expect(await suppressed(email)).toBeNull();
    await post(envelope("complaint", messageId, { to: email }).body);
    expect((await logOf(id))?.status).toBe("complained");
    expect((await suppressed(email))?.reason).toBe("complaint");
  });

  it("an event for a message we never sent is unknown_message and stops nothing", async () => {
    const e = envelope("bounce", "m-never-sent", { to: "stranger@example.test" });
    expect((await post(e.body)).status).toBe(200);
    expect(await eventOf(e.id)).toEqual({ outcome: "unknown_message", email_log_id: null });
    expect(await suppressed("stranger@example.test")).toBeNull();
  });

  it("a D1 failure is a 500 (EventBridge retries)", async () => {
    const { messageId } = await sentLog("fail@example.test");
    const broken = {
      ...realEnv.DB,
      prepare: realEnv.DB.prepare.bind(realEnv.DB),
      batch: async () => {
        throw new Error("D1 down");
      },
    } as unknown as D1Database;
    const res = await post(envelope("delivery", messageId).body, {}, hookEnv({ DB: broken }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "store_failed" } });
  });

  it("logs hold no body, token, address or message id; one line per call with the status", async () => {
    const email = `quiet${Date.now()}@example.test`;
    const { messageId } = await sentLog(email);
    await post(envelope("bounce", messageId, { to: email }).body);
    await post(envelope("bounce", messageId, { to: email }).body, { [SES_TOKEN_HEADER]: "wrong-token" });
    const all = logs.join("\n");
    for (const secret of [TOKEN, "wrong-token", email, messageId, "550", "diagnostic"])
      expect(all).not.toContain(secret);
    expect(logs.filter((l) => l.includes('"ev":"hook","p":"ses"'))).toHaveLength(2);
  });
});

describe("warm-up", () => {
  it("warmSesHook runs every step with a made-up token and reaches no D1 (5)", async () => {
    const before = await eventCount();
    expect(await warmSesHook()).toBe(5);
    expect(await eventCount()).toBe(before);
    expect(WARM_SES_TOKEN).not.toBe(TOKEN);
  });
});
