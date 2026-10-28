// Issuing an invoice [ADM-INV-03, ADM-INV-07, ADM-APR-01, ADM-APR-02, LD5, LD6, LD8]: gap-free numbers under concurrency, the FY rollover in IST, who may
// issue, every refusal that must leave the counter, the audit log and the milestone untouched, the freeze, and the approval path.
// Researched 2026-10-28, Rule 46 CGST Rules (08-C RA-05) for every rule under test (Rule 46, Rule 47, Q3, Q4, Q6).
import { env } from "cloudflare:workers";
import { issueFyOf } from "@techaust/core/invoices";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ROUTES } from "./guard.ts";
import { mkContact as mkContact2, mkDoc } from "./test-clients.ts";
import { call, countOf, one, rows, sessionFor, withEnv } from "./test-helpers.ts";
import {
  auditCount,
  bumpSetting,
  codeOf,
  decideApproval,
  farSession,
  getInvoice,
  invoiceCounter,
  invoiceRow,
  issueBodyOf,
  issueInvoice,
  type J,
  json,
  mkInterClient,
  mkInvoice,
  mkInvoiceClient,
  mkReadyMilestone,
  patchInvoice,
  putBank,
  putCompany,
  requestIssue,
} from "./test-invoices.ts";
import { beforeBatchHolding } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const FY = issueFyOf(Date.now());

beforeAll(async () => {
  await putCompany();
  await putBank();
});
afterEach(() => vi.useRealTimers());

/** What a refusal must leave exactly as it was: the counter, the issue audit rows, the document and (with one) the milestone. */
async function snapshot(id: string, milestoneId?: string) {
  return {
    counter: await invoiceCounter(),
    audits: await auditCount("invoice.issue"),
    row: await invoiceRow(id),
    milestone: milestoneId
      ? await one("SELECT status, document_id, delivered_at FROM milestones WHERE id = ?", milestoneId)
      : null,
  };
}

describe("gap-free numbers [ADM-INV-03]", () => {
  it("20 issues at once get 20 consecutive numbers, none twice, 20 audit rows, the counter at 21", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push((await mkInvoice(o, { clientId: c.clientId })).id);
    const before = (await invoiceCounter()) ?? 1;
    const results = await Promise.all(ids.map((id) => issueInvoice(o, id)));
    for (const r of results) expect(r.status, await r.clone().text()).toBe(200);
    const numbers = (await Promise.all(results.map(async (r) => (await json(r)).number as string))).sort();
    const first = before;
    expect(numbers).toEqual(
      Array.from({ length: 20 }, (_, i) => `TH/INV/${FY}/${String(first + i).padStart(4, "0")}`),
    );
    expect(new Set(numbers).size).toBe(20);
    expect(await invoiceCounter()).toBe(first + 20);
    expect(await auditCount("invoice.issue")).toBe(20);
    for (const id of ids) expect(await auditCount("invoice.issue", id)).toBe(1);
  });

  it("20 at once where 5 send a stale updatedAt: the other 15 are numbered without a gap, and the five leave nothing", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push((await mkInvoice(o, { clientId: c.clientId })).id);
    const before = (await invoiceCounter()) ?? 1;
    const auditsBefore = await auditCount("invoice.issue");
    const results = await Promise.all(
      ids.map(async (id, i) => {
        const body = await issueBodyOf(id);
        return issueInvoice(
          o,
          id,
          i % 4 === 3 ? { ...body, expectedUpdatedAt: (body.expectedUpdatedAt as number) - 1 } : body,
        );
      }),
    );
    const stale = results.filter((r) => r.status === 409);
    expect(stale).toHaveLength(5);
    for (const r of stale) expect(await codeOf(r)).toBe("stale_version");
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(15);
    const numbers = (await Promise.all(ok.map(async (r) => (await json(r)).number as string))).sort();
    expect(numbers).toEqual(
      Array.from({ length: 15 }, (_, i) => `TH/INV/${FY}/${String(before + i).padStart(4, "0")}`),
    );
    expect(await invoiceCounter()).toBe(before + 15);
    expect(await auditCount("invoice.issue")).toBe(auditsBefore + 15);
  });

  it("issuing the same invoice twice answers 409 already_issued with its number (LD8), and the counter does not move", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const first = await issueInvoice(o, made.id);
    expect(first.status).toBe(200);
    const number = (await json(first)).number;
    const counter = await invoiceCounter();
    const again = await issueInvoice(o, made.id, {
      expectedUpdatedAt: made.updatedAt,
      expectedContentSha256: made.contentSha256,
    });
    expect(again.status).toBe(409);
    const body = await json(again);
    expect(body.error.code).toBe("already_issued");
    expect(body.number).toBe(number);
    expect(await invoiceCounter()).toBe(counter);
    expect(await auditCount("invoice.issue", made.id)).toBe(1);
  });
});

