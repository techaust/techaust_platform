// CI guard (run by `pnpm check`): no class is the subject of a base rule in two stylesheets of the same app.
//
// Why: the admin and portal SPAs load a route's stylesheet when the route's module first loads, and it stays in the page for the rest of
// the session. Two files that both define `.segmented` (say) therefore fight in an order that depends on which screens were visited first:
// the owner saw the Reports copy of the switch drawn over the shared one (run css-collisions, 2026-10-31). One component, one owner file.
//
// A base rule is a selector with no combinator (one compound selector: `.x`, `.x:hover`, `.x[data-on]`, `a.x`, `.x.x--big`, `.x::before`,
// also inside @media or @supports). Its key is the set of classes in it, outside functional pseudo-classes (`:has()`, `:not()`, `:is()`,
// `:where()`), so `.x:has(input:checked)` keys as `x` and `.x.x--big` as `x.x--big`. A rule under a parent (`.dialog .radios`,
// `.report .tnum`, `[data-theme] .x`) is a local adjustment and never counts. Two files of one app with the same key is a clash, unless
// `scripts/css-collisions-allow.json` lists it ({ app, key, files, reason }); an entry that no longer matches a clash fails too.
//
// The scan covers every `.css` under `apps/<app>/src` (Astro's scoped <style> blocks are not stylesheets and are not scanned). A small
// self-test runs first, so a broken detector can't pass silently.
//
// Two limits, on purpose (review of css-collisions, 2026-11-01: stricter versions flag 17 descendant and 5 compound rules that are
// intentional local adjustments):
// 1. A rule in a second file that styles only inside another file's component (`.segmented__opt span`, with no base rule for
//    `.segmented__opt` in that file) is a descendant rule, so it is not caught. Review such rules by hand.
// 2. Keys are exact class sets: `.x.y` and `.x` are different keys, so a compound rule in one file and the plain base rule in another
//    are not reported as a clash.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The CSS with comments removed (strings kept). */
function stripComments(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      i++;
      while (i < css.length && css[i] !== c) i += css[i] === "\\" ? 2 : 1;
      i++;
      out += css.slice(start, i);
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The index just past the block that opens at `open` (a "{"), skipping strings. */
function blockEnd(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < css.length && css[i] !== c) i += css[i] === "\\" ? 2 : 1;
    } else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return css.length;
}

/** Split on commas that are not inside parentheses or brackets. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Every style rule's selector list in the CSS, at any depth of @media/@supports/@layer/@container. */
export function selectorsOf(css) {
  const src = stripComments(css);
  const out = [];
  const walk = (from, to) => {
    let i = from;
    while (i < to) {
      const open = src.indexOf("{", i);
      if (open === -1 || open >= to) return;
      // the prelude starts after the last ";" or "}" before the brace (a statement at-rule like @import ends with ";")
      let start = open;
      while (start > i && src[start - 1] !== ";" && src[start - 1] !== "}") start--;
      const prelude = src.slice(start, open).trim();
      const end = blockEnd(src, open);
      if (prelude.startsWith("@")) {
        if (/^@(media|supports|layer|container|scope|document)\b/.test(prelude)) walk(open + 1, end - 1);
      } else if (prelude) out.push(...splitTopLevel(prelude));
      i = end;
    }
  };
  walk(0, src.length);
  return out;
}

/** Remove the arguments of functional pseudo-classes and attribute selectors, so `.x:has(.y)` and `[class~="y"]` add no class. */
function outerText(selector) {
  let out = "";
  let depth = 0;
  for (const c of selector) {
    if (c === "(" || c === "[") {
      if (depth === 0) out += c;
      depth++;
    } else if (c === ")" || c === "]") {
      depth--;
      if (depth === 0) out += c;
    } else if (depth === 0) out += c;
  }
  return out;
}

