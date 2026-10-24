import { describe, expect, it, vi } from "vitest";
import { warmPortalAuth } from "../src/warm.ts";

// The portal's start-up warm-up (CPU tuning 3): every step works, and it works under workerd's start-up rules.
describe("portal start-up warm-up", () => {
  it("runs all 11 steps (3 schemas, address, cookie, 3 counter keys, 1 digest, token encoding, URL)", async () => {
    expect(await warmPortalAuth()).toBe(11);
  });

  it("uses nothing a Worker refuses at start-up, prints nothing and sends nothing", async () => {
    // At module top level workerd refuses these with "Disallowed operation called within global scope".
    const refuse = () => {
      throw new Error("Disallowed operation called within global scope");
    };
    const g = globalThis as Record<string, unknown>;
    const saved = { Request: g.Request, Response: g.Response, fetch: g.fetch, setTimeout: g.setTimeout };
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(refuse);
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation(refuse);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    g.Request = refuse;
    g.Response = refuse;
    g.fetch = refuse;
    g.setTimeout = refuse;
    try {
      expect(await warmPortalAuth()).toBe(11);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      Object.assign(g, saved);
      timeout.mockRestore();
      random.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("never throws, even when Web Crypto fails (a warm-up must not stop a Worker from starting)", async () => {
    const sign = vi.spyOn(crypto.subtle, "sign").mockRejectedValue(new Error("no crypto"));
    try {
      const done = await warmPortalAuth();
      expect(done).toBeLessThan(11);
    } finally {
      sign.mockRestore();
    }
  });
});
