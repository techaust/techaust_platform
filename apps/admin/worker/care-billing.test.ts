// The recurring care-plan invoice [ADM-CARE-02, ADM-CARE-03, ADM-INV-12, LD57..LD59, LD66, Q43, M5.4]: the draft the job makes and the automatic issue, with the fake clock. The class `BillingJobs` is a thin wrapper over
// `draftCarePlan` and `issueCareDraft` (one test calls it); every other test calls the functions with the Worker's own bindings. Failure paths and the Owner's authority first.
import { env } from "cloudflare:workers";
import { CARE_LINE_WORDS, type CareLineWords } from "@techaust/core/care-billing";
import { toIst } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BillingJobs } from "./api.ts";
import { draftCarePlan, issueCareDraft } from "./care-billing.ts";
import { mkPlan } from "./test-care.ts";
import { mkItem } from "./test-catalogue.ts";
import { beforeBatch, insert, mkClient, mkContact } from "./test-clients.ts";
import { call, one, rows, sessionFor, withDb, withEnv } from "./test-helpers.ts";
import { COMPANY_GSTIN, farSession, json, putBank, putCompany } from "./test-invoices.ts";

/** Words that carry a marked placeholder, to prove the issue guards still refuse such a line (a safety net, not copy). */
const MARKED: CareLineWords = {
  plan: (tier, p) => `[Placeholder] Care plan ${tier}, ${p.start} to ${p.end}`,
  aiOps: (p) => `[Placeholder] AI Ops, ${p.start} to ${p.end}`,
  overage: (p) => `[Placeholder] Extra hours, ${p.start} to ${p.end}`,
};

/** Plain test words (the real default is 07-U §6's, tested on its own). */
const WORDS: CareLineWords = {
  plan: (tier, p) => `Care plan ${tier}, ${p.start} to ${p.end}`,
  aiOps: (p) => `AI Ops, ${p.start} to ${p.end}`,
  overage: (p) => `Extra hours, ${p.start} to ${p.end}`,
};

beforeAll(async () => {
  await putCompany();
  await putBank();
  await mkItem({ code: "S16", sac: "998313", unit: "month", gst_rate_bp: 1800 });
  await mkItem({ code: "S17", sac: "998314", unit: "month", gst_rate_bp: 1800 });
  await mkItem({ code: "S18", sac: "998315", unit: "month", gst_rate_bp: 1800 });
});
afterEach(() => vi.useRealTimers());

/** 06:00 IST on a date. */
const at = (iso: string, time = "06:00:00.000") => Date.parse(`${iso}T${time}+05:30`);
const clock = (ms: number) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ms);
};

const pdfQueue = () => {
  const sent: unknown[] = [];
  const queue = {
    send: async (m: unknown) => {
      sent.push(m);
    },
    sendBatch: async () => undefined,
  };
  return { sent, env: withEnv(env, { PDF_QUEUE: queue }) };
};

type World = {
  owner: Awaited<ReturnType<typeof farSession>>;
  staff: Awaited<ReturnType<typeof farSession>>;
  clientId: string;
  contactId: string;
  planId: string;
  termsId: string;
};

/** An owner who turned the toggle on, a client with a billing contact, and a plan whose terms an owner (or Staff) wrote. */
async function world(
  o: {
    toggle?: boolean;
    termsBy?: "owner" | "staff";
    billingDay?: number;
    start?: string;
    usd?: boolean;
    price?: number;
    contact?: boolean;
    finance?: boolean;
    aiOps?: number;
  } = {},
): Promise<World> {
  const owner = await farSession("owner");
  const staff = await farSession("staff");
  const clientId = await mkClient(
    o.usd
      ? { country: "US", gst_status: "overseas", state_code: null, currency: "USD" }
      : {
          billing_address: JSON.stringify({
            line1: "5 Market Street",
            city: "Kolkata",
            state: "West Bengal",
            stateCode: "19",
            postalCode: "700001",
            country: "IN",
          }),
        },
  );
  const contact = await mkContact(clientId, {
    portal_access: 1,
    can_see_finance: 1,
    is_billing: 1,
    is_primary: 1,
  });
  if (o.finance === false)
    await env.DB.prepare("UPDATE contacts SET can_see_finance = 0 WHERE id = ?").bind(contact.id).run();
  if (o.contact === false)
    await env.DB.prepare("UPDATE contacts SET portal_access = 0 WHERE id = ?").bind(contact.id).run();
  if (o.toggle !== false)
    await env.DB.prepare("UPDATE clients SET care_auto_issue = 1, care_auto_issue_by = ? WHERE id = ?")
      .bind(owner.id, clientId)
      .run();
  const plan = await mkPlan(o.termsBy === "staff" ? staff.id : owner.id, {
    clientId,
    start: o.start ?? "2026-01-01",
    billingDay: o.billingDay ?? 5,
    price: o.price ?? 2_000_000,
    ...(o.aiOps ? { aiOps: o.aiOps } : {}),
    ...(o.usd ? { currency: "USD" as const } : {}),
  });
  const terms = await one<{ id: string }>("SELECT id FROM care_plan_terms WHERE care_plan_id = ?", plan.id);
  return { owner, staff, clientId, contactId: contact.id, planId: plan.id, termsId: terms?.id as string };
}

const draft = (w: World, e: Env = env) => draftCarePlan(e, { planId: w.planId }, { words: WORDS });
const docsOf = (planId: string) =>
  rows<{
    id: string;
    status: string;
    type: string;
    number_display: string | null;
    created_by: string | null;
    issued_by: string | null;
    subtotal_minor: number;
    total_minor: number;
  }>(
    "SELECT id, status, type, number_display, created_by, issued_by, subtotal_minor, total_minor FROM documents WHERE care_plan_id = ? ORDER BY created_at, id",
    planId,
  );

