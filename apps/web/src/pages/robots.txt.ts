// /robots.txt (WEB-G-11): closed to crawlers unless this is the production build (CLOUDFLARE_ENV=production, set by
// deploy-prod.yml), which allows all and names the sitemap. Replaces the old static public/robots.txt.
import type { APIRoute } from "astro";
import { buildRobots } from "../lib/search-files";

export const GET: APIRoute = () =>
  new Response(buildRobots(process.env.CLOUDFLARE_ENV === "production"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
