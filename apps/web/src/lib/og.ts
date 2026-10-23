// Where a page's share image lives (WEB-OG): /og/<slug>.png, the slug being the page path with "/" turned into "-"
// ("/" is "index", "/services/app-rescue" is "services-app-rescue"). scripts/build-og.mjs renders the files after the
// build, reading each page's og:image, so this function is the only place the name is made.
import { cleanPath } from "./page-path";

export function ogPath(pathname: string): string {
  const slug = cleanPath(pathname)
    .replace(/^\/+|\/+$/g, "")
    .replace(/\//g, "-");
  return `/og/${slug || "index"}.png`;
}
