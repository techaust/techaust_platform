// The admin invoices Worker's `GatewayAdvance` dry run (the fourth admin Worker, 2026-11-03, ADM-G-02, ADM-PAY-01; brief D.7, early check finding 7;
// warm-advance.ts): the automatic tax invoice of a proforma paid online runs once at start-up on made-up rows and counter ids. Pinned here under workerd's
// global-scope rules (a Request or Response with a body, `fetch`, timers and random values refused; `Date.now()` reading 0; the set of warm-routes.test.ts and
// warm-rpc.test.ts): the call issues as a real one would, refusing nothing, with every read in the answer book, and nothing kept, sent or logged.
import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceViaRpc } from "./gateway/advance-rpc.ts";
import { type WarmAdvanceCall, warmAdvance, warmAdvanceAtStartup } from "./warm-advance.ts";
import { INVOICES_RPC_WARM } from "./warm-fixtures/invoices-rpc.ts";
import { type WarmStatementSeen, warmEnv } from "./warm-routes.ts";

const REFUSED = "Disallowed operation called within global scope (test)";

/** Runs `fn` under workerd's global-scope rules; the refused operations it asked for are counted. */
async function atGlobalScope<T>(fn: () => Promise<T>, clock = 0): Promise<{ value: T; refused: number }> {
  let refused = 0;
  const refuse = () => {
    refused++;
    throw new Error(REFUSED);
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  const RealResponse = globalThis.Response;
  const RealRequest = globalThis.Request;
  const saved = { setTimeout: globalThis.setTimeout, fetch: globalThis.fetch };
  globalThis.Response = class extends RealResponse {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      if (body !== null && body !== undefined) refuse();
      super(body, init);
    }
    static override json(): Response {
      return refuse();
    }
  } as typeof Response;
  globalThis.Request = class extends RealRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init?.body !== null && init?.body !== undefined) refuse();
      super(input, init);
    }
  } as typeof Request;
  globalThis.setTimeout = refuse as unknown as typeof setTimeout;
  globalThis.fetch = refuse as unknown as typeof fetch;
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(refuse);
  const grv = vi.spyOn(crypto, "getRandomValues").mockImplementation(refuse);
  const uuid = vi.spyOn(crypto, "randomUUID").mockImplementation(refuse);
  try {
    return { value: await fn(), refused };
  } finally {
    globalThis.Response = RealResponse;
    globalThis.Request = RealRequest;
    globalThis.setTimeout = saved.setTimeout;
    globalThis.fetch = saved.fetch;
    timeout.mockRestore();
    grv.mockRestore();
    uuid.mockRestore();
    vi.useRealTimers();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("the invoices Worker's GatewayAdvance dry run [brief D.7]", () => {
  it("the advance issues as a real call would, under the global-scope rules, refusing nothing", async () => {
    expect(INVOICES_RPC_WARM.calls.map((c) => c.m)).toEqual(["issueGatewayAdvance"]);
    const r = await atGlobalScope(() => warmAdvance(INVOICES_RPC_WARM));
    expect(r.value).toEqual(["issueGatewayAdvance issued"]);
    expect(r.refused).toBe(0);
  });

  it("every read is in the answer book; the issue batch is written with the counter's ids, within the 45-statement budget", async () => {
    const seen = new Map<WarmAdvanceCall, WarmStatementSeen[]>();
    await atGlobalScope(() =>
      warmAdvance(INVOICES_RPC_WARM, (call, s) => {
        if (!seen.has(call)) seen.set(call, []);
        seen.get(call)?.push(s);
      }),
    );
    const [call] = INVOICES_RPC_WARM.calls;
    const list = (call && seen.get(call)) ?? [];
    expect(list.filter((s) => s.read && !s.hit).map((s) => s.sql.slice(0, 80))).toEqual([]);
    const writes = list.filter((s) => !s.read).map((s) => s.sql);
    // The issue (the receipt, the allocation and the audit row) is in the one batch: a dry run that stopped early would write none of them.
    expect(
      writes.some((sql) => /INSERT INTO advance_receipts|INSERT INTO payment_allocations/.test(sql)),
    ).toBe(true);
    expect(writes.some((sql) => /INSERT INTO audit_log/.test(sql))).toBe(true);
    expect(list.length).toBeLessThanOrEqual(45);
  });

  it("leaves nothing behind: no log line, nothing on a real queue; the entry's start-up never rejects", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    expect(await warmAdvanceAtStartup(INVOICES_RPC_WARM)).toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const poisoned = {
      get calls(): never {
        throw new Error("a broken fixture");
      },
      rows: {},
    } as unknown as typeof INVOICES_RPC_WARM;
    await expect(warmAdvanceAtStartup(poisoned)).resolves.toBe(0);
    // An empty answer book: the payment is not found, so nothing is issued (and nothing throws).
    expect(await warmAdvance({ calls: INVOICES_RPC_WARM.calls, rows: {} })).toEqual([
      "issueGatewayAdvance not_pending",
    ]);
  });

  it("the finance Worker's dry-run ADMIN_ADVANCE is a stub that answers a made-up result at once and never calls the invoices Worker", async () => {
    const r = await atGlobalScope(() => advanceViaRpc(warmEnv({}), "warm-payment"));
    expect(r.value).toEqual({ result: "issued", number: "WARM/1" });
    expect(r.refused).toBe(0);
  });
});
