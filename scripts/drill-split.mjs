// Restore drill and real restore (docs/runbooks/restore.md §3.4 step 4, §3.5): writes a decrypted D1 export as three files in load order,
// `part-1-schema.sql`, `part-2-data.sql`, `part-3-triggers.sql`, for `wrangler d1 execute <db> --remote --file` one after another.
// Why (first production drill, 2026-11-07): D1's export puts `CREATE VIEW issue_guard` at the very end, after the trigger `issue_guard_check`
// that is created ON that view, so a straight `--file` load of the export stops with "no such table: main.issue_guard". The order is
// drill-verify's own `loadOrder` (schema and views, then data with deferred foreign keys, then triggers; transactions dropped).
// Usage: node scripts/drill-split.mjs <export.sql> <output folder>. Prints only the statement counts (no data).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadOrder } from "./drill-verify.mjs";

const [src, outDir] = process.argv.slice(2);
if (!src || !outDir) {
  console.error("usage: node scripts/drill-split.mjs <export.sql> <output folder>");
  process.exit(2);
}
const { schema, data, triggers } = loadOrder(readFileSync(src, "utf8"));
mkdirSync(outDir, { recursive: true });
const write = (name, parts) =>
  writeFileSync(
    join(outDir, `part-${name}.sql`),
    `${parts.map((s) => (s.trim().endsWith(";") ? s : `${s};`)).join("\n")}\n`,
    { flag: "wx" },
  );
write("1-schema", schema);
write("2-data", data);
write("3-triggers", triggers);
console.log(
  `drill-split: schema ${schema.length}, data ${data.length}, triggers ${triggers.length} statements`,
);
