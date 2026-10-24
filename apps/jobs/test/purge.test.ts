// Lead retention clean-up and the duplicate link [ADM-LEAD-05, JOB-CRON-01, FRM-04]: due / not due / converted / legal hold /
// dry run / redelivery / activity after the enqueue; the cron only enqueues; one lead per message.
import { env as realEnv } from "cloudflare:workers";
import {
  deleteAfter,
  deleteAfterSql,
  generateLeadRef,
  LEAD_PURGE_PAGE,
  type LeadMessage,
} from "@techaust/core";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.ts";
import { processLead } from "../src/leads.ts";
import { enqueueDue, PURGE_CRON, purgeLead, SCAN_SQL } from "../src/purge.ts";
import { handleQueue } from "../src/queue.ts";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

let sent: unknown[] = [];
const makeEnv = (mode: "live" | "dry_run" = "live") =>
  ({
    DB: realEnv.DB,
    ENVIRONMENT: "local",
    LEAD_PURGE_MODE: mode,
    LEAD_ALERT_TO: "owner@example.test",
    ADMIN_URL: "https://admin.example/",
    LEADS_QUEUE: {
      sendBatch: async (items: { body: unknown }[]) => {
        sent.push(...items.map((i) => i.body));
      },
    },
    EMAIL_QUEUE: { sendBatch: async () => undefined },
  }) as unknown as Env;

let seq = 0;
async function addLead(
  over: {
    id?: string;
    deleteAfter?: number | null;
    clientId?: string | null;
    hold?: boolean;
    email?: string;
  } = {},
) {
  const id = over.id ?? `lead-${++seq}`;
  await realEnv.DB.prepare(
    `INSERT INTO leads (id, ref, source, contact_name, contact_email, client_id, legal_hold, delete_after, last_activity_at, created_at)
     VALUES (?1, ?2, 'web', 'Asha Rao', ?3, ?4, ?5, ?6, ?7, ?7)`,
  )
    .bind(
      id,
      `L-T${String(seq).padStart(4, "0")}`.slice(0, 7),
      over.email ?? `p${seq}@example.com`,
      over.clientId ?? null,
      over.hold ? 1 : 0,
      over.deleteAfter === undefined ? NOW - DAY : over.deleteAfter,
      NOW - 400 * DAY,
    )
    .run();
  return id;
}
const exists = async (id: string) =>
  (await realEnv.DB.prepare("SELECT 1 AS x FROM leads WHERE id = ?1").bind(id).first()) !== null;
const count = async (table: string, where = "1 = 1") =>
  (await realEnv.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>())?.n ??
  0;

// audit_log is append-only: tests count purge rows against what was there when the test began.
let auditBase = 0;
const purgeAudits = async () => (await count("audit_log", "action = 'lead.purge'")) - auditBase;
const logs: string[] = [];
const origLog = console.log;

beforeEach(async () => {
  sent = [];
  logs.length = 0;
  auditBase = await count("audit_log", "action = 'lead.purge'");
  console.log = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  };
  await realEnv.DB.batch([
    realEnv.DB.prepare("DELETE FROM notifications"),
    realEnv.DB.prepare("DELETE FROM leads"),
    realEnv.DB.prepare("DELETE FROM clients"),
  ]);
  return () => {
    console.log = origLog;
  };
});