describe("the financial year and the IST day [ADM-INV-03, Q3, LD19]", () => {
  it("31 March 23:59:59.999 IST is still 2026-27; 1 April 00:00 IST is 2027-28 and starts at 0001; each number is at most 16 characters", async () => {
    const o = await farSession();
    const c = await mkInvoiceClient();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2027, 2, 31, 18, 29, 0, 0) });
    const a = await mkInvoice(o, { clientId: c.clientId });
    const b = await mkInvoice(o, { clientId: c.clientId });
    const lastMs = Date.UTC(2027, 2, 31, 18, 29, 59, 999);
    vi.setSystemTime(lastMs);
    const ra = await issueInvoice(o, a.id);
    expect(ra.status, await ra.clone().text()).toBe(200);
    const na = (await json(ra)).number as string;
    expect(na).toMatch(/^TH\/INV\/2627\/\d{4}$/);
    expect(await invoiceRow(a.id)).toMatchObject({
      issue_date: "2027-03-31",
      due_date: "2027-04-07",
      fy: "2627",
    });
    vi.setSystemTime(lastMs + 1); // 1 April 2027, 00:00:00.000 IST
    const rb = await issueInvoice(o, b.id);
    expect(rb.status, await rb.clone().text()).toBe(200);
    const nb = (await json(rb)).number as string;
    expect(nb).toBe("TH/INV/2728/0001");
    expect(await invoiceRow(b.id)).toMatchObject({
      issue_date: "2027-04-01",
      due_date: "2027-04-08",
      fy: "2728",
    });
    expect(na.length).toBeLessThanOrEqual(16);
    expect(nb.length).toBeLessThanOrEqual(16);
    expect(await invoiceCounter("2728")).toBe(2);
  });

  it("the due date follows the client's own terms, else the settings' Net 7", async () => {
    const o = await owner();
    const c = await mkInvoiceClient({ payment_terms_days: 30 });
    const made = await mkInvoice(o, { clientId: c.clientId });
    const res = await issueInvoice(o, made.id);
    expect(res.status).toBe(200);
    const b = await json(res);
    const days = (Date.parse(`${b.dueDate}T00:00:00Z`) - Date.parse(`${b.issueDate}T00:00:00Z`)) / 86_400_000;
    expect(days).toBe(30);
    const d = await mkInvoice(o);
    const r = await json(await issueInvoice(o, d.id));
    expect((Date.parse(`${r.dueDate}T00:00:00Z`) - Date.parse(`${r.issueDate}T00:00:00Z`)) / 86_400_000).toBe(
      7,
    );
  });
});

