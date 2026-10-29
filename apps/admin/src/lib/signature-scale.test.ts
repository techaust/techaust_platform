// FX-3 (A6 1c) [ADM-SET-01]: the signature is scaled down in the browser to fit 800 by 400 pixels, aspect kept, PNG out; an image that fits is drawn
// again as a PNG at its own size (PNG only, docs/13 2026-10-29); an unreadable one is refused. The browser's canvas is replaced by a fake `ImageIo`, so the rules run here.
import { SIGNATURE_MAX_HEIGHT, SIGNATURE_MAX_WIDTH } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import { SIGNATURE_INPUT_MAX, SIGNATURE_MAX } from "./pdf.ts";
import {
  type DecodedImage,
  type ImageIo,
  prepareSignature,
  scaleSignature,
  signatureFit,
} from "./signature-scale.ts";

describe("signatureFit", () => {
  it("is 800 by 400 at most, never larger than the image, and keeps the aspect", () => {
    expect([SIGNATURE_MAX_WIDTH, SIGNATURE_MAX_HEIGHT]).toEqual([800, 400]);
    expect(signatureFit(400, 120)).toEqual({ width: 400, height: 120, scaled: false });
    expect(signatureFit(800, 400)).toEqual({ width: 800, height: 400, scaled: false });
    expect(signatureFit(2400, 1200)).toEqual({ width: 800, height: 400, scaled: true });
    expect(signatureFit(1600, 400)).toEqual({ width: 800, height: 200, scaled: true });
    expect(signatureFit(500, 1000)).toEqual({ width: 200, height: 400, scaled: true });
    expect(signatureFit(801, 1)).toEqual({ width: 800, height: 1, scaled: true });
    expect(signatureFit(10_000, 1)).toEqual({ width: 800, height: 1, scaled: true });
    expect(signatureFit(1, 10_000)).toEqual({ width: 1, height: 400, scaled: true });
    for (const bad of [
      [0, 10],
      [10, -1],
      [Number.NaN, 5],
      [Number.POSITIVE_INFINITY, 5],
    ] as const)
      expect(() => signatureFit(bad[0], bad[1])).toThrow(RangeError);
  });

  it("on a grid of sizes: the result fits the box, keeps the aspect within a pixel, and only shrinks", () => {
    const sides = [1, 2, 3, 7, 99, 399, 400, 401, 799, 800, 801, 1023, 1200, 1999, 2400, 4096, 7777, 20_000];
    for (const w of sides)
      for (const h of sides) {
        const f = signatureFit(w, h);
        expect(f.width).toBeGreaterThanOrEqual(1);
        expect(f.height).toBeGreaterThanOrEqual(1);
        expect(f.width).toBeLessThanOrEqual(Math.min(w, 800));
        expect(f.height).toBeLessThanOrEqual(Math.min(h, 400));
        expect(f.scaled).toBe(w > 800 || h > 400);
        if (f.scaled) {
          // one side is on the box; the other is the exact proportion, rounded
          expect(f.width === 800 || f.height === 400).toBe(true);
          if (f.width === 800) expect(Math.abs(f.height - (h * 800) / w)).toBeLessThanOrEqual(1);
          else expect(Math.abs(f.width - (w * 400) / h)).toBeLessThanOrEqual(1);
        }
      }
  });
});

type Fake = DecodedImage & { closed: boolean };
const io = (width: number, height: number, fail?: "decode" | "draw", pngBytes = 10) => {
  const drawn: [number, number][] = [];
  let made: Fake | null = null;
  const fake: ImageIo<Fake> = {
    decode: async () => {
      if (fail === "decode") throw new Error("broken");
      made = {
        width,
        height,
        closed: false,
        close() {
          this.closed = true;
        },
      };
      return made;
    },
    toPng: async (_image, w, h) => {
      if (fail === "draw") throw new Error("no canvas");
      drawn.push([w, h]);
      return new Blob([new Uint8Array(pngBytes)], { type: "image/png" });
    },
  };
  return { fake, drawn, image: () => made };
};

