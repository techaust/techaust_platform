// Renders the six brand wallpapers to packages/ui/brand/wallpapers/ (src/brand/wallpapers.ts).
// Run: pnpm --filter @techaust/ui build:wallpapers            (full size, tagged, committed)
//      node scripts/build-wallpapers.ts --draft 0.25 [concept]  (quick previews to <repo>/.logs/wallpapers/draft)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { tagPng } from "../src/brand/png.ts";
import { wallpaperSource } from "../src/brand/wallpaper-source.ts";
import { renderWallpaper, wallpaperPlan } from "../src/brand/wallpapers.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const draftAt = args.indexOf("--draft");
const draft = draftAt >= 0 ? Number(args[draftAt + 1] ?? 0.25) : 0;
const only = args.filter((a, i) => !a.startsWith("--") && i !== draftAt + 1);

const dir = draft
  ? join(root, "..", "..", ".logs", "wallpapers", "draft")
  : join(root, "brand", "wallpapers");
mkdirSync(dir, { recursive: true });
const plan = wallpaperPlan().filter((w) => only.length === 0 || only.includes(w.concept));
if (!draft) {
  const keep = new Set(wallpaperPlan().map((w) => w.file));
  for (const f of readdirSync(dir)) if (!keep.has(f)) rmSync(join(dir, f), { recursive: true });
}

for (const w of plan) {
  const started = Date.now();
  const img = renderWallpaper(w.concept, w.format, draft || 1);
  const png = await sharp(Buffer.from(img.data.buffer), {
    raw: { width: img.width, height: img.height, channels: 3 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const out = draft ? png : tagPng(png, wallpaperSource(root, w.concept, w.format));
  writeFileSync(join(dir, w.file), out);
  console.log(
    `wrote ${w.file} (${img.width} × ${img.height}) in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}
