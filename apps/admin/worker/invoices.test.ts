// Invoice drafts [ADM-INV-01, ADM-INV-04, ADM-PRJ-02, ADM-APR-02]: create (from services and from a milestone), read, save, discard, list, and who may
// do what. Issuing and voiding are in invoices-issue.test.ts and invoices-void.test.ts. VERIFY WITH CA/LEGAL for every rule under test.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { beforeAll, describe, expect, it } from "vitest";
import { ROUTES } from "./guard.ts";
import { insert, mkClient, mkDoc } from "./test-clients.ts";
import { call, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import {
  auditCount,
  codeOf,
  getInvoice,
  invoiceRow,
  issueInvoice,
  type J,
  json,
  mkInvoice,
  mkInvoiceClient,
  mkOverseasClient,
  mkReadyMilestone,
  patchInvoice,
  putBank,
  putCompany,
} from "./test-invoices.ts";
import { mkService } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putCompany();
  await putBank();
});

describe("creating a draft from services [ADM-INV-01]", () => {
  it("the type comes from the client: India is a tax invoice, overseas an export invoice; the currency is the client's", async () => {
    const o = await owner();
    const india = await mkInvoice(o);
    expect(await invoiceRow(india.id)).toMatchObject({
      type: "tax_invoice",
      status: "draft",
      number: null,
      frozen_at: null,
    });
    const view = await getInvoice(o, india.id);
    expect(view).toMatchObject({
      type: "tax_invoice",
      currency: "INR",
      status: "draft",
      frozen: false,
      number: null,
    });
    expect(view.totals.totalMinor).toBe(118_000); // 100,000 + 18 % GST (intra-state: CGST 9 % + SGST 9 %)
    expect(view.totals.cgstMinor).toBe(9_000);
    expect(view.totals.sgstMinor).toBe(9_000);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]).toMatchObject({ sac: "998314", gstRateBp: 1800 });
    // no catalogue reference on an invoice line, only the service it came from
    expect(
      await one(
        "SELECT catalogue_rate_minor, catalogue_line FROM document_lines WHERE document_id = ?",
        india.id,
      ),
    ).toEqual({ catalogue_rate_minor: null, catalogue_line: null });

    const o2 = await mkOverseasClient();
    const item = await mkService(100_000, { price_usd_minor: 5_000 });
    const res = await call("/invoices", {
      cookie: o.cookie,
      body: { clientId: o2.clientId, services: [{ catalogueItemId: item.id }] },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const id = (await json(res)).id as string;
    expect(await invoiceRow(id)).toMatchObject({ type: "export_invoice" });
    expect((await getInvoice(o, id)).currency).toBe("USD");
  });

  it("the default contact is the billing contact, else the primary live one; a given contact must be the client's", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const billing = await mkInvoice(o, { clientId: c.clientId });
    expect((await getInvoice(o, billing.id)).contact?.id).toBe(c.contactId); // only the primary exists
    await env.DB.prepare(
      "INSERT INTO contacts (id, client_id, name, email, is_billing) VALUES ('bill-1', ?1, 'Bill Payer', 'bill@example.test', 1)",
    )
      .bind(c.clientId)
      .run();
    const second = await mkInvoice(o, { clientId: c.clientId });
    expect((await getInvoice(o, second.id)).contact?.id).toBe("bill-1");
    const other = await mkInvoiceClient();
    const item = await mkService();
    const bad = await call("/invoices", {
      cookie: o.cookie,
      body: { clientId: c.clientId, contactId: other.contactId, services: [{ catalogueItemId: item.id }] },
    });
    expect(bad.status).toBe(400);
    expect(await codeOf(bad)).toBe("contact_invalid");
  });

  it("an unknown client is 404, an anonymised one 409, an unknown or inactive service is refused, a body with extras is 400", async () => {
    const o = await owner();
    const item = await mkService();
    const create = (body: unknown) => call("/invoices", { cookie: o.cookie, body });
    expect((await create({ clientId: "nope", services: [{ catalogueItemId: item.id }] })).status).toBe(404);
    const gone = await mkInvoiceClient();
    await env.DB.prepare("UPDATE clients SET anonymised_at = 1 WHERE id = ?").bind(gone.clientId).run();
    expect(
      await codeOf(await create({ clientId: gone.clientId, services: [{ catalogueItemId: item.id }] })),
    ).toBe("client_anonymised");
    const c = await mkInvoiceClient();
    expect(
      await codeOf(await create({ clientId: c.clientId, services: [{ catalogueItemId: "nope" }] })),
    ).toBe("service_unknown");
    const dead = await mkService(100_000, { active: 0 });
    expect(
      await codeOf(await create({ clientId: c.clientId, services: [{ catalogueItemId: dead.id }] })),
    ).toBe("service_inactive");
    for (const extra of [
      { type: "export_invoice" },
      { status: "issued" },
      { number: "x" },
      { targetTotalMinor: 1 },
      { trustRates: true },
    ])
      expect((await create({ clientId: c.clientId, ...extra })).status, JSON.stringify(extra)).toBe(400);
    expect(
      (await create({ clientId: c.clientId, fromMilestoneId: "m", services: [{ catalogueItemId: item.id }] }))
        .status,
    ).toBe(400);
  });

  it("a draft with no services is allowed (it cannot be issued yet); the audit row holds ids, codes and totals only", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const res = await call("/invoices", { cookie: o.cookie, body: { clientId: c.clientId } });
    expect(res.status).toBe(201);
    const id = (await json(res)).id as string;
    const view = await getInvoice(o, id);
    expect(view.lines).toEqual([]);
    expect(view.blockers.map((b: J) => b.code)).toContain("no_lines");
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'invoice.create' AND entity_id = ?",
      id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({
      documentId: id,
      type: "tax_invoice",
      clientId: c.clientId,
      lines: 0,
    });
    expect(audit?.summary).not.toContain("Test service");
  });
});

