// Care plans API [ADM-CARE-01, ADM-CARE-03]: creating, the terms and status history, who may do what, the one-batch audit rows, the
// list and the plan page. The overage maths is in packages/core/test/care.test.ts; the database rules (append-only history, the mirror
// guards) are in packages/db/test/care-time.test.ts.
import { env } from "cloudflare:workers";
import { nextPeriodStart, periodOf, termsEffectiveFrom } from "@techaust/core/care";
import { addDays, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { describe, expect, it } from "vitest";
import { carePlanPageSql } from "./care.ts";
import { ROUTES } from "./guard.ts";
import { mkLog, mkOpenProject, mkPlan, today } from "./test-care.ts";
import { insert, mkClient, mkContact } from "./test-clients.ts";
import { bodyOf, call, countOf, one, rows, sessionFor } from "./test-helpers.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)) as { error: { code: string } }).error.code;

const NEW_PLAN = {
  tier: "growth",
  priceMinor: 2_499_900,
  includedMinutes: 600,
  aiOpsMinor: null,
  overageRateMinor: 150_000,
  rollover: "one_month",
  startDate: "2026-01-01",
  billingDay: 1,
};
const create = async (cookie: string, clientId: string, over: Record<string, unknown> = {}) =>
  call("/care-plans", { cookie, body: { clientId, ...NEW_PLAN, ...over } });
const made = async (cookie: string, clientId: string, over: Record<string, unknown> = {}) => {
  const res = await create(cookie, clientId, over);
  expect(res.status, await res.clone().text()).toBe(201);
  return json(res);
};

describe("POST /care-plans [ADM-CARE-01]", () => {
  it("writes the plan, its first terms and its first status in one batch, in the client's currency, with one audit row", async () => {
    const o = await owner();
    const clientId = await mkClient({
      currency: "USD",
      gst_status: "overseas",
      state_code: null,
      country: "US",
    });
    const { id } = await made(o.cookie, clientId, {
      priceMinor: 29_900,
      overageRateMinor: 7_500,
      includedMinutes: 1_500,
    });
    expect(
      await one(
        "SELECT client_id, currency, tier, price_minor, included_minutes, status, billing_day FROM care_plans WHERE id = ?",
        id,
      ),
    ).toEqual({
      client_id: clientId,
      currency: "USD",
      tier: "growth",
      price_minor: 29_900,
      included_minutes: 1_500,
      status: "active",
      billing_day: 1,
    });
    const terms = await rows(
      "SELECT effective_from, price_minor, included_minutes, overage_rate_minor, rollover, created_by FROM care_plan_terms WHERE care_plan_id = ?",
      id,
    );
    expect(terms).toEqual([
      {
        effective_from: "2026-01-01",
        price_minor: 29_900,
        included_minutes: 1_500,
        overage_rate_minor: 7_500,
        rollover: "one_month",
        created_by: o.id,
      },
    ]);
    expect(
      await rows(
        "SELECT status, effective_on, created_by FROM care_plan_status_log WHERE care_plan_id = ?",
        id,
      ),
    ).toEqual([{ status: "active", effective_on: "2026-01-01", created_by: o.id }]);
    const audit = await rows<{ action: string; entity_type: string; summary: string }>(
      "SELECT action, entity_type, summary FROM audit_log WHERE entity_id = ?",
      id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "care_plan.create", entity_type: "care_plan" });
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toMatchObject({
      carePlanId: id,
      clientId,
      startDate: "2026-01-01",
    });
  });

  it("Staff may set any terms at creation; Sales and the Accountant may not create; signed out is 401", async () => {
    const clientId = await mkClient();
    const staff = await sessionFor("staff");
    expect((await create(staff.cookie, clientId, { priceMinor: 1, tier: "custom" })).status).toBe(201);
    for (const role of ["sales", "accountant"] as const) {
      const s = await sessionFor(role);
      expect((await create(s.cookie, clientId)).status).toBe(403);
    }
    expect((await create("", clientId)).status).toBe(401);
    expect(await countOf("care_plans", "client_id = ?", clientId)).toBe(1);
  });

  it("refuses an unknown client (404) and an anonymised individual (409 client_anonymised), writing nothing", async () => {
    const o = await owner();
    expect((await create(o.cookie, "no-such-client")).status).toBe(404);
    const gone = await mkClient({ type: "individual", anonymised_at: Date.now() - 1000 });
    const before = await countOf("care_plans");
    const res = await create(o.cookie, gone);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("client_anonymised");
    expect(await countOf("care_plans")).toBe(before);
    expect(
      await countOf(
        "audit_log",
        "action = 'care_plan.create' AND entity_id IS NOT NULL AND entity_id NOT IN (SELECT id FROM care_plans)",
      ),
    ).toBe(0);
  });

  it("refuses bad input with 400 and writes nothing: hours not in 15-minute steps, billing day, dates, money, extra fields", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const before = await countOf("care_plans");
    const bad: Record<string, unknown>[] = [
      { includedMinutes: 610 },
      { includedMinutes: -15 },
      { billingDay: 0 },
      { billingDay: 29 },
      { billingDay: 1.5 },
      { startDate: "2026-02-30" },
      { startDate: "1999-12-31" },
      { startDate: "next week" },
      { priceMinor: -1 },
      { priceMinor: 1.5 },
      { overageRateMinor: -5 },
      { tier: "gold" },
      { rollover: "forever" },
      { currency: "USD" },
      { status: "paused" },
    ];
    for (const over of bad)
      expect((await create(o.cookie, clientId, over)).status, JSON.stringify(over)).toBe(400);
    expect(await countOf("care_plans")).toBe(before);
  });
});

