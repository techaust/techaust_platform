// The readers and the claim of M5.4 as SQL [ADM-CARE-02, ADM-INV-13, ADM-INV-19, ADM-INV-10; LD59, LD60, LD67]: each reader finds what it should and is served by an index
// (EXPLAIN QUERY PLAN), and the reminder claim agrees with core `skipReasonOf` on a table of facts (the twin test).
import { uuidv7 } from "@techaust/core";
import { careDue } from "@techaust/core/care-billing";
import { type ReminderFacts, skipReasonOf } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import {
  CARE_DUE_SQL,
  REMINDER_CLAIM_SQL,
  REMINDER_DUE_SQL,
  REMINDER_FACTS_SQL,
  REMINDER_SKIP_SQL,
  SUPERSEDE_SQL,
  UNBILLED_SQL,
} from "../src/billing.ts";
import { PROFORMA_TAX_INVOICE_DUE_SQL } from "../src/issue.ts";
import {
  mkCarePlan,
  mkClientRow,
  mkContact,
  mkIssued,
  mkMember,
  mkReminder,
  mkSend,
  type PlanFixture,
} from "./billing-helpers.ts";
import { all, first, insertDraftInvoice, run } from "./helpers.ts";

const plan = async (
  o: Omit<NonNullable<Parameters<typeof mkCarePlan>[2]>, "status"> & {
    last?: string | null;
    status?: "paused" | "cancelled";
  } = {},
): Promise<PlanFixture> => {
  const owner = await mkMember();
  const p = await mkCarePlan(await mkClientRow(), owner, {
    ...o,
    status: o.status === "paused" ? "paused" : "active",
  });
  if (o.last) await run("UPDATE care_plans SET last_billed_period = ?2 WHERE id = ?1", p.planId, o.last);
  if (o.status === "cancelled") {
    await run(
      "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?1, ?2, 'cancelled', '2026-11-01', ?3, 9000)",
      uuidv7(),
      p.planId,
      owner,
    );
    await run("UPDATE care_plans SET status = 'cancelled' WHERE id = ?1", p.planId);
  }
  return p;
};

