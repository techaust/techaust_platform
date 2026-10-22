// Checks over the built public site (apps/web/dist) and its templates: WEB-G-07, WEB-G-12, WEB-G-18, audit M-3.
// Pure functions (no process.exit) so a Vitest test can prove each check fails on bad input; the CLI is
// scripts/check-web-dist.mjs, run by `pnpm --filter @techaust/web build` right after `astro build`.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

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

export function sha256Source(text) {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

/** Inline (no `src`) scripts the browser would execute; data blocks such as ld+json are not governed by the CSP. */
export function inlineScripts(html) {
  const found = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? "").toLowerCase();
    if (!JS_TYPES.has(type)) continue;
    found.push(m[2]);
  }
  return found;
}

const REQUIRED_HEADERS = [
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "content-security-policy",
];

/** WEB-G-12: the `_headers` file itself. */
export function checkHeaders(headersText) {
  const problems = [];
  const h = parseHeaders(headersText);
  for (const name of REQUIRED_HEADERS) if (!h[name]) problems.push(`_headers: "/*" has no ${name}`);
  if (h["x-content-type-options"] && h["x-content-type-options"].toLowerCase() !== "nosniff")
    problems.push("_headers: X-Content-Type-Options must be nosniff");
  if (!h["content-security-policy"]) return problems;
  const csp = parseCsp(h["content-security-policy"]);
  if (!csp["frame-ancestors"]?.includes("'none'")) problems.push("CSP: frame-ancestors must be 'none'");
  for (const dir of ["script-src", "script-src-elem", "script-src-attr"]) {
    const src = csp[dir] ?? [];
    if (src.includes("'unsafe-inline'")) problems.push(`CSP: ${dir} must not contain 'unsafe-inline'`);
    if (src.includes("'unsafe-eval'")) problems.push(`CSP: ${dir} must not contain 'unsafe-eval'`);
  }
  if (!csp["script-src"]) problems.push("CSP: no script-src directive");
  return problems;
}

/**
 * WEB-G-12 on one live response. `get(name)` returns a header value or null (a fetch `Headers#get`).
 * `html` (the body) is passed for HTML responses so its inline scripts are checked against the CSP actually served.
 */
export function checkResponseHeaders(label, get, html) {
  const problems = [];
  const text = [...REQUIRED_HEADERS.map((n) => `  ${n}: ${get(n) ?? ""}`)].join("\n");
  for (const name of REQUIRED_HEADERS) if (!get(name)) problems.push(`${label}: missing ${name}`);
  const asFile = `/*\n${text}\n`;
  for (const p of checkHeaders(asFile))
    if (!p.includes("has no") && !p.includes("no script-src"))
      problems.push(`${label}: ${p.replace(/^_headers: /, "")}`);
  if (html !== undefined) for (const p of checkHtml(label, html, asFile)) problems.push(p);
  return problems;
}

/** WEB-G-12: every inline script is hashed in script-src; no inline `<style>` or `style=` anywhere. */
export function checkHtml(name, html, headersText) {
  const problems = [];
  const csp = parseCsp(parseHeaders(headersText)["content-security-policy"] ?? "");
  const allowed = new Set(csp["script-src"] ?? []);
  for (const body of inlineScripts(html)) {
    if (!allowed.has(sha256Source(body)))
      problems.push(
        `${name}: inline <script> ${sha256Source(body)} is not in the CSP script-src (update public/_headers)`,
      );
  }
  if (/<style\b/i.test(html))
    problems.push(`${name}: inline <style> element (the CSP has no 'unsafe-inline' for styles)`);
  if (/<[a-z][^>]*\sstyle\s*=/i.test(html)) problems.push(`${name}: inline style="" attribute`);
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html))
    problems.push(`${name}: inline event-handler attribute (onclick= …)`);
  return problems;
}