describe("saving a draft [ADM-INV-04, ADM-APR-02]", () => {
  it("lines and the document discount are worked out by the shared engine, hashed, and saved with a new updatedAt", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const doc = await getInvoice(o, made.id);
    const line = doc.lines[0];
    const res = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      fields: { discount: { kind: "fixed", value: 10_000 } },
      lines: [
        { id: line.id, description: line.description, qtyMilli: 2000, unit: "fixed", rateMinor: 100_000 },
        {
          description: "Pass-through costs",
          sac: "998314",
          qtyMilli: 1000,
          unit: "fixed",
          rateMinor: 50_000,
        },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const v = await json(res);
    // subtotal 250,000; discount 10,000 shared over the lines; taxable 240,000; GST 18 % = 43,200; total 283,200
    expect(v.totals).toMatchObject({
      subtotalMinor: 250_000,
      discountMinor: 10_000,
      taxableMinor: 240_000,
      totalMinor: 283_200,
    });
    expect(v.updatedAt).toBeGreaterThan(doc.updatedAt);
    expect(v.contentSha256).not.toBe(doc.contentSha256);
    const again = await getInvoice(o, made.id);
    expect(again.contentSha256).toBe(v.contentSha256);
    expect(again.lines).toHaveLength(2);
    expect(again.needsResave).toBe(false);
    expect(await auditCount("invoice.update", made.id)).toBe(1);
  });

  it("a stale save is 409 stale_version and writes nothing; never in a request: a number, status, hash, type, trustRates or targetTotalMinor", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const doc = await getInvoice(o, made.id);
    const stale = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt - 1,
      fields: { discount: null },
    });
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe("stale_version");
    expect(await auditCount("invoice.update", made.id)).toBe(0);
    for (const extra of [
      { status: "issued" },
      { number: "TH/INV/2627/0001" },
      { type: "proforma" },
      { contentSha256: "a".repeat(64) },
      { trustRates: true },
      { targetTotalMinor: 1 },
    ]) {
      const res = await patchInvoice(o, made.id, { expectedUpdatedAt: doc.updatedAt, ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    for (const bad of [{ trustRates: true }, { targetTotalMinor: 5 }, { dueDate: "2026-12-01" }])
      expect(
        (await patchInvoice(o, made.id, { expectedUpdatedAt: doc.updatedAt, fields: bad })).status,
        JSON.stringify(bad),
      ).toBe(400);
    expect((await patchInvoice(o, "no-such", { expectedUpdatedAt: 1 })).status).toBe(404);
  });

  it("a changed hash expires a pending or approved issue request in the same batch (it never revives)", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const made = await mkInvoice(o);
    const now = Date.now();
    const requestId = "req-expire-1";
    await env.DB.prepare(
      "INSERT INTO approvals (id, kind, document_id, requested_by, content_sha256, status, created_at) VALUES (?1, 'issue', ?2, ?3, ?4, 'pending', ?5)",
    )
      .bind(requestId, made.id, staff.id, made.contentSha256, now)
      .run();
    const doc = await getInvoice(o, made.id);
    expect(doc.issue.approval).toMatchObject({ state: "pending", id: requestId });
    const res = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      fields: { discount: { kind: "percent", value: 500 } },
    });
    expect(res.status).toBe(200);
    expect((await json(res)).issue.approval.state).toBe("expired");
    expect(await one("SELECT status FROM approvals WHERE id = ?", requestId)).toEqual({ status: "expired" });
  });

  it("a catalogue line keeps its SAC and rate; a custom line without a SAC saves and then blocks the issue", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const doc = await getInvoice(o, made.id);
    const line = doc.lines[0];
    const wrong = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: [{ id: line.id, description: "x", qtyMilli: 1000, unit: "fixed", rateMinor: 1, sac: "123456" }],
    });
    expect(wrong.status).toBe(400);
    expect(await codeOf(wrong)).toBe("line_tax_fixed");
    const ok = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: [{ description: "Custom work", qtyMilli: 1000, unit: "fixed", rateMinor: 20_000 }],
    });
    expect(ok.status).toBe(200);
    expect((await json(ok)).blockers).toEqual([{ code: "line_sac_missing", line: 1 }]);
  });
});

