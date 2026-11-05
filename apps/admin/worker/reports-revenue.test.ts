// M7.3 C1 and C2 (ADM-REP-01, -06; run file I): revenue and collections through the routes. The fixture has INR and USD documents, a credit note, a tax-only debit
// note, a TDS entry, a partial refund, a withdrawn, a pending and a rejected payment, a USD payment with and one without its INR amount, and an anonymised client.
// The figures equal the dashboard's own statements on the same database (`INVOICED_SQL`, `COLLECTED_SQL`); the route only renames them. Invented test data only.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import type { RevenueByKey, RevenueByMonth } from "@techaust/core/reports";
import { COLLECTED_SQL } from "@techaust/db/ledger";
import { INVOICED_SQL } from "@techaust/db/reports";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeCursor } from "./keyset.ts";
import type { RevenueClientsPage } from "./report-revenue.ts";
import { insert } from "./test-clients.ts";
import { call, pinClock, rows, sessionFor, type TestSession } from "./test-helpers.ts";
import { addDoc, line, mkReportClient } from "./test-reports.ts";

const FY = { from: "2026-04-01", to: "2027-03-31" };
let owner: TestSession;
let fx: Awaited<ReturnType<typeof build>>;

async function pay(o: {
  clientId: string;
  kind?: "payment" | "tds";
  status?: "confirmed" | "pending_verification";
  currency?: "INR" | "USD";
  amount: number;
  on: string;
  inr?: number | null;
}) {
  const id = uuidv7();
  const kind = o.kind ?? "payment";
  const confirmed = (o.status ?? "confirmed") === "confirmed";
  await insert("payments", {
    id,
    client_id: o.clientId,
    kind,
    provider: "manual",
    status: o.status ?? "confirmed",
    currency: o.currency ?? "INR",
    amount_minor: o.amount,
    received_on: o.on,
    mode: kind === "tds" ? null : o.currency === "USD" ? "swift" : "neft",
    tds_section: kind === "tds" ? "194J" : null,
    tds_rate_bp: kind === "tds" ? 1000 : null,
    inr_received_minor: o.inr ?? null,
    recorded_by: owner.id,
    recorded_at: 1_000,
    verified_by: confirmed ? owner.id : null,
    verified_at: confirmed ? 1_000 : null,
  });
  return id;
}

async function build() {
  const a = await mkReportClient("INR");
  const usd = await mkReportClient("USD");
  const gone = await mkReportClient("INR");
  const inv = await addDoc({ clientId: a, issueDate: "2026-05-10", lines: [line(1_000_00)] });
  const cn = await addDoc({
    type: "credit_note",
    clientId: a,
    issueDate: "2026-06-01",
    parentId: inv.id,
    lines: [line(300_00)],
    dueDate: null,
  });
  // a tax-only debit note ("Tax charged too low"): taxable 0, total = its tax, no round-off
  const dn = await addDoc({
    type: "debit_note",
    clientId: a,
    issueDate: "2026-06-05",
    parentId: inv.id,
    lines: [line(1_00)],
    over: {
      subtotal_minor: 0,
      discount_minor: 0,
      taxable_minor: 0,
      cgst_minor: 9_00,
      sgst_minor: 9_00,
      igst_minor: 0,
      round_off_minor: 0,
      total_minor: 18_00,
      balance_minor: 18_00,
      header_extras: JSON.stringify({ noteOf: { reason: { code: "tax_charged_too_low" } } }),
    },
  });
  const exp = await addDoc({
    clientId: usd,
    currency: "USD",
    issueDate: "2026-08-05",
    lines: [line(500_00)],
  });
  await addDoc({ clientId: gone, issueDate: "2026-07-01", lines: [line(200_00)] });
  await env.DB.prepare(
    "UPDATE clients SET anonymised_at = 5, display_name = 'Anonymised client' WHERE id = ?1",
  )
    .bind(gone)
    .run();

  const p1 = await pay({ clientId: a, amount: 1_000_00, on: "2026-05-20" });
  await pay({ clientId: a, kind: "tds", amount: 20_00, on: "2026-05-21" });
  await pay({ clientId: a, status: "pending_verification", amount: 55_00, on: "2026-05-22" });
  const w = await pay({ clientId: a, amount: 77_00, on: "2026-05-23" });
  await env.DB.prepare(
    "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 2000, withdraw_reason = 'Entered twice' WHERE id = ?1",
  )
    .bind(w, owner.id)
    .run();
  await pay({ clientId: usd, currency: "USD", amount: 300_00, on: "2026-08-20", inr: 25_000_00 });
  await pay({ clientId: usd, currency: "USD", amount: 100_00, on: "2026-09-01" }); // no INR advised
  const r = uuidv7();
  await insert("payment_refunds", {
    id: r,
    payment_id: p1,
    client_id: a,
    provider: "manual",
    origin: "owner",
    status: "succeeded",
    mode: "neft",
    paid_to: "own_account",
    reason_code: "overpayment",
    currency: "INR",
    amount_minor: 100_00,
    reference_norm: `UTR${r.slice(-10)}`,
    paid_on: "2026-06-02",
    requested_by: owner.id,
    requested_at: 1_000,
    attempts: 0,
    settled_at: 1_000,
    settled_on: "2026-06-02",
    updated_at: 1_000,
  });
  return { a, usd, gone, inv, cn, dn, exp };
}

