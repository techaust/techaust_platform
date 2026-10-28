// The tax invoice for money received against a proforma [Q9, LD22, G-6, ADM-INV-10; Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17)]: the Owner's `POST /invoices/:id/advance-invoice`.
// The proforma converts, the invoice is made paid with the next number of its series, one receipt row is the evidence, a repeated reference is the same
// invoice, and every refusal leaves the counters, the proforma, the receipts and the audit log exactly as they were.

import { env } from "cloudflare:workers";
import { sha256Hex } from "@techaust/core/catalogue";
import { fyOf } from "@techaust/core/dates";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceLineDescription } from "./invoice-model.ts";
import { call, one, rows, sessionFor } from "./test-helpers.ts";
import {
  currentFy,
  ENDORSEMENT,
  frozenBlocks,
  LUT_ARN,
  lutOf,
  mkExportDraft,
  mkProforma,
  putSwiftBank,
  putTax,
  renew,
  sealCheck,
  sealCheckWith,
  todayIso,
  typesRow,
} from "./test-invoice-types.ts";
import {
  auditCount,
  codeOf,
  farSession,
  getInvoice,
  invoiceCounter,
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
  voidInvoice,
} from "./test-invoices.ts";
import { beforeBatchHolding } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => vi.useRealTimers());

type Owner = Awaited<ReturnType<typeof owner>>;

/** An issued proforma for a fresh client (domestic INR by default), with its milestone when asked. */
async function issuedProforma(
  s: Owner,
  opts: { overseas?: boolean; price?: number; milestone?: { delivered?: number } } = {},
) {
  const c = opts.overseas ? await mkOverseasClient() : await mkInvoiceClient();
  const m = opts.milestone
    ? await mkReadyMilestone(c.clientId, opts.price ?? 11_800_00, {
        delivered_at: opts.milestone.delivered ?? 4242,
      })
    : null;
  const made = await mkProforma(s, {
    clientId: c.clientId,
    ...(m ? { milestoneId: m.id } : { price: opts.price ?? 100_000 }),
  });
  const res = await issueInvoice(s, made.id);
  if (res.status !== 200) throw new Error(`proforma not issued: ${res.status} ${await res.text()}`);
  return { ...made, milestoneId: m?.id ?? null, number: (await json(res)).number as string };
}

let refSeq = 0;
const advanceBody = async (proformaId: string, over: Record<string, unknown> = {}) => {
  const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", proformaId);
  return {
    expectedProformaUpdatedAt: row?.updated_at,
    amountMinor: 59_000,
    receivedOn: todayIso(),
    reference: `UTR ${Date.now()} ${++refSeq}`,
    ...over,
  };
};
const advance = async (s: Owner, proformaId: string, over: Record<string, unknown> = {}) =>
  call(`/invoices/${proformaId}/advance-invoice`, {
    cookie: s.cookie,
    body: await advanceBody(proformaId, over),
  });

const receipts = (proformaId: string) =>
  rows(
    "SELECT id, invoice_id, amount_minor, received_on, reference_norm FROM advance_receipts WHERE proforma_id = ?",
    proformaId,
  );
const total = async (id: string) => ((await typesRow(id))?.total_minor ?? 0) as number;

/** What a refusal must leave exactly as it was. */
async function snapshot(proformaId: string) {
  return {
    invoiceCounter: await invoiceCounter(),
    proforma: await typesRow(proformaId),
    receipts: await receipts(proformaId),
    audits: await auditCount("invoice.advance_issue"),
    children: await rows("SELECT id FROM documents WHERE parent_id = ?", proformaId),
  };
}

// ---- the action ------------------------------------------------------------------------------------------------------------------------------------

