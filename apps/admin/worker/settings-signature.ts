// The signature image of the authorised signatory (M4.4; ADM-SET-01). A small PNG or JPEG, up to 256 KB, uploaded by the owner. The bytes are
// stored in the `DOCS` bucket under a key made from their SHA-256 (`settings/signature-<16 hex>.<ext>`), so a replacement never changes a
// file an earlier document used; the reference lives in the company settings (`company.signature`; a row from before M4.4 reads as null).
// Objects are never deleted here: replacing or removing the signature only changes the reference, so a document that already used the image
// keeps it whatever M5.2 decides (orphan clean-up is a follow-up with the other R2 clean-up, M7.4).
// It is printed only on invoices (from M5.2). Researched 2026-10-28, Rule 46(q) proviso CGST Rules (08-C RA-06): a signature is not required on an invoice issued electronically; the image is optional.
// Nothing here executes or renders the image: the type is decided by the first bytes (no SVG, no scripts), and the download is an
// attachment with a sandbox CSP.
import { resolveSetting, SIGNATURE_MAX_BYTES, type SignatureRef } from "@techaust/core/settings";
import { Hono } from "hono/tiny";
import { type ApiError, type AppEnv, actor, BAD_REQUEST, err, mutate, NOT_FOUND } from "./context.ts";
import { loadRow, upsert } from "./settings.ts";

const LENGTH_REQUIRED: ApiError = { code: "length_required", message: "Send the image with its length" };
const TOO_LARGE: ApiError = { code: "file_too_large", message: "The image is larger than 256 KB" };
const NOT_AN_IMAGE: ApiError = { code: "type_not_allowed", message: "Use a PNG or a JPEG image" };
const TOO_BIG_PIXELS: ApiError = {
  code: "image_too_big",
  message: "The image is larger than 2400 by 1200 pixels",
};
const STALE: ApiError = {
  code: "stale_version",
  message: "Someone else changed the company settings; try again",
};

const MAX_WIDTH = 2400;
const MAX_HEIGHT = 1200;

type Sniffed =
  | {
      ok: true;
      mime: "image/png" | "image/jpeg";
      ext: "png" | "jpg";
      width: number | null;
      height: number | null;
    }
  | { ok: false; reason: "type" | "pixels" };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The type by the bytes, never by the name or the header the client sent; a PNG's size from its header. */
export function sniffSignature(b: Uint8Array): Sniffed {
  if (b.length >= 24 && PNG.every((v, i) => b[i] === v)) {
    // IHDR is the first chunk: its width and height are big-endian 32-bit integers at bytes 16 and 20.
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52)
      return { ok: false, reason: "type" };
    if (width < 1 || height < 1 || width > MAX_WIDTH || height > MAX_HEIGHT)
      return { ok: false, reason: "pixels" };
    return { ok: true, mime: "image/png", ext: "png", width, height };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const size = jpegSize(b);
    if (size === null) return { ok: false, reason: "type" };
    if (size.width < 1 || size.height < 1 || size.width > MAX_WIDTH || size.height > MAX_HEIGHT)
      return { ok: false, reason: "pixels" };
    return { ok: true, mime: "image/jpeg", ext: "jpg", width: size.width, height: size.height };
  }
  return { ok: false, reason: "type" };
}

/** A JPEG's size from its first start-of-frame marker (SOF0 to SOF15, except DHT, JPG and DAC); null if none is found in the bytes. */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] as number;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image, or the scan starts with no frame header
    const length = ((b[i + 2] as number) << 8) | (b[i + 3] as number);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8 || i + 8 >= b.length) return null;
      return {
        height: ((b[i + 5] as number) << 8) | (b[i + 6] as number),
        width: ((b[i + 7] as number) << 8) | (b[i + 8] as number),
      };
    }
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");

export const settingsSignature = new Hono<AppEnv>()
  // The image, for the settings screen's preview. An attachment-style answer: never rendered in the page's context, never cached.
  .get("/signature", async (c) => {
    const row = await loadRow(c.env.DB, "company");
    const ref = resolveSetting("company", row?.value).signature;
    if (!ref) return err(c, NOT_FOUND, 404);
    const obj = await c.env.DOCS.get(ref.key);
    if (!obj) return err(c, NOT_FOUND, 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": ref.mime,
        "Content-Length": String(obj.size),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "no-store",
      },
    });
  })

  // The raw bytes as the body (`application/octet-stream`). Replaces any earlier signature.
  .put("/signature", async (c) => {
    const declared = c.req.header("Content-Length");
    if (declared === undefined) return err(c, LENGTH_REQUIRED, 411);
    if (!/^\d{1,12}$/.test(declared) || Number(declared) === 0) return err(c, BAD_REQUEST, 400);
    if (Number(declared) > SIGNATURE_MAX_BYTES) return err(c, TOO_LARGE, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength !== Number(declared)) return err(c, BAD_REQUEST, 400);
    const sniffed = sniffSignature(bytes);
    if (!sniffed.ok) return err(c, sniffed.reason === "pixels" ? TOO_BIG_PIXELS : NOT_AN_IMAGE, 415);

    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    const key = `settings/signature-${sha256.slice(0, 16)}.${sniffed.ext}`;
    const row = await loadRow(c.env.DB, "company");
    const current = row?.version ?? 0;
    const before = resolveSetting("company", row?.value);
    const now = Date.now();
    const ref: SignatureRef = {
      key,
      mime: sniffed.mime,
      size: bytes.byteLength,
      sha256,
      width: sniffed.width,
      height: sniffed.height,
      updatedAt: now,
    };
    // The object first (content-addressed: the same bytes are the same key), then the row. No object is ever deleted (see the header).
    await c.env.DOCS.put(key, bytes, { httpMetadata: { contentType: sniffed.mime }, sha256 });
    const u = actor(c);
    const done = await mutate(c, {
      main: c.env.DB.prepare(upsert()).bind(
        "company",
        JSON.stringify({ ...before, signature: ref }),
        current,
        u.id,
        now,
      ),
      action: "settings.signature.update",
      entityType: "settings",
      entityId: "company",
      summary: {
        mime: ref.mime,
        size: ref.size,
        sha12: sha256.slice(0, 12),
        replaced: Boolean(before.signature),
      },
    });
    if (!done) return c.json({ error: STALE, current_version: current, request_id: c.var.rid }, 409);
    return c.json({ ok: true, version: current + 1, signature: ref });
  })

  .delete("/signature", async (c) => {
    const row = await loadRow(c.env.DB, "company");
    const current = row?.version ?? 0;
    const before = resolveSetting("company", row?.value);
    if (!before.signature) return err(c, NOT_FOUND, 404);
    const u = actor(c);
    const done = await mutate(c, {
      main: c.env.DB.prepare(upsert()).bind(
        "company",
        JSON.stringify({ ...before, signature: null }),
        current,
        u.id,
        Date.now(),
      ),
      action: "settings.signature.delete",
      entityType: "settings",
      entityId: "company",
      summary: { sha12: before.signature.sha256.slice(0, 12) },
    });
    if (!done) return c.json({ error: STALE, current_version: current, request_id: c.var.rid }, 409);
    return c.json({ ok: true, version: current + 1 });
  });
