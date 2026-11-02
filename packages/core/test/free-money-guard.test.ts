// M6.5 (L35; Step 0 point 3): a payment's free money is `amount − net − refunds not failed`, written in ONE place, `paymentFreeSql` in
// `packages/db/src/sql-rules.ts`. A reader or trigger that wrote `amount_minor - ${paymentNetSql(...)}` (or compared `amount_minor > ${paymentNetSql(...)}`) by
// hand would forget the refunds and count refunded money as credit. This scans the Worker and database sources (comments and test files left out) and fails on
// such a line anywhere but the helper's own file and the M6.1 trigger set 0060 (applied; its builder is pinned byte for byte, and 0070 replaces those triggers).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const SCANNED = ["apps/admin/worker", "apps/jobs/src", "apps/portal/worker", "packages/db/src"];
/** Hand-written free money, either way round. */
const BANNED =
  /amount_minor\s*[-><]\s*\$\{paymentNetSql\(|\$\{paymentNetSql\([^)]*\)\}\s*(?:>|\+\s*NEW\.amount_minor\s*<=)\s*p\.amount_minor/;
/** The helper itself, and the 0060 builder (`paymentTriggerStatements`), whose output is an applied migration. */
const ALLOWED: Record<string, string> = {
  "packages/db/src/sql-rules.ts": "the helper `paymentFreeSql` itself",
  "packages/db/src/triggers.ts":
    "only inside `paymentTriggerStatements` (0060, applied; 0070's `refundTriggerStatements` recreates those triggers with `paymentFreeSql`)",
};

const relOf = (path: string): string => relative(REPO, path).replaceAll("\\", "/");
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) out.push(...sources(full));
    } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !/^test-/.test(e.name)) out.push(full);
  }
  return out;
}
/** "$" + "{": a template placeholder written as plain text (the lines the scanner looks for). */
const P = "$" + "{";
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

describe("free money is written once (L35)", () => {
  it("no hand-written amount_minor minus paymentNetSql outside the helper and the applied 0060 builder", () => {
    const hits: string[] = [];
    for (const dir of SCANNED)
      for (const file of sources(join(REPO, dir))) {
        const rel = relOf(file);
        const lines = readFileSync(file, "utf8").split("\n");
        let inPaymentTriggers = false;
        lines.forEach((line, i) => {
          if (/function\s+paymentTriggerStatements\(/.test(line)) inPaymentTriggers = true;
          else if (/^export function\s+\w+\(/.test(line)) inPaymentTriggers = false;
          if (isComment(line) || !BANNED.test(line)) return;
          if (rel === "packages/db/src/sql-rules.ts") return;
          if (rel === "packages/db/src/triggers.ts" && inPaymentTriggers) return;
          hits.push(`${rel}:${i + 1}`);
        });
      }
    expect(hits).toEqual([]);
  });

  it("the pattern sees the hand-written forms and not the helper's calls", () => {
    expect(BANNED.test(`sum(p.amount_minor - ${P}paymentNetSql("p.id")})`)).toBe(true);
    expect(BANNED.test(`AND p.amount_minor > ${P}paymentNetSql("p.id")}`)).toBe(true);
    expect(BANNED.test(`${P}paymentNetSql("p.id")} > p.amount_minor`)).toBe(true);
    expect(BANNED.test(`${P}paymentNetSql("p.id")} + NEW.amount_minor <= p.amount_minor`)).toBe(true);
    expect(BANNED.test(`sum(${P}paymentFreeSql("p")})`)).toBe(false);
    expect(BANNED.test(`AND ?6 <= ${P}paymentNetSql("p.id", "d.id")}`)).toBe(false);
    expect(Object.keys(ALLOWED)).toHaveLength(2);
  });
});
