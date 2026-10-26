// The golden fixture of the GSTR-1 core [ADM-REP-04]: ~18 hand-built documents, the expected sections worked out BY HAND
// (the arithmetic is in the comments), and every CSV pinned as a file snapshot (also the CA's sample to import into the
// Offline Tool: the layouts are UNVERIFIED). Snapshot files keep CRLF (`__snapshots__/.gitattributes` says `-text`); the CRLF itself is asserted directly
// (`hasBareLineBreak`), because Vitest ignores the difference when it compares a file snapshot.
import { describe, expect, it } from "vitest";
import {
  type DocsIssuedInput,
  type DocsRow,
  docsRows,
  type Gstr1Sections,
  gstr1Csv,
  gstr1Sections,
} from "../../src/gst/index.ts";
import { GOLDEN_REGISTER, hasBareLineBreak, PARAMS, Q3 } from "./fixtures.ts";

const run = () => {
  const r = gstr1Sections(GOLDEN_REGISTER, Q3, PARAMS);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};

// Table 13 as M5.5b's adapter would pass it (deliberately not in series order).
const DOCS: DocsIssuedInput[] = [
  { series: "debitNote", from: "TH/DN/2627/0001", to: "TH/DN/2627/0001", total: 1, cancelled: 0 },
  { series: "invoice", from: "TH/INV/2627/0001", to: "TH/INV/2627/0009", total: 9, cancelled: 1 },
  { series: "creditNote", from: "TH/CN/2627/0001", to: "TH/CN/2627/0004", total: 4, cancelled: 0 },
  { series: "export", from: "TH/EXP/2627/0001", to: "TH/EXP/2627/0003", total: 3, cancelled: 0 },
];

const pick = (s: Gstr1Sections) => ({
  b2b: s.b2b.map((r) => [r.docId, r.rateBp, r.taxableMinor, r.igstMinor, r.cgstMinor, r.sgstMinor]),
  b2cl: s.b2cl.map((r) => [r.docId, r.rateBp, r.taxableMinor, r.igstMinor]),
  exp: s.exp.map((r) => [r.docId, r.exportType, r.rateBp, r.taxableMinor, r.igstMinor, r.valueInrMinor]),
  cdnr: s.cdnr.map((r) => [r.docId, r.noteType, r.taxableMinor, r.cgstMinor, r.sgstMinor, r.valueInrMinor]),
  cdnur: s.cdnur.map((r) => [r.docId, r.urType, r.noteType, r.rateBp, r.taxableMinor, r.valueInrMinor]),
});