describe("discarding a draft [ADM-INV-04]", () => {
  it("deletes a draft with its lines, approvals and their bells; a stale delete is 409; an unknown id is 404", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const made = await mkInvoice(o);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO approvals (id, kind, document_id, requested_by, content_sha256, status, created_at) VALUES ('req-del', 'issue', ?1, ?2, ?3, 'pending', 1)",
      ).bind(made.id, staff.id, made.contentSha256),
      env.DB.prepare(
        "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link) VALUES ('n-del', ?1, 'approval.requested', 'approval', 'req-del', 't', '/x')",
      ).bind(o.id),
    ]);
    const stale = await call(`/invoices/${made.id}?expectedUpdatedAt=${made.updatedAt - 1}`, {
      method: "DELETE",
      cookie: o.cookie,
    });
    expect(stale.status).toBe(409);
    expect(await countOf("documents", "id = ?", made.id)).toBe(1);
    const res = await call(`/invoices/${made.id}?expectedUpdatedAt=${made.updatedAt}`, {
      method: "DELETE",
      cookie: o.cookie,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await countOf("documents", "id = ?", made.id)).toBe(0);
    expect(await countOf("document_lines", "document_id = ?", made.id)).toBe(0);
    expect(await countOf("approvals", "document_id = ?", made.id)).toBe(0);
    expect(await countOf("notifications", "entity_id = 'req-del'")).toBe(0);
    expect(await auditCount("invoice.delete", made.id)).toBe(1);
    expect(
      (await call("/invoices/nope?expectedUpdatedAt=1", { method: "DELETE", cookie: o.cookie })).status,
    ).toBe(404);
  });
});

