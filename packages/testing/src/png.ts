// A tiny RGBA PNG encoder for test fixtures (test-hardening item 4c): the admin e2e sample data (`apps/admin/e2e/sample-data.ts`) and the PDF layout
// fixtures (`packages/pdf/test/fixtures/invoice-layout.ts`) draw their made-up sample signatures with it, so the encoder lives once. Pure, no imports and
// no Node or DOM APIs: the caller passes its own `deflate` (both use `node:zlib` `deflateSync`, the PDF fixture at level 9), so this file type-checks in
// any package. Imported by relative path (no workspace dependency is added). Never used by Worker code.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** The CRC-32 a PNG chunk carries (ISO 3309, as zlib's `crc32`). */
export function pngCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

/** One chunk: the data's length, the four-letter type and the data, and the CRC of type and data. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array([...Array.from(type, (ch) => ch.charCodeAt(0)), ...data]);
  return new Uint8Array([...u32(data.length), ...body, ...u32(pngCrc32(body))]);
}

/** The eight bytes every PNG starts with. */
export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/**
 * `px` (`width` × `height` RGBA pixels, row by row, 4 bytes each) as a PNG: 8 bits per channel, colour type 6 (RGBA), no interlace, every row with filter 0
 * (none), one IDAT of `deflate(raw rows)`, then IEND.
 */
export function rgbaPng(
  width: number,
  height: number,
  px: Uint8Array,
  deflate: (raw: Uint8Array) => Uint8Array,
): Uint8Array {
  if (px.length !== width * height * 4) throw new Error("rgbaPng: px must hold width × height × 4 bytes");
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return new Uint8Array([
    ...PNG_SIGNATURE,
    ...pngChunk("IHDR", new Uint8Array([...u32(width), ...u32(height), 8, 6, 0, 0, 0])),
    ...pngChunk("IDAT", new Uint8Array(deflate(raw))),
    ...pngChunk("IEND", new Uint8Array()),
  ]);
}
