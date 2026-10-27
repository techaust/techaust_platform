// Voiding an invoice [ADM-INV-03, ADM-INV-07, Q1, Q2, LD7; VERIFY WITH CA/LEGAL, Rule 56(8), GSTR-1 Table 13]: the Owner only, with a fresh code, before the
// invoice was emailed and with no payment, credit or issued child; the number and the record stay. Plus the status flow in the database and the
// Table 13 summary of what was issued.
import { env } from "cloudflare:workers";
import { documentsIssuedSummary } from "@techaust/core/invoices";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ISSUED_DOCUMENTS_SQL } from "./invoice-model.ts";
import { insert } from "./test-clients.ts";
import { call, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import {
  auditCount,
  codeOf,
  farSession,
  getInvoice,
  invoiceCounter,
  invoiceRow,
  issueInvoice,
  type J,
  json,
  mkInvoice,
  mkInvoiceClient,
  mkReadyMilestone,
  patchInvoice,
  putBank,
  putCompany,
  voidInvoice,
} from "./test-invoices.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putCompany();
  await putBank();
});
afterEach(() => vi.useRealTimers());

async function issued(o: Awaited<ReturnType<typeof owner>>, opts: { clientId?: string } = {}) {
  const made = await mkInvoice(o, opts);
  const res = await issueInvoice(o, made.id);
  expect(res.status, await res.clone().text()).toBe(200);
  return { ...made, number: (await json(res)).number as string };
}

