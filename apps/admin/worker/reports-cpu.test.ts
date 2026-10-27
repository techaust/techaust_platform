// A local proxy for the Free plan's CPU limit (docs/runbooks/cpu-baseline.md) of the M5.5b routes: the wall time of each request through the whole Hono app in workerd with local D1.
// Wall time includes waiting on I/O, so it is an UPPER BOUND of CPU time; the real gate is the staging `cpuTimeMs` reading per milestone (front + API summed, M5.0 LD7). Measures a register
// page of 50 documents of 100 lines and 10 rates each (the worst page), the EDF and realisation pages, a statement page of 50 lines and the dashboard at 2,000 documents. Asserts only a very
// loose ceiling so the test is never flaky on a slow machine; the figures go in the builder report.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, sessionFor } from "./test-helpers.ts";
import { putTax } from "./test-invoice-types.ts";
import { putCompany } from "./test-invoices.ts";
import { addDoc, line, mkReportClient } from "./test-reports.ts";

const report: string[] = [];
const summarise = (ms: number[]) => {
  const s = [...ms].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)] as number, worst: s.at(-1) as number };
};
afterAll(() => console.info(`\nM5.5b wall-time proxy (ms, local workerd):\n${report.join("\n")}`));

const RATES = [0, 100, 250, 500, 1200, 1800, 2800, 4000, 600, 900] as const;
const BIG = Array.from({ length: 100 }, (_, i) => line(1_000_00 + i, { gstRateBp: RATES[i % 10] as number }));

beforeAll(async () => {
  await putCompany();
  await putTax();
});

/** Time `n` calls of one request: each answer must be ok. */
async function time(name: string, path: string, cookie: string, n = 5, ceiling = 1_500) {
  const ms: number[] = [];
  let bytes = 0;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    const res = await call(path, { cookie });
    const text = await res.text();
    ms.push(performance.now() - t);
    expect(res.status, text).toBe(200);
    bytes = text.length;
  }
  const r = summarise(ms);
  report.push(`${name}: median ${r.median.toFixed(1)}, worst ${r.worst.toFixed(1)}, ${bytes} bytes`);
  expect(r.median, name).toBeLessThan(ceiling);
}

describe("wall-time proxy for CPU of the M5.5b routes [docs/05 §10, NFR p99 ≤ 7 ms]", () => {
  it("a register page of 50 documents x 100 lines x 10 rates", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const c = await mkReportClient("INR");
    for (let i = 0; i < 50; i++) await addDoc({ clientId: c, issueDate: "2026-10-05", lines: BIG });
    const first = await call("/reports/registers?from=2026-10-01&to=2026-10-31", { cookie: o.cookie });
    const body = (await first.json()) as { rows: { rates: unknown[] }[] };
    expect(body.rows).toHaveLength(50);
    expect(body.rows[0]?.rates).toHaveLength(10);
    await time(
      "register page (50 x 100 lines x 10 rates)",
      "/reports/registers?from=2026-10-01&to=2026-10-31",
      o.cookie,
    );
    await time(
      "an empty realisation list (the cost of a request with no rows: the baseline)",
      "/reports/realisation?show=all",
      (await sessionFor("owner")).cookie,
    );
  }, 300_000);

  it("the EDF month, the realisation list and a statement page of 50 lines", async () => {
    const o = await sessionFor("owner");
    const u = await mkReportClient("USD");
    const c = await mkReportClient("INR");
    for (let i = 0; i < 50; i++)
      await addDoc({ clientId: u, currency: "USD", issueDate: "2026-11-10", lines: BIG.slice(0, 20) });
    for (let i = 0; i < 52; i++)
      await addDoc({ clientId: c, issueDate: "2026-12-10", lines: [line(100_00)] });
    await time("EDF month page (50 exports of 20 lines)", "/reports/edf?month=2026-11", o.cookie);
    await time("realisation page (50 exports)", "/reports/realisation", o.cookie);
    await time(
      "statement page (50 lines)",
      `/clients/${c}/statement?from=2026-12-01&to=2026-12-31`,
      o.cookie,
    );
  }, 300_000);

  it("the dashboard at 2,000 documents (the finance tile among the others)", async () => {
    const o = await sessionFor("owner");
    const c = await mkReportClient("INR");
    const today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
    for (let i = 0; i < 1_900; i++)
      await addDoc({ clientId: c, issueDate: today, lines: [line(100_00)], dueDate: "2026-01-01" });
    await time("dashboard (2,000 documents)", "/dashboard", o.cookie, 5, 3_000);
  }, 300_000);
});
