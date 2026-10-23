// The built pages, for tests that visit every one (read from apps/web/dist, so a new page is covered the day it exists).
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export type BuiltPage = { name: string; url: string };

/** Every built HTML page: "services/app-rescue.html" is /services/app-rescue; the 404 is requested at a missing path. */
export function builtPages(): BuiltPage[] {
  return walk(dist)
    .map((f) => relative(dist, f).split(sep).join("/"))
    .filter((n) => n.endsWith(".html"))
    .sort()
    .map((name) => {
      const path = `/${name.replace(/\.html$/, "")}`;
      return { name, url: path === "/index" ? "/" : path === "/404" ? "/no-such-page" : path };
    });
}
