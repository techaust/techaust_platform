// /.well-known/security.txt (RFC 9116, WEB-SEC, docs/07-A §6). `Expires` is site.securityTxtExpires; the dist check
// (scripts/web-dist-checks.mjs) fails the build when it is in the past or more than 366 days away.
import type { APIRoute } from "astro";
import { site } from "../../config/site";
import { buildSecurityTxt } from "../../lib/machine-files";

export const GET: APIRoute = () =>
  new Response(buildSecurityTxt(site.securityTxtExpires), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
