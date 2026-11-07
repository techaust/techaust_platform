// M7.5 I4: the pure parts of `pnpm drill:verify` (scripts/drill-verify.mjs): an export split with triggers kept whole and loaded schema, data, then
// triggers; the triggers a sequence of statements leaves installed; and the gap-free numbering check. Each with a failing and a passing case.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  DEFER_FKS,
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
    // L53: the export's defer pragma leaves the schema part; the data part (its own file) starts with it
    expect(o.schema.map((x: string) => x.slice(0, 20))).toEqual([
      "CREATE TABLE t (id T",
      "CREATE INDEX t_note ",
    ]);
    expect(o.data).toHaveLength(3);
    expect(o.data[0]).toBe(DEFER_FKS);
    expect(o.triggers).toHaveLength(1);
    expect(loadOrder("CREATE TABLE t (id TEXT);").data).toEqual([]);
  });

  it("L53: a child row written before its parent loads (the foreign keys are checked at the end of the data file)", () => {
    const SCHEMA_FK = [
      "PRAGMA defer_foreign_keys=TRUE;",
      "CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id));",
      "INSERT INTO child VALUES ('c1', 'p1');",
      "CREATE TABLE parent (id TEXT PRIMARY KEY);",
      "INSERT INTO parent VALUES ('p1');",
    ].join("\n");
    const o = loadOrder(SCHEMA_FK);
    // Each part runs as one file in one transaction, as the D1 import does, with foreign keys on (as D1 has them).
    const load = (db: InstanceType<typeof DatabaseSync>, statements: string[]) => {
      db.exec("BEGIN");
      try {
        db.exec(statements.join("\n"));
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    };
    const fresh = () => {
      const db = new DatabaseSync(":memory:");
      db.exec("PRAGMA foreign_keys=ON;");
      load(db, o.schema);
      return db;
    };
    const db = fresh();
    load(db, o.data);
    expect(db.prepare("SELECT count(*) AS n FROM child").get()).toEqual({ n: 1 });
    // without the pragma at the head of the data part the same rows are refused
    expect(() => load(fresh(), o.data.slice(1))).toThrow(/FOREIGN KEY/);
    // and a child whose parent never comes is still refused at the end
    expect(() => load(fresh(), [DEFER_FKS, "INSERT INTO child VALUES ('c2', 'nope');"])).toThrow(
      /FOREIGN KEY/,
    );
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
