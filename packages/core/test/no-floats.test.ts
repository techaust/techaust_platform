// "No floats in money paths" [ADM-G-07]. Biome has no rule for this, so this test scans the money modules
// for float-producing operations. New money code (tax engine, schedules, ledger) is added to MONEY_FILES.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MONEY_FILES = ["src/money.ts", "src/words.ts"];
const BANNED: [RegExp, string][] = [
  [/\bparseFloat\b/, "parseFloat"],
  [/\.toFixed\(|\.toPrecision\(/, "toFixed/toPrecision"],
  [
    /\bMath\.(round|floor|ceil|fround)\b/,
    "Math rounding (use bigint divRoundHalfUp or Math.trunc on integers)",
  ],
  [/(?<![\w.])\d+\.\d+(?![\w.])/, "decimal literal"],
  [/\bNumber\.EPSILON\b/, "EPSILON comparisons"],
];

// Comments and string literals may mention these freely.
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');

describe("money paths use integers only", () => {
  it.each(MONEY_FILES)("%s", (file) => {
    const src = code(readFileSync(join(import.meta.dirname, "..", file), "utf8"));
    const found = BANNED.filter(([re]) => re.test(src)).map(([, what]) => what);
    expect(found).toEqual([]);
  });

  it("the scanner catches what it should", () => {
    const hits = (s: string) => BANNED.filter(([re]) => re.test(code(s))).length;
    expect(hits("const x = amount * 0.18;")).toBe(1);
    expect(hits("Math.round(a / 100)")).toBe(1);
    expect(hits("n.toFixed(2)")).toBe(1);
    expect(hits('// 0.5 paise rounds up\nconst s = "1.5";')).toBe(0);
  });
});
