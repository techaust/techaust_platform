// The sales register, the output tax and the GSTR-3B summary [ADM-REP-04, ADM-REP-06; M5.5b, LD71, LD83; Researched 2026-10-28, GSTN advisories of June 2025 (08-C RA-23)]: they are built
// from the same register rows as GSTR-1, so their totals are checked against GSTR-1's and against an independent sum over the rows.
import { describe, expect, it } from "vitest";
import {
  type GstPeriod,
  gstPeriod,
  gstr1Sections,
  gstr3bSummary,
  inPeriod,
  OUTPUT_TAX_BUCKETS,
  outputTaxRows,
  type RegisterApiRow,
  salesRegisterRows,
} from "../../src/gst/index.ts";
import { d, GOLDEN_API_REGISTER, PARAMS, Q3, rate, row, toApi } from "./fixtures.ts";

const period: GstPeriod = Q3;
const range = (() => {
  const r = gstPeriod(period);
  if (!r.ok) throw new Error("period");
  return r.value;
})();
const STATE = PARAMS.supplierStateCode;

type Heads = { taxable: number; igst: number; cgst: number; sgst: number };
/** An independent oracle: the signed sums over the golden rows, written without the code under test. */
function oracle(rows: readonly RegisterApiRow[]): Heads {
  const sum: Heads = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
  for (const r of rows) {
    if (r.voided || !inPeriod(r.issueDate, range)) continue;
    const sign = r.kind === "credit_note" ? -1 : 1;
    for (const x of r.rates) {
      sum.taxable += sign * x.taxableMinor;
      sum.igst += sign * x.igstMinor;
      sum.cgst += sign * x.cgstMinor;
      sum.sgst += sign * x.sgstMinor;
    }
  }
  return sum;
}

const sales = () => {
  const r = salesRegisterRows(GOLDEN_API_REGISTER, range, STATE);
  if (!r.ok) throw new Error(`sales register: ${JSON.stringify(r.errors)}`);
  return r.value;
};
const outputTax = () => {
  const r = outputTaxRows(GOLDEN_API_REGISTER, range, STATE);
  if (!r.ok) throw new Error(`output tax: ${JSON.stringify(r.errors)}`);
  return r.value;
};
const sections = () => {
  const r = gstr1Sections(GOLDEN_API_REGISTER, period, PARAMS);
  if (!r.ok) throw new Error(`sections: ${JSON.stringify(r.errors)}`);
  return r.value;
};

