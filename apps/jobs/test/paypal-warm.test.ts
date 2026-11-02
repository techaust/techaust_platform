// The PayPal webhook's start-up dry run (M6.4 L31, early check 2 finding 4; JOB-HOOK-03; apps/jobs/src/warm-paypal.ts): one made-up event through the hook's own
// path at start-up. Pinned here under workerd's global-scope rules (a Request or Response with a body, `fetch`, timers, `AbortSignal.timeout` and random values
// refused, `Date.now()` reading 0; the same set as scripts/worker-budget.mjs). WebCrypto's RSA `importKey("spki")` and `verify` are allowed there: checked in
// real local workerd 1.20261001.1 on 2026-11-02 (a module whose top level imported this made-up certificate's key and verified this event's signature: "ok",
// "true"; `getRandomValues`, `AbortSignal.timeout` and a Response with a body threw "Disallowed operation called within global scope"), and spied on below.
import { describe, expect, it, vi } from "vitest";
import { certKeyFor, resetPayPalCertCache } from "../src/hooks/paypal.ts";
import { type WarmPayPalSeen, warmPayPalHook } from "../src/warm-paypal.ts";

const REFUSED = "Disallowed operation called within global scope (test)";

/** Runs `fn` under workerd's global-scope rules; the refused operations it asked for are counted. */
async function atGlobalScope<T>(fn: () => Promise<T>): Promise<{ value: T; refused: number }> {
  let refused = 0;
  const refuse = () => {
    refused++;
    throw new Error(REFUSED);
  };
  // Workerd's start-up clock reads 0 (faked before the timers are refused).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  const g = globalThis as Record<string, unknown>;
  const saved = { Request: g.Request, Response: g.Response, fetch: g.fetch, setTimeout: g.setTimeout };
  const RealResponse = globalThis.Response;
  const RealRequest = globalThis.Request;
  g.Response = class extends RealResponse {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      if (body !== null && body !== undefined) refuse();
      super(body, init);
    }
  };
  g.Request = class extends RealRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init?.body !== null && init?.body !== undefined) refuse();
      super(input, init);
    }
  };
  g.fetch = refuse;
  g.setTimeout = refuse;
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(refuse);
  const random = vi.spyOn(crypto, "getRandomValues").mockImplementation(refuse);
  const uuid = vi.spyOn(crypto, "randomUUID").mockImplementation(refuse);
  try {
    return { value: await fn(), refused };
  } finally {
    Object.assign(g, saved);
    vi.useRealTimers();
    timeout.mockRestore();
    random.mockRestore();
    uuid.mockRestore();
  }
}

describe("the PayPal webhook's start-up dry run [L31, JOB-HOOK-03]", () => {
  it("runs the whole path under the global-scope rules: verified with WebCrypto, parsed, one insert-and-read batch, one message; refuses nothing", async () => {
    const importKey = vi.spyOn(crypto.subtle, "importKey");
    const verify = vi.spyOn(crypto.subtle, "verify");
    const log = vi.spyOn(console, "log");
    let seen: WarmPayPalSeen | undefined;
    try {
      const r = await atGlobalScope(() => warmPayPalHook((s) => (seen = s)));
      expect(r.value).toBe(1);
      expect(r.refused).toBe(0);
      expect(seen).toEqual({ status: 200, o: null, statements: 2, sent: 1 });
      expect(importKey).toHaveBeenCalledWith("spki", expect.anything(), expect.anything(), false, ["verify"]);
      expect(await verify.mock.results[0]?.value).toBe(true);
      expect(log).not.toHaveBeenCalled();
    } finally {
      importKey.mockRestore();
      verify.mockRestore();
      log.mockRestore();
    }
  });

  it("never enters the hook's certificate cache: its certificate URL is still fetched afterwards (and only through the allow-listed fetch)", async () => {
    resetPayPalCertCache();
    expect(await warmPayPalHook()).toBe(1);
    const fetched: string[] = [];
    const f = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return new Response("not a certificate", { status: 404 });
    }) as typeof fetch;
    const url = "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-warmup-madeup-0001";
    expect(await certKeyFor(url, Date.now(), f)).toBeNull();
    expect(fetched).toEqual([url]);
    resetPayPalCertCache();
  });
});
