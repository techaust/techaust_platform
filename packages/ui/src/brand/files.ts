// The brand deliverables (docs/06 §1): which files exist and how each is made.
import { resolveColor, tokens } from "../tokens/model.ts";
import { type Brand, type LockupName, SCHEMES, type SchemeName } from "./compose.ts";

const LOCKUPS: LockupName[] = ["primary", "stacked", "wordmark", "symbol"];
const SCHEME_NAMES = Object.keys(SCHEMES) as SchemeName[];
const col = (k: string) => resolveColor(k, tokens);

/** Vector files: logo-<lockup>-<scheme>.svg, the profile tile, and the adaptive favicon.svg. */
export function brandFiles(brand: Brand): Record<string, string> {
  const files: Record<string, string> = {};
  for (const lockup of LOCKUPS)
    for (const scheme of SCHEME_NAMES)
      files[`logo-${lockup}-${scheme}.svg`] = brand.lockupSvg(lockup, scheme);
  files["logo-tile.svg"] = brand.tileSvg(512, { radius: 0.22, markRatio: 0.58 });
  files["favicon.svg"] = brand.faviconSvg();
  return files;
}

export type Raster =
  | { kind: "png"; file: string; svg: string; width: number; height: number }
  | { kind: "ico"; file: string; sizes: { size: number; svg: string }[] };

const png = (file: string, svg: string, width: number, height = width): Raster => ({
  kind: "png",
  file,
  svg,
  width,
  height,
});

/** Raster files: favicon.ico, Apple/PWA icons, social profile + banner, email logos, default OG images. */
export function rasterPlan(brand: Brand): Raster[] {
  // The banner's one bold gesture: the mark, very large and tone-on-tone, cropped by the left edge.
  const bannerMark = (size: number, x: number, y: number) =>
    `<g transform="translate(${x} ${y}) scale(${size / 100})" fill="${col("ink-700")}">${brand.markPaths
      .map((d) => `<path d="${d}"/>`)
      .join("")}</g>`;
  return [
    // Small icons use the tile: it stays legible on light and dark browser chrome alike.
    {
      kind: "ico",
      file: "favicon.ico",
      sizes: [16, 32, 48].map((size) => ({
        size,
        svg: brand.tileSvg(size, { radius: 0.2, markRatio: 0.66 }),
      })),
    },
    png("apple-touch-icon.png", brand.tileSvg(180, { radius: 0, markRatio: 0.56 }), 180),
    png("icon-192.png", brand.tileSvg(192, { radius: 0.22, markRatio: 0.58 }), 192),
    png("icon-512.png", brand.tileSvg(512, { radius: 0.22, markRatio: 0.58 }), 512),
    // Maskable: launchers crop to a circle of 80 % diameter; the mark stays inside the W3C safe zone.
    png("icon-maskable-512.png", brand.tileSvg(512, { radius: 0, markRatio: 0.46 }), 512),
    // LinkedIn / WhatsApp / X / Google profile picture (shown as a circle).
    png("profile-800.png", brand.tileSvg(800, { radius: 0, markRatio: 0.46 }), 800),
    // LinkedIn company banner (1584 × 396): the profile picture covers the lower left, so the lockup sits right.
    png(
      "banner-linkedin.png",
      brand.onCanvas("primary", "dark", {
        width: 1584,
        height: 396,
        background: col("ink-900"),
        contentWidth: 560,
        x: 1584 - 96 - 560,
        extra: bannerMark(520, -70, -62),
      }),
      1584,
      396,
    ),
    // Email header: 140 px wide, shown at 2x (docs/06 §6); a dark pair for clients that honour prefers-color-scheme.
    png("logo-email-color@2x.png", brand.lockupSvg("primary", "color", { width: 280 }), 280, 39),
    png("logo-email-dark@2x.png", brand.lockupSvg("primary", "dark", { width: 280 }), 280, 39),
    png(
      "og-default.png",
      brand.onCanvas("primary", "color", {
        width: 1200,
        height: 630,
        background: col("stone-50"),
        contentWidth: 640,
      }),
      1200,
      630,
    ),
    png(
      "og-default-dark.png",
      brand.onCanvas("primary", "dark", {
        width: 1200,
        height: 630,
        background: col("ink-900"),
        contentWidth: 640,
      }),
      1200,
      630,
    ),
  ];
}
