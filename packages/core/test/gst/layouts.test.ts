// The layouts [ADM-REP-04, ADM-REP-07]: a version is never edited, so every version's file stems and headers are pinned in a
// snapshot. A change to a header is a new version (`-v2`) and a new snapshot, never an edit of this one. Every column is
// UNVERIFIED (docs/08-A; Settled by the lead on the safest reading, 2026-10-30 (08-C RA-23)): a test import of each CSV before the first GSTR-1 (owner duty) is the check.
import { describe, expect, it } from "vitest";
import {
  CURRENT_EDF_LAYOUT,
  CURRENT_GSTR1_LAYOUT,
  CURRENT_REALISATION_LAYOUT,
  EDF_LAYOUTS,
  type FileLayout,
  GSTR1_LAYOUTS,
  GSTR3B_LAYOUTS,
  gstr1Csv,
  OUTPUT_TAX_LAYOUTS,
  REALISATION_LAYOUTS,
  realisationCsv,
  realisationRows,
  SALES_REGISTER_LAYOUTS,
  STATEMENT_LAYOUTS,
} from "../../src/gst/index.ts";
import { STATE_CODES } from "../../src/gstin.ts";
import { d, hasBareLineBreak, rate, row } from "./fixtures.ts";

const pinned = () => ({
  gstr1: Object.fromEntries(
    Object.entries(GSTR1_LAYOUTS).map(([version, layout]) => [
      version,
      Object.fromEntries(
        Object.entries(layout)
          .filter(([key]) => key !== "posLabels")
          .map(([key, file]) => [
            key,
            {
              stem: (file as FileLayout<never>).stem,
              headers: (file as FileLayout<never>).columns.map((c) => c.header),
            },
          ]),
      ),
    ]),
  ),
  edf: Object.fromEntries(
    Object.entries(EDF_LAYOUTS).map(([v, f]) => [
      v,
      { stem: f.stem, headers: f.columns.map((c) => c.header) },
    ]),
  ),
  realisation: Object.fromEntries(
    Object.entries(REALISATION_LAYOUTS).map(([v, f]) => [
      v,
      { stem: f.stem, headers: f.columns.map((c) => c.header) },
    ]),
  ),
  // M5.5b (LD83): added after the three above, so their pinned text does not move
  salesRegister: Object.fromEntries(
    Object.entries(SALES_REGISTER_LAYOUTS).map(([v, f]) => [
      v,
      { stem: f.stem, headers: f.columns.map((c) => c.header) },
    ]),
  ),
  outputTax: Object.fromEntries(
    Object.entries(OUTPUT_TAX_LAYOUTS).map(([v, f]) => [
      v,
      { stem: f.stem, headers: f.columns.map((c) => c.header) },
    ]),
  ),
  gstr3bSummary: Object.fromEntries(
    Object.entries(GSTR3B_LAYOUTS).map(([v, f]) => [
      v,
      { stem: f.stem, headers: f.columns.map((c) => c.header) },
    ]),
  ),
  statement: Object.fromEntries(
    Object.entries(STATEMENT_LAYOUTS).map(([v, f]) => [
      v,
      { stem: f.stem, headers: f.columns.map((c) => c.header) },
    ]),
  ),
});

