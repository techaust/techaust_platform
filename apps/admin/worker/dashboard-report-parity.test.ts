// M7.3 one source (run file I "Parity", L11, C5): on one fixture, the dashboard v2's invoiced, collected, outstanding and overdue figures, its ageing buckets and its
// previous-month figures equal the reports' for the same period (C1 by month, C9's totals) and M7.2's digest builder (`@techaust/db/digest`). On a pinned day in
// October (previous month September, same FY) and one in April (previous month March, the FY before: the passes then start a month earlier). Invented data only.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import type { RevenueByMonth } from "@techaust/core/reports";
import { digestFiguresOf, digestStatements, digestWindowOf } from "@techaust/db/digest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgeingPage } from "./report-revenue.ts";
import { insert } from "./test-clients.ts";
import { call, pinClock, sessionFor, type TestSession } from "./test-helpers.ts";
import { putTax } from "./test-invoice-types.ts";
import type { J } from "./test-invoices.ts";
import { addDoc, line, mkReportClient } from "./test-reports.ts";

afterEach(() => vi.useRealTimers());

async function pay(
  owner: TestSession,
  o: { clientId: string; currency?: "INR" | "USD"; amount: number; on: string; kind?: "payment" | "tds" },
) {
  const id = uuidv7();
  const kind = o.kind ?? "payment";
  await insert("payments", {
    id,
    client_id: o.clientId,
    kind,
    provider: "manual",
    status: "confirmed",
    currency: o.currency ?? "INR",
    amount_minor: o.amount,
    received_on: o.on,
    mode: kind === "tds" ? null : o.currency === "USD" ? "swift" : "neft",
    tds_section: kind === "tds" ? "194J" : null,
    tds_rate_bp: kind === "tds" ? 1000 : null,
    recorded_by: owner.id,
    recorded_at: 1_000,
    verified_by: owner.id,
    verified_at: 1_000,
  });
  return id;
}

async function refund(
  owner: TestSession,
  o: { paymentId: string; clientId: string; amount: number; on: string },
) {
  const id = uuidv7();
  await insert("payment_refunds", {
    id,
    payment_id: o.paymentId,
    client_id: o.clientId,
    provider: "manual",
    origin: "owner",
    status: "succeeded",
    mode: "neft",
    paid_to: "own_account",
    reason_code: "overpayment",
    currency: "INR",
    amount_minor: o.amount,
    reference_norm: `UTR${id.slice(-10)}`,
    paid_on: o.on,
    requested_by: owner.id,
    requested_at: 1_000,
    attempts: 0,
    settled_at: 1_000,
    settled_on: o.on,
    updated_at: 1_000,
  });
}

/** Invoices, a credit note, payments, a refund and TDS in `prev` (the previous month) and `month` (this one), and open invoices due at several ages before `today`. */
async function fixture(
  owner: TestSession,
  d: { prev: string; month: string; today: string; fyStart: string; ages: number[] },
) {
  const inr = await mkReportClient("INR");
  const usd = await mkReportClient("USD");
  const at = (day: string, n: number) => `${day.slice(0, 8)}${String(n).padStart(2, "0")}`;
  const p0 = await addDoc({
    clientId: inr,
    issueDate: at(d.prev, 3),
    lines: [line(1_000_00)],
    dueDate: at(d.prev, 20),
  });
  await addDoc({ clientId: inr, issueDate: at(d.prev, 10), lines: [line(400_00)], dueDate: d.today });
  await addDoc({
    type: "credit_note",
    clientId: inr,
    issueDate: at(d.prev, 12),
    parentId: p0.id,
    lines: [line(100_00)],
    dueDate: null,
  });
  await addDoc({
    clientId: inr,
    issueDate: at(d.month, 2),
    lines: [line(2_500_00)],
    dueDate: at(d.month, 30),
  });
  await addDoc({
    clientId: usd,
    currency: "USD",
    issueDate: at(d.prev, 5),
    lines: [line(300_00)],
    dueDate: at(d.prev, 25),
  });
  await addDoc({
    clientId: usd,
    currency: "USD",
    issueDate: at(d.month, 1),
    lines: [line(120_00)],
    dueDate: d.today,
  });
  // open documents due 1 to 120 days ago, to fill every ageing bucket (issued on the FY's first day, so they count in the FY's invoiced figure too)
  const base = Date.parse(`${d.today}T00:00:00Z`);
  for (const days of d.ages) {
    const due = new Date(base - days * 86_400_000).toISOString().slice(0, 10);
    await addDoc({ clientId: inr, issueDate: d.fyStart, lines: [line(10_00 * days)], dueDate: due });
  }
  const p1 = await pay(owner, { clientId: inr, amount: 700_00, on: at(d.prev, 15) });
  await pay(owner, { clientId: inr, amount: 300_00, on: at(d.month, 3) });
  await pay(owner, { clientId: inr, kind: "tds", amount: 20_00, on: at(d.month, 4) });
  await pay(owner, { clientId: usd, currency: "USD", amount: 50_00, on: at(d.prev, 28) });
  await refund(owner, { paymentId: p1, clientId: inr, amount: 40_00, on: at(d.prev, 18) });
  await refund(owner, { paymentId: p1, clientId: inr, amount: 10_00, on: at(d.month, 5) });
}

