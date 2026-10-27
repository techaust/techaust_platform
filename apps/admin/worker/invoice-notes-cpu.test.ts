// A local proxy for the Free plan's CPU limit (docs/runbooks/cpu-baseline.md) of the M5.3 routes: the wall time of each request through the whole Hono app in workerd with local D1.
// Wall time includes waiting on I/O, so it is an UPPER BOUND of CPU time; the real gate is the staging `cpuTimeMs` reading per milestone (front + API summed, M5.0 LD7). Measures a
// credit note's create (lines, amount, full) on a 100-line invoice with 0 and with 19 earlier notes, its issue with 19 earlier notes, a debit note's create and issue, the IMS answer
// and the GET of an invoice with 20 notes. Asserts only a very loose ceiling so the test is never flaky on a slow machine; the figures go in the builder report.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, sessionFor } from "./test-helpers.ts";
import { currentFy, lutOf, putSwiftBank, putTax } from "./test-invoice-types.ts";
import {
  getInvoice,
  issueInvoice,
  json,
  mkInvoice,
  mkInvoiceClient,
  patchInvoice,
  putBank,
  putCompany,
} from "./test-invoices.ts";
import { draftCredit, draftDebit, mkRegisteredClient, noteRow } from "./test-notes.ts";

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
afterAll(() => {
  console.info(`\nM5.3 wall-time proxy (ms, local workerd):\n${report.join("\n")}`);
});

const BIG_LINES = Array.from({ length: 100 }, (_, i) => ({
  description: `Line ${i} ${"d".repeat(110)}`,
  detail: "x".repeat(200),
  qtyMilli: 1000,
  unit: "fixed",
  rateMinor: 1_000_000 + i,
  sac: "998314",
}));

/** An issued 100-line invoice (a registered client: its credit notes have an IMS status). */
async function bigInvoice(o: Awaited<ReturnType<typeof owner>>) {
  const made = await mkInvoice(o, { client: mkRegisteredClient });
  const doc = await getInvoice(o, made.id);
  const saved = await patchInvoice(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: BIG_LINES });
  if (saved.status !== 200)
    throw new Error(`could not save 100 lines: ${saved.status} ${await saved.text()}`);
  const issued = await issueInvoice(o, made.id);
  if (issued.status !== 200) throw new Error(`could not issue: ${issued.status} ${await issued.text()}`);
  return made;
}

