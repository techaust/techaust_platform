// FX-3 (A6 1c) [ADM-SET-01]: the signature is scaled down in the browser to fit 800 by 400 pixels, aspect kept, PNG out; an image that fits is drawn
// again as a PNG at its own size (PNG only, docs/13 2026-10-29); an unreadable one is refused. The browser's canvas is replaced by a fake `ImageIo`, so the rules run here.
import { SIGNATURE_MAX_HEIGHT, SIGNATURE_MAX_WIDTH } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import { SIGNATURE_INPUT_MAX, SIGNATURE_MAX } from "./pdf.ts";
import {
  type DecodedImage,
  decodeFitted,
  fittedDecodeMatches,
  fittedDecodeOptions,
  type ImageIo,
  imageHeaderSize,
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

// FX-3 fix round 2 (H): the size comes from the header, so a larger image is decoded straight at its fitted size.
const png = (width: number, height: number) => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
};
/** A JPEG's first segments: optional Exif (in either byte order) with an orientation, an XMP-like APP1, a DQT, then SOF0. */
const jpeg = (width: number, height: number, orientation?: number, little = false) => {
  const parts: number[] = [0xff, 0xd8];
  if (orientation !== undefined) {
    const u16 = (v: number) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
    const u32 = (v: number) =>
      little ? [...u16(v & 0xffff), ...u16(v >>> 16)] : [...u16(v >>> 16), ...u16(v & 0xffff)];
    const tiff = [
      ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...u16(42),
      ...u32(8),
      ...u16(2), // two entries: another tag first, then the orientation
      ...u16(0x010f),
      ...u16(2),
      ...u32(4),
      ...u32(0),
      ...u16(0x0112),
      ...u16(3),
      ...u32(1),
      ...u16(orientation),
      0,
      0,
      ...u32(0),
    ];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    parts.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body);
  }
  const xmp = [...new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0<x/>")];
  parts.push(0xff, 0xe1, (xmp.length + 2) >> 8, (xmp.length + 2) & 255, ...xmp);
  parts.push(0xff, 0xdb, 0, 4, 0, 0); // a (short) DQT
  parts.push(0xff, 0xff); // a fill byte
  parts.push(0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0);
  parts.push(0xff, 0xda, 0, 2);
  return new Uint8Array(parts);
};

describe("imageHeaderSize", () => {
  it("reads a PNG's and a JPEG's size without decoding, a JPEG turned by its Exif orientation", () => {
    expect(imageHeaderSize(png(3000, 4000))).toEqual({ width: 3000, height: 4000 });
    expect(imageHeaderSize(jpeg(4000, 3000))).toEqual({ width: 4000, height: 3000 });
    expect(imageHeaderSize(jpeg(4000, 3000, 1))).toEqual({ width: 4000, height: 3000 });
    expect(imageHeaderSize(jpeg(4000, 3000, 3, true))).toEqual({ width: 4000, height: 3000 });
    // 5 to 8 turn it a quarter: a phone held upright stores 4000 by 3000 and shows 3000 by 4000
    for (const o of [5, 6, 7, 8]) {
      expect(imageHeaderSize(jpeg(4000, 3000, o))).toEqual({ width: 3000, height: 4000 });
      expect(imageHeaderSize(jpeg(4000, 3000, o, true))).toEqual({ width: 3000, height: 4000 });
    }
  });

  it("is null for anything it can't read (the scaling then decodes at full size)", () => {
    expect(imageHeaderSize(new Uint8Array(0))).toBeNull();
    expect(imageHeaderSize(new Uint8Array(64))).toBeNull();
    expect(imageHeaderSize(png(0, 10))).toBeNull();
    expect(imageHeaderSize(jpeg(4000, 3000).slice(0, 20))).toBeNull(); // cut before the frame header
    expect(imageHeaderSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull(); // image data first
    expect(imageHeaderSize(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0, 2]))).toBeNull(); // not a marker
  });
});

