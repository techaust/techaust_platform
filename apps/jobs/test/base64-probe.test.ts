// Probe (M4.5): does this workerd have `Uint8Array.prototype.toBase64`? The attachment path (packages/email `toBase64`) uses it when present;
// the fallback (`btoa` over chunks) costs about 37 ms per MB in Node, far over the Free plan's 10 ms CPU, so the attachment cap depends on this.

import { toBase64 } from "@techaust/email";
import { describe, expect, it } from "vitest";

describe("workerd and base64", () => {
  it("reports whether the native method exists, and the helper is correct either way", () => {
    const native = typeof (new Uint8Array(1) as unknown as { toBase64?: unknown }).toBase64;
    expect(`native toBase64: ${native}`).toBe("native toBase64: function");
    expect(toBase64(new Uint8Array([37, 80, 68, 70]))).toBe("JVBERg==");
    // 5 MB through the helper, timed with the clock workerd allows (it only moves with I/O, so this is a smoke test, not a measurement)
    const big = new Uint8Array(5 * 1024 * 1024).fill(7);
    expect(toBase64(big).length).toBe(Math.ceil(big.length / 3) * 4);
  });
});