describe("void [Q1, Q2, LD7]", () => {
  it("the owner voids an issued invoice: the number stays, the status, the time and the reason are set; the audit row holds no reason text", async () => {
    const o = await owner();
    const inv = await issued(o);
    const before = await invoiceRow(inv.id);
    const res = await voidInvoice(o, inv.id, "Wrong client chosen");
    expect(res.status, await res.clone().text()).toBe(200);
    const after = await invoiceRow(inv.id);
    expect(after).toMatchObject({
      status: "void",
      number: before?.number,
      number_display: inv.number,
      void_reason: "Wrong client chosen",
      frozen_at: before?.frozen_at,
    });
    expect(after?.voided_at).toBeGreaterThan(0);
    const audit = await one<{ summary: string; role: string }>(
      "SELECT summary, role FROM audit_log WHERE action = 'invoice.void' AND entity_id = ?",
      inv.id,
    );
    expect(audit?.role).toBe("owner");
    const summary = JSON.parse(audit?.summary ?? "{}");
    expect(summary).toMatchObject({
      documentId: inv.id,
      number: inv.number,
      type: "tax_invoice",
      totalMinor: 118_000,
      reasonLength: 19,
    });
    expect(audit?.summary).not.toContain("Wrong client");
    const view = await getInvoice(o, inv.id);
    expect(view).toMatchObject({
      status: "void",
      number: inv.number,
      void: { reason: "Wrong client chosen", canVoid: false },
    });
    // the number is never reused: the next invoice gets the next number
    const next = await issued(o);
    expect(next.number).not.toBe(inv.number);
  });

  it("a reason is required (1 to 500 characters), and a body with extras is 400", async () => {
    const o = await owner();
    const inv = await issued(o);
    const row = await invoiceRow(inv.id);
    const t = row?.updated_at as number;
    const void_ = (body: unknown) => call(`/invoices/${inv.id}/void`, { cookie: o.cookie, body });
    expect((await void_({ expectedUpdatedAt: t })).status).toBe(400);
    expect((await void_({ expectedUpdatedAt: t, reason: "" })).status).toBe(400);
    expect((await void_({ expectedUpdatedAt: t, reason: "   " })).status).toBe(400);
    expect((await void_({ expectedUpdatedAt: t, reason: "x".repeat(501) })).status).toBe(400);
    expect((await void_({ expectedUpdatedAt: t, reason: "ok", status: "void" })).status).toBe(400);
    expect(await invoiceRow(inv.id)).toMatchObject({ status: "issued" });
    expect((await void_({ expectedUpdatedAt: t, reason: "x".repeat(500) })).status).toBe(200);
  });

  it("voiding twice is 409 already_void; a draft is 409 not_issued; a stale updatedAt is 409 stale_version", async () => {
    const o = await owner();
    const inv = await issued(o);
    const stale = await call(`/invoices/${inv.id}/void`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: 1, reason: "x" },
    });
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe("stale_version");
    expect((await voidInvoice(o, inv.id)).status).toBe(200);
    const twice = await voidInvoice(o, inv.id);
    expect(twice.status).toBe(409);
    expect(await codeOf(twice)).toBe("already_void");
    const draft = await mkInvoice(o);
    const d = await voidInvoice(o, draft.id);
    expect(d.status).toBe(409);
    expect(await codeOf(d)).toBe("void_not_allowed");
    expect((await json(await voidInvoice(o, draft.id))).reasons).toEqual(["not_issued"]);
    expect(await invoiceRow(draft.id)).toMatchObject({ status: "draft", voided_at: null });
    expect(await auditCount("invoice.void", draft.id)).toBe(0);
  });

  it("refused with a payment, a credit, an issued child document or a send: nothing is written", async () => {
    const o = await owner();
    for (const [name, code, prepare] of [
      [
        "paid",
        "has_payment",
        (id: string) => env.DB.prepare("UPDATE documents SET paid_minor = 1 WHERE id = ?").bind(id).run(),
      ],
      [
        "credited",
        "has_credit",
        (id: string) => env.DB.prepare("UPDATE documents SET credited_minor = 1 WHERE id = ?").bind(id).run(),
      ],
      [
        "child",
        "has_child_document",
        async (id: string) => {
          const client = (
            await one<{ client_id: string }>("SELECT client_id FROM documents WHERE id = ?", id)
          )?.client_id as string;
          // an issued credit note that names the invoice as its parent (the parent of a frozen row is set at insert only)
          await insert("documents", {
            id: `cn-${id}`,
            type: "credit_note",
            client_id: client,
            currency: "INR",
            parent_id: id,
            status: "issued",
            frozen_at: 1,
            series: "creditNote",
            fy: "2627",
            number: Math.floor(Math.random() * 1e9),
            number_display: `CN/${id.slice(-8)}`,
          });
        },
      ],
      [
        "emailed",
        "already_emailed",
        async (id: string) => {
          const row = await one<{ client_id: string }>("SELECT client_id FROM documents WHERE id = ?", id);
          const contact = await one<{ id: string }>(
            "SELECT id FROM contacts WHERE client_id = ? LIMIT 1",
            row?.client_id,
          );
          await insert("document_sends", {
            id: `send-${id}`,
            document_id: id,
            version_group_id: id,
            client_id: row?.client_id,
            contact_id: contact?.id,
            email: "x@example.test",
            attach_pdf: 0,
            kind: "send",
            created_by: o.id,
          });
        },
      ],
    ] as const) {
      const inv = await issued(o);
      await prepare(inv.id);
      const before = await invoiceRow(inv.id);
      const res = await voidInvoice(o, inv.id);
      expect(res.status, name).toBe(409);
      const body = await json(res);
      expect(body.error.code, name).toBe("void_not_allowed");
      expect(body.reasons, name).toContain(code);
      expect(await invoiceRow(inv.id), name).toEqual(before);
      expect(await auditCount("invoice.void", inv.id), name).toBe(0);
    }
  });

  it("an anonymised client takes nothing new: the void is 409 client_anonymised and nothing is written", async () => {
    const o = await owner();
    const inv = await issued(o);
    await env.DB.prepare("UPDATE clients SET anonymised_at = 3 WHERE id = ?").bind(inv.clientId).run();
    const before = await invoiceRow(inv.id);
    const res = await voidInvoice(o, inv.id);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("client_anonymised");
    expect(await invoiceRow(inv.id)).toEqual(before);
    expect(await auditCount("invoice.void", inv.id)).toBe(0);
  });

  it("only the owner, with a fresh code: Staff, Sales and the accountant are 403; the owner without a step-up is 403 step_up_required", async () => {
    const o = await owner();
    const inv = await issued(o);
    const before = await invoiceRow(inv.id);
    for (const role of ["staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role, { stepUp: true });
      const res = await voidInvoice(s, inv.id);
      expect(res.status, role).toBe(403);
      expect(await codeOf(res), role).toBe("forbidden");
    }
    const plain = await sessionFor("owner");
    const res = await voidInvoice(plain, inv.id);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("step_up_required");
    expect(await invoiceRow(inv.id)).toEqual(before);
  });

  it("a void issued back to 'issued' aborts in the database; so does any move out of void", async () => {
    const o = await owner();
    const inv = await issued(o);
    expect((await voidInvoice(o, inv.id)).status).toBe(200);
    for (const to of ["issued", "paid", "draft", "partially_paid"])
      await expect(
        env.DB.prepare("UPDATE documents SET status = ?2 WHERE id = ?1").bind(inv.id, to).run(),
        to,
      ).rejects.toThrow(/documents_invoice_status_flow|documents_void_pairing/);
    await expect(
      env.DB.prepare("UPDATE documents SET void_reason = 'other' WHERE id = ?").bind(inv.id).run(),
    ).rejects.toThrow(/frozen/);
  });

  it("a milestone invoice that is voided frees its milestone: back to ready to bill, link cleared, delivery time kept; a new invoice can be made", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const m = await mkReadyMilestone(c.clientId, 11_800_00, { delivered_at: 777 });
    const made = (
      await json(
        await call("/invoices", { cookie: o.cookie, body: { clientId: c.clientId, fromMilestoneId: m.id } }),
      )
    ).id as string;
    const doc = await getInvoice(o, made);
    await patchInvoice(o, made, {
      expectedUpdatedAt: doc.updatedAt,
      lines: [
        {
          id: doc.lines[0].id,
          description: "Design",
          sac: "998314",
          qtyMilli: 1000,
          unit: "fixed",
          rateMinor: doc.lines[0].rateMinor,
        },
      ],
    });
    expect((await issueInvoice(o, made)).status).toBe(200);
    expect(await one("SELECT status, document_id FROM milestones WHERE id = ?", m.id)).toEqual({
      status: "invoiced",
      document_id: made,
    });
    expect((await voidInvoice(o, made)).status).toBe(200);
    expect(await one("SELECT status, document_id, delivered_at FROM milestones WHERE id = ?", m.id)).toEqual({
      status: "ready_to_bill",
      document_id: null,
      delivered_at: 777,
    });
    const again = await call("/invoices", {
      cookie: o.cookie,
      body: { clientId: c.clientId, fromMilestoneId: m.id },
    });
    expect(again.status).toBe(201);
  });
});

