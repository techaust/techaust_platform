// "No floats in money paths" [ADM-G-07]. Biome has no rule for this, so this test scans the money modules
// for float-producing operations. New money code (tax engine, schedules, ledger) is added to MONEY_FILES;
// a second test fails if a source file talks about money and is in neither list.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const MONEY_FILES = [
  "src/money.ts",
  "src/words.ts",
  "src/numbering.ts",
  "src/schemas/settings.ts",
  "src/schemas/domain.ts",
];
/** Files that mention money words but only pass amounts around or validate other things. Say why. */
const NOT_MONEY_PATHS: Record<string, string> = {};

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

// One pass, in source order, so a quote inside a comment or a "/" inside a string can't confuse the next match:
// comments, "double", 'single' and `template` strings, and regular-expression literals all become "".
const NOISE = new RegExp(
  [
    String.raw`\/\*[\s\S]*?\*\/`,
    String.raw`\/\/[^\n]*`,
    String.raw`"(?:[^"\\\n]|\\.)*"`,
    String.raw`'(?:[^'\\\n]|\\.)*'`,
    "`(?:[^`\\\\]|\\\\.)*`",
    // a regex literal starts where a value can start: after ( , = : [ ! & | ? { } ; or return
    String.raw`(?<=[(,=:[!&|?{};]\s*|\breturn\s+)\/(?![/*])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuvy]*`,
  ].join("|"),
  "g",
);
const code = (src: string) => src.replace(NOISE, '""');

// Division. Allowed: bigint maths (a literal like 100n, BigInt(…), divRoundHalfUp) and the integer idiom
// Math.trunc(x / y) on plain operands (no multiplication before the division, so no loss of precision).
const BIGINT_LINE = /\b\d+n\b|\bBigInt\(|\bdivRoundHalfUp\(/;
const TRUNC_DIVISION = /Math\.trunc\(\s*[\w.]+\s*\/\s*[\w.]+\s*\)/g;
const plainDivisions = (src: string): string[] =>
  code(src)
    .split("\n")
    .map((line) => line.replace(TRUNC_DIVISION, ""))
    .filter((line) => line.includes("/") && !BIGINT_LINE.test(line))
    .map((line) => line.trim());

const floatOps = (src: string) => BANNED.filter(([re]) => re.test(code(src))).map(([, what]) => what);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );

describe("money paths use integers only", () => {
  it.each(MONEY_FILES)("%s", (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(floatOps(src)).toEqual([]);
    expect(plainDivisions(src)).toEqual([]);
  });

  it("every source file that handles money is on the list (or says why not)", () => {
    const moneyish = /\b(Money|minor|Minor|paise|cents|amountMinor|rateBp)\b/;
    const unlisted = sourceFiles(join(ROOT, "src"))
      .map((f) => relative(ROOT, f).replaceAll("\\", "/"))
      .filter((f) => !MONEY_FILES.includes(f) && !(f in NOT_MONEY_PATHS))
      .filter((f) => moneyish.test(code(readFileSync(join(ROOT, f), "utf8"))));
    expect(unlisted, "add these to MONEY_FILES (or NOT_MONEY_PATHS with a reason)").toEqual([]);
  });

  it("the scanner catches what it should", () => {
    const hits = (s: string) => floatOps(s).length;
    expect(hits("const x = amount * 0.18;")).toBe(1);
    expect(hits("Math.round(a / 100)")).toBe(1);
    expect(hits("n.toFixed(2)")).toBe(1);
    expect(hits('// 0.5 paise rounds up\nconst s = "1.5";')).toBe(0);
    expect(hits("const s = 'a \"quoted\" 1.5';")).toBe(0);
  });

  it("flags a plain division and allows the integer forms", () => {
    expect(plainDivisions("const tax = a * b / 100;")).toHaveLength(1);
    expect(plainDivisions("const tax = Math.trunc(a * b / 100);")).toHaveLength(1);
    expect(plainDivisions("const half = total / 2;")).toHaveLength(1);
    expect(plainDivisions("const q = (n * 2n + d) / (d * 2n);")).toEqual([]);
    expect(plainDivisions("const q = (abs * BigInt(w)) / totalWeight;")).toEqual([]);
    expect(plainDivisions("const t = Math.trunc(n / 10);")).toEqual([]);
    expect(plainDivisions("const r = divRoundHalfUp(x, y) / z;")).toEqual([]);
  });

  it("does not mistake comments, strings, regexes or single-quoted text for a division", () => {
    expect(
      plainDivisions(
        [
          "// a / b in a comment",
          "/* c / d */",
          'const s = "e / f";',
          'const t = \'Use "/" and "-"\';',
          "const re = /^[A-Z0-9/-]*$/;",
          "const u = x.replace(/[/-]/g, '$&');",
          "const v = `g / h`;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
