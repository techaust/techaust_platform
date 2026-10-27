// The GST and report core is SPA only (M5.5b, LD16, LD72): no Worker or package source may import its VALUES (`import type` is allowed: it is erased). The bundle
// marker in `scripts/worker-budget.mjs` is the second net; this test is the first, and says which file broke the rule.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");

/** Every `.ts` and `.tsx` source file under `dir`, skipping node_modules, generated output and tests. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".wrangler") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/^test-|-fixtures?\.ts$/.test(name))
      out.push(path);
  }
  return out;
}

const GST = /["'][^"']*(?:@techaust\/core\/gst|\/gst\/[^"']*|\/gst)["']/;
/** A static import or re-export of the gst core that is not `import type`, or a dynamic `import()` of it. */
function valueImportsOfGst(src: string): string[] {
  const found: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(?!type\b)([^;]*?)\bfrom\s*(["'][^"']+["'])/gm)) {
    if (GST.test(m[3] as string)) found.push((m[0] as string).trim());
  }
  for (const m of src.matchAll(/\bimport\(\s*(["'][^"']+["'])\s*\)/g)) {
    if (GST.test(m[1] as string)) found.push((m[0] as string).trim());
  }
  return found;
}

describe("the detector", () => {
  it("sees value imports, re-exports and dynamic imports, and lets `import type` through", () => {
    expect(valueImportsOfGst('import { gstr1Sections } from "@techaust/core/gst";')).toHaveLength(1);
    expect(valueImportsOfGst('import * as gst from "@techaust/core/gst"')).toHaveLength(1);
    expect(valueImportsOfGst('export { x } from "../../core/src/gst/index.ts";')).toHaveLength(1);
    expect(valueImportsOfGst('import { x } from "./gst/sections.ts";')).toHaveLength(1);
    expect(valueImportsOfGst('const m = await import("@techaust/core/gst");')).toHaveLength(1);
    expect(valueImportsOfGst('import type { RegisterApiRow } from "@techaust/core/gst";')).toEqual([]);
    expect(valueImportsOfGst('import type {\n  A,\n  B,\n} from "@techaust/core/gst";')).toEqual([]);
    expect(valueImportsOfGst('import { addDays } from "@techaust/core/dates";')).toEqual([]);
    expect(valueImportsOfGst('import { gstin } from "@techaust/core/gstin";')).toEqual([]);
  });
});

describe("no Worker or package source imports the gst core's values", () => {
  const dirs = [
    ...readdirSync(join(ROOT, "apps")).map((app) => join(ROOT, "apps", app, "worker")),
    join(ROOT, "apps", "jobs", "src"),
    join(ROOT, "apps", "web", "src", "worker.ts"),
    ...["db", "email", "pdf", "auth"].map((p) => join(ROOT, "packages", p, "src")),
  ];
  const files = dirs.flatMap((d) => {
    try {
      return statSync(d).isDirectory() ? sources(d) : [d];
    } catch {
      return []; // an app without a worker folder
    }
  });

  it("looks at the Worker sources of the admin API, the portal, the jobs Worker, the web Worker and four packages", () => {
    const rels = files.map((f) => relative(ROOT, f).replaceAll("\\", "/"));
    expect(rels.some((r) => r.startsWith("apps/admin/worker/"))).toBe(true);
    expect(rels.some((r) => r.startsWith("apps/portal/worker/"))).toBe(true);
    expect(rels.some((r) => r.startsWith("apps/jobs/src/"))).toBe(true);
    expect(rels).toContain("apps/web/src/worker.ts");
    for (const p of ["db", "email", "pdf", "auth"]) {
      expect(
        rels.some((r) => r.startsWith(`packages/${p}/src/`)),
        p,
      ).toBe(true);
    }
  });

  it("has no value import of @techaust/core/gst", () => {
    const bad = files.flatMap((f) =>
      valueImportsOfGst(readFileSync(f, "utf8")).map((i) => `${relative(ROOT, f)}: ${i}`),
    );
    expect(bad).toEqual([]);
  });
});
