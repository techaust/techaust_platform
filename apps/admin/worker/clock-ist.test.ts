// Tests take "today" as the server does: the IST day (audit A0, findings 1 and 7). Two helpers once took the UTC date, so six tests failed
// every night from 00:00 to 05:29 IST; three files read the clock once at module load. This file guards the sources against both and runs
// the helpers that failed at 01:00 IST [ADM-INV-11, ADM-INV-17].
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { one, pinClock } from "./test-helpers.ts";
import { currentFy, lutOf, putSwiftBank, putTax, todayIso } from "./test-invoice-types.ts";
import { farSession, mkOverseasClient, putBank, putCompany } from "./test-invoices.ts";
import { mkIssuedInvoice } from "./test-notes.ts";

const SELF = "./clock-ist.test.ts";
const sources = {
  ...(import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >),
  ...(import.meta.glob("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >),
};
const isTestFile = (f: string) =>
  f.endsWith(".test.ts") || f.endsWith(".test.tsx") || /\/test-[^/]+\.ts$/.test(f);

/** `new Date()` or `new Date(Date.now() ± …)` cut to its UTC day, without the IST offset: the UTC date of now. */
const UTC_DAY_OF_NOW = /new Date\((?:\s*Date\.now\(\)[^()]*)?\)\s*\.toISOString\(\)\s*\.slice\(0,\s*10\)/g;
/** A top-level constant whose value (not a function) reads the clock: taken once at module load. */
const CLOCK_AT_LOAD =
  /^(?:export )?(?:const|let|var) [\w$]+(?::[^=\n]+)? = (?!\(|async\b|function\b)[^\n]*(?:Date\.now\(\)|new Date\()/gm;

const utcDayHits = (text: string) =>
  [...text.matchAll(UTC_DAY_OF_NOW)].map((m) => m[0]).filter((hit) => !hit.includes("19_800_000"));
const loadClockHits = (text: string) => [...text.matchAll(CLOCK_AT_LOAD)].map((m) => m[0]);

describe("the sources take today as the IST day, read when used", () => {
  it("the rules catch what they are for, and pass the IST forms", () => {
    expect(utcDayHits("date: new Date().toISOString().slice(0, 10),")).toHaveLength(1);
    expect(utcDayHits("const d = new Date(Date.now()).toISOString().slice(0, 10);")).toHaveLength(1);
    expect(utcDayHits("x(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))")).toHaveLength(1);
    expect(utcDayHits("new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)")).toHaveLength(0);
    expect(
      utcDayHits('new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10)'),
    ).toHaveLength(0); // date arithmetic on an IST day
    expect(loadClockHits("const FY = fyOf(Date.now()).token;")).toHaveLength(1);
    expect(loadClockHits("export const today = new Date().toISOString();")).toHaveLength(1);
    expect(loadClockHits("const fy = () => fyOf(Date.now()).token;")).toHaveLength(0);
    expect(loadClockHits('const PIN = Date.parse("2026-10-15T12:00:00+05:30");')).toHaveLength(0);
    expect(loadClockHits("  const today = issueDateOf(Date.now());")).toHaveLength(0); // inside a test
  });

  it("no test, helper or SPA source takes the UTC date of now for today (use todayIso())", () => {
    const files = Object.keys(sources).filter((f) => f !== SELF);
    expect(files.length).toBeGreaterThan(100);
    const found = files.flatMap((f) => utcDayHits(sources[f] ?? "").map((hit) => `${f}: ${hit}`));
    expect(found).toEqual([]);
  });

  it("no test or helper reads the clock at module load (read it in the test, or pin it with pinClock())", () => {
    const found = Object.keys(sources)
      .filter((f) => f !== SELF && isTestFile(f))
      .flatMap((f) => loadClockHits(sources[f] ?? "").map((hit) => `${f}: ${hit}`));
    expect(found).toEqual([]);
  });
});

describe("the helpers that failed, at 01:00 IST (19:30 UTC the day before)", () => {
  beforeEach(async () => {
    await putCompany();
    await putBank();
    await putSwiftBank();
  });
  afterEach(() => vi.useRealTimers());

  it("todayIso() is the IST day and an export invoice made by mkIssuedInvoice takes its rate for that day and issues", async () => {
    const o = await farSession("owner");
    pinClock(Date.parse("2026-11-18T01:00:00.000+05:30"));
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-11-17"); // the UTC date the helpers once used
    expect(todayIso()).toBe("2026-11-18");
    await putTax({ luts: [lutOf(currentFy())] });
    const inv = await mkIssuedInvoice(o, { prices: [100_000], client: mkOverseasClient });
    expect(
      await one<{ issue_date: string; fx_date: string }>(
        "SELECT issue_date, fx_date FROM documents WHERE id = ?",
        inv.id,
      ),
    ).toEqual({ issue_date: "2026-11-18", fx_date: "2026-11-18" });
  });
});
