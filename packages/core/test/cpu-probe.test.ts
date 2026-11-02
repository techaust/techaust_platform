// The local first-request probe's stand-ins (scripts/cpu-probe-runtime.mjs; CPU warm-up task (b)4): the D1 over node:sqlite must answer as D1 does where the
// Workers read it (first/all/run/raw, a batch is one transaction, `meta.changes` of the main statement only, booleans bound as 1/0, undefined refused), and it
// must keep the time spent inside SQLite apart (the probe subtracts it). The probe itself is advisory and never part of CI's pass/fail.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { d1Over, dbClock, r2In } from "../../../scripts/cpu-probe-runtime.mjs";

const dir = mkdtempSync(join(tmpdir(), "cpu-probe-test-"));
const db = d1Over(join(dir, "t.db"));
afterAll(() => {
  db.sqlite.close(); // Windows keeps an open database file locked
  rmSync(dir, { recursive: true, force: true });
});

describe("the probe's D1 stand-in", () => {
  db.sqlite.exec(`
    CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, flag INTEGER, data BLOB);
    CREATE TABLE log (n INTEGER);
    CREATE TRIGGER t_log AFTER INSERT ON t BEGIN INSERT INTO log VALUES (NEW.id); INSERT INTO log VALUES (NEW.id); END;
  `);

  it("first, all, raw and run read like D1; a trigger's rows are not counted in meta.changes", async () => {
    const ins = await db
      .prepare("INSERT INTO t (id, name, flag, data) VALUES (?1, ?2, ?3, ?4)")
      .bind(1, "a", true, new Uint8Array([7, 8]))
      .run();
    expect(ins.meta.changes).toBe(1);
    expect(await db.prepare("SELECT name FROM t WHERE id = ?1").bind(1).first("name")).toBe("a");
    expect(await db.prepare("SELECT * FROM t WHERE id = ?1").bind(2).first()).toBeNull();
    const all = await db.prepare("SELECT id, flag, data FROM t").all();
    expect(all.results).toEqual([{ id: 1, flag: 1, data: [7, 8] }]);
    expect(Object.getPrototypeOf(all.results[0])).toBe(Object.prototype);
    expect(await db.prepare("SELECT id, name FROM t").raw({ columnNames: true })).toEqual([
      ["id", "name"],
      [1, "a"],
    ]);
    const ret = await db.prepare("UPDATE t SET name = 'b' WHERE id = 1 RETURNING id").all();
    expect(ret.results).toEqual([{ id: 1 }]);
    expect(ret.meta.changes).toBe(1);
    const none = await db.prepare("SELECT 1 AS one").all();
    expect(none.meta.changes).toBe(0);
  });

  it("a batch is one transaction: a failing statement rolls every one back, and the error reads like D1's", async () => {
    await expect(
      db.batch([
        db.prepare("INSERT INTO t (id, name) VALUES (5, 'x')"),
        db.prepare("INSERT INTO t (id, name) VALUES (6, NULL)"),
      ]),
    ).rejects.toThrow(/^D1_ERROR: .*NOT NULL/);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM t WHERE id = 5").first("n")).toBe(0);
    const ok = await db.batch([
      db.prepare("INSERT INTO t (id, name) VALUES (5, 'x')"),
      db.prepare("SELECT COUNT(*) AS n FROM t"),
    ]);
    expect(ok[1]?.results).toEqual([{ n: 2 }]);
  });

  it("refuses undefined like D1 and keeps the SQLite time and statement count", async () => {
    expect(() => db.prepare("SELECT ?1").bind(undefined)).toThrow(/D1_TYPE_ERROR/);
    dbClock.ms = 0;
    dbClock.statements = 0;
    await db.prepare("SELECT 1").all();
    await db.batch([db.prepare("SELECT 1"), db.prepare("SELECT 2")]);
    expect(dbClock.statements).toBe(3);
    expect(dbClock.ms).toBeGreaterThan(0);
  });
});

describe("the probe's R2 stand-in", () => {
  it("stores, reads back, refuses a second write with onlyIf, deletes", async () => {
    const r2 = r2In(join(dir, "r2"));
    expect(await r2.put("k/1", "hello")).toMatchObject({ key: "k/1", size: 5 });
    expect(await (await r2.get("k/1"))?.text()).toBe("hello");
    expect(await r2.put("k/1", "again", { onlyIf: { etagDoesNotMatch: "*" } })).toBeNull();
    await r2.delete("k/1");
    expect(await r2.head("k/1")).toBeNull();
  });
});