describe("the action [Q9, LD22]", () => {
  it("issues the next TH/INV number as a PAID invoice linked to the proforma, converts the proforma, and writes one receipt; the invoice counter moved once and the proforma's series not at all", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    expect(pf.number).toMatch(/^TH\/PI\/\d{4}\/\d{4}$/);
    const counter = await invoiceCounter();
    const res = await advance(o, pf.id, { amountMinor: 59_000 });
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    expect(b).toMatchObject({
      ok: true,
      type: "tax_invoice",
      status: "paid",
      warnings: [],
      proforma: {
        id: pf.id,
        status: "converted",
        paidMinor: 59_000,
        balanceMinor: (await total(pf.id)) - 59_000,
      },
    });
    expect(b.number).toMatch(/^TH\/INV\/\d{4}\/\d{4}$/);
    expect(await invoiceCounter()).toBe((counter ?? 1) + 1);
    const inv = await typesRow(b.id);
    expect(inv).toMatchObject({
      type: "tax_invoice",
      status: "paid",
      series: "invoice",
      parent_id: pf.id,
      total_minor: 59_000,
      paid_minor: 59_000,
      balance_minor: 0,
      issue_date: todayIso(),
      due_date: todayIso(),
    });
    expect(await typesRow(pf.id)).toMatchObject({ status: "converted", paid_minor: 59_000 });
    expect(await receipts(pf.id)).toEqual([
      {
        id: b.receiptId,
        invoice_id: b.id,
        amount_minor: 59_000,
        received_on: todayIso(),
        reference_norm: expect.stringMatching(/^UTR\d+$/),
      },
    ]);
    // the frozen invoice's own seal verifies with the advance header it was issued with
    expect(
      await sealCheck(b.id, {
        advance: {
          proformaId: pf.id,
          proformaNumber: pf.number,
          proformaIssueDate: todayIso(),
          receivedOn: todayIso(),
          receiptId: b.receiptId,
        },
      }),
    ).toEqual({ content: true, snapshot: true });
    expect((await sealCheckWith(b.id, {}))?.snapshot).toBe(false);
    // the audit row: ids, codes and amounts; never the reference text
    expect(await auditCount("invoice.advance_issue", b.id)).toBe(1);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'invoice.advance_issue' AND entity_id = ?",
      b.id,
    );
    const summary = JSON.parse(audit?.summary ?? "{}");
    expect(summary).toMatchObject({
      documentId: b.id,
      proformaId: pf.id,
      type: "tax_invoice",
      totalMinor: 59_000,
      currency: "INR",
      receiptId: b.receiptId,
    });
    expect(audit?.summary).not.toMatch(/UTR/i);
    // the view of the proforma lists the invoice made from it, and what is left
    const view = await getInvoice(o, pf.id);
    expect(view.proforma).toMatchObject({ paidMinor: 59_000, canAdvance: true });
    expect(view.proforma.children).toEqual([
      {
        id: b.id,
        type: "tax_invoice",
        number: b.number,
        status: "paid",
        totalMinor: 59_000,
        currency: "INR",
        issueDate: todayIso(),
        receivedOn: todayIso(),
      },
    ]);
    // the invoice made from it knows its parent
    expect((await getInvoice(o, b.id)).parentId).toBe(pf.id);
  });

  it("the same payment reference again is the same invoice: 409 advance_reference_used with its number, however it is spelled; nothing is written", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const first = await advance(o, pf.id, { amountMinor: 10_000, reference: "hdfc 2026/10 abc-1" });
    expect(first.status).toBe(201);
    const number = (await json(first)).number as string;
    const before = await snapshot(pf.id);
    for (const spelling of ["HDFC 2026/10 ABC-1", "  hdfc2026/10abc-1 ", "HDFC2026/10ABC-1"]) {
      const again = await advance(o, pf.id, { amountMinor: 10_000, reference: spelling });
      expect(again.status, spelling).toBe(409);
      const body = await json(again);
      expect(body.error.code).toBe("advance_reference_used");
      expect(body.number).toBe(number);
    }
    expect(await snapshot(pf.id)).toEqual(before);
    // and another reference is another payment
    expect((await advance(o, pf.id, { amountMinor: 10_000, reference: "HDFC-2" })).status).toBe(201);
  });

  it("a retry after a lost answer carries the OLD stamp and still gets the number it already made (the reference is judged before the stamp); a bad reference is 400 whatever the stamp", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const body = await advanceBody(pf.id, { amountMinor: 10_000, reference: "LOST-ANSWER-1" });
    const first = await call(`/invoices/${pf.id}/advance-invoice`, { cookie: o.cookie, body });
    expect(first.status, await first.clone().text()).toBe(201);
    const number = (await json(first)).number as string;
    const before = await snapshot(pf.id);
    // the very same request again: its `expectedProformaUpdatedAt` is now stale, but the number it made comes back
    const retry = await call(`/invoices/${pf.id}/advance-invoice`, { cookie: o.cookie, body });
    expect(retry.status).toBe(409);
    const answer = await json(retry);
    expect(answer.error.code).toBe("advance_reference_used");
    expect(answer.number).toBe(number);
    // a reference that is not a reference is a 400 even with a stale stamp
    const bad = await call(`/invoices/${pf.id}/advance-invoice`, {
      cookie: o.cookie,
      body: { ...body, reference: "!!!" },
    });
    expect(bad.status).toBe(400);
    expect(await codeOf(bad)).toBe("advance_reference_invalid");
    // a NEW reference with the stale stamp is still stale_version
    const stale = await call(`/invoices/${pf.id}/advance-invoice`, {
      cookie: o.cookie,
      body: { ...body, reference: "LOST-ANSWER-2" },
    });
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe("stale_version");
    expect(await snapshot(pf.id)).toEqual(before);
  });

  it("a session that ended between the read and the batch is 401 unauthenticated (a sign-in, not a reload), and nothing is written", async () => {
    for (const change of [
      "UPDATE staff_sessions SET idle_expires_at = 1 WHERE id = ?1",
      "UPDATE staff_sessions SET abs_expires_at = 1 WHERE id = ?1",
      "UPDATE staff_sessions SET revoked_at = 5 WHERE id = ?1",
    ]) {
      const o = await owner();
      const pf = await issuedProforma(o);
      const before = await snapshot(pf.id);
      const res = await call(
        `/invoices/${pf.id}/advance-invoice`,
        { cookie: o.cookie, body: await advanceBody(pf.id) },
        beforeBatchHolding("issue_guard", async () => {
          await env.DB.prepare(change).bind(o.sessionId).run();
        }),
      );
      expect(res.status, change).toBe(401);
      expect(await codeOf(res), change).toBe("unauthenticated");
      expect(await snapshot(pf.id)).toEqual(before);
    }
  });

  it("two calls with one reference at once give exactly one invoice (the other answers with its number)", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const body = await advanceBody(pf.id, { amountMinor: 20_000, reference: "UTR-PARALLEL-1" });
    const [a, b] = await Promise.all([
      call(`/invoices/${pf.id}/advance-invoice`, { cookie: o.cookie, body }),
      call(`/invoices/${pf.id}/advance-invoice`, { cookie: o.cookie, body }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    // The loser either read before the winner wrote (the batch refuses it and `explain` answers with the reference) or after (the reference is judged before the stamp).
    const loser = a.status === 409 ? a : b;
    expect((await json(loser)).error.code).toBe("advance_reference_used");
    expect((await receipts(pf.id)).length).toBe(1);
    expect((await rows("SELECT id FROM documents WHERE parent_id = ?", pf.id)).length).toBe(1);
    expect(await typesRow(pf.id)).toMatchObject({ paid_minor: 20_000 });
  });

  it("the amount cannot exceed what is left; the whole balance and then nothing more", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const t = await total(pf.id);
    const before = await snapshot(pf.id);
    const over = await advance(o, pf.id, { amountMinor: t + 100 });
    expect(over.status).toBe(409);
    expect(await codeOf(over)).toBe("advance_exceeds_balance");
    expect(await snapshot(pf.id)).toEqual(before);
    expect((await advance(o, pf.id, { amountMinor: t })).status).toBe(201);
    expect(await typesRow(pf.id)).toMatchObject({ status: "converted", paid_minor: t, balance_minor: 0 });
    const more = await advance(o, pf.id, { amountMinor: 100 });
    expect(more.status).toBe(409);
    expect(await codeOf(more)).toBe("advance_exceeds_balance");
    expect((await getInvoice(o, pf.id)).proforma.canAdvance).toBe(false);
  });

  it("two part payments and then the rest: the milestone is invoiced only after the last, its delivery time kept", async () => {
    const o = await owner();
    const pf = await issuedProforma(o, { price: 100_000, milestone: { delivered: 777_000 } });
    const state = () =>
      one("SELECT status, delivered_at, document_id FROM milestones WHERE id = ?", pf.milestoneId);
    const t = await total(pf.id);
    expect(await state()).toEqual({ status: "ready_to_bill", delivered_at: 777_000, document_id: pf.id });
    expect((await advance(o, pf.id, { amountMinor: 30_000 })).status).toBe(201);
    expect((await advance(o, pf.id, { amountMinor: 30_000 })).status).toBe(201);
    expect(await state()).toMatchObject({ status: "ready_to_bill", delivered_at: 777_000 });
    expect((await advance(o, pf.id, { amountMinor: t - 60_000 })).status).toBe(201);
    expect(await state()).toEqual({ status: "invoiced", delivered_at: 777_000, document_id: pf.id });
    expect((await receipts(pf.id)).length).toBe(3);
    const children = ((await getInvoice(o, pf.id)).proforma.children as J[]).map((c) => c.totalMinor);
    expect(children).toEqual([30_000, 30_000, t - 60_000]);
  });

  it("the amount is split over the proforma's own (SAC, rate) groups: two SACs give two lines, and they add up to the amount exactly", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const made = await mkProforma(o, { clientId: c.clientId });
    const doc = await getInvoice(o, made.id);
    const line = (sac: string, rate: number) => ({
      description: `Work ${sac}`,
      sac,
      qtyMilli: 1000,
      unit: "fixed",
      rateMinor: rate,
    });
    expect(
      (
        await patchInvoice(o, made.id, {
          expectedUpdatedAt: doc.updatedAt,
          lines: [line("998313", 100_000), line("998314", 300_000)],
        })
      ).status,
    ).toBe(200);
    const issuedPf = await issueInvoice(o, made.id);
    expect(issuedPf.status).toBe(200);
    const proformaNumber = (await json(issuedPf)).number as string;
    const res = await advance(o, made.id, { amountMinor: 118_000 });
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    const lines = await rows<{ sac: string; line_total_minor: number; description: string }>(
      "SELECT sac, line_total_minor, description FROM document_lines WHERE document_id = ? ORDER BY position",
      b.id,
    );
    expect(lines.map((l) => l.sac).sort()).toEqual(["998313", "998314"]);
    expect(lines.reduce((s, l) => s + l.line_total_minor, 0)).toBe(118_000);
    expect(lines.every((l) => l.description === `Payment received against proforma ${proformaNumber}`)).toBe(
      true,
    );
    // the quarter and three quarters of the money, by the weights of the proforma's groups
    const byRate = Object.fromEntries(lines.map((l) => [l.sac, l.line_total_minor]));
    expect(byRate["998313"]).toBe(29_500);
    expect(byRate["998314"]).toBe(88_500);
  });

  it("an INR amount with paise is refused by the engine (a whole rupee only), and nothing is written", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const before = await snapshot(pf.id);
    const res = await advance(o, pf.id, { amountMinor: 59_050 });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe("tax_errors");
    expect(JSON.stringify(body.issues)).toContain("gross_not_whole_unit");
    expect(await snapshot(pf.id)).toEqual(before);
  });
});

