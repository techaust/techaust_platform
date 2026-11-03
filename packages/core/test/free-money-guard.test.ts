// M6.5 (L35; Step 0 point 3): a payment's free money is `amount − net − refunds not failed`, written in ONE place, `paymentFreeSql` in
// `packages/db/src/sql-rules.ts` (core twin `freeOf` in `@techaust/core/ledger`). A reader or trigger that wrote `amount_minor - ${paymentNetSql(...)}` (or
// compared `amount_minor > ${paymentNetSql(...)}`) by hand would forget the refunds and count refunded money as credit. This scans the Worker, SPA and database
// sources (comments and test files left out) and fails on such a line anywhere but the helper's own file and the M6.1 trigger set 0060 (applied; its builder is
// pinned byte for byte, and 0070 replaces those triggers).
// Early check 1, finding 13: the same mistake written another way is caught too: in TypeScript (`r.amount_minor - r.net` with no refunds after it) and as a raw
// net sum in SQL (`sum(CASE … kind WHEN 'allocate' …)` outside the helpers); the places that sum a payment's holding per document (never its free money) are
// allow-listed with their reason and their count, so a new one fails.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const SCANNED = [
  "apps/admin/worker",
  "apps/admin/src",
  "apps/jobs/src",
  "apps/portal/worker",
  "packages/db/src",
];
/** Hand-written free money, either way round. */
const BANNED =
  /amount_minor\s*[-><]\s*\$\{paymentNetSql\(|\$\{paymentNetSql\([^)]*\)\}\s*(?:>|\+\s*NEW\.amount_minor\s*<=)\s*p\.amount_minor/;
/** Free money in TypeScript: an amount less a net with no refunds taken off after it. */
const BANNED_TS = /amount_?[mM]inor\s*-\s*\w+\.net\b(?!\s*-\s*\w+\.refunded)/;
/** A raw net sum of allocations in SQL. */
const RAW_NET = /sum\(CASE\s+(?:\w+\.)?kind\s+WHEN\s+'allocate'/;
/** The helper itself, and the 0060 builder (`paymentTriggerStatements`), whose output is an applied migration. */
const ALLOWED: Record<string, string> = {
  "packages/db/src/sql-rules.ts": "the helper `paymentFreeSql` itself",
  "packages/db/src/triggers.ts":
    "only inside `paymentTriggerStatements` (0060, applied; 0070's `refundTriggerStatements` recreates those triggers with `paymentFreeSql`)",
};
/** Raw net sums that are not free money, by file: how many and why. */
const RAW_NET_ALLOWED: Record<string, { count: number; reason: string }> = {
  "packages/db/src/sql-rules.ts": {
    count: 3,
    reason:
      "the helpers `livePaidSql`, `paymentNetSql` and `paymentNetAtSql` (its as-of twin for RA-41's credit held at a period's end) themselves",
  },
  "packages/db/src/ledger.ts": {
    count: 1,
    reason:
      "the ledger panel of a document: what each payment holds on that document (`held`), never its free money",
  },
  "packages/db/src/receipts.ts": {
    count: 1,
    reason: "the receipt's 'Applied to' lines: what the payment holds on each document",
  },
  "packages/db/src/reports.ts": {
    count: 1,
    reason:
      "`ALLOCATED_BY_CURRENCY` in the client's figures, taken off together with `REFUNDED_BY_CURRENCY` (credit = collected − allocated − live refunds)",
  },
};

const relOf = (path: string): string => relative(REPO, path).replaceAll("\\", "/");
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".") && e.name !== "warm-fixtures")
        out.push(...sources(full));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/^test-/.test(e.name))
      out.push(full);
  }
  return out;
}
/** "$" + "{": a template placeholder written as plain text (the lines the scanner looks for). */
const P = "$" + "{";
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

function scan(): { hits: string[]; raw: Map<string, number> } {
  const hits: string[] = [];
  const raw = new Map<string, number>();
  for (const dir of SCANNED)
    for (const file of sources(join(REPO, dir))) {
      const rel = relOf(file);
      const lines = readFileSync(file, "utf8").split("\n");
      let inPaymentTriggers = false;
      lines.forEach((line, i) => {
        if (/function\s+paymentTriggerStatements\(/.test(line)) inPaymentTriggers = true;
        else if (/^export function\s+\w+\(/.test(line)) inPaymentTriggers = false;
        if (isComment(line)) return;
        if (RAW_NET.test(line)) raw.set(rel, (raw.get(rel) ?? 0) + 1);
        if (!BANNED.test(line) && !BANNED_TS.test(line)) return;
        if (rel === "packages/db/src/sql-rules.ts") return;
        if (rel === "packages/db/src/triggers.ts" && inPaymentTriggers) return;
        hits.push(`${rel}:${i + 1}`);
      });
    }
  return { hits, raw };
}

describe("free money is written once (L35)", () => {
  const { hits, raw } = scan();

  it("no hand-written amount_minor minus paymentNetSql, or amount minus net in TypeScript, outside the helper and the applied 0060 builder", () => {
    expect(hits).toEqual([]);
  });

  it("raw net sums only where they are a holding per document, never free money (finding 13)", () => {
    const found = Object.fromEntries([...raw].sort(([a], [b]) => (a < b ? -1 : 1)));
    const allowed = Object.fromEntries(Object.entries(RAW_NET_ALLOWED).map(([f, v]) => [f, v.count]));
    expect(found).toEqual(allowed);
    for (const v of Object.values(RAW_NET_ALLOWED)) expect(v.reason.length).toBeGreaterThan(20);
  });

  it("the patterns see the hand-written forms and not the helper's calls", () => {
    expect(BANNED.test(`sum(p.amount_minor - ${P}paymentNetSql("p.id")})`)).toBe(true);
    expect(BANNED.test(`AND p.amount_minor > ${P}paymentNetSql("p.id")}`)).toBe(true);
    expect(BANNED.test(`${P}paymentNetSql("p.id")} > p.amount_minor`)).toBe(true);
    expect(BANNED.test(`${P}paymentNetSql("p.id")} + NEW.amount_minor <= p.amount_minor`)).toBe(true);
    expect(BANNED.test(`sum(${P}paymentFreeSql("p")})`)).toBe(false);
    expect(BANNED.test(`AND ?6 <= ${P}paymentNetSql("p.id", "d.id")}`)).toBe(false);
    expect(BANNED_TS.test("availableMinor: r.amount_minor - r.net }")).toBe(true);
    expect(BANNED_TS.test("const left = p.amountMinor - x.net;")).toBe(true);
    expect(BANNED_TS.test("WHERE s.amount_minor - s.net - s.refunded > 0")).toBe(false);
    expect(RAW_NET.test("SELECT coalesce(sum(CASE kind WHEN 'allocate' THEN amount_minor")).toBe(true);
    expect(RAW_NET.test("sum(CASE a.kind WHEN 'allocate' THEN a.amount_minor")).toBe(true);
    expect(RAW_NET.test("CASE NEW.kind WHEN 'allocate' THEN")).toBe(false);
    expect(Object.keys(ALLOWED)).toHaveLength(2);
  });
});
