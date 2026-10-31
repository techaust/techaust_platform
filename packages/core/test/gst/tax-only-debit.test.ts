// A tax-only debit note ("Tax charged too low", Q35, owner 2026-10-28) is reported in GSTR-1 like any debit note: a CDNR row for a registered client and a CDNUR
// row for an unregistered one, with a taxable value of zero and the tax added; it nets into B2CS and the HSN summary like a debit note (Researched 2026-10-28, 08-C RA-22).
import { describe, expect, it } from "vitest";
import { gstr1Sections, type RegisterRate } from "../../src/gst/index.ts";
import { type ComputedDocument, taxOnlyDebitNote } from "../../src/tax/index.ts";
import { DEFAULTS, good, inrDoc, line, REG_MH, REG_WB } from "../tax/fixtures.ts";
import { d, GSTIN_19, GSTIN_27, PARAMS, parentOf, Q3, rate, row, toApi } from "./fixtures.ts";

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
    // FX-4 (A5 1): the cdnr file has no tax column, so the note's tax is named for entry by hand (Settled by the lead on the safest reading, 2026-10-30 (08-C RA-32): entered by hand in the GST portal's Table 9B)
    expect(r.warnings.filter((w) => w.code === "tax_only_note_manual")).toHaveLength(1);
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

// FX-4 (full audit A5 1; Settled by the lead on the safest reading, 2026-10-30 (08-C RA-32)): the files carry a taxable value and a rate, no tax column, so a tax-only note's tax would import as nil. `gstr1Sections`
// returns one BLOCKING warning per such note, naming the note, the recipient's GSTIN and each tax head with its amount, worked out here BY HAND.
describe("a tax-only note is a blocking warning with what to enter by hand", () => {
  // An inter-state invoice to a registered client in Maharashtra: 18 % of 500,000 = 90,000 IGST.
  const interParent = row({
    id: "inv-m",
    number: "TH/INV/2627/0003",
    date: d(2026, 10, 7),
    supply: "inter",
    pos: "27",
    gstin: GSTIN_27,
    rates: [rate("998314", 1800, 500_000, "inter")],
  });
  // Rs 180.00 of CGST and SGST together, by hand: 18,000 / 2 = 9,000 each.
  const intraNote = row({
    id: "dn-a",
    kind: "debit_note",
    number: "TH/DN/2627/0003",
    date: d(2026, 11, 2),
    rates: ratesOf(doc),
    noteOf: parentOf(parent),
  });
  // Rs 10.01 of IGST (the A5 11 example): taxable 0, IGST 1,001, no round-off.
  const interDoc = good(taxOnlyDebitNote(good(inrDoc(REG_MH, [line(500_000)])), 1_001, DEFAULTS));
  const interNote = row({
    id: "dn-b",
    kind: "debit_note",
    number: "TH/DN/2627/0004",
    date: d(2026, 11, 3),
    supply: "inter",
    pos: "27",
    gstin: GSTIN_27,
    rates: ratesOf(interDoc),
    roundOff: interDoc.roundOffMinor,
    noteOf: parentOf(interParent),
  });
  // An ordinary debit note (a price correction): 18 % of 100,000. It carries its taxable value, so the files are enough: no warning.
  const ordinary = row({
    id: "dn-c",
    kind: "debit_note",
    number: "TH/DN/2627/0005",
    date: d(2026, 11, 4),
    rates: [rate("998314", 1800, 100_000, "intra")],
    noteOf: parentOf(parent),
  });
  const register = [parent, interParent, intraNote, interNote, ordinary].map((r, i) => toApi(r, i + 1));

  it("one blocking warning per tax-only note, in date order, each with the note, GSTIN, section and heads worked out by hand", () => {
    const r = gstr1Sections(register, Q3, PARAMS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const manual = r.warnings.filter((w) => w.code === "tax_only_note_manual");
    expect(manual).toEqual([
      {
        code: "tax_only_note_manual",
        path: ["dn-a"],
        blocking: true,
        manual: {
          docId: "dn-a",
          kind: "debit_note",
          number: "TH/DN/2627/0003",
          date: d(2026, 11, 2),
          section: "cdnr",
          gstin: GSTIN_19,
          receiverName: "Test Client dn-a",
          posCode: "19",
          parentNumber: "TH/INV/2627/0001",
          byRate: [{ rateBp: 1800, igstMinor: 0, cgstMinor: 9_000, sgstMinor: 9_000 }],
          igstMinor: 0,
          cgstMinor: 9_000,
          sgstMinor: 9_000,
        },
      },
      {
        code: "tax_only_note_manual",
        path: ["dn-b"],
        blocking: true,
        manual: {
          docId: "dn-b",
          kind: "debit_note",
          number: "TH/DN/2627/0004",
          date: d(2026, 11, 3),
          section: "cdnr",
          gstin: GSTIN_27,
          receiverName: "Test Client dn-b",
          posCode: "27",
          parentNumber: "TH/INV/2627/0003",
          byRate: [{ rateBp: 1800, igstMinor: 1_001, cgstMinor: 0, sgstMinor: 0 }],
          igstMinor: 1_001,
          cgstMinor: 0,
          sgstMinor: 0,
        },
      },
    ]);
    // the ordinary debit note and the invoices give no such warning; no other warning is blocking
    expect(r.warnings.filter((w) => w.blocking === true).map((w) => w.path[0])).toEqual(["dn-a", "dn-b"]);
  });

  it("twin: the heads the warnings name are exactly the tax the cdnr rows carry on a nil taxable value (what the file leaves out)", () => {
    const r = gstr1Sections(register, Q3, PARAMS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const lost = r.value.cdnr
      .filter((n) => n.taxableMinor === 0)
      .reduce((a, n) => a + n.igstMinor + n.cgstMinor + n.sgstMinor, 0);
    const named = r.warnings
      .flatMap((w) => (w.manual ? [w.manual] : []))
      .reduce((a, m) => a + m.igstMinor + m.cgstMinor + m.sgstMinor, 0);
    // by hand: 9,000 + 9,000 + 1,001
    expect(lost).toBe(19_001);
    expect(named).toBe(19_001);
    // the A5 11 note is never rounded below its tax: no round-off, its value is its IGST
    expect(interDoc.roundOffMinor).toBe(0);
    expect(r.value.cdnr.find((n) => n.docId === "dn-b")?.valueInrMinor).toBe(1_001);
  });

  it("an unregistered client's tax-only note netted into B2CS is named too, with no GSTIN", () => {
    const person = { status: "unregistered" as const, gstin: null };
    const inv = row({
      id: "inv-u2",
      number: "TH/INV/2627/0009",
      date: d(2026, 10, 9),
      ...person,
      rates: parent.rates,
    });
    const note = row({
      id: "dn-u2",
      kind: "debit_note",
      number: "TH/DN/2627/0009",
      date: d(2026, 11, 9),
      ...person,
      rates: ratesOf(doc),
      noteOf: parentOf(inv),
    });
    const r = gstr1Sections([toApi(inv, 1), toApi(note, 1)], Q3, PARAMS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.warnings.find((w) => w.code === "tax_only_note_manual")?.manual).toMatchObject({
      section: "b2cs",
      gstin: null,
      cgstMinor: 9_000,
      sgstMinor: 9_000,
    });
  });

  // FX-4 review L4: the cdnur section. A tax-only debit note on an export with IGST (EXPWP, never on an LUT invoice: no tax to correct) and on an inter-state
  // invoice to an unregistered client above the B2CL limit. Each gets its cdnur rows (taxable 0, IGST only) and its blocking warning with the IGST per rate.
  it("cdnur: a tax-only debit note on an IGST export to an overseas client is a blocking warning with the IGST per rate, worked out by hand", () => {
    // the export, two rates, by hand: 5 % of 1,200,000 = 60,000 and 18 % of 3,000,000 = 540,000 IGST; 4,800,000 paise in all = USD 600.00 at 80
    const exp = row({
      id: "exp-t",
      kind: "export_invoice",
      number: "TH/EXP/2627/0007",
      date: d(2026, 11, 8),
      supply: "export_igst",
      name: "Test Overseas Seven",
      country: "GB",
      usd: { totalMinor: 60_000, fxMicros: 80_000_000 },
      rates: [rate("998313", 500, 1_200_000, "export_igst"), rate("998314", 1800, 3_000_000, "export_igst")],
    });
    expect(exp.totalInrMinor).toBe(4_800_000);
    // the note: USD 12.00 at 80 = Rs 960.00 of IGST and nothing else, split by hand Rs 80.00 at 5 % and Rs 880.00 at 18 %
    const note = row({
      id: "dn-x",
      kind: "debit_note",
      number: "TH/DN/2627/0010",
      date: d(2026, 11, 20),
      supply: "export_igst",
      name: "Test Overseas Seven",
      country: "GB",
      usd: { totalMinor: 1_200, fxMicros: 80_000_000 },
      rates: [
        { sac: "998313", rateBp: 500, taxableMinor: 0, igstMinor: 8_000, cgstMinor: 0, sgstMinor: 0 },
        { sac: "998314", rateBp: 1800, taxableMinor: 0, igstMinor: 88_000, cgstMinor: 0, sgstMinor: 0 },
      ],
      noteOf: parentOf(exp),
    });
    expect(note.totalInrMinor).toBe(96_000);
    const r = gstr1Sections([toApi(exp, 1), toApi(note, 1)], Q3, PARAMS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    // the cdnur rows: one per rate, type D, EXPWP, taxable 0, the IGST only
    expect(
      r.value.cdnur.map((n) => [
        n.docId,
        n.urType,
        n.noteType,
        n.rateBp,
        n.taxableMinor,
        n.igstMinor,
        n.cgstMinor + n.sgstMinor,
      ]),
    ).toEqual([
      ["dn-x", "EXPWP", "D", 500, 0, 8_000, 0],
      ["dn-x", "EXPWP", "D", 1800, 0, 88_000, 0],
    ]);
    expect(r.value.cdnr).toEqual([]);
    const blocking = r.warnings.filter((w) => w.blocking === true);
    expect(blocking).toEqual([
      {
        code: "tax_only_note_manual",
        path: ["dn-x"],
        blocking: true,
        manual: {
          docId: "dn-x",
          kind: "debit_note",
          number: "TH/DN/2627/0010",
          date: d(2026, 11, 20),
          section: "cdnur",
          gstin: null,
          receiverName: "Test Overseas Seven",
          posCode: "96",
          parentNumber: "TH/EXP/2627/0007",
          byRate: [
            { rateBp: 500, igstMinor: 8_000, cgstMinor: 0, sgstMinor: 0 },
            { rateBp: 1800, igstMinor: 88_000, cgstMinor: 0, sgstMinor: 0 },
          ],
          igstMinor: 96_000,
          cgstMinor: 0,
          sgstMinor: 0,
        },
      },
    ]);
  });

  it("cdnur: a tax-only debit note on an inter-state B2CL invoice to an unregistered client is a blocking warning too, with no GSTIN", () => {
    const person = {
      status: "unregistered" as const,
      gstin: null,
      supply: "inter" as const,
      pos: "27" as const,
    };
    // by hand: 18 % of 9,000,000 = 1,620,000 IGST; total 10,620,000, above the 10,000,000 B2CL limit
    const inv = row({
      id: "inv-l",
      number: "TH/INV/2627/0011",
      date: d(2026, 10, 9),
      ...person,
      rates: [rate("998314", 1800, 9_000_000, "inter")],
    });
    expect(inv.totalInrMinor).toBeGreaterThan(PARAMS.b2clThresholdInrMinor);
    const note = row({
      id: "dn-l",
      kind: "debit_note",
      number: "TH/DN/2627/0011",
      date: d(2026, 11, 9),
      ...person,
      rates: [{ sac: "998314", rateBp: 1800, taxableMinor: 0, igstMinor: 1_001, cgstMinor: 0, sgstMinor: 0 }],
      noteOf: parentOf(inv),
    });
    const r = gstr1Sections([toApi(inv, 1), toApi(note, 1)], Q3, PARAMS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.cdnur.map((n) => [n.docId, n.urType, n.noteType, n.taxableMinor, n.igstMinor])).toEqual([
      ["dn-l", "B2CL", "D", 0, 1_001],
    ]);
    const manual = r.warnings.filter((w) => w.blocking === true).map((w) => w.manual);
    expect(manual).toEqual([
      expect.objectContaining({
        docId: "dn-l",
        section: "cdnur",
        gstin: null,
        posCode: "27",
        byRate: [{ rateBp: 1800, igstMinor: 1_001, cgstMinor: 0, sgstMinor: 0 }],
        igstMinor: 1_001,
        cgstMinor: 0,
        sgstMinor: 0,
      }),
    ]);
  });

  it("an invoice or a note with a taxable value is never named", () => {
    const r = gstr1Sections([toApi(parent, 1), toApi(ordinary, 1)], Q3, PARAMS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.warnings.some((w) => w.code === "tax_only_note_manual" || w.blocking)).toBe(false);
  });
});
