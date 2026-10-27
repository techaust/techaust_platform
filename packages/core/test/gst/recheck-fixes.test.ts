// M5.5b step A0: the M5.5a re-check lows 2 to 7 and Q53 [ADM-REP-04, ADM-REP-07, ADM-INV-17; VERIFY WITH CA/LEGAL]. Lows 2, 4 and 5
// are also pinned in review-fixes.test.ts (the paths with suffixes and the capital-letter numbers).
import { describe, expect, it } from "vitest";
import {
  edfRows,
  type GstPeriod,
  gstr1Sections,
  type RealisationRules,
  realisationDates,
  realisationRows,
  realisationStatus,
  stageOf,
} from "../../src/gst/index.ts";
import { checkedDueDates, DEFAULT_REALISATION_RULES } from "../../src/gst/realisation.ts";
import { d, PARAMS, rate, row } from "./fixtures.ts";

const Q3: GstPeriod = { kind: "quarter", fyStartYear: 2026, quarter: 3 };

describe("params_invalid (re-check 3): the supplier's state must be a known state code", () => {
  const good = [row({ id: "x" })];
  it("refuses an unknown code, the export code 96, and a non-string", () => {
    for (const bad of ["50", "96", "", "ab", 19, undefined]) {
      const r = gstr1Sections(good, Q3, { ...PARAMS, supplierStateCode: bad as never });
      expect(r, String(bad)).toEqual({
        ok: false,
        errors: [{ code: "params_invalid", path: ["params", "supplierStateCode"] }],
      });
    }
  });

  it("is reported next to threshold_invalid (which keeps its own code)", () => {
    const r = gstr1Sections(good, Q3, {
      ...PARAMS,
      supplierStateCode: "96" as never,
      b2clThresholdInrMinor: -1,
    });
    expect(r).toEqual({
      ok: false,
      errors: [
        { code: "threshold_invalid", path: ["params", "b2clThresholdInrMinor"] },
        { code: "params_invalid", path: ["params", "supplierStateCode"] },
      ],
    });
  });

  it("a known state is accepted", () => {
    expect(gstr1Sections(good, Q3, PARAMS).ok).toBe(true);
    // another supplier state is a parameter: the same row is then an inter-state one
    expect(gstr1Sections(good, Q3, { ...PARAMS, supplierStateCode: "29" }).ok).toBe(false);
  });
});

describe("an unknown recipient status is a mismatch, never a guess (M5.5b: the register's snapshot may lack it)", () => {
  it("is supply_mismatch at [id, recipient]", () => {
    for (const status of [undefined, null, "guest", ""]) {
      const r = gstr1Sections(
        [
          row({
            id: "x",
            override: { recipient: { ...row({ id: "y" }).recipient, status: status as never } },
          }),
        ],
        Q3,
        PARAMS,
      );
      expect(r, String(status)).toEqual({
        ok: false,
        errors: [{ code: "supply_mismatch", path: ["x", "recipient"] }],
      });
    }
  });
});

describe("sac_invalid (re-check 6): a SAC is trimmed and has exactly six digits", () => {
  const bad = (sac: string) =>
    gstr1Sections([row({ id: "x", rates: [rate(sac, 1800, 1000, "intra")] })], Q3, PARAMS);

  it("anything but six digits is sac_invalid", () => {
    for (const sac of ["99831", "9983144", "99831A", "99 831", "٩٩٨٣١٤", "9983.1", "-99831"]) {
      expect(bad(sac), sac).toEqual({ ok: false, errors: [{ code: "sac_invalid", path: ["x"] }] });
    }
  });

  it("blank is still sac_missing, not sac_invalid", () => {
    expect(bad("  ")).toEqual({ ok: false, errors: [{ code: "sac_missing", path: ["x"] }] });
  });

  it("a padded SAC is trimmed: it passes, and the HSN table holds the trimmed value", () => {
    const r = bad(" 998314\t");
    expect(r.ok && r.value.hsnB2b.map((h) => h.sac)).toEqual(["998314"]);
    expect(r.ok && r.value.hsnB2b[0]?.description).toBe("IT support services");
  });

  it("a padded and a clean SAC of one document land in one HSN row", () => {
    const rows = [
      row({ id: "x", rates: [rate("998314", 1800, 1000, "intra"), rate(" 998314 ", 1800, 500, "intra")] }),
    ];
    const r = gstr1Sections(rows, Q3, PARAMS);
    expect(r.ok && r.value.hsnB2b.length).toBe(1);
    expect(r.ok && r.value.hsnB2b[0]?.taxableMinor).toBe(1500);
  });
});

