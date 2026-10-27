// "No floats in money paths" [ADM-G-07]. Biome has no rule for this, so this test scans the money modules
// for float-producing operations. New money code (tax engine, schedules, ledger) is added to MONEY_FILES;
// a second test fails if a source file talks about money and is in neither list.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const MONEY_FILES = [
  // M5.5a GST core
  "src/gst/classify.ts",
  "src/gst/csv.ts",
  "src/gst/docs-issued.ts",
  "src/gst/docs.ts",
  "src/gst/edf.ts",
  "src/gst/format.ts",
  "src/gst/index.ts",
  "src/gst/layouts.ts",
  "src/gst/period.ts",
  "src/gst/rates.ts",
  "src/gst/realisation.ts",
  // M5.5b: the reports and the statement
  "src/gst/registers.ts",
  "src/gst/statement-csv.ts",
  "src/gst/summary.ts",
  "src/statement.ts",
  "src/gst/sections.ts",
  "src/gst/types.ts",
  "src/gst/zip.ts",
  "src/money.ts",
  "src/words.ts",
  "src/numbering.ts",
  "src/schemas/settings.ts",
  "src/schemas/domain.ts",
  "src/schemas/catalogue-snapshot.ts",
  "src/catalogue.ts",
  "src/documents.ts",
  "src/invoices.ts",
  "src/notes.ts",
  "src/export-invoice.ts",
  "src/fx.ts",
  "src/schedule-text.ts",
  "src/projects.ts",
  "src/offers.ts",
  "src/care.ts",
  "src/care-billing.ts",
  "src/reminders.ts",
  "src/time.ts",
  "src/tax/credit.ts",
  "src/tax/document.ts",
  "src/tax/inclusive.ts",
  "src/tax/index.ts",
  "src/tax/lines.ts",
  "src/tax/schedule.ts",
  "src/tax/supply.ts",
  "src/tax/totals.ts",
  "src/tax/types.ts",
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

// A small scanner, in source order, so a quote inside a comment or a "/" inside a string can't confuse the next
// token. Comments, "double" and 'single' strings, the fixed text of `template` strings and regular-expression
// literals all become ""; the `${ expressions }` inside a template literal are kept, as code (nested templates too).
const REGEX_CAN_START = "(,=:[!&|?{};";
function code(src: string): string {
  const n = src.length;
  let out = "";
  let i = 0;
  const braces: number[] = []; // open `${` expressions: the depth of plain { } inside each
  const templateText = () => {
    while (i < n) {
      if (src[i] === "\\") i += 2;
      else if (src[i] === "`") {
        i++;
        return;
      } else if (src[i] === "$" && src[i + 1] === "{") {
        i += 2;
        braces.push(0);
        out += " ( ";
        return;
      } else i++;
    }
  };
  while (i < n) {
    const c = src[i] as string;
    const d = src[i + 1];
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      out += " ";
    } else if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i);
      i = end < 0 ? n : end;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
    } else if (c === "`") {
      i++;
      out += '""';
      templateText();
    } else if (c === "{" && braces.length > 0) {
      braces[braces.length - 1] = (braces[braces.length - 1] ?? 0) + 1;
      out += c;
      i++;
    } else if (c === "}" && braces.length > 0) {
      i++;
      if (braces[braces.length - 1] === 0) {
        braces.pop();
        out += " ) ";
        templateText();
      } else {
        braces[braces.length - 1] = (braces[braces.length - 1] ?? 1) - 1;
        out += c;
      }
    } else if (
      c === "/" &&
      (out.trimEnd() === "" ||
        REGEX_CAN_START.includes(out.trimEnd().slice(-1)) ||
        /\breturn$/.test(out.trimEnd()))
    ) {
      i++;
      let inClass = false;
      while (i < n && src[i] !== "\n" && (inClass || src[i] !== "/")) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        i++;
      }
      i++;
      while (i < n && /[dgimsuvy]/.test(src[i] as string)) i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Division. Allowed: a division with a bigint operand (a literal like 100n, BigInt(…), divRoundHalfUp(…)), and the