describe("draftCarePlan: one draft per plan and period [ADM-CARE-02, LD59]", () => {
  it("drafts the plan's current period: the plan fee as the taxable amount, tax from the client, the record of the period, last_billed_period moved, an audit row of actor system", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    const r = await draft(w);
    expect(r).toMatchObject({ result: "drafted", autoEligible: true, reasons: [] });
    const [d] = await docsOf(w.planId);
    expect(d).toMatchObject({
      status: "draft",
      type: "tax_invoice",
      created_by: null,
      issued_by: null,
      subtotal_minor: 2_000_000,
      total_minor: 2_360_000,
    });
    expect(
      await one(
        "SELECT period_start, period_end, terms_id, document_id, overage_minutes FROM care_invoices WHERE care_plan_id = ?",
        w.planId,
      ),
    ).toEqual({
      period_start: "2026-11-05",
      period_end: "2026-12-04",
      terms_id: w.termsId,
      document_id: d?.id,
      overage_minutes: null,
    });
    expect(
      (await one<{ v: string }>("SELECT last_billed_period AS v FROM care_plans WHERE id = ?", w.planId))?.v,
    ).toBe("2026-11-05");
    const lines = await rows<{
      description: string;
      qty_milli: number;
      unit: string;
      rate_minor: number;
      sac: string;
    }>(
      "SELECT description, qty_milli, unit, rate_minor, sac FROM document_lines WHERE document_id = ?",
      d?.id,
    );
    expect(lines).toEqual([
      {
        description: "Care plan Growth, 2026-11-05 to 2026-12-04",
        qty_milli: 1000,
        unit: "month",
        rate_minor: 2_000_000,
        sac: "998313",
      },
    ]);
    expect(
      await rows(
        "SELECT actor_type, actor_id, role, action, entity_id FROM audit_log WHERE action = 'care_invoice.draft' AND entity_id = ?",
        d?.id,
      ),
    ).toEqual([
      { actor_type: "system", actor_id: null, role: null, action: "care_invoice.draft", entity_id: d?.id },
    ]);
    // eligible: the owners are not rung (the system will issue it)
    expect(
      await rows("SELECT id FROM notifications WHERE kind = 'care.draft_ready' AND entity_id = ?", d?.id),
    ).toEqual([]);
  });

  it("twice the same day, on a later day of the period, and two at once: ONE document", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    expect((await draft(w)).result).toBe("drafted");
    expect((await draft(w)).result).toBe("already_billed");
    clock(at("2026-11-06"));
    expect((await draft(w)).result).toBe("already_billed");
    clock(at("2026-11-30"));
    expect((await draft(w)).result).toBe("already_billed");
    const w2 = await world();
    clock(at("2026-11-05"));
    const both = await Promise.all([draft(w2), draft(w2)]);
    expect(both.map((r) => r.result).sort()).toEqual(["already_billed", "drafted"]);
    expect(await docsOf(w2.planId)).toHaveLength(1);
    expect(await docsOf(w.planId)).toHaveLength(1);
  });

  it("the next billing day is the next period: a second document with its own record", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    await draft(w);
    clock(at("2026-12-05"));
    expect((await draft(w)).result).toBe("drafted");
    expect(await docsOf(w.planId)).toHaveLength(2);
    expect(
      (
        await rows<{ p: string }>(
          "SELECT period_start AS p FROM care_invoices WHERE care_plan_id = ? ORDER BY p",
          w.planId,
        )
      ).map((r) => r.p),
    ).toEqual(["2026-11-05", "2026-12-05"]);
  });

  it("a discarded draft is never made again: the record keeps the period", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    const r = await draft(w);
    const id = r.documentId as string;
    const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", id);
    const del = await call(`/invoices/${id}?expectedUpdatedAt=${row?.updated_at}`, {
      method: "DELETE",
      cookie: w.owner.cookie,
    });
    expect(del.status).toBe(200);
    expect(await docsOf(w.planId)).toEqual([]);
    expect(
      await one("SELECT period_start, document_id FROM care_invoices WHERE care_plan_id = ?", w.planId),
    ).toEqual({ period_start: "2026-11-05", document_id: null });
    clock(at("2026-11-06"));
    expect((await draft(w)).result).toBe("already_billed");
    expect(await docsOf(w.planId)).toEqual([]);
  });

  it("not billed: a plan that has not started, one paused or cancelled at the period start; a plan that starts today is billed in full for its first, clamped period", async () => {
    const future = await world({ start: "2026-12-01" });
    clock(at("2026-11-05"));
    expect((await draft(future)).result).toBe("not_due");
    const paused = await world();
    await insert("care_plan_status_log", {
      id: uuidv7(),
      care_plan_id: paused.planId,
      status: "paused",
      effective_on: "2026-11-05",
      created_by: paused.owner.id,
      created_at: Date.now() + 5,
    });
    await env.DB.prepare("UPDATE care_plans SET status = 'paused' WHERE id = ?").bind(paused.planId).run();
    expect((await draft(paused)).result).toBe("not_due");
    expect(await docsOf(paused.planId)).toEqual([]);
    const first = await world({ start: "2026-11-12", billingDay: 5 });
    clock(at("2026-11-12"));
    expect((await draft(first)).result).toBe("drafted");
    expect(
      await one<{ s: string; e: string }>(
        "SELECT period_start AS s, period_end AS e FROM care_invoices WHERE care_plan_id = ?",
        first.planId,
      ),
    ).toEqual({ s: "2026-11-12", e: "2026-12-04" });
    expect((await docsOf(first.planId))[0]?.subtotal_minor).toBe(2_000_000);
  });

  it("month ends: billing day 28 in February 2027 and February 2028 (leap year)", async () => {
    for (const [today, start, end] of [
      ["2027-02-28", "2027-02-28", "2027-03-27"],
      ["2028-02-28", "2028-02-28", "2028-03-27"],
      ["2028-02-29", "2028-02-28", "2028-03-27"],
    ] as const) {
      const w = await world({ billingDay: 28 });
      clock(at(today));
      expect((await draft(w)).result, today).toBe("drafted");
      expect(
        await one(
          "SELECT period_start AS s, period_end AS e FROM care_invoices WHERE care_plan_id = ?",
          w.planId,
        ),
      ).toEqual({ s: start, e: end });
    }
  });

  it("an older period that was never billed is a bell, not a draft: the current period is drafted and the owners are told (Q51)", async () => {
    const w = await world();
    await env.DB.prepare("UPDATE care_plans SET last_billed_period = '2026-09-05' WHERE id = ?")
      .bind(w.planId)
      .run();
    clock(at("2026-11-05"));
    expect((await draft(w)).result).toBe("drafted");
    expect(await docsOf(w.planId)).toHaveLength(1);
    expect(
      await rows(
        "SELECT kind FROM notifications WHERE kind = 'care.missed_period' AND entity_id = ? AND user_id = ?",
        `${w.planId}:2026-11-05`,
        w.owner.id,
      ),
    ).toEqual([{ kind: "care.missed_period" }]);
    // 07-U §7 (Q51): the client and the OLDEST unbilled period,
    const client = await one<{ display_name: string }>(
      "SELECT display_name FROM clients WHERE id = ?",
      w.clientId,
    );
    expect(
      (
        await one<{ title: string }>(
          "SELECT title FROM notifications WHERE kind = 'care.missed_period' AND entity_id = ? AND user_id = ?",
          `${w.planId}:2026-11-05`,
          w.owner.id,
        )
      )?.title,
    ).toBe(
      `${client?.display_name}'s care plan has an unbilled period (05 Oct 2026 to 04 Nov 2026). Invoice it by hand.`,
    );
  });

  it("a USD plan's draft rings the owners with 07-U §7's 'needs the exchange rate' line instead of 'ready to check'", async () => {
    const w = await world({ usd: true });
    clock(at("2026-11-05"));
    const r = await draft(w);
    expect(r.reasons).toContain("usd_needs_fx");
    const client = await one<{ display_name: string }>(
      "SELECT display_name FROM clients WHERE id = ?",
      w.clientId,
    );
    expect(
      (
        await one<{ title: string }>(
          "SELECT title FROM notifications WHERE kind = 'care.draft_ready' AND entity_id = ? AND user_id = ?",
          r.documentId,
          w.owner.id,
        )
      )?.title,
    ).toBe(`Care invoice draft for ${client?.display_name} needs the exchange rate before it can be issued.`);
  });

  it("the previous period's overage is a line in hours at its rate, and the draft is never issued by itself", async () => {
    const w = await world();
    // 600 included minutes, 45 minutes over in October (the period 2026-10-05 to 2026-11-04)
    await insert("time_logs", {
      id: uuidv7(),
      user_id: w.owner.id,
      work_date: "2026-10-10",
      minutes: 645,
      care_plan_id: w.planId,
      billable: 1,
      created_at: at("2026-10-10"),
      updated_at: at("2026-10-10"),
    });
    clock(at("2026-11-05"));
    const r = await draft(w);
    expect(r).toMatchObject({ result: "drafted", autoEligible: false });
    expect(r.reasons).toContain("overage_present");
    const lines = await rows<{ description: string; qty_milli: number; unit: string; rate_minor: number }>(
      "SELECT description, qty_milli, unit, rate_minor FROM document_lines WHERE document_id = ? ORDER BY position",
      r.documentId,
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ unit: "hour", qty_milli: 750, rate_minor: 150_000 });
    expect(
      (
        await one<{ m: number }>(
          "SELECT overage_minutes AS m FROM care_invoices WHERE care_plan_id = ?",
          w.planId,
        )
      )?.m,
    ).toBe(45);
    expect(
      await rows(
        "SELECT kind FROM notifications WHERE kind = 'care.draft_ready' AND entity_id = ? AND user_id = ?",
        r.documentId,
        w.owner.id,
      ),
    ).toEqual([{ kind: "care.draft_ready" }]);
    const client = await one<{ display_name: string }>(
      "SELECT display_name FROM clients WHERE id = ?",
      w.clientId,
    );
    expect(
      (
        await one<{ title: string }>(
          "SELECT title FROM notifications WHERE kind = 'care.draft_ready' AND entity_id = ? AND user_id = ?",
          r.documentId,
          w.owner.id,
        )
      )?.title,
    ).toBe(`Care invoice draft for ${client?.display_name} (05 Nov 2026 to 04 Dec 2026) is ready to check.`);
  });
});