const get = async <T>(path: string, s: TestSession): Promise<T> => {
  const res = await call(path, { cookie: s.cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as T;
};

const byCur = (xs: readonly J[], c: string): J | undefined => xs.find((x) => x.currency === c);

/** The dashboard's finance figures against C1's month rows, C9's totals and the digest, for the pinned day. */
async function checkParity(
  owner: TestSession,
  d: { fy: string; month: string; prevFy: string; prev: string },
) {
  const dash = (await get<J>("/dashboard", owner)).tiles.finance;
  const revenue = await get<RevenueByMonth>(`/reports/revenue?fy=${d.fy}`, owner);
  const prevRevenue =
    d.prevFy === d.fy ? revenue : await get<RevenueByMonth>(`/reports/revenue?fy=${d.prevFy}`, owner);
  const monthRow = revenue.months.find((m) => m.month === d.month.slice(0, 7));
  const prevRow = prevRevenue.months.find((m) => m.month === d.prev.slice(0, 7));
  expect(dash.previousMonth.from.slice(0, 7)).toBe(d.prev.slice(0, 7));

  for (const cur of ["INR", "USD"]) {
    // invoiced: this month, the previous month and the FY
    const asDash = (x: J | undefined) =>
      x ? { documents: x.count, taxableMinor: x.taxableMinor, totalMinor: x.totalMinor } : undefined;
    const pick = (x: J | undefined) =>
      x ? { documents: x.documents, taxableMinor: x.taxableMinor, totalMinor: x.totalMinor } : undefined;
    expect(pick(byCur(dash.invoiced.month, cur)), `${cur} month`).toEqual(
      asDash(byCur(monthRow?.invoiced ?? [], cur)),
    );
    expect(pick(byCur(dash.invoiced.previousMonth, cur)), `${cur} previous month`).toEqual(
      asDash(byCur(prevRow?.invoiced ?? [], cur)),
    );
    const fyInvoiced = revenue.months.flatMap((m) => m.invoiced.filter((x) => x.currency === cur));
    const fySum = fyInvoiced.length
      ? {
          documents: fyInvoiced.reduce((a, x) => a + x.count, 0),
          taxableMinor: fyInvoiced.reduce((a, x) => a + x.taxableMinor, 0),
          totalMinor: fyInvoiced.reduce((a, x) => a + x.totalMinor, 0),
        }
      : undefined;
    expect(pick(byCur(dash.invoiced.fy, cur)), `${cur} FY`).toEqual(fySum);
    // the change is this month less the previous one
    const change = byCur(dash.invoiced.change, cur);
    if (change)
      expect(change.totalMinor).toBe(
        (byCur(dash.invoiced.month, cur)?.totalMinor ?? 0) -
          (byCur(dash.invoiced.previousMonth, cur)?.totalMinor ?? 0),
      );

    // collected (money received less the refunds that went out; TDS apart): this month, the previous month, the FY
    const c1 = (row: typeof monthRow) => byCur(row?.collected ?? [], cur);
    const mc = c1(monthRow);
    const pc = c1(prevRow);
    expect(byCur(dash.collected.month, cur)?.collectedMinor ?? null, `${cur} collected month`).toBe(
      mc && mc.payments > 0 ? mc.collectedMinor : null,
    );
    expect(
      byCur(dash.collected.previousMonth, cur)?.collectedMinor ?? null,
      `${cur} collected previous`,
    ).toBe(pc && pc.payments > 0 ? pc.collectedMinor : null);
    const fyCollected = revenue.months.flatMap((m) => m.collected.filter((x) => x.currency === cur));
    expect(byCur(dash.collected.fy, cur)?.collectedMinor ?? null, `${cur} collected FY`).toBe(
      fyCollected.length ? fyCollected.reduce((a, x) => a + x.collectedMinor, 0) : null,
    );
  }

  // outstanding, overdue and the buckets = the ageing report's totals (C9's first page)
  const ageing = await get<AgeingPage>("/reports/ageing", owner);
  for (const t of ageing.totals ?? []) {
    expect(byCur(dash.outstanding, t.currency)).toEqual({
      currency: t.currency,
      count: Object.values(t.buckets).reduce((a, b) => a + b.count, 0),
      balanceMinor: t.totalMinor,
    });
    expect(byCur(dash.overdue.ageing, t.currency)?.buckets).toEqual(t.buckets);
    const overdue = Object.entries(t.buckets).filter(([b]) => b !== "not_due");
    const o = byCur(dash.overdue.byCurrency, t.currency) as
      | { count: number; balanceMinor: number }
      | undefined;
    expect(o?.balanceMinor ?? 0).toBe(overdue.reduce((a, [, b]) => a + b.balanceMinor, 0));
    expect(o?.count ?? 0).toBe(overdue.reduce((a, [, b]) => a + b.count, 0));
  }
  expect((ageing.totals ?? []).map((t) => t.currency)).toEqual(dash.outstanding.map((x: J) => x.currency));

  // M7.2's digest builder reads the same statements
  const results = await env.DB.batch(digestStatements(env.DB, digestWindowOf(Date.now())));
  const f = digestFiguresOf(results);
  expect(
    f.invoicedMonth.map((x) => ({ currency: x.currency, documents: x.count, totalMinor: x.amountMinor })),
  ).toEqual(
    dash.invoiced.month.map((x: J) => ({
      currency: x.currency,
      documents: x.documents,
      totalMinor: x.totalMinor,
    })),
  );
  expect(
    f.collectedMonth.map((x) => ({ currency: x.currency, collectedMinor: x.amountMinor, count: x.count })),
  ).toEqual(dash.collected.month);
  expect(
    f.overdue.map((x) => ({ currency: x.currency, count: x.count, balanceMinor: x.amountMinor })),
  ).toEqual(dash.overdue.byCurrency);
  return dash;
}

describe("dashboard v2 = the reports = the digest [ADM-DASH-01, ADM-DASH-02, ADM-REP-01, ADM-REP-02; L11]", () => {
  it("in October: the previous month is September of the same FY", async () => {
    await putTax();
    pinClock(Date.parse("2026-10-15T12:00:00.000+05:30"));
    const owner = await sessionFor("owner");
    await fixture(owner, {
      prev: "2026-09-01",
      month: "2026-10-01",
      today: "2026-10-15",
      fyStart: "2026-04-01",
      ages: [1, 30, 31, 60, 61, 90, 91, 120],
    });
    const dash = await checkParity(owner, {
      fy: "2627",
      month: "2026-10-01",
      prevFy: "2627",
      prev: "2026-09-01",
    });
    expect(dash.previousMonth).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    // the fixture fills what it should: both months, every overdue bucket
    expect(dash.invoiced.previousMonth.length).toBe(2);
    const inr = byCur(dash.overdue.ageing, "INR") as { buckets: Record<string, { count: number }> };
    for (const b of ["d1_30", "d31_60", "d61_90", "d90_plus"])
      expect(inr.buckets[b]?.count, b).toBeGreaterThan(0);
  });

  it("in April: the previous month is March of the FY before, and the FY figures don't take it in", async () => {
    await putTax();
    pinClock(Date.parse("2027-04-10T12:00:00.000+05:30"));
    const owner = await sessionFor("owner");
    await fixture(owner, {
      prev: "2027-03-01",
      month: "2027-04-01",
      today: "2027-04-10",
      fyStart: "2027-04-01",
      ages: [5],
    });
    const dash = await checkParity(owner, {
      fy: "2728",
      month: "2027-04-01",
      prevFy: "2627",
      prev: "2027-03-01",
    });
    expect(dash.previousMonth).toEqual({ from: "2027-03-01", to: "2027-03-31" });
    expect(byCur(dash.invoiced.previousMonth, "USD")).toMatchObject({ documents: 1 });
    // FY 2027-28 has only April's documents: March's are the previous FY's
    const fyRevenue = await get<RevenueByMonth>("/reports/revenue?fy=2728", owner);
    expect(fyRevenue.months.find((m) => m.month === "2027-03")).toBeUndefined();
    expect(byCur(dash.invoiced.fy, "USD")).toMatchObject({ documents: 1 });
  });
});