describe("decoding straight at the fitted size (FX-3 fix round 2, H)", () => {
  type Made = ImageBitmap & { closed: boolean };
  const bitmap = (width: number, height: number): Made => {
    const b = { width, height, closed: false } as Made;
    b.close = () => {
      b.closed = true;
    };
    return b;
  };
  /**
   * A fake `createImageBitmap`. `shown` is the image as the browser shows it, turned by its orientation; `mode` says what the browser does
   * with the resize options. Honoured, a width alone gives the height the HTML standard does: the shown proportion, rounded up.
   */
  const browser = (shown: [number, number], mode: "honours" | "rejects" | "ignores" | "broken") => {
    const calls: { options: ImageBitmapOptions | undefined }[] = [];
    const made: Made[] = [];
    const create = async (_file: Blob, options?: ImageBitmapOptions) => {
      calls.push({ options });
      if (mode === "broken") throw new DOMException("cannot decode", "InvalidStateError");
      let b = bitmap(...shown);
      if (options?.resizeWidth !== undefined) {
        if (mode === "rejects") throw new TypeError("resize options not supported");
        if (mode === "honours")
          b = bitmap(
            options.resizeWidth,
            options.resizeHeight ?? Math.ceil((options.resizeWidth * shown[1]) / shown[0]),
          );
      }
      made.push(b);
      return b;
    };
    return { create, calls, made };
  };
  // the full-size decode passes no options (re-check of round 3, L1: an older engine may refuse imageOrientation)
  const FULL = { options: undefined };
  const run = (bytes: Uint8Array<ArrayBuffer>, type: string, b: ReturnType<typeof browser>) => {
    const drawn: [number, number][] = [];
    const io: ImageIo<ImageBitmap> = {
      decode: (file, size) => decodeFitted(file, size, b.create),
      toPng: async (_image, w, h) => {
        drawn.push([w, h]);
        return new Blob([new Uint8Array(10)], { type: "image/png" });
      },
    };
    return { drawn, result: scaleSignature(new Blob([bytes], { type }), io) };
  };

  it("asks the browser for the fitted width only (it keeps the turned image's proportions), turned as shown, with high-quality resampling", () => {
    const options = fittedDecodeOptions({ width: 300, height: 400 });
    expect(options).toEqual({ resizeWidth: 300, resizeQuality: "high", imageOrientation: "from-image" });
    expect(options).not.toHaveProperty("resizeHeight");
  });

  it("a match is the fitted width exactly and the fitted height or the one pixel more the browser's rounding up can give", () => {
    const size = { width: 800, height: 300 };
    expect(fittedDecodeMatches({ width: 800, height: 300 }, size)).toBe(true);
    expect(fittedDecodeMatches({ width: 800, height: 301 }, size)).toBe(true);
    for (const [width, height] of [
      [800, 299],
      [800, 302],
      [799, 300],
      [801, 300],
      [300, 800],
      [2400, 900],
    ] as const)
      expect(fittedDecodeMatches({ width, height }, size)).toBe(false);
  });

  it("a 3000 by 4000 photo is decoded once, at 300 by 400 (the options above), and drawn at that size", async () => {
    const b = browser([3000, 4000], "honours");
    const r = run(png(3000, 4000), "image/png", b);
    expect(await r.result).toMatchObject({ ok: true, scaled: true, width: 300, height: 400 });
    expect(b.calls).toEqual([
      { options: { resizeWidth: 300, resizeQuality: "high", imageOrientation: "from-image" } },
    ]);
    expect(r.drawn).toEqual([[300, 400]]);
    expect(b.made.map((m) => m.closed)).toEqual([true]);
  });

  it("the browser's rounding up of the height (one pixel over the fit) still takes the fitted decode, drawn at the fitted size", async () => {
    // 2400 by 901 fits to 800 by 300 (300.33 rounded); the browser makes it 800 by 301 (rounded up)
    const b = browser([2400, 901], "honours");
    const r = run(png(2400, 901), "image/png", b);
    expect(await r.result).toMatchObject({ ok: true, scaled: true, width: 800, height: 300 });
    expect(b.calls).toHaveLength(1);
    expect(b.made.map((m) => [m.width, m.height])).toEqual([[800, 301]]);
    expect(r.drawn).toEqual([[800, 300]]);
  });

  it("an upright phone JPEG (stored 4000 by 3000, Exif 6) is asked for 300 wide, its shown shape, and decoded once", async () => {
    const b = browser([3000, 4000], "honours");
    const r = run(jpeg(4000, 3000, 6), "image/jpeg", b);
    expect(await r.result).toMatchObject({ ok: true, scaled: true, width: 300, height: 400 });
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]?.options).toMatchObject({ resizeWidth: 300, imageOrientation: "from-image" });
    expect(r.drawn).toEqual([[300, 400]]);
  });

  it("a PNG whose orientation chunk turns it the other way from its header falls back to the full-size decode, never stretched", async () => {
    // FX-3 fix round 3 (1): the header says 4000 by 3000 (fitted 533 by 400), but its eXIf chunk (orientation 6) makes the browser show
    // it 3000 by 4000. Asked for 533 wide, it comes back 533 by 711, its own proportions: a mismatch, so the full-size decode (3000 by 4000,
    // turned) is drawn at 300 by 400, upright and unstretched.
    const b = browser([3000, 4000], "honours");
    const r = run(png(4000, 3000), "image/png", b);
    expect(await r.result).toMatchObject({ ok: true, scaled: true, width: 300, height: 400 });
    expect(b.calls).toEqual([
      { options: { resizeWidth: 533, resizeQuality: "high", imageOrientation: "from-image" } },
      FULL,
    ]);
    expect(b.made.map((m) => [m.width, m.height])).toEqual([
      [533, 711],
      [3000, 4000],
    ]);
    expect(r.drawn).toEqual([[300, 400]]);
    // the wrong-shaped bitmap is freed at once, the full-size one after drawing
    expect(b.made.every((m) => m.closed)).toBe(true);
  });

  it("falls back to a full-size decode, drawn smaller, when the browser rejects or ignores the options", async () => {
    for (const mode of ["rejects", "ignores"] as const) {
      const b = browser([2400, 900], mode);
      const r = run(png(2400, 900), "image/png", b);
      expect(await r.result).toMatchObject({ ok: true, scaled: true, width: 800, height: 300 });
      expect(b.calls).toHaveLength(2);
      expect(b.calls[1]).toEqual(FULL);
      expect(r.drawn).toEqual([[800, 300]]);
      // every bitmap made is freed: a wrong-sized one at once, the full-size one after drawing
      expect(b.made.every((m) => m.closed)).toBe(true);
    }
  });

  it("an image that fits, or whose header can't be read, is decoded without resizing; a broken one is still refused", async () => {
    for (const bytes of [png(600, 200), new Uint8Array(5)]) {
      const b = browser([600, 200], "honours");
      const r = run(bytes, "image/png", b);
      expect(await r.result).toMatchObject({ ok: true, scaled: false, width: 600, height: 200 });
      expect(b.calls).toEqual([FULL]);
    }
    const broken = browser([3000, 4000], "broken");
    expect(await run(png(3000, 4000), "image/png", broken).result).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(broken.calls).toHaveLength(2);
  });
});