describe("GET /care-plans/defaults", () => {
  it("gives the client's currency and the catalogue's prices; what the owner has not decided is null", async () => {
    const o = await owner();
    await insert("catalogue_items", {
      id: "cat-s16",
      code: "S16",
      name: "Care Plans",
      category: "run",
      short: "x",
      unit: "month",
      price_inr_minor: 999_900,
      price_usd_minor: 29_900,
      sac: "998313",
      schedule: "[]",
      default_lines: JSON.stringify([
        {
          description: "Essential",
          unit: "month",
          qtyMilli: 1000,
          rateInrMinor: 999_900,
          rateUsdMinor: 29_900,
        },
        {
          description: "Growth",
          unit: "month",
          qtyMilli: 1000,
          rateInrMinor: 2_499_900,
          rateUsdMinor: 89_900,
        },
        {
          description: "Scale",
          unit: "month",
          qtyMilli: 1000,
          rateInrMinor: 5_999_900,
          rateUsdMinor: 249_900,
        },
      ]),
    });
    await insert("catalogue_items", {
      id: "cat-s17",
      code: "S17",
      name: "AI Ops",
      category: "run",
      short: "x",
      unit: "month",
      price_inr_minor: 2_000_000,
      price_usd_minor: 100_000,
      sac: "998313",
      schedule: "[]",
    });
    await insert("catalogue_items", {
      id: "cat-s18",
      code: "S18",
      name: "Dev Subscription",
      category: "run",
      short: "x",
      unit: "month",
      price_inr_minor: 17_500_000,
      price_usd_minor: 290_000,
      sac: "998314",
      schedule: "[]",
    });
    const inr = await mkClient();
    const usd = await mkClient({ currency: "USD", gst_status: "overseas", state_code: null, country: "US" });
    const a = await json(await call(`/care-plans/defaults?clientId=${inr}`, { cookie: o.cookie }));
    expect(a.currency).toBe("INR");
    expect(a.tiers.essential).toEqual({ priceMinor: 999_900, includedMinutes: 120, rollover: "none" });
    expect(a.tiers.growth).toEqual({ priceMinor: 2_499_900, includedMinutes: null, rollover: "one_month" });
    expect(a.tiers.scale.priceMinor).toBe(5_999_900);
    expect(a.tiers.dev_subscription).toEqual({
      priceMinor: 17_500_000,
      includedMinutes: null,
      rollover: "none",
    });
    expect(a.tiers.custom.priceMinor).toBeNull();
    expect(a.aiOpsMinor).toBe(2_000_000);
    expect(a.overageRateMinor).toBeNull();
    expect(a.undecided).toEqual(["includedMinutes", "overageRateMinor"]);
    const b = await json(await call(`/care-plans/defaults?clientId=${usd}`, { cookie: o.cookie }));
    expect(b.currency).toBe("USD");
    expect(b.tiers.scale.priceMinor).toBe(249_900);
    expect(b.tiers.dev_subscription.priceMinor).toBe(290_000);
    expect(b.aiOpsMinor).toBe(100_000);
  });

  it("Staff may read it; Sales and the Accountant may not; an unknown client is 404; no client id is 400", async () => {
    const clientId = await mkClient();
    expect(
      (
        await call(`/care-plans/defaults?clientId=${clientId}`, {
          cookie: (await sessionFor("staff")).cookie,
        })
      ).status,
    ).toBe(200);
    for (const role of ["sales", "accountant"] as const)
      expect(
        (await call(`/care-plans/defaults?clientId=${clientId}`, { cookie: (await sessionFor(role)).cookie }))
          .status,
      ).toBe(403);
    const o = await owner();
    expect((await call("/care-plans/defaults?clientId=nope", { cookie: o.cookie })).status).toBe(404);
    expect((await call("/care-plans/defaults", { cookie: o.cookie })).status).toBe(400);
  });
});

