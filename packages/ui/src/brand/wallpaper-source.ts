// What a wallpaper PNG is rendered from (Node-only: reads files; used by the build script and the drift test).
// The PNG carries the SHA-256 of these sources plus its concept and format, so CI can prove a committed PNG is
// current without re-rendering a 4K image. Any change to the renderer, the concepts, the mark's geometry or the
// tokens changes the hash, and the test then asks for `build:wallpapers`.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const WALLPAPER_SOURCES = [
  "src/brand/wallpapers.ts",
  "src/brand/wallpaper-render.ts",
  "src/brand/geometry.ts",
  "tokens/tokens.json",
];

/** The text whose hash is stamped into one wallpaper PNG (`root` = packages/ui). */
export function wallpaperSource(root: string, concept: string, format: string): string {
  const files = WALLPAPER_SOURCES.map(
    (f) => `${f}\n${readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n")}`,
  );
  return `${concept}/${format}\n${files.join("\n")}`;
}
