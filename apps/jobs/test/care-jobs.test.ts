// The care-plan billing messages in the jobs Worker [ADM-CARE-02, LD57, LD58, LD59]: `care.scan`, `care.bill`, `care.issue`, the typed wrapper around the admin API's entrypoint, and the
// dead letters. The entrypoint is a typed fake (`billing-fixtures.ts`); the real call over a service binding is the staging reading.

import { uuidv7 } from "@techaust/core";
import type { DraftCareResult, IssueCareResult } from "@techaust/core/care-billing";
import { fromIst, parseIsoDate } from "@techaust/core/dates";
import { CARE_DUE_SQL } from "@techaust/db/billing";
import { describe, expect, it } from "vitest";
import { processBillingDeadLetter } from "../src/billing.ts";
import { BillingRpcError, billingJobs } from "../src/billing-rpc.ts";
import {
  processCareBill,
  processCareDeadLetter,
  processCareIssue,
  processCareScan,
} from "../src/care-billing.ts";
import { all, fakes, logs, makeEnv, mkClient, one, run, staff, useFakes } from "./billing-fixtures.ts";

useFakes();

const at = (iso: string, hour = 0) => {
  const d = parseIsoDate(iso);
  if (!d) throw new Error("bad date");
  return fromIst(d, hour);
};
const NOW = at("2026-11-06", 6); // 06:00 IST, the day after a billing day of the 5th

async function plan(
  over: { start?: string; day?: number; last?: string | null; createdAt?: number; status?: string } = {},
) {
  const clientId = await mkClient();
  const id = uuidv7();
  await run(
    "INSERT INTO care_plans (id, client_id, tier, currency, price_minor, included_minutes, start_date, billing_day, status, rollover, last_billed_period, created_at) VALUES (?1, ?2, 'growth', 'INR', 2000000, 600, ?3, ?4, ?5, 'none', ?6, ?7)",
    id,
    clientId,
    over.start ?? "2026-01-05",
    over.day ?? 5,
    over.status ?? "active",
    over.last ?? null,
    over.createdAt ?? Date.now(),
  );
  return id;
}

const drafted = (over: Partial<DraftCareResult> = {}): DraftCareResult => ({
  result: "drafted",
  documentId: "doc-1",
  autoEligible: true,
  reasons: [],
  ...over,
});
const issued: IssueCareResult = { result: "issued", number: "TH/INV/2627/0001", reasons: [] };

