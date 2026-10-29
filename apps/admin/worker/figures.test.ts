// FX-3 (A3 4 and A3 5) [ADM-CLI-03, ADM-PRJ-05; LD78; Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28)]: a client's Overview figures and a project's
// billed figure. The twin test: billed, credited and the balance agree with GET /clients/:id/statement for the same client and currency. Proformas and voided
// documents never count, overdue is due strictly before today (IST), "collected" and "paid" are never sent, an anonymised client gets no figures, Sales gets a
// 403 (client) or no `billed` key (project), and one indexed read covers a client with 200 documents.
import { env } from "cloudflare:workers";
import { CLIENT_FIGURES_SQL, PROJECT_BILLED_SQL } from "@techaust/db/reports";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call, pinClock, sessionFor } from "./test-helpers.ts";
import { putTax } from "./test-invoice-types.ts";
import { type J, json, putCompany } from "./test-invoices.ts";
import { mkProject } from "./test-projects.ts";
import { addDoc, addReceipt, line, mkReportClient } from "./test-reports.ts";

// 12:00 IST on 2026-10-15: "today" for overdue is that day, whatever the real date.
beforeAll(() => {
  pinClock();
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await putCompany();
  await putTax();
});

const TODAY = "2026-10-15";
const finance = async (cookie: string, id: string) => json(await call(`/clients/${id}/finance`, { cookie }));
const statement = async (cookie: string, id: string, currency: "INR" | "USD") =>
  json(await call(`/clients/${id}/statement?from=2020-04-01&to=${TODAY}&currency=${currency}`, { cookie }));

/** A client with every kind of line: two invoices (one overdue), a credit note, a debit note, a proforma, a paid Q9 advance, a voided invoice. */
async function fullClient(ownerId: string) {
  const c = await mkReportClient();
  const overdue = await addDoc({
    clientId: c,
    issueDate: "2026-04-10",
    dueDate: "2026-05-10",
    lines: [line(1_000_00)],
  });
  const current = await addDoc({
    clientId: c,
    issueDate: "2026-10-01",
    dueDate: TODAY, // due today: not overdue yet
    lines: [line(2_000_00)],
  });
  const cn = await addDoc({
    type: "credit_note",
    clientId: c,
    issueDate: "2026-06-01",
    parentId: overdue.id,
    lines: [line(200_00)],
  });
  await env.DB.prepare(
    "UPDATE documents SET balance_minor = balance_minor - ?1, credited_minor = ?1, status = 'partially_credited' WHERE id = ?2",
  )
    .bind(cn.computed.totalMinor, overdue.id)
    .run();
  const dn = await addDoc({
    type: "debit_note",
    clientId: c,
    issueDate: "2026-06-15",
    dueDate: "2026-07-15",
    parentId: current.id,
    lines: [line(100_00)],
  });
  const pro = await addDoc({ type: "proforma", clientId: c, issueDate: "2026-07-01", status: "issued" });
  const adv = await addDoc({
    clientId: c,
    issueDate: "2026-07-05",
    dueDate: "2026-07-05",
    lines: [line(300_00)],
    balance: 0,
    status: "paid",
    parentId: pro.id,
  });
  await addReceipt({
    clientId: c,
    proformaId: pro.id,
    invoiceId: adv.id,
    currency: "INR",
    amountMinor: adv.computed.totalMinor,
    receivedOn: "2026-07-05",
    createdBy: ownerId,
  });
  await addDoc({ clientId: c, issueDate: "2026-08-01", dueDate: "2026-08-15", voided: true });
  return { c, overdue, current, cn, dn, pro, adv };
}

