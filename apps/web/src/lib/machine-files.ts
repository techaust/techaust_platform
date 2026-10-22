// The machine-readable files the site publishes: /rss.xml (RSS 2.0, written by hand, no package) and
// /.well-known/security.txt (RFC 9116, docs/07-A §6). Pure functions; the endpoints in src/pages call them.

import { blogPage } from "../content/work-page";

/** The canonical origin of the public site (astro.config.mjs `site`). */
export const ORIGIN = "https://techaust.com";

/** XML-escapes text for element content and attribute values. */
export const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export type FeedPost = { id: string; data: { title: string; description: string; date: Date } };

/**
 * RSS 2.0 for the published posts (the caller passes `published(posts)`, already newest first; drafts never get here).
 * With no posts it is a valid channel with no items.
 */
export function buildRss(posts: readonly FeedPost[], origin: string = ORIGIN): string {
  const items = posts
    .map((p) => {
      const url = `${origin}/blog/${p.id}`;
      return [
        "    <item>",
        `      <title>${xmlEscape(p.data.title)}</title>`,
        `      <link>${xmlEscape(url)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
        `      <pubDate>${p.data.date.toUTCString()}</pubDate>`,
        `      <description>${xmlEscape(p.data.description)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  const lastBuild = posts[0]
    ? `\n    <lastBuildDate>${posts[0].data.date.toUTCString()}</lastBuildDate>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>TecHaust Technologies: Blog</title>
    <link>${origin}/blog</link>
    <description>${xmlEscape(blogPage.meta.description)}</description>
    <language>en-IN</language>
    <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml" />${lastBuild}${items ? `\n${items}` : ""}
  </channel>
</rss>
`;
}

/** security.txt (RFC 9116). `expires` is ISO 8601 (site.securityTxtExpires). */
export function buildSecurityTxt(expires: string, origin: string = ORIGIN): string {
  return `Contact: mailto:security@techaust.com
Expires: ${expires}
Preferred-Languages: en
Policy: ${origin}/security
Canonical: ${origin}/.well-known/security.txt
`;
}