describe("who may issue [ADM-INV-03, ADM-AUTH-08, ADM-APR-01]", () => {
  it("the owner without a step-up is 403 step_up_required and the counter does not move; with a step-up it issues", async () => {
    const o = await sessionFor("owner"); // no step-up
    const made = await mkInvoice(o);
    const before = await snapshot(made.id);
    const refused = await issueInvoice(o, made.id);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("step_up_required");
    expect(await snapshot(made.id)).toEqual(before);
    const stepped = await owner();
    const ok = await issueInvoice(stepped, made.id);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await invoiceRow(made.id)).toMatchObject({ status: "issued", issued_by: stepped.id });
  });

  it("the step-up is checked INSIDE the statement: one that ends between the read and the batch is 403 and writes nothing", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const before = await snapshot(made.id);
    const res = await call(
      `/invoices/${made.id}/issue`,
      { cookie: o.cookie, body: await issueBodyOf(made.id) },
      beforeBatchHolding("issue_guard", async () => {
        // (long past, not "a millisecond ago": the route's instant is taken before this hook runs, so a 1 ms margin is a race under load)
        await env.DB.prepare("UPDATE staff_sessions SET step_up_until = ?2 WHERE id = ?1")
          .bind(o.sessionId, 1)
          .run();
      }),
    );
    expect(res.status, await res.clone().text()).toBe(403);
    expect(await codeOf(res)).toBe("step_up_required");
    expect(await snapshot(made.id)).toEqual(before);
    // a revoked session is the same: nothing is written
    const fresh = await owner();
    const again = await mkInvoice(fresh);
    const b2 = await snapshot(again.id);
    const r2 = await call(
      `/invoices/${again.id}/issue`,
      { cookie: fresh.cookie, body: await issueBodyOf(again.id) },
      beforeBatchHolding("issue_guard", async () => {
        await env.DB.prepare("UPDATE staff_sessions SET revoked_at = ?2 WHERE id = ?1")
          .bind(fresh.sessionId, Date.now())
          .run();
      }),
    );
    expect(r2.status).toBeGreaterThanOrEqual(400);
    expect(await snapshot(again.id)).toEqual(b2);
  });

  it("Staff is 403 approval_required; Sales and the accountant are 403; nothing is written", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const before = await snapshot(made.id);
    const staff = await sessionFor("staff", { stepUp: true });
    const s = await issueInvoice(staff, made.id);
    expect(s.status).toBe(403);
    expect(await codeOf(s)).toBe("approval_required");
    for (const role of ["sales", "accountant"] as const) {
      const r = await issueInvoice(await sessionFor(role, { stepUp: true }), made.id);
      expect(r.status, role).toBe(403);
      expect(await codeOf(r), role).toBe("forbidden");
    }
    expect(await snapshot(made.id)).toEqual(before);
  });

  it("a Staff request is 201 (the owners' bell rings); the owner issuing directly gets 409 issue_directly on a request", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const made = await mkInvoice(staff);
    const req = await requestIssue(staff, made.id, "Please issue");
    expect(req.status, await req.clone().text()).toBe(201);
    const id = (await json(req)).id as string;
    expect(await one("SELECT kind, status, requested_by FROM approvals WHERE id = ?", id)).toEqual({
      kind: "issue",
      status: "pending",
      requested_by: staff.id,
    });
    expect(
      await countOf(
        "notifications",
        "entity_id = ? AND user_id = ? AND kind = 'approval.requested'",
        id,
        o.id,
      ),
    ).toBe(1);
    expect(await auditCount("approval.request", id)).toBe(1);
    // a second request for the same content is a 409; the owner is told to issue directly
    expect(await codeOf(await requestIssue(staff, made.id))).toBe("approval_pending");
    const direct = await requestIssue(o, made.id);
    expect(direct.status).toBe(409);
    expect(await codeOf(direct)).toBe("issue_directly");
  });

  it("a request needs a draft with no blockers, an issuable type and fresh content", async () => {
    const staff = await sessionFor("staff");
    const c = await mkInvoiceClient();
    const empty = (
      await json(await call("/invoices", { cookie: staff.cookie, body: { clientId: c.clientId } }))
    ).id as string;
    const blocked = await requestIssue(staff, empty);
    expect(blocked.status).toBe(409);
    expect(await codeOf(blocked)).toBe("issue_blocked");
    // M5.3: a quote is not an invoice at all (a credit note used to answer type_not_issuable here; notes issue and request through invoice-notes.test.ts, changed on purpose).
    const quote = await mkDoc(c.clientId, "proposal");
    expect((await requestIssue(staff, quote)).status).toBe(404);
    const made = await mkInvoice(staff);
    const stale = await call(`/invoices/${made.id}/issue-request`, {
      cookie: staff.cookie,
      body: { expectedUpdatedAt: made.updatedAt - 1 },
    });
    expect(await codeOf(stale)).toBe("stale_version");
    // Sales and the accountant cannot draft, so they cannot ask
    for (const role of ["sales", "accountant"] as const)
      expect((await requestIssue(await sessionFor(role), made.id)).status, role).toBe(403);
  });

  it("approving without a step-up is 403; with one, the invoice is issued and the request approved in ONE batch, and the requester is told", async () => {
    const staff = await sessionFor("staff");
    const made = await mkInvoice(staff);
    const reqId = (await json(await requestIssue(staff, made.id))).id as string;
    const plain = await sessionFor("owner");
    const refused = await decideApproval(plain, reqId, "approve");
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("step_up_required");
    expect(await invoiceRow(made.id)).toMatchObject({ status: "draft", number: null });
    const o = await owner();
    const before = (await invoiceCounter()) ?? 1;
    const res = await decideApproval(o, reqId, "approve", "Fine");
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await json(res);
    expect(body.number).toBe(`TH/INV/${FY}/${String(before).padStart(4, "0")}`);
    expect(await invoiceRow(made.id)).toMatchObject({ status: "issued", issued_by: o.id, number: before });
    expect(await one("SELECT status, decided_by, note FROM approvals WHERE id = ?", reqId)).toEqual({
      status: "approved",
      decided_by: o.id,
      note: "Fine",
    });
    expect(
      await countOf(
        "notifications",
        "entity_id = ? AND user_id = ? AND kind = 'approval.decided'",
        reqId,
        staff.id,
      ),
    ).toBe(1);
    // the approval's audit row, and the invoice's own `invoice.issue` row
    expect(await auditCount("approval.decide", reqId)).toBe(1);
    expect(await auditCount("invoice.issue", made.id)).toBe(1);
    expect(await invoiceCounter()).toBe(before + 1);
  });

  it("rejecting leaves the draft exactly as it was, tells the requester, and takes no step-up", async () => {
    const staff = await sessionFor("staff");
    const made = await mkInvoice(staff);
    const reqId = (await json(await requestIssue(staff, made.id))).id as string;
    const o = await sessionFor("owner"); // no step-up needed to reject
    const before = await snapshot(made.id);
    const res = await decideApproval(o, reqId, "reject", "Not yet");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await one("SELECT status, decided_by, note FROM approvals WHERE id = ?", reqId)).toEqual({
      status: "rejected",
      decided_by: o.id,
      note: "Not yet",
    });
    expect((await snapshot(made.id)).row).toEqual(before.row);
    expect((await snapshot(made.id)).counter).toBe(before.counter);
    expect(
      await countOf(
        "notifications",
        "entity_id = ? AND user_id = ? AND kind = 'approval.decided'",
        reqId,
        staff.id,
      ),
    ).toBe(1);
    // decided already: 409
    expect(await codeOf(await decideApproval(o, reqId, "reject"))).toBe("approval_decided");
    // and the draft can be requested again (the old request is closed)
    expect((await requestIssue(staff, made.id)).status).toBe(201);
  });

  it("an edit after the request expires it; approving it is 409 approval_expired and issues nothing", async () => {
    const staff = await sessionFor("staff");
    const made = await mkInvoice(staff);
    const reqId = (await json(await requestIssue(staff, made.id))).id as string;
    const doc = await getInvoice(staff, made.id);
    const edit = await patchInvoice(staff, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      fields: { discount: { kind: "fixed", value: 100 } },
    });
    expect(edit.status).toBe(200);
    expect(await one("SELECT status FROM approvals WHERE id = ?", reqId)).toEqual({ status: "expired" });
    const o = await owner();
    const before = await snapshot(made.id);
    const res = await decideApproval(o, reqId, "approve");
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("approval_expired");
    expect((await snapshot(made.id)).row).toMatchObject({ status: "draft" });
    expect((await snapshot(made.id)).counter).toBe(before.counter);
    expect(await auditCount("invoice.issue", made.id)).toBe(0);
  });

  it("two approves at once issue exactly one invoice", async () => {
    const staff = await sessionFor("staff");
    const made = await mkInvoice(staff);
    const reqId = (await json(await requestIssue(staff, made.id))).id as string;
    const o = await owner();
    const before = (await invoiceCounter()) ?? 1;
    const [a, b] = await Promise.all([
      decideApproval(o, reqId, "approve"),
      decideApproval(o, reqId, "approve"),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await invoiceCounter()).toBe(before + 1);
    expect(await auditCount("invoice.issue", made.id)).toBe(1);
  });

  it("an owner who issues directly while a request is waiting closes the request as approved, and the requester is told", async () => {
    const staff = await sessionFor("staff");
    const made = await mkInvoice(staff);
    const reqId = (await json(await requestIssue(staff, made.id))).id as string;
    const o = await owner();
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    expect(await one("SELECT status, decided_by FROM approvals WHERE id = ?", reqId)).toEqual({
      status: "approved",
      decided_by: o.id,
    });
    expect(await countOf("notifications", "entity_id = ? AND user_id = ?", reqId, staff.id)).toBe(1);
  });

  it("the approvals list takes a kind; Staff sees only their own requests", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const other = await sessionFor("staff");
    const a = await mkInvoice(staff);
    const b = await mkInvoice(other);
    const ra = (await json(await requestIssue(staff, a.id))).id as string;
    const rb = (await json(await requestIssue(other, b.id))).id as string;
    const all = await json(await call("/approvals?kind=issue&status=pending", { cookie: o.cookie }));
    const ids = all.approvals.map((x: J) => x.id);
    expect(ids).toContain(ra);
    expect(ids).toContain(rb);
    expect(all.approvals.every((x: J) => x.kind === "issue")).toBe(true);
    expect(all.approvals.find((x: J) => x.id === ra)).toMatchObject({
      state: "pending",
      document: { id: a.id, type: "tax_invoice" },
    });
    const mine = await json(await call("/approvals?kind=issue", { cookie: staff.cookie }));
    expect(mine.approvals.map((x: J) => x.id)).toEqual([ra]);
    // the default list is still the discount requests only
    const discount = await json(await call("/approvals", { cookie: o.cookie }));
    expect(discount.approvals.map((x: J) => x.id)).not.toContain(ra);
  });
});

