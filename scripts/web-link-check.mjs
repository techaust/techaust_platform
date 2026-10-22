// Link checker for the built public site (roadmap M2.3 acceptance): every internal href, src, action and srcset URL
// in dist/**/*.html resolves to a built file, and every #fragment to an id on the target page. External links are not
// fetched. Routes another milestone owns are listed, each with a reason and the milestone, in
// apps/web/link-check-allow.json; an entry that is no longer needed (the page now exists) is itself a problem, so the
// list cannot rot. Pure functions (no process.exit), run from scripts/web-dist-checks.mjs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

/** Paths the Worker answers (no file in dist): `run_worker_first: ["/api/*"]`. */
const WORKER_PREFIXES = ["/api/"];

/** Parses link-check-allow.json: { allow: [{ path, reason, milestone }] }. Throws on a missing reason or milestone. */
export function parseLinkAllowList(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const entries = data?.allow;
  if (!Array.isArray(entries)) throw new Error('link-check-allow.json: expected { "allow": [...] }');
  for (const e of entries) {
    if (typeof e?.path !== "string" || !e.path.startsWith("/"))
      throw new Error(`link-check-allow.json: "path" must start with "/" (got ${JSON.stringify(e?.path)})`);
    if (!e.reason?.trim() || !e.milestone?.trim())
      throw new Error(`link-check-allow.json: ${e.path} needs a "reason" and a "milestone"`);
  }
  return entries;
}

export function readLinkAllowList(webDir) {
  const file = join(webDir, "link-check-allow.json");
  return existsSync(file) ? parseLinkAllowList(readFileSync(file, "utf8")) : [];
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const URL_ATTR = /\s(href|src|action|poster|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const SRCSET_ATTR = /\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** Opening tags only, with script/style bodies and comments dropped, so text inside them is never read as markup. */
function tagsOf(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<(script|style)\b[^>]*>)[\s\S]*?<\/\2>/gi, "$1</$2>");
  return stripped.match(/<[a-z][^>]*>/gi) ?? [];
}

/** Every URL a page links to or loads: [{ url, attr }]. */
export function urlsOf(html) {
  const found = [];
  for (const tag of tagsOf(html)) {
    for (const m of tag.matchAll(URL_ATTR))
      found.push({ url: decodeEntities(m[2] ?? m[3] ?? ""), attr: m[1] });
    for (const m of tag.matchAll(SRCSET_ATTR))
      for (const part of (m[1] ?? m[2] ?? "").split(",")) {
        const url = part.trim().split(/\s+/)[0];
        if (url) found.push({ url: decodeEntities(url), attr: "srcset" });
      }
  }
  return found;
}

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, '"');

/** The ids (and legacy anchor names) on a page. */
export function idsOf(html) {
  const ids = new Set();
  for (const tag of tagsOf(html))
    for (const m of tag.matchAll(/\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) ids.add(m[1] ?? m[2]);
  return ids;
}

/** The files a URL path may be: /about → about.html or about/index.html; / → index.html; /x.txt → x.txt. */
function candidates(urlPath) {
  const p = urlPath.replace(/\/+$/, "");
  if (p === "") return ["index.html"];
  const rel = p.slice(1);
  return /\.[a-z0-9]+$/i.test(rel) ? [rel] : [`${rel}.html`, `${rel}/index.html`];
}

/**
 * Checks every dist HTML file. `files` is a Map of dist-relative name → text (HTML files only are parsed; other files
 * only need to exist, and `.svg` ids are readable for `<use href="x.svg#id">`). Returns a list of problems.
 */
export function checkLinksIn(files, allow = []) {
  const problems = [];
  const names = new Set(files.keys());
  const used = new Set();
  const allowed = new Map(allow.map((e) => [e.path.replace(/\/+$/, "") || "/", e]));
  const idCache = new Map();
  const idsFor = (name) => {
    if (!idCache.has(name)) idCache.set(name, idsOf(files.get(name) ?? ""));
    return idCache.get(name);
  };
  for (const [name, html] of files) {
    if (!name.endsWith(".html")) continue;
    // The URL path of this page, to resolve relative links ("a.html" → "/a").
    const pagePath = `/${name.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "")}`;
    for (const { url, attr } of urlsOf(html)) {
      if (!url || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) continue; // external, mailto:, tel:, data:, javascript:
      const hashAt = url.indexOf("#");
      const fragment = hashAt >= 0 ? url.slice(hashAt + 1) : "";
      const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
      const path = noHash.split("?")[0];
      let target; // dist-relative file name
      let urlPath;
      if (path === "") {
        urlPath = pagePath;
        target = name;
      } else {
        urlPath = posix.normalize(path.startsWith("/") ? path : posix.join(posix.dirname(`/${name}`), path));
        if (WORKER_PREFIXES.some((w) => urlPath.startsWith(w))) continue;
        const key = urlPath.replace(/\/+$/, "") || "/";
        target = candidates(urlPath).find((c) => names.has(c));
        if (!target) {
          if (allowed.has(key)) used.add(key);
          else problems.push(`${name}: ${attr}="${url}" does not resolve to a built file`);
          continue;
        }
      }
      if (fragment && fragment !== "top" && /\.(html|svg)$/.test(target) && !idsFor(target).has(fragment))
        problems.push(`${name}: ${attr}="${url}": no id "${fragment}" on ${target}`);
    }
  }
  for (const [key, e] of allowed)
    if (!used.has(key)) {
      const resolves = candidates(key).some((c) => names.has(c));
      problems.push(
        resolves
          ? `link-check-allow.json: ${key} (${e.milestone}) now exists: remove the entry`
          : `link-check-allow.json: ${key} (${e.milestone}) is not linked from any page: remove the entry`,
      );
    }
  return [...new Set(problems)]; // a footer link repeated in a page is reported once
}

/** Reads dist and runs the check; `webDir` is apps/web. */
export function checkLinks(webDir) {
  const dist = join(webDir, "dist");
  const files = new Map();
  for (const file of walk(dist)) {
    const name = relative(dist, file).split(sep).join("/");
    files.set(name, /\.(html|svg)$/i.test(name) ? readFileSync(file, "utf8") : "");
  }
  return checkLinksIn(files, readLinkAllowList(webDir));
}
