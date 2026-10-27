// The GST core is a subpath export that the package root does not re-export, its files are scanned for floats, and it is held
// to 100 % coverage [ADM-REP-04]. (These three registrations are the only edits M5.5a makes outside src/gst and test/gst.)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("src/gst is registered", () => {
  it("is exported as @techaust/core/gst", () => {
    const pkg = JSON.parse(read("package.json")) as { exports: Record<string, string> };
    expect(pkg.exports["./gst"]).toBe("./src/gst/index.ts");
  });

  it("every file of src/gst is in the no-floats list", () => {
    const listed = read("test/no-floats.test.ts");
    for (const f of readdirSync(join(ROOT, "src", "gst")).filter((n) => n.endsWith(".ts"))) {
      expect(listed, f).toContain(`"src/gst/${f}"`);
    }
  });

  it("src/gst has the 100 % coverage gate", () => {
    expect(read("vitest.config.ts")).toMatch(/"src\/gst\/\*\*":\s*\{\s*100:\s*true\s*\}/);
  });
});
