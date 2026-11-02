// The shared HMAC helpers of the gateway hooks [JOB-HOOK-01; M6.2 CPU diagnosis lead decision 5, M6.3 run file B]: one imported key per secret and usage, a cache
// that never grows past 8, a failed import not kept, hex in and out.
import { describe, expect, it } from "vitest";
import { hex32, hmacSignKey, hmacVerifyKey, toHex } from "../src/hmac.ts";

describe("hmac helpers", () => {
  it("the same secret gives the same key object; sign and verify keys are kept apart", async () => {
    const a = await hmacVerifyKey("whsec_a");
    expect(await hmacVerifyKey("whsec_a")).toBe(a);
    const s = await hmacSignKey("whsec_a");
    expect(s).not.toBe(a);
    expect(s.usages).toEqual(["sign"]);
    expect(a.usages).toEqual(["verify"]);
  });

  it("the cache is cleared once it reaches 8 entries, and a key is made again afterwards", async () => {
    const first = await hmacVerifyKey("whsec_first");
    for (let i = 0; i < 9; i++) await hmacVerifyKey(`whsec_fill_${i}`);
    const again = await hmacVerifyKey("whsec_first");
    expect(again).not.toBe(first);
    expect(again.usages).toEqual(["verify"]);
  });

  it("a failed import is not kept: the next call tries again", async () => {
    await expect(hmacVerifyKey("")).rejects.toThrow();
    await expect(hmacVerifyKey("")).rejects.toThrow();
  });

  it("hex: exactly 64 hex characters decode to 32 bytes; anything else is null; bytes encode back in lower case", () => {
    const h = "A".repeat(64);
    const b = hex32(h);
    expect(b?.length).toBe(32);
    expect(toHex(b as Uint8Array)).toBe("a".repeat(64));
    for (const bad of ["", "a".repeat(63), "g".repeat(64), `${"a".repeat(64)}0`])
      expect(hex32(bad)).toBeNull();
  });
});
