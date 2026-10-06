// Guard (docs/05-architecture.md §1.1): the public website Worker must never get D1/R2/KV bindings.
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../apps/web/wrangler.jsonc", import.meta.url), "utf8");
const forbidden = ["d1_databases", "r2_buckets", "kv_namespaces", "durable_objects", "hyperdrive"];
const found = forbidden.filter((key) => text.includes(`"${key}"`));
if (found.length > 0) {
  console.error(`apps/web/wrangler.jsonc must not declare: ${found.join(", ")}`);
  process.exit(1);
}
console.log("web binding guard: ok (no data bindings on the public Worker)");
