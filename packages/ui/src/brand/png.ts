// PNG chunk helpers for generated rasters (Node-only: node:crypto and node:zlib; used by scripts and tests).
// A wallpaper PNG is tagged sRGB and carries the SHA-256 of the SVG it was rendered from, so the drift test can
// prove a committed PNG matches the current generator without re-rendering 4K images.
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** tEXt keyword holding the hash of the SVG source. */
export const SOURCE_KEY = "techaust:svg-sha256";

export const sourceHash = (svg: string) => createHash("sha256").update(svg, "utf8").digest("hex");

type Chunk = { type: string; data: Buffer };

export function readChunks(png: Buffer): Chunk[] {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  const chunks: Chunk[] = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    const type = png.toString("latin1", o + 4, o + 8);
    chunks.push({ type, data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
    if (type === "IEND") break;
  }
  return chunks;
}

function encode({ type, data }: Chunk): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Adds sRGB (perceptual) and the source hash right after IHDR; drops any other colour-space chunks. */
export function tagPng(png: Buffer, svg: string): Buffer {
  const drop = new Set(["sRGB", "gAMA", "cHRM", "iCCP", "tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);
  const chunks = readChunks(png).filter((c) => !drop.has(c.type));
  const [ihdr, ...rest] = chunks;
  if (ihdr?.type !== "IHDR") throw new Error("PNG without IHDR");
  const tags: Chunk[] = [
    { type: "sRGB", data: Buffer.from([0]) },
    { type: "tEXt", data: Buffer.from(`${SOURCE_KEY}\0${sourceHash(svg)}`, "latin1") },
  ];
  return Buffer.concat([SIGNATURE, ...[ihdr, ...tags, ...rest].map(encode)]);
}

/** Size, colour type, sRGB flag and the embedded source hash of a PNG. */
export function pngInfo(png: Buffer) {
  const chunks = readChunks(png);
  const ihdr = chunks[0]?.data;
  if (!ihdr) throw new Error("PNG without IHDR");
  const text = chunks
    .filter((c) => c.type === "tEXt")
    .map((c) => c.data.toString("latin1").split("\0"))
    .find(([k]) => k === SOURCE_KEY);
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr.readUInt8(8),
    colourType: ihdr.readUInt8(9),
    srgb: chunks.some((c) => c.type === "sRGB"),
    iccp: chunks.some((c) => c.type === "iCCP"),
    source: text?.[1],
  };
}
