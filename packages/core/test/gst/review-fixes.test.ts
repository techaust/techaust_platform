// Review fixes of M5.5a [ADM-REP-04, ADM-REP-07; Researched 2026-10-28, GSTN advisories of June 2025 (08-C RA-23)]: supply consistency (`supply_mismatch`), the document
// number character set, a note's parent block (`parent_invalid`), blank SACs, one number namespace for invoices, EDF FEMA
// extensions, and the branded `Cell`.
import { describe, expect, it } from "vitest";
import {
  type Cell,
  edfRows,
  type GstIssue,
  type GstPeriod,
  gstr1Sections,
  type RegisterRow,
  realisationRows,
  writeCsv,
} from "../../src/gst/index.ts";
import { d, GSTIN_27, hasBareLineBreak, PARAMS, parentOf, rate, row } from "./fixtures.ts";

const Q3: GstPeriod = { kind: "quarter", fyStartYear: 2026, quarter: 3 };
const errors = (register: readonly RegisterRow[]): GstIssue[] => {
  const r = gstr1Sections(register, Q3, PARAMS);
  if (r.ok) throw new Error("expected errors, got ok");
  return r.errors;
};
const only = (code: string, ...path: (string | number)[]) => [{ code, path: path.length ? path : ["x"] }];

describe("supply_mismatch: kind, supply type, recipient status, place of supply and heads must agree", () => {
  it("an export invoice must have an export supply", () => {
    const r = row({
      id: "x",
      kind: "export_invoice",
      supply: "inter",
      pos: "27",
      status: "unregistered",
      gstin: null,
      rates: [rate("998314", 1800, 1000, "inter")],
    });
    expect(errors([r])).toEqual(only("supply_mismatch", "x", "kind"));
  });

  it("a tax invoice must not have an export supply", () => {
    expect(errors([row({ id: "x", kind: "tax_invoice", supply: "export_lut" })])).toEqual(
      only("supply_mismatch", "x", "kind"),
    );
    expect(errors([row({ id: "x", kind: "tax_invoice", supply: "export_igst", pos: "96" })])).toEqual(
      only("supply_mismatch", "x", "kind"),
    );
  });

  it("an export invoice with an export supply is fine, under LUT and with IGST", () => {
    for (const supply of ["export_lut", "export_igst"] as const) {
      const r = row({
        id: "x",
        kind: "export_invoice",
        supply,
        rates: [rate("998314", 1800, 1000, supply)],
      });
      expect(gstr1Sections([r], Q3, PARAMS).ok).toBe(true);
    }
  });

  it("an overseas recipient is exactly an export", () => {
    expect(errors([row({ id: "x", status: "overseas", gstin: null })])).toEqual(
      only("supply_mismatch", "x", "recipient"),
    );
    expect(
      errors([row({ id: "x", kind: "export_invoice", supply: "export_lut", status: "registered" })]),
    ).toEqual(only("supply_mismatch", "x", "recipient"));
  });

  it("intra-state is the supplier's own state, inter-state any other state", () => {
    // an intra row with POS 29 (supplier 19), CGST + SGST
    expect(errors([row({ id: "x", supply: "intra", pos: "29" })])).toEqual(
      only("supply_mismatch", "x", "pos"),
    );
    // an inter row with the supplier's own state
    expect(
      errors([row({ id: "x", supply: "inter", pos: "19", rates: [rate("998314", 1800, 1000, "inter")] })]),
    ).toEqual(only("supply_mismatch", "x", "pos"));
    expect(
      gstr1Sections(
        [row({ id: "x", supply: "inter", pos: "29", rates: [rate("998314", 1800, 1000, "inter")] })],
        Q3,
        PARAMS,
      ).ok,
    ).toBe(true);
    // the supplier's state is a parameter
    expect(
      gstr1Sections([row({ id: "x", supply: "intra", pos: "19" })], Q3, {
        ...PARAMS,
        supplierStateCode: "29",
      }).ok,
    ).toBe(false);
  });

  it("the tax heads match the supply", () => {
    const base = rate("998314", 1800, 1_000_000, "intra");
    const inter = rate("998314", 1800, 1_000_000, "inter");
    const lut = rate("998314", 1800, 1_000_000, "export_lut");
    const cases: [string, RegisterRow][] = [
      ["intra with IGST", row({ id: "x", rates: [{ ...base, igstMinor: 5, cgstMinor: 0, sgstMinor: 0 }] })],
      [
        "intra with CGST not equal to SGST",
        row({ id: "x", rates: [{ ...base, cgstMinor: base.cgstMinor + 1 }] }),
      ],
      ["inter with CGST", row({ id: "x", supply: "inter", pos: "27", rates: [{ ...inter, cgstMinor: 5 }] })],
      ["inter with SGST", row({ id: "x", supply: "inter", pos: "27", rates: [{ ...inter, sgstMinor: 5 }] })],
      [
        "export with IGST and CGST",
        row({ id: "x", kind: "export_invoice", supply: "export_igst", rates: [{ ...inter, cgstMinor: 5 }] }),
      ],
      [
        "a LUT export with IGST",
        row({ id: "x", kind: "export_invoice", supply: "export_lut", rates: [{ ...lut, igstMinor: 5 }] }),
      ],
      [
        "a LUT export with CGST",
        row({ id: "x", kind: "export_invoice", supply: "export_lut", rates: [{ ...lut, cgstMinor: 5 }] }),
      ],
      [
        "a LUT export with SGST",
        row({ id: "x", kind: "export_invoice", supply: "export_lut", rates: [{ ...lut, sgstMinor: 5 }] }),
      ],
    ];
    for (const [label, r] of cases) {
      expect(errors([r]), label).toEqual(only("supply_mismatch", "x", "heads"));
    }
    // a second rate line that breaks the rule is found too
    expect(errors([row({ id: "x", rates: [base, { ...base, sac: "998313", igstMinor: 1 }] })])).toEqual(
      only("supply_mismatch", "x", "heads"),
    );
  });

  it("a note shares its parent's supply type, place of supply and recipient status", () => {
    const parent = row({
      id: "p",
      number: "P1",
      supply: "inter",
      pos: "27",
      gstin: GSTIN_27,
      rates: [rate("998314", 1800, 1000, "inter")],
    });
    const note = row({ id: "x", kind: "credit_note", gstin: GSTIN_27, noteOf: parentOf(parent) });
    expect(errors([note])).toEqual(only("supply_mismatch", "x", "noteOf"));
    // the same supply type but another place of supply: refused
    const otherState = row({
      id: "x",
      kind: "credit_note",
      supply: "inter",
      pos: "29",
      gstin: GSTIN_27,
      noteOf: parentOf(parent),
      rates: [rate("998314", 1800, 500, "inter")],
    });
    expect(errors([otherState])).toEqual(only("supply_mismatch", "x", "noteOf"));
    // another recipient status than the parent's
    const otherStatus = row({
      id: "x",
      kind: "credit_note",
      supply: "inter",
      pos: "27",
      status: "unregistered",
      gstin: GSTIN_27,
      noteOf: parentOf(parent),
      rates: [rate("998314", 1800, 500, "inter")],
    });
    expect(errors([otherStatus])).toEqual(only("supply_mismatch", "x", "noteOf"));
    // the same supply type is fine
    const same = row({
      id: "x",
      kind: "credit_note",
      supply: "inter",
      pos: "27",
      gstin: GSTIN_27,
      noteOf: parentOf(parent),
      rates: [rate("998314", 1800, 500, "inter")],
    });
    expect(gstr1Sections([same], Q3, PARAMS).ok).toBe(true);
    // a credit note against an export parent is an export note
    const exportParent = row({
      id: "e",
      number: "E1",
      supply: "export_lut",
      rates: [rate("998314", 0, 1000, "export_lut")],
    });
    const exportNote = row({
      id: "x",
      kind: "credit_note",
      supply: "export_lut",
      noteOf: parentOf(exportParent),
      rates: [rate("998314", 0, 500, "export_lut")],
    });
    expect(gstr1Sections([exportNote], Q3, PARAMS).ok).toBe(true);
  });

  it("is not reported twice with export_pos_mismatch, and voided rows are not checked", () => {
    expect(errors([row({ id: "x", supply: "intra", pos: "96" })])).toEqual(only("export_pos_mismatch"));
    expect(
      errors([
        row({
          id: "x",
          kind: "export_invoice",
          supply: "export_lut",
          pos: "19",
          status: "overseas",
          gstin: null,
        }),
      ]),
    ).toEqual(only("export_pos_mismatch"));
    const voided = row({ id: "v", number: "V", voided: true, status: "overseas", gstin: null });
    expect(gstr1Sections([voided], Q3, PARAMS).ok).toBe(true);
  });
});