describe("refusals leave the counter, the audit log and the milestone unchanged [ADM-INV-03, LD5]", () => {
  it("a stale updatedAt", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const before = await snapshot(made.id);
    const res = await issueInvoice(o, made.id, {
      expectedUpdatedAt: made.updatedAt - 1,
      expectedContentSha256: made.contentSha256,
    });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("stale_version");
    expect(await snapshot(made.id)).toEqual(before);
  });

  it("content changed: the client's state changed after the save, so the totals are not what the person saw", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const before = await snapshot(made.id);
    await env.DB.prepare("UPDATE clients SET state_code = '27' WHERE id = ?").bind(made.clientId).run(); // inter-state now: IGST, not CGST + SGST
    const res = await issueInvoice(o, made.id);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("content_changed");
    expect(await snapshot(made.id)).toEqual(before);
    // the body's own hash must be the stored one too
    await env.DB.prepare("UPDATE clients SET state_code = '19' WHERE id = ?").bind(made.clientId).run();
    const other = await issueInvoice(o, made.id, {
      expectedUpdatedAt: made.updatedAt,
      expectedContentSha256: "0".repeat(64),
    });
    expect(await codeOf(other)).toBe("content_changed");
    expect(await snapshot(made.id)).toEqual(before);
  });

  it.each([
    ["numbering", () => bumpSetting("numbering"), "numbering_changed"],
    ["company", () => bumpSetting("company"), "settings_changed"],
    ["tax", () => bumpSetting("tax"), "settings_changed"],
    ["payment_terms", () => bumpSetting("payment_terms"), "settings_changed"],
    ["the bank", () => putBank(Date.now() + 50_000), "settings_changed"],
  ] as const)("%s changed between the read and the batch", async (_n, change, code) => {
    const o = await owner();
    const made = await mkInvoice(o);
    const before = await snapshot(made.id);
    const res = await call(
      `/invoices/${made.id}/issue`,
      { cookie: o.cookie, body: await issueBodyOf(made.id) },
      beforeBatchHolding("issue_guard", change),
    );
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await codeOf(res)).toBe(code);
    expect(await snapshot(made.id)).toEqual(before);
    // read again, it goes through
    expect((await issueInvoice(o, made.id)).status).toBe(200);
  });

  it("the client updated between the read and the batch (client_changed); the client anonymised (client_anonymised)", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const before = await snapshot(made.id);
    const res = await call(
      `/invoices/${made.id}/issue`,
      { cookie: o.cookie, body: await issueBodyOf(made.id) },
      beforeBatchHolding("issue_guard", async () => {
        await env.DB.prepare("UPDATE clients SET updated_at = updated_at + 1 WHERE id = ?")
          .bind(made.clientId)
          .run();
      }),
    );
    expect(await codeOf(res)).toBe("client_changed");
    expect(await snapshot(made.id)).toEqual(before);
    const gone = await mkInvoice(o);
    await env.DB.prepare("UPDATE clients SET anonymised_at = 5 WHERE id = ?").bind(gone.clientId).run();
    const r2 = await issueInvoice(o, gone.id);
    expect(r2.status).toBe(409);
    expect(await codeOf(r2)).toBe("client_anonymised");
    // anonymised after the read, before the batch
    const late = await mkInvoice(o);
    const r3 = await call(
      `/invoices/${late.id}/issue`,
      { cookie: o.cookie, body: await issueBodyOf(late.id) },
      beforeBatchHolding("issue_guard", async () => {
        await env.DB.prepare("UPDATE clients SET anonymised_at = 5 WHERE id = ?").bind(late.clientId).run();
      }),
    );
    expect(await codeOf(r3)).toBe("client_anonymised");
    expect(await invoiceRow(late.id)).toMatchObject({ status: "draft", number: null });
  });

  it("the contact named on the invoice edited, or anonymised, between the read and the batch: 409 contact_changed and nothing is written", async () => {
    const o = await owner();
    for (const change of [
      (id: string) =>
        env.DB.prepare(
          "UPDATE contacts SET email = 'moved@example.test', updated_at = updated_at + 1 WHERE id = ?",
        )
          .bind(id)
          .run(),
      (id: string) =>
        env.DB.prepare(
          "UPDATE contacts SET name = 'Erased', anonymised_at = 5, updated_at = updated_at + 1 WHERE id = ?",
        )
          .bind(id)
          .run(),
    ]) {
      const made = await mkInvoice(o);
      const before = await snapshot(made.id);
      const res = await call(
        `/invoices/${made.id}/issue`,
        { cookie: o.cookie, body: await issueBodyOf(made.id) },
        beforeBatchHolding("issue_guard", async () => {
          await change(made.contactId);
        }),
      );
      expect(res.status, await res.clone().text()).toBe(409);
      expect(await codeOf(res)).toBe("contact_changed");
      expect(await snapshot(made.id)).toEqual(before);
    }
  });

  // M5.3 (changed on purpose): credit and debit notes issue now (invoice-notes.test.ts); only a quote is still not an invoice at all.
  it("a quote is not an invoice at all (404)", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    // a quote is not an invoice at all
    const quote = await mkDoc(c.clientId, "proposal");
    expect(
      (await issueInvoice(o, quote, { expectedUpdatedAt: 1, expectedContentSha256: "a".repeat(64) })).status,
    ).toBe(404);
  });

  describe("each blocker that a draft can reach", () => {
    const blockedWith = async (
      code: string,
      prepare: (o: Awaited<ReturnType<typeof owner>>) => Promise<string>,
    ) => {
      const o = await owner();
      const id = await prepare(o);
      const before = await snapshot(id);
      const res = await issueInvoice(o, id);
      expect(res.status, code).toBe(409);
      const body = await json(res);
      expect(body.error.code).toBe("issue_blocked");
      expect(
        body.blockers.map((b: J) => b.code),
        code,
      ).toContain(code);
      expect(await snapshot(id)).toEqual(before);
      return body;
    };

    it("supplier_legal_name, supplier_address, supplier_gstin (the company settings)", async () => {
      for (const [code, over] of [
        ["supplier_legal_name", { legalName: null }],
        ["supplier_address", { address: null }],
        ["supplier_gstin", { gstin: null }],
      ] as const) {
        await putCompany(over);
        await blockedWith(code, async (o) => (await mkInvoice(o)).id);
      }
      await putCompany();
    });

    it("recipient_legal_name and recipient_address (the client's record)", async () => {
      await blockedWith("recipient_legal_name", async (o) => {
        const c = await mkInvoiceClient({ legal_name: " " });
        return (await mkInvoice(o, { clientId: c.clientId })).id;
      });
      await blockedWith("recipient_address", async (o) => {
        const c = await mkInvoiceClient({ billing_address: null });
        return (await mkInvoice(o, { clientId: c.clientId })).id;
      });
    });

    it("no_lines and tax_errors (an empty draft; a discount larger than the invoice)", async () => {
      await blockedWith("no_lines", async (o) => {
        const c = await mkInvoiceClient();
        return (await json(await call("/invoices", { cookie: o.cookie, body: { clientId: c.clientId } })))
          .id as string;
      });
      await blockedWith("computed_errors", async (o) => {
        const made = await mkInvoice(o);
        const doc = await getInvoice(o, made.id);
        await patchInvoice(o, made.id, {
          expectedUpdatedAt: doc.updatedAt,
          fields: { discount: { kind: "fixed", value: 999_999_999 } },
        });
        return made.id;
      });
    });

    it("sac_missing (a custom line with no SAC) and total_zero (Q4: no zero-value invoice)", async () => {
      const body = await blockedWith("line_sac_missing", async (o) => {
        const made = await mkInvoice(o);
        const doc = await getInvoice(o, made.id);
        await patchInvoice(o, made.id, {
          expectedUpdatedAt: doc.updatedAt,
          lines: [{ description: "Custom", qtyMilli: 1000, unit: "fixed", rateMinor: 5_000 }],
        });
        return made.id;
      });
      expect(body.blockers).toContainEqual({ code: "line_sac_missing", line: 1 });
      await blockedWith("zero_total", async (o) => {
        const made = await mkInvoice(o);
        const doc = await getInvoice(o, made.id);
        await patchInvoice(o, made.id, {
          expectedUpdatedAt: doc.updatedAt,
          lines: [{ description: "Free", sac: "998314", qtyMilli: 1000, unit: "fixed", rateMinor: 0 }],
        });
        return made.id;
      });
    });
  });

  it("the series is full: the counter at the highest number is 409 series_full and does not move", async () => {
    // A year of its own (the clock is moved to 2090-91, FY token 9091), so no other test sees this counter.
    const o = await farSession();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2090, 5, 1, 6, 0, 0, 0) });
    const made = await mkInvoice(o);
    vi.setSystemTime(Date.UTC(2090, 5, 1, 6, 5, 0, 0));
    await env.DB.prepare(
      "INSERT INTO doc_counters (series, fy, next_no) VALUES ('invoice', '9091', 10000)",
    ).run();
    const before = await invoiceRow(made.id);
    const res = await issueInvoice(o, made.id);
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await codeOf(res)).toBe("series_full");
    expect(await invoiceRow(made.id)).toEqual(before);
    expect(await invoiceCounter("9091")).toBe(10_000);
    expect(await auditCount("invoice.issue", made.id)).toBe(0);
  });

  it("a duplicate number (impossible by design) is logged as an integrity error with ids only, writes nothing, and answers 409 stale_version", async () => {
    // A year of its own (2093-94, token 9394): the number the counter will hand out is already held by another frozen document.
    const o = await farSession();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2093, 5, 1, 6, 0, 0, 0) });
    const made = await mkInvoice(o);
    vi.setSystemTime(Date.UTC(2093, 5, 1, 6, 5, 0, 0));
    await env.DB.prepare(
      "INSERT INTO doc_counters (series, fy, next_no) VALUES ('invoice', '9394', 5)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO documents (id, type, status, client_id, currency, frozen_at, series, fy, number, number_display) SELECT 'dup-holder', 'tax_invoice', 'issued', client_id, currency, 1, 'invoice', '9394', 5, 'TH/INV/9394/0005' FROM documents WHERE id = ?",
    )
      .bind(made.id)
      .run();
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: unknown) => void logged.push(String(m)));
    try {
      const before = await invoiceRow(made.id);
      const res = await issueInvoice(o, made.id);
      expect(res.status, await res.clone().text()).toBe(409);
      expect(await codeOf(res)).toBe("stale_version");
      expect(await invoiceRow(made.id)).toEqual(before);
      expect(await invoiceCounter("9394")).toBe(5);
      expect(await auditCount("invoice.issue", made.id)).toBe(0);
      const line = logged.find((l) => l.includes("unique key"));
      expect(line).toBeDefined();
      expect(JSON.parse(line ?? "{}")).toMatchObject({
        level: "error",
        documentId: made.id,
        series: "invoice",
        fy: "9394",
      });
      expect(line).not.toMatch(/Asha|example\.test/);
    } finally {
      spy.mockRestore();
    }
  });

  it("is atomic: a failing side statement writes nothing (500), and the next issue gets the very next number", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const m = await mkReadyMilestone(c.clientId);
    const made = (
      await json(
        await call("/invoices", { cookie: o.cookie, body: { clientId: c.clientId, fromMilestoneId: m.id } }),
      )
    ).id as string;
    // a milestone invoice needs a SAC on its line before it can be issued
    const doc = await getInvoice(o, made);
    expect(
      (
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
        })
      ).status,
    ).toBe(200);
    const before = await snapshot(made, m.id);
    await env.DB.exec(
      "CREATE TRIGGER t_fail_ms BEFORE UPDATE OF status ON milestones WHEN NEW.status = 'invoiced' BEGIN SELECT RAISE(ABORT, 'forced failure'); END",
    );
    const res = await issueInvoice(o, made);
    expect(res.status).toBe(500);
    expect(await snapshot(made, m.id)).toEqual(before);
    await env.DB.exec("DROP TRIGGER t_fail_ms");
    const ok = await issueInvoice(o, made);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await json(ok)).number).toBe(`TH/INV/${FY}/${String(before.counter ?? 1).padStart(4, "0")}`);
  });
});