describe("one shared dates helper (re-check 7)", () => {
  const inv = row({
    id: "e1",
    number: "EXP-1",
    kind: "export_invoice",
    supply: "export_lut",
    date: d(2026, 9, 30),
    country: "US",
    usd: { totalMinor: 100_000, fxMicros: 83_500_000 },
    rates: [rate("998314", 0, 8_350_000, "export_lut")],
  });
  const input = { invoiceDate: inv.issueDate, currency: "USD" as const, supplyType: "export_lut" as const };

  it("the EDF and the realisation report give the same warning, with the document's path", () => {
    const edf = edfRows([inv], 2026, 9);
    const report = realisationRows([inv], d(2026, 12, 1));
    expect(edf.ok && edf.warnings).toEqual([{ code: "before_fema_2026", path: ["e1"] }]);
    expect(report.ok && report.warnings).toEqual(edf.ok ? edf.warnings : []);
    expect(realisationDates(input).ok && realisationDates(input)).toMatchObject({
      warnings: [{ code: "before_fema_2026", path: [] }],
    });
    const shared = checkedDueDates(input, DEFAULT_REALISATION_RULES, ["e1"]);
    expect(shared.ok && shared.warnings).toEqual([{ code: "before_fema_2026", path: ["e1"] }]);
  });

  it("the same input check: an invalid extension date is date_invalid at [id, extension] in both reports", () => {
    const extensions = { e1: { femaDue: d(2027, 2, 30) } };
    const edf = edfRows([inv], 2026, 9, { extensions });
    const report = realisationRows([inv], d(2026, 12, 1), undefined, extensions);
    const expected = { ok: false, errors: [{ code: "date_invalid", path: ["e1", "extension"] }] };
    expect(edf).toEqual(expected);
    expect(report).toEqual(expected);
  });

  it("invalid rules are rules_invalid through the helper too", () => {
    const rules: RealisationRules = { ...DEFAULT_REALISATION_RULES, femaMonthsInr: 0 };
    expect(checkedDueDates(input, rules, ["e1"])).toEqual({
      ok: false,
      errors: [{ code: "rules_invalid", path: ["e1", "rules"] }],
    });
  });
});

describe("Q53: the GST stages (Rule 96A) apply to an export under LUT only", () => {
  // A USD invoice of 3 November 2026: FEMA due 3 August 2027, GST due 18 November 2027.
  const base = { invoiceDate: d(2026, 11, 3), currency: "USD" as const, outstandingMinor: 1 };
  const stage = (supplyType: "export_lut" | "export_igst", today: ReturnType<typeof d>) => {
    const r = realisationStatus({ ...base, supplyType }, today);
    if (!r.ok) throw new Error("status");
    return r.value.stage;
  };

  it("an export under LUT goes on to the GST stages after FEMA overdue", () => {
    expect(stage("export_lut", d(2027, 10, 19))).toBe("gst_approaching");
    expect(stage("export_lut", d(2027, 11, 19))).toBe("gst_overdue");
  });

  it("an export with IGST paid stays at FEMA overdue, whatever the date", () => {
    expect(stage("export_igst", d(2027, 7, 4))).toBe("fema_approaching");
    expect(stage("export_igst", d(2027, 8, 3))).toBe("fema_approaching");
    expect(stage("export_igst", d(2027, 8, 4))).toBe("fema_overdue");
    expect(stage("export_igst", d(2027, 10, 19))).toBe("fema_overdue");
    expect(stage("export_igst", d(2027, 11, 19))).toBe("fema_overdue");
    expect(stage("export_igst", d(2030, 1, 1))).toBe("fema_overdue");
  });

  it("realised is realised in both routes", () => {
    for (const supplyType of ["export_lut", "export_igst"] as const) {
      const r = realisationStatus({ ...base, supplyType, outstandingMinor: 0 }, d(2030, 1, 1));
      expect(r.ok && r.value.stage).toBe("realised");
    }
  });

  it("gstDue is still returned for an IGST export (it is in the CSV)", () => {
    const r = realisationDates({ ...base, supplyType: "export_igst" });
    expect(r.ok && r.value).toEqual({ femaDue: d(2027, 8, 3), gstDue: d(2027, 11, 18) });
  });

  it("stageOf takes the flag directly", () => {
    const dates = { femaDue: d(2027, 8, 3), gstDue: d(2027, 11, 18) };
    expect(stageOf(dates, 1, d(2027, 11, 19), 30)).toBe("gst_overdue");
    expect(stageOf(dates, 1, d(2027, 11, 19), 30, false)).toBe("fema_overdue");
  });

  it("realisationRows follows the row's supply type, one test per route", () => {
    const lut = row({
      id: "l",
      kind: "export_invoice",
      supply: "export_lut",
      date: d(2026, 11, 3),
      usd: { totalMinor: 100_000, fxMicros: 83_500_000 },
      rates: [rate("998314", 0, 8_350_000, "export_lut")],
    });
    const igst = row({
      id: "g",
      number: "G",
      kind: "export_invoice",
      supply: "export_igst",
      date: d(2026, 11, 3),
      usd: { totalMinor: 100_000, fxMicros: 83_500_000 },
      rates: [rate("998314", 1800, 8_350_000, "export_igst")],
    });
    const r = realisationRows([lut, igst], d(2027, 11, 19));
    expect(r.ok && r.value.map((x) => [x.id, x.stage, x.gstDue])).toEqual([
      ["g", "fema_overdue", d(2027, 11, 18)],
      ["l", "gst_overdue", d(2027, 11, 18)],
    ]);
  });
});