describe("number_invalid: capital letters, digits, slash and hyphen, starting with a letter or digit, at most 16", () => {
  it("refuses what `defuse` or the portal would change", () => {
    for (const bad of [
      "a1",
      "A1a",
      "-2627/0001",
      "=A1",
      "+A1",
      "@A1",
      "'A1",
      "/A1",
      "A 1",
      "A_1",
      "A\t1",
      "A.1",
      "Ä1",
      "\tA",
      "",
    ]) {
      expect(errors([row({ id: "x", number: bad })]), JSON.stringify(bad)).toEqual(only("number_invalid"));
    }
    expect(errors([row({ id: "x", number: "A".repeat(17) })])).toEqual(only("number_invalid"));
  });

  it("accepts the usual forms", () => {
    for (const good of ["A", "TH/INV/2627/0001", "A-1/2", "0001", "9".repeat(16)]) {
      expect(gstr1Sections([row({ id: "x", number: good })], Q3, PARAMS).ok, good).toBe(true);
    }
  });
});

describe("parent_invalid: a note's parent block is checked", () => {
  const parent = row({ id: "p", number: "P1", gstin: GSTIN_27 });
  const noteWith = (patch: object) =>
    row({
      id: "x",
      kind: "credit_note",
      gstin: GSTIN_27,
      noteOf: { ...parentOf(parent), ...patch } as never,
    });

  it("refuses a total that is NaN, negative, fractional or beyond the safe range", () => {
    for (const bad of [Number.NaN, -1, 1.5, 2 ** 60, Number.POSITIVE_INFINITY]) {
      expect(errors([noteWith({ totalInrMinor: bad })])).toEqual(only("parent_invalid", "x", "noteOf"));
    }
  });

  it("refuses an unknown supply type, status, date or place of supply", () => {
    for (const patch of [
      { supplyType: "export" },
      { supplyType: undefined },
      { recipientStatus: "guest" },
      { recipientStatus: 3 },
      { issueDate: d(2026, 2, 30) },
      { placeOfSupplyCode: "50" },
      { placeOfSupplyCode: 19 },
    ]) {
      const found = errors([noteWith(patch)]);
      expect(
        found.map((e) => e.code),
        JSON.stringify(patch),
      ).toContain("parent_invalid");
      expect(found.find((e) => e.code === "parent_invalid")?.path).toEqual(["x", "noteOf"]);
    }
  });

  it("an unregistered inter-state parent above the threshold is not quietly netted into b2cs", () => {
    const bad = row({
      id: "x",
      kind: "credit_note",
      supply: "inter",
      pos: "27",
      status: "unregistered",
      gstin: null,
      rates: [rate("998314", 1800, 1000, "inter")],
      noteOf: {
        ...parentOf(
          row({ id: "p", number: "P1", supply: "inter", pos: "27", status: "unregistered", gstin: null }),
        ),
        totalInrMinor: Number.NaN,
      },
    });
    expect(errors([bad])).toEqual(only("parent_invalid", "x", "noteOf"));
  });

  it("a valid parent, and a parent ignored on an invoice, pass", () => {
    expect(gstr1Sections([noteWith({})], Q3, PARAMS).ok).toBe(true);
    expect(
      gstr1Sections(
        [row({ id: "x", noteOf: { ...parentOf(parent), totalInrMinor: Number.NaN } })],
        Q3,
        PARAMS,
      ).ok,
    ).toBe(true);
  });
});

