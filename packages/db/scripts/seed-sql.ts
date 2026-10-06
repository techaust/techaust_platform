// Prints the seed as SQL (stdout or a file) for `wrangler d1 execute --file`. Used by the staging deploy.
import { writeFileSync } from "node:fs";
import { seedSql } from "../src/seed/index.ts";

const out = process.argv[2];
if (out) writeFileSync(out, seedSql());
else process.stdout.write(seedSql());
