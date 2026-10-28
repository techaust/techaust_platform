// The dashboard's finance tile [ADM-DASH-01; M5.5b, LD80; Researched 2026-10-28, s.34(2) CGST Act (08-C RA-03) for what counts as invoiced]: invoiced (this financial year and this month, credit notes negative,
// voided and proformas never), what clients owe, what is overdue (flips at IST midnight), the proformas that wait, and the exports nearing a deadline; who sees it; and the rows it reads.
import { env } from "cloudflare:workers";
import { addDays, fyOfDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { issueDateOf } from "@techaust/core/invoices";
import {
  EXPORT_NEXT_SQL,
  EXPORT_STAGE_COUNTS_SQL,
  INVOICED_SQL,
  OVERDUE_OLDEST_SQL,
  OWED_SQL,
  PROFORMAS_AWAITING_SQL,
} from "@techaust/db/reports";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, pinClock, sessionFor } from "./test-helpers.ts";
import { putTax } from "./test-invoice-types.ts";
import { type J, json } from "./test-invoices.ts";
import { addDoc, line, mkReportClient } from "./test-reports.ts";

const istToday = () => issueDateOf(Date.now());
const plus = (days: number) => toIsoDate(addDays(parseIsoDate(istToday()) as never, days));
const dash = async (cookie: string) => {
  const res = await call("/dashboard", { cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await json(res)) as J).tiles;
};

beforeEach(async () => {
  await putTax();
});
afterEach(() => vi.useRealTimers());

