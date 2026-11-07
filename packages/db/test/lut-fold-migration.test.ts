// P7 LUT fold (run file docs/runs/p7-lut-fold.md; ADM-INV-18, ADM-SET-03): migration 0089's fold of the one letter of M3 (`tax.lut`) into the M5.2 list.
// 0089 ran over an empty `settings` table here, so each test writes a `tax` row and runs the fold's statements (`lutFoldBackfill`) again, then compares the
// stored row with the M5.2 rule written out below: `legacyLutFate` and `foldLegacyLut` exactly as core held them before this task (removed from core with
// the key; kept here as the oracle the SQL must match). Researched 2026-10-28, Rule 96A CGST Rules (08-C RA-19: one LUT per FY). Every ARN is invented.
import { lutFor } from "@techaust/core/invoices";
import { resolveSetting, SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { lutsOf } from "@techaust/core/tax";
import { afterEach, describe, expect, it } from "vitest";
import { LUT_FOR_FY_SQL } from "../src/sql-rules.ts";
import {
  advanceLutFyTrigger,
  debitNoteLutFyTrigger,
  JS_UPPER_TO_ASCII,
  JS_WHITESPACE_CODE_POINTS,
  lutFoldBackfill,
} from "../src/triggers-lut-fold.ts";
import { first, run } from "./helpers.ts";

// ---- the oracle: the M5.2 rule, as core had it (packages/core/src/export-invoice.ts, schemas/settings.ts before P7) ------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const normaliseLutArn = (arn: string): string => arn.replace(/\s+/g, "").toUpperCase();
const lutFyOk = (fy: string): boolean =>
  fy.length === 4 &&
  [...fy].every((ch) => ch >= "0" && ch <= "9") &&
  (Number(fy.slice(0, 2)) + 1) % 100 === Number(fy.slice(2));

/** `legacyLutFate` of M5.2 over a raw stored row: anything but a string ARN and year was read as no letter; a list that is not an array takes nothing. */
function m52Fold(value: Record<string, unknown>): { fy: string; arn: string; filedOn: null } | null {
  const lut = isRecord(value.lut) ? value.lut : {};
  const arn = typeof lut.arn === "string" ? lut.arn : null;
  const fy = typeof lut.fy === "string" ? lut.fy : null;
  if (!arn || !fy) return null; // none
  if (value.luts !== undefined && !Array.isArray(value.luts)) return null; // no reader could parse the row: nothing to append to
  const luts: unknown[] = Array.isArray(value.luts) ? value.luts : [];
  if (luts.some((l) => isRecord(l) && l.fy === fy)) return null; // listed
  const norm = normaliseLutArn(arn);
  if (!lutFyOk(fy) || !/^[A-Z0-9]{1,30}$/.test(norm)) return null; // invalid
  if (luts.length >= 20) return null; // full
  return { fy, arn: norm, filedOn: null }; // folded
}

/** What 0089 must leave: the folded entry appended last, the `lut` key gone, the version one up; a row without the key untouched. */
function expected(value: Record<string, unknown>): { value: Record<string, unknown>; bumped: boolean } {
  if (!Object.hasOwn(value, "lut")) return { value, bumped: false };
  const entry = m52Fold(value);
  const { lut: _lut, ...rest } = value;
  if (!entry) return { value: rest, bumped: true };
  return {
    value: { ...rest, luts: [...((value.luts as unknown[] | undefined) ?? []), entry] },
    bumped: true,
  };
}

// ---- running the fold --------------------------------------------------------------------------------------------------------------------------------

const VERSION = 7;

async function setRaw(text: string) {
  await run("DELETE FROM settings WHERE key = 'tax'");
  await run("INSERT INTO settings (key, value, version) VALUES ('tax', ?1, ?2)", text, VERSION);
}

async function fold() {
  for (const sql of lutFoldBackfill()) await run(sql);
}

async function stored() {
  const r = await first<{ value: string; version: number }>(
    "SELECT value, version FROM settings WHERE key = 'tax'",
  );
  if (!r) throw new Error("no tax row");
  return r;
}

/** Writes `value`, runs the fold, and checks the row against the oracle. */
async function check(value: Record<string, unknown>, what = JSON.stringify(value)) {
  await setRaw(JSON.stringify(value));
  await fold();
  const r = await stored();
  const want = expected(value);
  expect(JSON.parse(r.value), what).toEqual(want.value);
  expect(r.version, what).toBe(want.bumped ? VERSION + 1 : VERSION);
  return JSON.parse(r.value) as Record<string, unknown>;
}

afterEach(async () => {
  await run("DELETE FROM settings WHERE key = 'tax'");
});

const entry = (fy: string, arn: string, filedOn: string | null = null) => ({ fy, arn, filedOn });
const twenty = Array.from({ length: 20 }, (_, i) => entry(`${30 + i}${31 + i}`, `A${i}`));
const base = { ...SETTINGS_DEFAULTS.tax };

describe("0089 folds the old single `lut` of M3 into the list under the M5.2 rule, then drops the key [P7 LUT fold; ADM-INV-18; 08-C RA-19]", () => {
  it("no `lut` key: nothing changes, not even the version", async () => {
    const out = await check({ ...base, luts: [entry("2627", "AD1")] });
    expect(out.luts).toEqual([entry("2627", "AD1")]);
  });

  it("an empty `lut` ({arn: null, fy: null}, what every save since M5.2 and the seed wrote): the key goes, the list is kept", async () => {
    const out = await check({
      ...base,
      luts: [entry("2627", "AD1", "2026-03-20")],
      lut: { arn: null, fy: null },
    });
    expect(Object.hasOwn(out, "lut")).toBe(false);
    expect(out.luts).toEqual([entry("2627", "AD1", "2026-03-20")]);
  });

  it("a `lut` whose FY is already listed: the list entry wins, the old letter is dropped", async () => {
    const out = await check({ ...base, luts: [entry("2728", "NEW1")], lut: { arn: "OLD1", fy: "2728" } });
    expect(out.luts).toEqual([entry("2728", "NEW1")]);
  });

  it("a foldable `lut`: appended last as a list entry, normalised (spaces dropped, upper case), never filed on a day", async () => {
    const out = await check({
      ...base,
      luts: [entry("2627", "AD1")],
      lut: { arn: " ad 19 03 x ", fy: "2728" },
    });
    expect(out.luts).toEqual([entry("2627", "AD1"), entry("2728", "AD1903X")]);
    // a row from before M5.2 has no list at all: the list is made
    const old = await check({ exportMode: "lut", lut: { arn: "AD0000000000001", fy: "2627" } });
    expect(old.luts).toEqual([entry("2627", "AD0000000000001")]);
    // what the admin reads afterwards: that letter, through the list only
    expect(lutFor("2627", lutsOf(resolveSetting("tax", old)))).toEqual({
      fy: "2627",
      arn: "AD0000000000001",
    });
  });

  it("a malformed `lut` (the list would refuse it, or the list is full): the key goes and nothing is appended", async () => {
    for (const lut of [
      { arn: "AD-1903", fy: "2728" }, // a hyphen
      { arn: "A".repeat(31), fy: "2728" }, // 31 characters
      { arn: "\t", fy: "2728" }, // only a tab (SQLite's trim would have kept it)
      { arn: "   ", fy: "2728" },
      { arn: "", fy: "2728" },
      { arn: "AD1", fy: "2729" }, // not two consecutive years
      { arn: "AD1", fy: "27-8" },
      { arn: "AD1", fy: "272" },
      { arn: "AD1", fy: "27281" },
      { arn: "AD\u00001", fy: "2728" }, // a NUL inside (SQLite's length stops there, JavaScript's does not)
      { arn: "AD1", fy: "272\u0000" },
      { arn: "ADé1", fy: "2728" },
      { arn: 1903, fy: "2728" },
      { arn: "AD1", fy: 2728 },
      { arn: "AD1" },
      { fy: "2728" },
    ])
      await check({ ...base, luts: [entry("2627", "AD1")], lut });
    await check({ ...base, luts: twenty, lut: { arn: "OLD1", fy: "2728" } });
    for (const lut of [null, "garbage", 7, [], ["AD1", "2728"]]) await check({ ...base, luts: [], lut });
    // a list that is not an array (no reader could parse the row): the key still goes, nothing is made up
    await check({ ...base, luts: "no", lut: { arn: "AD1", fy: "2728" } });
    await check({ ...base, luts: null, lut: { arn: "AD1", fy: "2728" } });
  });

  it("the JavaScript whitespace and the characters whose upper case is A to Z are normalised exactly as core did", async () => {
    for (const cp of JS_WHITESPACE_CODE_POINTS) {
      const out = await check({
        ...base,
        luts: [],
        lut: { arn: `ad${String.fromCodePoint(cp)}12`, fy: "2728" },
      });
      expect(out.luts, cp.toString(16)).toEqual([entry("2728", "AD12")]);
    }
    for (const [cp, upper] of JS_UPPER_TO_ASCII) {
      const out = await check({
        ...base,
        luts: [],
        lut: { arn: `x${String.fromCodePoint(cp)}1`, fy: "2728" },
      });
      expect(out.luts, cp.toString(16)).toEqual([entry("2728", `X${upper}1`)]);
    }
    // the folded ARN's length is counted after the expansion: 29 + "SS" is 31, refused; 28 + "SS" is 30, folded
    await check({ ...base, luts: [], lut: { arn: `${"A".repeat(29)}ß`, fy: "2728" } });
    const ok = await check({ ...base, luts: [], lut: { arn: `${"A".repeat(28)}ß`, fy: "2728" } });
    expect(ok.luts).toEqual([entry("2728", `${"A".repeat(28)}SS`)]);
  });

  it("the two code-point lists are this runtime's own (no `\\s` and no upper-case mapping is missing)", () => {
    const ws: number[] = [];
    const upper: [number, string][] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      if (/\s/.test(c)) ws.push(cp);
      if (!/^[A-Za-z0-9]$/.test(c) && /^[A-Z0-9]+$/.test(c.toUpperCase())) upper.push([cp, c.toUpperCase()]);
    }
    expect(ws).toEqual([...JS_WHITESPACE_CODE_POINTS]);
    expect(upper).toEqual(JS_UPPER_TO_ASCII.map(([cp, u]) => [cp, u]));
  });

  it("a value that is not JSON is left alone, and no statement fails on it", async () => {
    await setRaw("not json {");
    await fold();
    expect(await stored()).toEqual({ value: "not json {", version: VERSION });
  });

  it("is idempotent: a second run changes nothing", async () => {
    for (const value of [
      { ...base, luts: [], lut: { arn: "ad 1", fy: "2728" } },
      { ...base, luts: [entry("2728", "NEW")], lut: { arn: "OLD", fy: "2728" } },
      { ...base, luts: [], lut: { arn: null, fy: null } },
    ]) {
      await check(value);
      const once = await stored();
      await fold();
      expect(await stored(), JSON.stringify(value)).toEqual(once);
    }
  });

  it("matches the M5.2 rule over 400 generated rows (seeded, so a failure repeats)", async () => {
    let seed = 0x5eed_0089;
    const next = () => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
    const ARN_BITS = [
      "ad",
      "AD",
      "19",
      "0",
      " ",
      "\t",
      "　",
      "-",
      "ß",
      "ﬁ",
      "ı",
      "é",
      "\u0000",
      "Z9",
      "x".repeat(12),
    ];
    const FYS = ["2627", "2728", "2526", "9900", "2729", "27 8", "", "272", "２７２８"];
    let folded = 0;
    for (let i = 0; i < 400; i++) {
      const listFys = Array.from({ length: Math.floor(next() * 4) }, () =>
        pick(["2627", "2728", "2526", "3031"]),
      );
      const luts: unknown[] =
        next() < 0.08
          ? [...twenty]
          : listFys.map((fy, n) => (next() < 0.1 ? pick([null, 3, "s", [fy]]) : entry(fy, `L${n}`)));
      const arn =
        next() < 0.1
          ? pick([null, 5])
          : Array.from({ length: 1 + Math.floor(next() * 4) }, () => pick(ARN_BITS)).join("");
      const lut = next() < 0.05 ? pick([null, "x"]) : { arn, fy: next() < 0.1 ? null : pick(FYS) };
      const value: Record<string, unknown> = { exportMode: "lut", ...(next() < 0.1 ? {} : { luts }), lut };
      await check(value, `#${i} ${JSON.stringify(value)}`);
      if (m52Fold(value) !== null) folded++;
    }
    // both outcomes were met many times
    expect(folded).toBeGreaterThan(40);
    expect(folded).toBeLessThan(360);
  });
});

describe("0089 re-creates both LUT triggers from the list-only rule [P7 LUT fold; 08-C RA-19, Q37, Q39]", () => {
  it("the installed triggers are exactly the generated ones and read no `tax.lut`", async () => {
    for (const [name, sql] of [
      ["documents_advance_lut_fy", advanceLutFyTrigger(LUT_FOR_FY_SQL)],
      ["documents_debit_note_lut_fy", debitNoteLutFyTrigger(LUT_FOR_FY_SQL)],
    ] as const) {
      const t = await first<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
        name,
      );
      expect(t?.sql, name).toBe(sql.replace(/;$/, ""));
      expect(t?.sql, name).not.toContain("$.lut.");
    }
    expect(LUT_FOR_FY_SQL).not.toContain("$.lut.");
  });
});
