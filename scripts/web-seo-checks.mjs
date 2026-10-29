// M2.5 build checks over the built public site (apps/web/dist): the SEO tags on every page (WEB-G-09), the JSON-LD
// graph against what the page shows (WEB-SVC-04, WEB-BLOG, WEB-IND), the sitemap against the built pages (WEB-G-11),
// and the JavaScript budget (WEB-G-13, NFR-1). Pure functions over strings, so a Vitest test can prove each one fails on
// bad input; scripts/web-dist-checks.mjs `checkWeb` runs them over dist, and scripts/check-web-dist.mjs prints the
// JavaScript table.
import { existsSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { decodeEntities, metaContent, pagePath, titleOf } from "./web-og.mjs";
import { walk } from "./web-shared.mjs";

export const ORIGIN = "https://techaust.com";
export const TITLE_MAX = 60;
export const JS_BUDGET_BYTES = 50 * 1024;
/** Pages that carry noindex (and no canonical link or description): the 404 and the form's thank-you page. */
export const NOINDEX_PAGES = new Set(["404.html", "thanks.html"]);

const strip = (html) =>
  html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ");
const textOf = (html) =>
  decodeEntities(strip(html).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const alnum = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// ── SEO tags ───────────────────────────────────────────────────────────────────────────────────────────────────

/** WEB-G-09 on one built page; `name` is the file ("services/app-rescue.html"). */
export function checkSeoTags(name, html) {
  const problems = [];
  const noindex = NOINDEX_PAGES.has(name);
  const title = titleOf(html);
  if (!title) problems.push(`${name}: no <title>`);
  else if ([...title].length > TITLE_MAX)
    problems.push(`${name}: <title> is ${[...title].length} characters (at most ${TITLE_MAX})`);
  const robots = metaContent(html, "robots");
  const hasNoindex = robots !== undefined && /\bnoindex\b/i.test(robots);
  if (noindex && !hasNoindex) problems.push(`${name}: must be noindex`);
  if (!noindex && hasNoindex)
    problems.push(`${name}: noindex is only for ${[...NOINDEX_PAGES].join(" and ")}`);
  const canonical = /<link\b[^>]*\brel="canonical"[^>]*>/i.exec(html);
  const href = canonical ? /\bhref="([^"]*)"/i.exec(canonical[0])?.[1] : undefined;
  if (!noindex) {
    if (!href) problems.push(`${name}: no canonical link`);
    else if (href !== `${ORIGIN}${pagePath(name) === "/" ? "/" : pagePath(name)}`)
      problems.push(`${name}: canonical "${href}" is not ${ORIGIN}${pagePath(name)}`);
    if (!metaContent(html, "description")) problems.push(`${name}: no meta description`);
  }
  const og = {
    "og:title": metaContent(html, "og:title"),
    "og:url": metaContent(html, "og:url"),
    "og:image": metaContent(html, "og:image"),
    "twitter:card": metaContent(html, "twitter:card"),
  };
  for (const [k, v] of Object.entries(og)) if (!v) problems.push(`${name}: no ${k}`);
  if (!noindex && !metaContent(html, "og:description")) problems.push(`${name}: no og:description`);
  if (og["og:title"] && title && og["og:title"] !== title)
    problems.push(`${name}: og:title differs from <title>`);
  if (og["og:url"] && !og["og:url"].startsWith(`${ORIGIN}/`) && og["og:url"] !== ORIGIN)
    problems.push(`${name}: og:url "${og["og:url"]}" is not on ${ORIGIN}`);
  // The description's length (checkMetaDescription) and the single h1 (lintBuiltPage) are checked in web-dist-checks.mjs.
  return problems;
}

/** Every title is unique across the built pages. */
export function checkUniqueTitles(pages) {
  const seen = new Map();
  const problems = [];
  for (const [name, html] of pages) {
    const t = titleOf(html);
    if (!t) continue;
    if (seen.has(t)) problems.push(`${name}: <title> "${t}" is also the title of ${seen.get(t)}`);
    else seen.set(t, name);
  }
  return problems;
}

// ── JSON-LD ────────────────────────────────────────────────────────────────────────────────────────────────────

