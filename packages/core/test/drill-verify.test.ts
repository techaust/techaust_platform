// M7.5 I4: the pure parts of `pnpm drill:verify` (scripts/drill-verify.mjs): an export split with triggers kept whole and loaded schema, data, then
// triggers; the triggers a sequence of statements leaves installed; and the gap-free numbering check. Each with a failing and a passing case.
import { describe, expect, it } from "vitest";
import {
  installedTriggers,
  loadOrder,
  migrationFiles,
  numberingProblems,
  splitStatements,
} from "../../../scripts/drill-verify.mjs";

const EXPORT = [
  "PRAGMA defer_foreign_keys=TRUE;",
  "CREATE TABLE t (id TEXT PRIMARY KEY, note TEXT);",
  // A trigger written BEFORE the rows it would refuse (the risk the drill proves): its body holds `;` and a string with `;` and `END`.
  "CREATE TRIGGER t_no_insert BEFORE INSERT ON t WHEN NEW.note = 'x' BEGIN SELECT RAISE(ABORT, 'no; END here'); END;",
  "INSERT INTO t VALUES ('a', 'it''s; fine');",
  "INSERT INTO t VALUES ('b', 'x');",
  "CREATE INDEX t_note ON t (note);",
].join("\n");

describe("splitStatements and loadOrder", () => {
  it("keeps a trigger whole and splits on `;` only outside quotes", () => {
    const s = splitStatements(EXPORT);
    expect(s).toHaveLength(6);
    expect(s[2]).toMatch(/^CREATE TRIGGER t_no_insert .* END;$/);
    expect(s[3]).toBe("INSERT INTO t VALUES ('a', 'it''s; fine');");
  });

  it("loads schema, then data, then triggers, whatever order the export wrote", () => {
    const o = loadOrder(`BEGIN TRANSACTION;\n${EXPORT}\nCOMMIT;`);
    expect(o.schema.map((x: string) => x.slice(0, 20))).toEqual([
      "PRAGMA defer_foreign",
      "CREATE TABLE t (id T",
      "CREATE INDEX t_note ",
    ]);
    expect(o.data).toHaveLength(2);
    expect(o.triggers).toHaveLength(1);
  });
});

describe("installedTriggers", () => {
  it("adds on CREATE and removes on DROP, in order", () => {
    expect(
      [
        ...installedTriggers([
          "CREATE TRIGGER `a` AFTER INSERT ON t BEGIN SELECT 1; END",
          'CREATE TRIGGER IF NOT EXISTS "b" AFTER INSERT ON t BEGIN SELECT 1; END',
          "DROP TRIGGER IF EXISTS a",
          "CREATE TRIGGER c AFTER INSERT ON t BEGIN SELECT 1; END",
          "DROP TRIGGER c; CREATE TRIGGER c AFTER UPDATE ON t BEGIN SELECT 1; END",
        ]),
      ].sort(),
    ).toEqual(["b", "c"]);
  });
});

describe("numberingProblems", () => {
  const counter = (series: string, fy: string, next: number) => ({ series, fy, next_no: next });
  const nums = (series: string, fy: string, max: number, distinct: number, min = 1) => ({
    series,
    fy,
    max_no: max,
    distinct_no: distinct,
    min_no: min,
  });

  it("passes 1..next_no-1 with no gap, and an unused counter", () => {
    expect(
      numberingProblems([counter("inv", "2627", 4), counter("crn", "2627", 1)], [nums("inv", "2627", 3, 3)]),
    ).toEqual([]);
  });

  it("fails a gap, a number above the counter, a counter ahead of the documents, and numbers with no counter", () => {
    expect(numberingProblems([counter("inv", "2627", 4)], [nums("inv", "2627", 3, 2)])).toEqual([
      "inv/2627: 2 numbers for 1..3 (a gap)",
    ]);
    expect(numberingProblems([counter("inv", "2627", 3)], [nums("inv", "2627", 3, 3)])).toEqual([
      "inv/2627: the last number is 3, the counter says 2",
    ]);
    expect(numberingProblems([counter("inv", "2627", 5)], [])).toEqual([
      "inv/2627: the last number is 0, the counter says 4",
    ]);
    expect(numberingProblems([], [nums("deed", "2627", 1, 1)])).toEqual([
      "deed/2627: numbered documents with no counter row",
    ]);
    expect(numberingProblems([counter("inv", "2627", 3)], [nums("inv", "2627", 2, 2, 0)])).toEqual([
      "inv/2627: 2 numbers for 1..2 (a gap)",
    ]);
  });
});

describe("migration files", () => {
  it("lists the NNNN_name.sql files of packages/db/migrations", () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(70);
    expect(files.every((f: string) => /^\d{4}_.+\.sql$/.test(f))).toBe(true);
  });
});