describe("wall-time proxy for CPU of the M5.3 routes [docs/05 §10, NFR p99 ≤ 7 ms]", () => {
  it("credit note create and issue on a 100-line invoice with 0 and 19 earlier notes; a debit note; the IMS answer; the GET with 20 notes", async () => {
    const o = await owner();
    const timed = async (run: () => Promise<Response>, ok = 300) => {
      const t = performance.now();
      const res = await run();
      const text = await res.text();
      const ms = performance.now() - t;
      expect(res.status, text).toBeLessThan(ok);
      return ms;
    };
    const discard = async (id: string) => {
      const doc = await getInvoice(o, id);
      expect(
        (
          await call(`/invoices/${id}?expectedUpdatedAt=${doc.updatedAt}`, {
            method: "DELETE",
            cookie: o.cookie,
          })
        ).status,
      ).toBe(200);
    };

    // 0 earlier notes: create in the three modes (each draft discarded, so the invoice stays untouched)
    const fresh = await bigInvoice(o);
    const create0: Record<string, number[]> = { lines: [], amount: [], full: [] };
    for (let i = 0; i < 5; i++) {
      for (const [mode, body] of [
        [
          "lines",
          {
            mode: "lines",
            lines: [
              { line: i, taxableMinor: 500_000 },
              { line: 50 + i, taxableMinor: 100_000 },
            ],
          },
        ],
        ["amount", { mode: "amount", grossMinor: 59_000_000 }],
        ["full", { mode: "full" }],
      ] as const) {
        let id = "";
        create0[mode]?.push(
          await timed(async () => {
            const r = await draftCredit(o, fresh.id, body);
            id = ((await r.clone().json()) as { id: string }).id;
            return r;
          }, 202),
        );
        await discard(id);
      }
    }
    show("POST /invoices/:id/credit-note, lines (2 lines of 100, 0 earlier notes)", create0.lines ?? []);
    show("POST /invoices/:id/credit-note, amount (100 lines, 0 earlier notes)", create0.amount ?? []);
    show("POST /invoices/:id/credit-note, full (100 lines, 0 earlier notes)", create0.full ?? []);

    // 19 earlier notes (one line each), then the timed requests on the 20th
    const big = await bigInvoice(o);
    for (let i = 0; i < 19; i++) {
      const r = await draftCredit(o, big.id, { mode: "lines", lines: [{ line: i, taxableMinor: 100_000 }] });
      expect(r.status, await r.clone().text()).toBe(201);
      expect((await issueInvoice(o, (await json(r)).id)).status).toBe(200);
    }
    const create19: Record<string, number[]> = { lines: [], amount: [], full: [] };
    const issue19: number[] = [];
    // amount and full first (their drafts are discarded), the lines note last: its issue is the 20th note
    for (const [mode, body] of [
      ["amount", { mode: "amount", grossMinor: 59_000_000 }],
      ["full", { mode: "full" }],
      [
        "lines",
        {
          mode: "lines",
          lines: [
            { line: 60, taxableMinor: 100_000 },
            { line: 61, taxableMinor: 100_000 },
          ],
        },
      ],
    ] as const) {
      let id = "";
      create19[mode]?.push(
        await timed(async () => {
          const r = await draftCredit(o, big.id, body);
          id = ((await r.clone().json()) as { id: string }).id;
          return r;
        }, 202),
      );
      if (mode === "lines") issue19.push(await timed(() => issueInvoice(o, id)));
      else await discard(id);
    }
    show("POST /invoices/:id/credit-note, lines (19 earlier notes)", create19.lines ?? []);
    show("POST /invoices/:id/credit-note, amount (19 earlier notes)", create19.amount ?? []);
    show("POST /invoices/:id/credit-note, full (19 earlier notes)", create19.full ?? []);
    show("POST /invoices/:id/issue, credit note (100 lines, 19 earlier notes)", issue19);

    // the GET of the invoice with its 20 notes, and the IMS answer of one of them
    const get: number[] = [];
    for (let i = 0; i < 6; i++)
      get.push(await timed(() => call(`/invoices/${big.id}`, { cookie: o.cookie })));
    show("GET /invoices/:id (100 lines, 20 notes)", get);
    const note = await json(
      await call(`/invoices?type=credit_note&clientId=${big.clientId}`, { cookie: o.cookie }),
    );
    const first = note.invoices[0].id as string;
    const ims: number[] = [];
    ims.push(
      await timed(async () =>
        call(`/invoices/${first}/ims-status`, {
          cookie: o.cookie,
          body: { expectedUpdatedAt: (await noteRow(first))?.updated_at, status: "accepted" },
        }),
      ),
    );
    show("POST /invoices/:id/ims-status", ims);

    // a debit note: create and issue
    const dnCreate: number[] = [];
    const dnIssue: number[] = [];
    const client = await mkInvoiceClient();
    void client;
    for (let i = 0; i < 4; i++) {
      const inv = await bigInvoice(o);
      let id = "";
      dnCreate.push(
        await timed(async () => {
          const r = await draftDebit(o, inv.id, {
            lines: [
              { line: i, taxableMinor: 100_000 },
              { line: 70, taxableMinor: 50_000 },
            ],
          });
          id = ((await r.clone().json()) as { id: string }).id;
          return r;
        }, 202),
      );
      dnIssue.push(await timed(() => issueInvoice(o, id)));
    }
    show("POST /invoices/:id/debit-note (100 lines)", dnCreate);
    show("POST /invoices/:id/issue, debit note (100 lines)", dnIssue);
    expect(summarise([...(create0.full ?? []), ...issue19, ...get]).worst).toBeLessThan(1500);
  }, 300_000);
});
