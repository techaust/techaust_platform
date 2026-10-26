// Start project from an accepted proposal (M4.5; ADM-PRJ-01, ADM-PROP-09): the route, in the stage A test app (real session guard, route not yet in the
// app). The figures are worked by hand: one service at 2,500.00 + 18 % intra-state = 2,950.00 (295,000 paise); a 40/60 schedule is 1,180.00 + 1,770.00.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { putPaymentTerms } from "./test-catalogue.ts";
import { insert } from "./test-clients.ts";
import { call, one, rows, sessionFor, withDb } from "./test-helpers.ts";
import {
  beforeBatchHolding,
  codeOf,
  getDoc,
  type J,
  json,
  mkDraft,
  mkTerms,
  patchDoc,
  sendDoc,
} from "./test-quotes.ts";

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

const owner = () => sessionFor("owner", { stepUp: true });
const start = (cookie: string, id: string, body: unknown = {}) =>
  call(`/documents/${id}/start-project`, { cookie, body });

type Steps = { label: string; trigger: string; pctBp: number; targetDate?: string }[];
const FORTY_SIXTY: Steps = [
  { label: "On acceptance", trigger: "on_accept", pctBp: 4000, targetDate: "2026-12-01" },
  { label: "On delivery", trigger: "delivery", pctBp: 6000 },
];

/** A sent proposal (or estimate) with this schedule; `accept` sets the status the way acceptance does (sent -> accepted). */
async function offer(
  o: {
    type?: "proposal" | "estimate";
    schedule?: Steps;
    accept?: boolean;
    clientOver?: Record<string, unknown>;
  } = {},
) {
  const s = await owner();
  const made = await mkDraft(s, { type: o.type ?? "proposal", price: 250_000 });
  if (o.schedule) {
    const v = await getDoc(s, made.id);
    const res = await patchDoc(s, made.id, { expectedUpdatedAt: v.updatedAt, schedule: o.schedule });
    if (res.status !== 200) throw new Error(`schedule: ${res.status} ${await res.text()}`);
  }
  const v = await getDoc(s, made.id);
  const sent = await sendDoc(s, made.id, v.updatedAt);
  if (sent.status !== 200) throw new Error(`send: ${sent.status} ${await sent.text()}`);
  if (o.accept !== false) await accept(made.id, made.contactId);
  return { s, made };
}
const accept = (id: string, contactId: string) =>
  env.DB.prepare(
    "UPDATE documents SET status = 'accepted', decided_at = ?2, decided_contact_id = ?3 WHERE id = ?1",
  )
    .bind(id, Date.now(), contactId || null)
    .run();

