// Renders the share images (1200 x 630 PNG) of every built page into apps/web/dist/og/ (M2.5, WEB-OG). Run by the web
// `build` script after `astro build` and before the dist checks. The images are build output, never committed. The
// layout is packages/ui/src/brand/og.ts; the Node-only outlining and PNG step is og-render.ts (HarfBuzz, sharp), which
// is why this runs as a script and not inside Astro. Prints how long it took.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOgRenderer } from "../packages/ui/src/brand/og-render.ts";
import { ogTargets } from "./web-og.mjs";

export async function buildOg(dist) {
  const started = performance.now();
  const targets = ogTargets(dist);
  const renderer = await createOgRenderer();
  const seen = new Map();
  for (const t of targets) {
    if (seen.has(t.image))
      throw new Error(`build-og: ${t.name} and ${seen.get(t.image)} share the image ${t.image}`);
    seen.set(t.image, t.name);
    mkdirSync(dirname(t.image), { recursive: true });
    writeFileSync(t.image, await renderer.png({ title: t.title, category: t.category }));
  }
  return { count: targets.length, ms: Math.round(performance.now() - started) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = fileURLToPath(new URL("../apps/web/dist", import.meta.url));
  const { count, ms } = await buildOg(dist);
  console.log(`build-og: ${count} share images in ${(ms / 1000).toFixed(1)} s`);
}