const ALLOWED_TYPES = new Set([
  "Organization",
  "ProfessionalService",
  "WebSite",
  "BreadcrumbList",
  "Service",
  "FAQPage",
  "Article",
]);
const typesOf = (n) => (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]);

function emptyStrings(value, path, out) {
  if (typeof value === "string") {
    if (value.trim() === "") out.push(path);
  } else if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) emptyStrings(v, `${path}[${i}]`, out);
  } else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) emptyStrings(v, `${path}.${k}`, out);
  else if (value === null || value === undefined) out.push(path);
}

/**
 * A priced answer is printed three times, one per currency view (copy__v--both, --inr, --usd; CSS shows one). The
 * JSON-LD is the INR view, so compare against that one: returns its inner HTML, or `html` itself when the answer has
 * no price.
 */
export function inrView(html) {
  const open = /<span\b[^>]*\bclass="[^"]*\bcopy__v--inr\b[^"]*"[^>]*>/i.exec(html);
  if (!open) return html;
  const start = open.index + open[0].length;
  let depth = 1;
  for (const m of html.slice(start).matchAll(/<(\/?)span\b/gi)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, start + m.index);
  }
  return html.slice(start);
}

/** The questions and answers a page shows in its FAQ (`<details class="faq__item">`), as plain text. */
export function visibleFaq(html) {
  const items = [];
  for (const m of html.matchAll(/<details\b[^>]*\bclass="faq__item[^"]*"[^>]*>([\s\S]*?)<\/details>/gi)) {
    const q = /<span\b[^>]*faq__qtext[^>]*>([\s\S]*?)<\/span>/i.exec(m[1])?.[1];
    const a = /<p\b[^>]*\bfaq__a\b[^>]*>([\s\S]*?)<\/p>/i.exec(m[1])?.[1];
    items.push({ q: q === undefined ? "" : textOf(q), a: a === undefined ? "" : textOf(inrView(a)) });
  }
  return items;
}

/** The breadcrumb trail a page shows: names and absolute URLs (the current page, last, has no link). */
export function visibleCrumbs(html, path) {
  const nav = /<nav\b[^>]*\bclass="crumbs"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1];
  if (nav === undefined) return null;
  return [...nav.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => {
    const href = /<a\b[^>]*\bhref="([^"]*)"/i.exec(li[1])?.[1];
    return { name: textOf(li[1]), item: `${ORIGIN}${href ?? path}`.replace(/(.)\/$/, "$1") };
  });
}

/** A monthly unit ("a month", "per month", "/mo"); the same pattern as `MONTHLY` in apps/web/src/lib/structured-data.ts (a test pins them). */
export const MONTHLY_UNIT = /(^|[\s/])(month|mo)$/i;

