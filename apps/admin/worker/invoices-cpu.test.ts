// A local proxy for the Free plan's CPU limit (docs/runbooks/cpu-baseline.md) of the M5.1 routes: the wall time of each request through the whole Hono
// app in workerd with local D1. Wall time includes waiting on I/O, so it is an UPPER BOUND of CPU time; the real gate is the staging `cpuTimeMs`
// reading per milestone (front + API summed, M5.0 LD7). Prints the median and worst of each; asserts only a very loose ceiling so the test is never
// flaky on a slow machine. Also proves the warm-up samples of the new schemas parse, and that an issued invoice verifies against its own seal.

import { env } from "cloudflare:workers";
import { loadDocument, verifyInvoiceSealed } from "@techaust/db/documents";
import { beforeAll, describe, expect, it } from "vitest";
import { warmInvoices } from "./invoice-warm.ts";
import { call, sessionFor } from "./test-helpers.ts";
import {
  getInvoice,
  issueInvoice,
  json,
  mkInvoice,
  mkInvoiceClient,
  patchInvoice,
  putBank,
  putCompany,
  voidInvoice,
} from "./test-invoices.ts";

beforeAll(async () => {
  await putCompany();
  await putBank();
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

describe("wall-time proxy for CPU of the M5.1 routes [docs/05 §10, NFR p99 ≤ 7 ms]", () => {
  it("issue at 1 and at 100 lines, void, read and list", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const timed = async (run: () => Promise<Response>) => {
      const t = performance.now();
      const res = await run();
      const text = await res.text();
      const ms = performance.now() - t;
      expect(res.status, text).toBeLessThan(300);
      return ms;
    };

    // issue, one line
    const one1: number[] = [];
    for (let i = 0; i < 8; i++) {
      const made = await mkInvoice(o, { clientId: c.clientId });
      one1.push(await timed(() => issueInvoice(o, made.id)));
    }
    show("POST /invoices/:id/issue (1 line)", one1);

    // issue, 100 lines (a cap-sized invoice)
    const big: number[] = [];
    const save: number[] = [];
    const read: number[] = [];
    for (let i = 0; i < 5; i++) {
      const made = await mkInvoice(o, { clientId: c.clientId });
      const doc = await getInvoice(o, made.id);
      save.push(
        await timed(() => patchInvoice(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: BIG_LINES })),
      );
      read.push(await timed(() => call(`/invoices/${made.id}`, { cookie: o.cookie })));
      big.push(await timed(() => issueInvoice(o, made.id)));
    }
    show("PATCH /invoices/:id (100 lines)", save);
    show("GET /invoices/:id (100 lines, draft)", read);
    show("POST /invoices/:id/issue (100 lines)", big);

    // void
    const voids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const made = await mkInvoice(o, { clientId: c.clientId });
      expect((await issueInvoice(o, made.id)).status).toBe(200);
      voids.push(await timed(() => voidInvoice(o, made.id)));
    }
    show("POST /invoices/:id/void", voids);

    // list: 25 rows
    const list: number[] = [];
    for (let i = 0; i < 10; i++)
      list.push(await timed(() => call("/invoices?limit=25", { cookie: o.cookie })));
    show("GET /invoices (25 rows)", list);

    // To read the numbers, swap this line for `expect(report.join(" | ")).toBe("")` and read the failure (console output is not shown).
    expect(report).toHaveLength(6);
    // a very loose ceiling: the number to read is printed above, the gate is the staging reading
    expect(summarise(one1).median).toBeLessThan(500);
    expect(summarise(big).median).toBeLessThan(1500);
  }, 240_000);
});

describe("start-up warm-up and the seal", () => {
  it("every warm-up sample of the invoice schemas parses", () => {
    expect(warmInvoices()).toBe(7);
  });

  it("an issued invoice verifies against its own seal: the content hash and the snapshot hash worked out again from its rows", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const bundle = await loadDocument(env.DB, made.id);
    expect(bundle).not.toBeNull();
    // `loadDocument` reads the terms text too; the verifier needs only the reference
    const check = await verifyInvoiceSealed(bundle as NonNullable<typeof bundle>);
    expect(check).toEqual({ content: true, snapshot: true });
    // a changed row no longer verifies
    const doc = await json(await call(`/invoices/${made.id}`, { cookie: o.cookie }));
    expect(doc.frozen).toBe(true);
    const tampered = structuredClone(bundle as NonNullable<typeof bundle>);
    tampered.lines[0] = { ...(tampered.lines[0] as (typeof tampered.lines)[number]), rate_minor: 1 };
    expect((await verifyInvoiceSealed(tampered))?.content).toBe(false);
    tampered.document.issue_date = "2020-01-01";
    expect((await verifyInvoiceSealed(tampered))?.snapshot).toBe(false);
  });
});
