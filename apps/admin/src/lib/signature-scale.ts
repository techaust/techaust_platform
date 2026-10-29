// The signature image is scaled down in the browser before it uploads (FX-3, A6 1c; ADM-SET-01): an image larger than 800 by 400 pixels (core
// SIGNATURE_MAX_WIDTH and _HEIGHT) is drawn onto a canvas that fits inside that box, the aspect kept, and sent as a PNG. An image that already
// fits is sent as it is (no second compression). The API refuses anything larger from the header (worker/settings-signature.ts), so the PDF's
// integrity check never inflates megabytes of pixels. The drawing goes through `ImageIo`, so the rules are tested without a browser.
import { SIGNATURE_MAX_HEIGHT, SIGNATURE_MAX_WIDTH } from "@techaust/core/settings";

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

/** A decoded image: its size, and a way to free it. */
export type DecodedImage = { readonly width: number; readonly height: number; close(): void };

/** The browser parts, passed in so the rules run in a test. */
export type ImageIo<I extends DecodedImage = DecodedImage> = {
  decode(file: Blob): Promise<I>;
  /** The image drawn at `width` by `height`, as PNG bytes. */
  toPng(image: I, width: number, height: number): Promise<Blob>;
};

export type ScaledSignature =
  | { ok: true; file: Blob; scaled: boolean; width: number; height: number }
  | { ok: false; reason: "unreadable" };

/** The file to upload: the original when it fits, else a PNG that fits. An image the browser can't read is `unreadable`. */
export async function scaleSignature<I extends DecodedImage>(
  file: Blob,
  io: ImageIo<I>,
): Promise<ScaledSignature> {
  let image: I;
  try {
    image = await io.decode(file);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  try {
    if (!(image.width > 0 && image.height > 0)) return { ok: false, reason: "unreadable" };
    const fit = signatureFit(image.width, image.height);
    if (!fit.scaled) return { ok: true, file, scaled: false, width: fit.width, height: fit.height };
    const png = await io.toPng(image, fit.width, fit.height);
    return { ok: true, file: png, scaled: true, width: fit.width, height: fit.height };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    image.close();
  }
}

/** The browser's `ImageIo`: `createImageBitmap` to decode, a canvas with high-quality smoothing to draw, `toBlob` for the PNG. */
export const browserImageIo: ImageIo<ImageBitmap> = {
  decode: (file) => createImageBitmap(file),
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