/** The inner HTML of the first `<span>` whose opening tag matches `open`, read to its own closing tag (nested spans counted). */
function spanInner(html, open) {
  const start = open.exec(html);
  if (start === null) return undefined;
  const from = start.index + start[0].length;
  const tags = /<span\b[^>]*>|<\/span>/gi;
  tags.lastIndex = from;
  let depth = 1;
  for (let t = tags.exec(html); t !== null; t = tags.exec(html)) {
    depth += t[0][1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(from, t.index);
  }
  return undefined;
}

/** The hero's price tag: the lead word and the unit it prints (the first INR line on the page, with or without a USD line after it). */
function heroPriceWords(html) {
  const line = spanInner(html, /<span class="price__line price__line--inr"[^>]*>/);
  if (line === undefined) return { lead: "", unit: "" };
  const pick = (cls) =>
    textOf(new RegExp(`<span class="${cls}[^"]*"[^>]*>([^<]*)</span>`).exec(line)?.[1] ?? "");
  return { lead: pick("price__lead"), unit: pick("price__unit") };
}

/** The Offer states the unit and the lead the hero shows, in the page's own words (no new words). */
function checkOfferWording(name, html, offer) {
  const out = [];
  const { lead, unit } = heroPriceWords(html);
  const spec = offer.priceSpecification ?? {};
  if (unit) {
    if (spec["@type"] !== "UnitPriceSpecification" || alnum(spec.unitText ?? "") !== alnum(unit))
      out.push(`${name}: the page shows the unit "${unit}" but the Offer's UnitPriceSpecification lacks it`);
    if (MONTHLY_UNIT.test(unit) && spec.referenceQuantity?.unitCode !== "MON")
      out.push(`${name}: the page shows a monthly price but the Offer has no referenceQuantity of one month`);
  } else if (spec.unitText || spec.referenceQuantity) {
    out.push(`${name}: the Offer states a unit the page does not show`);
  }
  if (lead && alnum(offer.name ?? "") !== alnum(lead))
    out.push(`${name}: the page shows "${lead}" before the price but the Offer's name is not "${lead}"`);
  if (!lead && offer.name) out.push(`${name}: the Offer has a name the page does not show before the price`);
  return out;
}

/** The JSON-LD graph against the page: one graph, the right nodes, required fields, and text equal to what is shown. */
export function checkStructuredData(name, html) {
  const problems = [];
  const path = pagePath(name);
  const blocks = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  if (blocks.length !== 1) return [`${name}: ${blocks.length} JSON-LD blocks (exactly one @graph per page)`];
  let data;
  try {
    data = JSON.parse(blocks[0][1]);
  } catch {
    return [`${name}: the JSON-LD is not valid JSON`];
  }
  if (data["@context"] !== "https://schema.org")
    problems.push(`${name}: JSON-LD @context must be https://schema.org`);
  const graph = data["@graph"];
  if (!Array.isArray(graph) || graph.length === 0) return [...problems, `${name}: JSON-LD has no @graph`];
  const empties = [];
  emptyStrings(graph, "@graph", empties);
  for (const e of empties) problems.push(`${name}: JSON-LD ${e} is empty`);
  const ids = graph.map((n) => n["@id"]).filter(Boolean);
  if (new Set(ids).size !== ids.length) problems.push(`${name}: JSON-LD has a repeated @id`);
  for (const n of graph)
    for (const t of typesOf(n))
      if (!ALLOWED_TYPES.has(t))
        problems.push(`${name}: JSON-LD type "${t}" is not allowed (states more than the page shows)`);
  const of = (type) => graph.filter((n) => typesOf(n).includes(type));

  const [org] = of("Organization");
  if (of("Organization").length !== 1) problems.push(`${name}: exactly one Organization is required`);
  else {
    if (org["@id"] !== `${ORIGIN}/#org`) problems.push(`${name}: Organization @id must be ${ORIGIN}/#org`);
    for (const f of ["name", "url", "email"]) if (!org[f]) problems.push(`${name}: Organization has no ${f}`);
    // WEB-G-10's identity fields (audit A2 finding 4): the short name, the area served, the industry code and the line that
    // tells us apart from Tech Australia.
    for (const f of ["alternateName", "areaServed", "naics", "disambiguatingDescription"])
      if (!org[f] || (Array.isArray(org[f]) && org[f].length === 0))
        problems.push(`${name}: Organization has no ${f}`);
    if (org.naics && org.naics !== "541511")
      problems.push(`${name}: Organization naics must be 541511 (WEB-G-10)`);
    if (!org.logo?.url) problems.push(`${name}: Organization has no logo.url`);
    if (org.address) {
      for (const f of ["streetAddress", "addressLocality", "addressCountry"])
        if (!org.address[f]) problems.push(`${name}: Organization address has no ${f}`);
    }
    if (
      org.sameAs !== undefined &&
      (!Array.isArray(org.sameAs) || org.sameAs.some((u) => !/^https:\/\//.test(u)))
    )
      problems.push(`${name}: Organization sameAs must be a list of https URLs`);
  }
  if (of("WebSite").length !== 1) problems.push(`${name}: exactly one WebSite is required`);

  const crumbs = visibleCrumbs(html, path);
  const [bc] = of("BreadcrumbList");
  if (crumbs && !bc) problems.push(`${name}: the page shows breadcrumbs but has no BreadcrumbList`);
  if (!crumbs && bc) problems.push(`${name}: BreadcrumbList without visible breadcrumbs`);
  if (crumbs && bc) {
    const list = bc.itemListElement ?? [];
    const same =
      list.length === crumbs.length &&
      list.every((e, i) => e.position === i + 1 && e.name === crumbs[i].name && e.item === crumbs[i].item);
    if (!same) problems.push(`${name}: BreadcrumbList differs from the visible breadcrumbs`);
  }

  const faq = visibleFaq(html);
  const [fp] = of("FAQPage");
  if (faq.length > 0 && !fp) problems.push(`${name}: the page shows an FAQ but has no FAQPage`);
  if (faq.length === 0 && fp) problems.push(`${name}: FAQPage without a visible FAQ`);
  if (faq.length > 0 && fp) {
    const entities = fp.mainEntity ?? [];
    if (entities.length !== faq.length)
      problems.push(`${name}: FAQPage has ${entities.length} questions, the page shows ${faq.length}`);
    entities.forEach((e, i) => {
      const v = faq[i];
      if (!v) return;
      if (e["@type"] !== "Question" || e.acceptedAnswer?.["@type"] !== "Answer")
        problems.push(`${name}: FAQPage entry ${i + 1} is not a Question with an Answer`);
      if (alnum(e.name ?? "") !== alnum(v.q))
        problems.push(`${name}: FAQPage question ${i + 1} differs from the visible question`);
      const answer = alnum(e.acceptedAnswer?.text ?? "");
      if (!answer || alnum(v.a) !== answer)
        problems.push(
          `${name}: FAQPage answer ${i + 1} differs from the visible answer ("${v.q.slice(0, 40)}")`,
        );
    });
  }

  const isService = /^\/services\/[^/]+$/.test(path);
  const services = of("Service");
  if (isService && services.length !== 1) problems.push(`${name}: a service page needs exactly one Service`);
  if (!isService && services.length > 0)
    problems.push(`${name}: Service on a page that is not a service page`);
  for (const s of services) {
    for (const f of ["name", "description", "url"]) if (!s[f]) problems.push(`${name}: Service has no ${f}`);
    if (s.provider?.["@id"] !== `${ORIGIN}/#org`)
      problems.push(`${name}: Service provider must point to the Organization`);
    if (!s.areaServed?.length) problems.push(`${name}: Service has no areaServed`);
    const price = s.offers?.priceSpecification?.minPrice;
    if (s.offers && (!/^\d+\.\d{2}$/.test(price ?? "") || s.offers.priceCurrency !== "INR"))
      problems.push(`${name}: Service offer must be an INR price like 200000.00`);
    if (s.offers) problems.push(...checkOfferWording(name, html, s.offers));
    if (crumbs && s.name !== crumbs.at(-1)?.name)
      problems.push(`${name}: Service name differs from the page's breadcrumb`);
  }

  const isPost = /^\/blog\/[^/]+$/.test(path);
  const articles = of("Article");
  if (isPost && articles.length !== 1) problems.push(`${name}: a blog post needs exactly one Article`);
  if (!isPost && articles.length > 0) problems.push(`${name}: Article on a page that is not a blog post`);
  for (const a of articles) {
    for (const f of ["headline", "description", "datePublished", "dateModified"])
      if (!a[f]) problems.push(`${name}: Article has no ${f}`);
    if (!a.author?.name) problems.push(`${name}: Article has no author name`);
    if (a.publisher?.["@id"] !== `${ORIGIN}/#org`)
      problems.push(`${name}: Article publisher must point to the Organization`);
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
    if (h1 !== undefined && a.headline !== textOf(h1))
      problems.push(`${name}: Article headline differs from the h1`);
  }
  return problems;
}

// ── sitemap ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The <url> entries of a sitemap.xml: { loc, lastmod }. */
export function parseSitemap(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: /<loc>([^<]*)<\/loc>/.exec(m[1])?.[1] ?? "",
    lastmod: /<lastmod>([^<]*)<\/lastmod>/.exec(m[1])?.[1] ?? "",
  }));
}

