// How the GST core is built, not what it computes [ADM-REP-04]: pure and deterministic, no zod, no clock, no randomness, no
// module-level mutable state, no `Intl`, only the imports the brief allows, and a subpath that the package root does not
// re-export (it is for the admin SPA only: never Worker code). Same checks as test/tax/structure.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as gst from "../../src/gst/index.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const GST_DIR = join(ROOT, "src", "gst");
const files = readdirSync(GST_DIR).filter((f) => f.endsWith(".ts"));
const read = (f: string) => readFileSync(join(GST_DIR, f), "utf8");
const MUTABLE = /^(export\s+)?(let|var)\s/m;
const MUTABLE_COLLECTION = /^(export\s+)?const\s+\w+[^=\n]*=\s*new\s+(Map|Set|WeakMap|WeakSet)\b/m;

/** Module-level `const` arrays that can be changed (not `as const`, not typed `readonly`). */
function mutableArrayConsts(src: string): string[] {
  const found: string[] = [];
  for (const m of src.matchAll(/^(?:export\s+)?const\s+(\w+)(\s*:[^=\n]*)?\s*=\s*\[/gm)) {
    if (m[2]?.includes("readonly")) continue;
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < src.length; end++) {
      if (src[end] === "[") depth++;
      else if (src[end] === "]" && --depth === 0) break;
    }
    if (!/^\s*as\s+const\b/.test(src.slice(end + 1))) found.push(m[1] as string);
  }
  return found;
}

describe("src/gst: the files the brief names", () => {
  it("has exactly these files", () => {
    expect([...files].sort()).toEqual(
      [
        "classify.ts",
        "csv.ts",
        "docs-issued.ts",
        "docs.ts",
        "edf.ts",
        "format.ts",
        "index.ts",
        "layouts.ts",
        "period.ts",
        "rates.ts",
        "realisation.ts",
        "registers.ts",
        "sac.ts",
        "sections.ts",
        "statement-csv.ts",
        "summary.ts",
        "types.ts",
        "zip.ts",
      ].sort(),
    );
  });
});

describe("src/gst: pure and deterministic", () => {
  it("the checks see what they should", () => {
    for (const bad of ["let a = 1;", "var a = 1;", "export let a = 1;"]) expect(bad).toMatch(MUTABLE);
    expect("const a = 1;\n  let inside = 2;").not.toMatch(MUTABLE);
    expect("const a = new Map();").toMatch(MUTABLE_COLLECTION);
    expect("function f() {\n  const a = new Map();\n}").not.toMatch(MUTABLE_COLLECTION);
    expect(mutableArrayConsts("const a = [1, 2];")).toEqual(["a"]);
    expect(mutableArrayConsts("const a = [1, [2]] as const;")).toEqual([]);
    expect(mutableArrayConsts("const a: readonly string[] = ['x'];")).toEqual([]);
  });

  it.each(files)("%s has no zod, no clock, no randomness, no Intl, no module-level mutable state", (f) => {
    const src = read(f);
    expect(src).not.toMatch(MUTABLE);
    expect(src).not.toMatch(MUTABLE_COLLECTION);
    expect(mutableArrayConsts(src)).toEqual([]);
    expect(src).not.toMatch(/from "zod/);
    expect(src).not.toMatch(
      /\bDate\.now\b|\bnew Date\(|\bMath\.random\b|\bperformance\.now\b|\bcrypto\.|\bIntl\b|toLocale/,
    );
    expect(src).not.toMatch(/\bfetch\(|\bprocess\.|\bglobalThis\b|\bimport\(/);
  });

  it("imports only what the briefs allow: nothing from documents.ts; invoices.ts and statement.ts for types only", () => {
    const imports = files.flatMap((f) =>
      [...read(f).matchAll(/from "(\.\.\/[^"]+)"/g)].map((m) => m[1] as string),
    );
    const allowed = new Set([
      "../dates.ts",
      "../money.ts",
      "../gstin.ts",
      "../numbering.ts",
      "../tax/types.ts",
      // constants only, no imports of its own (test-hardening item 3: the realisation bounds held once)
      "../realisation-bounds.ts",
      // types only (checked below): the summary and statement shapes
      "../invoices.ts",
      "../statement.ts",
    ]);
    expect([...new Set(imports)].filter((i) => !allowed.has(i))).toEqual([]);
    // money.ts, tax/types.ts, invoices.ts and statement.ts are used for types only (the gst core never runs their code)
    for (const f of files) {
      for (const m of read(f).matchAll(
        /^import\s+(?!type\b)[^;]*from "(\.\.\/(?:money|tax\/types|invoices|statement)\.ts)"/gm,
      )) {
        throw new Error(`${f} imports a value from ${m[1]}: types only`);
      }
    }
  });

  it("states that it is SPA only, and carries its research tag (08-C), in the header of index.ts", () => {
    const head = read("index.ts").split("\n").slice(0, 8).join("\n");
    expect(head).toMatch(/SPA ONLY/);
    expect(head).toMatch(/never import this from Worker code/);
    expect(head).toMatch(/Researched 2026-10-28.*08-C RA-23/);
  });

  it("calling a function twice gives the same answer", () => {
    expect(gst.gstPeriod({ kind: "month", year: 2026, month: 10 })).toEqual(
      gst.gstPeriod({ kind: "month", year: 2026, month: 10 }),
    );
    expect(gst.edfMonth(2026, 1)).toEqual(gst.edfMonth(2026, 1));
  });

  it("exposes the public functions", () => {
    for (const name of [
      "gstr1Sections",
      "classifyInvoice",
      "classifyNote",
      "registerRatesOf",
      "docsRows",
      "gstr1Csv",
      "edfCsv",
      "realisationCsv",
      "realisationRulesOf",
      "realisationDates",
      "realisationStatus",
      "realisationRows",
      "edfMonth",
      "edfRows",
      "gstPeriod",
      "inPeriod",
      "lastDayOfMonth",
      "addMonthsClamped",
      "writeCsv",
      "defuse",
    ]) {
      expect(typeof (gst as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("is not re-exported from the package root", () => {
    expect(readFileSync(join(ROOT, "src", "index.ts"), "utf8")).not.toMatch(/from "\.\/gst\//);
  });
});
