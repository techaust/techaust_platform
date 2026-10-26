// Estimate -> care plan [ADM-EST-02, ADM-CARE-01; M4.3 item 8; analyst M5 and L3]: the tier comes from the catalogue default line the server set on
// the line (never from its description), the price is that line's taxable amount, the plan is made with M3.5's own statements plus the source,
// and an estimate becomes an invoice draft OR a care plan, never both. VERIFY WITH CA/LEGAL: nothing here is a tax rule.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { mkItem, putPaymentTerms } from "./test-catalogue.ts";
import { call, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import {
  beforeBatchHolding,
  codeOf,
  getDoc,
  type J,
  json,
  mkQuoteClient,
  mkTerms,
  patchDoc,
  sendDoc,
} from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

const MONTHLY = JSON.stringify([{ label: "Monthly in advance", pctBp: 10_000, trigger: "monthly" }]);
const tierLine = (description: string, inr: number) => ({
  description,
  unit: "month",
  qtyMilli: 1000,
  rateInrMinor: inr,
  rateUsdMinor: null,
});

let s16: { id: string };
let s17: { id: string };
let s18: { id: string };
let other: { id: string };

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
  s16 = await mkItem({
    code: "S16",
    name: "Care Plans",
    category: "run",
    unit: "month",
    price_inr_minor: 999_900,
    price_usd_minor: null,
    schedule: MONTHLY,
    default_lines: JSON.stringify([
      tierLine("Essential", 999_900),
      tierLine("Growth", 2_499_900),
      tierLine("Scale", 5_999_900),
    ]),
  });
  s17 = await mkItem({
    code: "S17",
    name: "AI Ops",
    category: "run",
    unit: "month",
    price_inr_minor: 2_000_000,
    price_usd_minor: null,
    schedule: MONTHLY,
  });
  s18 = await mkItem({
    code: "S18",
    name: "Dev Subscription",
    category: "run",
    unit: "month",
    price_inr_minor: 17_500_000,
    price_usd_minor: null,
    schedule: MONTHLY,
  });
  other = await mkItem({ code: "X1", name: "A website", price_inr_minor: 500_000, price_usd_minor: null });
});

type Svc = { catalogueItemId: string; defaultLines?: string[] };
const care = (tier: string): Svc => ({ catalogueItemId: s16.id, defaultLines: [tier] });
const svc = (item: { id: string }): Svc => ({ catalogueItemId: item.id });

/** A sent and accepted estimate of these services for a fresh INR client (acceptance is M4.5's; here it is set with SQL, the way the schema allows). */
async function estimate(
  services: Svc[],
  edit?: (o: Awaited<ReturnType<typeof owner>>, id: string) => Promise<void>,
) {
  const o = await owner();
  const client = await mkQuoteClient();
  const made = await call("/documents", {
    cookie: o.cookie,
    body: { type: "estimate", clientId: client.clientId, contactId: client.contactId, services },
  });
  expect(made.status, await made.clone().text()).toBe(201);
  const id = ((await json(made)) as J).id as string;
  if (edit) await edit(o, id);
  const v = await getDoc(o, id);
  const sent = await sendDoc(o, id, v.updatedAt);
  expect(sent.status, await sent.clone().text()).toBe(200);
  await env.DB.prepare("UPDATE documents SET status = 'accepted' WHERE id = ?").bind(id).run();
  return { o, id, clientId: client.clientId };
}
const toPlan = (cookie: string, id: string, over: Record<string, unknown> = {}) =>
  call(`/documents/${id}/convert`, {
    cookie,
    body: { to: "care_plan", startDate: "2026-11-01", billingDay: 5, includedMinutes: 600, ...over },
  });
const toInvoice = (cookie: string, id: string) =>
  call(`/documents/${id}/convert`, { cookie, body: { to: "invoice" } });
const plans = () => countOf("care_plans");

