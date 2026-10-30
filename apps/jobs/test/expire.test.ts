// The expiry of sent proposals and estimates [JOB-CRON-01, ADM-PROP-06; M4.3 item 9]: the cron only enqueues (one message, no D1 read), one page of
// at most 50 per message, the day of validity counts (valid_until = today is not expired), only sent or viewed offers of the two types, one batch
// with a system audit row per document, a continuation for a full page, idempotent, a dead letter acknowledged with no alert, and every statement
// served by an index. Researched 2026-10-29, Contract Act s.6(2) (08-C RB-35).
import { env as realEnv } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { EXPIRE_PAGE, type ExpireMessage, expireMessage, isExpireMessage } from "@techaust/core/expiry";
import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_SQL, EXPIRE_SQL, PICK_SQL, processExpire } from "../src/expire.ts";
import worker from "../src/index.ts";
import { PURGE_CRON } from "../src/purge.ts";
import { handleQueue } from "../src/queue.ts";
import { enqueueStats } from "../src/stats.ts";

const AS_OF = "2026-12-02"; // the IST date of a run at 2026-12-01 22:00 UTC
const SCHEDULED = Date.UTC(2026, 11, 1, 22, 0);
const YESTERDAY = "2026-12-01";
const TOMORROW = "2026-12-03";

type Call = { queue: string; bodies: unknown[] };
let calls: Call[] = [];
const makeEnv = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    DB: realEnv.DB,
    PDF_QUEUE: { sendBatch: async () => undefined }, // the cron also enqueues the PDF sweep and the offer sweep (M4.4, M4.5)
    ENVIRONMENT: "local",
    LEAD_PURGE_MODE: "live",
    LEAD_ALERT_TO: "owner@example.test",
    ADMIN_URL: "https://admin.example/",
    LEADS_QUEUE: {
      sendBatch: async (items: { body: unknown }[]) => {
        calls.push({ queue: "leads", bodies: items.map((i) => i.body) });
      },
    },
    EMAIL_QUEUE: {
      sendBatch: async (items: { body: unknown }[]) => {
        calls.push({ queue: "email", bodies: items.map((i) => i.body) });
      },
    },
    ...over,
  }) as unknown as Env;

const logs: string[] = [];
const origLog = console.log;
const one = async <T>(sql: string, ...binds: unknown[]) =>
  realEnv.DB.prepare(sql)
    .bind(...binds)
    .first<T>();
const all = async <T>(sql: string, ...binds: unknown[]) =>
  (
    await realEnv.DB.prepare(sql)
      .bind(...binds)
      .all<T>()
  ).results;

let n = 0;
let client = "";
async function mkClient() {
  const id = uuidv7();
  n++;
  await realEnv.DB.prepare(
    "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?, ?, 'Example Traders', 'Example', 'business', 'IN', 'unregistered', '19', 'INR')",
  )
    .bind(id, `C-EX${String(n).padStart(4, "0")}`)
    .run();
  return id;
}

/** A sent (frozen) offer, written straight to the table: the real freeze trigger is then what the expiry has to pass. */
async function mkDoc(o: { status: string; validUntil: string | null; type?: string; id?: string }) {
  const id = o.id ?? uuidv7();
  n++;
  await realEnv.DB.prepare(
    `INSERT INTO documents (id, type, status, client_id, currency, version_group_id, version, series, fy, number, number_display, issue_date, valid_until, frozen_at, title)
     VALUES (?1, ?2, ?3, ?4, 'INR', ?1, 1, ?5, '2627', ?6, ?7, '2026-11-01', ?8, ?9, 'A secret title')`,
  )
    .bind(
      id,
      o.type ?? "proposal",
      o.status,
      client,
      o.type === "estimate" ? "estimate" : "proposal",
      o.status === "draft" ? null : n,
      o.status === "draft" ? null : `TH/X/2627/${String(n).padStart(4, "0")}`,
      o.validUntil,
      o.status === "draft" ? null : 1,
    )
    .run();
  return id;
}
const status = async (id: string) =>
  (await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", id))?.status;
/** The audit log is append-only, so a test reads only the rows written after it began. */
let seen = new Set<string>();
const expireAudit = async () =>
  (
    await all<{
      id: string;
      entity_id: string;
      actor_type: string;
      actor_id: string | null;
      summary: string;
    }>("SELECT id, entity_id, actor_type, actor_id, summary FROM audit_log WHERE action = 'document.expire'")
  ).filter((r) => !seen.has(r.id));
const run = (after?: string) =>
  processExpire(makeEnv(), { ...expireMessage(SCHEDULED), ...(after ? { after } : {}) });

beforeEach(async () => {
  calls = [];
  logs.length = 0;
  console.log = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  };
  client ||= await mkClient();
  // Sent documents cannot be deleted (frozen): move the leftovers of an earlier test out of the way instead. Only proposals and estimates:
  // M5.1 gave an invoice its own status flow (documents_invoice_status_flow), which has no `sent` to `revised`.
  await realEnv.DB.prepare(
    "UPDATE documents SET status = 'revised' WHERE status IN ('sent', 'viewed') AND type IN ('proposal', 'estimate')",
  ).run();
  seen = new Set(
    (await all<{ id: string }>("SELECT id FROM audit_log WHERE action = 'document.expire'")).map((r) => r.id),
  );
  return () => {
    console.log = origLog;
  };
});