describe("POST /documents/:id/start-project: what is made [ADM-PRJ-01]", () => {
  it("makes the project, one milestone per step (exact amounts), the first-instalment draft, and links milestone 1 to it", async () => {
    const { s, made } = await offer({ schedule: FORTY_SIXTY });
    const res = await start(s.cookie, made.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const out = await json(res);
    expect(out).toMatchObject({
      created: true,
      milestones: 2,
      firstInstalment: { type: "proforma", amountMinor: 118_000 },
    });
    expect(out.code).toMatch(/^PRJ-\d{4}$/);

    const project = await one<J>("SELECT * FROM projects WHERE id = ?", out.projectId);
    expect(project).toMatchObject({
      client_id: made.clientId,
      source_document_id: made.id,
      status: "planned",
      currency: "INR",
      budget_minor: 295_000, // the proposal's total, tax included
    });
    const ms = await rows<J>(
      "SELECT position, title, amount_minor, pct_bp, due_date, status, document_id FROM milestones WHERE project_id = ? ORDER BY position",
      out.projectId,
    );
    expect(ms).toEqual([
      // 40 % of 295,000 = 118,000; 60 % = 177,000
      {
        position: 1,
        title: "On acceptance",
        amount_minor: 118_000,
        pct_bp: null,
        due_date: "2026-12-01",
        status: "pending",
        document_id: out.draftId,
      },
      {
        position: 2,
        title: "On delivery",
        amount_minor: 177_000,
        pct_bp: null,
        due_date: null,
        status: "pending",
        document_id: null,
      },
    ]);
    expect(ms.reduce((a, m) => a + (m.amount_minor as number), 0)).toBe(295_000);

    // the draft: step 1 tax included. 1,180.00 = 1,000.00 + 90.00 CGST + 90.00 SGST
    const draft = await one<J>("SELECT * FROM documents WHERE id = ?", out.draftId);
    expect(draft).toMatchObject({
      type: "proforma",
      status: "draft",
      client_id: made.clientId,
      project_id: out.projectId,
      source_document_id: made.id,
      source_step: 1,
      contact_id: made.contactId,
      frozen_at: null,
      number: null,
      taxable_minor: 100_000,
      cgst_minor: 9_000,
      sgst_minor: 9_000,
      igst_minor: 0,
      round_off_minor: 0,
      total_minor: 118_000,
    });
    const lines = await rows<J>(
      "SELECT sac, qty_milli, rate_minor, taxable_minor, line_total_minor, catalogue_rate_minor, catalogue_item_id FROM document_lines WHERE document_id = ?",
      out.draftId,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      qty_milli: 1000,
      rate_minor: 100_000,
      taxable_minor: 100_000,
      line_total_minor: 118_000,
      catalogue_rate_minor: null,
      catalogue_item_id: null,
    });

    const audit = await one<{ summary: string; actor_id: string }>(
      "SELECT summary, actor_id FROM audit_log WHERE action = 'project.create' AND entity_id = ?",
      out.projectId,
    );
    expect(audit?.actor_id).toBe(s.id);
    expect(JSON.parse(audit?.summary ?? "{}")).toEqual({
      projectId: out.projectId,
      sourceDocumentId: made.id,
      milestones: 2,
      draftId: out.draftId,
      type: "proforma",
      amountMinor: 118_000,
    });
  });

  it("is idempotent: a repeat is a 200 with the same ids and nothing new; a double click makes exactly one of each", async () => {
    const { s, made } = await offer({ schedule: FORTY_SIXTY });
    const [a, b] = await Promise.all([start(s.cookie, made.id), start(s.cookie, made.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const [ja, jb] = [await json(a), await json(b)];
    expect(ja.projectId).toBe(jb.projectId);
    expect(ja.draftId).toBe(jb.draftId);
    expect([ja.created, jb.created].sort()).toEqual([false, true]);
    const again = await start(s.cookie, made.id);
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ projectId: ja.projectId, draftId: ja.draftId, created: false });
    expect(
      (await one<{ n: number }>("SELECT count(*) AS n FROM projects WHERE source_document_id = ?", made.id))
        ?.n,
    ).toBe(1);
    expect(
      (await one<{ n: number }>("SELECT count(*) AS n FROM milestones WHERE project_id = ?", ja.projectId))
        ?.n,
    ).toBe(2);
    expect(
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM documents WHERE source_document_id = ? AND source_step = 1",
          made.id,
        )
      )?.n,
    ).toBe(1);
    expect(
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM audit_log WHERE action = 'project.create' AND entity_id = ?",
          ja.projectId,
        )
      )?.n,
    ).toBe(1);
  });

  it("step 1 not paid on acceptance: the project and milestones only, no draft", async () => {
    const { s, made } = await offer({
      schedule: [
        { label: "At the midpoint", trigger: "milestone", pctBp: 5000 },
        { label: "On delivery", trigger: "delivery", pctBp: 5000 },
      ],
    });
    const res = await start(s.cookie, made.id);
    expect(res.status).toBe(201);
    const out = await json(res);
    expect(out).toMatchObject({ draftId: null, firstInstalment: null, milestones: 2 });
    expect(
      (await one<{ n: number }>("SELECT count(*) AS n FROM documents WHERE source_document_id = ?", made.id))
        ?.n,
    ).toBe(0);
    const ms = await rows<J>(
      "SELECT amount_minor, document_id FROM milestones WHERE project_id = ? ORDER BY position",
      out.projectId,
    );
    expect(ms).toEqual([
      { amount_minor: 147_500, document_id: null },
      { amount_minor: 147_500, document_id: null },
    ]);
  });

  it("a project code that is taken between the read and the write is retried with the next number", async () => {
    const { s, made } = await offer({ schedule: FORTY_SIXTY });
    const next =
      (
        await one<{ n: number }>(
          "SELECT coalesce(max(cast(substr(code, 5) AS integer)), 0) + 1 AS n FROM projects",
        )
      )?.n ?? 1;
    const rival = beforeBatchHolding("INSERT INTO projects", async () => {
      await insert("projects", {
        id: crypto.randomUUID(),
        code: `PRJ-${String(next).padStart(4, "0")}`,
        client_id: made.clientId,
        name: "Rival",
        status: "planned",
        currency: "INR",
        created_at: 1,
        updated_at: 1,
      });
    });
    const res = await call(`/documents/${made.id}/start-project`, { cookie: s.cookie, body: {} }, rival);
    expect(res.status, await res.clone().text()).toBe(201);
    expect((await json(res)).code).toBe(`PRJ-${String(next + 1).padStart(4, "0")}`);
  });
});