describe("enqueueDue: the cron only enqueues [JOB-CRON-01]", () => {
  it("queues one message per due lead and skips not due, converted and held leads", async () => {
    const due = await addLead();
    await addLead({ deleteAfter: NOW + DAY }); // not due
    await addLead({ deleteAfter: null });
    await realEnv.DB.prepare(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency) VALUES ('c1','C0001','A','A','business','IN','unregistered','INR')",
    ).run();
    await addLead({ clientId: "c1" }); // converted
    await addLead({ hold: true }); // legal hold
    const r = await enqueueDue(makeEnv(), NOW);
    expect(r).toEqual({ queued: 1, more: false });
    expect(sent).toEqual([{ kind: "lead.purge", leadId: due }]);
    expect(await count("leads")).toBe(5); // nothing deleted by the enqueue
  });

  it("a dry run logs one count per page and enqueues no per-lead messages", async () => {
    await addLead();
    await addLead();
    const r = await enqueueDue(makeEnv("dry_run"), NOW);
    expect(r).toEqual({ queued: 0, more: false });
    expect(sent).toEqual([]);
    expect(logs.some((l) => l.includes('"ev":"lead.purge_dry_run_page"') && l.includes('"due":2'))).toBe(
      true,
    );
    // The dry-run log line is the report: refs only, never a name or an address.
    const line = logs.find((l) => l.includes('"ev":"lead.purge_dry_run_page"')) ?? "";
    expect(line).toMatch(/"refs":\["L-[^"]+","L-[^"]+"\]/);
    expect(line).not.toMatch(/@|Asha/);
  });

  it("carries a cursor in a scan message when more than one page is due", async () => {
    for (let i = 0; i < LEAD_PURGE_PAGE + 3; i++) await addLead({ deleteAfter: NOW - 1000 + i });
    const first = await enqueueDue(makeEnv(), NOW);
    expect(first).toEqual({ queued: LEAD_PURGE_PAGE, more: true });
    expect(sent).toHaveLength(LEAD_PURGE_PAGE + 1);
    const scan = sent.at(-1) as { kind: string; asOf: number; cursor: { at: number; id: string } };
    expect(scan).toMatchObject({ kind: "lead.purge.scan", asOf: NOW });
    sent = [];
    const second = await enqueueDue(makeEnv(), scan.asOf, scan.cursor);
    expect(second).toEqual({ queued: 3, more: false });
    expect(new Set(sent.map((s) => (s as { leadId: string }).leadId)).size).toBe(3);
  });

  it("the scheduled handler enqueues for its own cron only", async () => {
    await addLead();
    await worker.scheduled?.(
      { cron: "5 4 * * *", scheduledTime: NOW } as ScheduledController,
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(sent).toHaveLength(0);
    await worker.scheduled?.(
      { cron: PURGE_CRON, scheduledTime: NOW } as ScheduledController,
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(sent).toHaveLength(1);
    expect(await count("leads")).toBe(1);
  });
});

describe("purgeLead [ADM-LEAD-05]", () => {
  it("deletes a due lead with its timeline and bell rows and writes one audit row with the reference only", async () => {
    const id = await addLead();
    await realEnv.DB.batch([
      realEnv.DB.prepare(
        "INSERT INTO lead_activities (id, lead_id, kind, body) VALUES ('a1', ?1, 'note', 'private words')",
      ).bind(id),
      realEnv.DB.prepare(
        "INSERT OR IGNORE INTO staff_users (id, email, name, role, status) VALUES ('u-purge', 'purge@example.test', 'Pat', 'owner', 'active')",
      ),
      realEnv.DB.prepare(
        "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link) VALUES ('n1', 'u-purge', 'lead.new', 'lead', ?1, 'New lead: Asha Rao', '/leads/x')",
      ).bind(id),
    ]);
    expect(await purgeLead(makeEnv(), id, NOW)).toBe("deleted");
    expect(await exists(id)).toBe(false);
    expect(await count("lead_activities", "id = 'a1'")).toBe(0);
    expect(await count("notifications", "id = 'n1'")).toBe(0);
    expect(await count("notifications", `entity_id = '${id}'`)).toBe(0);
    const audit = await realEnv.DB.prepare(
      "SELECT actor_type, entity_id, summary FROM audit_log WHERE action = 'lead.purge' AND entity_id = ?1",
    )
      .bind(id)
      .all<{
        actor_type: string;
        entity_id: string;
        summary: string;
      }>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]?.actor_type).toBe("system");
    expect(Object.keys(JSON.parse(audit.results[0]?.summary ?? "{}")).sort()).toEqual(["reason", "ref"]);
    expect(JSON.stringify(audit.results)).not.toMatch(/Asha|example\.com|private/);
    expect(logs.join("\n")).not.toMatch(/Asha|example\.com/);
  });

  it("leaves a lead that is no longer due (an activity after it was enqueued moved its date)", async () => {
    const id = await addLead();
    await realEnv.DB.prepare("UPDATE leads SET delete_after = ?2 WHERE id = ?1")
      .bind(id, NOW + 300 * DAY)
      .run();
    expect(await purgeLead(makeEnv(), id, NOW)).toBe("skipped");
    expect(await exists(id)).toBe(true);
    expect(await purgeAudits()).toBe(0);
  });

  it("leaves a converted lead and a lead under legal hold, even when enqueued", async () => {
    await realEnv.DB.prepare(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency) VALUES ('c1','C0001','A','A','business','IN','unregistered','INR')",
    ).run();
    const converted = await addLead({ clientId: "c1" });
    const held = await addLead({ hold: true });
    expect(await purgeLead(makeEnv(), converted, NOW)).toBe("skipped");
    expect(await purgeLead(makeEnv(), held, NOW)).toBe("skipped");
    expect(await count("leads")).toBe(2);
  });

  it("a redelivered message finds nothing and writes nothing more", async () => {
    const id = await addLead();
    expect(await purgeLead(makeEnv(), id, NOW)).toBe("deleted");
    expect(await purgeLead(makeEnv(), id, NOW)).toBe("skipped");
    expect(await purgeAudits()).toBe(1);
  });

  it("dry run logs the reference and deletes nothing, and is the default for any other value", async () => {
    const id = await addLead();
    expect(await purgeLead(makeEnv("dry_run"), id, NOW)).toBe("dry_run");
    expect(await purgeLead({ ...makeEnv(), LEAD_PURGE_MODE: undefined } as unknown as Env, id, NOW)).toBe(
      "dry_run",
    );
    expect(await exists(id)).toBe(true);
    expect(await purgeAudits()).toBe(0);
    expect(logs.some((l) => l.includes('"ev":"lead.purge_dry_run"') && l.includes('"ref":"L-T'))).toBe(true);
  });

  it("deleting an earlier lead clears the later lead's duplicate link", async () => {
    const earlier = await addLead();
    const later = await addLead({ deleteAfter: NOW + DAY });
    await realEnv.DB.prepare("UPDATE leads SET duplicate_of = ?1 WHERE id = ?2").bind(earlier, later).run();
    expect(await purgeLead(makeEnv(), earlier, NOW)).toBe("deleted");
    const row = await realEnv.DB.prepare("SELECT duplicate_of FROM leads WHERE id = ?1")
      .bind(later)
      .first<{ duplicate_of: string | null }>();
    expect(row?.duplicate_of).toBeNull();
  });
});

