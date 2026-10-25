// CSRF decision for a JSON API [docs/05 §7.1, ADM-G-02, POR-02], shared by the admin and portal Workers (each wraps
// it in its own Hono middleware and error body). Hono's built-in csrf() only looks at form bodies; this covers every
// unsafe request: it must come from the app's own origin and carry JSON (a cross-site page can only send form-like
// content types without a CORS preflight, and there is no CORS here at all).
//   1. Unsafe methods (anything but GET, HEAD, OPTIONS): `Origin` must equal the app origin. Without an `Origin`
//      header (some same-origin requests), `Sec-Fetch-Site: same-origin` must be present.
//   2. A request that has a body must be `application/json`. The one exception is a route that declares a binary upload
//      (`allowBinary`, admin file vault, M3.4): its body must be `application/octet-stream` instead, and rule 1 still applies.

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

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
  if (SAFE.has(i.method)) return "ok";
  const sameOrigin = i.origin ? i.origin === new URL(i.url).origin : i.secFetchSite === "same-origin";
  if (!sameOrigin) return "cross_site";
  const type = i.allowBinary ? /^application\/octet-stream(?:\s*;|$)/i : /^application\/json(?:\s*;|$)/i;
  if (i.hasBody && !type.test(i.contentType ?? "")) return "not_json";
  return "ok";
}