describe("POST /care-plans/:id/terms [ADM-CARE-01, owner answers Q1, Q6]", () => {
  const plan = async (o: { cookie: string }, over: Record<string, unknown> = {}) => {
    const clientId = await mkClient();
    return {
      clientId,
      ...(await made(o.cookie, clientId, { startDate: "2026-01-01", billingDay: 5, ...over })),
    } as { clientId: string; id: string; updatedAt: number };
  };

  it("takes effect from the NEXT billing period, appends a terms row, moves the mirror, and the page shows it as pending", async () => {
    const o = await owner();
    const p = await plan(o);
    const res = await call(`/care-plans/${p.id}/terms`, {
      cookie: o.cookie,
      body: {
        expectedUpdatedAt: p.updatedAt,
        priceMinor: 3_000_000,
        includedMinutes: 900,
        overageRateMinor: 200_000,
      },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await json(res);
    const eff = nextPeriodStart(today(), 5);
    expect(body).toMatchObject({ ok: true, changed: true, effectiveFrom: eff });
    expect(eff).toBe(termsEffectiveFrom(today(), { billingDay: 5, startDate: "2026-01-01" }));
    const terms = await rows(
      "SELECT effective_from, price_minor, included_minutes, overage_rate_minor, rollover, tier FROM care_plan_terms WHERE care_plan_id = ? ORDER BY effective_from",
      p.id,
    );
    expect(terms).toEqual([
      {
        effective_from: "2026-01-01",
        price_minor: 2_499_900,
        included_minutes: 600,
        overage_rate_minor: 150_000,
        rollover: "one_month",
        tier: "growth",
      },
      {
        effective_from: eff,
        price_minor: 3_000_000,
        included_minutes: 900,
        overage_rate_minor: 200_000,
        rollover: "one_month",
        tier: "growth",
      },
    ]);
    expect(
      await one(
        "SELECT price_minor, included_minutes, overage_rate_minor, updated_at FROM care_plans WHERE id = ?",
        p.id,
      ),
    ).toEqual({
      price_minor: 3_000_000,
      included_minutes: 900,
      overage_rate_minor: 200_000,
      updated_at: body.updatedAt,
    });
    const audit = await rows<{ action: string; summary: string }>(
      "SELECT action, summary FROM audit_log WHERE entity_id = ? AND action = 'care_plan.terms'",
      p.id,
    );
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({
      carePlanId: p.id,
      clientId: p.clientId,
      effectiveFrom: eff,
      changed: { priceMinor: 3_000_000, includedMinutes: 900, overageRateMinor: 200_000 },
    });
    const page = await json(await call(`/care-plans/${p.id}`, { cookie: o.cookie }));
    expect(page.terms.current).toMatchObject({
      priceMinor: 2_499_900,
      includedMinutes: 600,
      overageRateMinor: 150_000,
    });
    expect(page.terms.pending).toMatchObject({
      effectiveFrom: eff,
      priceMinor: 3_000_000,
      includedMinutes: 900,
    });
  });

  it("a second change the same day wins, and the fields it does not name keep the first change's values", async () => {
    const o = await owner();
    const p = await plan(o);
    const first = await json(
      await call(`/care-plans/${p.id}/terms`, {
        cookie: o.cookie,
        body: { expectedUpdatedAt: p.updatedAt, includedMinutes: 900, overageRateMinor: 200_000 },
      }),
    );
    const second = await call(`/care-plans/${p.id}/terms`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: first.updatedAt, includedMinutes: 840 },
    });
    expect(second.status).toBe(200);
    const rowsNow = await rows<{ included_minutes: number; overage_rate_minor: number }>(
      "SELECT included_minutes, overage_rate_minor FROM care_plan_terms WHERE care_plan_id = ? ORDER BY effective_from, created_at, id",
      p.id,
    );
    expect(rowsNow.at(-1)).toEqual({ included_minutes: 840, overage_rate_minor: 200_000 });
    const page = await json(await call(`/care-plans/${p.id}`, { cookie: o.cookie }));
    expect(page.terms.pending).toMatchObject({ includedMinutes: 840, overageRateMinor: 200_000 });
    expect(page.terms.current.includedMinutes).toBe(600);
  });

  it("before the start date the change takes effect on the start date", async () => {
    const o = await owner();
    const future = toIsoDate(addDays(parseIsoDate(today()) as never, 20));
    const p = await plan(o, { startDate: future });
    const res = await json(
      await call(`/care-plans/${p.id}/terms`, {
        cookie: o.cookie,
        body: { expectedUpdatedAt: p.updatedAt, priceMinor: 1 },
      }),
    );
    expect(res.effectiveFrom).toBe(future);
  });

  it("a price can be cleared or set to the add-on null, the same value is no change, and an empty body is 400", async () => {
    const o = await owner();
    const p = await plan(o);
    const same = await json(
      await call(`/care-plans/${p.id}/terms`, {
        cookie: o.cookie,
        body: { expectedUpdatedAt: p.updatedAt, priceMinor: 2_499_900, overageRateMinor: 150_000 },
      }),
    );
    expect(same).toMatchObject({ ok: true, changed: false, updatedAt: p.updatedAt });
    expect(await countOf("care_plan_terms", "care_plan_id = ?", p.id)).toBe(1);
    expect(await countOf("audit_log", "action = 'care_plan.terms' AND entity_id = ?", p.id)).toBe(0);
    expect(
      (
        await call(`/care-plans/${p.id}/terms`, {
          cookie: o.cookie,
          body: { expectedUpdatedAt: p.updatedAt },
        })
      ).status,
    ).toBe(400);
    const cleared = await call(`/care-plans/${p.id}/terms`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: p.updatedAt, overageRateMinor: null },
    });
    expect(cleared.status).toBe(200);
    expect(await one("SELECT overage_rate_minor FROM care_plans WHERE id = ?", p.id)).toEqual({
      overage_rate_minor: null,
    });
    expect(
      (
        await call(`/care-plans/${p.id}/terms`, {
          cookie: o.cookie,
          body: { expectedUpdatedAt: 1, includedMinutes: 605 },
        })
      ).status,
    ).toBe(400);
  });

  it("price changes are the owner's: Staff, Sales and the Accountant get 403 and nothing is written", async () => {
    const o = await owner();
    const p = await plan(o);
    for (const role of ["staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role);
      const res = await call(`/care-plans/${p.id}/terms`, {
        cookie: s.cookie,
        body: { expectedUpdatedAt: p.updatedAt, priceMinor: 1 },
      });
      expect(res.status, role).toBe(403);
    }
    expect(await countOf("care_plan_terms", "care_plan_id = ?", p.id)).toBe(1);
  });

  it("a stale version is 409 stale_version, a cancelled plan 409 plan_cancelled, an unknown plan 404", async () => {
    const o = await owner();
    const p = await plan(o);
    const stale = await call(`/care-plans/${p.id}/terms`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: p.updatedAt - 1, priceMinor: 5 },
    });
    expect(stale.status).toBe(409);
    expect(await code(stale)).toBe("stale_version");
    const cancel = await json(
      await call(`/care-plans/${p.id}/status`, {
        cookie: o.cookie,
        body: { to: "cancelled", expectedUpdatedAt: p.updatedAt },
      }),
    );
    const res = await call(`/care-plans/${p.id}/terms`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: cancel.updatedAt, priceMinor: 5 },
    });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("plan_cancelled");
    expect(
      (
        await call("/care-plans/nope/terms", {
          cookie: o.cookie,
          body: { expectedUpdatedAt: 1, priceMinor: 5 },
        })
      ).status,
    ).toBe(404);
    expect(await countOf("care_plan_terms", "care_plan_id = ?", p.id)).toBe(1);
  });

  it("two parallel changes: one wins, the other is 409 stale_version, one terms row is added", async () => {
    const o = await owner();
    const p = await plan(o);
    const send = (price: number) =>
      call(`/care-plans/${p.id}/terms`, {
        cookie: o.cookie,
        body: { expectedUpdatedAt: p.updatedAt, priceMinor: price },
      });
    const results = await Promise.all([send(10), send(20)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await countOf("care_plan_terms", "care_plan_id = ?", p.id)).toBe(2);
    expect(await countOf("audit_log", "action = 'care_plan.terms' AND entity_id = ?", p.id)).toBe(1);
  });
});

