// A tax-only debit note ("Tax charged too low", Q35, owner 2026-10-28) is reported in GSTR-1 like any debit note: a CDNR row for a registered client and a CDNUR
// row for an unregistered one, with a taxable value of zero and the tax added; it nets into B2CS and the HSN summary like a debit note (Researched 2026-10-28, 08-C RA-22).
import { describe, expect, it } from "vitest";
import { gstr1Sections, type RegisterRate } from "../../src/gst/index.ts";
import { type ComputedDocument, taxOnlyDebitNote } from "../../src/tax/index.ts";
import { DEFAULTS, good, inrDoc, line, REG_WB } from "../tax/fixtures.ts";
import { d, PARAMS, parentOf, Q3, row, toApi } from "./fixtures.ts";

const ratesOf = (doc: ComputedDocument): RegisterRate[] =>
  doc.summary.map((s) => ({
    sac: s.sac,
    rateBp: s.effectiveRateBp,
    taxableMinor: s.taxableMinor,
    igstMinor: s.igstMinor,
    cgstMinor: s.cgstMinor,
    sgstMinor: s.sgstMinor,
  }));

const parent = row({
  id: "inv-t",
  number: "TH/INV/2627/0001",
  date: d(2026, 10, 5),
  rates: [
    {
      sac: "998314",
      rateBp: 1800,
      taxableMinor: 1_000_000,
      igstMinor: 0,
      cgstMinor: 90_000,
      sgstMinor: 90_000,
    },
  ],
});
const doc = good(taxOnlyDebitNote(good(inrDoc(REG_WB, [line(1_000_000)])), 18_000, DEFAULTS));

describe("a tax-only debit note in GSTR-1", () => {
  it("a registered client: a CDNR row of type D with taxable zero and the tax added, and no errors (CDNUR is for notes on inter-state B2CL and exports only, as for any note)", () => {
    const note = row({
      id: "dn-t",
      kind: "debit_note",
      number: "TH/DN/2627/0001",
      date: d(2026, 11, 12),
      rates: ratesOf(doc),
      noteOf: parentOf(parent),
    });
    const r = gstr1Sections([toApi(parent, 1), toApi(note, 1)], Q3, PARAMS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.cdnr).toHaveLength(1);
    expect(r.value.cdnr[0]).toMatchObject({
      noteType: "D",
      number: "TH/DN/2627/0001",
      taxableMinor: 0,
      cgstMinor: 9_000,
      sgstMinor: 9_000,
      igstMinor: 0,
      valueInrMinor: 18_000,
      rateBp: 1800,
    });
    // the HSN summary adds the tax with no taxable value: 1,000,000 + 0 taxable, 99,000 + ... tax heads
    const hsn = r.value.hsnB2b.find((h) => h.sac === "998314");
    expect(hsn).toMatchObject({ taxableMinor: 1_000_000, cgstMinor: 99_000, sgstMinor: 99_000 });
    expect(r.value.totals.overall.valueMinor).toBe(1_000_000 + 180_000 + 18_000);
  });

  it("an unregistered client in the supplier state: no CDNUR row (as for any debit note there), the tax is netted into B2CS and the HSN summary for consumers", () => {
    const person = {
      status: "unregistered" as const,
      gstin: null,
    };
    const inv = row({
      ...{ id: "inv-u", number: "TH/INV/2627/0002", date: d(2026, 10, 6) },
      ...person,
      rates: parent.rates,
    });
    const note = row({
      id: "dn-u",
      kind: "debit_note",
      number: "TH/DN/2627/0002",
      date: d(2026, 11, 13),
      ...person,
      rates: ratesOf(doc),
      noteOf: parentOf(inv),
    });
    const r = gstr1Sections([toApi(inv, 2), toApi(note, 2)], Q3, PARAMS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.cdnur).toHaveLength(0);
    expect(r.value.b2cs[0]).toMatchObject({ taxableMinor: 1_000_000, cgstMinor: 99_000, sgstMinor: 99_000 });
    expect(r.value.hsnB2c[0]).toMatchObject({
      taxableMinor: 1_000_000,
      cgstMinor: 99_000,
      sgstMinor: 99_000,
    });
  });
});