describe("scaleSignature", () => {
  it("draws an image that fits again as a PNG at its own size (a JPEG becomes a PNG; docs/13 2026-10-29) and frees the decoded image", async () => {
    for (const type of ["image/jpeg", "image/png"]) {
      const file = new Blob([new Uint8Array(5)], { type });
      const t = io(600, 200);
      const r = await scaleSignature(file, t.fake);
      expect(r).toMatchObject({ ok: true, scaled: false, width: 600, height: 200 });
      expect(r.ok && r.file).not.toBe(file);
      expect(r.ok && r.file.type).toBe("image/png");
      expect(t.drawn).toEqual([[600, 200]]);
      expect(t.image()?.closed).toBe(true);
    }
  });

  it("draws a larger one at the fitted size as a PNG", async () => {
    const t = io(2400, 900);
    const r = await scaleSignature(new Blob([new Uint8Array(5)], { type: "image/png" }), t.fake);
    expect(r).toMatchObject({ ok: true, scaled: true, width: 800, height: 300 });
    expect(r.ok && r.file.type).toBe("image/png");
    expect(t.drawn).toEqual([[800, 300]]);
    expect(t.image()?.closed).toBe(true);
  });

  it("an image the browser can't read or draw is refused", async () => {
    const blob = new Blob([new Uint8Array(5)]);
    expect(await scaleSignature(blob, io(10, 10, "decode").fake)).toEqual({
      ok: false,
      reason: "unreadable",
    });
    const t = io(5000, 100, "draw");
    expect(await scaleSignature(blob, t.fake)).toEqual({ ok: false, reason: "unreadable" });
    expect(t.image()?.closed).toBe(true);
    expect(await scaleSignature(blob, io(0, 10).fake)).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("prepareSignature (fix round, lead 2026-10-29: 10 MB in, a PNG of up to 256 KB stored)", () => {
  const MB = 1024 * 1024;
  const file = (size: number, type = "image/jpeg") => new Blob([new Uint8Array(size)], { type });

  it("a 1 MB phone photo of a signature is scaled and handed on for storing as a PNG within 256 KB", async () => {
    // a 3000 by 4000 phone photo (1 MB, over the old 256 KB input cap) draws as a 300 by 400 PNG of 180 KB; the API stores exactly that
    // (worker/settings-signature.test.ts, "a phone photo after the browser's scaling")
    const t = io(3000, 4000, undefined, 180 * 1024);
    const r = await prepareSignature(file(MB), t.fake);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scaled).toBe(true);
    expect(r.file.type).toBe("image/png");
    expect(r.file.size).toBeLessThanOrEqual(SIGNATURE_MAX);
    expect(t.drawn).toEqual([[300, 400]]);
    // the largest input read: exactly 10 MB
    expect((await prepareSignature(file(SIGNATURE_INPUT_MAX), io(3000, 4000).fake)).ok).toBe(true);
  });

  it("an 11 MB file is refused with the wrong-file line before the browser decodes it", async () => {
    const t = io(3000, 4000);
    expect(await prepareSignature(file(11 * MB), t.fake)).toEqual({ ok: false, line: "wrongFile" });
    expect(await prepareSignature(file(SIGNATURE_INPUT_MAX + 1), t.fake)).toEqual({
      ok: false,
      line: "wrongFile",
    });
    expect(t.image()).toBeNull();
  });

  it("refuses another type or an empty file before decoding, and an unreadable image after", async () => {
    const t = io(300, 100);
    expect(await prepareSignature(file(500, "image/webp"), t.fake)).toEqual({ ok: false, line: "wrongFile" });
    expect(await prepareSignature(file(0, "image/png"), t.fake)).toEqual({ ok: false, line: "wrongFile" });
    expect(t.image()).toBeNull();
    expect(await prepareSignature(file(500), io(10, 10, "decode").fake)).toEqual({
      ok: false,
      line: "wrongFile",
    });
  });

  it("applies the 256 KB to the PNG that comes out: one byte over is too detailed, exactly 256 KB goes on", async () => {
    expect(await prepareSignature(file(2 * MB), io(800, 400, undefined, SIGNATURE_MAX + 1).fake)).toEqual({
      ok: false,
      line: "tooDetailed",
    });
    const r = await prepareSignature(file(2 * MB), io(800, 400, undefined, SIGNATURE_MAX).fake);
    expect(r).toMatchObject({ ok: true, scaled: false });
  });
});
