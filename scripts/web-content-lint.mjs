// Content lint for the public site (WEB-G-14 honesty rules; banned phrases of docs/07 §1.3) and the heading rule
// (exactly one h1 per built page, WEB-SVC-02 / docs/06). Pure functions (no process.exit) so a Vitest test can prove each
// rule fails on bad input. Two entry points:
//   - this file run directly (`node scripts/web-content-lint.mjs`, part of `pnpm check`): the source content,
//     apps/web/src/content
//   - checkWeb() in scripts/web-dist-checks.mjs (run by the web build): the same phrases over the built HTML's visible
//     text, plus the one-h1 rule
// Exceptions live in apps/web/content-lint-allow.json: { "allow": [{ "file", "phrase", "reason" }] }. Every entry needs a
// reason (the comment 07 §1.3 asks for); `file` is the path relative to apps/web (source) or to dist (built HTML).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Word-bounded: not glued to letters, digits, "_" or "-" on either side. `caseSensitive` is for "LIVE" as a badge,
// which must not catch the ordinary word "live".
const BEFORE = String.raw`(?<![\p{L}\p{N}_-])`;
const AFTER = String.raw`(?![\p{L}\p{N}_-])`;

/** The docs/07 §1.3 list. `id` is what an allow-list entry names. */
export const BANNED = [
  { id: "100%", re: String.raw`(?<![\p{L}\p{N}_.,-])100\s?(?:%|per\s?cent|percent)(?![\p{L}])` },
  { id: "guarantee", re: String.raw`${BEFORE}guarantee\w*${AFTER}` },
  { id: "no hallucinations", re: String.raw`${BEFORE}no\s+hallucinations?${AFTER}` },
  { id: "zero errors", re: String.raw`${BEFORE}zero\s+errors?${AFTER}` },
  { id: "zero manual", re: String.raw`${BEFORE}zero\s+manual${AFTER}` },
  { id: "ironclad", re: String.raw`${BEFORE}ironclad${AFTER}` },
  { id: "bulletproof", re: String.raw`${BEFORE}bulletproof${AFTER}` },
  { id: "military-grade", re: String.raw`${BEFORE}military[-\s]grade${AFTER}` },
  { id: "LIVE", re: String.raw`${BEFORE}LIVE${AFTER}`, caseSensitive: true },
  { id: "real-time", re: String.raw`${BEFORE}real[-\s]?time${AFTER}` },
  { id: "trusted by", re: String.raw`${BEFORE}trusted\s+by${AFTER}` },
  { id: "industry-leading", re: String.raw`${BEFORE}industry[-\s]leading${AFTER}` },
  { id: "#1", re: String.raw`(?<![&\p{L}\p{N}_-])#1(?![\p{L}\p{N}_])` },
  { id: "best-in-class", re: String.raw`${BEFORE}best[-\s]in[-\s]class${AFTER}` },
  { id: "world-class", re: String.raw`${BEFORE}world[-\s]class${AFTER}` },
  { id: "fully compliant", re: String.raw`${BEFORE}fully\s+compliant${AFTER}` },
  { id: "certified", re: String.raw`${BEFORE}certified${AFTER}` },
  { id: "next-gen", re: String.raw`${BEFORE}next[-\s]gen${AFTER}` },
  { id: "revolutionary", re: String.raw`${BEFORE}revolutionary${AFTER}` },
  { id: "cutting-edge", re: String.raw`${BEFORE}cutting[-\s]edge${AFTER}` },
  { id: "limited slots", re: String.raw`${BEFORE}limited\s+slots${AFTER}` },
  { id: "act now", re: String.raw`${BEFORE}act\s+now${AFTER}` },
].map((b) => ({ ...b, regex: new RegExp(b.re, b.caseSensitive ? "gu" : "giu") }));

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
export function findBanned(text) {
  const found = [];
  for (const b of BANNED) {
    for (const m of text.matchAll(b.regex)) {
      const around = text
        .slice(Math.max(0, m.index - 25), m.index + m[0].length + 25)
        .replace(/\s+/g, " ")
        .trim();
      found.push({ id: b.id, around });
    }
  }
  return found;
}

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

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
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
