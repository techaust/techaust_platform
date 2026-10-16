// Writes the social media kit to packages/ui/brand/social/<platform>/ from src/brand/social.ts.
// Run: pnpm --filter @techaust/ui build:social                 (rasters via sharp, a dev dependency only)
//      pnpm --filter @techaust/ui build:social -- --zip         also writes <repo>/.logs/social/techaust-social-kit.zip
//      pnpm --filter @techaust/ui build:social -- --out <dir>   writes the kit somewhere else (the preview round);
//                                                              <dir> must be inside <repo>/.logs/ (it is emptied first)
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import sharp from "sharp";
import { createBrand, parseMaster } from "../src/brand/compose.ts";
import { sourceHash, tagPng } from "../src/brand/png.ts";
import { socialPlan, socialReadme } from "../src/brand/social.ts";
import { outDir } from "./out-dir.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..", "..");
const args = process.argv.slice(2);
const dir = outDir(args, repo, join(root, "brand", "social"));
const brand = createBrand(parseMaster(readFileSync(join(root, "brand/source/techaust-master.svg"), "utf8")));
const plan = socialPlan(brand);

// Start clean: the folder holds only what the plan makes, plus the README.
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

/** JPEG with a COM segment carrying the SVG hash (the PNGs carry it in a tEXt chunk). */
function tagJpg(jpg: Buffer, svg: string): Buffer {
  const text = Buffer.from(`techaust:svg-sha256=${sourceHash(svg)}`, "latin1");
  const head = Buffer.from([0xff, 0xfe, 0, 0]);
  head.writeUInt16BE(text.length + 2, 2);
  return Buffer.concat([jpg.subarray(0, 2), head, text, jpg.subarray(2)]);
}

const written: string[] = [];
for (const f of plan) {
  const path = join(dir, f.file);
  mkdirSync(dirname(path), { recursive: true });
  const input = sharp(Buffer.from(f.svg), { limitInputPixels: false });
  if (f.kind === "svg") {
    writeFileSync(path, f.svg);
  } else if (f.kind === "jpg") {
    // The best quality (4:4:4, no chroma blur on the type) that stays under the limit.
    const limit = f.item.jpg?.maxBytes ?? 0;
    let out: Buffer | undefined;
    for (let q = 95; q >= 60; q -= 5) {
      const jpg = await sharp(Buffer.from(f.svg))
        .flatten()
        .jpeg({ quality: q, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer();
      out = tagJpg(jpg, f.svg);
      if (out.length < limit) break;
    }
    if (!out || out.length >= limit) throw new Error(`${f.file}: cannot get under ${limit} bytes`);
    writeFileSync(path, out);
  } else {
    // Smallest file first. Where a platform states a minimum file size (Google: 10 KB), step down to lighter
    // compression until the file reaches it: the pixels are the same (PNG is lossless), nothing is padded.
    const min = f.item.minBytes ?? 0;
    let out: Buffer | undefined;
    search: for (let level = 9; level >= 1; level--)
      for (const adaptiveFiltering of [true, false]) {
        const opts = { compressionLevel: level, adaptiveFiltering };
        const png = f.item.transparent
          ? await input.clone().png(opts).toBuffer()
          : await input.clone().flatten().removeAlpha().png(opts).toBuffer();
        out = tagPng(png, f.svg);
        if (out.length >= min) break search;
      }
    if (!out || out.length < min) throw new Error(`${f.file}: cannot reach ${min} bytes`);
    writeFileSync(path, out);
  }
  written.push(f.file);
  console.log(`wrote ${relative(repo, path)} (${f.width} × ${f.height})`);
}
writeFileSync(join(dir, "README.md"), socialReadme(plan));
written.push("README.md");

// --zip: one archive for the owner (stored with deflate, Node built-ins only).
if (args.includes("--zip")) {
  const zipDir = join(repo, ".logs", "social");
  mkdirSync(zipDir, { recursive: true });
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const name of written.sort()) {
    const data = readFileSync(join(dir, name));
    const packed = deflateRawSync(data, { level: 9 });
    const fname = Buffer.from(`techaust-social-kit/${name}`, "utf8");
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x5d50, 12); // date: 2026-10-16 (fixed, so the archive is reproducible)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fname.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x5d50, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fname.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fname, packed);
    centrals.push(central, fname);
    offset += local.length + fname.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(written.length, 8);
  end.writeUInt16LE(written.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  const zip = join(zipDir, "techaust-social-kit.zip");
  writeFileSync(zip, Buffer.concat([...locals, cd, end]));
  console.log(`wrote ${relative(repo, zip)} (${written.length} files)`);
}
console.log(
  `${written.length} files in ${relative(repo, dir) || dir}; ${readdirSync(dir).length} platform folders + README`,
);
