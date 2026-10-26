// Guard: Version/Preview URLs skip Cloudflare Access, so every Worker config must switch them off at the top level
// and in `env.staging` and `env.production` (audit 2026-10-22, M1; docs/runbooks/access-staging.md).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const APPS = ["admin", "portal", "web", "jobs"];

/** wrangler.jsonc to a value: drops comments and trailing commas, leaving string contents alone. */
export function parseJsonc(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new Error("unterminated /* comment");
      i = end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** The scopes of one parsed config that do not set `preview_urls: false`. */
export function missingPreviewOff(config) {
  const scopes = [
    ["(top level)", config],
    ["env.staging", config.env?.staging],
    ["env.production", config.env?.production],
  ];
  return scopes.filter(([, c]) => c?.preview_urls !== false).map(([name]) => name);
}

const SCOPES = (config) => [
  ["(top level)", config],
  ["env.staging", config.env?.staging],
  ["env.production", config.env?.production],
];
const bindingKey = {
  d1_databases: (b) => `${b.binding}:${b.database_name}:${b.database_id}`,
  r2_buckets: (b) => `${b.binding}:${b.bucket_name}`,
};
const queueKeys = (c) => (c?.queues?.producers ?? []).map((b) => `${b.binding}:${b.queue}`).sort();

/**
 * The admin API Worker's config (M5.0, docs/13 2026-10-27; apps/admin/wrangler.api.jsonc) against the front's: no public URL at any
 * level (no workers.dev, no routes, no preview URLs), no assets, no previews block, no secrets, and the same D1, R2 and queue
 * resources as the front in each scope. Empty = passes.
 */
export function apiConfigProblems(api, front) {
  const problems = [];
  if (api.compatibility_date !== front.compatibility_date)
    problems.push("(top level): compatibility_date differs from the front's");
  if (JSON.stringify(api.compatibility_flags ?? []) !== JSON.stringify(front.compatibility_flags ?? []))
    problems.push("(top level): compatibility_flags differ from the front's");
  for (const [scope, c] of SCOPES(api)) {
    if (!c) {
      problems.push(`${scope}: missing`);
      continue;
    }
    if (c.workers_dev !== false) problems.push(`${scope}: workers_dev must be false`);
    if (c.preview_urls !== false) problems.push(`${scope}: preview_urls must be false`);
    for (const key of ["routes", "route", "assets", "previews", "secrets"]) {
      if (c[key] !== undefined) problems.push(`${scope}: ${key} is not allowed on the API Worker`);
    }
    const f = SCOPES(front).find(([n]) => n === scope)?.[1];
    // A name equal to the front's would deploy the API bundle over the front and point the binding at itself.
    if (!c.name || c.name === f?.name) problems.push(`${scope}: name must differ from the front's`);
    for (const [k, v] of Object.entries(c.vars ?? {})) {
      if (f?.vars?.[k] !== v) problems.push(`${scope}: var ${k} differs from the front's`);
    }
    for (const [key, fn] of Object.entries(bindingKey)) {
      const a = (c[key] ?? []).map(fn).sort().join(",");
      const b = (f?.[key] ?? []).map(fn).sort().join(",");
      if (a !== b) problems.push(`${scope}: ${key} differ from the front's`);
    }
    if (queueKeys(c).join(",") !== queueKeys(f).join(","))
      problems.push(`${scope}: queues differ from the front's`);
  }
  return problems;
}

/** The front must bind ADMIN_API in all three scopes, to the API config's Worker name for that scope. */
export function frontServiceProblems(front, api) {
  const problems = [];
  for (const [scope, c] of SCOPES(front)) {
    const want = SCOPES(api).find(([n]) => n === scope)?.[1]?.name;
    const got = (c?.services ?? []).find((x) => x.binding === "ADMIN_API");
    if (!got) problems.push(`${scope}: the ADMIN_API service binding is missing`);
    else if (got.service !== want)
      problems.push(`${scope}: ADMIN_API points at ${got.service}, expected ${want}`);
  }
  return problems;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let failed = false;
  for (const app of APPS) {
    const config = parseJsonc(
      readFileSync(new URL(`../apps/${app}/wrangler.jsonc`, import.meta.url), "utf8"),
    );
    const missing = missingPreviewOff(config);
    if (missing.length > 0) {
      console.error(`apps/${app}/wrangler.jsonc: "preview_urls": false is missing at ${missing.join(", ")}`);
      failed = true;
    }
  }
  const read = (p) => parseJsonc(readFileSync(new URL(`../apps/${p}`, import.meta.url), "utf8"));
  const api = read("admin/wrangler.api.jsonc");
  const missingApi = missingPreviewOff(api);
  if (missingApi.length > 0) {
    console.error(
      `apps/admin/wrangler.api.jsonc: "preview_urls": false is missing at ${missingApi.join(", ")}`,
    );
    failed = true;
  }
  const front = read("admin/wrangler.jsonc");
  for (const p of [...apiConfigProblems(api, front), ...frontServiceProblems(front, api)]) {
    console.error(`apps/admin: ${p}`);
    failed = true;
  }
  if (failed) process.exit(1);
  console.log(
    "worker config guard: ok (preview_urls is false everywhere; the admin API Worker has no public URL)",
  );
}