describe("the sales register", () => {
  it("signed sums equal an independent sum over the rows, and GSTR-1's overall totals", () => {
    const rows = sales().filter((r) => r.status === "issued");
    const got: Heads = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    for (const r of rows) {
      got.taxable += r.taxableMinor;
      got.igst += r.igstMinor;
      got.cgst += r.cgstMinor;
      got.sgst += r.sgstMinor;
    }
    expect(got).toEqual(oracle(GOLDEN_API_REGISTER));
    const t = sections().totals.overall;
    expect(got).toEqual({ taxable: t.taxableMinor, igst: t.igstMinor, cgst: t.cgstMinor, sgst: t.sgstMinor });
  });

  it("one row per (document, rate): the document's values repeat; credit notes are negative; the order is date, number", () => {
    const rows = sales();
    const inv02 = rows.filter((r) => r.number === "TH/INV/2627/0002");
    expect(inv02.map((r) => [r.sac, r.rateBp])).toEqual([
      ["998313", 500],
      ["998314", 1800],
    ]);
    expect(new Set(inv02.map((r) => r.totalInrMinor)).size).toBe(1);
    const cn = rows.find((r) => r.number === "TH/CN/2627/0001");
    expect(cn?.typeLabel).toBe("Credit note");
    expect(cn?.totalInrMinor).toBeLessThan(0);
    expect(cn?.taxableMinor).toBe(-200_000);
    const dn = rows.find((r) => r.number === "TH/DN/2627/0001");
    expect(dn?.taxableMinor).toBe(1_000_000);
    const dates = rows.map((r) => `${r.date.year}-${r.date.month}-${r.date.day}`);
    expect(dates).toEqual(
      [...rows]
        .sort((a, b) => a.date.month * 100 + a.date.day - (b.date.month * 100 + b.date.day))
        .map((r) => `${r.date.year}-${r.date.month}-${r.date.day}`),
    );
  });

  it("a document's rate rows are ordered by SAC, then rate", () => {
    const r = row({
      id: "m",
      number: "M1",
      rates: [
        rate("998314", 1800, 1000, "intra"),
        rate("998314", 500, 1000, "intra"),
        rate("998313", 1800, 1000, "intra"),
      ],
    });
    const out = salesRegisterRows([toApi(r, 1)], range, STATE);
    expect(out.ok && out.value.map((x) => [x.sac, x.rateBp])).toEqual([
      ["998313", 1800],
      ["998314", 500],
      ["998314", 1800],
    ]);
  });

  it("a voided document is one cancelled row of zeros; the document outside the range is not there", () => {
    const rows = sales();
    const voided = rows.filter((r) => r.status === "cancelled");
    expect(voided).toHaveLength(1);
    expect(voided[0]).toMatchObject({
      number: "TH/INV/2627/0006",
      totalMinor: 0,
      totalInrMinor: 0,
      sac: null,
      rateBp: null,
      taxableMinor: 0,
      igstMinor: 0,
      cgstMinor: 0,
      sgstMinor: 0,
    });
    expect(rows.some((r) => r.number === "TH/INV/2627/0100")).toBe(false);
  });

  it("a USD export keeps its currency, its exchange rate and its amount in USD; a credit note against it is negative in both", () => {
    const rows = sales();
    const exp = rows.find((r) => r.number === "TH/EXP/2627/0001");
    expect(exp).toMatchObject({ currency: "USD", totalMinor: 100_000, fxRateMicros: 83_500_000 });
    const cn = rows.find((r) => r.number === "TH/CN/2627/0003");
    expect(cn).toMatchObject({ currency: "USD", totalMinor: -10_000 });
    expect(Object.is(rows.find((r) => r.status === "cancelled")?.taxableMinor, -0)).toBe(false);
  });

  it("a credit note with zero amounts never writes -0", () => {
    const parent = row({ id: "p", number: "P1", rates: [rate("998314", 0, 1000, "intra")] });
    const cn = row({
      id: "c",
      number: "C1",
      kind: "credit_note",
      rates: [rate("998314", 0, 0, "intra")],
      noteOf: {
        number: "P1",
        issueDate: d(2026, 10, 5),
        supplyType: "intra",
        recipientStatus: "registered",
        placeOfSupplyCode: "19",
        totalInrMinor: 1000,
      },
    });
    const r = salesRegisterRows([toApi(parent, 1), toApi(cn, 1)], range, STATE);
    expect(
      r.ok && r.value.every((x) => !Object.is(x.taxableMinor, -0) && !Object.is(x.totalInrMinor, -0)),
    ).toBe(true);
  });

  it("refuses what GSTR-1 refuses, and a bad range", () => {
    const bad = [...GOLDEN_API_REGISTER, toApi(row({ id: "x", number: "BAD NUMBER" }), 99)];
    expect(salesRegisterRows(bad, range, STATE)).toEqual({
      ok: false,
      errors: [{ code: "number_invalid", path: ["x"] }],
    });
    const dup = [...GOLDEN_API_REGISTER, toApi(row({ id: "inv01", number: "TH/INV/2627/9999" }), 9999)];
    expect(salesRegisterRows(dup, range, STATE)).toEqual({
      ok: false,
      errors: [{ code: "duplicate_row", path: ["inv01"] }],
    });
    for (const r of [
      { from: range.to, to: range.from },
      { from: d(2026, 2, 30), to: range.to },
      { from: range.from, to: d(2026, 13, 1) },
    ]) {
      expect(salesRegisterRows(GOLDEN_API_REGISTER, r, STATE)).toEqual({
        ok: false,
        errors: [{ code: "period_invalid", path: ["period"] }],
      });
    }
    expect(salesRegisterRows(GOLDEN_API_REGISTER, range, 19 as never).ok).toBe(false);
  });

  it("a voided row outside the checks of reported rows does not block, but a bad key still does", () => {
    const voidedBad = toApi(row({ id: "v", number: "V1", voided: true, status: "overseas", gstin: null }), 5);
    expect(salesRegisterRows([voidedBad], range, STATE).ok).toBe(true);
    const wrongKind = toApi(row({ id: "k", override: { kind: "proforma" as never } }), 6);
    expect(salesRegisterRows([wrongKind], range, STATE)).toEqual({
      ok: false,
      errors: [{ code: "kind_not_reportable", path: ["k"] }],
    });
  });

  it("an empty register is an empty report", () => {
    expect(salesRegisterRows([], range, STATE)).toEqual({ ok: true, value: [], warnings: [] });
    expect(outputTaxRows([], range, STATE)).toEqual({ ok: true, value: [], warnings: [] });
  });
});