describe("a draft from a milestone [ADM-PRJ-02, LD13]", () => {
  it("an inclusive split: the total equals the milestone amount, the milestone is linked, a second draft is 409", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const m = await mkReadyMilestone(c.clientId, 11_800_00);
    const res = await call("/invoices", {
      cookie: o.cookie,
      body: { clientId: c.clientId, fromMilestoneId: m.id },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const made = await json(res);
    expect(made.totalMinor).toBe(11_800_00);
    expect(await one("SELECT document_id, status FROM milestones WHERE id = ?", m.id)).toEqual({
      document_id: made.id,
      status: "ready_to_bill",
    });
    expect(await one("SELECT project_id FROM documents WHERE id = ?", made.id)).toEqual({
      project_id: m.projectId,
    });
    const view = await getInvoice(o, made.id);
    expect(view.totals.totalMinor).toBe(11_800_00);
    expect(view.milestone).toMatchObject({ id: m.id, title: "Design" });
    // one line at the default rate and no SAC (a milestone without a source proposal): the issue is blocked on the SAC
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0].sac).toBeNull();
    expect(view.blockers.map((b: J) => b.code)).toContain("line_sac_missing");
    const again = await call("/invoices", {
      cookie: o.cookie,
      body: { clientId: c.clientId, fromMilestoneId: m.id },
    });
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("milestone_has_invoice");
    // a save keeps the target: the lines can be edited, the total stays the milestone's
    const ok = await patchInvoice(o, made.id, {
      expectedUpdatedAt: view.updatedAt,
      lines: [
        {
          id: view.lines[0].id,
          description: "Design (phase 1)",
          sac: "998314",
          qtyMilli: 1000,
          unit: "fixed",
          rateMinor: view.lines[0].rateMinor,
        },
      ],
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await json(ok)).totals.totalMinor).toBe(11_800_00);
  });

  it("a project that came from a proposal splits the milestone over the proposal's (SAC, rate) groups, in proportion, and the invoice can be issued at once", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const proposalId = uuidv7();
    const row = (sac: string, taxable: number) => ({
      sac,
      gstRateBp: 1800,
      effectiveRateBp: 1800,
      taxableMinor: taxable,
      cgstMinor: (taxable * 9) / 100,
      sgstMinor: (taxable * 9) / 100,
      igstMinor: 0,
    });
    await insert("documents", {
      id: proposalId,
      type: "proposal",
      client_id: c.clientId,
      currency: "INR",
      version_group_id: proposalId,
      computed: JSON.stringify({ summary: [row("998314", 600_000), row("998313", 400_000)] }),
    });
    const m = await mkReadyMilestone(c.clientId, 11_800_00);
    await env.DB.prepare("UPDATE projects SET source_document_id = ?1 WHERE id = ?2")
      .bind(proposalId, m.projectId)
      .run();
    const res = await call("/invoices", {
      cookie: o.cookie,
      body: { clientId: c.clientId, fromMilestoneId: m.id },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const made = await json(res);
    const view = await getInvoice(o, made.id);
    // 60 % and 40 % of Rs 11,800 tax included: taxable 6,000 and 4,000 at 18 %
    expect(view.lines.map((l: J) => [l.sac, l.rateMinor, l.qtyMilli])).toEqual([
      ["998314", 600_000, 1000],
      ["998313", 400_000, 1000],
    ]);
    expect(view.lines[0].description).toBe("Design (SAC 998314, 18%)");
    expect(view.totals.totalMinor).toBe(11_800_00);
    expect(view.blockers).toEqual([]);
    expect(view.issue.canIssue).toBe(true);
    const issued = await issueInvoice(o, made.id);
    expect(issued.status, await issued.clone().text()).toBe(200);
    expect(await one("SELECT status FROM milestones WHERE id = ?", m.id)).toEqual({ status: "invoiced" });
  });

  it("the milestone must be ready to bill, of this client, with an amount; deleting the draft frees it", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const other = await mkInvoiceClient();
    const create = (clientId: string, id: string) =>
      call("/invoices", { cookie: o.cookie, body: { clientId, fromMilestoneId: id } });
    const pending = await mkReadyMilestone(c.clientId, 11_800_00, { status: "pending" });
    expect(await codeOf(await create(c.clientId, pending.id))).toBe("milestone_not_ready");
    const foreign = await mkReadyMilestone(other.clientId);
    expect((await create(c.clientId, foreign.id)).status).toBe(404);
    expect((await create(c.clientId, "nope")).status).toBe(404);
    const noAmount = await mkReadyMilestone(c.clientId, 1, { amount_minor: null, pct_bp: 5000 });
    await env.DB.prepare("UPDATE projects SET budget_minor = NULL WHERE id = ?")
      .bind(noAmount.projectId)
      .run();
    expect(await codeOf(await create(c.clientId, noAmount.id))).toBe("milestone_no_amount");

    const m = await mkReadyMilestone(c.clientId, 5_900_00);
    const made = await json(await create(c.clientId, m.id));
    const del = await call(`/invoices/${made.id}?expectedUpdatedAt=${made.updatedAt}`, {
      method: "DELETE",
      cookie: o.cookie,
    });
    expect(del.status).toBe(200);
    expect(await one("SELECT document_id, status FROM milestones WHERE id = ?", m.id)).toEqual({
      document_id: null,
      status: "ready_to_bill",
    });
    expect((await create(c.clientId, m.id)).status).toBe(201); // free again
  });

  it("a percentage milestone takes its share of the project's budget (half up)", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const m = await mkReadyMilestone(c.clientId, 1, { amount_minor: null, pct_bp: 2500 }); // budget 100,000,000 paise (Rs 10 lakh): 25 % = 25,000,000
    const res = await call("/invoices", {
      cookie: o.cookie,
      body: { clientId: c.clientId, fromMilestoneId: m.id },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect((await json(res)).totalMinor).toBe(25_000_000);
  });

  it("moving a milestone to ready to bill records the delivery time once (LD12); going back and forth keeps it", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const m = await mkReadyMilestone(c.clientId, 100_00, { status: "pending", delivered_at: null });
    const status = (to: string) => call(`/milestones/${m.id}/status`, { cookie: o.cookie, body: { to } });
    expect((await status("ready_to_bill")).status).toBe(200);
    const first = (
      await one<{ delivered_at: number }>("SELECT delivered_at FROM milestones WHERE id = ?", m.id)
    )?.delivered_at as number;
    expect(first).toBeGreaterThan(0);
    expect((await status("pending")).status).toBe(200);
    expect(
      (await one<{ delivered_at: number }>("SELECT delivered_at FROM milestones WHERE id = ?", m.id))
        ?.delivered_at,
    ).toBe(first);
    expect((await status("ready_to_bill")).status).toBe(200);
    expect(
      (await one<{ delivered_at: number }>("SELECT delivered_at FROM milestones WHERE id = ?", m.id))
        ?.delivered_at,
    ).toBe(first);
  });
});

