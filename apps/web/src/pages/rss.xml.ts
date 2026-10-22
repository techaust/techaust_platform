// /rss.xml: RSS 2.0 for the published blog posts (WEB-BLOG). Static: built once, no runtime. Drafts are excluded.

import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { published } from "../lib/blog";
import { buildRss } from "../lib/machine-files";

export const GET: APIRoute = async () =>
  new Response(buildRss(published(await getCollection("blog"))), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
