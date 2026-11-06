// The shared Rate Limiting helpers (M7.5 C2, L2, L5): keyed, purpose-bound keys; the binding's no is the only refusal; a failing limiter lets through.
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Limiter, rateLimitKey, underLimit } from "../src/rate-limit.ts";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY2 = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

afterEach(() => vi.restoreAllMocks());

describe("rateLimitKey", () => {
  it("is `<purpose>:<32 hex>`, stable, keyed by the secret and the purpose, and never holds the value", async () => {
    const k = await rateLimitKey(KEY, "signin", "203.0.113.5");
    expect(k).toMatch(/^signin:[0-9a-f]{32}$/);
    expect(k).toBe(await rateLimitKey(KEY, "signin", "203.0.113.5"));
    expect(k).not.toBe(await rateLimitKey(KEY, "signin", "203.0.113.6"));
    expect(k).not.toBe(await rateLimitKey(KEY2, "signin", "203.0.113.5"));
    expect((await rateLimitKey(KEY, "links", "203.0.113.5")).slice(6)).not.toBe(k.slice(7));
    expect(k).not.toContain("203");
  });
});

describe("underLimit", () => {
  const limiter = (success: boolean) => {
    const seen: string[] = [];
    const l: Limiter = {
      limit: async ({ key }) => {
        seen.push(key);
        return { success };
      },
    };
    return { l, seen };
  };

  it("asks the binding with the key and follows its answer", async () => {
    const yes = limiter(true);
    expect(await underLimit(yes.l, "k1", "test")).toBe(true);
    expect(yes.seen).toEqual(["k1"]);
    const no = limiter(false);
    expect(await underLimit(no.l, "k2", "test")).toBe(false);
    expect(no.seen).toEqual(["k2"]);
  });

  it("no binding (a Worker behind the front) lets the request through", async () => {
    expect(await underLimit(undefined, "k", "test")).toBe(true);
  });

  it("a limiter that throws lets the request through and logs one line with no key or value in it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken: Limiter = {
      limit: async () => {
        throw new TypeError("boom 203.0.113.5");
      },
    };
    expect(await underLimit(broken, "signin:secret-key", "admin.signin")).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      level: "error",
      message: "rate limiter failed",
      what: "admin.signin",
      cause: "TypeError",
    });
    expect(line).not.toContain("secret-key");
    expect(line).not.toContain("203.0.113.5");
  });
});
