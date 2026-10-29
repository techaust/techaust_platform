// The signature image is scaled down in the browser before it uploads (FX-3, A6 1c; ADM-SET-01): an image larger than 800 by 400 pixels (core
// SIGNATURE_MAX_WIDTH and _HEIGHT) is drawn onto a canvas that fits inside that box, the aspect kept, and sent as a PNG. Every other image is
// drawn again as a PNG at its own size (PNG only, docs/13 2026-10-29: a JPEG included). The API refuses anything larger and any JPEG
// (worker/settings-signature.ts), so the PDF's integrity check never inflates megabytes of pixels and always meets Flate data. The drawing goes
// through `ImageIo`, so the rules are tested without a browser. A larger image is decoded straight at its fitted size (fix round 2, H:
// `imageHeaderSize`, `decodeFitted`), so a phone photo's full pixels are never held in memory.
import { SIGNATURE_MAX_HEIGHT, SIGNATURE_MAX_WIDTH } from "@techaust/core/settings";
import { SIGNATURE_MAX, signatureFileOk } from "./pdf.ts";

/** The size an image of `width` by `height` takes inside the box: never larger than it was, aspect kept, at least 1 pixel each way. */
export function signatureFit(
  width: number,
  height: number,
  maxWidth = SIGNATURE_MAX_WIDTH,
  maxHeight = SIGNATURE_MAX_HEIGHT,
): { width: number; height: number; scaled: boolean } {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)))
    throw new RangeError(`Not an image size: ${width} by ${height}`);
  if (width <= maxWidth && height <= maxHeight) return { width, height, scaled: false };
  // The tighter side decides; the other is rounded and kept inside the box (a rounding up never passes it).
  if (width * maxHeight >= height * maxWidth) {
    return {
      width: maxWidth,
      height: Math.min(maxHeight, Math.max(1, Math.round((height * maxWidth) / width))),
      scaled: true,
    };
  }
  return {
    width: Math.min(maxWidth, Math.max(1, Math.round((width * maxHeight) / height))),
    height: maxHeight,
    scaled: true,
  };
}

/** How much of the file is read for its size: a phone photo's Exif, ICC and XMP segments come before the frame header. */
export const HEADER_READ = 1024 * 1024;

const be16 = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const be32 = (b: Uint8Array, at: number) => be16(b, at) * 65536 + be16(b, at + 2);

