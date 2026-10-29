// Parsing a Cloudflare static-assets `_headers` file and a Content-Security-Policy, shared by the website's dist checks
// (scripts/web-dist-checks.mjs) and the SPA header guard (scripts/check-spa-headers.mjs). Dependency-free Node.

/** The `/*` block of a Cloudflare `_headers` file as a lower-cased-name map. */
export function parseHeaders(text) {
  const headers = {};
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      inBlock = raw.trim() === "/*";
      continue;
    }
    if (!inBlock) continue;
    const i = raw.indexOf(":");
    if (i > 0) headers[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim();
  }
  return headers;
}

/** Directive name → source list. */
export function parseCsp(csp) {
  const out = {};
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = sources;
  }
  return out;
}
