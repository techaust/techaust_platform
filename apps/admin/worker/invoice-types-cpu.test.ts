// A local proxy for the Free plan's CPU limit (docs/runbooks/cpu-baseline.md) of the M5.2 routes: the wall time of each request through the whole Hono app in
// workerd with local D1. Wall time includes waiting on I/O, so it is an UPPER BOUND of CPU time; the real gate is the staging `cpuTimeMs` reading per milestone
// (front + API summed, M5.0 LD7). Measures the export invoice's issue at 1 and at 100 lines, a PATCH that sets the exchange rate, and the advance invoice at
// 10 (SAC, rate) groups. Asserts only a very loose ceiling so the test is never flaky on a slow machine.
import { beforeAll, describe, expect, it } from "vitest";
import { call, one, sessionFor } from "./test-helpers.ts";
import { currentFy, lutOf, mkProforma, putSwiftBank, putTax, setFx, todayIso } from "./test-invoice-types.ts";
import {
  getInvoice,
  issueInvoice,
  json,
  mkInvoice,
  mkInvoiceClient,
  mkOverseasClient,
  patchInvoice,
  putBank,
  putCompany,
} from "./test-invoices.ts";

beforeAll(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});

const owner = () => sessionFor("owner", { stepUp: true });
const report: string[] = [];
const summarise = (ms: number[]) => {
  const s = [...ms].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)] as number, worst: s.at(-1) as number };
};
const show = (name: string, ms: number[]) => {
  const r = summarise(ms);
  report.push(`${name}: median ${r.median.toFixed(1)}, worst ${r.worst.toFixed(1)}`);
};

const BIG_LINES = Array.from({ length: 100 }, (_, i) => ({
  description: `Line ${i} ${"d".repeat(110)}`,
  detail: "x".repeat(200),
  qtyMilli: 1000,
  unit: "fixed",
  rateMinor: 1_000 + i,
  sac: "998314",
}));
/** Ten different SACs: ten (SAC, rate) groups, the most the inclusive split takes before it merges them. */
const TEN_GROUPS = Array.from({ length: 10 }, (_, i) => ({
  description: `Work ${i}`,
  qtyMilli: 1000,
  unit: "fixed",
  rateMinor: 100_000 + i * 1_000,
  sac: `99831${i}`,
}));

describe("wall-time proxy for CPU of the M5.2 routes [docs/05 §10, NFR p99 ≤ 7 ms]", () => {
  it("export issue at 1 and 100 lines, a PATCH with the rate, and the advance invoice at 10 groups", async () => {
    const o = await owner();
    const timed = async (run: () => Promise<Response>, ok = 300) => {
      const t = performance.now();
      const res = await run();
      const text = await res.text();
      const ms = performance.now() - t;
      expect(res.status, text).toBeLessThan(ok);
      return ms;
    };

    // export issue, one line
    const one1: number[] = [];
    for (let i = 0; i < 8; i++) {
      const made = await mkInvoice(o, { client: mkOverseasClient });
      expect((await setFx(o, made.id)).status).toBe(200);
      one1.push(await timed(() => issueInvoice(o, made.id)));
    }
    show("POST /invoices/:id/issue, export (1 line)", one1);

    // PATCH that sets the rate (and recomputes the INR view)
    const fx: number[] = [];
    for (let i = 0; i < 8; i++) {
      const made = await mkInvoice(o, { client: mkOverseasClient });
      const doc = await getInvoice(o, made.id);
      fx.push(
        await timed(() =>
          patchInvoice(o, made.id, {
            expectedUpdatedAt: doc.updatedAt,
            fields: { fx: { rate: "83.1234", date: todayIso(), source: "FBIL" } },
          }),
        ),
      );
    }
    show("PATCH /invoices/:id with the rate", fx);

    // export issue, 100 lines
    const big: number[] = [];
    for (let i = 0; i < 5; i++) {
      const made = await mkInvoice(o, { client: mkOverseasClient });
      const doc = await getInvoice(o, made.id);
      expect(
        (await patchInvoice(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: BIG_LINES })).status,
      ).toBe(200);
      expect((await setFx(o, made.id)).status).toBe(200);
      big.push(await timed(() => issueInvoice(o, made.id)));
    }
    show("POST /invoices/:id/issue, export (100 lines)", big);

    // issue a proforma (1 line)
    const pf1: number[] = [];
    for (let i = 0; i < 5; i++) {
      const made = await mkProforma(o);
      pf1.push(await timed(() => issueInvoice(o, made.id)));
    }
    show("POST /invoices/:id/issue, proforma (1 line)", pf1);

    // the advance invoice from a proforma of 10 groups
    const adv: number[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await mkInvoiceClient();
      const made = await mkProforma(o, { clientId: c.clientId });
      const doc = await getInvoice(o, made.id);
      expect(
        (await patchInvoice(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: TEN_GROUPS })).status,
      ).toBe(200);
      expect((await issueInvoice(o, made.id)).status).toBe(200);
      const row = await one<{ updated_at: number; total_minor: number }>(
        "SELECT updated_at, total_minor FROM documents WHERE id = ?",
        made.id,
      );
      const amount = Math.floor((row?.total_minor ?? 0) / 100 / 2) * 100;
      adv.push(
        await timed(() =>
          call(`/invoices/${made.id}/advance-invoice`, {
            cookie: o.cookie,
            body: {
              expectedProformaUpdatedAt: row?.updated_at,
              amountMinor: amount,
              receivedOn: todayIso(),
              reference: `CPU-${i}-${Date.now()}`,
            },
          }),
        ),
      );
    }
    show("POST /invoices/:id/advance-invoice (10 groups)", adv);

    // To read the numbers, swap this line for `expect(report.join(" | ")).toBe("")` and read the failure (console output is not shown).
    expect(report).toHaveLength(5);
    expect(json).toBeDefined();
    // a very loose ceiling: the number to read is printed above, the gate is the staging reading
    expect(summarise(one1).median).toBeLessThan(500);
    expect(summarise(big).median).toBeLessThan(1500);
    expect(summarise(adv).median).toBeLessThan(1500);
  }, 300_000);
});
