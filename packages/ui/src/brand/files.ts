// The brand deliverables (docs/06 §1): which files exist and how each is made.
import { type Brand, color, type LockupName, SCHEMES, type SceneItem, type SchemeName } from "./compose.ts";

const LOCKUPS: LockupName[] = ["primary", "stacked", "wordmark", "symbol"];
const SCHEME_NAMES = Object.keys(SCHEMES) as SchemeName[];

/** Vector files: logo-<lockup>-<scheme>.svg, the profile tile, and the pixel-fitted adaptive favicon.svg. */
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

/** The one bold gesture on every banner: the mark, very large and tone-on-tone, bleeding off an edge. */
const watermark = (x: number, y: number, size: number, tone: string): SceneItem => ({
  kind: "mark",
  x,
  y,
  size,
  base: tone,
  accent: tone,
});

/** Raster files: favicon.ico, Apple/PWA icons, social profile + covers, email logos, link previews. */
export function rasterPlan(brand: Brand): Raster[] {
  const ink = color("ink-900");
  const mist = color("mist");
  const lockupH = (w: number) => brand.lockupHeight("primary", w);

  // Link preview (1200 × 630): lockup, the strapline on two lines, the domain; mark bleeding off the right.
  const og = (scheme: "color" | "dark") => {
    const light = scheme === "color";
    return brand.scene(1200, 630, light ? color("stone-50") : ink, [
      watermark(712, -34, 600, light ? color("stone-200") : color("ink-700")),
      { kind: "lockup", lockup: "primary", scheme, x: 96, y: 92, width: 290 },
      { kind: "line", id: "straplineA", x: 96, y: 300, cap: 60, fill: light ? ink : mist },
      { kind: "line", id: "straplineB", x: 96, y: 380, cap: 60, fill: light ? ink : mist },
      {
        kind: "line",
        id: "domain",
        x: 96,
        y: 520,
        cap: 22,
        fill: light ? color("ink-400") : color("ink-300"),
      },
    ]);
  };
  // Covers: the platform's avatar sits over the lower left, so content is right-aligned.
  const cover = (
    w: number,
    h: number,
    opts: { lockupW?: number; cap: number; markSize: number; right: number },
  ) => {
    const items: SceneItem[] = [
      watermark(-0.045 * opts.markSize, -0.12 * opts.markSize, opts.markSize, color("ink-700")),
    ];
    if (opts.lockupW) {
      const block = lockupH(opts.lockupW) + 0.9 * opts.cap + opts.cap;
      const top = (h - block) / 2;
      items.push({
        kind: "lockup",
        lockup: "primary",
        scheme: "dark",
        x: w - opts.right - opts.lockupW,
        y: top,
        width: opts.lockupW,
      });
      items.push({
        kind: "line",
        id: "strapline",
        x: w - opts.right,
        y: top + lockupH(opts.lockupW) + 0.9 * opts.cap,
        cap: opts.cap,
        fill: color("ink-300"),
        align: "right",
      });
    } else {
      items.push({
        kind: "line",
        id: "strapline",
        x: w - opts.right,
        y: (h - opts.cap) / 2,
        cap: opts.cap,
        fill: mist,
        align: "right",
      });
    }
    return brand.scene(w, h, ink, items);
  };

  return [
    // Small icons use the tile, pixel-fitted at 16 and 32: legible on light and dark browser chrome alike.
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
    // Profile pictures (shown as circles): LinkedIn page logo 400 × 400; WhatsApp / X / Google 800 × 800.
    png("profile-400.png", brand.tileSvg(400, { radius: 0, markRatio: 0.46 }), 400),
    png("profile-800.png", brand.tileSvg(800, { radius: 0, markRatio: 0.46 }), 800),
    // LinkedIn company page cover (official 1512 × 256), personal profile background (1584 × 396), X header
    // (1500 × 500; X crops up to 60 px top and bottom, so content stays in the middle 380 px).
    png("cover-linkedin-company.png", cover(1512, 256, { cap: 34, markSize: 380, right: 96 }), 1512, 256),
    png(
      "cover-linkedin-profile.png",
      cover(1584, 396, { lockupW: 430, cap: 24, markSize: 560, right: 96 }),
      1584,
      396,
    ),
    png("cover-x.png", cover(1500, 500, { lockupW: 470, cap: 26, markSize: 640, right: 110 }), 1500, 500),
    // Email: 140 px wide, sent at 2x (docs/06 §6). The badge keeps a white plate behind the logo, so it
    // survives email clients that force dark mode by inverting colours.
    png("logo-email-color@2x.png", brand.lockupSvg("primary", "color", { width: 280 }), 280, 39),
    png("logo-email-dark@2x.png", brand.lockupSvg("primary", "dark", { width: 280 }), 280, 39),
    png(
      "logo-email-badge@2x.png",
      brand.scene(
        328,
        88,
        color("white"),
        [
          {
            kind: "lockup",
            lockup: "primary",
            scheme: "color",
            x: 24,
            y: (88 - lockupH(280)) / 2,
            width: 280,
          },
        ],
        12,
      ),
      328,
      88,
    ),
    png("og-default.png", og("color"), 1200, 630),
    png("og-default-dark.png", og("dark"), 1200, 630),
  ];
}
