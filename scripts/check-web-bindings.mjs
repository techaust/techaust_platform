// Guard (docs/05-architecture.md §1.1): the public website Worker must never get D1/R2/KV bindings.
// Queues, Rate Limiting and secrets are allowed (M2.4); data stores are not.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const FORBIDDEN = ["d1_databases", "r2_buckets", "kv_namespaces", "durable_objects", "hyperdrive"];

/** The forbidden binding keys declared in a wrangler.jsonc text. */
export const findForbidden = (text) => FORBIDDEN.filter((key) => text.includes(`"${key}"`));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = readFileSync(new URL("../apps/web/wrangler.jsonc", import.meta.url), "utf8");
  const found = findForbidden(text);
  if (found.length > 0) {
    console.error(`apps/web/wrangler.jsonc must not declare: ${found.join(", ")}`);
    process.exit(1);
  }
  console.log("web binding guard: ok (no data bindings on the public Worker)");
}