describe("sac_missing: a blank SAC counts as missing", () => {
  it("an empty or whitespace SAC", () => {
    for (const sac of ["", "   ", "\t"]) {
      expect(errors([row({ id: "x", rates: [rate(sac, 1800, 1000, "intra")] })])).toEqual(
        only("sac_missing"),
      );
    }
  });
});

describe("duplicate_row: the two invoice kinds share one number namespace", () => {
  it("a tax invoice and an export invoice with the same number", () => {
    const inv = row({ id: "x", number: "A1" });
    const exp = row({
      id: "y",
      number: "A1",
      kind: "export_invoice",
      supply: "export_lut",
      rates: [rate("998314", 0, 1000, "export_lut")],
    });
    expect(errors([inv, exp])).toEqual(only("duplicate_row", "y"));
  });

  it("a credit note and a debit note may still share a number, and a note may share an invoice's", () => {
    const parent = row({ id: "p", number: "A1", gstin: GSTIN_27 });
    const cn = row({ id: "c", number: "N1", kind: "credit_note", gstin: GSTIN_27, noteOf: parentOf(parent) });
    const dn = row({ id: "d", number: "N1", kind: "debit_note", gstin: GSTIN_27, noteOf: parentOf(parent) });
    const cnSame = row({
      id: "e",
      number: "A1",
      kind: "credit_note",
      gstin: GSTIN_27,
      noteOf: parentOf(parent),
    });
    expect(gstr1Sections([parent, cn, dn, cnSame], Q3, PARAMS).ok).toBe(true);
    // two notes of one kind with the same number are a duplicate
    const cn2 = row({
      id: "f",
      number: "N1",
      kind: "credit_note",
      gstin: GSTIN_27,
      noteOf: parentOf(parent),
    });
    expect(errors([cn, cn2])).toEqual(only("duplicate_row", "f"));
  });
});

