// CSRF decision for a JSON API [docs/05 §7.1, ADM-G-02, POR-02], shared by the admin and portal Workers (each wraps
// it in its own Hono middleware and error body). Hono's built-in csrf() only looks at form bodies; this covers every
// unsafe request: it must come from the app's own origin and carry JSON (a cross-site page can only send form-like
// content types without a CORS preflight, and there is no CORS here at all).
//   1. Unsafe methods (anything but GET, HEAD, OPTIONS): `Origin` must equal the app origin. Without an `Origin`
//      header (some same-origin requests), `Sec-Fetch-Site: same-origin` must be present.
//   2. A request that has a body must be `application/json`. The one exception is a route that declares a binary upload
//      (`allowBinary`, admin file vault, M3.4): its body must be `application/octet-stream` instead, and rule 1 still applies.
//   3. M7.5 (A1 F3, L3; ASVS 5.0 3.5.3): a GET or HEAD under `/api/` is refused when the browser says it was NOT made by the app's own pages
//      (`Sec-Fetch-Site` present and not `same-origin`: `cross-site`, `same-site`, or `none` for a typed or bookmarked address). Some GETs write (the portal's
//      first view of an invoice blocks its void, RA-10; PayPal's return capture; an offer's first view), and the session cookie is SameSite=Lax at most for
//      a top-level navigation, so a link on another site must not reach them. The SPA's own fetches and a PDF it opens are `same-origin`. A request without
//      the header (a script, curl, the health checks, an old browser) is judged as before: browsers that send cookies on a cross-site navigation send it.

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const READS = new Set(["GET", "HEAD"]);

export type CsrfInput = {
  method: string;
  origin: string | null | undefined;
  secFetchSite: string | null | undefined;
  /** The request URL: its origin is the app origin. */
  url: string;
  contentType: string | null | undefined;
  hasBody: boolean;
  /** The route takes a raw binary body (an upload): `application/octet-stream` replaces `application/json`. Default false. */
  allowBinary?: boolean;
};

export type CsrfVerdict = "ok" | "cross_site" | "not_json";

export function csrfCheck(i: CsrfInput): CsrfVerdict {
  if (READS.has(i.method) && i.secFetchSite && i.secFetchSite !== "same-origin")
    return new URL(i.url).pathname.startsWith("/api/") ? "cross_site" : "ok";
  if (SAFE.has(i.method)) return "ok";
  const sameOrigin = i.origin ? i.origin === new URL(i.url).origin : i.secFetchSite === "same-origin";
  if (!sameOrigin) return "cross_site";
  const type = i.allowBinary ? /^application\/octet-stream(?:\s*;|$)/i : /^application\/json(?:\s*;|$)/i;
  if (i.hasBody && !type.test(i.contentType ?? "")) return "not_json";
  return "ok";
}
