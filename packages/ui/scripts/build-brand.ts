// Writes every logo file in packages/ui/brand/ from brand/source/techaust-master.svg.
// Run: pnpm --filter @techaust/ui build:brand   (rasters via sharp, a dev dependency only)
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createBrand, parseMaster } from "../src/brand/compose.ts";
import { brandFiles, rasterPlan } from "../src/brand/files.ts";
import { buildPrintFiles } from "../src/brand/print.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = join(root, "brand");
mkdirSync(brandDir, { recursive: true });
const brand = createBrand(parseMaster(readFileSync(join(brandDir, "source/techaust-master.svg"), "utf8")));

const vectors = brandFiles(brand);
const rasters = rasterPlan(brand);
// Remove anything we no longer produce (the folder holds generated files + source/ only).
const keep = new Set([...Object.keys(vectors), ...rasters.map((r) => r.file), "source", "print"]);
for (const f of readdirSync(brandDir)) if (!keep.has(f)) rmSync(join(brandDir, f), { recursive: true });

for (const [file, svg] of Object.entries(vectors)) writeFileSync(join(brandDir, file), svg);

const png = (svg: string) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
for (const r of rasters) {
  if (r.kind === "png") {
    writeFileSync(join(brandDir, r.file), await png(r.svg));
    continue;
  }
  // PNG-in-ICO (Vista+ and every current browser): header, one directory entry per size, then the PNGs.
  const images = await Promise.all(r.sizes.map(async (s) => ({ size: s.size, data: await png(s.svg) })));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(img.size >= 256 ? 0 : img.size, e);
    header.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(img.data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += img.data.length;
  });
  writeFileSync(join(brandDir, r.file), Buffer.concat([header, ...images.map((i) => i.data)]));
}
// Print-ready PDFs (CMYK, outlined text, trim/bleed boxes).
const printDir = join(brandDir, "print");
rmSync(printDir, { recursive: true, force: true });
mkdirSync(printDir);
const print = await buildPrintFiles(brand, root);
for (const [file, bytes] of Object.entries(print)) writeFileSync(join(printDir, file), bytes);
console.log(
  `wrote ${Object.keys(vectors).length} SVGs, ${rasters.length} rasters and ${Object.keys(print).length} print PDFs to brand/`,
);
