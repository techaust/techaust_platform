// The monthly EDF working list [ADM-REP-07; Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 3(2) (08-C RB-03)]: the month and its due date, which documents are listed, and
// the row contents. Error codes are in failures.test.ts.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REALISATION_RULES,
  edfCsv,
  edfMonth,
  edfRows,
  realisationRows,
} from "../../src/gst/index.ts";
import { d, hasBareLineBreak, rate, row } from "./fixtures.ts";

const month = (y: number, m: number) => {
  const r = edfMonth(y, m);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};

describe("edfMonth", () => {
  it("is the month and the last day plus 30 days", () => {
    expect(month(2027, 1)).toEqual({ from: d(2027, 1, 1), to: d(2027, 1, 31), due: d(2027, 3, 2) });
    expect(month(2028, 1).due).toEqual(d(2028, 3, 1)); // leap year: February has 29 days
    expect(month(2027, 2)).toEqual({ from: d(2027, 2, 1), to: d(2027, 2, 28), due: d(2027, 3, 30) });
    expect(month(2028, 2)).toEqual({ from: d(2028, 2, 1), to: d(2028, 2, 29), due: d(2028, 3, 30) });
    expect(month(2027, 3).due).toEqual(d(2027, 4, 30));
    expect(month(2026, 11).due).toEqual(d(2026, 12, 30)); // 30 Nov + 30 days
    expect(month(2026, 12).due).toEqual(d(2027, 1, 30));
  });
});

const exp = (id: string, date: ReturnType<typeof d>, extra: Parameters<typeof row>[0] = { id }) =>
  row({
    kind: "export_invoice",
    supply: "export_lut",
    number: `EXP-${id}`,
    date,
    name: `Client ${id}`,
    address: `${id} Example Road`,
    country: "US",
    usd: { totalMinor: 100_000, fxMicros: 83_500_000 },
    purposeCode: "P0802",
    rates: [rate("998314", 1800, 8_350_000, "export_lut")],
    ...extra,
    id,
  });