describe("issueCareDraft: the system issues only what the Owner authorised [LD58]", () => {
  it("issues with no session: issued_by NULL, audit actor system, the number, the sends written by the Owner who turned the toggle on (kind auto) with their reminders, the bell, the PDF requested", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    const d = await draft(w);
    const q = pdfQueue();
    const r = await issueCareDraft(q.env, { documentId: d.documentId as string });
    expect(r).toMatchObject({ result: "issued", notEmailed: false });
    expect(r.number).toMatch(/^TH\/INV\/\d{4}\/\d{4}$/);
    expect(
      await one(
        "SELECT status, issued_by, created_by, number_display, balance_minor, due_date, issue_date FROM documents WHERE id = ?",
        d.documentId,
      ),
    ).toMatchObject({
      status: "issued",
      issued_by: null,
      created_by: null,
      number_display: r.number,
      balance_minor: 2_360_000,
      issue_date: "2026-11-05",
      due_date: "2026-11-12",
    });
    const sender = JSON.parse(
      (await one<{ issuer: string }>("SELECT issuer FROM documents WHERE id = ?", d.documentId))?.issuer ??
        "{}",
    ).sender;
    expect(sender).toMatchObject({ staffId: "system" });
    expect(
      await rows(
        "SELECT actor_type, actor_id, role, action FROM audit_log WHERE action = 'invoice.issue_auto' AND entity_id = ?",
        d.documentId,
      ),
    ).toEqual([{ actor_type: "system", actor_id: null, role: null, action: "invoice.issue_auto" }]);
    const sends = await rows<{
      kind: string;
      created_by: string;
      contact_id: string;
      queued_at: number | null;
    }>(
      "SELECT kind, created_by, contact_id, queued_at FROM document_sends WHERE document_id = ?",
      d.documentId,
    );
    expect(sends).toEqual([
      { kind: "auto", created_by: w.owner.id, contact_id: w.contactId, queued_at: null },
    ]);
    expect(
      (
        await rows(
          "SELECT offset_days FROM reminders WHERE document_id = ? ORDER BY offset_days",
          d.documentId,
        )
      ).length,
    ).toBe(5);
    const bell = await one<{ title: string }>(
      "SELECT title FROM notifications WHERE kind = 'care.issued' AND entity_id = ? AND user_id = ?",
      d.documentId,
      w.owner.id,
    );
    expect(bell?.title).toMatch(
      new RegExp(
        `^Care invoice ${(r.number as string).replace(/[/]/g, "\\/")} for .+ was issued and emailed\\.$`,
      ),
    );
    expect(q.sent).toEqual([{ v: 1, kind: "pdf.snapshot", documentId: d.documentId, reason: "send" }]);
    // a second call finds it issued and writes nothing
    expect(await issueCareDraft(q.env, { documentId: d.documentId as string })).toMatchObject({
      result: "already_issued",
      number: r.number,
    });
    expect(await rows("SELECT id FROM document_sends WHERE document_id = ?", d.documentId)).toHaveLength(1);
  });

  it("a billing contact who may not see finance is nobody to email: issued, notEmailed, no sends, no reminders [POR-03, review H1]", async () => {
    const w = await world({ finance: false });
    clock(at("2026-11-05"));
    const d = await draft(w);
    expect(d.autoEligible).toBe(true);
    const r = await issueCareDraft(pdfQueue().env, { documentId: d.documentId as string });
    expect(r).toMatchObject({ result: "issued", notEmailed: true });
    expect(await rows("SELECT id FROM document_sends WHERE document_id = ?", d.documentId)).toEqual([]);
    expect(await rows("SELECT id FROM reminders WHERE document_id = ?", d.documentId)).toEqual([]);
  });

  it("the sends statement writes nothing when the recipient lost finance after the read: notEmailed is true and the bell says not emailed [review M1]", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    const d = await draft(w);
    const q = pdfQueue();
    // The contact loses finance access between the read and the batch: the sends insert (all or none) writes 0 rows while the freeze succeeds.
    const racing = new Proxy(q.env.DB, {
      get(target, key) {
        if (key === "batch")
          return async (stmts: D1PreparedStatement[]) => {
            await target.prepare("UPDATE contacts SET can_see_finance = 0").run();
            return target.batch(stmts);
          };
        const v = Reflect.get(target, key);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const r = await issueCareDraft({ ...q.env, DB: racing } as Env, { documentId: d.documentId as string });
    expect(r).toMatchObject({ result: "issued", notEmailed: true });
    expect(await rows("SELECT id FROM document_sends WHERE document_id = ?", d.documentId)).toEqual([]);
    const bell = await one<{ title: string }>(
      "SELECT title FROM notifications WHERE kind = 'care.issued' AND entity_id = ?",
      d.documentId,
    );
    expect(bell?.title).toContain("wasn't emailed");
    expect(bell?.title).not.toContain("issued and emailed");
  });

  it("with nobody to email it is still issued (the money is owed) and says notEmailed; no sends, no reminders", async () => {
    const w = await world({ contact: false });
    clock(at("2026-11-05"));
    const d = await draft(w);
    expect(d.autoEligible).toBe(true);
    const r = await issueCareDraft(pdfQueue().env, { documentId: d.documentId as string });
    expect(r).toMatchObject({ result: "issued", notEmailed: true });
    expect(await rows("SELECT id FROM document_sends WHERE document_id = ?", d.documentId)).toEqual([]);
    expect(await rows("SELECT id FROM reminders WHERE document_id = ?", d.documentId)).toEqual([]);
    expect(
      (
        await one<{ title: string }>(
          "SELECT title FROM notifications WHERE kind = 'care.issued' AND entity_id = ?",
          d.documentId,
        )
      )?.title,
    ).toMatch(/was issued, but no billing contact has portal access, so it wasn't emailed\.$/);
  });

  const refusals: [string, (w: World, documentId: string) => Promise<void>, string[]][] = [
    [
      "the toggle was turned off after the draft",
      async (w) =>
        void (await env.DB.prepare(
          "UPDATE clients SET care_auto_issue = 0, care_auto_issue_by = NULL WHERE id = ?",
        )
          .bind(w.clientId)
          .run()),
      ["toggle_off"],
    ],
    [
      "the Owner who turned it on is no Owner now",
      async (w) => {
        await sessionFor("owner"); // another owner, so the last-owner rule lets this one go
        await env.DB.prepare("UPDATE staff_users SET role = 'staff' WHERE id = ?").bind(w.owner.id).run();
      },
      ["toggle_not_owner"],
    ],
    [
      "the draft has blockers (the bank was removed)",
      async () => void (await env.DB.prepare("UPDATE bank_accounts SET active = 0").run()),
      ["blockers"],
    ],
  ];
  for (const [name, change, reasons] of refusals)
    it(`refuses (and rings the owners) when ${name}; the draft stays a draft and no number is burned`, async () => {
      const w = await world();
      clock(at("2026-11-05"));
      const d = await draft(w);
      const counter =
        (
          await one<{ n: number | null }>(
            "SELECT max(next_no) AS n FROM doc_counters WHERE series = 'invoice'",
          )
        )?.n ?? null;
      let r: Awaited<ReturnType<typeof issueCareDraft>>;
      try {
        await change(w, d.documentId as string);
        r = await issueCareDraft(pdfQueue().env, { documentId: d.documentId as string });
      } finally {
        await env.DB.prepare("UPDATE bank_accounts SET active = 1 WHERE kind = 'INR'").run();
      }
      expect(r.result).toBe("refused");
      for (const code of reasons) expect(r.reasons).toContain(code);
      expect(await one("SELECT status, frozen_at, number FROM documents WHERE id = ?", d.documentId)).toEqual(
        { status: "draft", frozen_at: null, number: null },
      );
      expect(
        (
          await one<{ n: number | null }>(
            "SELECT max(next_no) AS n FROM doc_counters WHERE series = 'invoice'",
          )
        )?.n ?? null,
      ).toBe(counter);
      expect(await rows("SELECT id FROM document_sends WHERE document_id = ?", d.documentId)).toEqual([]);
      expect(
        await rows(
          "SELECT kind FROM notifications WHERE kind = 'care.draft_ready' AND entity_id = ?",
          d.documentId,
        ),
      ).not.toEqual([]);
    });

  it("Staff wrote the terms: a draft, never an issue", async () => {
    const w = await world({ termsBy: "staff" });
    clock(at("2026-11-05"));
    const d = await draft(w);
    expect(d).toMatchObject({ result: "drafted", autoEligible: false });
    expect(d.reasons).toEqual(["terms_not_owner"]);
    expect((await issueCareDraft(pdfQueue().env, { documentId: d.documentId as string })).reasons).toEqual([
      "terms_not_owner",
    ]);
    expect((await docsOf(w.planId))[0]?.status).toBe("draft");
  });

  it("a toggle nobody turned on is a draft with the owners rung; a USD client always gets a draft (the rate is typed by hand)", async () => {
    const off = await world({ toggle: false });
    clock(at("2026-11-05"));
    const d = await draft(off);
    expect(d).toMatchObject({ autoEligible: false });
    expect(d.reasons).toEqual(["toggle_off"]);
    expect(
      await rows(
        "SELECT kind FROM notifications WHERE kind = 'care.draft_ready' AND entity_id = ?",
        d.documentId,
      ),
    ).not.toEqual([]);
    const usd = await world({ usd: true });
    const u = await draft(usd);
    expect(u.result).toBe("drafted");
    expect(u.reasons).toContain("usd_needs_fx");
    expect((await docsOf(usd.planId))[0]).toMatchObject({ type: "export_invoice", status: "draft" });
  });

  it("the draft was touched after the job made it (a save, an approval request), or made by a person: the freeze refuses it", async () => {
    const edited = await world();
    clock(at("2026-11-05"));
    const d1 = await draft(edited);
    await env.DB.prepare("UPDATE documents SET updated_at = updated_at + 5 WHERE id = ?")
      .bind(d1.documentId)
      .run();
    expect((await issueCareDraft(pdfQueue().env, { documentId: d1.documentId as string })).result).toBe(
      "refused",
    );
    const approval = await world();
    const d2 = await draft(approval);
    await insert("approvals", {
      id: uuidv7(),
      kind: "issue",
      document_id: d2.documentId,
      requested_by: approval.staff.id,
      content_sha256: (
        await one<{ s: string }>("SELECT content_sha256 AS s FROM documents WHERE id = ?", d2.documentId)
      )?.s,
      status: "pending",
    });
    expect((await issueCareDraft(pdfQueue().env, { documentId: d2.documentId as string })).result).toBe(
      "refused",
    );
    const byHand = await world();
    const d3 = await draft(byHand);
    await env.DB.prepare("UPDATE documents SET created_by = ? WHERE id = ?")
      .bind(byHand.staff.id, d3.documentId)
      .run();
    expect((await issueCareDraft(pdfQueue().env, { documentId: d3.documentId as string })).result).toBe(
      "not_found",
    );
    for (const d of [d1, d2, d3])
      expect(
        (await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", d.documentId))?.status,
      ).toBe("draft");
  });

  it("a printed number already held by another document (the index of 0049) is freeze_refused with an ids-only log: the counter does not move, the draft stays a draft (FX-1)", async () => {
    const w = await world();
    // FY 2034-35 (token 3435): the planted number holds a year no other test issues in (a frozen row is never deleted).
    clock(at("2034-11-05"));
    const d = await draft(w);
    const next =
      (
        await one<{ n: number }>(
          "SELECT next_no AS n FROM doc_counters WHERE series = 'invoice' AND fy = '3435'",
        )
      )?.n ?? 1;
    const printed = `TH/INV/3435/${String(next).padStart(4, "0")}`;
    // A proforma of the same client that (impossibly) prints the number the invoice series is about to hand out.
    await insert("documents", {
      id: uuidv7(),
      type: "proforma",
      status: "issued",
      client_id: w.clientId,
      currency: "INR",
      series: "proforma",
      fy: "3435",
      number: 9_876,
      number_display: printed,
      frozen_at: 1,
    });
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: unknown) => void logged.push(String(m)));
    try {
      const r = await issueCareDraft(pdfQueue().env, { documentId: d.documentId as string });
      expect(r).toMatchObject({ result: "refused", reasons: ["freeze_refused"] });
    } finally {
      spy.mockRestore();
    }
    const line = logged.find((l) => l.includes("unique key"));
    expect(JSON.parse(line ?? "{}")).toMatchObject({
      level: "error",
      documentId: d.documentId,
      series: "invoice",
      fy: "3435",
    });
    expect(
      (
        await one<{ n: number }>(
          "SELECT next_no AS n FROM doc_counters WHERE series = 'invoice' AND fy = '3435'",
        )
      )?.n ?? 1,
    ).toBe(next);
    expect(await one("SELECT status, number FROM documents WHERE id = ?", d.documentId)).toEqual({
      status: "draft",
      number: null,
    });
  });

  it("a forged call: a hand-made draft with no record of a period, a document of no plan, and an unknown id are not issued", async () => {
    const w = await world();
    const staffDraft = await call("/invoices", {
      cookie: w.staff.cookie,
      body: { clientId: w.clientId, services: [{ catalogueItemId: (await mkItem()).id }] },
    });
    const id = (await json(staffDraft)).id as string;
    for (const documentId of [id, "no-such-document", uuidv7()])
      expect((await issueCareDraft(pdfQueue().env, { documentId })).result, documentId).toBe("not_found");
    expect((await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", id))?.status).toBe(
      "draft",
    );
  });

  it("the default words are 07-U §6's, with no placeholder mark: the draft is eligible and the system issues it (an Owner switched it on)", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    const r = await draftCarePlan(env, { planId: w.planId });
    expect(r).toMatchObject({ result: "drafted", autoEligible: true, reasons: [] });
    const [line] = await rows<{ description: string }>(
      "SELECT description FROM document_lines WHERE document_id = ?",
      r.documentId,
    );
    expect(line?.description).toBe(
      CARE_LINE_WORDS.plan("Growth", { start: "2026-11-05", end: "2026-12-04" }),
    );
    expect(line?.description).toBe("Growth care plan, 05 Nov 2026 to 04 Dec 2026");
    expect((await issueCareDraft(pdfQueue().env, { documentId: r.documentId as string })).result).toBe(
      "issued",
    );
  });

  it("the guard that refuses a line carrying '[Placeholder' stays (a safety net, not copy): the Owner's own issue is 409 line_text_placeholder", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    const r = await draftCarePlan(env, { planId: w.planId }, { words: MARKED });
    expect(r).toMatchObject({ result: "drafted", autoEligible: false, reasons: ["blockers"] });
    expect((await issueCareDraft(pdfQueue().env, { documentId: r.documentId as string })).result).toBe(
      "refused",
    );
    const row = await one<{ updated_at: number; content_sha256: string }>(
      "SELECT updated_at, content_sha256 FROM documents WHERE id = ?",
      r.documentId,
    );
    const byHand = await call(`/invoices/${r.documentId}/issue`, {
      cookie: w.owner.cookie,
      body: { expectedUpdatedAt: row?.updated_at, expectedContentSha256: row?.content_sha256 },
    });
    expect(byHand.status).toBe(409);
    expect(JSON.stringify(await json(byHand))).toContain("line_text_placeholder");
    expect(
      (await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", r.documentId))?.status,
    ).toBe("draft");
  });

  it("financial year boundary: 31 March 23:59:59.999 IST is the old FY, 1 April 00:00 IST the new one (billing day 1)", async () => {
    const w = await world({ billingDay: 1 });
    clock(at("2027-03-31", "23:59:59.900"));
    const old = await draft(w);
    expect(old.result).toBe("drafted");
    clock(at("2027-03-31", "23:59:59.999"));
    const a = await issueCareDraft(pdfQueue().env, { documentId: old.documentId as string });
    expect(a.number).toMatch(/^TH\/INV\/2627\/\d{4}$/);
    clock(at("2027-04-01", "00:00:00.000"));
    const fresh = await draft(w);
    expect(fresh.result).toBe("drafted");
    const b = await issueCareDraft(pdfQueue().env, { documentId: fresh.documentId as string });
    expect(b.number).toMatch(/^TH\/INV\/2728\/0001$/);
    expect(toIst(at("2027-04-01", "00:00:00.000")).day).toBe(1);
  });
});

describe("early check findings 1 and 2: overlapping issues, and a lost care.issue message", () => {
  it("two overlapping issues of one draft: one issues, the other answers already_issued; no refusal bell, one audit row", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    const d = await draft(w);
    const q = pdfQueue();
    const both = await Promise.all([
      issueCareDraft(q.env, { documentId: d.documentId as string }),
      issueCareDraft(q.env, { documentId: d.documentId as string }),
    ]);
    expect(both.map((r) => r.result).sort()).toEqual(["already_issued", "issued"]);
    expect(
      await rows(
        "SELECT id FROM notifications WHERE kind = 'care.draft_ready' AND entity_id = ?",
        d.documentId,
      ),
    ).toEqual([]);
    expect(
      await rows(
        "SELECT id FROM audit_log WHERE entity_id = ? AND action IN ('care_invoice.auto_issue_refused', 'invoice.issue_auto')",
        d.documentId,
      ),
    ).toHaveLength(1);
    expect(
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM document_sends WHERE document_id = ?",
          d.documentId,
        )
      )?.n,
    ).toBe(1);
  });

  it("a retried care.bill after a lost care.issue finds the draft: the answer names it and says it is eligible; once issued it is plain", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    const first = await draft(w);
    const again = await draft(w);
    expect(again).toEqual({
      result: "already_billed",
      documentId: first.documentId,
      autoEligible: true,
      reasons: [],
    });
    expect((await issueCareDraft(pdfQueue().env, { documentId: first.documentId as string })).result).toBe(
      "issued",
    );
    expect(await draft(w)).toEqual({ result: "already_billed", autoEligible: false, reasons: [] });
  });

  it("a draft that is not eligible keeps saying why on the retry; a deleted draft is plain", async () => {
    const w = await world({ termsBy: "staff" });
    clock(at("2026-11-05"));
    const first = await draft(w);
    expect(await draft(w)).toEqual({
      result: "already_billed",
      documentId: first.documentId,
      autoEligible: false,
      reasons: ["terms_not_owner"],
    });
    const row = await one<{ updated_at: number }>(
      "SELECT updated_at FROM documents WHERE id = ?",
      first.documentId,
    );
    await call(`/invoices/${first.documentId}?expectedUpdatedAt=${row?.updated_at}`, {
      method: "DELETE",
      cookie: w.owner.cookie,
    });
    expect(await draft(w)).toEqual({ result: "already_billed", autoEligible: false, reasons: [] });
  });
});

