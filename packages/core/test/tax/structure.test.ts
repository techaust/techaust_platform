// How the tax engine is built, not what it computes [ADM-INV-05, docs/05 §10]: settings are inputs (no constants), the module is
// pure and deterministic, and it is a subpath export that the package root does not re-export.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as taxIndex from "../../src/tax/index.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const TAX_DIR = join(ROOT, "src", "tax");
const files = readdirSync(TAX_DIR).filter((f) => f.endsWith(".ts"));
const read = (f: string) => readFileSync(join(TAX_DIR, f), "utf8");
/** Module-level `let` or `var`, exported or not. */
const MUTABLE = /^(export\s+)?(let|var)\s/m;

describe("src/tax: settings are inputs, never constants", () => {
  it("has the files the brief names", () => {
    expect(files.sort()).toEqual(
      [
        "credit.ts",
        "document.ts",
        "inclusive.ts",
        "index.ts",
        "lines.ts",
        "schedule.ts",
        "supply.ts",
        "totals.ts",
        "types.ts",
      ].sort(),
    );
  });

  it.each(files)("%s mentions no supplier state, no rate and no SUPPLIER_STATE_CODE", (f) => {
    const src = read(f);
    expect(src).not.toContain("SUPPLIER_STATE_CODE");
    expect(src).not.toMatch(/1800|1_800/);
    expect(src).not.toMatch(/"19"|'19'/);
  });
});

describe("src/tax: pure and deterministic", () => {
  it("the mutable-state check sees exported and plain let and var", () => {
    for (const bad of ["let a = 1;", "var a = 1;", "export let a = 1;", "export var a = 1;"]) {
      expect(bad).toMatch(MUTABLE);
    }
    expect("const a = 1;\n  let inside = 2;").not.toMatch(MUTABLE);
  });

  it.each(files)(
    "%s has no zod value import, no clock, no randomness, no module-level mutable state",
    (f) => {
      const src = read(f);
      expect(src).not.toMatch(/from "zod/);
      expect(src).not.toMatch(/\bDate\.now\b|\bnew Date\(|\bMath\.random\b|\bperformance\.now\b|\bcrypto\./);
      expect(src).not.toMatch(MUTABLE);
      expect(src).not.toMatch(/\bfetch\(|\bprocess\.|\bglobalThis\b/);
    },
  );

  it("imports from other packages' code only the helpers it is meant to reuse", () => {
    const imports = files.flatMap((f) =>
      [...read(f).matchAll(/from "(\.\.\/[^"]+)"/g)].map((m) => m[1] as string),
    );
    const allowed = new Set([
      "../clients.ts",
      "../dates.ts",
      "../gstin.ts",
      "../money.ts",
      "../schedule-text.ts",
      "../schemas/settings.ts",
      "../words.ts",
    ]);
    expect([...new Set(imports)].filter((i) => !allowed.has(i))).toEqual([]);
  });
});

describe("src/tax: a subpath export", () => {
  it("is exported as @techaust/core/tax and not from the package root", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports["./tax"]).toBe("./src/tax/index.ts");
    expect(readFileSync(join(ROOT, "src", "index.ts"), "utf8")).not.toMatch(/from "\.\/tax/);
  });

  it("exposes the public functions", () => {
    for (const name of [
      "computeDocument",
      "determineSupply",
      "computeSchedule",
      "splitInclusive",
      "creditNote",
      "lutsOf",
    ]) {
      expect(typeof (taxIndex as Record<string, unknown>)[name]).toBe("function");
    }
    expect(taxIndex.SUPPLY_TYPES).toEqual(["intra", "inter", "export_lut", "export_igst"]);
  });

  it("every file is scanned by the no-floats test", () => {
    const scanned = readFileSync(join(ROOT, "test", "no-floats.test.ts"), "utf8");
    for (const f of files) expect(scanned).toContain(`"src/tax/${f}"`);
  });
});