describe("the freeze and the milestone [ADM-INV-07, ADM-PRJ-02]", () => {
  it("an issued invoice cannot be saved or deleted (409), nor changed in the database; the freeze list still covers every column", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const doc = await getInvoice(o, made.id);
    expect(doc).toMatchObject({ status: "issued", frozen: true, balanceMinor: 118_000, paidMinor: 0 });
    const save = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      fields: { discount: null },
    });
    expect(save.status).toBe(409);
    expect(await codeOf(save)).toBe("frozen");
    const del = await call(`/invoices/${made.id}?expectedUpdatedAt=${doc.updatedAt}`, {
      method: "DELETE",
      cookie: o.cookie,
    });
    expect(del.status).toBe(409);
    expect(await codeOf(del)).toBe("frozen");
    await expect(
      env.DB.prepare("UPDATE documents SET total_minor = total_minor + 1 WHERE id = ?").bind(made.id).run(),
    ).rejects.toThrow(/frozen/);
    await expect(
      env.DB.prepare("UPDATE document_lines SET rate_minor = 1 WHERE document_id = ?").bind(made.id).run(),
    ).rejects.toThrow(/cannot change/);
    await expect(env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(made.id).run()).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it("the snapshot: recipient (with contactId and email), issuer (company, bank, signature reference, sender), computed, terms and the seal", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const row = await one<{
      recipient: string;
      issuer: string;
      computed: string;
      snapshot_sha256: string;
      terms_version_id: string | null;
      issue_date: string;
    }>(
      "SELECT recipient, issuer, computed, snapshot_sha256, terms_version_id, issue_date FROM documents WHERE id = ?",
      made.id,
    );
    const recipient = JSON.parse(row?.recipient ?? "{}");
    expect(recipient).toMatchObject({
      contactId: made.contactId,
      email: expect.stringContaining("@example.test"),
      gstStatus: "unregistered",
      stateCode: "19",
    });
    const issuer = JSON.parse(row?.issuer ?? "{}");
    expect(issuer.company).toMatchObject({
      gstin: expect.stringMatching(/^19ABCDE1234F1Z/),
      stateCode: "19",
      principalPlace: "1 Example Road, Balurghat",
    });
    expect(issuer.bank.inr).toMatchObject({ bankName: "SAMPLE BANK", ifsc: "SAMP0000001" });
    expect(issuer.signature).toBeNull();
    expect(issuer.sender).toMatchObject({ email: "billing@techaust.com" });
    expect(row?.snapshot_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(row?.computed ?? "{}").totalMinor).toBe(118_000);
    // the invoice's contact can no longer be erased: it is named on an issued document
    const contact = await one<{ n: number }>(
      "SELECT count(*) AS n FROM contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ? AND (EXISTS (SELECT 1 FROM documents d WHERE d.client_id = c.client_id AND d.frozen_at IS NOT NULL AND json_extract(d.recipient, '$.contactId') = c.id))",
      made.contactId,
    );
    expect(contact?.n).toBe(1);
    const owner2 = await owner();
    const erase = await call(`/contacts/${made.contactId}/erase`, {
      cookie: owner2.cookie,
      body: { mode: "erase", reason: "requested" },
    });
    expect(erase.status).toBe(409);
    expect(await codeOf(erase)).toBe("on_issued_document");
  });

  it("the reverse-charge statement (Rule 46(p)) is frozen in the issuer block and sealed: a later change of the setting does not change the issued invoice", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const read = async (id: string) =>
      (await one<{ issuer: string; snapshot_sha256: string }>(
        "SELECT issuer, snapshot_sha256 FROM documents WHERE id = ?",
        id,
      )) as { issuer: string; snapshot_sha256: string };
    const first = await read(made.id);
    expect(JSON.parse(first.issuer).reverseChargeText).toBe("Tax payable on reverse charge: No");
    // the setting changes afterwards (and a second invoice then freezes the new words); the first is untouched
    const putTax = (reverseChargeText: string) =>
      env.DB.prepare(
        "INSERT INTO settings (key, value, version) VALUES ('tax', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1",
      )
        .bind(JSON.stringify({ ...SETTINGS_DEFAULTS.tax, reverseChargeText }))
        .run();
    await putTax("Tax payable on reverse charge: Yes");
    const second = await mkInvoice(o);
    expect((await issueInvoice(o, second.id)).status).toBe(200);
    expect(JSON.parse((await read(second.id)).issuer).reverseChargeText).toBe(
      "Tax payable on reverse charge: Yes",
    );
    expect(await read(made.id)).toEqual(first);
    // put the default back for the tests that follow
    await putTax(SETTINGS_DEFAULTS.tax.reverseChargeText);
  });

  it("issuing a milestone invoice makes the milestone invoiced and keeps its delivery time; the audit row has ids and totals, no description", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const m = await mkReadyMilestone(c.clientId, 11_800_00, { delivered_at: 424242 });
    const made = (
      await json(
        await call("/invoices", { cookie: o.cookie, body: { clientId: c.clientId, fromMilestoneId: m.id } }),
      )
    ).id as string;
    const doc = await getInvoice(o, made);
    expect(
      (
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
        })
      ).status,
    ).toBe(200);
    const res = await issueInvoice(o, made);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await one("SELECT status, delivered_at, document_id FROM milestones WHERE id = ?", m.id)).toEqual({
      status: "invoiced",
      delivered_at: 424242,
      document_id: made,
    });
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'invoice.issue' AND entity_id = ?",
      made,
    );
    const summary = JSON.parse(audit?.summary ?? "{}");
    expect(summary).toMatchObject({
      documentId: made,
      type: "tax_invoice",
      totalMinor: 11_800_00,
      currency: "INR",
      approvalId: null,
    });
    expect(audit?.summary).not.toContain("Design");
    // the milestone is locked (invoiced): it cannot be edited or deleted
    const patch = await call(`/milestones/${m.id}`, {
      method: "PATCH",
      cookie: o.cookie,
      body: { expectedUpdatedAt: 1, title: "x" },
    });
    expect(patch.status).toBe(409);
  });

  it("issuing queues the PDF (pdf.snapshot) after the batch; a queue that is down never fails the issue", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const sent: unknown[] = [];
    const queue = { send: async (m: unknown) => void sent.push(m), sendBatch: async () => undefined };
    const res = await call(
      `/invoices/${made.id}/issue`,
      { cookie: o.cookie, body: await issueBodyOf(made.id) },
      withEnv(env, { PDF_QUEUE: queue }),
    );
    expect(res.status).toBe(200);
    expect(sent).toEqual([{ v: 1, kind: "pdf.snapshot", documentId: made.id, reason: "send" }]);
    const down = await mkInvoice(o);
    const broken = {
      send: async () => Promise.reject(new Error("queue down")),
      sendBatch: async () => undefined,
    };
    const res2 = await call(
      `/invoices/${down.id}/issue`,
      { cookie: o.cookie, body: await issueBodyOf(down.id) },
      withEnv(env, { PDF_QUEUE: broken }),
    );
    expect(res2.status).toBe(200);
    expect(await invoiceRow(down.id)).toMatchObject({ status: "issued" });
  });

  it("an inter-state client gets IGST on the issued invoice; a client with a registered GSTIN prints it on the snapshot", async () => {
    const o = await owner();
    const inter = await mkInterClient();
    const made = await mkInvoice(o, { clientId: inter.clientId });
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const computed = JSON.parse(
      (await one<{ computed: string }>("SELECT computed FROM documents WHERE id = ?", made.id))?.computed ??
        "{}",
    );
    expect(computed.igstMinor).toBe(18_000);
    expect(computed.cgstMinor).toBe(0);
    expect(computed.supply).toMatchObject({ type: "inter", placeOfSupplyCode: "27" });
  });
});