// ---- the checks, in order ------------------------------------------------------------------------------------------------------------------

describe("the refusals [every one leaves the counters, the proforma, the receipts and the audit log unchanged]", () => {
  it("not a proforma: 404; an unknown id: 404; a draft proforma: 409 proforma_not_issued; a void one too", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const draft = await mkProforma(o, { clientId: c.clientId });
    const unissued = await call(`/invoices/${draft.id}/advance-invoice`, {
      cookie: o.cookie,
      body: {
        expectedProformaUpdatedAt: draft.updatedAt,
        amountMinor: 100,
        receivedOn: todayIso(),
        reference: "X1",
      },
    });
    expect(unissued.status).toBe(409);
    expect(await codeOf(unissued)).toBe("proforma_not_issued");
    const pf = await issuedProforma(o);
    expect((await voidInvoice(o, pf.id)).status).toBe(200);
    const voided = await advance(o, pf.id);
    expect(voided.status).toBe(409);
    expect(await codeOf(voided)).toBe("proforma_not_issued");
    // a tax invoice is not a proforma
    const inv = await mkInvoice(o);
    const notPf = await call(`/invoices/${inv.id}/advance-invoice`, {
      cookie: o.cookie,
      body: { expectedProformaUpdatedAt: 1, amountMinor: 100, receivedOn: todayIso(), reference: "X2" },
    });
    expect(notPf.status).toBe(404);
    expect(
      (
        await call("/invoices/no-such-id/advance-invoice", {
          cookie: o.cookie,
          body: { expectedProformaUpdatedAt: 1, amountMinor: 100, receivedOn: todayIso(), reference: "X3" },
        })
      ).status,
    ).toBe(404);
  });

  it("a stale proforma stamp is 409 stale_version and nothing is written", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const before = await snapshot(pf.id);
    const res = await advance(o, pf.id, {
      expectedProformaUpdatedAt: ((before.proforma?.updated_at as number) ?? 1) - 1,
    });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("stale_version");
    expect(await snapshot(pf.id)).toEqual(before);
  });

  it("Staff is 403 (no row of the matrix), the accountant and Sales too; the Owner without a fresh code is 403 step_up_required", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const before = await snapshot(pf.id);
    for (const role of ["staff", "accountant", "sales"] as const) {
      const s = await sessionFor(role, { stepUp: true });
      const res = await call(`/invoices/${pf.id}/advance-invoice`, {
        cookie: s.cookie,
        body: await advanceBody(pf.id),
      });
      expect(res.status, role).toBe(403);
    }
    const noCode = await sessionFor("owner", { stepUp: false });
    const res = await call(`/invoices/${pf.id}/advance-invoice`, {
      cookie: noCode.cookie,
      body: await advanceBody(pf.id),
    });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("step_up_required");
    expect(await snapshot(pf.id)).toEqual(before);
  });

  it("a request that names a field the route does not know, a zero amount, a non-integer, or a bad date is 400", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    for (const over of [
      { extra: 1 },
      { amountMinor: 0 },
      { amountMinor: -5 },
      { amountMinor: 1.5 },
      { receivedOn: "2026-02-30" },
      { reference: "" },
      { fx: { rate: "1", date: "2026-10-01" } },
      { confirmInrExport: false },
    ]) {
      const res = await advance(o, pf.id, over);
      expect(res.status, JSON.stringify(over)).toBe(400);
    }
    expect((await advance(o, pf.id, { reference: "a_b" })).status).toBe(400); // not letters, digits, / and -
    expect((await advance(o, pf.id, { reference: "x".repeat(81) })).status).toBe(400);
    expect(await receipts(pf.id)).toEqual([]);
  });

  it("the day the money arrived: not in the future (IST), not before the proforma was issued, and an earlier month only warns", async () => {
    const o = await farSession();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2030, 5, 10, 6, 0, 0) });
    const pf = await issuedProforma(o);
    const before = await snapshot(pf.id);
    const tomorrow = await advance(o, pf.id, { receivedOn: "2030-06-11" });
    expect(tomorrow.status).toBe(400);
    expect(await codeOf(tomorrow)).toBe("advance_date_invalid");
    const early = await advance(o, pf.id, { receivedOn: "2030-06-09" });
    expect(early.status).toBe(400);
    expect(await codeOf(early)).toBe("advance_date_invalid");
    expect(await snapshot(pf.id)).toEqual(before);
    // the proforma's own day is fine, and carries no warning
    const same = await advance(o, pf.id, { receivedOn: "2030-06-10", amountMinor: 10_000 });
    expect(same.status, await same.clone().text()).toBe(201);
    expect((await json(same)).warnings).toEqual([]);
    // a payment of an earlier month than today: allowed, with the warning (Q27; Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17), s.13(2))
    vi.setSystemTime(Date.UTC(2030, 6, 5, 6, 0, 0));
    await renew(o);
    const late = await advance(o, pf.id, { receivedOn: "2030-06-30", amountMinor: 10_000 });
    expect(late.status, await late.clone().text()).toBe(201);
    const lateBody = await json(late);
    expect(lateBody.warnings).toEqual(["advance_previous_period"]);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'invoice.advance_issue' AND entity_id = ?",
      lateBody.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}").warnings).toEqual(["advance_previous_period"]);
  });

  it("an anonymised client takes nothing new: 409 client_anonymised", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    await env.DB.prepare("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1")
      .bind(pf.clientId, Date.now())
      .run();
    const before = await snapshot(pf.id);
    const res = await advance(o, pf.id);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("client_anonymised");
    expect(await snapshot(pf.id)).toEqual(before);
  });

  it("the blockers of the invoice itself apply (the company details, the SAC of every line), but no bank block is needed: it is paid", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    await env.DB.prepare("UPDATE bank_accounts SET active = 0").run();
    const ok = await advance(o, pf.id, { amountMinor: 10_000 });
    expect(ok.status, await ok.clone().text()).toBe(201);
    await putBank();
    await putSwiftBank();
    // a company without a GSTIN is blocked, and the answer lists it
    await putCompany({ gstin: null });
    const before = await snapshot(pf.id);
    const res = await advance(o, pf.id, { amountMinor: 10_000 });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("issue_blocked");
    expect((body.blockers as J[]).map((b) => b.code)).toContain("supplier_gstin");
    expect(await snapshot(pf.id)).toEqual(before);
  });

  it("a setting that changes between the read and the batch refuses it (settings_changed), and nothing is written", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const before = await snapshot(pf.id);
    const res = await call(
      `/invoices/${pf.id}/advance-invoice`,
      { cookie: o.cookie, body: await advanceBody(pf.id) },
      beforeBatchHolding("issue_guard", async () => {
        await putTax({ luts: [lutOf(currentFy())], fxMaxAgeDays: 5 });
      }),
    );
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await codeOf(res)).toBe("settings_changed");
    expect(await snapshot(pf.id)).toEqual(before);
  });
});