/** A JPEG's Exif orientation (1 to 8) from an APP1 segment's body, or 1 when there is none. */
function exifOrientation(b: Uint8Array, start: number, end: number): number {
  // "Exif\0\0", then a TIFF header: the byte order, 42, and the offset of the first directory
  if (end - start < 14 || be32(b, start) !== 0x45786966 || be16(b, start + 4) !== 0) return 1;
  const tiff = start + 6;
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  if (!little && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return 1;
  const u16 = (at: number) => (little ? (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) : be16(b, at));
  const u32 = (at: number) => (little ? u16(at) + u16(at + 2) * 65536 : be32(b, at));
  const dir = tiff + u32(tiff + 4);
  if (dir + 2 > end) return 1;
  const count = u16(dir);
  for (let n = 0; n < count; n++) {
    const entry = dir + 2 + n * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/**
 * A PNG's or JPEG's size from its header, as the browser shows it (a JPEG's Exif orientation 5 to 8 turns it a quarter, so its sides
 * swap), without decoding a pixel; `null` when the header can't be read (the scaling then decodes at full size, as before).
 */
export function imageHeaderSize(b: Uint8Array): { width: number; height: number } | null {
  const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  // PNG: the signature, then the IHDR chunk with the width and height
  if (b.length >= 24 && be32(b, 0) === 0x89504e47 && be32(b, 4) === 0x0d0a1a0a && be32(b, 12) === 0x49484452)
    return ok(be32(b, 16), be32(b, 20));
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  // JPEG: walk the segments to the frame header (SOF0 to SOF15, other than DHT, JPG and DAC), noting the Exif orientation on the way
  let orientation = 1;
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // the image data before any frame header
    const length = be16(b, at + 2);
    if (length < 2) return null;
    const body = at + 4;
    const end = at + 2 + length;
    if (marker === 0xe1 && orientation === 1) orientation = exifOrientation(b, body, Math.min(end, b.length));
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (body + 5 > b.length) return null;
      const height = be16(b, body + 1);
      const width = be16(b, body + 3);
      return orientation >= 5 ? ok(height, width) : ok(width, height);
    }
    at = end;
  }
  return null;
}

/** A decoded image: its size, and a way to free it. */
export type DecodedImage = { readonly width: number; readonly height: number; close(): void };

/** The browser parts, passed in so the rules run in a test. */
export type ImageIo<I extends DecodedImage = DecodedImage> = {
  /** The image decoded; at `size` already (the browser scales while decoding) when one is given and the browser can. */
  decode(file: Blob, size?: { width: number; height: number }): Promise<I>;
  /** The image drawn at `width` by `height`, as PNG bytes. */
  toPng(image: I, width: number, height: number): Promise<Blob>;
};

export type ScaledSignature =
  | { ok: true; file: Blob; scaled: boolean; width: number; height: number }
  | { ok: false; reason: "unreadable" };

/**
 * The file to upload: always a PNG that fits (docs/13, 2026-10-29: every image, a JPEG or a PNG that already fits included, is drawn again as
 * a PNG, so the stored signature's pixels are Flate data the PDF integrity check can follow; it also leaves out any metadata the original
 * carried). `scaled` says whether the size changed. An image the browser can't read is `unreadable`.
 * FX-3 fix round 2 (H): the size is read from the header first, so a larger image is decoded straight at its fitted size (a 12 MP photo
 * never takes its full 48 MB of pixels); when the header can't be read, or the browser decodes at full size anyway, it is drawn smaller
 * on the canvas as before.
 */
export async function scaleSignature<I extends DecodedImage>(
  file: Blob,
  io: ImageIo<I>,
): Promise<ScaledSignature> {
  let target: ReturnType<typeof signatureFit> | null = null;
  try {
    const header = imageHeaderSize(new Uint8Array(await file.slice(0, HEADER_READ).arrayBuffer()));
    target = header ? signatureFit(header.width, header.height) : null;
  } catch {
    target = null; // an unreadable header only loses the shortcut
  }
  let image: I;
  try {
    image = await io.decode(
      file,
      target?.scaled ? { width: target.width, height: target.height } : undefined,
    );
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  try {
    if (!(image.width > 0 && image.height > 0)) return { ok: false, reason: "unreadable" };
    // decoded at the fitted size already (within the browser's one pixel of rounding): drawn at exactly that size, and it was scaled
    const fitted = target?.scaled === true && fittedDecodeMatches(image, target);
    const fit = fitted && target ? target : signatureFit(image.width, image.height);
    const scaled = fitted || fit.scaled;
    const png = await io.toPng(image, fit.width, fit.height);
    return { ok: true, file: png, scaled, width: fit.width, height: fit.height };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    image.close();
  }
}

/** What the control does with a chosen file: upload this PNG, or show one of `SIGNATURE_COPY`'s two lines. */
export type SignatureUpload =
  | { ok: true; file: Blob; scaled: boolean }
  | { ok: false; line: "wrongFile" | "tooDetailed" };

/**
 * The checks around the scaling, in order (fix round, lead 2026-10-29): the original only for its type and 10 MB (`signatureFileOk`), so a
 * phone photo of a signature gets through; then the PNG drawn from it for the stored limit of 256 KB (`SIGNATURE_MAX`; a photo-like scan
 * that stays too large as a PNG is `tooDetailed`). An image the browser can't read is `wrongFile`.
 */
export async function prepareSignature<I extends DecodedImage>(
  file: Blob,
  io: ImageIo<I>,
): Promise<SignatureUpload> {
  if (!signatureFileOk(file)) return { ok: false, line: "wrongFile" };
  const ready = await scaleSignature(file, io);
  if (!ready.ok) return { ok: false, line: "wrongFile" };
  if (ready.file.size > SIGNATURE_MAX) return { ok: false, line: "tooDetailed" };
  return { ok: true, file: ready.file, scaled: ready.scaled };
}

/**
 * The options that make the browser decode straight at `size` (FX-3 fix round 2, H), with its best resampling. Only the width is given
 * (fix round 3, 1): the browser turns the image by its orientation (a JPEG's Exif, a PNG's eXIf chunk) and then works out the height
 * from the turned image's own proportions, so a turn the header didn't show can never stretch it; the image only comes back at another
 * height, which `fittedDecodeMatches` sends to the full-size path.
 */
export function fittedDecodeOptions(size: { width: number; height: number }): ImageBitmapOptions {
  return { resizeWidth: size.width, resizeQuality: "high", imageOrientation: "from-image" };
}

/** The full-size decode, turned by the image's orientation as the browser shows it. */
export const FULL_DECODE_OPTIONS: ImageBitmapOptions = { imageOrientation: "from-image" };

/**
 * Whether a bitmap decoded with `fittedDecodeOptions(size)` is the fitted image. Both sides are checked: the width exactly, the height
 * allowing only the one pixel by which the browser's rounding (up, in the HTML standard) can differ from `signatureFit`'s (to the
 * nearest). Anything else (the options ignored, or the image turned the other way from its header) is a mismatch.
 */
export function fittedDecodeMatches(
  bitmap: { width: number; height: number },
  size: { width: number; height: number },
): boolean {
  return bitmap.width === size.width && (bitmap.height === size.height || bitmap.height === size.height + 1);
}

type CreateBitmap = (image: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>;

/**
 * Decodes at `size` when one is given. A browser that rejects the options, ignores them (the bitmap comes back at another size) or
 * finds the image turned the other way from its header (a PNG's eXIf chunk, which the header reader doesn't follow: the height comes
 * back far from the fitted one) gets the old path: a full-size decode, drawn smaller on the canvas. An image no browser can read still
 * fails, in the full-size decode.
 */
export async function decodeFitted(
  file: Blob,
  size: { width: number; height: number } | undefined,
  create: CreateBitmap,
): Promise<ImageBitmap> {
  if (size) {
    try {
      const bitmap = await create(file, fittedDecodeOptions(size));
      if (fittedDecodeMatches(bitmap, size)) return bitmap;
      bitmap.close();
    } catch {
      // the options were refused: the old path below
    }
  }
  return create(file, FULL_DECODE_OPTIONS);
}

/** The browser's `ImageIo`: `createImageBitmap` to decode, a canvas with high-quality smoothing to draw, `toBlob` for the PNG. */
export const browserImageIo: ImageIo<ImageBitmap> = {
  decode: (file, size) => decodeFitted(file, size, (image, options) => createImageBitmap(image, options)),
  toPng: (image, width, height) =>
    new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no 2d canvas"));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no PNG"))), "image/png");
    }),
};
