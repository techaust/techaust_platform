// Share images, Node-only half (M2.5, WEB-OG): sets a page's title, category and domain as outlines (HarfBuzz, the brand
// fonts), wraps the title and rasterises src/brand/og.ts's layout with sharp. Used by apps/web's build step
// (scripts/build-og.mjs, after `astro build`) and by tests; never by an app bundle. Fonts: Archivo (the wordmark's
// family, Normal width) for the title, IBM Plex Mono for the category and the domain.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { OG_SIZE, ogSvg } from "./og.ts";
import { createOutliner, type Outlined } from "./outline-set.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(root, "package.json"));

/** Title sizes tried in turn (cap height in px) until the title fits in at most three lines. */
export const TITLE_CAPS = [60, 52, 46, 40] as const;
export const MAX_TITLE_LINES = 3;
const TEXT_WIDTH = OG_SIZE.width - 2 * 80;

export type OgText = { title: string; category: string };

export async function createOgRenderer() {
  const archivo = await createOutliner(
    require.resolve("@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2"),
    { wght: 620, wdth: 100 },
  );
  const mono = await createOutliner(
    require.resolve("@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2"),
    {},
  );
  const domain = mono("techaust.com", { cap: 22, tracking: 20 });

  /** Greedy word wrap at one size; null when a word alone is wider than the line. */
  function wrap(title: string, cap: number): Outlined[] | null {
    const lines: Outlined[] = [];
    let current = "";
    for (const word of title.split(/\s+/).filter(Boolean)) {
      const tryLine = current ? `${current} ${word}` : word;
      if (archivo(tryLine, { cap }).width <= TEXT_WIDTH) {
        current = tryLine;
        continue;
      }
      if (!current) return null;
      lines.push(archivo(current, { cap }));
      current = word;
      if (archivo(current, { cap }).width > TEXT_WIDTH) return null;
    }
    if (current) lines.push(archivo(current, { cap }));
    return lines;
  }

  /** The SVG for a page. Throws when the title does not fit in three lines at the smallest size. */
  function svg({ title, category }: OgText): string {
    for (const cap of TITLE_CAPS) {
      const lines = wrap(title, cap);
      if (lines && lines.length <= MAX_TITLE_LINES)
        return ogSvg({
          titleLines: lines,
          category: mono(category.toUpperCase(), { cap: 22, tracking: 30 }),
          domain,
        });
    }
    throw new Error(`share image: the title does not fit in ${MAX_TITLE_LINES} lines: "${title}"`);
  }

  async function png(text: OgText): Promise<Buffer> {
    return sharp(Buffer.from(svg(text)), { density: 72 })
      .resize(OG_SIZE.width, OG_SIZE.height)
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
  }

  return { svg, png };
}
