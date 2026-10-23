// Share-image helpers shared by scripts/build-og.mjs (renders them) and scripts/web-dist-checks.mjs (checks them):
// which built pages get an image of their own, their title and category, and the PNG size check (WEB-OG).
// Dependency-free Node: the PNG size is read from the file header, so the dist check needs no image library.
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { walk } from "./web-shared.mjs";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const LEGAL = new Set([
  "privacy",
  "terms",
  "refund-policy",
  "delivery-policy",
  "cookies",
  "accessibility",
  "security",
]);

/** The decoded value of a character reference in attribute or text content. */
export function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** `<title>` text, decoded. */
export const titleOf = (html) => {
  const raw = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return raw === undefined ? undefined : decodeEntities(raw).trim();
};

/** The `content` of `<meta property|name="key">`, decoded (undefined when missing). */
export function metaContent(html, key) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const k = /\b(?:property|name)="([^"]*)"/i.exec(tag)?.[1];
    if (k !== key) continue;
    const c = /\bcontent="([^"]*)"/i.exec(tag)?.[1];
    return c === undefined ? undefined : decodeEntities(c);
  }
  return undefined;
}

/**
 * The title as printed on the image, taken from the page's own <title> (no new words): the part before the first " | "
 * (the site suffix "| TecHaust", or a second clause such as About's), without a leading "TecHaust Technologies: "
 * (the lockup above the title already names the company). Falls back to the whole title if that leaves nothing.
 */
export function imageTitle(title) {
  const first = title.split(/\s+\|\s+/)[0]?.trim() ?? "";
  const short = first.replace(/^TecHaust(?: Technologies)?:\s+/, "").trim();
  return short || first || title.trim();
}

/** The category shown on a page's image, from its path. */
export function ogCategory(path) {
  const first = path.split("/").filter(Boolean)[0] ?? "";
  if (first === "services") return "Services";
  if (first === "industries") return "Industries";
  if (first === "blog") return "Blog";
  if (first === "pricing") return "Pricing";
  if (LEGAL.has(first)) return "Legal";
  return "Company";
}

/** The path of a built page file: "index.html" → "/", "services/x.html" → "/services/x". */
export function pagePath(name) {
  const p = `/${name.replace(/\.html$/, "")}`;
  return p === "/index" ? "/" : p;
}

/**
 * Every built page whose `og:image` is one of ours (/og/<slug>.png): { name, path, title, category, image } where `image`
 * is the file path under dist. Pages with another image (the 404 keeps the default) are left out.
 */
export function ogTargets(dist) {
  const out = [];
  for (const file of walk(dist)) {
    const name = relative(dist, file).split(sep).join("/");
    if (!name.endsWith(".html")) continue;
    const html = readFileSync(file, "utf8");
    const image = metaContent(html, "og:image");
    const m = image === undefined ? null : /^https:\/\/techaust\.com(\/og\/[a-z0-9-]+\.png)$/.exec(image);
    if (!m) continue;
    const path = pagePath(name);
    out.push({
      name,
      path,
      title: imageTitle(titleOf(html) ?? ""),
      category: ogCategory(path),
      image: join(dist, ...m[1].split("/").filter(Boolean)),
    });
  }
  return out;
}

/** Width and height of a PNG from its header; null when the bytes are not a PNG. */
export function pngSize(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * WEB-OG on one built page: its `og:image` is an absolute techaust.com URL of a file that exists in dist, is a PNG and
 * is 1200 × 630. `read(path)` returns the file's bytes or undefined (the default image is a hashed /_astro file).
 */
export function checkOgImage(name, html, read) {
  const image = metaContent(html, "og:image");
  if (!image) return [`${name}: no og:image`];
  const m = /^https:\/\/techaust\.com(\/\S*)$/.exec(image);
  if (!m) return [`${name}: og:image "${image}" is not an absolute https://techaust.com URL`];
  const bytes = read(m[1]);
  if (!bytes) return [`${name}: og:image ${m[1]} is not in dist`];
  const size = pngSize(bytes);
  if (!size) return [`${name}: og:image ${m[1]} is not a PNG`];
  if (size.width !== OG_WIDTH || size.height !== OG_HEIGHT)
    return [`${name}: og:image ${m[1]} is ${size.width}x${size.height} (must be ${OG_WIDTH}x${OG_HEIGHT})`];
  return [];
}

/** Reads a dist-relative URL path ("/og/x.png") from dist; undefined when missing. */
export const readDist = (dist) => (urlPath) => {
  const file = join(dist, ...urlPath.split("?")[0].split("/").filter(Boolean));
  return existsSync(file) ? readFileSync(file) : undefined;
};