/** The sitemap lists exactly the built indexable pages, each with an absolute URL and an ISO lastmod. */
export function checkSitemap(xml, builtNames) {
  const problems = [];
  const entries = parseSitemap(xml);
  const locs = new Set(entries.map((e) => e.loc));
  if (locs.size !== entries.length) problems.push("sitemap.xml: a URL is listed twice");
  for (const e of entries) {
    if (!e.loc.startsWith(`${ORIGIN}/`) && e.loc !== ORIGIN)
      problems.push(`sitemap.xml: ${e.loc} is not an absolute ${ORIGIN} URL`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.lastmod))
      problems.push(`sitemap.xml: ${e.loc} has no ISO lastmod ("${e.lastmod}")`);
  }
  const expected = builtNames
    .filter((n) => !NOINDEX_PAGES.has(n))
    .map((n) => (pagePath(n) === "/" ? `${ORIGIN}/` : `${ORIGIN}${pagePath(n)}`));
  for (const loc of expected)
    if (!locs.has(loc)) problems.push(`sitemap.xml: the built page ${loc} is missing`);
  for (const loc of locs)
    if (!expected.includes(loc))
      problems.push(`sitemap.xml: ${loc} is listed but not built (or not indexable)`);
  return problems;
}

// ── JavaScript budget ──────────────────────────────────────────────────────────────────────────────────────────