describe("the list and who may read invoices [ADM-INV-02, ADM-G-02]", () => {
  it("newest first, filtered by type, status and client; Sales sees none, the accountant reads", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const a = await mkInvoice(o, { clientId: c.clientId });
    const b = await mkInvoice(o, { clientId: c.clientId });
    await mkDoc(c.clientId, "proforma");
    const list = await json(await call(`/invoices?clientId=${c.clientId}`, { cookie: o.cookie }));
    expect(list.invoices.map((i: J) => i.id)).toContain(a.id);
    expect(list.invoices.map((i: J) => i.id)).toContain(b.id);
    const ids = list.invoices.map((i: J) => i.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id)); // newest first
    const onlyTax = await json(
      await call(`/invoices?clientId=${c.clientId}&type=tax_invoice`, { cookie: o.cookie }),
    );
    expect(onlyTax.invoices.every((i: J) => i.type === "tax_invoice")).toBe(true);
    const drafts = await json(
      await call(`/invoices?clientId=${c.clientId}&status=draft`, { cookie: o.cookie }),
    );
    expect(drafts.invoices.length).toBe(3);
    const issued = await json(
      await call(`/invoices?clientId=${c.clientId}&status=issued`, { cookie: o.cookie }),
    );
    expect(issued.invoices).toEqual([]);
    const acc = await sessionFor("accountant");
    expect((await call("/invoices", { cookie: acc.cookie })).status).toBe(200);
    expect((await call(`/invoices/${a.id}`, { cookie: acc.cookie })).status).toBe(200);
    const sales = await sessionFor("sales");
    for (const path of [
      "/invoices",
      `/invoices/${a.id}`,
      `/clients/${c.clientId}/invoices`,
      `/invoices/${a.id}/pdf`,
    ])
      expect((await call(path, { cookie: sales.cookie })).status, path).toBe(403);
    const tab = await json(await call(`/clients/${c.clientId}/invoices`, { cookie: o.cookie }));
    expect(tab.invoices.length).toBe(3);
    expect((await call("/invoices?status=bogus", { cookie: o.cookie })).status).toBe(400);
    expect((await call("/invoices?after=garbage", { cookie: o.cookie })).status).toBe(400);
  });

  it("pages of at most 25 or 50 by a keyset cursor, with no duplicate between pages", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    for (let i = 0; i < 27; i++) await mkDoc(c.clientId, "proforma");
    const first = await json(await call(`/invoices?clientId=${c.clientId}&limit=25`, { cookie: o.cookie }));
    expect(first.invoices).toHaveLength(25);
    expect(first.next).toEqual(expect.any(String));
    const second = await json(
      await call(`/invoices?clientId=${c.clientId}&limit=25&after=${first.next}`, { cookie: o.cookie }),
    );
    expect(second.invoices).toHaveLength(2);
    expect(second.next).toBeNull();
    const all = [...first.invoices, ...second.invoices].map((i: J) => i.id);
    expect(new Set(all).size).toBe(27);
  });

  it("overdue is computed (balance above zero and past the due date), never stored", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    let n = 8000;
    const mk = async (due: string, status = "issued", balance = 100) => {
      const id = uuidv7();
      await insert("documents", {
        id,
        type: "tax_invoice",
        client_id: c.clientId,
        currency: "INR",
        status,
        due_date: due,
        balance_minor: balance,
        total_minor: 100,
        frozen_at: 1,
        series: "invoice",
        fy: "2627",
        number: ++n,
        number_display: `T/OVERDUE/${n}`,
      });
      return id;
    };
    const late = await mk("2020-01-01");
    const future = await mk("2999-01-01");
    const settled = await mk("2020-01-01", "paid", 0);
    const list = await json(await call(`/invoices?clientId=${c.clientId}`, { cookie: o.cookie }));
    const by = Object.fromEntries(list.invoices.map((i: J) => [i.id, i]));
    expect(by[late].overdue).toBe(true);
    expect(by[future].overdue).toBe(false);
    expect(by[settled].overdue).toBe(false);
    const only = await json(
      await call(`/invoices?clientId=${c.clientId}&status=overdue`, { cookie: o.cookie }),
    );
    expect(only.invoices.map((i: J) => i.id)).toEqual([late]);
  });
});

