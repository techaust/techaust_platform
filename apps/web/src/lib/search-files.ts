// The files search engines and AI crawlers read: /sitemap.xml, /robots.txt and /llms.txt (WEB-G-11). Written by hand, no
// package (as RSS is); pure functions, called by the endpoints in src/pages. Same input, same bytes: nothing here reads
// the clock.
import { ORIGIN, xmlEscape } from "./machine-files";
import type { SitePage } from "./site-pages";

/** The absolute URL of a page path: the home page keeps its slash, every other page has none (trailingSlash: never). */
export const pageUrl = (path: string, origin: string = ORIGIN): string =>
  path === "/" ? `${origin}/` : `${origin}${path}`;

/** sitemaps.org 0.9: one <url> per page with its dated <lastmod>, sorted by URL so the file is stable. */
export function buildSitemap(pages: readonly SitePage[], origin: string = ORIGIN): string {
  const rows = [...pages]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(
      (p) =>
        `  <url>\n    <loc>${xmlEscape(pageUrl(p.path, origin))}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`;
}

/**
 * robots.txt: everything is disallowed unless this is the production build (CLOUDFLARE_ENV=production), which allows
 * all and names the sitemap. Staging and local builds stay closed to crawlers (the static `_headers` also sends
 * X-Robots-Tag: noindex until Phase 7).
 */
export function buildRobots(production: boolean, origin: string = ORIGIN): string {
  return production
    ? `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
    : "# Not production: crawlers are asked to stay away.\nUser-agent: *\nDisallow: /\n";
}

const SECTIONS = ["Services", "Industries", "Company", "Blog", "Legal"] as const;

/**
 * llms.txt (llmstxt.org): an H1 with the name, a one-line summary in a blockquote, then H2 sections of
 * `- [name](url): description` links. The descriptions are the pages' own meta descriptions. The Blog section is left
 * out until there is a published post.
 */
export function buildLlms(
  pages: readonly SitePage[],
  summary: string,
  name: string,
  origin: string = ORIGIN,
): string {
  const lines = [`# ${name}`, "", `> ${summary}`, ""];
  const hasPosts = pages.some((p) => p.path.startsWith("/blog/"));
  for (const section of SECTIONS) {
    const rows = pages.filter((p) => p.section === section);
    if (rows.length === 0 || (section === "Blog" && !hasPosts)) continue;
    lines.push(`## ${section}`, "");
    for (const p of rows) lines.push(`- [${p.name}](${pageUrl(p.path, origin)}): ${p.description}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