// integer idiom Math.trunc(x / y) on plain operands (no multiplication before the division, so no loss of
// precision). A bigint marker elsewhere on the same line does not exempt a division.
const BIGINT_MARK = /\b\d+n\b|\bBigInt\(|\bdivRoundHalfUp\(/;
const TRUNC_DIVISION = /Math\.trunc\(\s*[\w.]+\s*\/\s*[\w.]+\s*\)/g;
const IDENT = /[\w.$]/;
const matchingOpen = (s: string, close: number): number => {
  let depth = 0;
  for (let j = close; j >= 0; j--) {
    if (s[j] === ")") depth++;
    else if (s[j] === "(" && --depth === 0) return j;
  }
  return 0;
};
const matchingClose = (s: string, open: number): number => {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === "(") depth++;
    else if (s[j] === ")" && --depth === 0) return j;
  }
  return s.length - 1;
};
/** The operand text just left of the "/" at `slash`: a (…) group and/or a name, including a function's name. */
const leftOperand = (s: string, slash: number): string => {
  let j = slash - 1;
  while (j >= 0 && /\s/.test(s[j] as string)) j--;
  const end = j + 1;
  while (j >= 0) {
    if (s[j] === ")") j = matchingOpen(s, j) - 1;
    else if (IDENT.test(s[j] as string)) j--;
    else break;
  }
  return s.slice(j + 1, end);
};
const rightOperand = (s: string, slash: number): string => {
  let j = slash + 1;
  while (j < s.length && /\s/.test(s[j] as string)) j++;
  const start = j;
  while (j < s.length) {
    if (s[j] === "(") j = matchingClose(s, j) + 1;
    else if (IDENT.test(s[j] as string)) j++;
    else break;
  }
  return s.slice(start, j);
};
const plainDivisions = (src: string): string[] => {
  const s = code(src).replace(TRUNC_DIVISION, "");
  const found: string[] = [];
  for (let i = s.indexOf("/"); i >= 0; i = s.indexOf("/", i + 1)) {
    if (BIGINT_MARK.test(leftOperand(s, i)) || BIGINT_MARK.test(rightOperand(s, i))) continue;
    const from = s.lastIndexOf("\n", i) + 1;
    const to = s.indexOf("\n", i);
    found.push(s.slice(from, to < 0 ? s.length : to).trim());
  }
  return found;
};

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

  it("scans the expressions inside template literals", () => {
    const t = (s: string) => s.replaceAll("§", "$" + "{"); // § stands for the opening of a template expression
    expect(plainDivisions(t("const s = `total §a * b / 100} paise`;"))).toHaveLength(1);
    expect(plainDivisions(t("const s = `x §`inner §a / 3}`} y`;"))).toHaveLength(1);
    expect(plainDivisions(t("const s = `x §fn({ a: 1 })} / §b}`;"))).toEqual([]);
    expect(plainDivisions(t("const s = `§(n * 2n + d) / (d * 2n)}`;"))).toEqual([]);
    expect(floatOps(t("const s = `v §amount * 0.18}`;"))).toEqual(["decimal literal"]);
    expect(floatOps(t("const s = `0.18 §amount}`;"))).toEqual([]);
  });

  it("a bigint marker elsewhere on the line does not exempt a plain division", () => {
    expect(plainDivisions("const x = a * b / 100 + 5n;")).toHaveLength(1);
    expect(plainDivisions("const x = BigInt(a) + total / 3;")).toHaveLength(1);
    expect(plainDivisions("const x = (a * 7) / 3, y = 5n;")).toHaveLength(1);
    expect(plainDivisions("const x = a / 100n + b / 2;")).toHaveLength(1);
    expect(plainDivisions("const x = a / 100n;")).toEqual([]);
    expect(plainDivisions("const x = BigInt(a) * BigInt(b) / BigInt(c);")).toEqual([]);
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
