// The admin e2e sample data's made-up signature (a drawn stroke, not anyone's signature; `e2e/sample-data.ts`) is encoded by the shared test encoder
// (packages/testing/src/png.ts, test-hardening item 4c). Its bytes are pinned here, so a change to the encoder or the drawing is seen in the unit run
// instead of only as a moved hash in the e2e sample data.
import { describe, expect, it } from "vitest";
import { sampleSignaturePng } from "../e2e/sample-data.ts";

const hexOf = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

describe("the e2e sample signature PNG [test-hardening 4c, early check L2]", () => {
  it("keeps the bytes it had before the encoder moved (679 bytes, SHA-256 pinned)", async () => {
    const png = sampleSignaturePng();
    const why =
      "the e2e sample signature's bytes changed: if zlib or the runtime changed (not the drawing or the encoder), check the e2e screens that show it, then re-pin";
    expect(png.length, why).toBe(679);
    expect(await hexOf(png), why).toBe("289eba305785b8213befc0c32b9b534cf3b8a96063f97ba81153e1922798b0ce");
  });
});