beforeAll(async () => {
  pinClock();
  owner = await sessionFor("owner");
  fx = await build();
});
afterAll(() => vi.useRealTimers());

const get = async <T>(path: string, s: TestSession = owner) => {
  const res = await call(path, { cookie: s.cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as T;
};

describe("GET /reports/revenue (C1) [ADM-REP-01]", () => {
  it("by month: twelve months; invoiced net of credit notes; collected net of the refund, TDS apart; pending, rejected and withdrawn never", async () => {
    const r = await get<RevenueByMonth>("/reports/revenue?fy=2627");
    expect(r).toMatchObject({ by: "month", fy: "2627", from: FY.from, to: FY.to });
    expect(r.months.map((m) => m.month)).toHaveLength(12);
    expect(r.months[0]?.month).toBe("2026-04");
    expect(r.months[11]?.month).toBe("2027-03");
    const may = r.months.find((m) => m.month === "2026-05");
    const mayCollected = may?.collected.find((x) => x.currency === "INR");
    // the fixture's own figures only appear in May and June for INR (no other test writes to this file's database)
    expect(mayCollected).toEqual({
      currency: "INR",
      payments: 1,
      receivedMinor: 1_000_00,
      refundedMinor: 0,
      collectedMinor: 1_000_00,
      tdsMinor: 20_00,
      inrCollectedMinor: 1_000_00,
      inrMissing: 0,
    });
    const june = r.months.find((m) => m.month === "2026-06");
    expect(june?.collected.find((x) => x.currency === "INR")).toMatchObject({
      refundedMinor: 100_00,
      collectedMinor: -100_00,
      payments: 0,
    });
    const juneInvoiced = june?.invoiced.find((x) => x.currency === "INR");
    expect(juneInvoiced?.count).toBe(2); // the credit note and the tax-only debit note
    expect(juneInvoiced?.taxableMinor).toBe(-fx.cn.computed.taxableMinor);
    expect(juneInvoiced?.totalMinor).toBe(-fx.cn.computed.totalMinor + 18_00);
    // USD: the August payment has its INR amount, September's does not, so its INR figure is null with the count
    const aug = r.months.find((m) => m.month === "2026-08");
    expect(aug?.collected.find((x) => x.currency === "USD")).toMatchObject({
      inrCollectedMinor: 25_000_00,
      inrMissing: 0,
    });
    expect(aug?.invoiced.find((x) => x.currency === "USD")?.inrTaxableMinor).toBe(
      fx.exp.computed.inr?.taxableMinor,
    );
    const sep = r.months.find((m) => m.month === "2026-09");
    expect(sep?.collected.find((x) => x.currency === "USD")).toMatchObject({
      inrCollectedMinor: null,
      inrMissing: 1,
    });
  });

  it("Σ months = the dashboard's FY figures (INVOICED_SQL, COLLECTED_SQL) on the same database", async () => {
    const r = await get<RevenueByMonth>("/reports/revenue?fy=2627");
    const invoiced = await rows<{ currency: string; fy_taxable: number; fy_total: number }>(
      INVOICED_SQL,
      FY.from,
      FY.to,
      "2026-10-01",
    );
    const collected = await rows<{ currency: string; collected: number }>(COLLECTED_SQL, FY.from, FY.to);
    for (const cur of ["INR", "USD"]) {
      const inv = r.months.flatMap((m) => m.invoiced.filter((x) => x.currency === cur));
      const col = r.months.flatMap((m) => m.collected.filter((x) => x.currency === cur));
      expect(inv.reduce((s, x) => s + x.taxableMinor, 0)).toBe(
        invoiced.find((x) => x.currency === cur)?.fy_taxable ?? 0,
      );
      expect(inv.reduce((s, x) => s + x.totalMinor, 0)).toBe(
        invoiced.find((x) => x.currency === cur)?.fy_total ?? 0,
      );
      expect(col.reduce((s, x) => s + x.collectedMinor, 0)).toBe(
        collected.find((x) => x.currency === cur)?.collected ?? 0,
      );
    }
  });

  it("by kind and by category: invoiced only (Q2 A), keys of their lists, Σ = the months'", async () => {
    const months = await get<RevenueByMonth>("/reports/revenue?fy=2627");
    const kind = await get<RevenueByKey<string>>("/reports/revenue?fy=2627&by=kind");
    expect(kind.by).toBe("kind");
    expect(kind.rows.every((r) => ["recurring", "project", "other"].includes(r.key))).toBe(true);
    const cat = await get<RevenueByKey<string>>("/reports/revenue?fy=2627&by=category");
    expect(cat.by).toBe("category");
    // this fixture's documents are inserted without lines, so no category row (the category figures are proved in packages/db/test/reports-v2.test.ts)
    expect(cat).toMatchObject({ rows: [], roundOff: [] });
    for (const cur of ["INR", "USD"]) {
      const m = months.months
        .flatMap((x) => x.invoiced.filter((y) => y.currency === cur))
        .reduce((s, x) => s + x.taxableMinor, 0);
      expect(
        kind.rows
          .flatMap((x) => x.invoiced.filter((y) => y.currency === cur))
          .reduce((s, x) => s + x.taxableMinor, 0),
      ).toBe(m);
    }
    expect(JSON.stringify(kind)).not.toMatch(/collected/i);
  });

  it("refuses a bad FY, a bad grouping and no FY", async () => {
    for (const q of ["?fy=2628", "?fy=26", "?fy=2627&by=client", ""]) {
      const res = await call(`/reports/revenue${q}`, { cookie: owner.cookie });
      expect(res.status, q).toBe(400);
    }
    expect(
      (
        (await (await call("/reports/revenue?fy=2628", { cookie: owner.cookie })).json()) as {
          error: { code: string };
        }
      ).error.code,
    ).toBe("period_invalid");
  });
});

describe("GET /reports/revenue/clients (C2) [ADM-REP-01]", () => {
  it("per client: invoiced, collected net of refunds, TDS; the anonymised client is named so; by invoiced total then id", async () => {
    const r = await get<RevenueClientsPage>("/reports/revenue/clients?fy=2627&currency=INR");
    expect(r).toMatchObject({ fy: "2627", currency: "INR", next: null });
    const a = r.rows.find((x) => x.client.id === fx.a);
    expect(a?.collected).toMatchObject({
      receivedMinor: 1_000_00,
      refundedMinor: 100_00,
      collectedMinor: 900_00,
      tdsMinor: 20_00,
      payments: 1,
    });
    expect(a?.invoiced.totalMinor).toBe(fx.inv.computed.totalMinor - fx.cn.computed.totalMinor + 18_00);
    const gone = r.rows.find((x) => x.client.id === fx.gone);
    expect(gone?.client.name).toBe("Anonymised client");
    for (let i = 1; i < r.rows.length; i++) {
      const p = r.rows[i - 1] as RevenueClientsPage["rows"][number];
      const q = r.rows[i] as RevenueClientsPage["rows"][number];
      expect(
        p.invoiced.totalMinor > q.invoiced.totalMinor ||
          (p.invoiced.totalMinor === q.invoiced.totalMinor && p.client.id < q.client.id),
      ).toBe(true);
    }
    expect(r.rows.some((x) => x.client.id === fx.usd)).toBe(false);
    const usd = await get<RevenueClientsPage>("/reports/revenue/clients?fy=2627&currency=USD");
    expect(usd.rows.find((x) => x.client.id === fx.usd)?.collected).toMatchObject({
      inrCollectedMinor: null,
      inrMissing: 1,
    });
  });

  it("pages of at most 50, next null at the end, ties by id, the cursor continues", async () => {
    const many: string[] = [];
    for (let i = 0; i < 52; i++) {
      const c = await mkReportClient("INR");
      many.push(c);
      await addDoc({ clientId: c, issueDate: "2026-11-02", lines: [line(1_00)] }); // equal totals: the order is by id
    }
    const first = await get<RevenueClientsPage>("/reports/revenue/clients?fy=2627&currency=INR");
    expect(first.rows).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const second = await get<RevenueClientsPage>(
      `/reports/revenue/clients?fy=2627&currency=INR&after=${first.next}`,
    );
    expect(second.next).toBeNull();
    const ids = [...first.rows, ...second.rows].map((r) => r.client.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of many) expect(ids).toContain(c);
  });

  it("a tampered cursor, a bad currency or FY is 400 and nothing is written", async () => {
    const before = await rows<{ n: number }>("SELECT count(*) AS n FROM audit_log");
    for (const q of [
      "fy=2627&currency=INR&after=not-a-cursor",
      `fy=2627&currency=INR&after=${encodeCursor({ k: "x", id: "a" })}`,
      `fy=2627&currency=INR&after=${encodeCursor({ k: 5, id: "bad id!" })}`,
      "fy=2627&currency=EUR",
      "fy=2728x&currency=INR",
    ]) {
      const res = await call(`/reports/revenue/clients?${q}`, { cookie: owner.cookie });
      expect(res.status, q).toBe(400);
    }
    expect(await rows<{ n: number }>("SELECT count(*) AS n FROM audit_log")).toEqual(before);
  });
});