describe("the output tax", () => {
  it("is by supply bucket and rate, in bucket order then rate, signed", () => {
    const rows = outputTax();
    const order = rows.map((r) => OUTPUT_TAX_BUCKETS.indexOf(r.bucket));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(rows.map((r) => `${r.bucket}:${r.rateBp}`)).toEqual([
      "intra:500",
      "intra:1800",
      "inter:500",
      "inter:1800",
      "zero_rated_wopay:0",
      "zero_rated_wpay:1800",
    ]);
  });

  it("totals equal the independent sum, the sales register's sum and GSTR-1's overall totals", () => {
    const rows = outputTax();
    const got = rows.reduce<Heads>(
      (s, r) => ({
        taxable: s.taxable + r.taxableMinor,
        igst: s.igst + r.igstMinor,
        cgst: s.cgst + r.cgstMinor,
        sgst: s.sgst + r.sgstMinor,
      }),
      { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
    );
    expect(got).toEqual(oracle(GOLDEN_API_REGISTER));
    const t = sections().totals.overall;
    expect(got).toEqual({ taxable: t.taxableMinor, igst: t.igstMinor, cgst: t.cgstMinor, sgst: t.sgstMinor });
  });

  it("a LUT export is zero-rated WOPAY at 0 %, an IGST export WPAY; the voided and the outside-range documents are not counted", () => {
    const rows = outputTax();
    const wopay = rows.find((r) => r.bucket === "zero_rated_wopay");
    // exp01 8,350,000 - cn03 835,000 + exp03 3,000,000
    expect(wopay).toMatchObject({ taxableMinor: 8_350_000 - 835_000 + 3_000_000, igstMinor: 0 });
    const wpay = rows.find((r) => r.bucket === "zero_rated_wpay");
    expect(wpay?.taxableMinor).toBe(4_200_000);
  });

  it("refuses what GSTR-1 refuses", () => {
    const bad = [...GOLDEN_API_REGISTER, toApi(row({ id: "x", number: "x1" }), 99)];
    expect(outputTaxRows(bad, range, STATE).ok).toBe(false);
  });
});

describe("the GSTR-3B summary", () => {
  const summary = () => {
    const r = gstr3bSummary(sections());
    if (!r.ok) throw new Error(`3B: ${JSON.stringify(r.errors)}`);
    return r.value.lines;
  };

  it("3.1(a) and 3.1(b) add up to GSTR-1's overall totals; 3.1(b) is exp and the export notes", () => {
    const lines = summary();
    const a = lines.find((l) => l.table === "3.1(a)");
    const b = lines.find((l) => l.table === "3.1(b)");
    const t = sections().totals;
    expect((a?.taxableMinor ?? 0) + (b?.taxableMinor ?? 0)).toBe(t.overall.taxableMinor);
    expect((a?.igstMinor ?? 0) + (b?.igstMinor ?? 0)).toBe(t.overall.igstMinor);
    expect((a?.cgstMinor ?? 0) + (b?.cgstMinor ?? 0)).toBe(t.overall.cgstMinor);
    expect((a?.sgstMinor ?? 0) + (b?.sgstMinor ?? 0)).toBe(t.overall.sgstMinor);
    expect(b?.taxableMinor).toBe(t.exp.taxableMinor + 0 - 835_000);
    expect(b?.igstMinor).toBe(t.exp.igstMinor);
  });

  it("3.2 is by place of supply: b2cl, its notes and the inter-state b2cs, netted", () => {
    const lines = summary().filter((l) => l.table === "3.2");
    // 29: inv04 (8,474,576, b2cs, inter) + inv05 (8,474,576, b2cl) - cn02 (847,457, B2CL note); 27: cn04 against a b2cs parent (negative)
    const byPos = Object.fromEntries(lines.map((l) => [l.posCode, l]));
    expect(byPos["29"]?.taxableMinor).toBe(8_474_576 + 8_474_576 - 847_457);
    expect(byPos["27"]?.taxableMinor).toBe(-500_000);
    expect(lines.map((l) => l.posCode)).toEqual(["27", "29"]);
    for (const l of lines) {
      expect(l.cgstMinor).toBe(0);
      expect(l.sgstMinor).toBe(0);
    }
  });

  it("fails with totals_mismatch where a figure does not match GSTR-1's totals", () => {
    const s = sections();
    const tampered = {
      ...s,
      totals: { ...s.totals, b2b: { ...s.totals.b2b, taxableMinor: s.totals.b2b.taxableMinor + 1 } },
    };
    const r = gstr3bSummary(tampered);
    expect(r).toEqual({
      ok: false,
      errors: [{ code: "totals_mismatch", path: ["gstr3b", "b2b"] }],
    });
    for (const name of ["b2cl", "b2cs", "exp", "cdnr", "cdnur"] as const) {
      const t = {
        ...s,
        totals: { ...s.totals, [name]: { ...s.totals[name], igstMinor: s.totals[name].igstMinor + 1 } },
      };
      const out = gstr3bSummary(t);
      expect(!out.ok && out.errors.some((e) => e.path[1] === name), name).toBe(true);
    }
    const overall = gstr3bSummary({
      ...s,
      totals: { ...s.totals, overall: { ...s.totals.overall, cgstMinor: s.totals.overall.cgstMinor - 1 } },
    });
    expect(overall).toEqual({
      ok: false,
      errors: [{ code: "totals_mismatch", path: ["gstr3b", "overall"] }],
    });
  });

  it("a debit note against a b2b invoice adds to 3.1(a); a credit note takes away", () => {
    const parent = row({ id: "p", number: "P1", rates: [rate("998314", 1800, 1_000_000, "intra")] });
    const base = {
      noteOf: {
        number: "P1",
        issueDate: d(2026, 10, 5),
        supplyType: "intra" as const,
        recipientStatus: "registered" as const,
        placeOfSupplyCode: "19" as const,
        totalInrMinor: 1_180_000,
      },
      date: d(2026, 10, 20),
    };
    const dn = row({
      id: "d",
      number: "D1",
      kind: "debit_note",
      rates: [rate("998314", 1800, 100_000, "intra")],
      ...base,
    });
    const cn = row({
      id: "c",
      number: "C1",
      kind: "credit_note",
      rates: [rate("998314", 1800, 30_000, "intra")],
      ...base,
    });
    const s = gstr1Sections(
      [parent, dn, cn].map((r, i) => toApi(r, i + 1)),
      period,
      PARAMS,
    );
    if (!s.ok) throw new Error(JSON.stringify(s.errors));
    const r = gstr3bSummary(s.value);
    expect(r.ok && r.value.lines[0]).toMatchObject({
      table: "3.1(a)",
      taxableMinor: 1_000_000 + 100_000 - 30_000,
    });
  });

  it("an export place of supply is never a 3.2 line", () => {
    const s = sections();
    const odd = {
      ...s,
      b2cl: s.b2cl.map((r) => ({ ...r, posCode: "96" as const })),
      b2cs: s.b2cs.map((r) => ({ ...r, posCode: "96" as const })),
      cdnur: s.cdnur.map((r) => ({ ...r, posCode: "96" as const })),
    };
    const r = gstr3bSummary(odd);
    expect(r.ok && r.value.lines.filter((l) => l.table === "3.2")).toEqual([]);
  });

  it("an empty return is zeros", () => {
    const r = gstr1Sections([], period, PARAMS);
    if (!r.ok) throw new Error("sections");
    expect(gstr3bSummary(r.value)).toEqual({
      ok: true,
      value: {
        lines: [
          { table: "3.1(a)", posCode: null, taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0 },
          { table: "3.1(b)", posCode: null, taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0 },
        ],
      },
      warnings: [],
    });
  });

  it("never throws, even for a broken input", () => {
    expect(gstr3bSummary({} as never).ok).toBe(false);
  });
});
