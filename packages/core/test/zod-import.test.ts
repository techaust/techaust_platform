// zod is imported as a namespace (`import * as z from "zod"` or `"zod/mini"`), never `import { z }` or a default import:
// those keep the whole zod namespace (every locale, the JSON-schema code) in each Worker bundle that reaches the schemas,
// which tripled the web and jobs bundles and their start-up CPU (CPU tuning, 2026-10-23).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const SCAN = ["packages", "apps"];
const SKIP = new Set(["node_modules", "dist", "test", ".wrangler", "generated"]);
const BAD = /import\s+(?:\{\s*z\s*\}|z)\s+from\s+["']zod(?:\/[\w-]+)?["']/;

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(ts|tsx|mts)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("zod imports", () => {
  it("are namespace imports in every package and app source file", () => {
    const files = SCAN.flatMap((d) => sources(join(REPO, d)));
    expect(files.length).toBeGreaterThan(50);
    const bad = files.filter((f) => BAD.test(readFileSync(f, "utf8"))).map((f) => relative(REPO, f));
    expect(bad).toEqual([]);
  });

  it("the pattern catches the forms it bans", () => {
    expect(BAD.test('import { z } from "zod";')).toBe(true);
    expect(BAD.test("import z from 'zod';")).toBe(true);
    expect(BAD.test('import * as z from "zod";')).toBe(false);
    expect(BAD.test('import * as z from "zod/mini";')).toBe(false);
  });
});
