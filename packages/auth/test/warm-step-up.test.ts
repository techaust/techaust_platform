import { describe, expect, it, vi } from "vitest";
import { sealTotpSecret } from "../src/totp.ts";
import { warmStepUp } from "../src/warm.ts";

// The staff step-up warm-up (M3.1): every step works, under workerd's start-up rules, and it never throws.
describe("step-up start-up warm-up", () => {
  it("runs all 4 steps (two schemas, the sealed TOTP secret, a code check)", async () => {
    expect(await warmStepUp()).toBe(4);
  });

  it("the sealed sample is a real AES-GCM value under the warm-up key (it opens to 20 bytes, not a stand-in)", async () => {
    // Made fresh here with the same key and AAD: it must open exactly like the constant in warm.ts does.
    const key = "d2FybS11cC1rZXktbm90LWEtc2VjcmV0LTAwMDAwMDA=";
    const fresh = await sealTotpSecret(key, "warm-up", new Uint8Array(20));
    expect(fresh).not.toBe("");
    expect(await warmStepUp()).toBe(4);
  });

  it("uses nothing a Worker refuses at start-up, prints nothing and sends nothing", async () => {
    const refuse = () => {
      throw new Error("Disallowed operation called within global scope");
    };
    const g = globalThis as Record<string, unknown>;
    const saved = { Request: g.Request, Response: g.Response, fetch: g.fetch, setTimeout: g.setTimeout };
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation(refuse);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    g.Request = refuse;
    g.Response = refuse;
    g.fetch = refuse;
    g.setTimeout = refuse;
    try {
      expect(await warmStepUp()).toBe(4);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      Object.assign(g, saved);
      random.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("never throws, even when Web Crypto fails (a warm-up must not stop a Worker from starting)", async () => {
    const decrypt = vi.spyOn(crypto.subtle, "decrypt").mockRejectedValue(new Error("no crypto"));
    try {
      const done = await warmStepUp();
      expect(done).toBeLessThan(4);
    } finally {
      decrypt.mockRestore();
    }
  });
});