describe("layout versions", () => {
  it("every version's stems and headers are pinned", async () => {
    await expect(`${JSON.stringify(pinned(), null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/layout-headers.json",
    );
  });

  it("the current versions are the v1 ones and exist", () => {
    expect(CURRENT_GSTR1_LAYOUT).toBe("gstr1-csv-v1");
    expect(CURRENT_EDF_LAYOUT).toBe("edf-v1");
    expect(CURRENT_REALISATION_LAYOUT).toBe("realisation-v1");
    expect(Object.keys(GSTR1_LAYOUTS)).toContain(CURRENT_GSTR1_LAYOUT);
    expect(Object.keys(EDF_LAYOUTS)).toContain(CURRENT_EDF_LAYOUT);
    expect(Object.keys(REALISATION_LAYOUTS)).toContain(CURRENT_REALISATION_LAYOUT);
  });

  it("everything is frozen, down to the columns", () => {
    const v1 = GSTR1_LAYOUTS["gstr1-csv-v1"];
    expect(Object.isFrozen(GSTR1_LAYOUTS)).toBe(true);
    expect(Object.isFrozen(v1)).toBe(true);
    expect(Object.isFrozen(v1.posLabels)).toBe(true);
    for (const key of ["b2b", "b2cl", "b2cs", "exp", "cdnr", "cdnur", "hsnB2b", "hsnB2c", "docs"] as const) {
      expect(Object.isFrozen(v1[key])).toBe(true);
      expect(Object.isFrozen(v1[key].columns)).toBe(true);
      expect(v1[key].columns.every((c) => Object.isFrozen(c))).toBe(true);
    }
    expect(Object.isFrozen(EDF_LAYOUTS)).toBe(true);
    expect(Object.isFrozen(EDF_LAYOUTS["edf-v1"].columns)).toBe(true);
    expect(Object.isFrozen(REALISATION_LAYOUTS)).toBe(true);
  });

  it("the place-of-supply labels cover every state code as `code-name`, in the layout's own table", () => {
    const labels = GSTR1_LAYOUTS["gstr1-csv-v1"].posLabels;
    expect(Object.keys(labels).sort()).toEqual(Object.keys(STATE_CODES).sort());
    for (const [code, info] of Object.entries(STATE_CODES)) {
      expect(labels[code as keyof typeof labels]).toBe(`${code}-${info.name}`);
    }
    expect(labels["19"]).toBe("19-West Bengal");
  });

  it("every file ends each record, the header included, in CRLF", () => {
    const empty = {
      b2b: [],
      b2cl: [],
      b2cs: [],
      exp: [],
      cdnr: [],
      cdnur: [],
      hsnB2b: [],
      hsnB2c: [],
      period: { kind: "month", year: 2026, month: 10 },
      range: { from: d(2026, 10, 1), to: d(2026, 10, 31) },
      supplierStateCode: "19",
      totals: {},
    } as never;
    const r = gstr1Csv(empty, []);
    if (!r.ok) throw new Error("csv");
    for (const f of r.value) {
      expect(f.csv.endsWith("\r\n")).toBe(true);
      expect(f.csv.split("\r\n")).toHaveLength(2);
      expect(f.csv).not.toMatch(/(?<!\r)\n/);
    }
  });

  it("a byte-order mark only when asked", () => {
    const empty = {
      b2b: [],
      b2cl: [],
      b2cs: [],
      exp: [],
      cdnr: [],
      cdnur: [],
      hsnB2b: [],
      hsnB2c: [],
    } as never;
    const plain = gstr1Csv(empty, []);
    const bom = gstr1Csv(empty, [], "gstr1-csv-v1", { bom: true });
    expect(plain.ok && plain.value[0]?.csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(bom.ok && bom.value.every((f) => f.csv.charCodeAt(0) === 0xfeff)).toBe(true);
  });
});

describe("the realisation report", () => {
  it("is written in the v1 layout", async () => {
    const exp = (id: string, date: ReturnType<typeof d>, over: Parameters<typeof row>[0]["override"] = {}) =>
      row({
        id,
        number: `EXP-${id}`,
        kind: "export_invoice",
        supply: "export_lut",
        date,
        name: id === "b" ? "-Overseas, Co" : `Client ${id}`,
        rates: [rate("998314", 1800, 1000, "export_lut")],
        override: over,
      });
    const rows = realisationRows(
      [
        exp("a", d(2026, 11, 3), { currency: "USD", outstandingMinor: 100_000 }),
        exp("b", d(2026, 12, 15), { currency: "INR", outstandingMinor: 0 }),
        exp("c", d(2026, 5, 31), { currency: "USD", outstandingMinor: 25_050 }),
      ],
      d(2027, 8, 10),
    );
    if (!rows.ok) throw new Error("rows");
    const csv = realisationCsv(rows.value);
    if (!csv.ok) throw new Error("csv");
    expect(hasBareLineBreak(csv.value)).toBe(false);
    await expect(csv.value).toMatchFileSnapshot("./__snapshots__/realisation-v1.csv");
    expect(csv.value.split("\r\n")[0]).toBe(
      "Invoice number,Invoice date,Client,Currency,Outstanding,FEMA due,GST due,Stage",
    );
  });
});

describe("columns with a missing value are blank, not 'null'", () => {
  const v1 = GSTR1_LAYOUTS["gstr1-csv-v1"];
  const invoice = {
    docId: "x",
    section: "b2b",
    number: "N1",
    date: d(2026, 10, 5),
    valueInrMinor: 100,
    posCode: "19",
    reverseCharge: true,
    gstin: null,
    receiverName: "R",
    exportType: null,
    rateBp: 1800,
    taxableMinor: 1,
    igstMinor: 0,
    cgstMinor: 0,
    sgstMinor: 0,
  } as const;
  const note = { ...invoice, section: "cdnr", noteType: "D", urType: null, imsStatus: null } as const;

  it("a B2B row without a GSTIN, an export without a type, a note without a UR type", () => {
    expect(v1.b2b.columns[0]?.cell(invoice)).toEqual({ kind: "blank" });
    expect(v1.b2b.columns.find((c) => c.header === "Reverse Charge")?.cell(invoice)).toEqual({
      kind: "text",
      value: "Y",
    });
    expect(v1.cdnr.columns[0]?.cell(note)).toEqual({ kind: "blank" });
    expect(v1.cdnr.columns.find((c) => c.header === "Note Type")?.cell(note)).toEqual({
      kind: "text",
      value: "D",
    });
    expect(v1.exp.columns[0]?.cell(invoice)).toEqual({ kind: "blank" });
    expect(v1.cdnur.columns[0]?.cell(note)).toEqual({ kind: "blank" });
  });
});