describe("POST /documents/:id/start-project: refusals [ADM-PRJ-01]", () => {
  it("a sent but not accepted proposal: 409 not_accepted, nothing written", async () => {
    const { s, made } = await offer({ schedule: FORTY_SIXTY, accept: false });
    const res = await start(s.cookie, made.id);
    expect([res.status, await codeOf(res)]).toEqual([409, "not_accepted"]);
    expect(
      (await one<{ n: number }>("SELECT count(*) AS n FROM projects WHERE source_document_id = ?", made.id))
        ?.n,
    ).toBe(0);
  });
  it("an estimate: 409 not_a_proposal (it becomes an invoice or a care plan)", async () => {
    const { s, made } = await offer({ type: "estimate" });
    const res = await start(s.cookie, made.id);
    expect([res.status, await codeOf(res)]).toEqual([409, "not_a_proposal"]);
  });
  it("a draft, a made-up id and a document that is not a quote: 409 / 404", async () => {
    const s = await owner();
    const draft = await mkDraft(s);
    expect((await start(s.cookie, draft.id)).status).toBe(409);
    expect((await start(s.cookie, "no-such-id")).status).toBe(404);
  });
  it("sales and accountant are refused (403); signed out is 401; staff may", async () => {
    const { made, s } = await offer({ schedule: FORTY_SIXTY });
    for (const role of ["sales", "accountant"] as const) {
      const other = await sessionFor(role);
      expect((await start(other.cookie, made.id)).status, role).toBe(403);
    }
    expect((await call(`/documents/${made.id}/start-project`, { body: {} })).status).toBe(401);
    const staff = await sessionFor("staff");
    expect((await start(staff.cookie, made.id)).status).toBe(201);
    void s;
  });
  it("an anonymised client: 409 client_anonymised, nothing written", async () => {
    const { s, made } = await offer({ schedule: FORTY_SIXTY });
    await env.DB.prepare("UPDATE clients SET anonymised_at = ? WHERE id = ?")
      .bind(Date.now(), made.clientId)
      .run();
    const res = await start(s.cookie, made.id);
    expect([res.status, await codeOf(res)]).toEqual([409, "client_anonymised"]);
    expect(
      (await one<{ n: number }>("SELECT count(*) AS n FROM projects WHERE source_document_id = ?", made.id))
        ?.n,
    ).toBe(0);
  });
  it("a stale stamp is 409; the right one passes", async () => {
    const { s, made } = await offer({ schedule: FORTY_SIXTY });
    const doc = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", made.id);
    const stale = await start(s.cookie, made.id, { expectedUpdatedAt: (doc?.updated_at ?? 0) - 1 });
    expect([stale.status, await codeOf(stale)]).toEqual([409, "stale_version"]);
    expect((await start(s.cookie, made.id, { expectedUpdatedAt: doc?.updated_at })).status).toBe(201);
  });
  it("the body names nothing the server decides: trustRates, a target amount, a type or a client in the body is a 400", async () => {
    const { s, made } = await offer({ schedule: FORTY_SIXTY });
    for (const extra of [
      { trustRates: true },
      { targetTotalMinor: 1 },
      { type: "tax_invoice" },
      { clientId: "x" },
      { amountMinor: 5 },
    ]) {
      expect((await start(s.cookie, made.id, extra)).status, JSON.stringify(extra)).toBe(400);
    }
    expect(
      (await one<{ n: number }>("SELECT count(*) AS n FROM projects WHERE source_document_id = ?", made.id))
        ?.n,
    ).toBe(0);
  });
  it("the lookups are indexed (EXPLAIN)", async () => {
    for (const sql of [
      "SELECT id, code FROM projects WHERE source_document_id = 'x'",
      "SELECT id FROM documents WHERE source_document_id = 'x' AND source_step = 1",
    ]) {
      const plan = await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`);
      expect(plan.map((p) => p.detail).join(" | "), sql).toMatch(
        /USING (COVERING )?INDEX (projects_source_document|documents_source)/,
      );
    }
  });
});

describe("the advance mode decides the draft's type", () => {
  const set = (mode: string) =>
    env.DB.prepare(
      "INSERT INTO settings (key, value, version) VALUES ('tax', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1",
    )
      .bind(JSON.stringify({ advanceMode: mode }))
      .run();
  for (const [mode, type] of [
    ["proforma", "proforma"],
    ["invoice_upfront", "tax_invoice"],
    ["receipt_voucher", "proforma"],
  ] as const)
    it(`${mode}: ${type}, still exactly the step`, async () => {
      await set(mode);
      try {
        const { s, made } = await offer({ schedule: FORTY_SIXTY });
        const out = await json(await start(s.cookie, made.id));
        expect(out.firstInstalment).toMatchObject({ type, amountMinor: 118_000 });
        expect(await one<J>("SELECT type, total_minor FROM documents WHERE id = ?", out.draftId)).toEqual({
          type,
          total_minor: 118_000,
        });
      } finally {
        await env.DB.prepare("DELETE FROM settings WHERE key = 'tax'").run();
      }
    });
  void withDb;
});
