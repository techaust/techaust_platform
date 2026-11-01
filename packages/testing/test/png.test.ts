// The shared test PNG encoder (test-hardening item 4c). The two fixtures that use it (the admin e2e sample signature and the PDF layout fixtures' signature)
// produced the same bytes before and after the move (SHA-256 compared; the PDF one is pinned in packages/pdf/test/sample-signature.test.ts).
import { describe, expect, it } from "vitest";
import { PNG_SIGNATURE, pngChunk, pngCrc32, rgbaPng } from "../src/png.ts";

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const be32 = (b: Uint8Array, o: number) =>
  (((b[o] as number) << 24) |
    ((b[o + 1] as number) << 16) |
    ((b[o + 2] as number) << 8) |
    (b[o + 3] as number)) >>>
  0;

describe("rgbaPng [test-hardening 4c]", () => {
  it("CRC-32 is zlib's (the standard check value and the IEND chunk's)", () => {
    expect(pngCrc32(ascii("123456789"))).toBe(0xcbf43926);
    expect(pngCrc32(ascii("IEND"))).toBe(0xae426082);
  });

  it("a chunk is length, type and data, then the CRC of type and data", () => {
    const c = pngChunk("tEXt", ascii("ab"));
    expect([...c]).toEqual([
      0,
      0,
      0,
      2,
      ...ascii("tEXt"),
      0x61,
      0x62,
      ...[0, 0, 0, 0].map((_, i) => c[10 + i]),
    ]);
    expect(be32(c, 10)).toBe(pngCrc32(ascii("tEXtab")));
    expect([...pngChunk("IEND", new Uint8Array())]).toEqual([
      0,
      0,
      0,
      0,
      ...ascii("IEND"),
      0xae,
      0x42,
      0x60,
      0x82,
    ]);
  });

  it("lays out signature, IHDR (8-bit RGBA), one IDAT of the filtered rows, IEND", () => {
    const w = 2;
    const h = 2;
    const px = Uint8Array.from({ length: w * h * 4 }, (_, i) => i + 1);
    let seen: Uint8Array | null = null;
    const png = rgbaPng(w, h, px, (raw) => {
      seen = raw;
      return raw; // identity: lets the test read the rows back
    });
    // every row starts with filter 0, then its pixels
    expect([...(seen as unknown as Uint8Array)]).toEqual([0, ...px.subarray(0, 8), 0, ...px.subarray(8, 16)]);
    expect([...png.subarray(0, 8)]).toEqual([...PNG_SIGNATURE]);
    expect(be32(png, 8)).toBe(13);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
    expect([...png.subarray(16, 29)]).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
    const idat = 8 + 25;
    expect(be32(png, idat)).toBe(18);
    expect(String.fromCharCode(...png.subarray(idat + 4, idat + 8))).toBe("IDAT");
    expect([...png.subarray(png.length - 12)]).toEqual([...pngChunk("IEND", new Uint8Array())]);
    expect(png.length).toBe(8 + 25 + 12 + 18 + 12);
  });

  it("refuses pixels of the wrong length", () => {
    expect(() => rgbaPng(2, 2, new Uint8Array(15), (r) => r)).toThrow(/width × height × 4/);
  });
});
