// T11, early check 9 (docs/runs/t11-deed.md): the deed's L3 hook adds 3 statements to every batch that can complete a project's full payment. These count every
// D1 statement each hooked request runs, worst cases first (a payment over ALLOCATIONS_MAX invoices, recorded by the Owner and confirmed from a Staff entry; a
// credit note issued by the Owner and through an approval; the advance batch; use credit; complete; void; Check again), and hold each within D1 Free's 50
// queries per invocation. The numbers are logged for the staging reading. All names, references and amounts are invented test data.
import { ALLOCATIONS_MAX } from "@techaust/core/ledger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { D1_FREE_QUERIES, DEED_TOTAL, mkDeedProject, statementCounter } from "./test-deeds.ts";
import { call, one, sessionFor } from "./test-helpers.ts";
import { currentFy, lutOf, mkProforma, putSwiftBank, putTax, todayIso } from "./test-invoice-types.ts";
import { issueBodyOf, issueInvoice, json, putBank, putCompany, requestIssue } from "./test-invoices.ts";
import { draftCredit, mkIssuedInvoice } from "./test-notes.ts";
import { paymentRow, recordBody, recorded, today } from "./test-payments.ts";
import { addDoc } from "./test-reports.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => vi.useRealTimers());

/** A completed project with ALLOCATIONS_MAX invoices of 1,180.00 each (the first from mkDeedProject). */
async function tenInvoices() {
  const f = await mkDeedProject({ status: "completed", total: DEED_TOTAL * ALLOCATIONS_MAX });
  const ids = [f.inv.id];
  for (let i = 1; i < ALLOCATIONS_MAX; i++)
    ids.push(
      (await addDoc({ clientId: f.clientId, issueDate: "2026-10-05", over: { project_id: f.projectId } })).id,
    );
  return { ...f, ids, allocations: ids.map((documentId) => ({ documentId, amountMinor: DEED_TOTAL })) };
}

const within = (what: string, n: number) => {
  console.log(`D1 statements, ${what}: ${n}`);
  expect(n, what).toBeLessThanOrEqual(D1_FREE_QUERIES);
};

describe("the hooked batches stay within D1 Free's 50 queries [T11 L3, early check 9]", () => {
  it(`record a confirmed payment over ${ALLOCATIONS_MAX} invoices (Owner): the deed is made in the same request`, async () => {
    const o = await owner();
    const f = await tenInvoices();
    const s = statementCounter();
    const res = await call(
      "/payments",
      { cookie: o.cookie, body: recordBody(f.clientId, DEED_TOTAL * ALLOCATIONS_MAX, f.allocations) },
      s.env,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    within(`record over ${ALLOCATIONS_MAX} invoices`, s.count());
    expect((await one("SELECT status FROM deeds WHERE project_id = ?", f.projectId))?.status).toBe("draft");
  });

  it(`confirm a Staff entry over ${ALLOCATIONS_MAX} invoices (Owner's verify)`, async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const f = await tenInvoices();
    const made = await recorded(staff, recordBody(f.clientId, DEED_TOTAL * ALLOCATIONS_MAX, f.allocations));
    const row = await paymentRow(made.id as string);
    const s = statementCounter();
    const res = await call(
      `/payments/${made.id}/verify`,
      { cookie: o.cookie, body: { decision: "confirm", expectedRecordedAt: row?.recorded_at } },
      s.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    within(`verify over ${ALLOCATIONS_MAX} invoices`, s.count());
    expect((await one("SELECT status FROM deeds WHERE project_id = ?", f.projectId))?.status).toBe("draft");
  });

  it("use credit on an invoice", async () => {
    const o = await owner();
    const f = await mkDeedProject({ status: "completed" });
    await recorded(o, recordBody(f.clientId, DEED_TOTAL));
    const inv = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", f.inv.id);
    const s = statementCounter();
    const res = await call(
      `/clients/${f.clientId}/credit/apply`,
      {
        cookie: o.cookie,
        body: { documentId: f.inv.id, amountMinor: DEED_TOTAL, expectedUpdatedAt: inv?.updated_at },
      },
      s.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    within("use credit", s.count());
    expect((await one("SELECT status FROM deeds WHERE project_id = ?", f.projectId))?.status).toBe("draft");
  });

  it("a credit note issued by the Owner, and one issued through an approval", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    const d = await json(
      await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 20_000 }] }),
    );
    const s = statementCounter();
    const res = await call(
      `/invoices/${d.id}/issue`,
      { cookie: o.cookie, body: await issueBodyOf(d.id) },
      s.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    within("credit note issued by the Owner", s.count());

    const inv2 = await mkIssuedInvoice(o, { prices: [100_000] });
    const d2 = await json(
      await draftCredit(staff, inv2.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 10_000 }] }),
    );
    const asked = await json(await requestIssue(staff, d2.id, "Client agreed"));
    const s2 = statementCounter();
    const approved = await call(
      `/approvals/${asked.id}/decide`,
      { cookie: o.cookie, body: { decision: "approve" } },
      s2.env,
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    within("credit note issued through an approval", s2.count());
  });

  it("the advance batch (a tax invoice for a payment received)", async () => {
    const o = await owner();
    const pf = await mkProforma(o, { price: 100_000 });
    const issued = await issueInvoice(o, pf.id);
    expect(issued.status, await issued.clone().text()).toBe(200);
    const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", pf.id);
    const s = statementCounter();
    const res = await call(
      `/invoices/${pf.id}/advance-invoice`,
      {
        cookie: o.cookie,
        body: {
          expectedProformaUpdatedAt: row?.updated_at,
          amountMinor: 59_000,
          receivedOn: todayIso(),
          reference: `UTR ${Date.now()} budget`,
        },
      },
      s.env,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    within("advance batch", s.count());
  });

  it("complete a paid project, void a duplicate invoice, and Check again", async () => {
    const o = await owner();
    const f = await mkDeedProject();
    await recorded(
      o,
      recordBody(f.clientId, DEED_TOTAL, [{ documentId: f.inv.id, amountMinor: DEED_TOTAL }]),
    );
    const s = statementCounter();
    const res = await call(
      `/projects/${f.projectId}/status`,
      { cookie: o.cookie, body: { to: "completed" } },
      s.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    within("complete a project", s.count());

    const g = await mkDeedProject({ status: "completed" });
    const dup = await addDoc({ clientId: g.clientId, issueDate: today(), over: { project_id: g.projectId } });
    await recorded(
      o,
      recordBody(g.clientId, DEED_TOTAL, [{ documentId: g.inv.id, amountMinor: DEED_TOTAL }]),
    );
    const dupRow = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", dup.id);
    const s2 = statementCounter();
    const voided = await call(
      `/invoices/${dup.id}/void`,
      { cookie: o.cookie, body: { expectedUpdatedAt: dupRow?.updated_at, reason: "Issued twice" } },
      s2.env,
    );
    expect(voided.status, await voided.clone().text()).toBe(200);
    within("void", s2.count());

    const h = await mkDeedProject({ status: "completed" });
    const s3 = statementCounter();
    const again = await call(`/projects/${h.projectId}/deed/recheck`, { cookie: o.cookie, body: {} }, s3.env);
    expect(again.status, await again.clone().text()).toBe(200);
    within("Check again", s3.count());
  });
});