describe("a void only inside the IST calendar month of issue [Q23, VERIFY WITH CA/LEGAL: the GST return period]", () => {
  it("the last millisecond of the month still voids; the next millisecond is 409 return_period_closed and nothing is written", async () => {
    const o = await farSession();
    const c = await mkInvoiceClient();
    // 31 October 2026, 10:00 UTC = 15:30 IST: the month of issue is October
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 31, 10, 0, 0, 0) });
    const a = await issued(o, { clientId: c.clientId });
    const b = await issued(o, { clientId: c.clientId });
    const lastMs = Date.UTC(2026, 9, 31, 18, 29, 59, 999); // 23:59:59.999 IST
    vi.setSystemTime(lastMs);
    const ok = await voidInvoice(o, a.id);
    expect(ok.status, await ok.clone().text()).toBe(200);
    vi.setSystemTime(lastMs + 1); // 1 November, 00:00:00.000 IST
    const rowBefore = await invoiceRow(b.id);
    const audits = await auditCount("invoice.void");
    const res = await voidInvoice(o, b.id);
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("return_period_closed");
    expect(body.error.message).toBe(
      "This invoice's GST return period has ended, so it can't be voided. Use a credit note instead.",
    );
    expect(body.reasons).toEqual(["return_period_closed"]);
    expect(await invoiceRow(b.id)).toEqual(rowBefore);
    expect(await auditCount("invoice.void")).toBe(audits);
    // the view says the same, before anyone tries
    const view = await getInvoice(o, b.id);
    expect(view.void.blockers).toEqual(["return_period_closed"]);
  });
});

