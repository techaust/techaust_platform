// M7.3 C9 (ADM-REP-02; run file I, L7): outstanding and ageing as at today (IST). The bucket edges, the open set (`OWED_SQL`'s: proformas, paid and voided documents
// never), the credit held apart and never netted, the first page's totals = the dashboard's owed figures, keyset pages and the IST day boundary. Invented test data only.
import { addDays, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { OWED_SQL } from "@techaust/db/reports";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeCursor } from "./keyset.ts";
import type { AgeingPage } from "./report-revenue.ts";
import { longSession, today } from "./test-care.ts";
import { insert } from "./test-clients.ts";
import { call, pinClock, rows, type TestSession } from "./test-helpers.ts";
import { addDoc, line, mkReportClient } from "./test-reports.ts";

let owner: TestSession;
const at = (days: number) => toIsoDate(addDays(parseIsoDate(today()) as never, days));
const get = async (q = "") => {
  const res = await call(`/reports/ageing${q}`, { cookie: owner.cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as AgeingPage;
};

let a = "";
let usd = "";
const balances: Record<string, number> = {};

beforeAll(async () => {
  pinClock(); // 2026-10-15, 12:00 IST
  owner = await longSession("owner");
  a = await mkReportClient("INR");
  usd = await mkReportClient("USD");
  for (const [k, due] of [
    ["today", at(0)],
    ["1", at(-1)],
    ["30", at(-30)],
    ["31", at(-31)],
    ["60", at(-60)],
    ["61", at(-61)],
    ["90", at(-90)],
    ["91", at(-91)],
    ["none", null],
  ] as const) {
    const d = await addDoc({ clientId: a, issueDate: "2026-04-10", dueDate: due, lines: [line(1_000_00)] });
    balances[k] = d.computed.totalMinor;
  }
  // never in the ageing: a proforma with a balance, a paid invoice, a voided one
  await addDoc({
    type: "proforma",
    clientId: a,
    issueDate: "2026-04-11",
    dueDate: at(-40),
    lines: [line(5_000_00)],
  });
  await addDoc({
    clientId: a,
    issueDate: "2026-04-12",
    dueDate: at(-40),
    lines: [line(6_000_00)],
    balance: 0,
    status: "paid",
    paid: "total",
  });
  await addDoc({
    clientId: a,
    issueDate: "2026-04-13",
    dueDate: at(-40),
    lines: [line(7_000_00)],
    voided: true,
  });
  await addDoc({
    clientId: usd,
    currency: "USD",
    issueDate: "2026-04-14",
    dueDate: at(-5),
    lines: [line(400_00)],
  });
  // money received and not allocated: the client's credit, shown apart
  await insert("payments", {
    id: uuidv7(),
    client_id: a,
    kind: "payment",
    provider: "manual",
    status: "confirmed",
    currency: "INR",
    amount_minor: 250_00,
    received_on: at(-2),
    mode: "neft",
    recorded_by: owner.id,
    recorded_at: 1_000,
    verified_by: owner.id,
    verified_at: 1_000,
  });
});
afterAll(() => vi.useRealTimers());

describe("GET /reports/ageing (C9) [ADM-REP-02]", () => {
  it("puts each open document in its bucket as at today; proformas, paid and voided never; credit held apart, not netted", async () => {
    const r = await get();
    expect(r.asOf).toBe(today());
    const row = r.rows.find((x) => x.client.id === a && x.currency === "INR");
    const b = (...ks: string[]) => ks.reduce((s, k) => s + (balances[k] ?? 0), 0);
    expect(row?.buckets).toEqual({
      not_due: { count: 2, balanceMinor: b("today", "none") },
      d1_30: { count: 2, balanceMinor: b("1", "30") },
      d31_60: { count: 2, balanceMinor: b("31", "60") },
      d61_90: { count: 2, balanceMinor: b("61", "90") },
      d90_plus: { count: 1, balanceMinor: b("91") },
    });
    expect(row?.totalMinor).toBe(Object.values(balances).reduce((s, x) => s + x, 0));
    expect(row?.creditHeldMinor).toBe(250_00);
    expect(r.rows.find((x) => x.client.id === usd)?.currency).toBe("USD");
    expect(r.rows.some((x) => x.client.id === usd && x.currency === "INR")).toBe(false);
  });

  it("the first page's totals = OWED_SQL's balance and overdue figure, per currency", async () => {
    const r = await get();
    const owed = await rows<{
      currency: string;
      balance: number;
      overdue_balance: number;
      overdue_n: number;
    }>(OWED_SQL, today());
    expect(r.totals?.map((t) => t.currency)).toEqual(owed.map((o) => o.currency));
    for (const t of r.totals ?? []) {
      const o = owed.find((x) => x.currency === t.currency);
      expect(t.totalMinor).toBe(o?.balance);
      const overdue = (["d1_30", "d31_60", "d61_90", "d90_plus"] as const).map((k) => t.buckets[k]);
      expect(overdue.reduce((s, x) => s + x.balanceMinor, 0)).toBe(o?.overdue_balance);
      expect(overdue.reduce((s, x) => s + x.count, 0)).toBe(o?.overdue_n);
    }
  });

  it("pages of 50 clients by id, totals on the first page only, next null at the end; a tampered cursor is 400", async () => {
    for (let i = 0; i < 51; i++) {
      const c = await mkReportClient("INR");
      await addDoc({ clientId: c, issueDate: "2026-04-20", dueDate: at(-3), lines: [line(1_00)] });
    }
    const first = await get();
    const clients = [...new Set(first.rows.map((r) => r.client.id))];
    expect(clients).toHaveLength(50);
    expect([...clients].sort()).toEqual(clients);
    expect(first.next).not.toBeNull();
    const second = await get(`?after=${first.next}`);
    expect(second.totals).toBeNull();
    expect(second.next).toBeNull();
    const all = [...clients, ...new Set(second.rows.map((r) => r.client.id))];
    expect(new Set(all).size).toBe(all.length);
    expect((second.rows[0]?.client.id ?? "") > (clients.at(-1) ?? "")).toBe(true);
    for (const q of [
      "?after=nope",
      `?after=${encodeCursor({ k: 5, id: "x" })}`,
      `?after=${encodeCursor({ k: "c", id: "bad id!" })}`,
    ]) {
      expect((await call(`/reports/ageing${q}`, { cookie: owner.cookie })).status, q).toBe(400);
    }
  });

  it("moves into 1-30 days at IST midnight: 18:29:59Z is still the due day, 18:30:00Z is the next", async () => {
    const z = await mkReportClient("INR");
    await addDoc({ clientId: z, issueDate: "2026-10-01", dueDate: "2026-10-20", lines: [line(1_000_00)] });
    const bucketOf = async () => {
      const pages: AgeingPage["rows"] = [];
      let next: string | null = null;
      do {
        const p = await get(next ? `?after=${next}` : "");
        pages.push(...p.rows);
        next = p.next;
      } while (next);
      return pages.find((r) => r.client.id === z)?.buckets;
    };
    vi.setSystemTime(Date.parse("2026-10-20T18:29:59.000Z"));
    expect((await bucketOf())?.not_due.count).toBe(1);
    vi.setSystemTime(Date.parse("2026-10-20T18:30:00.000Z"));
    const b = await bucketOf();
    expect(b?.not_due.count).toBe(0);
    expect(b?.d1_30.count).toBe(1);
  });
});