describe("only an Owner with a fresh code turns the automatic issue on [LD58, Q43]", () => {
  async function client() {
    const id = await mkClient({
      billing_address: JSON.stringify({
        line1: "1 A St",
        city: "Kolkata",
        state: "West Bengal",
        stateCode: "19",
        postalCode: "700001",
        country: "IN",
      }),
    });
    const stamp = (await one<{ updated_at: number }>("SELECT updated_at FROM clients WHERE id = ?", id))
      ?.updated_at;
    return { id, stamp: stamp as number };
  }
  const patch = (s: { cookie: string }, id: string, stamp: number, careAutoIssue: boolean) =>
    call(`/clients/${id}/billing`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: stamp, careAutoIssue },
    });
  const state = (id: string) =>
    one<{ care_auto_issue: number; care_auto_issue_by: string | null }>(
      "SELECT care_auto_issue, care_auto_issue_by FROM clients WHERE id = ?",
      id,
    );

  it("Staff: 403 owner_only and nothing changes; an Owner without a fresh code: step_up_required; an Owner with one: on, naming the Owner", async () => {
    const c = await client();
    const staff = await sessionFor("staff");
    const r1 = await patch(staff, c.id, c.stamp, true);
    expect(r1.status).toBe(403);
    expect(JSON.stringify(await json(r1))).toContain("owner_only");
    expect(await state(c.id)).toEqual({ care_auto_issue: 0, care_auto_issue_by: null });
    const noCode = await sessionFor("owner");
    const r2 = await patch(noCode, c.id, c.stamp, true);
    expect(r2.status).toBe(403);
    expect(JSON.stringify(await json(r2))).toContain("step_up_required");
    expect(await state(c.id)).toEqual({ care_auto_issue: 0, care_auto_issue_by: null });
    const owner = await sessionFor("owner", { stepUp: true });
    const r3 = await patch(owner, c.id, c.stamp, true);
    expect(r3.status).toBe(200);
    expect(await state(c.id)).toEqual({ care_auto_issue: 1, care_auto_issue_by: owner.id });
  });

  it("turning it off clears the name and Staff may do that; a repeat of 'on' changes nothing", async () => {
    const c = await client();
    const owner = await sessionFor("owner", { stepUp: true });
    expect((await patch(owner, c.id, c.stamp, true)).status).toBe(200);
    const again = await patch(
      owner,
      c.id,
      (await one<{ updated_at: number }>("SELECT updated_at FROM clients WHERE id = ?", c.id))
        ?.updated_at as number,
      true,
    );
    expect(await json(again)).toMatchObject({ ok: true, changed: false });
    const staff = await sessionFor("staff");
    const stamp = (await one<{ updated_at: number }>("SELECT updated_at FROM clients WHERE id = ?", c.id))
      ?.updated_at as number;
    expect((await patch(staff, c.id, stamp, false)).status).toBe(200);
    expect(await state(c.id)).toEqual({ care_auto_issue: 0, care_auto_issue_by: null });
  });

  it("a code that ran out between the check and the write: the statement refuses it too (step_up_required, nothing changed)", async () => {
    const c = await client();
    const owner = await sessionFor("owner", { stepUp: true });
    // the route's own check passes now; the session's code is judged again inside the UPDATE
    await env.DB.prepare("UPDATE staff_sessions SET step_up_until = ? WHERE id = ?")
      .bind(Date.now() + 1, owner.sessionId)
      .run();
    await new Promise((r) => setTimeout(r, 5));
    const res = await patch(owner, c.id, c.stamp, true);
    expect(res.status).toBe(403);
    expect(await state(c.id)).toEqual({ care_auto_issue: 0, care_auto_issue_by: null });
  });

  it("a session that is revoked, idle-expired or past its absolute end between the check and the write cannot turn it on (early check finding 7)", async () => {
    for (const change of ["revoked_at = 1", "idle_expires_at = 1", "abs_expires_at = 1"]) {
      const c = await client();
      const owner = await sessionFor("owner", { stepUp: true });
      const e = beforeBatch(async () => {
        await env.DB.prepare(`UPDATE staff_sessions SET ${change} WHERE id = ?`).bind(owner.sessionId).run();
      });
      const res = await call(
        `/clients/${c.id}/billing`,
        { method: "PATCH", cookie: owner.cookie, body: { expectedUpdatedAt: c.stamp, careAutoIssue: true } },
        e,
      );
      expect(res.status, change).toBe(403);
      expect(await state(c.id), change).toEqual({ care_auto_issue: 0, care_auto_issue_by: null });
    }
  });

  it("the client page names who turned it on, and says when that Owner is no longer active; Sales sees none of it (triage, question 3)", async () => {
    const c = await client();
    const owner = await sessionFor("owner", { stepUp: true, name: "Rupak Sarkar" });
    await patch(owner, c.id, c.stamp, true);
    const asOwner = (await json(await call(`/clients/${c.id}`, { cookie: owner.cookie }))).client;
    expect(asOwner.careAutoIssue).toBe(true);
    expect(asOwner.careAutoIssueBy).toEqual({
      id: owner.id,
      name: "Rupak Sarkar",
      active: true,
      at: expect.any(Number),
    });
    // `at` is the audit row's time (Q4): within the last minute here
    expect(Date.now() - asOwner.careAutoIssueBy.at).toBeLessThan(60_000);
    const list = (await json(await call("/clients?limit=50", { cookie: owner.cookie }))).clients.find(
      (x: { id: string }) => x.id === c.id,
    );
    expect(list.careAutoIssueBy).toEqual({
      id: owner.id,
      name: "Rupak Sarkar",
      active: true,
      at: asOwner.careAutoIssueBy.at,
    });
    const sales = await sessionFor("sales");
    const asSales = (await json(await call(`/clients/${c.id}`, { cookie: sales.cookie }))).client;
    expect("careAutoIssueBy" in asSales).toBe(false);
    expect("careAutoIssue" in asSales).toBe(false);
    // the Owner is deactivated (another Owner exists, so the last-owner rule allows it): the name stays, the flag turns false
    const other = await sessionFor("owner", { stepUp: true });
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(owner.id).run();
    const after = (await json(await call(`/clients/${c.id}`, { cookie: other.cookie }))).client;
    expect(after.careAutoIssueBy).toEqual({
      id: owner.id,
      name: "Rupak Sarkar",
      active: false,
      at: asOwner.careAutoIssueBy.at,
    });
  });

  it("the audit row says what changed, never who is named beyond the actor", async () => {
    const c = await client();
    const owner = await sessionFor("owner", { stepUp: true });
    await patch(owner, c.id, c.stamp, true);
    const a = await one<{ actor_id: string; summary: string }>(
      "SELECT actor_id, summary FROM audit_log WHERE action = 'client.billing_update' AND entity_id = ?",
      c.id,
    );
    expect(a?.actor_id).toBe(owner.id);
    expect(JSON.parse(a?.summary ?? "{}").changed).toContain("careAutoIssue");
  });
});