/** The key of a base rule (its classes, sorted, joined by "."), or null when the selector is not a base rule. */
export function baseKey(selector) {
  if (selector.includes("&")) return null; // nesting: not used in these apps; never guess its parent
  const outer = outerText(selector).trim();
  if (/[\s>+~]/.test(outer)) return null; // a combinator: a rule under a parent or after a sibling
  const classes = [...outer.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  if (classes.length === 0) return null;
  return [...new Set(classes)].sort().join(".");
}

/** The base-rule keys of one stylesheet. */
export function baseKeysOf(css) {
  const keys = new Set();
  for (const s of selectorsOf(css)) {
    const k = baseKey(s);
    if (k) keys.add(k);
  }
  return keys;
}

/**
 * The clashes among one app's stylesheets: `files` is [{ name, css }]. Returns [{ key, files }] with files sorted, keys sorted.
 */
export function findClashes(files) {
  const owners = new Map();
  for (const f of files)
    for (const k of baseKeysOf(f.css)) {
      const list = owners.get(k) ?? [];
      list.push(f.name);
      owners.set(k, list);
    }
  return [...owners]
    .filter(([, names]) => names.length > 1)
    .map(([key, names]) => ({ key, files: [...names].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The problems for every app: clashes not allowed, and allow-list entries that match nothing (stale). `apps` is { [app]: [{ name, css }] };
 * `allow` is [{ app, key, files, reason }].
 */
export function checkApps(apps, allow = []) {
  const problems = [];
  const used = new Set();
  for (const [app, files] of Object.entries(apps)) {
    for (const c of findClashes(files)) {
      const i = allow.findIndex(
        (a) => a.app === app && a.key === c.key && [...a.files].sort().join("|") === c.files.join("|"),
      );
      if (i !== -1 && allow[i].reason) {
        used.add(i);
        continue;
      }
      problems.push(
        `${app}: .${c.key} is a base rule in ${c.files.join(" and ")}: keep one owner, or give the second component its own name`,
      );
    }
  }
  allow.forEach((a, i) => {
    if (!a.reason) problems.push(`allow-list entry ${app(a)} has no reason`);
    else if (!used.has(i)) problems.push(`allow-list entry ${app(a)} matches no clash: remove it`);
  });
  return problems;
  function app(a) {
    return `${a.app} .${a.key}`;
  }
}

/** The self-test: the detector must catch the switch clash the owner saw, and leave a scoped adjustment alone. */
export function selfTest() {
  const shared =
    ".segmented { display: grid; }\n.segmented__opt:has(input:checked) { background: var(--x); }";
  const reports =
    "/* old copy */\n@media (max-width: 479px) { .segmented { width: 100%; } }\n.segmented__opt span { padding: 0; }";
  const scoped =
    ".dialog .radios { gap: 0; }\n.period-picker .segmented { width: 100%; }\n[data-theme] .segmented__opt { color: red; }";
  const caught = findClashes([
    { name: "shell.css", css: shared },
    { name: "reports.css", css: reports },
  ]);
  const quiet = findClashes([
    { name: "shell.css", css: `${shared}\n.radios { display: grid; }` },
    { name: "reports.css", css: scoped },
  ]);
  const failures = [];
  if (!caught.some((c) => c.key === "segmented"))
    failures.push("self-test: the .segmented clash was not caught");
  if (quiet.length > 0)
    failures.push(`self-test: a scoped rule was reported (${quiet.map((c) => c.key).join(", ")})`);
  if (baseKey(".segmented__opt:has(input:checked)") !== "segmented__opt")
    failures.push("self-test: :has() argument leaked into the key");
  if (baseKey(".a.b--x") !== "a.b--x") failures.push("self-test: a compound modifier is not its own key");
  return failures;
}

function cssFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "generated") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...cssFiles(p));
    else if (e.name.endsWith(".css")) out.push(p);
  }
  return out;
}

/** Every app's stylesheets under `apps/<app>/src`, named relative to the repository. */
export function loadApps(root) {
  const apps = {};
  const appsDir = join(root, "apps");
  for (const e of readdirSync(appsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    let files;
    try {
      files = cssFiles(join(appsDir, e.name, "src"));
    } catch {
      continue;
    }
    apps[e.name] = files.map((f) => ({
      name: relative(root, f).replaceAll("\\", "/"),
      css: readFileSync(f, "utf8"),
    }));
  }
  return apps;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const failures = selfTest();
  const apps = loadApps(root);
  const allow = JSON.parse(readFileSync(new URL("./css-collisions-allow.json", import.meta.url), "utf8"));
  failures.push(...checkApps(apps, allow));
  if (failures.length > 0) {
    for (const f of failures) console.error(`css collisions: ${f}`);
    process.exit(1);
  }
  const count = Object.values(apps).reduce((n, f) => n + f.length, 0);
  console.log(
    `css collisions: ok (${count} stylesheets in ${Object.keys(apps).length} apps, no class has two owners)`,
  );
}