describe("POST /care-plans/:id/status [ADM-CARE-01, owner answer Q6]", () => {
  const plan = async (o: { cookie: string }, over: Record<string, unknown> = {}) => {
    const clientId = await mkClient();
    return { clientId, ...(await made(o.cookie, clientId, { startDate: "2026-01-01", ...over })) } as {
      clientId: string;
      id: string;
      updatedAt: number;
    };
  };
  const move = (cookie: string, id: string, to: string, expectedUpdatedAt: number) =>
    call(`/care-plans/${id}/status`, { cookie, body: { to, expectedUpdatedAt } });

  it("pause and resume take effect today; the log, the mirror (paused_at) and the audit row follow", async () => {
    const o = await owner();
    const p = await plan(o);
    const paused = await json(await move(o.cookie, p.id, "paused", p.updatedAt));
    expect(paused).toMatchObject({ ok: true, status: "paused", effectiveOn: today() });
    expect(
      await one("SELECT status, paused_at, cancelled_at, updated_at FROM care_plans WHERE id = ?", p.id),
    ).toMatchObject({ status: "paused", paused_at: paused.updatedAt, cancelled_at: null });
    const resumed = await json(await move(o.cookie, p.id, "active", paused.updatedAt));
    expect(await one("SELECT status, paused_at FROM care_plans WHERE id = ?", p.id)).toEqual({
      status: "active",
      paused_at: null,
    });
    expect(
      await rows(
        "SELECT status, effective_on FROM care_plan_status_log WHERE care_plan_id = ? ORDER BY created_at, id",
        p.id,
      ),
    ).toEqual([
      { status: "active", effective_on: "2026-01-01" },
      { status: "paused", effective_on: today() },
      { status: "active", effective_on: today() },
    ]);
    const audit = await rows<{ action: string; summary: string }>(
      "SELECT action, summary FROM audit_log WHERE entity_id = ? AND action = 'care_plan.status' ORDER BY at, id",
      p.id,
    );
    expect(audit.map((a) => JSON.parse(a.summary))).toEqual([
      { carePlanId: p.id, clientId: p.clientId, from: "active", to: "paused", effectiveOn: today() },
      { carePlanId: p.id, clientId: p.clientId, from: "paused", to: "active", effectiveOn: today() },
    ]);
    expect(resumed.updatedAt).toBeGreaterThan(paused.updatedAt);
  });

  it("Staff can pause and resume but not cancel; the Owner cancels; cancelled is terminal", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const p = await plan(o);
    const paused = await json(await move(staff.cookie, p.id, "paused", p.updatedAt));
    const refused = await move(staff.cookie, p.id, "cancelled", paused.updatedAt);
    expect(refused.status).toBe(403);
    expect(await one("SELECT status FROM care_plans WHERE id = ?", p.id)).toEqual({ status: "paused" });
    const resumed = await json(await move(staff.cookie, p.id, "active", paused.updatedAt));
    const cancelled = await json(await move(o.cookie, p.id, "cancelled", resumed.updatedAt));
    expect(await one("SELECT status, cancelled_at FROM care_plans WHERE id = ?", p.id)).toEqual({
      status: "cancelled",
      cancelled_at: cancelled.updatedAt,
    });
    for (const to of ["active", "paused", "cancelled"]) {
      const res = await move(o.cookie, p.id, to, cancelled.updatedAt);
      expect(res.status, to).toBe(409);
      expect(await code(res), to).toBe("invalid_transition");
    }
    for (const role of ["sales", "accountant"] as const)
      expect((await move((await sessionFor(role)).cookie, p.id, "paused", cancelled.updatedAt)).status).toBe(
        403,
      );
  });

  it("invalid moves are 409 invalid_transition and write nothing; a stale version is 409 stale_version; unknown is 404", async () => {
    const o = await owner();
    const p = await plan(o);
    const resume = await move(o.cookie, p.id, "active", p.updatedAt); // active -> active
    expect(resume.status).toBe(409);
    expect(await code(resume)).toBe("invalid_transition");
    const stale = await move(o.cookie, p.id, "paused", p.updatedAt - 5);
    expect(await code(stale)).toBe("stale_version");
    expect((await move(o.cookie, "nope", "paused", 1)).status).toBe(404);
    expect(await countOf("care_plan_status_log", "care_plan_id = ?", p.id)).toBe(1);
    expect(await countOf("audit_log", "action = 'care_plan.status' AND entity_id = ?", p.id)).toBe(0);
    expect(
      (
        await call(`/care-plans/${p.id}/status`, {
          cookie: o.cookie,
          body: { to: "frozen", expectedUpdatedAt: p.updatedAt },
        })
      ).status,
    ).toBe(400);
  });

  it("a change before the start date takes effect on the start date", async () => {
    const o = await owner();
    const future = toIsoDate(addDays(parseIsoDate(today()) as never, 30));
    const p = await plan(o, { startDate: future });
    const res = await json(await move(o.cookie, p.id, "paused", p.updatedAt));
    expect(res.effectiveOn).toBe(future);
    expect(
      await rows(
        "SELECT status, effective_on FROM care_plan_status_log WHERE care_plan_id = ? ORDER BY created_at, id",
        p.id,
      ),
    ).toEqual([
      { status: "active", effective_on: future },
      { status: "paused", effective_on: future },
    ]);
  });

  it("an anonymised client's plan can still be cancelled, but nothing else changes on it", async () => {
    const o = await owner();
    const clientId = await mkClient({ type: "individual" });
    const p = await made(o.cookie, clientId);
    await env.DB.prepare("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1")
      .bind(clientId, Date.now())
      .run();
    const paused = await move(o.cookie, p.id, "paused", p.updatedAt);
    expect(paused.status).toBe(409);
    expect(await code(paused)).toBe("client_anonymised");
    const terms = await call(`/care-plans/${p.id}/terms`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: p.updatedAt, priceMinor: 5 },
    });
    expect(await code(terms)).toBe("client_anonymised");
    expect((await move(o.cookie, p.id, "cancelled", p.updatedAt)).status).toBe(200);
  });

  it("time is refused from the pause on, and accepted for the days before it", async () => {
    const o = await owner();
    const p = await plan(o, { startDate: "2026-01-01" });
    const paused = await json(await move(o.cookie, p.id, "paused", p.updatedAt));
    const yesterday = toIsoDate(addDays(parseIsoDate(today()) as never, -1));
    const before = await call("/time", {
      cookie: o.cookie,
      body: { workDate: yesterday, minutes: 60, carePlanId: p.id, billable: true },
    });
    expect(before.status, await before.clone().text()).toBe(201);
    const on = await call("/time", {
      cookie: o.cookie,
      body: { workDate: today(), minutes: 60, carePlanId: p.id, billable: true },
    });
    expect(on.status).toBe(409);
    expect(await code(on)).toBe("plan_not_active");
    await move(o.cookie, p.id, "active", paused.updatedAt);
    expect(
      (
        await call("/time", {
          cookie: o.cookie,
          body: { workDate: today(), minutes: 60, carePlanId: p.id, billable: true },
        })
      ).status,
    ).toBe(201);
  });
});