describe("the message and the cron", () => {
  it("the cron adds ONE expiry message to the statistics batch and reads no D1 for it", async () => {
    const dead = new Proxy({}, { get: () => () => Promise.reject(new Error("D1 must not be read")) });
    await enqueueStats(makeEnv({ DB: dead }), SCHEDULED, [expireMessage(SCHEDULED)]);
    expect(calls).toHaveLength(1); // one sendBatch
    const expiry = calls[0]?.bodies.filter((b) => (b as { kind?: string }).kind === "documents.expire");
    expect(expiry).toEqual([{ kind: "documents.expire", asOf: AS_OF }]);
    expect(isExpireMessage(expiry?.[0])).toBe(true);
  });

  it("the scheduled handler sends it for its own cron only, with the IST date of the run", async () => {
    await worker.scheduled?.(
      { cron: "5 4 * * *", scheduledTime: SCHEDULED } as ScheduledController,
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(calls).toHaveLength(0);
    await worker.scheduled?.(
      { cron: PURGE_CRON, scheduledTime: SCHEDULED } as ScheduledController,
      makeEnv(),
      {} as ExecutionContext,
    );
    const sent = calls.flatMap((c) => c.bodies);
    expect(sent.filter((b) => (b as { kind?: string }).kind === "documents.expire")).toEqual([
      { kind: "documents.expire", asOf: AS_OF },
    ]);
  });
});

describe("which offers expire", () => {
  it("valid_until before today (IST) expires; valid_until today does not (the day counts); a later one does not; no date does not", async () => {
    const yesterday = await mkDoc({ status: "sent", validUntil: YESTERDAY });
    const today = await mkDoc({ status: "sent", validUntil: AS_OF });
    const later = await mkDoc({ status: "sent", validUntil: TOMORROW });
    const none = await mkDoc({ status: "sent", validUntil: null });
    expect(await run()).toEqual({ picked: 1, expired: 1, continued: false });
    expect(await status(yesterday)).toBe("expired");
    expect(await status(today)).toBe("sent");
    expect(await status(later)).toBe("sent");
    expect(await status(none)).toBe("sent");
  });

  it("a viewed offer expires too, and so does an estimate", async () => {
    const viewed = await mkDoc({ status: "viewed", validUntil: YESTERDAY });
    const estimate = await mkDoc({ status: "sent", validUntil: YESTERDAY, type: "estimate" });
    expect((await run()).expired).toBe(2);
    expect(await status(viewed)).toBe("expired");
    expect(await status(estimate)).toBe("expired");
  });

  it("drafts, accepted, rejected, revised and already expired offers are left alone, and so is any other document type", async () => {
    const ids = [];
    for (const s of ["draft", "accepted", "rejected", "revised", "expired"])
      ids.push([s, await mkDoc({ status: s, validUntil: "2026-01-01" })] as const);
    // an invoice-family document never has an offer's validity, even if one were set
    const proforma = await mkDoc({ status: "sent", validUntil: "2026-01-01", type: "proforma" });
    expect(await run()).toEqual({ picked: 0, expired: 0, continued: false });
    for (const [s, id] of ids) expect(await status(id), s).toBe(s);
    expect(await status(proforma)).toBe("sent");
    expect(await expireAudit()).toEqual([]);
  });

  it("the move is allowed by the frozen-document trigger (status stays changeable) and changes nothing else of the document", async () => {
    const id = await mkDoc({ status: "sent", validUntil: YESTERDAY });
    const before = await one<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", id);
    await run();
    const after = await one<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", id);
    expect({ ...after, status: "sent" }).toEqual(before);
    expect(after?.status).toBe("expired");
  });
});

describe("the audit row and idempotence", () => {
  it("one system audit row per expired document: ids, type, version, number and dates; never a title or a section", async () => {
    const a = await mkDoc({ status: "sent", validUntil: YESTERDAY });
    const b = await mkDoc({ status: "viewed", validUntil: "2026-11-20", type: "estimate" });
    await mkDoc({ status: "sent", validUntil: TOMORROW });
    await run();
    const rows = await expireAudit();
    expect(rows.map((r) => r.entity_id).sort()).toEqual([a, b].sort());
    for (const r of rows) {
      expect(r.actor_type).toBe("system");
      expect(r.actor_id).toBeNull();
      const s = JSON.parse(r.summary) as Record<string, unknown>;
      expect(Object.keys(s).sort()).toEqual([
        "asOf",
        "documentId",
        "number",
        "type",
        "validUntil",
        "version",
      ]);
      expect(s.asOf).toBe(AS_OF);
      expect(String(s.number)).toMatch(/^TH\/X\/2627\/\d{4}$/);
    }
    expect(JSON.stringify(rows)).not.toContain("secret");
    expect(JSON.parse(rows.find((r) => r.entity_id === b)?.summary ?? "{}")).toMatchObject({
      type: "estimate",
      validUntil: "2026-11-20",
    });
  });

  it("a rerun and a redelivery find nothing left to do: no second status change, no second audit row", async () => {
    await mkDoc({ status: "sent", validUntil: YESTERDAY });
    await run();
    const first = await expireAudit();
    expect(first).toHaveLength(1);
    expect(await run()).toEqual({ picked: 0, expired: 0, continued: false });
    expect(await expireAudit()).toEqual(first);
  });

  it("a document that was accepted between the pick and the batch is left alone and gets no audit row", async () => {
    const raced = await mkDoc({ status: "sent", validUntil: YESTERDAY });
    const other = await mkDoc({ status: "sent", validUntil: YESTERDAY });
    const db = new Proxy(realEnv.DB, {
      get: (t, p) => {
        if (p === "batch")
          return async (stmts: D1PreparedStatement[]) => {
            await t.prepare("UPDATE documents SET status = 'accepted' WHERE id = ?").bind(raced).run();
            return t.batch(stmts);
          };
        const v = Reflect.get(t, p);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const res = await processExpire(makeEnv({ DB: db }), expireMessage(SCHEDULED));
    expect(res).toMatchObject({ picked: 2, expired: 1 });
    expect(await status(raced)).toBe("accepted");
    expect(await status(other)).toBe("expired");
    expect((await expireAudit()).map((r) => r.entity_id)).toEqual([other]);
  });
});

describe("pages of fifty", () => {
  it("51 due: the first message expires 50 and sends a continuation after the last id; the second expires the last one", async () => {
    const ids: string[] = [];
    for (let i = 0; i < EXPIRE_PAGE + 1; i++)
      ids.push(await mkDoc({ status: "sent", validUntil: YESTERDAY }));
    const first = await run();
    expect(first).toEqual({ picked: EXPIRE_PAGE, expired: EXPIRE_PAGE, continued: true });
    expect(calls).toHaveLength(1);
    const next = calls[0]?.bodies[0] as ExpireMessage;
    expect(next).toMatchObject({ kind: "documents.expire", asOf: AS_OF });
    expect(isExpireMessage(next)).toBe(true);
    expect(
      await all(
        "SELECT 1 FROM documents WHERE status = 'expired' AND id IN (SELECT value FROM json_each(?))",
        JSON.stringify(ids),
      ),
    ).toHaveLength(EXPIRE_PAGE);
    // the continuation, delivered through the queue
    const second = await processExpire(makeEnv(), next);
    expect(second).toEqual({ picked: 1, expired: 1, continued: false });
    expect(await expireAudit()).toHaveLength(EXPIRE_PAGE + 1);
    expect(calls).toHaveLength(1); // no third message
  });

  it("exactly 50 due: a continuation is sent and the next page finds nothing (it ends there)", async () => {
    for (let i = 0; i < EXPIRE_PAGE; i++) await mkDoc({ status: "sent", validUntil: YESTERDAY });
    const first = await run();
    expect(first.continued).toBe(true);
    const next = calls[0]?.bodies[0] as Parameters<typeof processExpire>[1];
    expect(await processExpire(makeEnv(), next)).toEqual({ picked: 0, expired: 0, continued: false });
  });
});

describe("the queue", () => {
  type Msg = { body: unknown; attempts: number; ack: () => void; retry: () => void };
  const batch = (queue: string, bodies: unknown[]) => {
    const acked: unknown[] = [];
    const retried: unknown[] = [];
    const messages: Msg[] = bodies.map((body) => ({
      body,
      attempts: 1,
      ack: () => acked.push(body),
      retry: () => retried.push(body),
    }));
    return { b: { queue, messages } as unknown as MessageBatch<unknown>, acked, retried };
  };
  const leadCount = async () => (await one<{ n: number }>("SELECT count(*) AS n FROM leads"))?.n ?? 0;

  it("an expiry message on the leads queue is processed and acknowledged, and never becomes a lead", async () => {
    const id = await mkDoc({ status: "sent", validUntil: YESTERDAY });
    const before = await leadCount();
    const { b, acked, retried } = batch("techaust-local-leads", [expireMessage(SCHEDULED)]);
    await handleQueue(b, makeEnv());
    expect(acked).toHaveLength(1);
    expect(retried).toHaveLength(0);
    expect(await status(id)).toBe("expired");
    expect(await leadCount()).toBe(before);
  });

  it("a malformed expiry body is acknowledged and logged, changes nothing, and creates no lead", async () => {
    const id = await mkDoc({ status: "sent", validUntil: "2026-01-01" });
    const bad = [
      { kind: "documents.expire" },
      { kind: "documents.expire", asOf: "yesterday" },
      { kind: "documents.expire", asOf: "2026-02-31" },
      { kind: "documents.expire", asOf: AS_OF, after: "" },
    ];
    const before = await leadCount();
    const { b, acked, retried } = batch("techaust-local-leads", bad);
    await handleQueue(b, makeEnv());
    expect(acked).toHaveLength(bad.length);
    expect(retried).toHaveLength(0);
    expect(await leadCount()).toBe(before);
    expect(await status(id)).toBe("sent");
    expect(logs.filter((l) => l.includes('"ev":"documents.expire_unknown"'))).toHaveLength(bad.length);
    expect(calls).toHaveLength(0);
  });

  it("a dead-lettered expiry message is acknowledged and logged, with no alert and no email", async () => {
    const id = await mkDoc({ status: "sent", validUntil: YESTERDAY });
    const { b, acked, retried } = batch("techaust-local-leads-dlq", [
      expireMessage(SCHEDULED),
      { kind: "documents.expire", asOf: "bad" },
    ]);
    await handleQueue(b, makeEnv());
    expect(acked).toHaveLength(2);
    expect(retried).toHaveLength(0);
    expect(logs.filter((l) => l.includes('"ev":"documents.expire_dead_letter"'))).toHaveLength(2);
    expect(calls).toHaveLength(0);
    expect(await status(id)).toBe("sent"); // a dead letter does not run the job
    expect(await leadCount()).toBe(0);
  });

  it("a database error is retried, not acknowledged", async () => {
    const broken = new Proxy(realEnv.DB, {
      get: (t, p) =>
        p === "prepare"
          ? () => ({ bind: () => ({ all: () => Promise.reject(new Error("boom")) }) })
          : Reflect.get(t, p),
    });
    const { b, acked, retried } = batch("techaust-local-leads", [expireMessage(SCHEDULED)]);
    await handleQueue(b, makeEnv({ DB: broken }));
    expect(acked).toHaveLength(0);
    expect(retried).toHaveLength(1);
  });
});

describe("every statement is served by an index (EXPLAIN)", () => {
  const plan = async (sql: string, ...binds: unknown[]) =>
    (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...binds)).map((r) => r.detail).join("\n");

  it("the pick searches documents_status_valid_until, with no scan of documents", async () => {
    const p = await plan(PICK_SQL, "", AS_OF);
    expect(p).toMatch(/SEARCH documents USING INDEX documents_status_valid_until/);
    expect(p).not.toMatch(/SCAN documents/);
  });

  it("the audit insert and the update find their documents by primary key", async () => {
    const pairs = JSON.stringify([["a", "b"]]);
    for (const sql of [AUDIT_SQL, EXPIRE_SQL]) {
      const p = await plan(sql, pairs, AS_OF);
      expect(p, sql).not.toMatch(/SCAN documents/);
      expect(p, sql).toMatch(/SEARCH (documents|d) USING (INDEX sqlite_autoindex_documents_1|PRIMARY KEY)/);
    }
  });
});