// ---- a proforma for an overseas client ------------------------------------------------------------------------------------------------------

describe("an overseas proforma gives an export invoice [LUT rule, FX, Q8]", () => {
  const usd = (over: Record<string, unknown> = {}) => ({
    fx: { rate: "83.1234", date: todayIso(), source: "FBIL" },
    ...over,
  });

  it("TH/EXP with the proforma's route, the rate of the day the money arrived, the INR view; the proforma converts", async () => {
    const o = await owner();
    const pf = await issuedProforma(o, { overseas: true, price: 1_000_000 });
    const res = await advance(o, pf.id, usd({ amountMinor: 50_000 }));
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    expect(b.type).toBe("export_invoice");
    expect(b.number).toMatch(/^TH\/EXP\/\d{4}\/\d{4}$/);
    expect(await typesRow(b.id)).toMatchObject({
      type: "export_invoice",
      status: "paid",
      series: "export",
      parent_id: pf.id,
      fx_rate_micros: 83_123_400,
      fx_date: todayIso(),
      fx_source: "FBIL reference rate",
      balance_minor: 0,
    });
    expect(Number((await typesRow(b.id))?.total_inr_minor)).toBeGreaterThan(0);
    expect(await typesRow(pf.id)).toMatchObject({ status: "converted", paid_minor: 50_000 });
    const { issuer } = await frozenBlocks(b.id);
    expect(issuer.bank.swift).toMatchObject({ purposeCode: "P0802" });
    // sealed with its LUT, its country and its advance header, and the rate from its own columns
    const check = await sealCheck(b.id, {
      export: {
        mode: "lut",
        endorsement:
          "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX",
        lut: { fy: currentFy(), arn: LUT_ARN },
        countryCode: "US",
        countryName: "United States",
        declarationRef: null,
      },
      advance: {
        proformaId: pf.id,
        proformaNumber: pf.number,
        proformaIssueDate: todayIso(),
        receivedOn: todayIso(),
        receiptId: b.receiptId,
      },
    });
    expect(check).toEqual({ content: true, snapshot: true });
  });

  it("the rate is required for USD, judged against the day the money arrived (not today): fx_missing and fx_date_invalid carry that day", async () => {
    const o = await owner();
    const pf = await issuedProforma(o, { overseas: true, price: 1_000_000 });
    const before = await snapshot(pf.id);
    const none = await advance(o, pf.id, { amountMinor: 50_000 });
    expect(none.status).toBe(409);
    expect((await json(none)).blockers as J[]).toEqual([{ code: "fx_missing", date: todayIso() }]);
    // Q24 (owner 2026-10-28, RA-21): the rate of the day the money arrived. A rate of an EARLIER day without the statement "no rate was published that day" is 400 fx_same_day_exists
    // (use that day's rate), however old; with the statement it must be at most `fxMaxAgeDays` (4) older, else 400 fx_date_invalid; a later day is fx_date_invalid whatever is said.
    const day = (n: number) =>
      new Date(Date.parse(`${todayIso()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const noStatement = await advance(
      o,
      pf.id,
      usd({ amountMinor: 50_000, fx: { rate: "83.1234", date: day(-1), source: "FBIL" } }),
    );
    expect(noStatement.status).toBe(400);
    const nb = await json(noStatement);
    expect(nb.error.code).toBe("fx_same_day_exists");
    expect(nb.error.message).toMatch(/^A rate was published on \d{2} \w{3} \d{4}, so use that day's rate\.$/);
    const flagFalse = await advance(
      o,
      pf.id,
      usd({
        amountMinor: 50_000,
        fx: { rate: "83.1234", date: day(-1), source: "FBIL", noRateThatDay: false },
      }),
    );
    expect(await codeOf(flagFalse)).toBe("fx_same_day_exists");
    const old = await advance(
      o,
      pf.id,
      usd({
        amountMinor: 50_000,
        fx: { rate: "83.1234", date: day(-5), source: "FBIL", noRateThatDay: true },
      }),
    );
    expect(old.status).toBe(400);
    const ob = await json(old);
    expect(ob.error.code).toBe("fx_date_invalid");
    expect(ob.error.message).toMatch(
      /^Use the rate published on \d{2} \w{3} \d{4}\. If none was published that day, use the last one published before it, at most 4 days earlier\.$/,
    );
    for (const noRateThatDay of [true, false]) {
      const future = await advance(
        o,
        pf.id,
        usd({
          amountMinor: 50_000,
          fx: { rate: "83.1234", date: day(1), source: "FBIL", noRateThatDay },
        }),
      );
      expect(future.status).toBe(400);
      expect(await codeOf(future)).toBe("fx_date_invalid");
    }
    expect(await snapshot(pf.id)).toEqual(before);
    // with the statement, four days older is the limit and is accepted; the flag is stored with the rate and sealed
    const four = await advance(
      o,
      pf.id,
      usd({
        amountMinor: 10_000,
        fx: { rate: "83.1234", date: day(-4), source: "FBIL", noRateThatDay: true },
      }),
    );
    expect(four.status, await four.clone().text()).toBe(201);
    const fourId = (await json(four)).id;
    expect((await typesRow(fourId))?.fx_no_rate_day).toBe(todayIso()); // the day the money arrived
    expect(await sealCheck(fourId)).toEqual({ content: true, snapshot: true });
    const view = await getInvoice(o, fourId);
    expect(view.fx.value).toMatchObject({ noRateThatDay: true, noRateDay: todayIso(), date: day(-4) });
    // the rate is judged against the day the money arrived: a rate of that day is fine even if today is later
    const received = day(0);
    expect(
      (
        await advance(
          o,
          pf.id,
          usd({
            amountMinor: 50_000,
            receivedOn: received,
            fx: { rate: "83.1234", date: received, source: "RBI" },
          }),
        )
      ).status,
    ).toBe(201);
  });

  it("an INR client cannot be given a rate: 400 fx_not_applicable", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const res = await advance(o, pf.id, usd());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("fx_not_applicable");
  });

  it("the LUT rule applies: without this year's letter the export invoice is blocked (lut_missing with the FY); the IGST route of the proforma needs none", async () => {
    const o = await owner();
    const pf = await issuedProforma(o, { overseas: true, price: 1_000_000 });
    await putTax({ luts: [] });
    const before = await snapshot(pf.id);
    const res = await advance(o, pf.id, usd({ amountMinor: 50_000 }));
    expect(res.status).toBe(409);
    // Q37 (2026-10-28): the LUT of the FY of the day the money arrived is judged first, and the refusal names that FY (details.fy)
    const refused = await json(res);
    expect((refused.error as J).code).toBe("advance_lut_missing");
    expect((refused.error as J).details).toEqual({ fy: fyOf(Date.now()).label });
    expect(await snapshot(pf.id)).toEqual(before);
    // a proforma made for the IGST route keeps it for its advance invoice
    const igst = await mkProforma(o, { client: mkOverseasClient });
    const doc = await getInvoice(o, igst.id);
    expect(
      (
        await patchInvoice(o, igst.id, {
          expectedUpdatedAt: doc.updatedAt,
          fields: { exportMode: "igst_paid" },
        })
      ).status,
    ).toBe(200);
    expect((await issueInvoice(o, igst.id)).status).toBe(200);
    const ok = await advance(o, igst.id, usd({ amountMinor: 5_000 }));
    expect(ok.status, await ok.clone().text()).toBe(201);
    expect(await typesRow((await json(ok)).id)).toMatchObject({ export_mode: "igst_paid" });
  });

  it("an INR export (an overseas client invoiced in INR) needs the Owner's confirmation, like any export in INR", async () => {
    const o = await owner();
    const c = await mkInvoiceClient({
      country: "US",
      gst_status: "overseas",
      state_code: null,
      currency: "INR",
      billing_address: JSON.stringify({ line1: "1 Main St", city: "Austin", country: "US" }),
    });
    const made = await mkProforma(o, { clientId: c.clientId });
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const before = await snapshot(made.id);
    const refused = await advance(o, made.id, { amountMinor: 59_000 });
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe("export_currency_confirm");
    expect(await snapshot(made.id)).toEqual(before);
    const ok = await advance(o, made.id, { amountMinor: 59_000, confirmInrExport: true });
    expect(ok.status, await ok.clone().text()).toBe(201);
    const okBody = await json(ok);
    expect(okBody.type).toBe("export_invoice");
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'invoice.advance_issue' AND entity_id = ?",
      okBody.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({ inrExportConfirmed: true });
  });
});

// ---- after it --------------------------------------------------------------------------------------------------------------------------------

describe("what a converted proforma and its invoice cannot do [Q1, LD22]", () => {
  it("the converted proforma cannot be voided, nor can the paid invoice (it has a payment); a Staff request to issue is not involved", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const made = await advance(o, pf.id, { amountMinor: 59_000 });
    const inv = await json(made);
    const v1 = await voidInvoice(o, pf.id);
    expect(v1.status).toBe(409);
    expect((await json(v1)).reasons as string[]).toContain("not_issued");
    const v2 = await voidInvoice(o, inv.id);
    expect(v2.status).toBe(409);
    const body = await json(v2);
    expect(body.reasons).toEqual(expect.arrayContaining(["not_issued", "has_payment"]));
    expect(await typesRow(inv.id)).toMatchObject({ status: "paid" });
    expect(await typesRow(pf.id)).toMatchObject({ status: "converted" });
    // an overdue check never chases the paid invoice
    const view = await getInvoice(o, inv.id);
    expect(view.overdue).toBe(false);
    expect(view.balanceMinor).toBe(0);
  });

  it("a proforma with a payment against it cannot be voided; one without can be, until it is converted", async () => {
    const o = await owner();
    const free = await issuedProforma(o);
    expect((await voidInvoice(o, free.id)).status).toBe(200);
    const paid = await issuedProforma(o);
    expect((await advance(o, paid.id, { amountMinor: 10_000 })).status).toBe(201);
    expect((await voidInvoice(o, paid.id)).status).toBe(409);
  });
});

// ---- the proforma decides the route and the words (code review of M5.2) ----------------------------------------------------------------------------

describe("the invoice for money received keeps the PROFORMA's export route [review 1; Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17)]", () => {
  const usd = (over: Record<string, unknown> = {}) => ({
    fx: { rate: "83.1234", date: todayIso(), source: "FBIL" },
    ...over,
  });
  const taxOf = (id: string) =>
    one<{ igst_minor: number; taxable_minor: number; total_minor: number; export_mode: string | null }>(
      "SELECT igst_minor, taxable_minor, total_minor, export_mode FROM documents WHERE id = ?",
      id,
    );

  it("a proforma issued under the LUT setting stays zero-rated under LUT when Settings moves to IGST before the money arrives", async () => {
    const o = await owner();
    await putTax({ luts: [lutOf(currentFy())], exportMode: "lut" });
    const pf = await issuedProforma(o, { overseas: true, price: 1_000_000 });
    // the proforma never picked a route: it is the engine's route of the issue day that must carry over
    expect((await typesRow(pf.id))?.export_mode).toBeNull();
    await putTax({ luts: [lutOf(currentFy())], exportMode: "igst_paid" });
    const res = await advance(o, pf.id, usd({ amountMinor: 100_000 }));
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    expect(await taxOf(b.id)).toEqual({
      igst_minor: 0,
      taxable_minor: 100_000,
      total_minor: 100_000,
      export_mode: "lut",
    });
    const check = await sealCheck(b.id, {
      export: {
        mode: "lut",
        endorsement: ENDORSEMENT.lut,
        lut: { fy: currentFy(), arn: LUT_ARN },
        countryCode: "US",
        countryName: "United States",
        declarationRef: null,
      },
      advance: {
        proformaId: pf.id,
        proformaNumber: pf.number,
        proformaIssueDate: todayIso(),
        receivedOn: todayIso(),
        receiptId: b.receiptId,
      },
    });
    expect(check).toEqual({ content: true, snapshot: true });
  });

  it("a proforma issued under IGST stays IGST when Settings moves to LUT, and needs no LUT letter", async () => {
    const o = await owner();
    await putTax({ luts: [], exportMode: "igst_paid" });
    const pf = await issuedProforma(o, { overseas: true, price: 1_000_000 });
    expect((await typesRow(pf.id))?.export_mode).toBeNull();
    await putTax({ luts: [], exportMode: "lut" });
    const res = await advance(o, pf.id, usd({ amountMinor: 100_000 }));
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    const row = await taxOf(b.id);
    expect(row?.export_mode).toBe("igst_paid");
    expect(row?.igst_minor).toBeGreaterThan(0);
    expect(row?.total_minor).toBe(100_000);
    const check = await sealCheck(b.id, {
      export: {
        mode: "igst_paid",
        endorsement: ENDORSEMENT.igst_paid,
        lut: null,
        countryCode: "US",
        countryName: "United States",
        declarationRef: null,
      },
      advance: {
        proformaId: pf.id,
        proformaNumber: pf.number,
        proformaIssueDate: todayIso(),
        receivedOn: todayIso(),
        receiptId: b.receiptId,
      },
    });
    expect(check).toEqual({ content: true, snapshot: true });
    await putTax({ luts: [lutOf(currentFy())] });
  });

  it("a domestic proforma has no route and the invoice carries none, whatever Settings says", async () => {
    const o = await owner();
    await putTax({ luts: [lutOf(currentFy())], exportMode: "igst_paid" });
    const pf = await issuedProforma(o);
    const res = await advance(o, pf.id, { amountMinor: 59_000 });
    expect(res.status, await res.clone().text()).toBe(201);
    expect((await taxOf((await json(res)).id))?.export_mode).toBeNull();
    await putTax({ luts: [lutOf(currentFy())] });
  });
});

describe("the rate date of a frozen invoice made for money received [review 6]", () => {
  it("is judged against the day the money arrived, not the issue day: a valid sealed USD invoice never reads as out of date", async () => {
    const o = await farSession();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2030, 5, 10, 6, 0, 0) });
    await putTax({ luts: [lutOf(currentFy())] });
    const pf = await issuedProforma(o, { overseas: true, price: 1_000_000 });
    // the money arrived on 30 June, the invoice is made on 5 July (more days after the rate than `fxMaxAgeDays`)
    vi.setSystemTime(Date.UTC(2030, 6, 5, 6, 0, 0));
    await renew(o);
    const res = await advance(o, pf.id, {
      amountMinor: 100_000,
      receivedOn: "2030-06-30",
      fx: { rate: "83.1234", date: "2030-06-28", source: "FBIL", noRateThatDay: true },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const view = await getInvoice(o, (await json(res)).id);
    expect(view.fx).toMatchObject({ applies: true, refDate: "2030-06-30", dateOk: null });
    // review 2 (finding 8): a frozen invoice was judged at issue, so no live window applies to it (null, never a false)
    // a draft is still judged against today
    const draft = await mkExportDraft(o);
    expect((await getInvoice(o, draft.id)).fx.refDate).toBe("2030-07-05");
  });
});

describe("the words of the invoice for money received [review 2, decision 10; 07-S §8]", () => {
  it("every frozen line reads 'Payment received against proforma {number}'", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const res = await advance(o, pf.id, { amountMinor: 59_000 });
    expect(res.status, await res.clone().text()).toBe(201);
    const lines = await rows(
      "SELECT description FROM document_lines WHERE document_id = ? ORDER BY position",
      (await json(res)).id,
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.description).toBe(`Payment received against proforma ${pf.number}`);
    expect(advanceLineDescription("TH/PI/2026/0001")).toBe(
      "Payment received against proforma TH/PI/2026/0001",
    );
  });

  it("an export invoice for money received pins the newest extra export note with its frozen text; a tax invoice never carries one", async () => {
    const o = await owner();
    const pfExport = await issuedProforma(o, { overseas: true, price: 1_000_000 });
    const pfTax = await issuedProforma(o);
    const id = "00000000-0000-7000-8000-0000000000e1";
    const text = "Payment to be made in USD by wire transfer only.";
    const sha = await sha256Hex(text);
    await env.DB.prepare(
      "INSERT INTO terms_blocks (id, kind, version, body_md, sha256) VALUES (?1, 'export_declaration', 200, ?2, ?3)",
    )
      .bind(id, text, sha)
      .run();
    const res = await advance(o, pfExport.id, {
      amountMinor: 100_000,
      fx: { rate: "83.1234", date: todayIso(), source: "FBIL" },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    expect(await typesRow(b.id)).toMatchObject({ export_declaration_id: id });
    const check = await sealCheck(b.id, {
      export: {
        mode: "lut",
        endorsement: ENDORSEMENT.lut,
        lut: { fy: currentFy(), arn: LUT_ARN },
        countryCode: "US",
        countryName: "United States",
        declarationRef: { id, version: 200, sha256: sha },
        declarationText: text,
      },
      advance: {
        proformaId: pfExport.id,
        proformaNumber: pfExport.number,
        proformaIssueDate: todayIso(),
        receivedOn: todayIso(),
        receiptId: b.receiptId,
      },
    });
    expect(check).toEqual({ content: true, snapshot: true });
    // the text is frozen: a newer note afterwards changes nothing
    await env.DB.prepare(
      "INSERT INTO terms_blocks (id, kind, version, body_md, sha256) VALUES ('00000000-0000-7000-8000-0000000000e2', 'export_declaration', 201, 'Later', ?1)",
    )
      .bind(await sha256Hex("Later"))
      .run();
    expect((await sealCheck(b.id))?.snapshot).toBe(true);
    // a tax invoice has no export part, so no note
    const tax = await advance(o, pfTax.id, { amountMinor: 59_000 });
    expect(tax.status, await tax.clone().text()).toBe(201);
    expect((await typesRow((await json(tax)).id))?.export_declaration_id).toBeNull();
  });

  it("a note whose text no longer matches its SHA-256 is refused with export_declaration_tampered, and nothing is written", async () => {
    const o = await owner();
    const pf = await issuedProforma(o, { overseas: true, price: 1_000_000 });
    await env.DB.prepare(
      "INSERT INTO terms_blocks (id, kind, version, body_md, sha256) VALUES ('00000000-0000-7000-8000-0000000000e3', 'export_declaration', 300, 'Tampered text', ?1)",
    )
      .bind(await sha256Hex("The text that was approved"))
      .run();
    const before = await snapshot(pf.id);
    const res = await advance(o, pf.id, {
      amountMinor: 100_000,
      fx: { rate: "83.1234", date: todayIso(), source: "FBIL" },
    });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("export_declaration_tampered");
    expect(await snapshot(pf.id)).toEqual(before);
  });
});

describe("the draft's LUT line, the series preview [review 2, findings 3 and the designer's question 1]", () => {
  it("the LUT letter shows on the LUT route only: the IGST route has none even when the FY has a letter", async () => {
    const o = await owner();
    const d = await mkExportDraft(o);
    expect((await getInvoice(o, d.id)).export).toMatchObject({
      mode: "lut",
      lut: { fy: currentFy(), arn: LUT_ARN },
    });
    await putTax({ luts: [lutOf(currentFy())], exportMode: "igst_paid" });
    const igst = await getInvoice(o, d.id);
    expect(igst.export).toMatchObject({ mode: "igst_paid", lutRequired: false, lut: null });
    await putTax({ luts: [lutOf(currentFy())] });
  });

  it("issue.preview carries the series of the document's own type, with that series' format", async () => {
    const o = await owner();
    const pf = await mkProforma(o, { clientId: (await mkInvoiceClient()).clientId, price: 100_000 });
    const tax = await mkInvoice(o);
    const exp = await mkExportDraft(o);
    const fmt = async (series: string) =>
      (
        JSON.parse(
          (await one<{ value: string }>("SELECT value FROM settings WHERE key = 'numbering'"))?.value ?? "{}",
        ) as Record<string, { template: string }>
      )[series]?.template;
    for (const [id, series] of [
      [pf.id, "proforma"],
      [tax.id, "invoice"],
      [exp.id, "export"],
    ] as const) {
      const p = (await getInvoice(o, id)).issue.preview;
      expect(p.series).toBe(series);
      const stored = await fmt(series);
      if (stored) expect(p.template).toBe(stored);
    }
  });
});

describe("the client's GST status changed after the proforma [review 2, finding 6; Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17)]", () => {
  // the clients table keeps a state code for an Indian client and none for an overseas one, so the status and the state move together
  const setStatus = (clientId: string, status: "overseas" | "unregistered") =>
    env.DB.prepare("UPDATE clients SET gst_status = ?2, state_code = ?3 WHERE id = ?1")
      .bind(clientId, status, status === "overseas" ? null : "19")
      .run();

  it("a domestic proforma for a now-overseas client is refused 409 advance_supply_changed, and nothing is written", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    await setStatus(pf.clientId, "overseas");
    const view = await getInvoice(o, pf.id);
    expect(view.proforma.advanceSupplyChanged).toBe(true);
    const before = await snapshot(pf.id);
    const res = await advance(o, pf.id);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("advance_supply_changed");
    expect(await snapshot(pf.id)).toEqual(before);
  });

  it("an overseas proforma for a client who is no longer overseas is refused the same way", async () => {
    const o = await owner();
    const pf = await issuedProforma(o, { overseas: true, price: 1_000_000 });
    await setStatus(pf.clientId, "unregistered");
    expect((await getInvoice(o, pf.id)).proforma.advanceSupplyChanged).toBe(true);
    const before = await snapshot(pf.id);
    const res = await advance(o, pf.id, { fx: { rate: "83.1234", date: todayIso(), source: "FBIL" } });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("advance_supply_changed");
    expect(await snapshot(pf.id)).toEqual(before);
  });

  it("when the status still matches nothing is flagged, and the view's INR confirmation is the server's own (an INR export proforma asks, a domestic one does not)", async () => {
    const o = await owner();
    const dom = await issuedProforma(o);
    const domView = await getInvoice(o, dom.id);
    expect(domView.proforma).toMatchObject({ advanceSupplyChanged: false, advanceNeedsInrConfirm: false });
    const c = await mkInvoiceClient({
      country: "US",
      gst_status: "overseas",
      state_code: null,
      currency: "INR",
      billing_address: JSON.stringify({ line1: "1 Main St", city: "Austin", country: "US" }),
    });
    const made = await mkProforma(o, { clientId: c.clientId });
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const exp = made;
    const expView = await getInvoice(o, exp.id);
    expect(expView.currency).toBe("INR");
    expect(expView.proforma).toMatchObject({ advanceSupplyChanged: false, advanceNeedsInrConfirm: true });
    // and the route agrees: without the yes the INR export is refused, as the view said
    const res = await advance(o, exp.id, { amountMinor: 50_000 });
    expect(await codeOf(res)).toBe("export_currency_confirm");
  });
});
