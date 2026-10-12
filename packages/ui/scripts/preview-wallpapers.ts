// Preview sheets for the wallpapers (owner review): each image scaled down under mock system UI, plus 100 %
// crops and a quiet-zone measurement. Output goes to <repo>/.logs/wallpapers/ (git-ignored), never to brand/.
// Run after build:wallpapers:   node packages/ui/scripts/preview-wallpapers.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { zoneStats } from "../src/brand/wallpaper-render.ts";
import {
  CONCEPTS,
  type Concept,
  FORMATS,
  type Format,
  MARK_PLACE,
  wallpaperFile,
} from "../src/brand/wallpapers.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "brand", "wallpapers");
const out = join(root, "..", "..", ".logs", "wallpapers");
mkdirSync(out, { recursive: true });

const FONT = "Segoe UI, Arial, sans-serif";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const label = (x: number, y: number, text: string, size: number, fill: string, extra = "") =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" ${extra}>${esc(text)}</text>`;

// ── Mock system UI (placeholder icons; labels are generic and clearly not client data) ─────────────────────

/** Windows 11 at 1920 × 1080 (a 4K screen at 200 %): desktop icons down the left, the centred taskbar. */
function windowsOverlay(theme: "light" | "dark"): string {
  const W = 1920;
  const H = 1080;
  const names = [
    "Recycle Bin",
    "This PC",
    "Documents",
    "Downloads",
    "Projects",
    "Browser",
    "Notes",
    "Sample.pdf",
  ];
  const tints = ["#C9D2DA", "#7FB2E5", "#F2C14E", "#6FA8DC", "#F2C14E", "#E06C5A", "#F5E08A", "#D9534F"];
  let icons = "";
  names.forEach((n, i) => {
    const col = i < 6 ? 0 : 1;
    const row = i < 6 ? i : i - 6;
    const x = 12 + col * 84;
    const y = 10 + row * 96;
    icons +=
      `<rect x="${x + 18}" y="${y + 6}" width="44" height="44" rx="6" fill="${tints[i]}"/>` +
      label(x + 40, y + 70, n, 12, "#FFFFFF", 'text-anchor="middle" filter="url(#shadow)"');
  });
  const dark = theme === "dark";
  const bar = dark ? "#1F1F1F" : "#EEEEEE";
  const ink = dark ? "#FFFFFF" : "#1A1A1A";
  const y = H - 48;
  let apps = "";
  const appTints = ["#0078D4", ink, ink, "#E8A33D", "#2E7D5B", "#3A6FD8", "#C2453B"];
  appTints.forEach((t, i) => {
    const x = W / 2 - (appTints.length * 44) / 2 + i * 44 + 8;
    apps +=
      i === 0
        ? `<g fill="${t}"><rect x="${x + 4}" y="${y + 12}" width="11" height="11"/><rect x="${x + 17}" y="${y + 12}" width="11" height="11"/><rect x="${x + 4}" y="${y + 25}" width="11" height="11"/><rect x="${x + 17}" y="${y + 25}" width="11" height="11"/></g>`
        : i < 3
          ? `<circle cx="${x + 16}" cy="${y + 24}" r="8" fill="none" stroke="${t}" stroke-width="1.6"/>`
          : `<rect x="${x + 4}" y="${y + 12}" width="24" height="24" rx="5" fill="${t}"/>`;
  });
  const tray =
    label(W - 16, y + 21, "17:20", 12, ink, 'text-anchor="end"') +
    label(W - 16, y + 37, "12-10-2026", 12, ink, 'text-anchor="end"') +
    `<g fill="none" stroke="${ink}" stroke-width="1.4"><path d="M${W - 150} ${y + 28}a9 9 0 0 1 14 0M${W - 147} ${y + 31}a5 5 0 0 1 8 0"/><rect x="${W - 124}" y="${y + 18}" width="18" height="11" rx="2"/></g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<defs><filter id="shadow" x="-20%" y="-50%" width="140%" height="200%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#000" flood-opacity="0.85"/></filter></defs>` +
    `${icons}<rect x="0" y="${y}" width="${W}" height="48" fill="${bar}" fill-opacity="0.86"/>` +
    `<rect x="0" y="${y}" width="${W}" height="1" fill="${dark ? "#FFFFFF" : "#000000"}" fill-opacity="0.08"/>${apps}${tray}</svg>`
  );
}

