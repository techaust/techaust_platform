// The finance Worker's RPC dry run (M6.4 L31, early check 2 finding 4; warm-rpc.ts): the PayPal capture (a payer in the US and in India), a PayPal capture
// event, the sweep's refresh and a new PayPal order run once at start-up on made-up rows and the simulator's made-up answers. Pinned here under workerd's
// global-scope rules (a Request or Response with a body, `fetch`, timers, `AbortSignal.timeout` and random values refused; `Date.now()` reading 0; the same
// set as warm-routes.test.ts and scripts/worker-budget.mjs): every call answers as a real one would, refusing nothing, with every read in the answer book, and
// nothing kept, sent or logged.
import { afterEach, describe, expect, it, vi } from "vitest";
import { payPalOf, transportOf, WARM_PAYPAL_TRANSPORT } from "./gateway/config.ts";
import { payPalTokensMinted } from "./gateway/paypal-token.ts";
import { FINANCE_RPC_WARM } from "./warm-fixtures/finance-rpc.ts";
import type { WarmStatementSeen } from "./warm-routes.ts";
import { type WarmRpcCall, warmIds, warmPayPalFetch, warmRpc, warmRpcAtStartup } from "./warm-rpc.ts";

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

describe("the finance Worker's RPC dry run [L31]", () => {
  it("each entrypoint's code answers as a real call would, under the global-scope rules, refusing nothing", async () => {
    const r = await atGlobalScope(() => warmRpc(FINANCE_RPC_WARM));
    expect(r.value).toEqual([
      "capturePayPalReturn paid",
      // RA-38: a payer in India: recorded pending with its item (the return answers "Checking your payment…").
      "capturePayPalReturn processing",
      "processEvent processed",
      "refreshCheckout processed",
      "createLink link",
    ]);
    expect(r.refused).toBe(0);
  });

  it("every read is in the answer book; the capture writes the confirmed batch for the US payer and the pending one for India's", async () => {
    const seen = new Map<WarmRpcCall, WarmStatementSeen[]>();
    await atGlobalScope(() =>
      warmRpc(FINANCE_RPC_WARM, (call, s) => {
        if (!seen.has(call)) seen.set(call, []);
        seen.get(call)?.push(s);
      }),
    );
    const misses = [...seen.entries()].flatMap(([call, list]) =>
      list.filter((s) => s.read && !s.hit).map((s) => `${call.m}: ${s.sql.slice(0, 80)}`),
    );
    expect(misses).toEqual([]);
    const [us, india] = FINANCE_RPC_WARM.calls;
    const writes = (c: WarmRpcCall | undefined) =>
      c ? (seen.get(c) ?? []).filter((s) => !s.read).map((s) => s.sql) : [];
    // The US payer's capture is put on the invoice (an allocation); India's is held for the Owner (a review item, no allocation).
    expect(writes(us).some((sql) => /INSERT INTO payment_allocations/.test(sql))).toBe(true);
    expect(writes(india).some((sql) => /INSERT (OR IGNORE )?INTO review_items/.test(sql))).toBe(true);
    expect(writes(india).some((sql) => /INSERT INTO payment_allocations/.test(sql))).toBe(false);
    for (const c of FINANCE_RPC_WARM.calls) expect((seen.get(c) ?? []).length, c.m).toBeGreaterThan(3);
  });

  it("answers the same whatever the start-up clock reads (the rows' expiries are far in the future)", async () => {
    const late = Date.UTC(2100, 0, 1) - 86_400_000;
    const r = await atGlobalScope(() => warmRpc(FINANCE_RPC_WARM, undefined, late), late);
    expect(r.value.filter((w) => / (threw|none|retry)$/.test(w))).toEqual([]);
    expect(r.refused).toBe(0);
  });

  it("leaves nothing behind: no log line, no token kept, and the entry's start-up never rejects", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const minted = payPalTokensMinted();
    expect(await warmRpcAtStartup(FINANCE_RPC_WARM)).toBe(5);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    // The made-up token was minted by the dry run and dropped at its end: a real call mints its own.
    expect(payPalTokensMinted()).toBeGreaterThan(minted);
    const poisoned = {
      get calls(): never {
        throw new Error("a broken fixture");
      },
      rows: {},
    } as unknown as typeof FINANCE_RPC_WARM;
    await expect(warmRpcAtStartup(poisoned)).resolves.toBe(0);
  });

  it("the made-up transport is reachable only through its symbol: a real env (string keys) gets none, and no timer is set", async () => {
    // A real env never carries the symbol, so the gateway stays "unset" there whatever the dry run does.
    expect(payPalOf({ PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y" }, "test")).toBeNull();
    expect(transportOf({ ENVIRONMENT: "warm" }, "paypal")).toBe("unset");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const api = payPalOf(
      {
        PAYPAL_CLIENT_ID: "warm-client",
        PAYPAL_CLIENT_SECRET: "warm-keys",
        PAYMENTS_LIVE_ALLOWED: "false",
        [WARM_PAYPAL_TRANSPORT]: warmPayPalFetch(),
      },
      "test",
    );
    expect(api?.blocked).toBeNull();
    expect((await api?.getOrder("NOTASIMULATORORDER1"))?.ok).toBe(false);
    expect(timeout).not.toHaveBeenCalled();
    // A live mode is still refused before any call (rule 7), the dry run's transport included.
    const live = payPalOf(
      {
        PAYPAL_CLIENT_ID: "warm-client",
        PAYPAL_CLIENT_SECRET: "warm-keys",
        PAYMENTS_LIVE_ALLOWED: "false",
        [WARM_PAYPAL_TRANSPORT]: warmPayPalFetch(),
      },
      "live",
    );
    expect(live?.blocked).toBe("live_not_allowed");
  });

  it("its ids are made up from a counter, in the UUIDv7 form", () => {
    const ids = warmIds();
    expect([ids(), ids()]).toEqual([
      "00000000-0000-7000-8000-000000000001",
      "00000000-0000-7000-8000-000000000002",
    ]);
  });
});