describe("GET /clients/:id/finance: the Overview figures [ADM-CLI-03]", () => {
  it("billed, credited, the balance and overdue, by currency; proformas, receipts as income and voided invoices never count", async () => {
    const o = await sessionFor("owner");
    const { c, overdue, current, cn, dn, adv } = await fullClient(o.id);
    const f = await finance(o.cookie, c);
    const billed =
      overdue.computed.totalMinor +
      current.computed.totalMinor +
      dn.computed.totalMinor +
      adv.computed.totalMinor;
    const balance =
      overdue.computed.totalMinor -
      cn.computed.totalMinor +
      current.computed.totalMinor +
      dn.computed.totalMinor;
    expect(f).toEqual({
      available: true,
      asOf: TODAY,
      currencies: [
        {
          currency: "INR",
          billedMinor: billed,
          creditedMinor: cn.computed.totalMinor,
          balanceMinor: balance,
          // the invoice due in May (after its credit note) and the debit note due in July; the invoice due today is not overdue
          overdueMinor: overdue.computed.totalMinor - cn.computed.totalMinor + dn.computed.totalMinor,
          overdueCount: 2,
        },
      ],
    });
    // "collected" waits for payments (M6): not sent at all, never a 0
    expect(JSON.stringify(f)).not.toMatch(/collected|paid/i);
  });

  it("twin of the statement: billed is its debit column, credited its credit notes, the balance its closing balance today", async () => {
    const o = await sessionFor("accountant");
    const { c } = await fullClient((await sessionFor("owner")).id);
    const f = await finance(o.cookie, c);
    const s = await statement(o.cookie, c, "INR");
    const fig = f.currencies[0];
    expect(fig.billedMinor).toBe(s.range.debitMinor);
    expect(fig.balanceMinor).toBe(s.range.closingMinor);
    expect(fig.creditedMinor).toBe(
      s.entries.filter((e: J) => e.kind === "credit_note").reduce((a: number, e: J) => a + e.creditMinor, 0),
    );
    expect(s.range.openingMinor).toBe(0);
    expect(s.next).toBeNull();
  });

  it("twin of the statement for an overseas client billed in USD (export invoices; amounts never converted)", async () => {
    const o = await sessionFor("owner");
    const c = await mkReportClient("USD");
    const a = await addDoc({ clientId: c, currency: "USD", issueDate: "2026-05-01", dueDate: "2026-06-01" });
    const b = await addDoc({ clientId: c, currency: "USD", issueDate: "2026-09-01", dueDate: "2026-12-01" });
    const f = await finance(o.cookie, c);
    expect(f.currencies).toEqual([
      {
        currency: "USD",
        billedMinor: a.computed.totalMinor + b.computed.totalMinor,
        creditedMinor: 0,
        balanceMinor: a.computed.totalMinor + b.computed.totalMinor,
        overdueMinor: a.computed.totalMinor,
        overdueCount: 1,
      },
    ]);
    const s = await statement(o.cookie, c, "USD");
    expect(f.currencies[0].billedMinor).toBe(s.range.debitMinor);
    expect(f.currencies[0].balanceMinor).toBe(s.range.closingMinor);
  });

  it("a client with no issued document answers no currencies (never a row of zeros)", async () => {
    const o = await sessionFor("owner");
    const c = await mkReportClient();
    await addDoc({ type: "proforma", clientId: c, issueDate: "2026-07-01", status: "issued" });
    expect(await finance(o.cookie, c)).toEqual({ available: true, asOf: TODAY, currencies: [] });
  });

  it("an anonymised client gets no figures; an unknown one is a 404; Sales is refused by the API", async () => {
    const o = await sessionFor("owner");
    const { c } = await fullClient(o.id);
    await env.DB.prepare("UPDATE clients SET anonymised_at = 5 WHERE id = ?1").bind(c).run();
    expect(await finance(o.cookie, c)).toEqual({ available: false, reason: "anonymised" });
    // FX-3 fix round (item 7): the figures read itself skips an anonymised client's documents: no rows, and only the client is read (its key entry and
    // its row: 2; its 7 documents would add 14, or 7 index entries with a guard checked per entry).
    const read = await env.DB.prepare(CLIENT_FIGURES_SQL).bind(c, TODAY).all();
    expect(read.results).toEqual([]);
    expect(read.meta.rows_read).toBeLessThanOrEqual(2);
    expect((await call("/clients/nope/finance", { cookie: o.cookie })).status).toBe(404);
    const s = await sessionFor("sales");
    expect((await call(`/clients/${c}/finance`, { cookie: s.cookie })).status).toBe(403);
    for (const role of ["staff", "accountant"] as const) {
      const r = await sessionFor(role);
      expect((await call(`/clients/${c}/finance`, { cookie: r.cookie })).status).toBe(200);
    }
  });

  it("a client with 200 documents: one indexed read of its own documents (rows read reported)", async () => {
    const o = await sessionFor("owner");
    const c = await mkReportClient();
    const other = await mkReportClient();
    for (let i = 0; i < 50; i++) await addDoc({ clientId: other, issueDate: "2026-05-01" });
    for (let i = 0; i < 200; i++) {
      await addDoc({
        clientId: c,
        issueDate: `2026-0${4 + (i % 6)}-${String(1 + (i % 28)).padStart(2, "0")}`,
        dueDate: i % 2 ? "2026-06-01" : "2026-12-01",
      });
    }
    const res = await env.DB.prepare(CLIENT_FIGURES_SQL).bind(c, TODAY).all();
    // The other client's 50 documents are never read: the seek is on the client. D1 counts each document twice (its index entry, then its row), so
    // 200 documents read 400 rows; the other client's 50 would add 100.
    console.log(`FX-3 client figures, 200 documents: rows_read = ${res.meta.rows_read}`);
    expect(res.meta.rows_read).toBeLessThanOrEqual(2 * 200 + 2);
    const f = await finance(o.cookie, c);
    expect(f.currencies[0].overdueCount).toBe(100);
    const s = await statement(o.cookie, c, "INR");
    expect(f.currencies[0].billedMinor).toBe(s.range.debitMinor);
    expect(f.currencies[0].balanceMinor).toBe(s.range.closingMinor);
  });
});

