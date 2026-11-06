// M7.5 (L32, the early check's F1): a GET answered 429 `rate_limited` waits `Retry-After` and is sent again, at most twice, so the export loops
// (`readAll`, `readPages`) finish with every row instead of losing what they read. Writes are never sent again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, RATE_LIMIT_DEFAULT_WAIT_MS, RequestError, retryAfterMs } from "./api.ts";
import { m73Api, readPages } from "./lib/m73-api.ts";
import { readAll, reportsApi } from "./lib/reports-api.ts";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
const LIMITED = { error: { code: "rate_limited", message: "Too many requests. Please try again later." } };
const limited = (retryAfter: string | null = "60") =>
  json(429, LIMITED, retryAfter === null ? {} : { "Retry-After": retryAfter });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs `p` while moving the fake clock on, so every wait of the retry path passes. */
async function settle<T>(p: Promise<T>): Promise<T> {
  const out = p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(60_000);
  const r = await out;
  if (r.ok) return r.v;
  throw r.e;
}

describe("Retry-After [L32]", () => {
  it("reads delta-seconds and an HTTP date, clamps to 0..60 s, and falls back when absent or unreadable", () => {
    expect(retryAfterMs("60")).toBe(60_000);
    expect(retryAfterMs("5")).toBe(5_000);
    expect(retryAfterMs("0")).toBe(0);
    expect(retryAfterMs("3600")).toBe(60_000);
    const now = Date.UTC(2026, 10, 7, 10, 0, 0);
    expect(retryAfterMs(new Date(now + 12_000).toUTCString(), now)).toBe(12_000);
    expect(retryAfterMs(new Date(now - 12_000).toUTCString(), now)).toBe(0);
    expect(retryAfterMs(null)).toBe(RATE_LIMIT_DEFAULT_WAIT_MS);
    expect(retryAfterMs("soon")).toBe(RATE_LIMIT_DEFAULT_WAIT_MS);
    expect(retryAfterMs("-5")).toBe(RATE_LIMIT_DEFAULT_WAIT_MS);
    expect(RATE_LIMIT_DEFAULT_WAIT_MS).toBeLessThanOrEqual(60_000);
  });
});

describe("a rate-limited GET is sent again [L32, ADM-REP-01]", () => {
  it("readAll: a 429 on the second page waits Retry-After, then the read finishes with every row", async () => {
    const meta = { today: "2026-11-07" };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(200, { rows: [{ n: 1 }, { n: 2 }], meta, next: "c1" }))
      .mockResolvedValueOnce(limited("60"))
      .mockResolvedValueOnce(json(200, { rows: [{ n: 3 }], meta, next: "c2" }))
      .mockResolvedValueOnce(limited(null))
      .mockResolvedValueOnce(limited("1"))
      .mockResolvedValueOnce(json(200, { rows: [{ n: 4 }], meta, next: null }));
    vi.stubGlobal("fetch", fetchFn);
    const counts: number[] = [];
    const r = await settle(
      readAll(
        (after) => reportsApi.registers("2026-04-01", "2026-10-31", after),
        (n) => counts.push(n),
      ),
    );
    expect(r?.rows).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
    expect(counts).toEqual([2, 3, 4]);
    expect(fetchFn).toHaveBeenCalledTimes(6);
    // the same page each time: the cursor and method don't change
    expect(fetchFn.mock.calls[1]?.[0]).toBe(fetchFn.mock.calls[2]?.[0]);
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain("after=c1");
    expect(fetchFn.mock.calls[3]?.[0]).toBe(fetchFn.mock.calls[5]?.[0]);
    for (const call of fetchFn.mock.calls) expect(call[1].method).toBe("GET");
  });

  it("the retry waits: nothing is sent again before Retry-After has passed", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(limited("20"))
      .mockResolvedValueOnce(json(200, { rows: [], meta: {}, next: null }));
    vi.stubGlobal("fetch", fetchFn);
    const p = reportsApi.registers("2026-04-01", "2026-10-31");
    await vi.advanceTimersByTimeAsync(19_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await expect(p).resolves.toEqual({ rows: [], meta: {}, next: null });
  });

  it("readPages (the M7.3 export twins): a 429 then 200 finishes with every row", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(limited("60"))
      .mockResolvedValueOnce(json(200, { asOf: "2026-11-07", rows: [{ a: 1 }], totals: [], next: "k" }))
      .mockResolvedValueOnce(limited("60"))
      .mockResolvedValueOnce(json(200, { asOf: "2026-11-07", rows: [{ a: 2 }], totals: null, next: null }));
    vi.stubGlobal("fetch", fetchFn);
    const r = await settle(
      readPages(
        (after) => m73Api.ageingExport(after),
        () => {},
      ),
    );
    expect(r?.rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect(r?.first.totals).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("three 429s in a row: the usual rate_limited error, after two retries", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(limited());
    vi.stubGlobal("fetch", fetchFn);
    const e = await settle(
      readAll(
        (after) => reportsApi.registers("2026-04-01", "2026-10-31", after),
        () => {},
      ),
    ).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RequestError);
    expect((e as RequestError).status).toBe(429);
    expect((e as RequestError).code).toBe("rate_limited");
    expect((e as RequestError).message).toBe("Too many requests. Please try again later.");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("a write answered 429 is never sent again", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(limited("1"));
    vi.stubGlobal("fetch", fetchFn);
    const e = await settle(api.deactivate("u1")).catch((x: unknown) => x);
    expect((e as RequestError).code).toBe("rate_limited");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a 429 that is not our rate_limited answer (another code, or a page without JSON) is not retried", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        json(429, { error: { code: "too_many_attempts", message: "x" } }, { "Retry-After": "1" }),
      )
      .mockResolvedValueOnce(new Response("<html>slow down</html>", { status: 429 }));
    vi.stubGlobal("fetch", fetchFn);
    const a = await settle(reportsApi.registers("2026-04-01", "2026-10-31")).catch((x: unknown) => x);
    expect((a as RequestError).code).toBe("too_many_attempts");
    const b = await settle(reportsApi.registers("2026-04-01", "2026-10-31")).catch((x: unknown) => x);
    expect((b as RequestError).status).toBe(429);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
