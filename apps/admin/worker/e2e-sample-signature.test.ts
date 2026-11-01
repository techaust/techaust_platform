// The admin e2e sample data's made-up signature (a drawn stroke, not anyone's signature; `e2e/sample-signature.ts`) is encoded by the shared test encoder
// (packages/testing/src/png.ts, test-hardening item 4c). Its bytes are pinned here (early check L2), so a change to the drawing or the encoder shows in
// the unit run instead of only in the e2e sample data. The e2e run deflates with Node's `deflateSync`; this run has no Node types, so it deflates
// with the runtime's `CompressionStream("deflate")` (zlib with the same defaults): the pinned bytes are the ones Node made (compared once, 2026-11-01).
import { describe, expect, it } from "vitest";
import { drawSampleSignature } from "../e2e/sample-signature.ts";

const deflate = async (raw: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new Blob([raw.slice()]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );

const hexOf = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

describe("the e2e sample signature PNG [test-hardening 4c, early check L2]", () => {
  it("keeps the bytes it had before the encoder moved (679 bytes, SHA-256 pinned)", async () => {
    // The encoder deflates synchronously: the first pass hands over the raw scanlines, the second encodes them with their deflated form.
    let raw: Uint8Array = new Uint8Array();
    drawSampleSignature((r) => {
      raw = r;
      return new Uint8Array();
    });
    const deflated = await deflate(raw);
    const png = drawSampleSignature(() => deflated);
    const why =
      "the e2e sample signature's bytes changed: if the drawing and the encoder did not change, the runtime's zlib did; check the e2e screens that show it, then re-pin";
    expect(png.length, why).toBe(679);
    expect(await hexOf(png), why).toBe("289eba305785b8213befc0c32b9b534cf3b8a96063f97ba81153e1922798b0ce");
  });
});