describe("every INDEXED BY in an exported SQL text names an index that exists (early check finding 9)", () => {
  it("scans the SQL constants of billing.ts and issue.ts", async () => {
    const billing = await import("../src/billing.ts");
    const issue = await import("../src/issue.ts");
    const texts = [...Object.values(billing), ...Object.values(issue)].filter(
      (v): v is string => typeof v === "string",
    );
    const used = new Set<string>();
    for (const t of texts) for (const m of t.matchAll(/INDEXED BY\s+(\w+)/g)) used.add(m[1] as string);
    expect([...used].sort()).toEqual(["milestones_unbilled", "reminders_pending"]);
    const have = new Set(
      (await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")).map((r) => r.name),
    );
    for (const name of used) expect(have.has(name), name).toBe(true);
  });
});

describe("CARE_DUE_SQL [ADM-CARE-02]", () => {
  /** Every page (the job continues past 50 with a message), as ids. */
  const due = async (today: string) => {
    const out: string[] = [];
    let after: [number, string] = [-1, ""];
    for (;;) {
      const page = await all<{ id: string; created_at: number }>(CARE_DUE_SQL, today, ...after);
      out.push(...page.map((r) => r.id));
      const last = page[page.length - 1];
      if (page.length < 50 || !last) return out;
      after = [last.created_at, last.id];
    }
  };

  it("lists active plans whose current period is not billed: never billed, or billed an earlier period; not the current one", async () => {
    const never = await plan({ start: "2026-01-05", billingDay: 5 });
    const earlier = await plan({ start: "2026-01-05", billingDay: 5, last: "2026-10-05" });
    const current = await plan({ start: "2026-01-05", billingDay: 5, last: "2026-11-05" });
    const ids = await due("2026-11-06");
    expect(ids).toContain(never.planId);
    expect(ids).toContain(earlier.planId);
    expect(ids).not.toContain(current.planId);
    // the next billing day makes the current one due again
    expect(await due("2026-12-05")).toContain(current.planId);
    expect(await due("2026-12-04")).not.toContain(current.planId);
  });
  it("a plan that has not started, a paused one and a cancelled one are not listed; a plan starting today is", async () => {
    const future = await plan({ start: "2026-11-12", billingDay: 5 });
    const startsToday = await plan({ start: "2026-11-06", billingDay: 5 });
    const paused = await plan({ start: "2026-01-05", billingDay: 5, status: "paused" });
    const cancelled = await plan({ start: "2026-01-05", billingDay: 5, status: "cancelled" });
    const ids = await due("2026-11-06");
    expect(ids).toContain(startsToday.planId);
    for (const p of [future, paused, cancelled]) expect(ids).not.toContain(p.planId);
  });
  it("the first, partial period is judged from the start date: billed on the start date means not due until the next billing day", async () => {
    const p = await plan({ start: "2026-11-06", billingDay: 5, last: "2026-11-06" });
    expect(await due("2026-11-06")).not.toContain(p.planId);
    expect(await due("2026-11-20")).not.toContain(p.planId);
    expect(await due("2026-12-05")).toContain(p.planId);
  });
  it("agrees with core careDue over a grid of plans, billing days, dates and last-billed values (one rule in two places)", async () => {
    const plans: { p: PlanFixture; billingDay: number; start: string; last: string | null }[] = [];
    for (const billingDay of [1, 5, 28])
      for (const start of ["2026-01-01", "2026-10-20", "2026-11-06"])
        for (const last of [
          null,
          "2026-09-01",
          "2026-10-05",
          "2026-11-01",
          "2026-11-05",
          "2026-11-06",
          "2026-12-01",
        ]) {
          // last-billed values before the start or in the future are impossible for the job but the SQL must still agree
          plans.push({ p: await plan({ start, billingDay, last }), billingDay, start, last });
        }
    for (const today of [
      "2026-11-06",
      "2026-11-28",
      "2026-12-01",
      "2027-02-28",
      "2028-02-28",
      "2028-03-01",
    ]) {
      const sql = new Set(await due(today));
      for (const { p, billingDay, start, last } of plans) {
        const d = careDue(today, { billingDay, startDate: start }, last, "active");
        expect(sql.has(p.planId), `${today} day ${billingDay} start ${start} last ${last}`).toBe(d.due);
      }
    }
  });
  it("is keyset-paged by (created_at, id), at most 50, and served by care_plans_status_created", async () => {
    for (let i = 0; i < 3; i++) await plan({ start: "2026-01-05", billingDay: 5 });
    const all1 = await all<{ id: string; created_at: number }>(CARE_DUE_SQL, "2026-11-06", -1, "");
    expect(all1.length).toBeGreaterThanOrEqual(3);
    expect(all1.length).toBeLessThanOrEqual(50);
    const [a, ...rest] = all1;
    const next = await all<{ id: string }>(CARE_DUE_SQL, "2026-11-06", a?.created_at ?? 0, a?.id ?? "");
    expect(next.map((r) => r.id)).toEqual(rest.map((r) => r.id));
    const plan1 = (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${CARE_DUE_SQL}`, "2026-11-06", -1, ""))
      .map((r) => r.detail)
      .join(" | ");
    expect(plan1).toMatch(/care_plans_status_created/);
    expect(plan1).not.toMatch(/SCAN care_plans\b(?! USING)/);
  });
});

describe("UNBILLED_SQL and PROFORMA_TAX_INVOICE_DUE_SQL [ADM-INV-19, ADM-INV-10, LD67]", () => {
  async function milestone(
    over: {
      status?: string;
      deliveredAt?: number | null;
      doc?: "none" | "proforma" | "paid_proforma" | "void_proforma" | "draft" | "invoice";
    } = {},
  ) {
    const clientId = await mkClientRow();
    const projectId = uuidv7();
    await run(
      "INSERT INTO projects (id, code, client_id, name, currency) VALUES (?1, ?2, ?3, 'P', 'INR')",
      projectId,
      `PRJ-${uuidv7()}`,
      clientId,
    );
    let documentId: string | null = null;
    if (over.doc === "proforma") documentId = await mkIssued(clientId, { type: "proforma", balance: 500 });
    if (over.doc === "paid_proforma") documentId = await mkIssued(clientId, { type: "proforma", balance: 0 });
    if (over.doc === "void_proforma")
      documentId = await mkIssued(clientId, { type: "proforma", status: "void", balance: 500 });
    if (over.doc === "invoice") documentId = await mkIssued(clientId, { type: "tax_invoice" });
    if (over.doc === "draft") documentId = await insertDraftInvoice(clientId);
    const id = uuidv7();
    await run(
      "INSERT INTO milestones (id, project_id, position, title, amount_minor, status, delivered_at, document_id) VALUES (?1, ?2, 1, 'M', 100, ?3, ?4, ?5)",
      id,
      projectId,
      over.status ?? "ready_to_bill",
      over.deliveredAt === undefined ? 1_000_000 : over.deliveredAt,
      documentId,
    );
    return id;
  }
  const ids = async (sql: string, cutoff: number, after: [number, string] = [-1, ""]) =>
    (await all<{ milestone_id: string }>(sql, cutoff, ...after)).map((r) => r.milestone_id);

  it("a delivered milestone with no live invoice document is unbilled; with a draft, a voided proforma or no document it is listed; delivered after the cutoff it is not", async () => {
    const none = await milestone();
    const draft = await milestone({ doc: "draft" });
    const voided = await milestone({ doc: "void_proforma" });
    const late = await milestone({ deliveredAt: 5_000_000 });
    const pending = await milestone({ status: "pending", deliveredAt: null });
    const invoiced = await milestone({ status: "invoiced" });
    const got = await ids(UNBILLED_SQL, 2_000_000);
    for (const m of [none, draft, voided]) expect(got).toContain(m);
    for (const m of [late, pending, invoiced]) expect(got).not.toContain(m);
    // the cutoff is inclusive: delivered exactly at it is listed
    expect(await ids(UNBILLED_SQL, 1_000_000)).toContain(none);
    expect(await ids(UNBILLED_SQL, 999_999)).not.toContain(none);
  });
  it("a milestone with a live proforma is only in the proforma list, while its balance is above zero; the two are disjoint", async () => {
    const withProforma = await milestone({ doc: "proforma" });
    const settled = await milestone({ doc: "paid_proforma" });
    const unbilled = await ids(UNBILLED_SQL, 2_000_000);
    const proforma = await ids(PROFORMA_TAX_INVOICE_DUE_SQL, 2_000_000);
    expect(unbilled).not.toContain(withProforma);
    expect(proforma).toContain(withProforma);
    for (const m of [unbilled, proforma]) expect(m).not.toContain(settled);
    expect(unbilled.filter((m) => proforma.includes(m))).toEqual([]);
  });
  it("the proforma list needs the milestone ready to bill (a pending or invoiced one is not due)", async () => {
    const pending = await milestone({ doc: "proforma", status: "pending", deliveredAt: 1_000_000 });
    const invoiced = await milestone({ doc: "proforma", status: "invoiced" });
    const proforma = await ids(PROFORMA_TAX_INVOICE_DUE_SQL, 2_000_000);
    expect(proforma).not.toContain(pending);
    expect(proforma).not.toContain(invoiced);
  });
  it("keyset-paged, at most 50, oldest first; both served by milestones_unbilled", async () => {
    const a = await milestone({ deliveredAt: 100 });
    const b = await milestone({ deliveredAt: 200 });
    const got = await ids(UNBILLED_SQL, 2_000_000);
    expect(got.indexOf(a)).toBeLessThan(got.indexOf(b));
    const after = await ids(UNBILLED_SQL, 2_000_000, [100, a]);
    expect(after).not.toContain(a);
    expect(after).toContain(b);
    expect(got.length).toBeLessThanOrEqual(50);
    for (const sql of [UNBILLED_SQL, PROFORMA_TAX_INVOICE_DUE_SQL]) {
      const text = (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, 2_000_000, -1, ""))
        .map((r) => r.detail)
        .join(" | ");
      expect(text).toMatch(/milestones_unbilled/);
    }
  });
});

describe("REMINDER_DUE_SQL and the claim [ADM-INV-13, LD60]", () => {
  async function doc(
    o: {
      type?: string;
      status?: string;
      balance?: number;
      policy?: string | null;
      anonymised?: boolean;
      recipient?: "yes" | "none" | "cancelled" | "portal_off" | "anonymised";
    } = {},
  ) {
    const clientId = await mkClientRow({ policy: o.policy ?? null });
    const owner = await mkMember();
    const parentId =
      o.type === "credit_note" || o.type === "debit_note" ? await mkIssued(clientId) : undefined;
    const documentId = await mkIssued(clientId, {
      type: o.type,
      status: o.status,
      balance: o.balance,
      ...(parentId ? { parentId } : {}),
    });
    const r = o.recipient ?? "yes";
    if (r !== "none") {
      const contact = await mkContact(clientId, {
        portal: r !== "portal_off",
        anonymised: r === "anonymised",
      });
      await mkSend(documentId, clientId, contact, { createdBy: owner, cancelled: r === "cancelled" });
    }
    if (o.anonymised) await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?", clientId);
    return { documentId, clientId };
  }
  const claim = async (id: string, now: number) => (await all(REMINDER_CLAIM_SQL, id, now)).length;

  it("the scan lists only waiting, due rows: sent, paused, skipped and future rows are left out; oldest first; keyset", async () => {
    const d = await doc();
    const dueAt = 900_000_000;
    const a = await mkReminder(d.documentId, -3, dueAt);
    const b = await mkReminder(d.documentId, 0, dueAt + 10);
    await mkReminder(d.documentId, 3, dueAt + 20, { sentAt: 5 });
    await mkReminder(d.documentId, 7, dueAt + 30, { skipped: "paused" });
    await mkReminder(d.documentId, 14, dueAt + 40, { skipped: "void" });
    await mkReminder(d.documentId, 15, 99_999_999_999);
    const got = (await all<{ id: string }>(REMINDER_DUE_SQL, 1_000_000_000, -1, "")).map((r) => r.id);
    expect(got).toEqual([a, b]);
    expect((await all<{ id: string }>(REMINDER_DUE_SQL, 1_000_000_000, dueAt, a)).map((r) => r.id)).toEqual([
      b,
    ]);
    const plan1 = (
      await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${REMINDER_DUE_SQL}`, 1_000_000_000, -1, "")
    )
      .map((r) => r.detail)
      .join(" | ");
    expect(plan1).toMatch(/reminders_pending/);
  });

  it("a live reminder is claimed once: the redelivery changes nothing", async () => {
    const d = await doc();
    const id = await mkReminder(d.documentId, 3, 1_000);
    expect(await claim(id, 2_000)).toBe(1);
    expect(
      (await first<{ sent_at: number }>("SELECT sent_at FROM reminders WHERE id = ?", id))?.sent_at,
    ).toBe(2_000);
    expect(await claim(id, 2_500)).toBe(0);
    expect(
      (await first<{ sent_at: number }>("SELECT sent_at FROM reminders WHERE id = ?", id))?.sent_at,
    ).toBe(2_000);
  });

  it("the claim carries every stop rule: it agrees with core skipReasonOf on a table of facts (the twin test)", async () => {
    type Scenario = {
      name: string;
      doc?: Parameters<typeof doc>[0];
      dueAt?: number;
      sentAt?: number;
      skipped?: string;
      later?: boolean;
      draft?: boolean;
    };
    const now = 2_000;
    const scenarios: Scenario[] = [
      { name: "live" },
      { name: "part paid", doc: { status: "partially_paid" } },
      { name: "part credited", doc: { status: "partially_credited" } },
      { name: "proforma", doc: { type: "proforma" } },
      { name: "debit note", doc: { type: "debit_note" } },
      { name: "credit note", doc: { type: "credit_note" } },
      { name: "paid", doc: { status: "paid", balance: 0 } },
      { name: "credited", doc: { status: "credited", balance: 0 } },
      {
        name: "part-paid proforma (converted, balance left)",
        doc: { type: "proforma", status: "converted" },
      },
      { name: "settled converted proforma", doc: { type: "proforma", status: "converted", balance: 0 } },
      { name: "converted debit note", doc: { type: "debit_note", status: "converted" } },
      { name: "void", doc: { status: "void" } },
      { name: "no balance", doc: { balance: 0 } },
      { name: "draft", draft: true },
      { name: "anonymised client", doc: { anonymised: true } },
      { name: "policy off", doc: { policy: '{"enabled":false}' } },
      { name: "policy on", doc: { policy: '{"enabled":true,"offsetsDays":[1]}' } },
      { name: "own offsets only", doc: { policy: '{"offsetsDays":[1]}' } },
      { name: "no contact", doc: { recipient: "none" } },
      { name: "send cancelled (links revoked)", doc: { recipient: "cancelled" } },
      { name: "portal access off", doc: { recipient: "portal_off" } },
      { name: "contact anonymised", doc: { recipient: "anonymised" } },
      { name: "later offset due", later: true },
      { name: "not due", dueAt: 3_000 },
      { name: "sent", sentAt: 5 },
      { name: "paused", skipped: "paused" },
      { name: "skipped for good", skipped: "void" },
      { name: "void and policy off", doc: { status: "void", policy: '{"enabled":false}' } },
      { name: "anonymised and no contact", doc: { anonymised: true, recipient: "none" } },
    ];
    for (const s of scenarios) {
      const d = await doc(s.doc);
      let documentId = d.documentId;
      if (s.draft) documentId = await insertDraftInvoice(d.clientId);
      const dueAt = s.dueAt ?? 1_000;
      const id = await mkReminder(documentId, 3, dueAt, {
        sentAt: s.sentAt ?? null,
        skipped: s.skipped ?? null,
      });
      if (s.later) await mkReminder(documentId, 7, 1_500);
      // the facts as the consumer reads them, then the twin
      const f = await first<Record<string, number | string | null>>(REMINDER_FACTS_SQL, id, now);
      expect(f, s.name).not.toBeNull();
      const facts: ReminderFacts = {
        sentAt: f?.sent_at as number | null,
        skippedReason: f?.skipped_reason as string | null,
        dueAt: f?.due_at as number,
        frozen: f?.frozen === 1,
        type: f?.type as string,
        status: f?.status as string,
        balanceMinor: f?.balance_minor as number,
        voided: f?.voided === 1,
        clientAnonymised: f?.client_anonymised === 1,
        policyEnabled: f?.policy_enabled === 1,
        hasRecipient: f?.has_recipient === 1,
        laterDue: f?.later_due === 1,
      };
      const reason = skipReasonOf(facts, now);
      const claimed = await claim(id, now);
      expect(claimed === 1, `${s.name}: claim ${claimed}, twin says ${reason}`).toBe(reason === null);
    }
  });

  it("an outage that lets three offsets pile up sends ONE: the earlier rows are refused while a later one is due, then superseded in the batch", async () => {
    const d = await doc();
    const now = 5_000_000;
    const r1 = await mkReminder(d.documentId, -3, 1_000);
    const r2 = await mkReminder(d.documentId, 0, 2_000);
    const r3 = await mkReminder(d.documentId, 3, 3_000);
    const paused = await mkReminder(d.documentId, 7, 4_000, { skipped: "paused" });
    const future = await mkReminder(d.documentId, 14, 9_999_999_999);
    // the scan reaches the oldest first: it is refused (a later one is due)
    expect(await claim(r1, now)).toBe(0);
    expect(await claim(r2, now)).toBe(0);
    expect(await claim(r3, now)).toBe(1);
    await run(SUPERSEDE_SQL, d.documentId, 3, now);
    const rows = await all<{ id: string; sent_at: number | null; skipped_reason: string | null }>(
      "SELECT id, sent_at, skipped_reason FROM reminders WHERE document_id = ? ORDER BY offset_days",
      d.documentId,
    );
    expect(rows.map((r) => [r.sent_at !== null, r.skipped_reason])).toEqual([
      [false, "superseded"],
      [false, "superseded"],
      [true, null],
      [false, "paused"],
      [false, null],
    ]);
    expect(rows.map((r) => r.id)).toEqual([r1, r2, r3, paused, future]);
  });

  it("a facts-based skip is written once and never read again (the scan no longer lists it)", async () => {
    const d = await doc({ status: "void" });
    const id = await mkReminder(d.documentId, 3, 1_000);
    expect(await claim(id, 2_000)).toBe(0);
    await run(REMINDER_SKIP_SQL, id, "void");
    expect((await all(REMINDER_DUE_SQL, 2_000, -1, "")).some((r) => (r as { id: string }).id === id)).toBe(
      false,
    );
    await run(REMINDER_SKIP_SQL, id, "other"); // a second write matches no row
    expect(
      (await first<{ s: string }>("SELECT skipped_reason AS s FROM reminders WHERE id = ?", id))?.s,
    ).toBe("void");
    expect(await claim(id, 2_000)).toBe(0);
  });

  it("a claim given back (sent_at back to NULL while no email is recorded) can be claimed again", async () => {
    const d = await doc();
    const id = await mkReminder(d.documentId, 3, 1_000);
    expect(await claim(id, 2_000)).toBe(1);
    await run(
      "UPDATE reminders SET sent_at = NULL WHERE id = ? AND sent_at = ? AND email_log_id IS NULL",
      id,
      2_000,
    );
    expect(await claim(id, 3_000)).toBe(1);
  });
});
