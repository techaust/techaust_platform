// The pipeline-value tile and the proposal events in the activity feed [ADM-DASH-01; M4.3 item 10]: the offers out and still acceptable, by currency,
// before tax; sent or viewed only; the day of validity counts; a revised version is not counted twice; and the new audit names reach the right roles.
import { FINANCE_AUDIT_ACTIONS } from "@techaust/core/audit";
import { ACTIVITY_ACTIONS } from "@techaust/core/dashboard";
import { addDays, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { beforeAll, describe, expect, it } from "vitest";
import { PIPELINE_SQL } from "./dashboard.ts";
import { today } from "./test-care.ts";
import { putPaymentTerms } from "./test-catalogue.ts";
import { insert, mkClient } from "./test-clients.ts";
import { call, rows, sessionFor } from "./test-helpers.ts";
import { getDoc, type J, json, mkDraft, mkTerms, patchDoc, sendDoc } from "./test-quotes.ts";

const plus = (days: number) => toIsoDate(addDays(parseIsoDate(today()) as never, days));
const dash = async (cookie: string) => {
  const res = await call("/dashboard", { cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return json(res);
};
const pipeline = async () => (await dash((await sessionFor("owner")).cookie)).tiles.pipelineValue;

let seq = 0;
async function mkOffer(o: {
  status: string;
  validUntil: string | null;
  taxable: number;
  currency?: string;
  type?: string;
}) {
  const id = uuidv7();
  seq++;
  const client = await mkClient(
    o.currency === "USD" ? { currency: "USD", gst_status: "overseas", country: "US", state_code: null } : {},
  );
  const frozen = o.status !== "draft";
  await insert("documents", {
    id,
    type: o.type ?? "proposal",
    status: o.status,
    client_id: client,
    currency: o.currency ?? "INR",
    version_group_id: id,
    version: 1,
    taxable_minor: o.taxable,
    valid_until: o.validUntil,
    ...(frozen
      ? { series: "fixture", fy: "0000", number: seq, number_display: `FIX/${seq}`, frozen_at: 1 }
      : {}),
  });
  return id;
}

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

describe("the pipeline value", () => {
  it("with nothing sent it is an empty list, not a stub", async () => {
    expect(await pipeline()).toEqual({ asOf: today(), byCurrency: [] });
  });

  it("counts sent and viewed offers valid today or later, by currency, before tax; nothing else", async () => {
    await mkOffer({ status: "sent", validUntil: today(), taxable: 1_000_000 }); // the last day counts
    await mkOffer({ status: "viewed", validUntil: plus(10), taxable: 500_000, type: "estimate" });
    await mkOffer({ status: "sent", validUntil: plus(30), taxable: 70_000, currency: "USD" });
    // not counted
    await mkOffer({ status: "sent", validUntil: plus(-1), taxable: 9_000_000 }); // lapsed; the nightly job has not run yet
    await mkOffer({ status: "sent", validUntil: null, taxable: 9_000_000 });
    for (const status of ["draft", "accepted", "rejected", "expired", "revised"])
      await mkOffer({ status, validUntil: plus(10), taxable: 9_000_000 });
    await mkOffer({ status: "sent", validUntil: plus(10), taxable: 9_000_000, type: "proforma" });
    const p = await pipeline();
    expect(p.asOf).toBe(today());
    // 1,000,000 + 500,000 = 1,500,000 rupees-paise; one USD offer of 70,000 cents; sorted by currency
    expect(p.byCurrency).toEqual([
      { currency: "INR", count: 2, taxableMinor: 1_500_000 },
      { currency: "USD", count: 1, taxableMinor: 70_000 },
    ]);
  });

  it("a revised offer is counted once: sending version 2 moves version 1 to revised, so only the newer one is out", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const before = (await pipeline()).byCurrency.find((r: J) => r.currency === "INR");
    const made = await mkDraft(o, { price: 250_000 });
    const v1 = await getDoc(o, made.id);
    expect((await sendDoc(o, made.id, v1.updatedAt)).status).toBe(200);
    const one = (await pipeline()).byCurrency.find((r: J) => r.currency === "INR");
    expect(one.count).toBe(before.count + 1);
    expect(one.taxableMinor).toBe(before.taxableMinor + 250_000);

    const revised = await json(await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} }));
    const v2 = await getDoc(o, revised.id);
    const saved = await patchDoc(o, revised.id, {
      expectedUpdatedAt: v2.updatedAt,
      lines: [
        {
          id: v2.lines[0].id,
          description: v2.lines[0].description,
          qtyMilli: 1000,
          unit: "fixed",
          rateMinor: 400_000,
        },
      ],
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    // a draft v2 changes nothing; v1 is still the offer out
    expect((await pipeline()).byCurrency.find((r: J) => r.currency === "INR")).toEqual(one);
    const now = await getDoc(o, revised.id);
    expect((await sendDoc(o, revised.id, now.updatedAt)).status).toBe(200);
    const two = (await pipeline()).byCurrency.find((r: J) => r.currency === "INR");
    expect(two.count).toBe(one.count); // v1 is revised, v2 is out: still one offer
    expect(two.taxableMinor).toBe(before.taxableMinor + 400_000);
    expect((await rows<J>("SELECT status FROM documents WHERE id = ?", made.id))[0]?.status).toBe("revised");
  });

  it("Owner and Sales see it; Staff and Accountant do not have the tile", async () => {
    for (const role of ["owner", "sales"] as const) {
      const body = await dash((await sessionFor(role)).cookie);
      expect(body.tiles.pipelineValue.byCurrency, role).toBeInstanceOf(Array);
    }
    for (const role of ["staff", "accountant"] as const) {
      const body = await dash((await sessionFor(role)).cookie);
      expect(Object.keys(body.tiles), role).not.toContain("pipelineValue");
    }
  });

  it("is served by documents_status_valid_until (EXPLAIN), with no scan of documents", async () => {
    const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${PIPELINE_SQL}`, today()))
      .map((r) => r.detail)
      .join("\n");
    expect(plan).toMatch(/SEARCH documents USING INDEX documents_status_valid_until/);
    expect(plan).not.toMatch(/SCAN documents/);
  });
});

describe("the proposal events in the activity feed", () => {
  const NEW = [
    "document.create",
    "document.update",
    "document.delete",
    "document.revise",
    "document.send",
    "document.expire",
    "approval.request",
    "approval.decide",
    "approval.expire",
  ];

  it("owner, staff and sales have the document and approval events; document.convert is a finance event for the owner and accountant only", () => {
    for (const role of ["owner", "staff", "sales"] as const)
      for (const a of NEW) expect(ACTIVITY_ACTIONS[role], `${role} ${a}`).toContain(a);
    expect(FINANCE_AUDIT_ACTIONS).toContain("document.convert");
    expect(ACTIVITY_ACTIONS.owner).toContain("document.convert");
    expect(ACTIVITY_ACTIONS.accountant).toContain("document.convert");
    expect(ACTIVITY_ACTIONS.staff).not.toContain("document.convert");
    expect(ACTIVITY_ACTIONS.sales).not.toContain("document.convert");
    for (const a of NEW) expect(ACTIVITY_ACTIONS.accountant, a).not.toContain(a);
  });

  it("the feed shows a send to the roles that have it, with its reference, and a conversion only to the owner and the accountant", async () => {
    const owner = await sessionFor("owner", { stepUp: true });
    const made = await mkDraft(owner, { price: 123_000 });
    const v = await getDoc(owner, made.id);
    expect((await sendDoc(owner, made.id, v.updatedAt)).status).toBe(200);
    await insert("audit_log", {
      id: `conv-${uuidv7()}`,
      actor_type: "staff",
      actor_id: owner.id,
      role: "owner",
      action: "document.convert",
      entity_type: "document",
      entity_id: made.id,
      summary: JSON.stringify({}),
      at: Date.now(),
    });
    const actions = async (role: "owner" | "staff" | "sales" | "accountant") =>
      (await dash((await sessionFor(role)).cookie)).tiles.activity.items.map((i: J) => i.action);
    for (const role of ["owner", "staff", "sales"] as const)
      expect(await actions(role), role).toContain("document.send");
    expect(await actions("owner")).toContain("document.convert");
    expect(await actions("accountant")).toContain("document.convert");
    expect(await actions("accountant")).not.toContain("document.send");
    expect(await actions("staff")).not.toContain("document.convert");
    expect(await actions("sales")).not.toContain("document.convert");
  });
});