describe("the route table covers issue", () => {
  it("every issue-related row declares its action", () => {
    const names = ROUTES.filter((r) => /\/invoices\/:id\/(issue|issue-request|void)$/.test(r.path)).map(
      (r) => `${r.method} ${r.access}`,
    );
    expect(names).toEqual(["POST invoices.issue", "POST invoices.draft", "POST invoices.void"]);
  });

  it("nothing in the audit log of an issue holds a name or an address", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const all = (
      await rows<{ summary: string | null }>("SELECT summary FROM audit_log WHERE entity_id = ?", made.id)
    )
      .map((r) => r.summary ?? "")
      .join("");
    expect(all).not.toContain("Asha");
    expect(all).not.toContain("Market Street");
    expect(all).not.toContain("example.test");
  });
});

describe("the bells of an individual's invoices go with the person [DPDP; Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11); early check required 3]", () => {
  it("anonymising the last contact deletes the bells about a pending issue request and about an issued invoice; the issued invoice and its approval stay, the draft and its request go", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const c = await mkInvoiceClient({ type: "individual" });
    // one request approved by the owner (the requester's "issued" bell), one still pending (the owners' "asked you" bell)
    const issuedInv = await mkInvoice(staff, { clientId: c.clientId });
    const req1 = (await json(await requestIssue(staff, issuedInv.id))).id as string;
    expect((await decideApproval(o, req1, "approve")).status).toBe(200);
    const pendingInv = await mkInvoice(staff, { clientId: c.clientId });
    const req2 = (await json(await requestIssue(staff, pendingInv.id))).id as string;
    const bells = () =>
      countOf("notifications", "entity_type = 'approval' AND entity_id IN (?, ?)", req1, req2);
    expect(await bells()).toBeGreaterThanOrEqual(2); // the requester's "issued" bell and one "asked you" bell per active owner
    expect(await countOf("notifications", "entity_id = ? AND kind = 'approval.decided'", req1)).toBe(1);
    const erase = await call(`/contacts/${c.contactId}/erase`, {
      cookie: o.cookie,
      body: { mode: "anonymise", reason: "requested" },
    });
    expect(erase.status, await erase.clone().text()).toBe(200);
    expect(await bells()).toBe(0);
    // the issued invoice and its approval stay; the unissued draft goes with the person, and so does the request asked for it (review 9)
    expect(await countOf("approvals", "id = ?", req1)).toBe(1);
    expect(await countOf("approvals", "id = ?", req2)).toBe(0);
    expect(await invoiceRow(issuedInv.id)).toMatchObject({ status: "issued" });
    expect(await invoiceRow(pendingInv.id)).toBeNull();
  });

  it("a business client's bells stay", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const c = await mkInvoiceClient();
    const inv = await mkInvoice(staff, { clientId: c.clientId });
    const req = (await json(await requestIssue(staff, inv.id))).id as string;
    const second = await mkContact2(c.clientId);
    expect(second).toBeTruthy();
    const erase = await call(`/contacts/${c.contactId}/erase`, {
      cookie: o.cookie,
      body: { mode: "anonymise", reason: "requested" },
    });
    expect(erase.status, await erase.clone().text()).toBe(200);
    expect(await countOf("notifications", "entity_type = 'approval' AND entity_id = ?", req)).toBeGreaterThan(
      0,
    );
  });
});