describe("GET /care-plans/:id billing [M5.4 API gaps, Q3]", () => {
  const plan = async (planId: string, role: "owner" | "sales" | "accountant" = "owner") =>
    json(await call(`/care-plans/${planId}`, { cookie: (await sessionFor(role)).cookie }));

  it("a plan never billed: no last period, the start date is the next billing day, no draft, no auto", async () => {
    const w = await world({ start: "2099-01-10" });
    const v = await plan(w.planId);
    expect(v.billing).toEqual({
      lastBilledPeriod: null,
      nextBillingDay: "2099-01-10",
      draft: null,
      auto: null,
    });
  });

  it("a period due and unbilled: today before the 06:00 IST scan, tomorrow once the scan's hour has begun (review 2026-10-28, finding 11)", async () => {
    const w = await world();
    clock(at("2026-11-05", "05:59:59.000"));
    expect((await plan(w.planId)).billing.nextBillingDay).toBe("2026-11-05");
    clock(at("2026-11-05", "06:00:00.000"));
    expect((await plan(w.planId)).billing.nextBillingDay).toBe("2026-11-06");
    clock(at("2026-11-05", "23:30:00.000"));
    expect((await plan(w.planId)).billing.nextBillingDay).toBe("2026-11-06");
    // the next morning, before the scan, the catch-up is today
    clock(at("2026-11-06", "01:00:00.000"));
    expect((await plan(w.planId)).billing.nextBillingDay).toBe("2026-11-06");
  });

  it("after the job drafted the period: the last period, the next period's first day, the draft and the Owner's choices (blockers not judged); issued, the draft has a number and no auto", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    expect((await draft(w)).result).toBe("drafted");
    const [d] = await docsOf(w.planId);
    const v = await plan(w.planId);
    expect(v.billing).toEqual({
      lastBilledPeriod: "2026-11-05",
      nextBillingDay: "2026-12-05",
      draft: { id: d?.id, number: null, status: "draft" },
      auto: { eligible: true, reasons: [], blockersChecked: false },
    });
    const issued = await issueCareDraft(env, { documentId: d?.id as string });
    expect(issued.result).toBe("issued");
    const after = (await plan(w.planId)).billing;
    expect(after.draft).toMatchObject({ id: d?.id, status: "issued" });
    expect(after.draft.number).toBeTruthy();
    expect(after.auto).toBeNull();
  });

  it("with the switch off the reasons say so (the same decision as the invoice's own page)", async () => {
    const w = await world({ toggle: false });
    clock(at("2026-11-05"));
    await draft(w);
    const v = await plan(w.planId);
    expect(v.billing.auto).toEqual({ eligible: false, reasons: ["toggle_off"], blockersChecked: false });
  });

  it("the plan view carries billing only for a role that reads money: not Sales", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    await draft(w);
    expect("billing" in (await plan(w.planId, "sales"))).toBe(false);
    expect("billing" in (await plan(w.planId, "owner"))).toBe(true);
    expect("billing" in (await plan(w.planId, "accountant"))).toBe(true);
  });
});

