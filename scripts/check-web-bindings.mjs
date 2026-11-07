// Guard (docs/05-architecture.md §1.1): the public website Worker must never get D1/R2/KV bindings, nor any other binding that
// reaches data or another service. Since M7.5 (section F, skill-audit follow-up) this is an ALLOW list: a key that is not named
// below fails, so a new binding type (services, browser, ai, vectorize, analytics_engine_datasets, workflows, send_email,
// dispatch_namespaces, …) can't slip through. Bindings allowed: vars, secrets, assets, queues.producers (M2.4), ratelimits and
// observability; every other allowed key is plain Worker configuration, not a binding. Each `env.<name>` block is checked the
// same way (bindings are not inherited by environments).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseJsonc } from "./check-worker-config.mjs";

/** The binding keys the public Worker may declare. */
export const ALLOWED_BINDINGS = ["vars", "secrets", "assets", "queues", "ratelimits", "observability"];

/** Plain configuration keys (not bindings). */
export const PLAIN_KEYS = [
  "$schema",
  "name",
  "main",
  "compatibility_date",
  "compatibility_flags",
  "workers_dev",
  "preview_urls",
  "routes",
  "route",
  "minify",
  "upload_source_maps",
  "keep_vars",
  "limits",
  "placement",
  "build",
  "rules",
  "base_dir",
  "no_bundle",
  "find_additional_modules",
  "tsconfig",
  "define",
  "alias",
];

/** The only `queues` key allowed: the Worker sends, it never consumes. */
export const ALLOWED_QUEUE_KEYS = ["producers"];

/** The binding keys a forbidden list used to name (kept for the messages and the tests). */
export const FORBIDDEN = ["d1_databases", "r2_buckets", "kv_namespaces", "durable_objects", "hyperdrive"];

const allowed = new Set([...ALLOWED_BINDINGS, ...PLAIN_KEYS]);

/** Problems in one config block (the top level or an `env.<name>` block). */
function checkBlock(block, where) {
  const problems = [];
  if (block === null || typeof block !== "object" || Array.isArray(block)) return [`${where}: not an object`];
  for (const key of Object.keys(block)) {
    if (key === "env" && where === "top level") continue;
    if (!allowed.has(key)) {
      problems.push(`${where}: "${key}" is not on the web Worker's allow list`);
      continue;
    }
    if (key === "queues") {
      const queues = block.queues;
      if (queues === null || typeof queues !== "object" || Array.isArray(queues)) {
        problems.push(`${where}: "queues" must be an object`);
        continue;
      }
      for (const q of Object.keys(queues)) {
        if (!ALLOWED_QUEUE_KEYS.includes(q))
          problems.push(`${where}: "queues.${q}" is not allowed (producers only)`);
      }
    }
  }
  return problems;
}

/** Every problem in a parsed wrangler config: keys off the allow list, at the top level and in each environment. */
export function checkWebConfig(config) {
  const problems = checkBlock(config, "top level");
  const envs = config?.env;
  if (envs !== undefined) {
    if (envs === null || typeof envs !== "object" || Array.isArray(envs))
      problems.push(`top level: "env" must be an object`);
    else for (const [name, block] of Object.entries(envs)) problems.push(...checkBlock(block, `env.${name}`));
  }
  return problems;
}

/** The disallowed keys declared in a wrangler.jsonc text (an empty list when the config passes). */
export const findForbidden = (text) => checkWebConfig(parseJsonc(text));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = readFileSync(new URL("../apps/web/wrangler.jsonc", import.meta.url), "utf8");
  const found = findForbidden(text);
  if (found.length > 0) {
    console.error(`apps/web/wrangler.jsonc: ${found.join("; ")}`);
    process.exit(1);
  }
  console.log("web binding guard: ok (allow list; no data or service bindings on the public Worker)");
}
