// Writes the generated token outputs. Run: pnpm --filter @techaust/ui build:tokens
// test/generated.test.ts fails if these files drift from tokens/tokens.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatedFiles } from "../src/tokens/outputs.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const [file, content] of Object.entries(generatedFiles())) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote ${file}`);
}