describe("the finance figures against a known fixture", () => {
  it("invoiced, outstanding, overdue, proformas awaiting and the exports in their stages", async () => {
    pinClock(); // one IST day for the fixture and the dashboard, away from a month or FY edge (audit A0, finding 7)
    const o = await sessionFor("owner");
    const today = istToday();
    const fy = fyOfDate(parseIsoDate(today) as never);
    const fyFrom = `${fy.startYear}-04-01`;
    const monthFrom = `${today.slice(0, 7)}-01`;
    const inr = await mkReportClient("INR");
    const usd = await mkReportClient("USD");

    const a = await addDoc({ clientId: inr, issueDate: today, lines: [line(1_000_00)], dueDate: plus(10) });
    const b = await addDoc({ clientId: inr, issueDate: fyFrom, lines: [line(2_000_00)], dueDate: plus(-5) });
    const cn = await addDoc({
      type: "credit_note",
      clientId: inr,
      issueDate: today,
      parentId: b.id,
      lines: [line(300_00)],
      dueDate: null,
    });
    const dn = await addDoc({
      type: "debit_note",
      clientId: inr,
      issueDate: today,
      parentId: b.id,
      lines: [line(100_00)],
      dueDate: plus(10),
    });
    await addDoc({ clientId: inr, issueDate: today, voided: true, dueDate: plus(-9) });
    const pro = await addDoc({
      type: "proforma",
      clientId: inr,
      issueDate: today,
      status: "issued",
      lines: [line(500_00)],
    });
    // M6: a part-paid (converted) proforma still waits for its remainder; a fully advanced one (balance 0) and a converted one nothing was paid on do not
    const partBalance = 800_00 + 144_00 - 300_00;
    await addDoc({
      type: "proforma",
      clientId: inr,
      issueDate: today,
      status: "converted",
      lines: [line(800_00)],
      over: { paid_minor: 300_00, balance_minor: partBalance },
    });
    await addDoc({
      type: "proforma",
      clientId: inr,
      issueDate: today,
      status: "converted",
      lines: [line(100_00)],
      over: { paid_minor: 118_00, balance_minor: 0 },
    });
    await addDoc({
      type: "proforma",
      clientId: inr,
      issueDate: today,
      status: "converted",
      lines: [line(100_00)],
      over: { balance_minor: 0 },
    });
    const fresh = await addDoc({ clientId: usd, currency: "USD", issueDate: today, dueDate: plus(10) });
    // an export 290 days old (FEMA's 9 months are over) and one 400 days old under LUT (the 12 months + 15 days are over)
    const feo = await addDoc({ clientId: usd, currency: "USD", issueDate: plus(-290), dueDate: plus(-100) });
    const gso = await addDoc({ clientId: usd, currency: "USD", issueDate: plus(-400), dueDate: plus(-200) });
    await env.DB.prepare(
      "UPDATE documents SET balance_minor = balance_minor - ?1, credited_minor = credited_minor + ?1 WHERE id = ?2",
    )
      .bind(cn.computed.totalMinor, b.id)
      .run();

    const t = await dash(o.cookie);
    const f = t.finance;
    expect(f.today).toBe(today);
    expect(f.fy).toEqual({ label: fy.label, from: fyFrom, to: `${fy.startYear + 1}-03-31` });
    expect(f.month.from).toBe(monthFrom);

    // invoiced: INR documents of the FY (credit note negative); the month's are those issued from the 1st
    const sign = (type: string) => (type === "credit_note" ? -1 : 1);
    const inrDocs = [
      { d: a, date: today, type: "tax_invoice" },
      { d: b, date: fyFrom, type: "tax_invoice" },
      { d: cn, date: today, type: "credit_note" },
      { d: dn, date: today, type: "debit_note" },
    ];
    const sum = (from: string, key: "taxableMinor" | "totalMinor") =>
      inrDocs.filter((x) => x.date >= from).reduce((s, x) => s + sign(x.type) * x.d.computed[key], 0);
    const inrFy = f.invoiced.fy.find((r: J) => r.currency === "INR");
    expect(inrFy).toMatchObject({
      documents: 4,
      taxableMinor: sum(fyFrom, "taxableMinor"),
      totalMinor: sum(fyFrom, "totalMinor"),
      inrTaxableMinor: sum(fyFrom, "taxableMinor"),
    });
    const inrMonth = f.invoiced.month.find((r: J) => r.currency === "INR");
    const inMonth = inrDocs.filter((x) => x.date >= monthFrom);
    expect(inrMonth).toMatchObject({
      documents: inMonth.length,
      taxableMinor: sum(monthFrom, "taxableMinor"),
    });
    expect(inrFy.taxableMinor).toBeLessThan(
      a.computed.taxableMinor + b.computed.taxableMinor + dn.computed.taxableMinor,
    );
    // the USD export issued today: in USD, with its INR taxable value
    const usdFy = f.invoiced.fy.find((r: J) => r.currency === "USD");
    expect(usdFy.inrTaxableMinor).toBeGreaterThan(usdFy.taxableMinor);
    expect(f.invoiced.fy.map((r: J) => r.currency)).toEqual(["INR", "USD"]);

    // what clients owe: open invoices and debit notes (a credit note and a proforma are not owed)
    const owed = (cur: string) => f.outstanding.find((r: J) => r.currency === cur);
    expect(owed("INR")).toEqual({
      currency: "INR",
      count: 3,
      balanceMinor:
        a.computed.totalMinor + (b.computed.totalMinor - cn.computed.totalMinor) + dn.computed.totalMinor,
    });
    expect(owed("USD").count).toBe(3);
    // overdue: past their due date; the oldest first, with the days
    expect(f.overdue.byCurrency.find((r: J) => r.currency === "INR")).toMatchObject({ count: 1 });
    expect(f.overdue.byCurrency.find((r: J) => r.currency === "USD")).toMatchObject({ count: 2 });
    expect(f.overdue.oldest.map((r: J) => [r.id, r.daysOverdue])).toEqual([
      [gso.id, 200],
      [feo.id, 100],
      [b.id, 5],
    ]);
    expect(f.overdue.oldest[0]).toMatchObject({
      number: gso.number,
      currency: "USD",
      clientCode: expect.stringMatching(/^T\d{4}$/),
    });
    expect(f.proformasAwaiting).toEqual([
      { currency: "INR", count: 2, balanceMinor: pro.computed.totalMinor + partBalance },
    ]);
    // the exports: the fresh one is "ok", FEMA is over for the 290-day one, the GST deadline for the 400-day one
    expect(f.exports.counts).toEqual({
      femaApproaching: 0,
      femaOverdue: 1,
      gstApproaching: 0,
      gstOverdue: 1,
    });
    expect(f.exports.next.map((r: J) => [r.id, r.stage])).toEqual([
      [gso.id, "gst_overdue"],
      [feo.id, "fema_overdue"],
    ]);
    expect(f.exports.next.some((r: J) => r.id === fresh.id)).toBe(false);
    expect(f.collected).toEqual({ available: false, arrivesWith: "payments" });
    expect(f.paymentsToVerify).toEqual({ available: false, arrivesWith: "payments" });
  });

  it("overdue flips at IST midnight: the due date is the last day to pay", async () => {
    const inr = await mkReportClient("INR");
    const due = "2027-03-10";
    const d = await addDoc({ clientId: inr, issueDate: "2027-03-01", dueDate: due });
    const [y, m, day] = due.split("-").map(Number) as [number, number, number];
    // 23:59:59 IST on the due date = 18:29:59 UTC; 00:00:00 IST the next day = 18:30:00 UTC
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(y, m - 1, day, 18, 29, 59)));
    const o = await sessionFor("owner");
    const before = (await dash(o.cookie)).finance;
    const overdueInr = (f: J) => f.overdue.byCurrency.find((r: J) => r.currency === "INR")?.count ?? 0;
    expect(before.today).toBe(due);
    vi.setSystemTime(new Date(Date.UTC(y, m - 1, day, 18, 30, 0)));
    const after = (await dash(o.cookie)).finance;
    expect(after.today).toBe("2027-03-11");
    // the document due on the 10th is overdue from the first instant of the 11th, and not a second before
    expect(overdueInr(after)).toBe(overdueInr(before) + 1);
    expect(d.id).toBeTruthy();
  });

  it("an invalid tax row withholds the export figures and nothing else", async () => {
    const o = await sessionFor("owner");
    await putTax({ realisation: { warnMonths: 0, escalateMonths: 12, escalateExtraDays: 15 } });
    const f = (await dash(o.cookie)).finance;
    expect(f.exports).toEqual({ available: false, reason: "settings_invalid" });
    expect(f.invoiced).toBeDefined();
    expect(f.outstanding).toBeDefined();
  });

  it("only the Owner and the Accountant get the tile; Staff and Sales get none", async () => {
    expect((await dash((await sessionFor("accountant")).cookie)).finance).toBeDefined();
    expect((await dash((await sessionFor("owner")).cookie)).finance).toBeDefined();
    for (const role of ["staff", "sales"] as const) {
      expect((await dash((await sessionFor(role)).cookie)).finance, role).toBeUndefined();
    }
  });
});