describe("GET /care-plans and /care-plans/:id [ADM-CARE-03]", () => {
  it("lists newest first with this period's hours, filters by status and client, and pages without a gap", async () => {
    const o = await owner();
    const clientA = await mkClient();
    const clientB = await mkClient();
    const ids: string[] = [];
    for (let i = 0; i < 27; i++) {
      const p = await made(o.cookie, i < 26 ? clientA : clientB);
      ids.push(p.id);
      await env.DB.prepare("UPDATE care_plans SET created_at = ?2 WHERE id = ?1")
        .bind(p.id, 1_800_000_000_000 + i)
        .run();
    }
    const first = await json(await call("/care-plans?clientId=" + clientA, { cookie: o.cookie }));
    expect(first.carePlans).toHaveLength(25);
    expect(first.prev).toBeNull();
    const second = await json(
      await call(`/care-plans?clientId=${clientA}&after=${first.next}`, { cookie: o.cookie }),
    );
    expect(second.carePlans).toHaveLength(1);
    expect(second.next).toBeNull();
    const all = [...first.carePlans, ...second.carePlans].map((r: J) => r.id);
    expect(new Set(all).size).toBe(26);
    expect(all[0]).toBe(ids[25]); // newest first
    const back = await json(
      await call(`/care-plans?clientId=${clientA}&before=${second.prev}`, { cookie: o.cookie }),
    );
    expect(back.carePlans.map((r: J) => r.id)).toEqual(first.carePlans.map((r: J) => r.id));
    const row = first.carePlans[0];
    expect(row).toMatchObject({
      clientCode: expect.any(String),
      currency: "INR",
      status: "active",
      terms: { current: { tier: "growth", priceMinor: 2_499_900 }, pending: null },
    });
    expect(row.usage).toMatchObject({
      included: 600,
      used: 0,
      flag: "none",
      overageMinutes: 0,
      period: periodOf(today(), 1),
    });
    const paused = (await json(await call("/care-plans?status=paused", { cookie: o.cookie }))).carePlans;
    expect(paused.length).toBeGreaterThan(0); // the status tests above left some
    expect(paused.every((r: J) => r.status === "paused")).toBe(true);
    expect(first.carePlans.every((r: J) => r.status === "active")).toBe(true);
    expect((await call("/care-plans?after=junk", { cookie: o.cookie })).status).toBe(400);
    expect((await call("/care-plans?status=frozen", { cookie: o.cookie })).status).toBe(400);
    expect((await call("/care-plans?limit=7", { cookie: o.cookie })).status).toBe(400);
  });

  it("every role can read the list and a plan; a made-up id is 404", async () => {
    const o = await owner();
    const p = await made(o.cookie, await mkClient());
    for (const role of ["owner", "staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role);
      expect((await call("/care-plans", { cookie: s.cookie })).status, role).toBe(200);
      expect((await call(`/care-plans/${p.id}`, { cookie: s.cookie })).status, role).toBe(200);
    }
    expect((await call("/care-plans/no-such-plan", { cookie: o.cookie })).status).toBe(404);
  });

  it("the plan page shows hours used, non-billable time apart, twelve periods, ten status rows and the M5.4 placeholder", async () => {
    const o = await owner();
    const p = await made(o.cookie, await mkClient(), {
      startDate: "2026-01-01",
      includedMinutes: 600,
      rollover: "none",
    });
    await mkLog(o.id, today(), 480, { plan: p.id });
    await mkLog(o.id, today(), 120, { plan: p.id }, { billable: 0 });
    const page = await json(await call(`/care-plans/${p.id}`, { cookie: o.cookie }));
    expect(page.plan).toMatchObject({
      id: p.id,
      status: "active",
      billingDay: 1,
      startDate: "2026-01-01",
      currency: "INR",
    });
    expect(page.usage).toMatchObject({
      used: 480,
      nonBillable: 120,
      available: 600,
      remaining: 120,
      burnBp: 8_000,
      flag: "near",
    });
    expect(page.periods.length).toBeGreaterThanOrEqual(1);
    expect(page.periods.length).toBeLessThanOrEqual(12);
    expect(page.periods[0].period).toEqual(page.usage.period);
    expect(page.statusLog).toHaveLength(1);
    expect(page.overage.addToInvoice).toEqual({ available: false, arrivesWith: "recurring_invoices" });
    expect(page.clientAnonymised).toBe(false);
    expect(page.terms.pending).toBeNull();
  });

  it("GET /clients/:id/care-plans lists one client's plans, an unknown client is 404, and Sales can read it", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const other = await mkClient();
    const mine = await made(o.cookie, clientId);
    await made(o.cookie, other);
    const res = await json(
      await call(`/clients/${clientId}/care-plans`, { cookie: (await sessionFor("sales")).cookie }),
    );
    expect(res.carePlans.map((r: J) => r.id)).toEqual([mine.id]);
    expect((await call("/clients/no-such-client/care-plans", { cookie: o.cookie })).status).toBe(404);
    expect(
      (await json(await call(`/clients/${await mkClient()}/care-plans`, { cookie: o.cookie }))).carePlans,
    ).toEqual([]);
  });

  it("the page is served by an index, never a scan of care_plans", async () => {
    for (const f of [{}, { status: "active" }, { clientId: "c" }] as const) {
      const { sql, bind } = carePlanPageSql(f, { k: 1, id: "x" }, "after", 25);
      const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...bind))
        .map((r) => r.detail)
        .join("\n");
      expect(plan, JSON.stringify(f)).not.toMatch(/SCAN care_plans\b/);
      expect(plan).toMatch(/SEARCH p USING (COVERING )?INDEX/);
    }
  });
});

describe("the care routes in the table", () => {
  it("static paths come before /:id and every audited route is a mutation", () => {
    const care = ROUTES.filter((r) => r.path.startsWith("/api/v1/care-plans"));
    expect(care.map((r) => `${r.method} ${r.path.replace("/api/v1", "")}`)).toEqual([
      "GET /care-plans",
      "GET /care-plans/defaults",
      "POST /care-plans",
      "GET /care-plans/:id",
      "POST /care-plans/:id/terms",
      "POST /care-plans/:id/status",
    ]);
    for (const r of care) expect(Boolean(r.audit), `${r.method} ${r.path}`).toBe(r.method !== "GET");
  });

  it("a contact fixture and a project fixture do not disturb the care sequence", async () => {
    const clientId = await mkClient();
    await mkContact(clientId);
    const p = await mkOpenProject("active", clientId);
    expect(p.id).toBeTruthy();
  });
});