describe("estimate -> care plan: the mapping", () => {
  it("S16 Growth + S17: the tier from the default line, the price and AI Ops from the taxable amounts; M3.5's three rows and the source", async () => {
    const { o, id, clientId } = await estimate([care("Growth"), svc(s17)]);
    const res = await toPlan(o.cookie, id, { overageRateMinor: 150_000, rollover: "one_month" });
    expect(res.status, await res.clone().text()).toBe(201);
    const out = await json(res);
    expect(out).toMatchObject({
      to: "care_plan",
      sourceDocumentId: id,
      tier: "growth",
      priceMinor: 2_499_900, // the S16 Growth line: 1 month x 2,499,900, no discount
      aiOpsMinor: 2_000_000,
      includedMinutes: 600,
      rollover: "one_month",
      currency: "INR",
    });
    expect(await one<J>("SELECT * FROM care_plans WHERE id = ?", out.id)).toMatchObject({
      client_id: clientId,
      tier: "growth",
      currency: "INR",
      price_minor: 2_499_900,
      ai_ops_minor: 2_000_000,
      included_minutes: 600,
      overage_rate_minor: 150_000,
      rollover: "one_month",
      start_date: "2026-11-01",
      billing_day: 5,
      status: "active",
      source_document_id: id,
    });
    expect(await one<J>("SELECT * FROM care_plan_terms WHERE care_plan_id = ?", out.id)).toMatchObject({
      effective_from: "2026-11-01",
      tier: "growth",
      price_minor: 2_499_900,
      ai_ops_minor: 2_000_000,
    });
    expect(await one<J>("SELECT * FROM care_plan_status_log WHERE care_plan_id = ?", out.id)).toMatchObject({
      status: "active",
      effective_on: "2026-11-01",
    });
    expect(await one("SELECT status FROM documents WHERE id = ?", id)).toEqual({ status: "accepted" }); // the estimate is untouched
    const audit = await one<J>(
      "SELECT entity_type, entity_id, summary FROM audit_log WHERE action = 'document.convert' AND entity_id = ?",
      out.id,
    );
    expect(audit).toMatchObject({ entity_type: "care_plan", entity_id: out.id });
    expect(JSON.parse(audit?.summary as string)).toMatchObject({
      sourceDocumentId: id,
      to: "care_plan",
      tier: "growth",
      priceMinor: 2_499_900,
    });
  });

  it("the price is the line's TAXABLE amount: a line discount lowers it", async () => {
    // 2,499,900 less 10 % = 2,249,910
    const { o, id } = await estimate([care("Growth")], async (o, id) => {
      const doc = await getDoc(o, id);
      const line = doc.lines[0];
      const saved = await patchDoc(o, id, {
        expectedUpdatedAt: doc.updatedAt,
        lines: [
          {
            id: line.id,
            description: line.description,
            qtyMilli: 1000,
            unit: "month",
            rateMinor: line.rateMinor,
            discount: { kind: "percent", value: 1000 },
          },
        ],
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
    });
    const out = await json(await toPlan(o.cookie, id));
    expect(out).toMatchObject({ tier: "growth", priceMinor: 2_249_910, aiOpsMinor: null });
  });

  it("the tier is the default line's key, not the description anyone can edit", async () => {
    const { o, id } = await estimate([care("Growth")], async (o, id) => {
      const doc = await getDoc(o, id);
      const line = doc.lines[0];
      const saved = await patchDoc(o, id, {
        expectedUpdatedAt: doc.updatedAt,
        lines: [
          { id: line.id, description: "Essential", qtyMilli: 1000, unit: "month", rateMinor: line.rateMinor },
        ],
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
    });
    const out = await json(await toPlan(o.cookie, id));
    expect(out.tier).toBe("growth");
  });

  it("S18 is a dev subscription", async () => {
    const { o, id } = await estimate([svc(s18)]);
    const out = await json(await toPlan(o.cookie, id, { includedMinutes: 0 }));
    expect(out).toMatchObject({
      tier: "dev_subscription",
      priceMinor: 17_500_000,
      aiOpsMinor: null,
      includedMinutes: 0,
    });
  });

  it("included hours left out: Essential has the documented default (120 minutes, no rollover); the other tiers are the person's to choose", async () => {
    const a = await estimate([care("Essential")]);
    const res = await call(`/documents/${a.id}/convert`, {
      cookie: a.o.cookie,
      body: { to: "care_plan", startDate: "2026-11-01", billingDay: 1 },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await json(res)).toMatchObject({ tier: "essential", includedMinutes: 120, rollover: "none" });

    const b = await estimate([care("Scale")]);
    const before = await plans();
    const refused = await call(`/documents/${b.id}/convert`, {
      cookie: b.o.cookie,
      body: { to: "care_plan", startDate: "2026-11-01", billingDay: 1 },
    });
    expect(refused.status).toBe(400);
    expect(await codeOf(refused)).toBe("included_minutes_required");
    expect(await plans()).toBe(before);
  });
});

describe("estimate -> care plan: defaults by tier and the result on the estimate (review 6, 9)", () => {
  it("rollover left out follows the tier (Essential none; Growth and Scale one month, docs/07 4.14); a given rollover wins", async () => {
    const answers: Record<string, string> = {};
    for (const tier of ["Essential", "Growth", "Scale"]) {
      const e = await estimate([care(tier)]);
      const res = await call(`/documents/${e.id}/convert`, {
        cookie: e.o.cookie,
        body: { to: "care_plan", startDate: "2026-11-01", billingDay: 1, includedMinutes: 600 },
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const body = await json(res);
      answers[tier] = body.rollover;
      // the stored plan and its first terms row agree with the answer
      expect(
        (await one<{ rollover: string }>("SELECT rollover FROM care_plans WHERE id = ?", body.id))?.rollover,
      ).toBe(body.rollover);
      expect(
        (
          await one<{ rollover: string }>(
            "SELECT rollover FROM care_plan_terms WHERE care_plan_id = ?",
            body.id,
          )
        )?.rollover,
      ).toBe(body.rollover);
    }
    expect(answers).toEqual({ Essential: "none", Growth: "one_month", Scale: "one_month" });
    const g = await estimate([care("Growth")]);
    const given = await toPlan(g.o.cookie, g.id, { rollover: "none" });
    expect((await json(given)).rollover).toBe("none");
  });

  it("GET of the estimate names the care plan it became", async () => {
    const e = await estimate([care("Growth")]);
    expect((await getDoc(e.o, e.id)).convertedTo).toBeNull();
    const res = await toPlan(e.o.cookie, e.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const plan = await json(res);
    expect((await getDoc(e.o, e.id)).convertedTo).toEqual({ kind: "care_plan", id: plan.id });
  });
});

describe("estimate -> care plan: what is not a care estimate", () => {
  const refuse = async (id: string, o: { cookie: string }, status: number, code: string) => {
    const before = await plans();
    const res = await toPlan(o.cookie, id);
    expect(res.status, await res.clone().text()).toBe(status);
    expect(await codeOf(res)).toBe(code);
    expect(await plans()).toBe(before);
    expect(await one("SELECT 1 AS x FROM care_plans WHERE source_document_id = ?", id)).toBeNull();
  };

  it("another service, a second care line, an S17 line alone, or two months are 409 not_a_care_estimate; nothing is written", async () => {
    for (const services of [
      [care("Growth"), svc(other)], // a website beside the plan
      [care("Growth"), svc(s18)], // two care lines
      [svc(s17)], // AI Ops alone
      [svc(other)],
    ]) {
      const e = await estimate(services);
      await refuse(e.id, e.o, 409, "not_a_care_estimate");
    }
    // two months of one plan
    const two = await estimate([care("Growth")], async (o, id) => {
      const doc = await getDoc(o, id);
      const line = doc.lines[0];
      const saved = await patchDoc(o, id, {
        expectedUpdatedAt: doc.updatedAt,
        lines: [
          {
            id: line.id,
            description: line.description,
            qtyMilli: 2000,
            unit: "month",
            rateMinor: line.rateMinor,
          },
        ],
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
    });
    await refuse(two.id, two.o, 409, "not_a_care_estimate");
  });

  it("a custom line beside the plan is not a care estimate", async () => {
    const e = await estimate([care("Growth")], async (o, id) => {
      const doc = await getDoc(o, id);
      const line = doc.lines[0];
      const saved = await patchDoc(o, id, {
        expectedUpdatedAt: doc.updatedAt,
        lines: [
          {
            id: line.id,
            description: line.description,
            qtyMilli: 1000,
            unit: "month",
            rateMinor: line.rateMinor,
          },
          { description: "Setup", qtyMilli: 1000, unit: "fixed", rateMinor: 100_000 },
        ],
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
    });
    await refuse(e.id, e.o, 409, "not_a_care_estimate");
  });

  it("not accepted (only sent), a proposal, a draft: 409; an unknown id 404", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const mk = async (type: string) => {
      const made = await call("/documents", {
        cookie: o.cookie,
        body: { type, clientId: client.clientId, contactId: client.contactId, services: [care("Growth")] },
      });
      return ((await json(made)) as J).id as string;
    };
    const sentId = await mk("estimate");
    expect((await sendDoc(o, sentId, (await getDoc(o, sentId)).updatedAt)).status).toBe(200);
    await refuse(sentId, o, 409, "not_accepted");
    const draftId = await mk("estimate");
    await refuse(draftId, o, 409, "not_accepted");
    const proposalId = await mk("proposal");
    await refuse(proposalId, o, 409, "not_an_estimate");
    const res = await toPlan(o.cookie, "00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("the client's currency must be the estimate's: 409 currency_mismatch", async () => {
    const e = await estimate([care("Growth")]);
    await env.DB.prepare("UPDATE clients SET currency = 'USD' WHERE id = ?").bind(e.clientId).run();
    await refuse(e.id, e.o, 409, "currency_mismatch");
  });

  it("an anonymised client takes nothing new: 409 client_anonymised", async () => {
    const e = await estimate([care("Growth")]);
    await env.DB.prepare("UPDATE clients SET anonymised_at = 1 WHERE id = ?").bind(e.clientId).run();
    await refuse(e.id, e.o, 409, "client_anonymised");
  });

  it("a bad body is a 400 and writes nothing: dates, billing day, hours in steps of 15, unknown keys, the other conversion's keys", async () => {
    const e = await estimate([care("Growth")]);
    const before = await plans();
    for (const over of [
      { startDate: "next week" },
      { startDate: "1999-01-01" },
      { billingDay: 0 },
      { billingDay: 29 },
      { includedMinutes: 100 },
      { includedMinutes: -15 },
      { rollover: "forever" },
      { overageRateMinor: -1 },
      { tier: "scale" }, // the tier is the estimate's, never the request's
      { priceMinor: 1 },
      { aiOpsMinor: 1 },
      { sourceDocumentId: "x" },
    ]) {
      expect((await toPlan(e.o.cookie, e.id, over)).status, JSON.stringify(over)).toBe(400);
    }
    expect(
      (await call(`/documents/${e.id}/convert`, { cookie: e.o.cookie, body: { to: "nothing" } })).status,
    ).toBe(400);
    expect(
      (
        await call(`/documents/${e.id}/convert`, {
          cookie: e.o.cookie,
          body: { to: "invoice", startDate: "2026-11-01" },
        })
      ).status,
    ).toBe(400);
    expect(await plans()).toBe(before);
  });

  it("a role without the care permission is 403 (sales, accountant); signed out is 401", async () => {
    const e = await estimate([care("Growth")]);
    for (const role of ["sales", "accountant"] as const) {
      const s = await sessionFor(role);
      expect((await toPlan(s.cookie, e.id)).status, role).toBe(403);
    }
    expect(
      (
        await call(`/documents/${e.id}/convert`, {
          body: { to: "care_plan", startDate: "2026-11-01", billingDay: 1 },
        })
      ).status,
    ).toBe(401);
    expect(await one("SELECT 1 AS x FROM care_plans WHERE source_document_id = ?", e.id)).toBeNull();
  });
});

describe("one estimate, one conversion: the two targets exclude each other, both ways [analyst L3]", () => {
  it("a care plan first: a repeat is 409 already_converted, and the invoice convert is 409 converted_to_care_plan", async () => {
    const e = await estimate([care("Growth")]);
    expect((await toPlan(e.o.cookie, e.id)).status).toBe(201);
    const again = await toPlan(e.o.cookie, e.id);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("already_converted");
    const invoice = await toInvoice(e.o.cookie, e.id);
    expect(invoice.status).toBe(409);
    expect(await codeOf(invoice)).toBe("converted_to_care_plan");
    expect(await countOf("care_plans", "source_document_id = ?", e.id)).toBe(1);
    expect(await countOf("documents", "source_document_id = ?", e.id)).toBe(0);
  });

  it("an invoice draft first: the care-plan convert is 409 converted_to_invoice", async () => {
    const e = await estimate([care("Growth")]);
    expect((await toInvoice(e.o.cookie, e.id)).status).toBe(201);
    const plan = await toPlan(e.o.cookie, e.id);
    expect(plan.status).toBe(409);
    expect(await codeOf(plan)).toBe("converted_to_invoice");
    expect(await countOf("care_plans", "source_document_id = ?", e.id)).toBe(0);
    expect(await countOf("documents", "source_document_id = ? AND source_step = 1", e.id)).toBe(1);
  });

  it("the guard is in the write: an invoice draft that lands between the read and the plan batch makes it 409, and nothing is written", async () => {
    const e = await estimate([care("Growth")]);
    const before = await plans();
    const env2 = beforeBatchHolding("INSERT INTO care_plans", async () => {
      expect((await toInvoice(e.o.cookie, e.id)).status).toBe(201);
    });
    const res = await call(
      `/documents/${e.id}/convert`,
      {
        cookie: e.o.cookie,
        body: { to: "care_plan", startDate: "2026-11-01", billingDay: 5, includedMinutes: 600 },
      },
      env2,
    );
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await codeOf(res)).toBe("converted_to_invoice");
    expect(await plans()).toBe(before);
    expect(
      await countOf(
        "care_plan_terms",
        "care_plan_id IN (SELECT id FROM care_plans WHERE source_document_id = ?)",
        e.id,
      ),
    ).toBe(0);
    expect(
      await one(
        "SELECT 1 AS x FROM audit_log WHERE action = 'document.convert' AND summary LIKE ?",
        `%${e.id}%care_plan%`,
      ),
    ).toBeNull();
  });

  it("and the other way: a plan that lands between the read and the invoice batch makes the invoice 409, and no draft is written", async () => {
    const e = await estimate([care("Growth")]);
    const env2 = beforeBatchHolding("INSERT INTO documents", async () => {
      expect((await toPlan(e.o.cookie, e.id)).status).toBe(201);
    });
    const res = await call(
      `/documents/${e.id}/convert`,
      { cookie: e.o.cookie, body: { to: "invoice" } },
      env2,
    );
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await codeOf(res)).toBe("converted_to_care_plan");
    expect(await countOf("documents", "source_document_id = ?", e.id)).toBe(0);
  });

  it("the unique source also holds below the API: two plans for one estimate abort in SQL", async () => {
    const e = await estimate([care("Growth")]);
    expect((await toPlan(e.o.cookie, e.id)).status).toBe(201);
    const plan = await one<J>("SELECT * FROM care_plans WHERE source_document_id = ?", e.id);
    await expect(
      env.DB.prepare(
        "INSERT INTO care_plans (id, client_id, tier, currency, price_minor, included_minutes, start_date, billing_day, status, rollover, created_at, updated_at, source_document_id) VALUES ('dup', ?, 'growth', 'INR', 1, 0, '2026-11-01', 1, 'active', 'none', 1, 1, ?)",
      )
        .bind(plan?.client_id, e.id)
        .run(),
    ).rejects.toThrow(/UNIQUE/);
  });
});

describe("the guards of the two conversions are served by indexes (EXPLAIN)", () => {
  const plan = async (sql: string) =>
    (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, "x")).map((r) => r.detail).join(" | ");

  it("the invoice-draft and care-plan lookups search their unique source indexes", async () => {
    expect(
      await plan("SELECT 1 FROM documents i WHERE i.source_document_id = ?1 AND i.source_step = 1"),
    ).toMatch(/SEARCH .*USING (COVERING )?INDEX documents_source/);
    expect(await plan("SELECT 1 FROM care_plans cp WHERE cp.source_document_id = ?1")).toMatch(
      /SEARCH .*USING (COVERING )?INDEX care_plans_source_document/,
    );
    expect(
      await plan(
        "SELECT l.qty_milli, l.unit, l.taxable_minor, l.catalogue_line, i.code FROM document_lines l LEFT JOIN catalogue_items i ON i.id = l.catalogue_item_id WHERE l.document_id = ?1 ORDER BY l.position",
      ),
    ).toMatch(/SEARCH .*document_lines/);
  });
});

describe("a sent care estimate has a schedule (schedule_missing does not stop it)", () => {
  it("the catalogue's monthly step is the estimate's schedule, and the estimate sends", async () => {
    const e = await estimate([care("Essential"), svc(s17)]);
    expect(
      (await rows<J>("SELECT label, trigger, pct_bp FROM payment_schedules WHERE document_id = ?", e.id)).map(
        (r) => [r.trigger, r.pct_bp],
      ),
    ).toEqual([["monthly", 10_000]]);
  });
});