describe("what the finance statements read", () => {
  it("2,000 documents: every statement uses its index and the rows read stay in a measured bound", async () => {
    pinClock();
    const inr = await mkReportClient("INR");
    const usd = await mkReportClient("USD");
    const today = istToday();
    const fyFrom = `${fyOfDate(parseIsoDate(today) as never).startYear}-04-01`;
    for (let i = 0; i < 1_900; i++) {
      await addDoc({
        clientId: inr,
        issueDate: i % 2 === 0 ? today : fyFrom,
        lines: [line(100_00)],
        dueDate: i % 3 === 0 ? plus(-3) : plus(9),
      });
    }
    for (let i = 0; i < 100; i++)
      await addDoc({ clientId: usd, currency: "USD", issueDate: plus(-(i % 60)), dueDate: plus(9) });
    const db = env.DB;
    const month = `${today.slice(0, 7)}-01`;
    const stmts = [
      db.prepare(INVOICED_SQL).bind(fyFrom, `${Number(fyFrom.slice(0, 4)) + 1}-03-31`, month),
      db.prepare(OWED_SQL).bind(today),
      db.prepare(OVERDUE_OLDEST_SQL).bind(today),
      db.prepare(PROFORMAS_AWAITING_SQL),
      db.prepare(EXPORT_STAGE_COUNTS_SQL).bind(today),
      db.prepare(EXPORT_NEXT_SQL).bind(today),
    ];
    const results = await db.batch(stmts);
    const reads = results.map((r) => r.meta.rows_read as number);
    // Measured at 2,000 documents, all of them open and issued this financial year (the worst case): an index entry and its row each count, so the invoiced and the
    // owed figures read about two rows a document each, and the oldest overdue, the proformas and the exports read almost nothing. The target, restated by the
    // lead after the early check (2026-10-28), is at most 9,000 rows at 2,000 documents (8,441 measured at the start of M5.5b; no covering index: it cannot cover the
    // invoiced figure and adds rows written; no snapshot: LD80, the figure stays live). A regression test, so a new statement or a lost index fails here.
    expect(
      reads.reduce((a, b) => a + b, 0),
      JSON.stringify(reads),
    ).toBeLessThanOrEqual(9_000);
    expect(reads[2], "the oldest overdue reads a handful of rows, not every overdue one").toBeLessThanOrEqual(
      30,
    );
  }, 180_000);
});