/** A phone at 540 × 1170 (the 2160 × 4680 wallpaper at 25 %): status bar with a clock, dock and home bar. */
function phoneOverlay(): string {
  const W = 540;
  const H = 1170;
  const dockY = H - 34 - 104;
  let dock = `<rect x="16" y="${dockY}" width="${W - 32}" height="104" rx="36" fill="#FFFFFF" fill-opacity="0.16"/>`;
  const tints = ["#34C759", "#0A84FF", "#FF9F0A", "#E5E5EA"];
  tints.forEach((t, i) => {
    const x = 40 + i * ((W - 80 - 76) / 3);
    dock += `<rect x="${x}" y="${dockY + 14}" width="76" height="76" rx="18" fill="${t}"/>`;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    label(58, 48, "9:41", 22, "#FFFFFF", 'font-weight="600"') +
    `<g fill="#FFFFFF"><rect x="${W - 110}" y="36" width="5" height="9" rx="1"/><rect x="${W - 102}" y="33" width="5" height="12" rx="1"/><rect x="${W - 94}" y="30" width="5" height="15" rx="1"/><rect x="${W - 86}" y="27" width="5" height="18" rx="1"/>` +
    `<rect x="${W - 70}" y="28" width="34" height="17" rx="5" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="1.5"/><rect x="${W - 67}" y="31" width="24" height="11" rx="3"/></g>` +
    `${dock}<rect x="${W / 2 - 90}" y="${H - 16}" width="180" height="6" rx="3" fill="#FFFFFF"/></svg>`
  );
}

/** The quiet zones as dashed outlines (inspection only, never shown to the owner as part of the design). */
function guides(format: Format, scale: number): string {
  const { width, height, quiet } = FORMATS[format];
  const third =
    format === "mobile"
      ? `<rect x="0" y="${(height / 3) * scale}" width="${width * scale}" height="${(height / 3) * scale}" fill="none" stroke="#FFD400" stroke-width="2" stroke-dasharray="10 8"/>`
      : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}">` +
    quiet
      .map(
        (q) =>
          `<rect x="${q.x * scale + 1}" y="${q.y * scale + 1}" width="${q.w * scale - 2}" height="${q.h * scale - 2}" fill="#FF3B30" fill-opacity="0.10" stroke="#FF3B30" stroke-width="2" stroke-dasharray="10 8"/>`,
      )
      .join("") +
    `${third}</svg>`
  );
}

// ── Measurements: how quiet each quiet zone is (L* range, largest block-to-block step, longest flat run) ──

async function quietReport(file: string, format: Format) {
  const { data, info } = await sharp(join(src, file)).raw().toBuffer({ resolveWithObject: true });
  return FORMATS[format].quiet.map((q) => {
    const s = zoneStats(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, q);
    const r1 = (n: number) => Math.round(n * 100) / 100;
    return { zone: `${q.x},${q.y} ${q.w}×${q.h}`, range: r1(s.range), step: r1(s.step), bands: s.bands };
  });
}

// ── Sheets ─────────────────────────────────────────────────────────────────────────────────────────────────