describe("edfRows takes FEMA extensions, as realisationRows does", () => {
  const inv = row({
    id: "e1",
    number: "EXP-1",
    kind: "export_invoice",
    supply: "export_lut",
    date: d(2026, 11, 3),
    country: "US",
    usd: { totalMinor: 100_000, fxMicros: 83_500_000 },
    rates: [rate("998314", 0, 8_350_000, "export_lut")],
  });

  it("the extended date replaces the computed one, and both reports agree", () => {
    const plain = edfRows([inv], 2026, 11);
    const ext = { e1: { femaDue: d(2027, 11, 30) } };
    const extended = edfRows([inv], 2026, 11, { extensions: ext });
    if (!plain.ok || !extended.ok) throw new Error("rows");
    expect(plain.value[0]?.femaDue).toEqual(d(2027, 8, 3));
    expect(extended.value[0]?.femaDue).toEqual(d(2027, 11, 30));
    const report = realisationRows([inv], d(2027, 1, 1), undefined, ext);
    if (!report.ok) throw new Error("report");
    expect(report.value[0]?.femaDue).toEqual(extended.value[0]?.femaDue);
  });

  it("an extension for another document is ignored, an invalid extension date is date_invalid", () => {
    const other = edfRows([inv], 2026, 11, { extensions: { zz: { femaDue: d(2030, 1, 1) } } });
    expect(other.ok && other.value[0]?.femaDue).toEqual(d(2027, 8, 3));
    const none = edfRows([inv], 2026, 11, { extensions: { e1: {} } });
    expect(none.ok && none.value[0]?.femaDue).toEqual(d(2027, 8, 3));
    const bad = edfRows([inv], 2026, 11, { extensions: { e1: { femaDue: d(2027, 2, 30) } } });
    expect(bad).toEqual({ ok: false, errors: [{ code: "date_invalid", path: ["e1", "extension"] }] });
  });
});

describe("Cell is branded, and the byte-order mark is explicit", () => {
  it("a hand-built cell is a type error (the only way in is cell.*)", () => {
    // @ts-expect-error a raw cell cannot be built by hand, so free text cannot skip `defuse`
    const handBuilt: Cell = { kind: "raw", value: "=1+1" };
    expect(writeCsv([[handBuilt]])).toBe("=1+1\r\n");
  });

  it("writes U+FEFF only with bom: true", () => {
    expect(writeCsv([], { bom: true })).toBe("﻿");
    expect(writeCsv([])).toBe("");
  });

  it("hasBareLineBreak tells a bare LF or CR from CRLF and from a quoted break", () => {
    expect(hasBareLineBreak("a\r\nb\r\n")).toBe(false);
    expect(hasBareLineBreak('"a\nb"\r\n')).toBe(false);
    expect(hasBareLineBreak("a\nb\r\n")).toBe(true);
    expect(hasBareLineBreak("a\rb\r\n")).toBe(true);
  });
});
