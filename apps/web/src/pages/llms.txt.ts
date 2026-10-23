// /llms.txt (WEB-G-11, llmstxt.org): the site's pages for language models, with each page's own meta description.
import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { site } from "../config/site";
import { home } from "../content/home";
import { published } from "../lib/blog";
import { plainText } from "../lib/copy";
import { buildLlms } from "../lib/search-files";
import { sitePages } from "../lib/site-pages";
import { publishedCases } from "../lib/work";

export const GET: APIRoute = async () =>
  new Response(
    buildLlms(
      sitePages(published(await getCollection("blog")), publishedCases(await getCollection("caseStudies"))),
      plainText(home.meta.description),
      site.name,
    ),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
