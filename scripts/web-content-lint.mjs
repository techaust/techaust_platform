// Content lint for the public site (WEB-G-14 honesty rules; banned phrases of docs/07 §1.3) and the heading rule
// (exactly one h1 per built page, WEB-SVC-02 / docs/06). Pure functions (no process.exit) so a Vitest test can prove each
// rule fails on bad input. Two entry points:
//   - this file run directly (`node scripts/web-content-lint.mjs`, part of `pnpm check`): the source content,
//     apps/web/src/content
//   - checkWeb() in scripts/web-dist-checks.mjs (run by the web build): the same phrases over the built HTML's visible
//     text, plus the one-h1 rule
// Exceptions live in apps/web/content-lint-allow.json: { "allow": [{ "file", "phrase", "reason" }] }. Every entry needs a
// reason (the comment 07 §1.3 asks for); `file` is the path relative to apps/web (source) or to dist (built HTML).
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BANNED_PHRASES, findBannedPhrases } from "../packages/core/src/public-text.ts";
import { walk } from "./web-shared.mjs";

// The docs/07 §1.3 list lives in @techaust/core (packages/core/src/public-text.ts), one source for this lint, the built-HTML checks and
// the admin's catalogue publish (audit A2 finding 2). `id` is what an allow-list entry names.
export const BANNED = BANNED_PHRASES;

/** Validates the allow-list file's content (already parsed). Returns { entries, problems }. */
export function parseAllowList(json) {
  const problems = [];
  const entries = [];
  const list = json && typeof json === "object" && Array.isArray(json.allow) ? json.allow : null;
  if (!list) return { entries, problems: ['content-lint-allow.json: expected { "allow": [ … ] }'] };
  list.forEach((e, i) => {
    const where = `content-lint-allow.json: entry ${i + 1}`;
    if (!e || typeof e.file !== "string" || e.file === "") problems.push(`${where} has no "file"`);
    else if (!BANNED.some((b) => b.id === e.phrase))
      problems.push(`${where}: "${e.phrase}" is not a banned phrase`);
    else if (typeof e.reason !== "string" || e.reason.trim().length < 10)
      problems.push(`${where} (${e.file}, "${e.phrase}") needs a "reason" comment`);
    else entries.push({ file: e.file, phrase: e.phrase });
  });
  return { entries, problems };
}

/** Banned phrases found in `text`; each with the phrase id and a little context. */
export const findBanned = (text) => findBannedPhrases(text);

/** Problems for one file's text, minus allow-listed (file, phrase) pairs. */
export function checkBanned(name, text, allow = []) {
  const ok = new Set(allow.map((a) => `${a.file}\u0000${a.phrase}`));
  const problems = [];
  const seen = new Set();
  for (const f of findBanned(text)) {
    if (ok.has(`${name}\u0000${f.id}`)) continue;
    const key = `${f.id}\u0000${f.around}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(
      `${name}: banned phrase "${f.id}" (07 §1.3): "…${f.around}…" (reword, or allow-list it with a reason)`,
    );
  }
  return problems;
}

/** What a visitor reads or hears from built HTML: text, plus the attributes that are shown or read out. */
export function visibleText(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ");
  const attrs = [];
  for (const m of stripped.matchAll(
    /\s(?:aria-label|aria-description|title|alt|placeholder|content)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
  )) {
    const v = m[1] ?? m[2] ?? "";
    // Only a value that is wholly a URL, path or fragment (no spaces) is skipped; "#1 in India" is text.
    if (!/^(?:https?:\/\/\S*|\/\S*|#\S*)$/i.test(v)) attrs.push(v);
  }
  const text = stripped
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"');
  return `${text}\n${attrs.join("\n")}`;
}

/** Banned phrases in the visible text of a built page. */
export const checkBannedHtml = (name, html, allow = []) => checkBanned(name, visibleText(html), allow);

/** Exactly one h1 per built page. */
export function checkOneH1(name, html) {
  const n = (
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
      .match(/<h1[\s>]/gi) ?? []
  ).length;
  return n === 1 ? [] : [`${name}: ${n} <h1> elements (exactly one per page)`];
}

/** The allow-list of apps/web ({ entries, problems }); a missing file means no exceptions. */
export function readAllowList(webDir) {
  const file = join(webDir, "content-lint-allow.json");
  if (!existsSync(file)) return { entries: [], problems: [] };
  try {
    return parseAllowList(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { entries: [], problems: ["content-lint-allow.json is not valid JSON"] };
  }
}

/** Banned phrases over the source content (apps/web/src/content). */
export function lintSource(webDir) {
  const { entries, problems } = readAllowList(webDir);
  const root = join(webDir, "src", "content");
  if (!existsSync(root)) return problems;
  for (const file of walk(root)) {
    if (!/\.(md|mdx|ts|tsx|json|ya?ml|astro)$/.test(file)) continue;
    const name = relative(webDir, file).split(sep).join("/");
    problems.push(...checkBanned(name, readFileSync(file, "utf8"), entries));
  }
  return problems;
}

/** The built-HTML half, called by checkWeb for each page: banned phrases and the one-h1 rule. */
export function lintBuiltPage(name, html, allow) {
  return [...checkBannedHtml(name, html, allow), ...checkOneH1(name, html)];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const webDir = fileURLToPath(new URL("../apps/web", import.meta.url));
  const problems = lintSource(webDir);
  if (problems.length > 0) {
    console.error(`web-content-lint: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("web-content-lint: ok (no banned phrases in apps/web/src/content)");
}
