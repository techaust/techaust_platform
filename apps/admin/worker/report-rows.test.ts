// The row mapper of the report routes [ADM-REP-04; M5.5b, LD72; L2, L3 of the early check]: the rates are sorted here (not by the SQL's own order), text that is not a
// JSON array gives no rates (core refuses a row without rates, nothing is invented), and the recipient name is the frozen snapshot's.
import { describe, expect, it } from "vitest";
import { registerRowOf } from "./report-rows.ts";

type SqlRow = Parameters<typeof registerRowOf>[0];

const base = (over: Partial<SqlRow> = {}): SqlRow => ({
  id: "d1",
  type: "tax_invoice",
  series: "TI",
  fy: "2026-27",
  seq: 1,
  number_display: "TI/2026-27/0001",
  issue_date: "2026-11-03",
  currency: "INR",
  total_minor: 118_00,
  total_inr_minor: 118_00,
  round_off_inr_minor: 0,
  fx_rate_micros: null,
  supply_type: "intra",
  place_of_supply_code: "19",
  balance_minor: 118_00,
  voided_at: null,
  client_id: "c1",
  client_code: "ACME",
  r_name: "Acme Private Limited",
  r_status: "registered",
  r_gstin: null,
  r_state: "19",
  r_country: "IN",
  r_address: null,
  note_of: null,
  purpose_code: null,
  ims_status: null,
  rates: "[]",
  extended_to: null,
  ...over,
});

const rate = (sac: string | null, rateBp: number) => ({
  sac,
  rateBp,
  taxableMinor: 100_00,
  igstMinor: 0,
  cgstMinor: 9_00,
  sgstMinor: 9_00,
});

describe("registerRowOf: the rates (L2)", () => {
  it("are sorted by SAC (none first, code-unit order) and then rate, whatever order the SQL gave", () => {
    const given = [
      rate("998314", 1800),
      rate(null, 1800),
      rate("998313", 1800),
      rate("998314", 500),
      rate("998313", 0),
    ];
    const row = registerRowOf(base({ rates: JSON.stringify(given) }));
    expect(row.rates.map((r) => [r.sac, r.rateBp])).toEqual([
      [null, 1800],
      ["998313", 0],
      ["998313", 1800],
      ["998314", 500],
      ["998314", 1800],
    ]);
  });

  it("an empty array, null, a non-array or broken JSON give no rates (core then says rates_empty)", () => {
    for (const rates of ["[]", null, '{"a":1}', "not json", '"x"']) {
      expect(registerRowOf(base({ rates })).rates, String(rates)).toEqual([]);
    }
  });

  it("does not reorder the caller's data in place", () => {
    const text = JSON.stringify([rate("998314", 1800), rate("998313", 1800)]);
    const a = registerRowOf(base({ rates: text })).rates;
    const b = registerRowOf(base({ rates: text })).rates;
    expect(a).toEqual(b);
  });
});

describe("registerRowOf: the recipient (L3)", () => {
  it("is the frozen snapshot, field by field", () => {
    const row = registerRowOf(
      base({ r_address: JSON.stringify({ line1: "1 Main Road", city: "Balurghat", postalCode: "733101" }) }),
    );
    expect(row.recipient).toEqual({
      status: "registered",
      gstin: null,
      name: "Acme Private Limited",
      address: "1 Main Road, Balurghat, 733101",
      stateCode: "19",
      countryCode: "IN",
    });
  });

  it("a status the snapshot never had is passed on as it is (core: supply_mismatch), not read as unregistered", () => {
    const row = registerRowOf(base({ r_status: null }));
    expect(row.recipient.status).toBeNull();
  });
});

describe("registerRowOf: the IMS answer (rt1 T3)", () => {
  it("is the stored ims_status as it is, null when none", () => {
    expect(registerRowOf(base()).imsStatus).toBeNull();
    expect(registerRowOf(base({ type: "credit_note", ims_status: "pending" })).imsStatus).toBe("pending");
    expect(registerRowOf(base({ type: "credit_note", ims_status: "accepted" })).imsStatus).toBe("accepted");
  });
});