const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/;
const GA =
  /googletagmanager\.com|google-analytics\.com|\bgtag\s*\(|\bdataLayer\b|["'`]G-[A-Z0-9]{8,12}["'`]|\b_ga(?:_[A-Z0-9]+)?\b/;

/** Text of a built file that must never appear on the public site. `ga4Id` empty → no Google Analytics at all. */
export function checkText(name, text, { ga4Id = "" } = {}) {
  const problems = [];
  if (GSTIN.test(text)) problems.push(`${name}: a GSTIN-shaped value (never public, WEB-G-12/M-3)`);
  if (/techaustsocial/i.test(text)) problems.push(`${name}: "@techaustsocial" (never public)`);
  // The proprietor's name is kept out of the footer only (WEB-G-04); About and the legal pages must show it (04 §0).
  const footer = (text.match(/<footer[\s\S]*?<\/footer>/gi) ?? []).join("\n");
  if (/rupak\s+sarkar/i.test(footer))
    problems.push(`${name}: the proprietor's name in the footer (WEB-G-04)`);
  if (!ga4Id && GA.test(text))
    problems.push(`${name}: Google Analytics code or cookie name while the GA4 ID is empty`);
  if (/sample content\s*[—-]\s*not final copy/i.test(text)) problems.push(`${name}: a design-preview sample`);
  return problems;
}

// "&" as text: the raw character followed by a space, or any of its escapes (Astro writes text "&" as "&amp;").
const AMP_TEXT = /&(?:amp;|#0*38;|#x0*26;)|&\s/i;
const READ_ATTRS =
  /\s(aria-label|aria-description|aria-roledescription|title|alt|placeholder|value|content)\s*=\s*("([^"]*)"|'([^']*)')/gi;

/**
 * "and", never "&", in what a visitor reads or hears (owner, 2026-10-22; docs/07 §1.1): page text, and the attributes
 * that are read out or shown (aria-label, title, alt, placeholder, a meta content that isn't a URL). Scripts, styles,
 * comments, URLs (href, src, srcset…) and code keep their "&".
 */
export function checkAmpersands(name, html) {
  const problems = [];
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|code|pre)\b[\s\S]*?<\/\1>/gi, "");
  for (const m of stripped.matchAll(READ_ATTRS)) {
    const value = m[3] ?? m[4] ?? "";
    if (m[1].toLowerCase() === "content" && /^(https?:|\/)/i.test(value)) continue;
    if (AMP_TEXT.test(value)) problems.push(`${name}: "&" in ${m[1]}="${value.slice(0, 60)}" (write "and")`);
  }
  const text = stripped.replace(/<[^>]*>/g, " ");
  const hit = AMP_TEXT.exec(text);
  if (hit) {
    const around = text
      .slice(Math.max(0, hit.index - 30), hit.index + 30)
      .replace(/\s+/g, " ")
      .trim();
    problems.push(`${name}: "&" in page text ("…${around}…"; write "and")`);
  }
  return problems;
}

/** WEB-G-07: no money amount typed into a template (prices come from the catalogue snapshot). */
export function checkAmountLiterals(name, source) {
  const problems = [];
  const lines = source.split(/\r?\n/);
  // Code comments are skipped in code files only: in Markdown/data files a leading "*" is a list item, not a comment.
  const code = /\.(astro|ts|tsx)$/.test(name);
  lines.forEach((line, i) => {
    const t = line.trim();
    if (code && (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("<!--")))
      return;
    const rupee = "(?:₹|&#8377;|&#x20b9;|&inr;|\\bRs\\.?|\\bINR|\\bUSD|US\\$|\\$)";
    if (new RegExp(`${rupee}\\s*\\d|\\d\\s*(?:₹|&#8377;|&#x20b9;|\\bINR\\b|\\bUSD\\b)`, "i").test(t))
      problems.push(
        `${name}:${i + 1}: a price amount typed into a template (use {{price:Sx}} / formatMoney)`,
      );
  });
  return problems;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const TEXT_EXT = /\.(html|css|js|mjs|svg|txt|xml|json|webmanifest|map)$/i;

/** The GA4 measurement ID from site.ts ("" when off). */
export function readGa4Id(siteTsText) {
  return /ga4Id:\s*"([^"]*)"/.exec(siteTsText)?.[1] ?? "";
}

/** Everything: `webDir` is apps/web. Returns a list of problems (empty = all good). */
export function checkWeb(webDir) {
  const problems = [];
  const dist = join(webDir, "dist");
  if (!existsSync(dist)) return [`${dist} does not exist: run the build first`];
  const headersPath = join(webDir, "public", "_headers");
  const headersText = readFileSync(headersPath, "utf8");
  problems.push(...checkHeaders(headersText));
  const ga4Id = readGa4Id(readFileSync(join(webDir, "src", "config", "site.ts"), "utf8"));
  for (const file of walk(dist)) {
    const name = relative(dist, file).split(sep).join("/");
    if (/^preview(\/|\.|$)/i.test(name)) problems.push(`${name}: preview pages must not be in the build`);
    if (name === "_headers") {
      if (readFileSync(file, "utf8") !== headersText)
        problems.push("dist/_headers differs from public/_headers");
      continue;
    }
    if (!TEXT_EXT.test(name)) continue;
    const text = readFileSync(file, "utf8");
    problems.push(...checkText(name, text, { ga4Id }));
    if (name.endsWith(".html"))
      problems.push(...checkHtml(name, text, headersText), ...checkAmpersands(name, text));
  }
  for (const file of walk(join(webDir, "src"))) {
    const name = relative(webDir, file).split(sep).join("/");
    if (name.startsWith("src/preview/") || !/\.(astro|ts|tsx|md|mdx|ya?ml|json)$/.test(name)) continue;
    if (name === "src/config/site.ts") continue;
    problems.push(...checkAmountLiterals(name, readFileSync(file, "utf8")));
  }
  return problems;
}
