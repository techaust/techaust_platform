// The monthly EDF working list [ADM-REP-07; Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 3(2) (08-C RB-03)]: the month and its due date, which documents are listed, and
// the row contents. Error codes are in failures.test.ts.
import { describe, expect, it } from "vitest";
import { DEFAULT_REALISATION_RULES, edfCsv, edfMonth, edfRows } from "../../src/gst/index.ts";
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
  it("writes the v1 list: blank where nothing is known, the amount realised always blank until M6.1", async () => {
    const rows = edfRows(
      [
        exp("a", d(2026, 11, 3)),
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
    const csv = edfCsv(rows.value);
    if (!csv.ok) throw new Error("csv");
    expect(hasBareLineBreak(csv.value)).toBe(false);
    await expect(csv.value).toMatchFileSnapshot("./__snapshots__/edf-v1-2026-11.csv");
    expect(csv.value.split("\r\n")[0]).toBe(
      "Invoice number,Invoice date,Client name,Client address,Country (ISO code),Currency,Invoice amount,Exchange rate,INR value,SAC,Service description,Purpose code,Amount realised,FEMA realisation due,EDF due",
    );
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