describe("the leads queue routes clean-up messages", () => {
  const batch = (body: unknown, queue = "techaust-local-leads") => {
    const calls = { ack: 0, retry: 0 };
    return {
      calls,
      batch: {
        queue,
        messages: [{ body, attempts: 1, ack: () => calls.ack++, retry: () => calls.retry++ }],
      } as unknown as MessageBatch<unknown>,
    };
  };

  it("a purge message deletes its lead; a scan message enqueues the next page; both are acknowledged", async () => {
    // The consumer uses the real clock: a date long past.
    const id = await addLead({ deleteAfter: 1 });
    const a = batch({ kind: "lead.purge", leadId: id });
    await handleQueue(a.batch, makeEnv());
    expect(a.calls).toEqual({ ack: 1, retry: 0 });
    expect(await exists(id)).toBe(false);

    await addLead({ deleteAfter: 1 });
    const b = batch({ kind: "lead.purge.scan", asOf: Date.now() });
    await handleQueue(b.batch, makeEnv());
    expect(b.calls.ack).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("a clean-up message in the dead-letter queue is acknowledged without an alert", async () => {
    const c = batch({ kind: "lead.purge", leadId: "x" }, "techaust-local-leads-dlq");
    await handleQueue(c.batch, makeEnv());
    expect(c.calls).toEqual({ ack: 1, retry: 0 });
  });
});

describe("duplicate link at insert [FRM-04]", () => {
  const msg = (email: string, at: number): LeadMessage =>
    ({
      kind: "contact",
      payload: {
        name: "Asha Rao",
        email,
        message: "Hello there, a question about a project.",
        marketing: false,
      },
      ref: generateLeadRef(),
      ipHash: "d".repeat(64),
      formVersion: "contact-1",
      noticeVersion: "0.1",
      utm: {},
      submittedAt: at,
    }) as LeadMessage;

  it("links a second lead with the same email within 30 days to the first, never merging them", async () => {
    // created_at is the real clock (the column default), so the submission times here are real-clock times.
    const real = Date.now();
    const first = msg("same@example.com", real - 10 * DAY);
    expect(await processLead(makeEnv(), first, real - 10 * DAY)).toBe("created");
    await realEnv.DB.prepare("UPDATE leads SET created_at = ?1 WHERE contact_email = 'same@example.com'")
      .bind(real - 10 * DAY)
      .run();
    const second = { ...msg("same@example.com", real), ipHash: "e".repeat(64) };
    expect(await processLead(makeEnv(), second, real)).toBe("created");
    const rows = (
      await realEnv.DB.prepare(
        "SELECT ref, duplicate_of, id FROM leads WHERE contact_email = 'same@example.com' ORDER BY created_at, rowid",
      ).all<{ ref: string; duplicate_of: string | null; id: string }>()
    ).results;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.duplicate_of).toBeNull();
    expect(rows[1]?.duplicate_of).toBe(rows[0]?.id);
  });

  it("does not link after 30 days or for another address", async () => {
    const real = Date.now();
    await processLead(makeEnv(), msg("far@example.com", real - 40 * DAY), real - 40 * DAY);
    await realEnv.DB.prepare("UPDATE leads SET created_at = ?1 WHERE contact_email = 'far@example.com'")
      .bind(real - 40 * DAY)
      .run();
    const late = { ...msg("far@example.com", real), ipHash: "f".repeat(64) };
    await processLead(makeEnv(), late, real);
    await processLead(makeEnv(), { ...msg("other@example.com", real), ipHash: "9".repeat(64) }, real);
    const n = await count("leads", "duplicate_of IS NOT NULL");
    expect(n).toBe(0);
  });
});

const setRetention = (months: number | null) =>
  months === null
    ? realEnv.DB.prepare("DELETE FROM settings WHERE key = 'retention'").run()
    : realEnv.DB.prepare("INSERT OR REPLACE INTO settings (key, value, version) VALUES ('retention', ?1, 1)")
        .bind(
          JSON.stringify({
            leadsMonths: months,
            emailLogMonths: 13,
            securityLogMonths: 13,
            financialYears: 10,
          }),
        )
        .run();
const sqlDate = async (t: number) =>
  (
    await realEnv.DB.prepare(`SELECT ${deleteAfterSql("?1")} AS d`)
      .bind(t)
      .first<{ d: number }>()
  )?.d;

describe("one retention expression [ADM-SET-09, ADM-LEAD-05]", () => {
  const times = [
    Date.UTC(2026, 9, 24, 10, 30, 15, 123),
    Date.UTC(2026, 0, 31, 23, 59, 59, 999),
    Date.UTC(2027, 1, 28, 0, 0, 0, 0),
    Date.UTC(2028, 1, 29, 12, 0, 0, 1),
  ];

  it("gives the same date as deleteAfter() with the default 12 months, from the stored setting, and never less than 12", async () => {
    await setRetention(null);
    for (const t of times) expect(await sqlDate(t)).toBe(deleteAfter(t, 12));
    await setRetention(18);
    for (const t of times) expect(await sqlDate(t)).toBe(deleteAfter(t, 18));
    await setRetention(3); // below the floor (the settings schema refuses it; the SQL is the second guard)
    for (const t of times) expect(await sqlDate(t)).toBe(deleteAfter(t, 12));
    await setRetention(null);
  });

  it("the jobs insert uses the stored months", async () => {
    await setRetention(24);
    const real = Date.now();
    const m = {
      kind: "contact",
      payload: {
        name: "Rita",
        email: "rita@example.com",
        message: "A question about our books.",
        marketing: false,
      },
      ref: generateLeadRef(),
      ipHash: "a".repeat(64),
      formVersion: "contact-1",
      noticeVersion: "0.1",
      utm: {},
      submittedAt: real,
    } as LeadMessage;
    expect(await processLead(makeEnv(), m, real)).toBe("created");
    const row = await realEnv.DB.prepare(
      "SELECT delete_after, last_activity_at FROM leads WHERE contact_email = 'rita@example.com'",
    ).first<{
      delete_after: number;
      last_activity_at: number;
    }>();
    expect(row?.last_activity_at).toBe(real);
    expect(row?.delete_after).toBe(deleteAfter(real, 24));
    await setRetention(null);
  });
});

describe("queries use their indexes", () => {
  it("the clean-up scan uses the partial index leads_delete_due", async () => {
    const plan = await realEnv.DB.prepare(`EXPLAIN QUERY PLAN ${SCAN_SQL}`)
      .bind(NOW, -1, "")
      .all<{ detail: string }>();
    const text = plan.results.map((r) => r.detail).join(" | ");
    expect(text).toContain("leads_delete_due");
    expect(text).not.toMatch(/SCAN leads(?! USING)/);
  });
});

describe("duplicate link only looks at earlier leads [FRM-04]", () => {
  it("a lead created after the submission time is not the original", async () => {
    const real = Date.now();
    await addLead({ email: "later@example.com" });
    await realEnv.DB.prepare("UPDATE leads SET created_at = ?1 WHERE contact_email = 'later@example.com'")
      .bind(real + DAY)
      .run();
    const m = {
      kind: "contact",
      payload: {
        name: "Asha",
        email: "later@example.com",
        message: "Hello there, a short question.",
        marketing: false,
      },
      ref: generateLeadRef(),
      ipHash: "b".repeat(64),
      formVersion: "contact-1",
      noticeVersion: "0.1",
      utm: {},
      submittedAt: real,
    } as LeadMessage;
    expect(await processLead(makeEnv(), m, real)).toBe("created");
    expect(await count("leads", "contact_email = 'later@example.com' AND duplicate_of IS NOT NULL")).toBe(0);
  });
});
