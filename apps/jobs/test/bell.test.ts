// The bell: a new lead notifies the members who may read leads [ADM-G-09], in the same batch as the lead.
import { env as realEnv } from "cloudflare:workers";
import { type EmailMessage, generateLeadRef, type LeadMessage } from "@techaust/core";
import { beforeEach, describe, expect, it } from "vitest";
import { processLead } from "../src/leads.ts";

const T0 = 1_760_000_000_000;
const HASH = "c".repeat(64);

const makeEnv = () =>
  ({
    DB: realEnv.DB,
    ENVIRONMENT: "local",
    LEAD_ALERT_TO: "owner@example.test",
    ADMIN_URL: "https://admin.example/",
    EMAIL_QUEUE: { sendBatch: async (_items: { body: EmailMessage }[]) => undefined },
    // M7.4 (L23): the lead's consent receipt takes the keyed hash of the address.
    ERASURE_HASH_KEY: (realEnv as unknown as { ERASURE_HASH_KEY: string }).ERASURE_HASH_KEY,
  }) as unknown as Env;

const contact = (over: Partial<LeadMessage> = {}, email = "asha@example.com"): LeadMessage =>
  ({
    kind: "contact",
    payload: {
      name: "Asha Rao",
      email,
      message: "We need our invoices to flow into Tally automatically.",
      marketing: false,
    },
    ref: generateLeadRef(),
    ipHash: HASH,
    formVersion: "contact-1",
    noticeVersion: "0.1",
    utm: {},
    submittedAt: T0,
    ...over,
  }) as LeadMessage;

const quote = (): LeadMessage =>
  ({
    kind: "quote",
    payload: {
      service: "S5",
      goals: "Replace the spreadsheet we use today for orders.",
      tools: ["tally"],
      currency: "INR",
      budget: "1l-3l",
      timeline: "asap",
      name: "Meera Iyer",
      email: "meera@example.com",
      country: "IN",
      marketing: false,
    },
    ref: generateLeadRef(),
    ipHash: "d".repeat(64),
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

const member = (id: string, role: string, status = "active") =>
  realEnv.DB.prepare(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, ?3, ?4, ?5)",
  ).bind(id, `${id}@example.test`, id, role, status);

beforeEach(async () => {
  await realEnv.DB.batch([
    realEnv.DB.prepare("DELETE FROM notifications"),
    realEnv.DB.prepare("DELETE FROM leads"),
    realEnv.DB.prepare("DELETE FROM auth_attempts"),
    realEnv.DB.prepare("DELETE FROM staff_users WHERE id LIKE 'bell-%'"),
    member("bell-owner", "owner"),
    member("bell-staff", "staff"),
    member("bell-sales", "sales"),
    member("bell-acct", "accountant"),
    member("bell-off", "sales", "deactivated"),
  ]);
});

describe("M7.4 (A.3, FRM-05): the new lead's consent receipt", () => {
  it("one grant receipt in the lead's batch, with the keyed hash of the address; a redelivery writes no second", async () => {
    const env = makeEnv();
    const m = quote();
    expect(await processLead(env, m, T0)).toBe("created");
    expect(await processLead(env, m, T0 + 1_000)).toBe("duplicate");
    const [lead] = await rows<{ id: string; contact_email: string }>("SELECT id, contact_email FROM leads");
    const receipts = await rows<Record<string, unknown>>(
      "SELECT subject_hash, event, source, notice_version, purposes, marketing, at FROM consent_receipts WHERE lead_id = ?1",
      lead?.id,
    );
    expect(receipts).toHaveLength(1);
    const { addressHash } = await import("@techaust/core/hmac");
    expect(receipts[0]).toMatchObject({
      subject_hash: await addressHash(
        (realEnv as unknown as { ERASURE_HASH_KEY: string }).ERASURE_HASH_KEY,
        lead?.contact_email as string,
      ),
      event: "grant",
      source: "web_form",
      notice_version: m.noticeVersion,
      at: m.submittedAt,
    });
  });
});

describe("new lead bell entries [ADM-G-09]", () => {
  it("adds one row per active member whose role has leads.read, in 07-H's words, linked to the lead", async () => {
    expect(await processLead(makeEnv(), quote(), T0)).toBe("created");
    const [lead] = await rows<{ id: string }>("SELECT id FROM leads");
    const n = await rows<{
      user_id: string;
      title: string;
      link: string;
      read_at: number | null;
      kind: string;
    }>("SELECT user_id, title, link, read_at, kind FROM notifications ORDER BY user_id");
    expect(n.map((r) => r.user_id)).toEqual(["bell-owner", "bell-sales", "bell-staff"]);
    for (const r of n) {
      expect(r.title).toMatch(/^New lead: Meera Iyer, .+/);
      expect(r.link).toBe(`/leads/${lead?.id}`);
      expect(r.read_at).toBeNull();
      expect(r.kind).toBe("lead.new");
    }
  });

  it("a contact enquiry reads 'General enquiry'; a redelivery adds nothing; a limited submission adds nothing", async () => {
    const env = makeEnv();
    const m = contact();
    expect(await processLead(env, m, T0)).toBe("created");
    expect(await processLead(env, m, T0 + 1_000)).toBe("duplicate");
    const n = await rows<{ title: string }>("SELECT title FROM notifications WHERE user_id = 'bell-owner'");
    expect(n).toEqual([{ title: "New lead: Asha Rao, General enquiry" }]);
    // The 6th message within ten minutes from one address makes no lead, so no bell entry.
    for (let i = 0; i < 5; i++) {
      const at = T0 + 2_000 + i;
      await processLead(env, contact({ submittedAt: at }, `p${i}@example.com`), at);
    }
    const before = await count("notifications");
    const late = contact({ submittedAt: T0 + 9_000 }, "q@example.com");
    expect(await processLead(env, late, T0 + 9_000)).toBe("limited");
    expect(await count("notifications")).toBe(before);
  });
});