describe("a void gives the milestone back as it was [LD12, early check required 2]", () => {
  it("an advance invoice on a PENDING milestone: issuing leaves delivered_at unset, the void sends it back to pending (not ready to bill)", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const m = await mkReadyMilestone(c.clientId, 118_000, { status: "pending", delivered_at: null });
    const made = await mkInvoice(o, { clientId: c.clientId });
    await env.DB.prepare("UPDATE milestones SET document_id = ? WHERE id = ?").bind(made.id, m.id).run();
    const res = await issueInvoice(o, made.id);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await one("SELECT status, delivered_at, document_id FROM milestones WHERE id = ?", m.id)).toEqual({
      status: "invoiced",
      delivered_at: null,
      document_id: made.id,
    });
    const voided = await voidInvoice(o, made.id);
    expect(voided.status).toBe(200);
    // the response says where the milestone went, for the toast (07-R §4)
    expect((await json(voided)).milestone).toEqual({ id: m.id, status: "pending" });
    expect(await one("SELECT status, delivered_at, document_id FROM milestones WHERE id = ?", m.id)).toEqual({
      status: "pending",
      delivered_at: null,
      document_id: null,
    });
  });

  it("a delivered milestone's void says ready_to_bill; an invoice with no milestone says null [M5.1 L3]", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const m = await mkReadyMilestone(c.clientId, 118_000, { delivered_at: 555 });
    const made = await mkInvoice(o, { clientId: c.clientId });
    await env.DB.prepare("UPDATE milestones SET document_id = ? WHERE id = ?").bind(made.id, m.id).run();
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    expect((await json(await voidInvoice(o, made.id))).milestone).toEqual({
      id: m.id,
      status: "ready_to_bill",
    });
    const plain = await issued(o, { clientId: c.clientId });
    expect((await json(await voidInvoice(o, plain.id))).milestone).toBeNull();
  });
});

describe("what was issued, for GSTR-1 Table 13 [08-A §4]", () => {
  it("the summary of issued and voided numbers gives from, to, total, cancelled and net; GET /invoices?status=void lists the voided one", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const a = await issued(o, { clientId: c.clientId });
    const b = await issued(o, { clientId: c.clientId });
    const d = await issued(o, { clientId: c.clientId });
    expect((await voidInvoice(o, b.id)).status).toBe(200);
    const all = await rows<{
      series: string;
      fy: string;
      number: number;
      number_display: string;
      status: string;
    }>(ISSUED_DOCUMENTS_SQL, "invoice");
    const summary = documentsIssuedSummary(
      all.map((r) => ({
        series: r.series,
        fy: r.fy,
        number: r.number,
        numberDisplay: r.number_display,
        void: r.status === "void",
      })),
    );
    const mine = summary.find((s) => s.series === "invoice");
    expect(mine).toBeDefined();
    // the three issued here are consecutive, so the range covers them with exactly one cancelled among them
    const nums = [a, b, d].map((x) => Number(x.number.slice(-4)));
    expect(Number(mine?.to.slice(-4))).toBeGreaterThanOrEqual(Math.max(...nums));
    expect(mine?.total).toBe(all.length);
    expect(mine?.cancelled).toBe(all.filter((r) => r.status === "void").length);
    expect(mine?.net).toBe((mine?.total ?? 0) - (mine?.cancelled ?? 0));
    expect(mine?.cancelled).toBeGreaterThanOrEqual(1);
    const list = await json(await call(`/invoices?status=void&clientId=${c.clientId}`, { cookie: o.cookie }));
    expect(list.invoices.map((i: J) => i.id)).toEqual([b.id]);
    expect(list.invoices[0]).toMatchObject({ status: "void", number: b.number });
    expect(await countOf("documents", "client_id = ? AND status = 'void'", c.clientId)).toBe(1);
    expect(await invoiceCounter()).toBeGreaterThan(Math.max(...nums));
  });
});