/** Script files a page loads from its own origin: <script src> and <link rel=modulepreload>, as dist-relative paths. */
export function pageScripts(html) {
  const out = new Set();
  const add = (u) => {
    if (u?.startsWith("/") && !u.startsWith("//")) out.add(u.split(/[?#]/)[0]);
  };
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"[^>]*>/gi)) add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*>/gi))
    add(/\bhref="([^"]*)"/i.exec(m[0])?.[1]);
  return [...out];
}

/** The bodies of the page's inline `<script type="module">` blocks (no `src`). */
export function inlineModules(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\btype="module"/i.test(m[1]) && !/\bsrc=/i.test(m[1]) && m[2].trim()) out.push(m[2]);
  }
  return out;
}

/** Static imports of a module (`import"./a.js"`, `import x from"./a.js"`, `export*from"./a.js"`); dynamic import() is not followed. */
export function staticImports(code) {
  const out = [];
  for (const m of code.matchAll(/\b(?:import|from)\s*["']([^"']+\.js)["']/g)) out.push(m[1]);
  return out;
}

/**
 * Gzipped size of every script a page loads, the module graph included (each file counted once). `read(urlPath)` returns
 * the file's text or undefined. Returns { total, files: [{ file, bytes }] }.
 */
export function pageJs(html, read) {
  const files = new Map();
  const visit = (urlPath) => {
    if (files.has(urlPath)) return;
    const code = read(urlPath);
    if (code === undefined) {
      files.set(urlPath, -1);
      return;
    }
    files.set(urlPath, gzipSync(Buffer.from(code), { level: 9 }).length);
    for (const spec of staticImports(code)) {
      visit(spec.startsWith("/") ? spec : posix.normalize(posix.join(posix.dirname(urlPath), spec)));
    }
  };
  for (const s of pageScripts(html)) visit(s);
  // Inline module scripts count too: their own bytes (as "inline module N") and the files they import.
  inlineModules(html).forEach((code, i) => {
    files.set(`inline module ${i + 1}`, gzipSync(Buffer.from(code), { level: 9 }).length);
    for (const spec of staticImports(code)) visit(spec.startsWith("/") ? spec : posix.normalize(`/${spec}`));
  });
  const list = [...files].map(([file, bytes]) => ({ file, bytes }));
  return { total: list.reduce((n, f) => n + Math.max(f.bytes, 0), 0), files: list };
}

/** Reads a script from dist by its URL path. */
export const readScript = (dist) => (urlPath) => {
  const file = join(dist, ...urlPath.split("/").filter(Boolean));
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
};

/** WEB-G-13 / NFR-1 over a whole dist: problems for pages over the budget or loading a missing file, and every page's total. */
export function measureJs(dist) {
  const read = readScript(dist);
  const problems = [];
  const rows = [];
  for (const file of walk(dist)) {
    const name = relative(dist, file).split(sep).join("/");
    if (!name.endsWith(".html")) continue;
    const { total, files } = pageJs(readFileSync(file, "utf8"), read);
    rows.push({ name, total, files });
    for (const f of files) if (f.bytes < 0) problems.push(`${name}: loads ${f.file}, which is not in dist`);
    if (total > JS_BUDGET_BYTES)
      problems.push(
        `${name}: ${(total / 1024).toFixed(1)} KB of gzipped JavaScript (at most ${JS_BUDGET_BYTES / 1024} KB)`,
      );
  }
  rows.sort((a, b) => b.total - a.total);
  return { problems, rows };
}