const SHEET_BG = "#D9DDDA";
const caption = (w: number, text: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="32">${label(0, 22, text, 18, "#1A1A1A")}</svg>`,
  );

async function sheet(concept: Concept) {
  const desk = join(src, wallpaperFile(concept, "desktop"));
  const mob = join(src, wallpaperFile(concept, "mobile"));
  const d = (theme: "light" | "dark") =>
    sharp(desk)
      .resize(1920, 1080, { kernel: "lanczos3" })
      .composite([{ input: Buffer.from(windowsOverlay(theme)) }])
      .png()
      .toBuffer();
  const m = await sharp(mob)
    .resize(540, 1170, { kernel: "lanczos3" })
    .composite([{ input: Buffer.from(phoneOverlay()) }])
    .png()
    .toBuffer();
  const W = 40 + 1920 + 48 + 540 + 40;
  const H = 40 + 32 + 1080 + 40 + 32 + 1080 + 40;
  const file = join(out, `sheet-${concept}.png`);
  await sharp({ create: { width: W, height: H, channels: 3, background: SHEET_BG } })
    .composite([
      {
        input: caption(1920, `${concept}: desktop 3840 × 2160 at 50 %, Windows 11 dark taskbar`),
        left: 40,
        top: 40,
      },
      { input: await d("dark"), left: 40, top: 72 },
      {
        input: caption(1920, `${concept}: desktop, Windows 11 light taskbar`),
        left: 40,
        top: 72 + 1080 + 40,
      },
      { input: await d("light"), left: 40, top: 72 + 1080 + 72 },
      { input: caption(540, "mobile 2160 × 4680 at 25 %"), left: 2008, top: 40 },
      { input: m, left: 2008, top: 72 },
    ])
    .png()
    .toFile(file);
  return file;
}

async function overview() {
  const tiles = [];
  for (const [i, concept] of CONCEPTS.entries()) {
    const top = 40 + i * (540 + 64);
    tiles.push(
      { input: caption(960, concept), left: 40, top },
      {
        input: await sharp(join(src, wallpaperFile(concept, "desktop")))
          .resize(960, 540)
          .png()
          .toBuffer(),
        left: 40,
        top: top + 32,
      },
      {
        input: await sharp(join(src, wallpaperFile(concept, "mobile")))
          .resize(249, 540)
          .png()
          .toBuffer(),
        left: 1040,
        top: top + 32,
      },
    );
  }
  const file = join(out, "overview.png");
  await sharp({ create: { width: 1329, height: 40 + 3 * 604, channels: 3, background: SHEET_BG } })
    .composite(tiles)
    .png()
    .toFile(file);
  return file;
}

/** 100 % crops around the sharpest detail, and the frame with the quiet zones outlined. */
async function inspect(concept: Concept, format: Format) {
  const file = wallpaperFile(concept, format);
  const { width, height } = FORMATS[format];
  const files: string[] = [];
  const m = MARK_PLACE[format];
  const focal = format === "desktop" ? { x: 2560, y: 760 } : { x: 1080, y: 2340 };
  for (const [i, p] of [{ x: m.x + m.size / 2, y: m.y + m.size / 2 }, focal].entries()) {
    const left = Math.max(0, Math.min(width - 640, p.x - 320));
    const top = Math.max(0, Math.min(height - 640, p.y - 320));
    const f = join(out, `crop-${concept}-${format}-${i + 1}.png`);
    await sharp(join(src, file)).extract({ left, top, width: 640, height: 640 }).png().toFile(f);
    files.push(f);
  }
  const scale = format === "desktop" ? 0.25 : 0.125;
  const g = join(out, `guides-${concept}-${format}.png`);
  await sharp(join(src, file))
    .resize(Math.round(width * scale), Math.round(height * scale))
    .composite([{ input: Buffer.from(guides(format, scale)) }])
    .png()
    .toFile(g);
  files.push(g);
  return files;
}

const report: Record<string, unknown> = {};
for (const concept of CONCEPTS) {
  console.log(await sheet(concept));
  for (const format of ["desktop", "mobile"] as const) {
    for (const f of await inspect(concept, format)) console.log(f);
    report[wallpaperFile(concept, format)] = await quietReport(wallpaperFile(concept, format), format);
  }
}
console.log(await overview());
writeFileSync(join(out, "quiet-zones.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 1));
