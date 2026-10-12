// Writes the six brand wallpapers to packages/ui/brand/wallpapers/ from src/brand/wallpapers.ts.
// Run: pnpm --filter @techaust/ui build:wallpapers   (rasters via sharp, a dev dependency only)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { tagPng } from "../src/brand/png.ts";
import { wallpaperPlan } from "../src/brand/wallpapers.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "brand", "wallpapers");
mkdirSync(dir, { recursive: true });

const plan = wallpaperPlan();
const keep = new Set(plan.map((w) => w.file));
for (const f of readdirSync(dir)) if (!keep.has(f)) rmSync(join(dir, f), { recursive: true });

for (const w of plan) {
  // Opaque RGB at exactly the frame size; then tagged sRGB and stamped with the hash of its SVG source.
  const png = await sharp(Buffer.from(w.svg), { limitInputPixels: false })
    .flatten()
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  writeFileSync(join(dir, w.file), tagPng(png, w.svg));
  console.log(`wrote brand/wallpapers/${w.file} (${w.width} × ${w.height})`);
}
