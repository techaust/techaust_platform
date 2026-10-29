// FX-4 review L3: same-day documents are listed in issue order, by the integer at the end of the number ("/10" after "/9"), never by the text of the
// whole, in every GST list that sorts by number: the GSTR-1 sections and their blocking warnings, the sales register, the EDF list and the realisation
// list. The order stays total (text, then id), so a run never depends on the order the register came in.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  edfRows,
  gstPeriod,
  gstr1Sections,
  type RegisterRow,
  realisationRows,
  salesRegisterRows,
} from "../../src/gst/index.ts";
import { compareDocNumbers } from "../../src/numbering.ts";
import { d, PARAMS, parentOf, Q3, rate, row, toApi } from "./fixtures.ts";

const sorted = (xs: readonly string[]) => [...xs].sort(compareDocNumbers);

describe("compareDocNumbers", () => {
  it("orders by series, then by the integer at the end", () => {
    expect(sorted(["TH/CN/2627/10", "TH/CN/2627/9", "TH/CN/2627/100", "TH/CN/2627/0011"])).toEqual([
      "TH/CN/2627/9",
      "TH/CN/2627/10",
      "TH/CN/2627/0011",
      "TH/CN/2627/100",
    ]);
    // the series first: another FY or series never mixes in by its integer
    expect(sorted(["TH/CN/2728/1", "TH/CN/2627/12", "TH/DN/2627/2"])).toEqual([
      "TH/CN/2627/12",
      "TH/CN/2728/1",
      "TH/DN/2627/2",
    ]);
    // no digits at the end: after the series' numbered ones; equal integers fall back to the text, so the order is total
    expect(sorted(["A", "A2", "A1"])).toEqual(["A1", "A2", "A"]);
    expect(sorted(["X/9", "X/09", "X/009"])).toEqual(["X/009", "X/09", "X/9"]);
    // more digits than a JS number holds exactly, compared without converting
    expect(compareDocNumbers("S/9007199254740993", "S/9007199254740992")).toBe(1);
    expect(compareDocNumbers("S/1", "S/1")).toBe(0);
  });

  it("is a total order consistent with the integers (property)", () => {
    const num = fc.oneof(
      fc.integer({ min: 0, max: 99_999 }).map(String),
      fc.stringMatching(/^[A-Z/]{0,4}[0-9]{0,6}$/),
    );
    fc.assert(
      fc.property(num, num, num, (a, b, c) => {
        expect(compareDocNumbers(a, b)).toBe(-compareDocNumbers(b, a) || 0);
        expect(compareDocNumbers(a, b) === 0).toBe(a === b);
        if (compareDocNumbers(a, b) <= 0 && compareDocNumbers(b, c) <= 0)
          expect(compareDocNumbers(a, c)).toBeLessThanOrEqual(0);
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 1_000_000 }), (x, y) => {
        expect(compareDocNumbers(`TH/INV/2627/${x}`, `TH/INV/2627/${y}`)).toBe(Math.sign(x - y));
      }),
    );
  });
});

// Ten same-day credit notes on one invoice, numbered /1 to /10, and an ordinary invoice: shuffled in, sorted out.
const parent = row({ id: "inv-o", number: "TH/INV/2627/1", date: d(2026, 11, 2) });
const notes = Array.from({ length: 10 }, (_, i) =>
  row({
    id: `cn-${String.fromCharCode(106 - i)}`, // ids run against the numbers, so the id never decides
    kind: "credit_note",
    number: `TH/CN/2627/${i + 1}`,
    date: d(2026, 11, 20),
    rates: [rate("998314", 1800, 1_000, "intra")],
    noteOf: parentOf(parent),
  }),
);
const shuffled = [9, 1, 0, 8, 2, 7, 3, 6, 4, 5].map((i) => notes[i] as RegisterRow);
const NUMBERS = notes.map((n) => n.number);

describe("same-day notes in issue order in every GST list [FX-4 review L3]", () => {
  it("GSTR-1 cdnr rows: /9 before /10", () => {
    const register = [parent, ...shuffled].map((r, i) => toApi(r, i + 1));
    const r = gstr1Sections(register, Q3, PARAMS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.cdnr.map((n) => n.number)).toEqual(NUMBERS);
  });

  it("the blocking warnings of same-day tax-only notes come in the same order", () => {
    const taxOnly = Array.from({ length: 10 }, (_, i) =>
      row({
        id: `dn-${String.fromCharCode(106 - i)}`,
        kind: "debit_note",
        number: `TH/DN/2627/${i + 1}`,
        date: d(2026, 11, 21),
        rates: [{ sac: "998314", rateBp: 1800, taxableMinor: 0, igstMinor: 0, cgstMinor: 50, sgstMinor: 50 }],
        noteOf: parentOf(parent),
      }),
    );
    const register = [parent, ...[...taxOnly].reverse()].map((r, i) => toApi(r, i + 1));
    const r = gstr1Sections(register, Q3, PARAMS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.warnings.filter((w) => w.blocking).map((w) => w.manual?.number)).toEqual(
      taxOnly.map((n) => n.number),
    );
  });

  it("the sales register: /9 before /10", () => {
    const range = gstPeriod(Q3);
    if (!range.ok) throw new Error("period");
    const register = [parent, ...shuffled].map((r, i) => toApi(r, i + 1));
    const r = salesRegisterRows(register, range.value, PARAMS.supplierStateCode);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.filter((x) => x.number.startsWith("TH/CN/")).map((x) => x.number)).toEqual(NUMBERS);
  });

  const exports = Array.from({ length: 10 }, (_, i) =>
    row({
      id: `e-${String.fromCharCode(106 - i)}`,
      kind: "export_invoice",
      supply: "export_lut",
      number: `TH/EXP/2627/${i + 1}`,
      date: d(2026, 11, 3),
      name: "Client",
      address: "1 Example Road",
      country: "US",
      usd: { totalMinor: 100_000, fxMicros: 83_500_000 },
      purposeCode: "P0802",
      rates: [rate("998314", 1800, 8_350_000, "export_lut")],
    }),
  );
  const EXPORT_NUMBERS = exports.map((e) => e.number);

  it("the EDF list: /9 before /10", () => {
    const r = edfRows([...exports].reverse(), 2026, 11);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.map((x) => x.number)).toEqual(EXPORT_NUMBERS);
  });

  it("the realisation list: /9 before /10", () => {
    const r = realisationRows([...exports].reverse(), d(2027, 1, 10));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.map((x) => x.number)).toEqual(EXPORT_NUMBERS);
  });

  it("a tie on date and number falls back to the id, whatever order the register came in (the order is total)", () => {
    // these two lists check no duplicate numbers (the register's own checks do), so a tie can reach the sort
    const twin = (id: string): RegisterRow => ({ ...(exports[0] as RegisterRow), id });
    const pair = [twin("e-z"), twin("e-a")];
    const edf = edfRows(pair, 2026, 11);
    const real = realisationRows(pair, d(2027, 1, 10));
    if (!edf.ok || !real.ok) throw new Error("rows");
    expect(edf.value.map((x) => x.id)).toEqual(["e-a", "e-z"]);
    expect(real.value.map((x) => x.id)).toEqual(["e-a", "e-z"]);
  });
});