describe("care.scan [ADM-CARE-02]", () => {
  it("queues one care.bill per active plan whose current period is not billed (never one already billed, paused or not started)", async () => {
    await run("DELETE FROM care_plans");
    const never = await plan();
    const earlier = await plan({ last: "2026-10-05" });
    const current = await plan({ last: "2026-11-05" });
    const future = await plan({ start: "2026-12-01" });
    const paused = await plan({ status: "paused" });
    const out = await processCareScan(makeEnv(), { after: null }, NOW);
    expect(out).toEqual({ plans: 2, continued: false });
    const bodies = fakes.leads.map((s) => s.body as { kind: string; planId: string });
    expect(bodies.map((b) => b.kind)).toEqual(["care.bill", "care.bill"]);
    expect(bodies.map((b) => b.planId).sort()).toEqual([never, earlier].sort());
    for (const id of [current, future, paused]) expect(bodies.some((b) => b.planId === id)).toBe(false);
    // ONE queue call
    expect(fakes.leads.every((s) => s.via === "sendBatch")).toBe(true);
  });

  it("a full page of 50 also queues the next scan with the last row's (created_at, id); the next page continues from it; no plan is billed twice by the scan", async () => {
    await run("DELETE FROM care_plans");
    const ids: string[] = [];
    for (let i = 0; i < 53; i++) ids.push(await plan({ createdAt: 1_000 + i }));
    const first = await processCareScan(makeEnv(), { after: null }, NOW);
    expect(first).toEqual({ plans: 50, continued: true });
    const bodies = fakes.leads.map(
      (s) => s.body as { kind: string; planId?: string; after?: { at: number; id: string } },
    );
    const next = bodies.find((b) => b.kind === "care.scan");
    expect(next?.after).toEqual({ at: 1_000 + 49, id: ids[49] });
    expect(bodies.filter((b) => b.kind === "care.bill")).toHaveLength(50);
    fakes.leads.length = 0;
    const second = await processCareScan(makeEnv(), { after: next?.after ?? null }, NOW);
    expect(second).toEqual({ plans: 3, continued: false });
    expect(fakes.leads.map((s) => (s.body as { planId: string }).planId)).toEqual(ids.slice(50));
  });

  it("nothing due queues nothing; the read uses the plan index", async () => {
    await run("DELETE FROM care_plans");
    expect(await processCareScan(makeEnv(), { after: null }, NOW)).toEqual({ plans: 0, continued: false });
    expect(fakes.leads).toEqual([]);
    const text = (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${CARE_DUE_SQL}`, "2026-11-06", -1, ""))
      .map((r) => r.detail)
      .join("\n");
    expect(text).toContain("care_plans_status_created");
  });
});

describe("care.bill: drafts through the entrypoint, then asks for the issue [LD57, early check finding 2]", () => {
  it("a draft the system may issue gets a care.issue message; one that needs a person does not", async () => {
    const env = makeEnv({}, { draftCarePlan: () => drafted() });
    expect(await processCareBill(env, { planId: "plan-1" })).toBe("drafted");
    expect(fakes.rpc).toEqual([{ method: "draftCarePlan", arg: { planId: "plan-1" } }]);
    expect(fakes.leads.map((s) => s.body)).toEqual([{ kind: "care.issue", documentId: "doc-1" }]);
    fakes.leads.length = 0;
    await processCareBill(
      makeEnv({}, { draftCarePlan: () => drafted({ autoEligible: false, reasons: ["toggle_off"] }) }),
      { planId: "p" },
    );
    expect(fakes.leads).toEqual([]);
  });

  it("already_billed with a draft still waiting and eligible re-queues the issue (the earlier enqueue may have failed); the issue itself is idempotent", async () => {
    const env = makeEnv({}, { draftCarePlan: () => drafted({ result: "already_billed" }) });
    expect(await processCareBill(env, { planId: "p" })).toBe("already_billed");
    expect(fakes.leads.map((s) => s.body)).toEqual([{ kind: "care.issue", documentId: "doc-1" }]);
  });

  it("already_billed with nothing waiting, not_due and skipped queue nothing", async () => {
    for (const answer of [
      { result: "already_billed", autoEligible: false, reasons: [] },
      { result: "not_due", autoEligible: false, reasons: [] },
      { result: "skipped", autoEligible: false, reasons: [], why: "client_anonymised" },
    ] as const) {
      expect(
        await processCareBill(makeEnv({}, { draftCarePlan: () => ({ ...answer }) }), { planId: "p" }),
      ).toBe(answer.result);
    }
    expect(fakes.leads).toEqual([]);
  });

  it("a failed enqueue of the issue THROWS, so the queue retries this message (and the retry finds the draft waiting)", async () => {
    const env = makeEnv(
      {
        LEADS_QUEUE: {
          send: async () => {
            throw new Error("queue down");
          },
        },
      },
      { draftCarePlan: () => drafted() },
    );
    await expect(processCareBill(env, { planId: "p" })).rejects.toThrow("queue down");
  });

  it("without the binding (production has none until Phase 7) or with a wrong answer it throws a coded error, never an id", async () => {
    await expect(processCareBill(makeEnv(), { planId: "plan-secret" })).rejects.toMatchObject({
      code: "rpc_unavailable",
    });
    const bad = makeEnv({}, { draftCarePlan: () => ({ result: "weird" }) });
    await expect(processCareBill(bad, { planId: "plan-secret" })).rejects.toBeInstanceOf(BillingRpcError);
    await expect(processCareBill(bad, { planId: "plan-secret" })).rejects.toMatchObject({
      code: "rpc_bad_result",
      message: "rpc_bad_result",
    });
    expect(logs.join("\n")).not.toContain("plan-secret");
  });
});

describe("care.issue", () => {
  it("calls the entrypoint with the draft's id and reports the answer; a wrong answer throws", async () => {
    const env = makeEnv({}, { issueCareDraft: () => issued });
    expect(await processCareIssue(env, { documentId: "doc-1" })).toBe("issued");
    expect(fakes.rpc).toEqual([{ method: "issueCareDraft", arg: { documentId: "doc-1" } }]);
    const refused = makeEnv({}, { issueCareDraft: () => ({ result: "refused", reasons: ["toggle_off"] }) });
    expect(await processCareIssue(refused, { documentId: "d" })).toBe("refused");
    await expect(
      processCareIssue(makeEnv({}, { issueCareDraft: () => 5 }), { documentId: "d" }),
    ).rejects.toMatchObject({ code: "rpc_bad_result" });
  });
});

describe("the typed wrapper checks the binding and every answer", () => {
  it("a binding without the two methods is rpc_unavailable; a stand-in that answers anything is checked by the result guards", async () => {
    expect(() => billingJobs({ ADMIN_JOBS: {} } as never)).toThrow(BillingRpcError);
    const api = billingJobs(makeEnv({}, { draftCarePlan: () => drafted(), issueCareDraft: () => issued }));
    expect(await api.draftCarePlan({ planId: "p" })).toMatchObject({ result: "drafted" });
    expect(await api.issueCareDraft({ documentId: "d" })).toMatchObject({ result: "issued" });
  });
});

describe("a care message that ran out of tries", () => {
  const bells = (kind: string) =>
    all<{ user_id: string; entity_type: string; entity_id: string; title: string; link: string }>(
      "SELECT user_id, entity_type, entity_id, title, link FROM notifications WHERE kind = ?1 ORDER BY user_id, entity_id",
      kind,
    );

  it("rings every ACTIVE owner once per plan per IST day (not staff, not a suspended owner); the title names no client and no amount", async () => {
    await run("DELETE FROM notifications WHERE kind = 'care.billing_failed'");
    const o1 = await staff("owner");
    const o2 = await staff("owner");
    await staff("owner", { status: "deactivated" });
    await staff("staff");
    const body = { kind: "care.bill", planId: "plan-9" } as const;
    await processCareDeadLetter(makeEnv(), body, NOW);
    await processCareDeadLetter(makeEnv(), body, NOW + 3_600_000); // the same IST day
    const rows = (await bells("care.billing_failed")).filter((r) => r.entity_id.startsWith("plan-9"));
    expect(rows.map((r) => r.user_id).sort()).toEqual([o1.id, o2.id].sort());
    expect(rows[0]).toMatchObject({
      entity_type: "care_plan",
      entity_id: "plan-9:2026-11-06",
      link: "/care-plans/plan-9",
    });
    expect(rows[0]?.title).toMatch(/^\[Placeholder, 07-U\] /);
    await processCareDeadLetter(makeEnv(), body, NOW + 86_400_000); // the next IST day rings again
    expect((await bells("care.billing_failed")).filter((r) => r.entity_id.startsWith("plan-9"))).toHaveLength(
      4,
    );
  });

  it("a failed care.bill names the client and the period in 07-U §7's words; a plan that cannot be read gets the plain line", async () => {
    await run("DELETE FROM notifications WHERE kind = 'care.billing_failed'");
    await staff("owner");
    const id = await plan();
    const client = await one<{ display_name: string }>(
      "SELECT k.display_name FROM care_plans p JOIN clients k ON k.id = p.client_id WHERE p.id = ?1",
      id,
    );
    await processCareDeadLetter(makeEnv(), { kind: "care.bill", planId: id }, NOW);
    const rows = (await bells("care.billing_failed")).filter((r) => r.entity_id.startsWith(id));
    expect(rows[0]?.title).toBe(
      `[Placeholder, 07-U] The care invoice for ${client?.display_name} (05 Nov 2026 to 04 Dec 2026) couldn't be drafted. Open the care plan to see why.`,
    );
    await processCareDeadLetter(makeEnv(), { kind: "care.bill", planId: "no-such-plan" }, NOW);
    const plain = (await bells("care.billing_failed")).find((r) => r.entity_id.startsWith("no-such-plan"));
    expect(plain?.title).toBe(
      "[Placeholder, 07-U] A care invoice couldn't be drafted. Open the care plan to see why.",
    );
  });

  it("a care.issue dead letter links the draft; the scans and the alerts only log (the next run lists the same work), through the leads dead-letter queue", async () => {
    await run("DELETE FROM notifications WHERE kind = 'care.billing_failed'");
    const owner = await staff("owner");
    await processBillingDeadLetter(makeEnv(), { kind: "care.issue", documentId: "doc-7" } as never, NOW);
    const rows = await bells("care.billing_failed");
    expect(rows.map((r) => r.user_id)).toContain(owner.id); // (owners of the earlier tests are still in this file's database)
    for (const r of rows) expect(r).toMatchObject({ entity_type: "document", link: "/invoices/doc-7" });
    await run("DELETE FROM notifications WHERE kind = 'care.billing_failed'");
    for (const body of [
      { kind: "care.scan", after: null },
      { kind: "reminder.scan", after: null },
      { kind: "alerts.daily", first: true, unbilledAfter: null, proformaAfter: null },
      { kind: "care.bill" },
    ])
      await processBillingDeadLetter(makeEnv(), body as never, NOW);
    expect(await bells("care.billing_failed")).toEqual([]);
    expect(fakes.leads).toEqual([]); // nothing re-queued: tomorrow's run lists the same work
    expect(await one<{ n: number }>("SELECT count(*) AS n FROM leads WHERE 1 = 0")).toEqual({ n: 0 });
  });
});