describe("GET /projects/:id: the billed figure [ADM-PRJ-05]", () => {
  it("sums the project's issued invoices and debit notes, lists its credit notes, and leaves out proformas, voided ones and other projects", async () => {
    const o = await sessionFor("owner");
    const c = await mkReportClient();
    const p = await mkProject(c);
    const q = await mkProject(c);
    const inv = await addDoc({ clientId: c, issueDate: "2026-05-01", over: { project_id: p.id } });
    const dn = await addDoc({
      type: "debit_note",
      clientId: c,
      issueDate: "2026-05-10",
      parentId: inv.id,
      lines: [line(50_00)],
      over: { project_id: p.id },
    });
    const cn = await addDoc({
      type: "credit_note",
      clientId: c,
      issueDate: "2026-05-20",
      parentId: inv.id,
      lines: [line(20_00)],
      over: { project_id: p.id },
    });
    await addDoc({
      type: "proforma",
      clientId: c,
      issueDate: "2026-05-02",
      status: "issued",
      over: { project_id: p.id },
    });
    await addDoc({ clientId: c, issueDate: "2026-05-03", voided: true, over: { project_id: p.id } });
    await addDoc({ clientId: c, issueDate: "2026-05-04", over: { project_id: q.id } });
    await addDoc({ clientId: c, issueDate: "2026-05-05" }); // no project
    const res = await json(await call(`/projects/${p.id}`, { cookie: o.cookie }));
    expect(res.figures.billed).toEqual({
      available: true,
      currencies: [
        {
          currency: "INR",
          billedMinor: inv.computed.totalMinor + dn.computed.totalMinor,
          creditedMinor: cn.computed.totalMinor,
        },
      ],
    });
    // "paid" waits for payments (M6): not sent at all
    expect(Object.keys(res.figures).sort()).toEqual(["billed", "hours"]);
  });

  it("Sales gets no billed key (its statement never runs); an anonymised client's project gets no figures", async () => {
    const c = await mkReportClient();
    const p = await mkProject(c);
    for (let i = 1; i <= 6; i++)
      await addDoc({ clientId: c, issueDate: `2026-05-0${i}`, over: { project_id: p.id } });
    const s = await sessionFor("sales");
    const sales = await json(await call(`/projects/${p.id}`, { cookie: s.cookie }));
    expect(Object.keys(sales.figures)).toEqual(["hours"]);
    const st = await sessionFor("staff");
    const staff = await json(await call(`/projects/${p.id}`, { cookie: st.cookie }));
    expect(staff.figures.billed.available).toBe(true);
    await env.DB.prepare("UPDATE clients SET anonymised_at = 5 WHERE id = ?1").bind(c).run();
    const o = await sessionFor("owner");
    const gone = await json(await call(`/projects/${p.id}`, { cookie: o.cookie }));
    expect(gone.figures.billed).toEqual({ available: false, reason: "anonymised" });
    // FX-3 fix round (item 7): the billed read itself skips the documents of an anonymised client's project: no rows, and only the project and its client
    // are read (3 rows as D1 counts them; its 6 documents would add 12).
    const read = await env.DB.prepare(PROJECT_BILLED_SQL).bind(p.id).all();
    expect(read.results).toEqual([]);
    expect(read.meta.rows_read).toBeLessThanOrEqual(3);
  });
});