describe("golden fixture: Q3 of FY 2026-27, worked out by hand", () => {
  it("reports 16 documents: the voided one and the one from the previous quarter are left out", () => {
    const { value } = run();
    expect(value.totals.overall.documents).toBe(16);
    const ids = [...value.b2b, ...value.b2cl, ...value.exp, ...value.cdnr, ...value.cdnur].map(
      (r) => r.docId,
    );
    expect(ids).not.toContain("inv06");
    expect(ids).not.toContain("inv07");
  });

  it("b2b, b2cl, exp, cdnr and cdnur rows, one per (document, rate), sorted by date then number", () => {
    const p = pick(run().value);
    expect(p.b2b).toEqual([
      // inv01: intra, 18 % of 1,000,000 = 180,000 = 90,000 + 90,000
      ["inv01", 1800, 1_000_000, 0, 90_000, 90_000],
      // inv02: inter, two rates (5 % of 2,000,000 = 100,000; 18 % of 5,000,000 = 900,000), rate ascending
      ["inv02", 500, 2_000_000, 100_000, 0, 0],
      ["inv02", 1800, 5_000_000, 900_000, 0, 0],
      // inv08: 5 % of 400,000 = 20,000 = 10,000 + 10,000
      ["inv08", 500, 400_000, 0, 10_000, 10_000],
      // inv09: 18 % of 600,000 = 108,000
      ["inv09", 1800, 600_000, 108_000, 0, 0],
    ]);
    // Exactly Rs 1,00,000.00 (inv04) is B2CS; one paisa more (inv05) is B2CL: 8,474,576 + 1,525,424 + 1 round-off.
    expect(p.b2cl).toEqual([["inv05", 1800, 8_474_576, 1_525_424]]);
    expect(p.exp).toEqual([
      ["exp01", "WOPAY", 0, 8_350_000, 0, 8_350_000], // USD 1,000.00 x 83.5, under LUT
      ["exp02", "WPAY", 1800, 4_200_000, 756_000, 4_956_000], // USD 500.00 x 84, IGST 18 % = 756,000
      ["exp03", "WOPAY", 0, 3_000_000, 0, 3_000_000], // an INR export
    ]);
    // cn01: 18 % of 200,000 = 36,000 = 18,000 + 18,000; value 236,000
    expect(p.cdnr).toEqual([["cn01", "C", 200_000, 18_000, 18_000, 236_000]]);
    expect(p.cdnur).toEqual([
      ["cn02", "B2CL", "C", 1800, 847_457, 999_999], // follows its B2CL parent (inv05): 152,542 IGST
      ["cn03", "EXPWOP", "C", 0, 835_000, 835_000], // follows its export parent, under LUT
    ]);
  });

  it("b2cs nets the notes in (credit negative, debit positive), by place of supply then rate", () => {
    expect(run().value.b2cs).toEqual([
      // 19, 18 %: inv03 20,000,000 + inv10 300,000 + dn01 1,000,000; each half of the tax 1,800,000 + 27,000 + 90,000
      {
        posCode: "19",
        rateBp: 1800,
        taxableMinor: 21_300_000,
        igstMinor: 0,
        cgstMinor: 1_917_000,
        sgstMinor: 1_917_000,
      },
      // 27, 18 %: only the credit note cn04 (its invoice is in the previous quarter): a negative net
      { posCode: "27", rateBp: 1800, taxableMinor: -500_000, igstMinor: -90_000, cgstMinor: 0, sgstMinor: 0 },
      // 29, 18 %: inv04 at exactly Rs 1,00,000.00
      {
        posCode: "29",
        rateBp: 1800,
        taxableMinor: 8_474_576,
        igstMinor: 1_525_424,
        cgstMinor: 0,
        sgstMinor: 0,
      },
    ]);
  });

  it("HSN: B2B invoices and CDNR notes in one table, everything else in the other", () => {
    const { value } = run();
    expect(value.hsnB2b).toEqual([
      {
        sac: "998313",
        description: "IT design services",
        rateBp: 500,
        taxableMinor: 2_000_000,
        igstMinor: 100_000,
        cgstMinor: 0,
        sgstMinor: 0,
        totalValueMinor: 2_100_000,
      },
      // 998314 at 18 %: inv01 1,000,000 + inv02 5,000,000 + inv09 600,000 - cn01 200,000 = 6,400,000
      {
        sac: "998314",
        description: "IT support services",
        rateBp: 1800,
        taxableMinor: 6_400_000,
        igstMinor: 1_008_000,
        cgstMinor: 72_000,
        sgstMinor: 72_000,
        totalValueMinor: 7_552_000,
      },
      {
        sac: "998315",
        description: "",
        rateBp: 500,
        taxableMinor: 400_000,
        igstMinor: 0,
        cgstMinor: 10_000,
        sgstMinor: 10_000,
        totalValueMinor: 420_000,
      },
    ]);
    expect(value.hsnB2c).toEqual([
      {
        sac: "998313",
        description: "IT design services",
        rateBp: 1800,
        taxableMinor: 4_200_000,
        igstMinor: 756_000,
        cgstMinor: 0,
        sgstMinor: 0,
        totalValueMinor: 4_956_000,
      },
      // exp01 8,350,000 + exp03 3,000,000 - cn03 835,000 = 10,515,000, no tax under LUT
      {
        sac: "998314",
        description: "IT support services",
        rateBp: 0,
        taxableMinor: 10_515_000,
        igstMinor: 0,
        cgstMinor: 0,
        sgstMinor: 0,
        totalValueMinor: 10_515_000,
      },
      // taxable: inv03 20,000,000 + inv04 8,474,576 + inv05 8,474,576 + inv10 300,000 + dn01 1,000,000 - cn04 500,000 - cn02 847,457
      {
        sac: "998314",
        description: "IT support services",
        rateBp: 1800,
        taxableMinor: 36_901_695,
        igstMinor: 2_808_306,
        cgstMinor: 1_917_000,
        sgstMinor: 1_917_000,
        totalValueMinor: 43_544_001,
      },
    ]);
  });

  it("the totals add up: sections, HSN tables and the whole return", () => {
    const { totals } = run().value;
    // 9,000,000 + 8,474,576 + 29,274,576 + 15,550,000 - 200,000 - 1,682,457
    expect(totals.overall.taxableMinor).toBe(60_416_695);
    expect(totals.hsnB2b.taxableMinor + totals.hsnB2c.taxableMinor).toBe(totals.overall.taxableMinor);
    expect(totals.hsnB2b.taxableMinor).toBe(8_800_000);
    expect(totals.hsnB2c.taxableMinor).toBe(51_616_695);
    // the documents' own INR totals: 71,748,001 issued - 2,660,999 credited
    expect(totals.overall.documentValueMinor).toBe(69_087_002);
    expect(totals.hsnB2b.documentValueMinor + totals.hsnB2c.documentValueMinor).toBe(69_087_002);
    expect(totals.b2cl.documentValueMinor).toBe(10_000_001);
    expect(totals.cdnur.documentValueMinor).toBe(-(999_999 + 835_000));
    expect(totals.b2b.documents).toBe(4);
    const parts = [totals.b2b, totals.b2cl, totals.b2cs, totals.exp, totals.cdnr, totals.cdnur];
    for (const key of [
      "taxableMinor",
      "igstMinor",
      "cgstMinor",
      "sgstMinor",
      "valueMinor",
      "documentValueMinor",
      "documents",
    ] as const) {
      expect(parts.reduce((s, t) => s + t[key], 0)).toBe(totals.overall[key]);
    }
  });

  it("warns about the negative b2cs net and the SAC with no description", () => {
    expect(run().warnings).toEqual([
      { code: "b2cs_negative_net", path: ["b2cs", 1] },
      { code: "hsn_description_missing", path: ["hsn", "998315"] },
    ]);
  });

  it("is the same for any order of the register", () => {
    const a = run().value;
    const b = gstr1Sections([...GOLDEN_REGISTER].reverse(), Q3, PARAMS);
    expect(b.ok && b.value).toEqual(a);
  });
});

describe("golden fixture: file snapshots (the CA's sample)", () => {
  const docs = (): readonly DocsRow[] => {
    const r = docsRows(DOCS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.value;
  };

  it("every GSTR-1 file", async () => {
    const r = gstr1Csv(run().value, docs());
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.map((f) => f.name)).toEqual([
      "b2b.csv",
      "b2cl.csv",
      "b2cs.csv",
      "exp.csv",
      "cdnr.csv",
      "cdnur.csv",
      "hsn_b2b.csv",
      "hsn_b2c.csv",
      "docs.csv",
    ]);
    for (const f of r.value) {
      expect(hasBareLineBreak(f.csv)).toBe(false);
      await expect(f.csv).toMatchFileSnapshot(`./__snapshots__/gstr1-v1-q3-${f.name}`);
    }
  });

  it("Table 13 in series order with two invoice rows", () => {
    expect(docs().map((r) => [r.series, r.nature, r.total, r.cancelled])).toEqual([
      ["invoice", "Invoices for outward supply", 9, 1],
      ["export", "Invoices for outward supply", 3, 0],
      ["creditNote", "Credit Note", 4, 0],
      ["debitNote", "Debit Note", 1, 0],
    ]);
  });
});
