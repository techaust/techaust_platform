// The PDF layout fixtures' made-up sample signature (a drawn stroke, not anyone's signature) is encoded by the shared test encoder
// (packages/testing/src/png.ts, test-hardening item 4c). Its bytes are pinned, so the move (and any later change to the encoder) cannot shift the
// fixtures' sealed signature hashes or the visual baselines.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SAMPLE_SIGNATURE_PNG } from "./fixtures/invoice-layout.ts";

describe("the fixtures' sample signature PNG [test-hardening 4c]", () => {
  it("keeps the bytes it had before the encoder moved (896 bytes, SHA-256 pinned)", () => {
    const why =
      "the fixtures' sample signature bytes changed: if Node or its zlib changed (not the drawing or the encoder), check the PDF visual baselines, then re-pin";
    expect(SAMPLE_SIGNATURE_PNG.length, why).toBe(896);
    expect(createHash("sha256").update(SAMPLE_SIGNATURE_PNG).digest("hex"), why).toBe(
      "5fe5e20a14d1d2d88cda02cb630e2072720fb6d1671fb780dd61790f2c052217",
    );
  });
});