describe("edfRows", () => {
  it("lists the non-voided export invoices of the month, oldest first, on any payment rail", () => {
    const register = [
      exp("c", d(2026, 11, 20)),
      exp("a", d(2026, 11, 3)),
      exp("b", d(2026, 11, 3), { id: "b", number: "EXP-0" }),
      exp("v", d(2026, 11, 4), { id: "v", voided: true }),
      exp("early", d(2026, 10, 31)),
      exp("late", d(2026, 12, 1)),
      row({ id: "t", kind: "tax_invoice", date: d(2026, 11, 5) }),
      row({ id: "cn", kind: "credit_note", noteOf: null, date: d(2026, 11, 6), supply: "export_lut" }),
    ];
    const r = edfRows(register, 2026, 11);
    expect(r.ok && r.value.map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("M6.1 (Q60, early check A3): a row's own extendedTo moves its FEMA date", () => {
    const r = edfRows(
      [exp("a", d(2026, 11, 3), { id: "a", override: { extendedTo: d(2028, 1, 31) } })],
      2026,
      11,
    );
    expect(r.ok && r.value[0]?.femaDue).toEqual(d(2028, 1, 31));
  });

  it("the boundary days belong to the month", () => {
    const register = [exp("first", d(2026, 11, 1)), exp("last", d(2026, 11, 30))];
    const r = edfRows(register, 2026, 11);
    expect(r.ok && r.value.map((x) => x.id)).toEqual(["first", "last"]);
  });

  it("a row carries what the bank needs", () => {
    const r = edfRows([exp("a", d(2026, 11, 3))], 2026, 11, {
      sacDescriptions: { "998314": "IT support services" },
    });
    expect(r.ok && r.value[0]).toEqual({
      id: "a",
      number: "EXP-a",
      issueDate: d(2026, 11, 3),
      clientName: "Client a",
      clientAddress: "a Example Road",
      countryCode: "US",
      currency: "USD",
      totalMinor: 100_000,
      fxRateMicros: 83_500_000,
      inrValueMinor: 8_350_000,
      sac: "998314",
      description: "IT support services",
      purposeCode: "P0802",
      femaDue: d(2027, 8, 3),
      edfDue: d(2026, 12, 30),
      // no facts on the row (a register page): the edf-v2 columns are blank, never zero
      realisedMinor: null,
      creditedMinor: null,
      reductionsMinor: null,
      reductionOn: null,
      reductionRef: null,
      proofMissing: null,
    });
  });

  it("an INR export has no exchange rate; several SACs are joined, an unknown description is blank", () => {
    const inr = exp("i", d(2026, 11, 3), {
      id: "i",
      usd: undefined,
      rates: [
        rate("998314", 0, 1000, "export_lut"),
        rate("998313", 0, 1000, "export_lut"),
        rate("998314", 0, 500, "export_lut"),
        rate(null, 0, 1, "export_lut"),
      ],
    });
    const r = edfRows([inr], 2026, 11, { sacDescriptions: { "998314": "Support" } });
    expect(r.ok && r.value[0]).toMatchObject({
      currency: "INR",
      fxRateMicros: null,
      sac: "998313; 998314",
      description: "; Support",
      femaDue: d(2027, 11, 3),
    });
  });

  it("works with other rules and an empty month", () => {
    const rules = { ...DEFAULT_REALISATION_RULES, femaMonthsForeign: 6 };
    const r = edfRows([exp("a", d(2026, 11, 3))], 2026, 11, { rules });
    expect(r.ok && r.value[0]?.femaDue).toEqual(d(2027, 5, 3));
    expect(edfRows([], 2026, 11)).toEqual({ ok: true, value: [], warnings: [] });
  });
});

describe("edfCsv", () => {
  it("writes the v1 list (unchanged): blank where nothing is known, the amount realised always blank, whatever the facts", async () => {
    const rows = edfRows(
      [
        { ...exp("a", d(2026, 11, 3)), realisationFacts: FACTS },
        exp("n", d(2026, 11, 9), {
          id: "n",
          usd: undefined,
          address: null,
          country: null,
          purposeCode: null,
          name: "-Overseas, Co",
        }),
      ],
      2026,
      11,
      {
        sacDescriptions: { "998314": "IT support services" },
      },
    );
    if (!rows.ok) throw new Error("rows");
    const csv = edfCsv(rows.value, "edf-v1");
    if (!csv.ok) throw new Error("csv");
    expect(hasBareLineBreak(csv.value)).toBe(false);
    await expect(csv.value).toMatchFileSnapshot("./__snapshots__/edf-v1-2026-11.csv");
    expect(csv.value.split("\r\n")[0]).toBe(
      "Invoice number,Invoice date,Client name,Client address,Country (ISO code),Currency,Invoice amount,Exchange rate,INR value,SAC,Service description,Purpose code,Amount realised,FEMA realisation due,EDF due",
    );
  });
});

/** B4: an export's facts as the EDF month reads them (`REALISATION_FACT_COLUMNS`); invented values. */
const FACTS = {
  paidMinor: 60_000,
  totalMinor: 100_000,
  creditedMinor: 30_000,
  reductionsMinor: 10_000,
  reductionOn: d(2026, 12, 4),
  reductionRef: "=ADB/RED/1",
  proofMissing: true,
} as const;

describe("edf-v2 [L13, RB-43, RA-38]", () => {
  it("is the current layout: the amount realised is paid_minor, then credit notes, the Reg. 6 reductions and the proof flag; blank without facts", async () => {
    const rows = edfRows(
      [
        { ...exp("a", d(2026, 11, 3)), realisationFacts: FACTS },
        {
          ...exp("b", d(2026, 11, 4)),
          realisationFacts: {
            ...FACTS,
            paidMinor: 100_000,
            creditedMinor: 0,
            reductionsMinor: 0,
            reductionOn: null,
            reductionRef: null,
            proofMissing: false,
          },
        },
        exp("c", d(2026, 11, 5)),
      ],
      2026,
      11,
      { sacDescriptions: { "998314": "IT support services" } },
    );
    if (!rows.ok) throw new Error(JSON.stringify(rows.errors));
    expect(rows.value[0]).toMatchObject({
      realisedMinor: 60_000,
      creditedMinor: 30_000,
      reductionsMinor: 10_000,
      reductionOn: d(2026, 12, 4),
      reductionRef: "=ADB/RED/1",
      proofMissing: true,
    });
    const csv = edfCsv(rows.value);
    if (!csv.ok) throw new Error("csv");
    expect(hasBareLineBreak(csv.value)).toBe(false);
    await expect(csv.value).toMatchFileSnapshot("./__snapshots__/edf-v2-2026-11.csv");
    const lines = csv.value.split("\r\n");
    expect(lines[0]).toBe(
      "Invoice number,Invoice date,Client name,Client address,Country (ISO code),Currency,Invoice amount,Exchange rate,INR value,SAC,Service description,Purpose code,Amount realised,Credit notes,Amount reduced (FEMA Reg. 6),Reduction approved on,Bank's reference,Proof awaited,FEMA realisation due,EDF due",
    );
    // a: 600.00 realised, 300.00 credited, 100.00 reduced on 04-Dec-2026 (the reference defused as text), proof awaited
    expect(lines[1]).toContain(",600.00,300.00,100.00,");
    expect(lines[1]).toContain(",'=ADB/RED/1,Yes,");
    // b: paid in full, nothing else: zeros where the facts say zero, blank day and reference, no flag
    expect(lines[2]).toContain(",1000.00,0.00,0.00,,,,");
    // c: no facts: every v2 column blank
    expect(lines[3]).toContain(",P0802,,,,,,,");
    // v1 still writes its own blank column, whatever the facts
    const v1 = edfCsv(rows.value, "edf-v1");
    expect(v1.ok && v1.value.split("\r\n")[1]).toContain(",P0802,,");
  });

  it("damaged facts fail the list (never a guessed figure)", () => {
    for (const bad of [
      { ...FACTS, paidMinor: -1 },
      { ...FACTS, creditedMinor: 1.5 },
      { ...FACTS, reductionsMinor: Number.NaN },
      { ...FACTS, proofMissing: 1 as unknown as boolean },
    ]) {
      const r = edfRows([{ ...exp("a", d(2026, 11, 3)), realisationFacts: bad }], 2026, 11);
      expect(r).toMatchObject({
        ok: false,
        errors: [{ code: "amount_invalid", path: ["a", "realisationFacts"] }],
      });
    }
    const day = edfRows(
      [{ ...exp("a", d(2026, 11, 3)), realisationFacts: { ...FACTS, reductionOn: d(2026, 2, 30) } }],
      2026,
      11,
    );
    expect(day).toMatchObject({
      ok: false,
      errors: [{ code: "date_invalid", path: ["a", "realisationFacts"] }],
    });
  });
});

describe("realisationRows with the page's facts [run file part 2 item 7]", () => {
  it("settled but short of the total without a reduction: reduction_pending; with the reduction: realised; no facts: the balance alone", () => {
    const settled = { ...exp("s", d(2026, 6, 3)), outstandingMinor: 0 };
    const today = d(2026, 11, 3);
    const short = {
      ...FACTS,
      paidMinor: 70_000,
      creditedMinor: 30_000,
      reductionsMinor: 0,
      proofMissing: false,
    };
    const stage = (row: typeof settled) => {
      const r = realisationRows([row], today);
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      return r.value[0]?.stage;
    };
    expect(stage({ ...settled, realisationFacts: short })).toBe("reduction_pending");
    expect(stage({ ...settled, realisationFacts: { ...short, reductionsMinor: 30_000 } })).toBe("realised");
    expect(stage(settled)).toBe("realised");
    // RA-38: an LUT export with a card or PayPal payment still without its proof is not realised (its GST dates run; before them, ok)
    expect(
      stage({ ...settled, realisationFacts: { ...short, reductionsMinor: 30_000, proofMissing: true } }),
    ).toBe("ok");
  });
});

describe("edfRows warnings", () => {
  it("an invoice from before the FEMA 2026 rules carries the warning, with the invoice's id", () => {
    const r = edfRows(
      [exp("old", d(2026, 9, 15), { id: "old", usd: { totalMinor: 1000, fxMicros: 83_000_000 } })],
      2026,
      9,
    );
    expect(r.ok && r.warnings).toEqual([{ code: "before_fema_2026", path: ["old"] }]);
    expect(r.ok && r.value[0]?.femaDue).toEqual(d(2027, 6, 15));
  });
});
