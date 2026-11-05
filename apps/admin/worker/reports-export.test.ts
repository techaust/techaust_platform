// M7.3 C6 (ADM-REP-01, -02, -06; run file I "Exports", L6): the CSV twins of revenue per client (C2) and the ageing (C9). The registers' rule: Owner and Accountant
// with a fresh code on every page (`exports.gst`; no code is 403 `step_up_required` and writes nothing), one `report.export` audit row per page with what was
// exported (never a name, a number or an amount), a refused period or tampered cursor 400 and nothing written, and the same rows as the screen's route. Invented data.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ROUTES } from "./guard.ts";
import { encodeCursor } from "./keyset.ts";
import { call, pinClock, rows, sessionFor } from "./test-helpers.ts";
import { putTax } from "./test-invoice-types.ts";
import { type J, json, putCompany } from "./test-invoices.ts";
import { addDoc, line, mkReportClient } from "./test-reports.ts";

const ROLES = ["owner", "staff", "sales", "accountant"] as const;
const auditRows = () =>
  rows<{ summary: string; entity_type: string }>(
    "SELECT summary, entity_type FROM audit_log WHERE action = 'report.export' ORDER BY at, rowid",
  );
const since = async (before: number) => (await auditRows()).slice(before);
const count = async () => (await auditRows()).length;
const EXPORTS = [
  { path: "/reports/revenue/export", screen: "/reports/revenue/clients", query: "fy=2627&currency=INR" },
  { path: "/reports/ageing/export", screen: "/reports/ageing", query: "" },
];

beforeAll(async () => {
  pinClock(); // 2026-10-15, 12:00 IST
  await putCompany();
  await putTax();
  // 52 clients each with an open invoice of the FY, due before today: two pages of each export
  for (let i = 0; i < 52; i++) {
    const c = await mkReportClient("INR");
    await addDoc({
      clientId: c,
      issueDate: "2026-06-10",
      dueDate: "2026-07-10",
      lines: [line(1_000_00 + i)],
    });
  }
});
afterAll(() => vi.useRealTimers());

describe("C6 route rows", () => {
  it("both are GET rows of the invoices Worker under exports.gst with the report.export audit", () => {
    for (const e of EXPORTS) {
      const r = ROUTES.find((x) => x.path === `/api/v1${e.path}`);
      expect(r, e.path).toMatchObject({
        method: "GET",
        access: "exports.gst",
        audit: "report.export",
        on: "invoices",
      });
    }
  });
});

describe("C6 exports [ADM-REP-06]", () => {
  for (const e of EXPORTS)
    it(`${e.path}: Owner and Accountant with a fresh code; Staff and Sales 403; no code is step_up_required; nothing written on a refusal`, async () => {
      const before = await count();
      const got: Record<string, number> = {};
      for (const role of ROLES)
        got[role] = (
          await call(`${e.path}?${e.query}`, { cookie: (await sessionFor(role, { stepUp: true })).cookie })
        ).status;
      expect(got).toEqual({ owner: 200, staff: 403, sales: 403, accountant: 200 });
      const written = await count();
      expect(written - before).toBe(2); // the Owner's and the Accountant's pages
      for (const role of ["owner", "accountant"] as const) {
        const res = await call(`${e.path}?${e.query}`, { cookie: (await sessionFor(role)).cookie });
        expect(res.status, role).toBe(403);
        expect(((await json(res)) as J).error.code).toBe("step_up_required");
      }
      expect((await call(`${e.path}?${e.query}`)).status).toBe(401);
      expect(await count()).toBe(written);
    });

  it("revenue: pages of 50 = the screen's pages, one audit row each; a bad FY, currency or cursor is 400 and writes nothing", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const before = await count();
    const p1 = (await json(
      await call("/reports/revenue/export?fy=2627&currency=INR", { cookie: o.cookie }),
    )) as J;
    expect(p1.rows).toHaveLength(50);
    expect(typeof p1.next).toBe("string");
    const p2 = (await json(
      await call(`/reports/revenue/export?fy=2627&currency=INR&after=${p1.next}`, { cookie: o.cookie }),
    )) as J;
    expect(p2.next).toBeNull();
    const screen1 = (await json(
      await call("/reports/revenue/clients?fy=2627&currency=INR", { cookie: o.cookie }),
    )) as J;
    expect(p1).toEqual(screen1);
    const a = (await since(before)).map((r) => ({ ...JSON.parse(r.summary), entity: r.entity_type }));
    expect(a).toEqual([
      { report: "revenue_clients", fy: "2627", currency: "INR", rows: 50, firstPage: true, entity: "report" },
      {
        report: "revenue_clients",
        fy: "2627",
        currency: "INR",
        rows: p2.rows.length,
        firstPage: false,
        entity: "report",
      },
    ]);
    const mark = await count();
    for (const q of [
      "fy=2628&currency=INR",
      "fy=26&currency=INR",
      "fy=2627&currency=EUR",
      "fy=2627",
      "fy=2627&currency=INR&after=not-a-cursor",
      `fy=2627&currency=INR&after=${encodeCursor({ k: "c", id: "x" })}`,
    ]) {
      expect((await call(`/reports/revenue/export?${q}`, { cookie: o.cookie })).status, q).toBe(400);
    }
    expect(await count()).toBe(mark);
  });

  it("ageing: pages of 50 clients = the screen's, the totals on the first page only, one audit row each with the day; a tampered cursor writes nothing", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const before = await count();
    const p1 = (await json(await call("/reports/ageing/export", { cookie: o.cookie }))) as J;
    expect(new Set(p1.rows.map((r: J) => r.client.id)).size).toBe(50);
    expect(p1.totals).not.toBeNull();
    const p2 = (await json(await call(`/reports/ageing/export?after=${p1.next}`, { cookie: o.cookie }))) as J;
    expect(p2.totals).toBeNull();
    expect(p2.next).toBeNull();
    expect(p1).toEqual((await json(await call("/reports/ageing", { cookie: o.cookie }))) as J);
    const a = (await since(before)).map((r) => JSON.parse(r.summary));
    expect(a).toEqual([
      { report: "ageing", asOf: "2026-10-15", rows: p1.rows.length, firstPage: true },
      { report: "ageing", asOf: "2026-10-15", rows: p2.rows.length, firstPage: false },
    ]);
    const mark = await count();
    for (const q of ["after=x", `after=${encodeCursor({ k: 5, id: "a" })}`])
      expect((await call(`/reports/ageing/export?${q}`, { cookie: o.cookie })).status, q).toBe(400);
    expect(await count()).toBe(mark);
  });
});