/** An env whose DB records every bound statement (sql and values), so a test can compare what two code paths hand to D1. */
function recording() {
  const seen: { sql: string; values: unknown[] }[] = [];
  const real = new WeakMap<object, D1PreparedStatement>();
  const db = {
    prepare: (sql: string) => {
      const stmt = env.DB.prepare(sql);
      const proxy = new Proxy(stmt, {
        get(t, p) {
          if (p === "bind")
            return (...values: unknown[]) => {
              seen.push({ sql, values });
              return t.bind(...values);
            };
          const v = Reflect.get(t, p);
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
      real.set(proxy, stmt);
      return proxy;
    },
    batch: (stmts: D1PreparedStatement[]) => env.DB.batch(stmts.map((s) => real.get(s) ?? s)),
  } as unknown as D1Database;
  return { env: withDb(db), seen };
}

describe("parity: the automatic issue hands D1 what the Owner's own issue would (decision 1: no shared prepare function)", () => {
  it("the freeze statement of the care path and of the owner route differ only in the authority, the sender, the issuer and the seal that follow from it", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    const d = await draft(w);
    const id = d.documentId as string;
    // an identical draft made by the Owner: the same rows under a new id, with an author and no plan
    const copy = uuidv7();
    const cols = (await rows<{ name: string }>("SELECT name FROM pragma_table_info('documents')")).map(
      (r) => r.name,
    );
    const pick = (c: string) =>
      c === "id" ? "?2" : c === "care_plan_id" ? "NULL" : c === "created_by" ? "?3" : c;
    await env.DB.prepare(
      `INSERT INTO documents (${cols.join(", ")}) SELECT ${cols.map(pick).join(", ")} FROM documents WHERE id = ?1`,
    )
      .bind(id, copy, w.owner.id)
      .run();
    await env.DB.prepare(
      `INSERT INTO document_lines (id, document_id, position, catalogue_item_id, description, detail, sac, qty_milli, unit, rate_minor, discount_kind, discount_value, taxable_minor, gst_rate_bp, cgst_minor, sgst_minor, igst_minor, line_total_minor)
       SELECT lower(hex(randomblob(16))), ?2, position, catalogue_item_id, description, detail, sac, qty_milli, unit, rate_minor, discount_kind, discount_value, taxable_minor, gst_rate_bp, cgst_minor, sgst_minor, igst_minor, line_total_minor FROM document_lines WHERE document_id = ?1`,
    )
      .bind(id, copy)
      .run();
    const careRec = recording();
    expect(
      (await issueCareDraft({ ...careRec.env, PDF_QUEUE: pdfQueue().env.PDF_QUEUE }, { documentId: id }))
        .result,
    ).toBe("issued");
    const ownerRec = recording();
    const body = await one<{ updated_at: number; content_sha256: string }>(
      "SELECT updated_at, content_sha256 FROM documents WHERE id = ?",
      copy,
    );
    const res = await call(
      `/invoices/${copy}/issue`,
      {
        cookie: w.owner.cookie,
        body: { expectedUpdatedAt: body?.updated_at, expectedContentSha256: body?.content_sha256 },
      },
      ownerRec.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const freeze = (rec: ReturnType<typeof recording>) =>
      rec.seen.find((s) => s.sql.startsWith("UPDATE documents SET series")) as {
        sql: string;
        values: unknown[];
      };
    const a = freeze(careRec).values;
    const b = freeze(ownerRec).values;
    // 1 id, 11 seal, 12 issued by, 24 authority (the session or the plan) and from 30 the authority's own tail differ by design; 9 is compared without the sender
    const skip = new Set([0, 8, 10, 11, 23]);
    for (let i = 0; i < 29; i++) if (!skip.has(i)) expect(a[i], `?${i + 1}`).toEqual(b[i]);
    const noSender = (v: unknown) => {
      const { sender, ...rest } = JSON.parse(v as string);
      return { rest, sender };
    };
    expect(noSender(a[8]).rest).toEqual(noSender(b[8]).rest);
    expect(noSender(a[8]).sender).toMatchObject({ staffId: "system" });
    expect(noSender(b[8]).sender).toMatchObject({ staffId: w.owner.id });
    expect(a[11]).toBeNull();
    expect(b[11]).toBe(w.owner.id);
    expect(a[23]).toBe(w.planId);
    expect(b[23]).toBe(w.owner.sessionId);
    // the two documents ended the same way
    const end = (docId: string) =>
      one(
        "SELECT status, balance_minor, total_minor, issue_date, due_date, computed, recipient FROM documents WHERE id = ?",
        docId,
      );
    expect(await end(id)).toEqual(await end(copy));
  });
});

describe("the entrypoint [LD57]", () => {
  it("BillingJobs.draftCarePlan and issueCareDraft are the two functions over the Worker's own bindings; a bad id throws", async () => {
    const w = await world();
    clock(at("2026-11-05"));
    const ctx = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
      props: {},
    } as unknown as ExecutionContext;
    const jobs = new BillingJobs(
      ctx,
      withEnv(env, { PDF_QUEUE: { send: async () => undefined, sendBatch: async () => undefined } }),
    );
    // the entrypoint's default words are 07-U §6's (no placeholder), so the draft is made and is eligible: the system issues it
    const r = await jobs.draftCarePlan({ planId: w.planId });
    expect(r).toMatchObject({ result: "drafted", autoEligible: true });
    expect(await jobs.draftCarePlan({ planId: w.planId })).toMatchObject({ result: "already_billed" });
    expect(await jobs.issueCareDraft({ documentId: r.documentId as string })).toMatchObject({
      result: "issued",
    });
    await expect(jobs.draftCarePlan({ planId: "" })).rejects.toThrow(TypeError);
    await expect(jobs.issueCareDraft({ documentId: undefined as unknown as string })).rejects.toThrow(
      TypeError,
    );
    expect(
      Object.getOwnPropertyNames(BillingJobs.prototype)
        .filter((n) => n !== "constructor")
        .sort(),
    ).toEqual(["draftCarePlan", "issueCareDraft"]);
  });

  it("the front's /api/* cannot reach it: no route row names it and no path answers", async () => {
    const { ROUTES } = await import("./guard.ts");
    expect(ROUTES.some((r) => /draftCarePlan|issueCareDraft|billing-jobs|rpc/i.test(r.path))).toBe(false);
    for (const path of [
      "/billing-jobs/draft",
      "/billing/draftCarePlan",
      "/care-plans/draft",
      "/rpc/draftCarePlan",
    ]) {
      const owner = await sessionFor("owner", { stepUp: true });
      const res = await call(path, { method: "POST", cookie: owner.cookie, body: { planId: "x" } });
      expect(res.status, path).toBe(404);
    }
    void COMPANY_GSTIN;
  });
});

describe("the wall clock of the entrypoint (local; the staging reading is the gate)", () => {
  it("draftCarePlan and issueCareDraft, one and three lines", async () => {
    const readings: Record<string, number> = {};
    const time = async <T>(name: string, run: () => Promise<T>) => {
      const t0 = performance.now();
      const out = await run();
      readings[name] = Math.round((performance.now() - t0) * 10) / 10;
      return out;
    };
    const one_ = await world();
    clock(at("2026-11-05"));
    const d1 = await time("draftCarePlan (1 line)", () => draft(one_));
    await time("issueCareDraft (1 line)", () =>
      issueCareDraft(pdfQueue().env, { documentId: d1.documentId as string }),
    );
    // two lines (plan fee and AI Ops) issued; three lines (with the previous period's overage) drafted
    const two = await world({ aiOps: 400_000 });
    const d2 = await time("draftCarePlan (2 lines)", () => draft(two));
    await time("issueCareDraft (2 lines)", () =>
      issueCareDraft(pdfQueue().env, { documentId: d2.documentId as string }),
    );
    const three = await world({ aiOps: 400_000 });
    await insert("time_logs", {
      id: uuidv7(),
      user_id: three.owner.id,
      work_date: "2026-10-10",
      minutes: 645,
      care_plan_id: three.planId,
      billable: 1,
      created_at: at("2026-10-10"),
      updated_at: at("2026-10-10"),
    });
    await time("draftCarePlan (3 lines)", () => draft(three));
    console.info(`[M5.4 wall clock ms] ${JSON.stringify(readings)}`);
    for (const v of Object.values(readings)) expect(v).toBeLessThan(2_000);
  });
});
