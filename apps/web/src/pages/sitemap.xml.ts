// /sitemap.xml (WEB-G-11): every indexable page with a dated, stable <lastmod>. Static: built once, no runtime.
// Flagged-off services, drafts, the 404, /thanks and /preview/* are never in it (lib/site-pages.ts).
import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { published } from "../lib/blog";
import { buildSitemap } from "../lib/search-files";
import { sitePages } from "../lib/site-pages";
import { publishedCases } from "../lib/work";

export const GET: APIRoute = async () =>
  new Response(
    buildSitemap(
      sitePages(published(await getCollection("blog")), publishedCases(await getCollection("caseStudies"))),
    ),
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
