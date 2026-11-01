// The e2e sample data's signature (a made-up ink stroke, not anyone's signature), with no Node imports so the admin unit run (workerd) can pin its
// bytes too (worker/e2e-sample-signature.test.ts; test-hardening early check L2). The caller passes the zlib deflate: `e2e/sample-data.ts` gives Node's
// `deflateSync`, the unit test the runtime's `CompressionStream("deflate")` (the same zlib defaults, so the same bytes).
import { rgbaPng } from "../../../packages/testing/src/png.ts";

/** A 240 × 80 PNG of an ink stroke on transparent: the signature the sample company uploads. */
export function drawSampleSignature(deflate: (raw: Uint8Array) => Uint8Array): Uint8Array {
  const w = 240;
  const h = 80;
  const px = new Uint8Array(w * h * 4);
  for (let t = 0; t <= 1; t += 0.0008) {
    const x = Math.round(16 + t * 208);
    const y = Math.round(42 + Math.sin(t * Math.PI * 6) * (20 - t * 10));
    for (let d = -1; d <= 1; d++) {
      const o = ((y + d) * w + x) * 4;
      px.set([0x14, 0x23, 0x1f, 255], o);
    }
  }
  // the shared test encoder (test-hardening 4c; the bytes are unchanged: 679 bytes, SHA-256 pinned in worker/e2e-sample-signature.test.ts)
  return rgbaPng(w, h, px, deflate);
}