describe("the route table", () => {
  it("every invoice route is declared, with its action and audit name", () => {
    const rows2 = ROUTES.filter((r) => r.path.includes("/invoices"));
    expect(rows2.map((r) => `${r.method} ${r.path} ${r.access} ${r.audit ?? "-"}`)).toEqual([
      "GET /api/v1/invoices invoices.read -",
      "POST /api/v1/invoices invoices.draft invoice.create",
      "GET /api/v1/invoices/:id invoices.read -",
      "PATCH /api/v1/invoices/:id invoices.draft invoice.update",
      "DELETE /api/v1/invoices/:id invoices.draft invoice.delete",
      "POST /api/v1/invoices/:id/issue invoices.issue invoice.issue",
      "POST /api/v1/invoices/:id/issue-request invoices.draft approval.request",
      "POST /api/v1/invoices/:id/void invoices.void invoice.void",
      "POST /api/v1/invoices/:id/service-completed invoices.draft invoice.service_completed",
      "POST /api/v1/invoices/:id/advance-invoice invoices.advance invoice.advance_issue",
      // M5.3 (added on purpose): the note drafts and the IMS answer
      "POST /api/v1/invoices/:id/credit-note invoices.draft invoice.note_create",
      "POST /api/v1/invoices/:id/debit-note invoices.draft invoice.note_create",
      "POST /api/v1/invoices/:id/ims-status invoices.ims invoice.ims_status",
      "GET /api/v1/invoices/:id/pdf invoices.read -",
      "POST /api/v1/invoices/:id/pdf/retry invoices.draft invoice.pdf_retry",
      "GET /api/v1/clients/:id/invoices invoices.read -",
    ]);
    expect(ROUTES.find((r) => r.path === "/api/v1/invoices/:id" && r.method === "PATCH")?.body).toBe(
      "document",
    );
  });

  it("an unknown client has no invoices tab data but a 200 empty list", async () => {
    const o = await owner();
    const c = await mkClient();
    const tab = await json(await call(`/clients/${c}/invoices`, { cookie: o.cookie }));
    expect(tab.invoices).toEqual([]);
    expect(await rows("SELECT id FROM documents WHERE client_id = ?", c)).toEqual([]);
  });
});
