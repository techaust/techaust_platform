// Header check against a deployed web Worker (WEB-G-12: "a header test against the staging URLs covers HTML, CSS, JS,
// image and font responses"). Run by the lead after a staging deploy:
//
//   node scripts/check-web-headers.mjs [base-url]
//
// Default URL: the staging web Worker (docs/runbooks/environments.md). Staging sits behind Cloudflare Access, so pass
// ONE of these through the environment (never on the command line, never committed):
//   CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET   an Access service token (docs/runbooks/access-staging.md Part 2)
//   CF_ACCESS_COOKIE                                 the value of a signed-in browser's CF_Authorization cookie
// With neither, an Access sign-in redirect is reported as "BLOCKED by Cloudflare Access" and the script exits 2
// (not 0: nothing was checked). Exit 1 = a header problem; exit 0 = every response checked is fine.
import { checkResponseHeaders } from "./web-dist-checks.mjs";

const base = (
  process.argv[2] ?? "https://techaust-platform-web-staging.techaust-technologies-153.workers.dev"
).replace(/\/$/, "");
const auth = {};
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  auth["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  auth["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
}
if (process.env.CF_ACCESS_COOKIE) {
  const v = process.env.CF_ACCESS_COOKIE;
  auth.Cookie = v.includes("=") ? v : `CF_Authorization=${v}`;
}
const haveAuth = Object.keys(auth).length > 0;

class Blocked extends Error {}

async function get(path) {
  const res = await fetch(new URL(path, `${base}/`), { redirect: "manual", headers: auth });
  const loc = res.headers.get("location") ?? "";
  const viaAccess =
    /cloudflareaccess\.com/i.test(loc) || (res.status === 302 && /cdn-cgi\/access/i.test(loc));
  if (viaAccess || res.status === 401 || res.status === 403) {
    throw new Blocked(
      haveAuth
        ? `Cloudflare Access refused the credentials on ${path} (${res.status}). Check the service token or cookie.`
        : `BLOCKED by Cloudflare Access on ${path} (${res.status}): nothing was checked. Set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (or CF_ACCESS_COOKIE), see the header of this script.`,
    );
  }
  return res;
}

function assetUrls(html) {
  const out = { css: null, js: null, font: null, image: null };
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
    if (!href) continue;
    if (/rel="stylesheet"/.test(tag)) out.css ??= href;
    else if (/as="font"/.test(tag)) out.font ??= href;
    else if (/rel="(?:apple-touch-icon|icon)"/.test(tag)) out.image ??= href;
  }
  out.js = /<script\b[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1] ?? null;
  return out;
}

const problems = [];
let checked = 0;
async function check(label, path, { html = false } = {}) {
  const res = await get(path);
  const body = html ? await res.text() : undefined;
  if (!html) await res.arrayBuffer();
  checked++;
  const p = checkResponseHeaders(`${label} ${path} (${res.status})`, (n) => res.headers.get(n), body);
  problems.push(...p);
  console.log(`${p.length === 0 ? "ok  " : "FAIL"} ${label.padEnd(8)} ${path} (${res.status})`);
  return body;
}

try {
  // The 404 page is the richest page (the whole shell: CSS, scripts, fonts, icons) until the real pages exist.
  const page = await check("404", "/this-page-does-not-exist-check", { html: true });
  await check("html", "/", { html: true });
  const urls = assetUrls(page);
  for (const [kind, url] of Object.entries(urls)) {
    if (url) await check(kind, new URL(url, `${base}/`).pathname);
    else problems.push(`no ${kind} reference found in the 404 page, so no ${kind} response was checked`);
  }
  await check("favicon", "/favicon.ico");
  await check("api", "/api/geo");
} catch (e) {
  if (e instanceof Blocked) {
    console.error(e.message);
    process.exit(2);
  }
  throw e;
}

if (problems.length > 0) {
  console.error(`\ncheck-web-headers: ${problems.length} problem(s) on ${base}`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\ncheck-web-headers: ok, ${checked} responses on ${base}`);
