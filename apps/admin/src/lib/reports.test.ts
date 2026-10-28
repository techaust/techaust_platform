// M5.5b admin words and rules (lib/reports.ts, lib/reports-build.ts, lib/tax-settings.ts, lib/bell-links.ts): the marks on 07-V lines, one message per
// GST error code, the periods, the urgency order and the stage pills, the statement's words, the tax form's round trip (early check H2), and the files
// the screens make from register rows through the gst core (the sums are core's; these tests only check that the screens pass them on whole).
import type { RegisterApiRow, ReportMeta } from "@techaust/core/gst";
import { realisationParamsFromStoredTax } from "@techaust/core/invoices";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import { ACTION_LABELS } from "./audit.ts";
import { reportBellHref } from "./bell-links.ts";
import { COPY_GAP } from "./copy-gap.ts";
import {
  byUrgency,
  FINANCE_COPY,
  fileDownloadText,
  GST_COPY,
  GST_ERRORS,
  gstErrorText,
  issueLines,
  lastCompleteQuarter,
  nearestScrollLeft,
  periodDates,
  periodFromValue,
  periodLabel,
  periodOpen,
  periodOptions,
  periodValue,
  previousMonth,
  REALISATION_COPY,
  rangeOk,
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_PILLS,
  STATEMENT_COPY,
  sectionNameOf,
  statementCsvLabels,
  statementDetailsText,
  statementErrorText,
  statementKindText,
  stateText,
  TAX_FIELDS_COPY,
} from "./reports.ts";
import { dispositionName } from "./reports-api.ts";
import {
  buildEdf,
  buildGstExport,
  buildRealisation,
  buildSalesRegister,
  rulesOfMeta,
  statementCsvText,
  wholePeriodOf,
  zipOf,
} from "./reports-build.ts";
import { buildTax, REALISATION_ERRORS, taxToForm } from "./tax-settings.ts";

/** 07-V was approved on 2026-10-28 (research and wording): its lines carry no mark; only a line 07-V lacks does (`G`). */
const M = "";
const G = `${COPY_GAP} `;

describe("07-V is approved word for word", () => {
  it("no 07-V line carries the mark; a line 07-V lacks still does", () => {
    expect(GST_COPY.overall).toBe(`${G}Overall`);
    for (const line of [
      GST_COPY.title,
      GST_COPY.make,
      GST_COPY.downloadAll,
      STATEMENT_COPY.makePdf,
      FINANCE_COPY.collectedArrives,
      TAX_FIELDS_COPY.b2clLabel,
      STAGE_LABELS.fema_overdue,
    ])
      expect(line.includes("[Placeholder")).toBe(false);
  });

  it("the two audit labels (07-V §1), unmarked (07-V §11)", () => {
    expect(ACTION_LABELS["report.export"]).toBe("exported a report");
    expect(ACTION_LABELS["client.statement_pdf"]).toBe("made a statement PDF");
  });

  it("the lines changed on 2026-10-28 (07-V §11, 08-C RB-01 to RB-04, RA-20)", () => {
    expect(STAGE_LABELS.gst_approaching).toBe("GST date in 30 days");
    expect(GST_COPY.verify("gstr1-csv-v1")).toBe(
      "Made with layout gstr1-csv-v1 for the GSTR-1 offline tool. Layouts change; before your first upload, test-import one file with your CA.",
    );
    expect(REALISATION_COPY.lede).toBe(
      "Export invoices not yet fully paid, most urgent first. Money from an export must reach India within the FEMA period: 9 months from the invoice date, or 12 if it was invoiced or settled in Indian Rupees.",
    );
    expect(REALISATION_COPY.beforeFema).toBe(
      "Issued before 1 October 2026: a different realisation period may apply.",
    );
    expect(REALISATION_COPY.extensionNote).toBe(
      "If your bank extended a date, you can record it with the proof of payment in the payments update.",
    );
    expect(TAX_FIELDS_COPY.inrMonthsHint).toBe(
      "Months within which payment must arrive for an export invoiced or settled in Indian Rupees. Default 12. A foreign-currency invoice has 9 months; ask your bank before treating one as settled in rupees.",
    );
    expect(TAX_FIELDS_COPY.b2clHint).toBe(
      "Invoices to unregistered clients in another state above this amount are reported one by one (B2CL). Default ₹1,00,000.",
    );
  });

  it("07-V §2 words with their figures", () => {
    expect(GST_COPY.reading(50)).toBe(`${M}Reading issued documents: 50 so far`);
    expect(GST_COPY.checking(120)).toBe(`${M}Checking 120 documents`);
    expect(GST_COPY.done(7)).toBe(`${M}7 documents checked. No errors.`);
    expect(GST_COPY.errorsHeading(3)).toBe(`${M}3 problems to fix before these files can be made`);
    expect(GST_COPY.download("Exports")).toBe(`${M}Download Exports CSV`);
    // review 6: singular forms follow their plural line; the two HSN rows are not in 07-V (marked)
    expect(GST_COPY.done(1)).toBe("1 document checked. No errors.");
    expect(GST_COPY.errorsHeading(1)).toBe("1 problem to fix before these files can be made");
    expect(fileDownloadText("hsn_b2b", "x")).toBe(`${G}Download HSN/SAC summary (B2B) CSV`);
    expect(fileDownloadText("hsn_b2c", "x")).toBe(`${G}Download HSN/SAC summary (B2C) CSV`);
    expect(fileDownloadText("docs", "x")).toBe(`${M}Download Documents issued (Table 13) CSV`);
    expect(fileDownloadText("exp", "Exports")).toBe(`${M}Download Exports CSV`);
    expect(REALISATION_COPY.emptyAll).toBe(`${G}No export invoices in this list.`);
    expect(GST_COPY.verify("gstr1-csv-v1")).toContain(
      "Made with layout gstr1-csv-v1 for the GSTR-1 offline tool.",
    );
    expect(sectionNameOf("b2cl", "₹1,00,000.00")).toBe(
      `${M}B2CL (unregistered, inter-state, above ₹1,00,000.00)`,
    );
    expect(sectionNameOf("hsn_b2b", "")).toBe(sectionNameOf("hsn_b2c", ""));
    expect(sectionNameOf("docs", "")).toBe(`${M}Documents issued (Table 13)`);
    expect(sectionNameOf("unknown", "")).toBe("unknown");
  });
});

describe("GST errors and problems", () => {
  it("has one 07-V message for each of the 28 codes; an unknown code reads as the internal error", () => {
    expect(Object.keys(GST_ERRORS)).toHaveLength(28);
    for (const m of Object.values(GST_ERRORS)) expect(m.includes("[Placeholder")).toBe(false);
    expect(gstErrorText("sac_invalid")).toBe(`${M}A line's SAC code is not six digits.`);
    expect(gstErrorText("nope")).toBe(GST_ERRORS.internal_error);
  });

  it("names the document of each problem (path[0]), once per code and document; a path without a document has no link", () => {
    const docs = new Map([["d1", { id: "d1", number: "TH/INV/2627/0001", kind: "tax_invoice" }]]);
    const lines = issueLines(
      [
        { code: "gstin_missing", path: ["d1"] },
        { code: "gstin_missing", path: ["d1", "recipient"] },
        { code: "sac_missing", path: ["d1", "rates", 0] },
        { code: "params_invalid", path: ["params", "supplierStateCode"] },
      ],
      docs,
    );
    expect(lines.map((l) => [l.doc?.number ?? null, l.message])).toEqual([
      ["TH/INV/2627/0001", GST_ERRORS.gstin_missing],
      ["TH/INV/2627/0001", GST_ERRORS.sac_missing],
      [null, GST_ERRORS.params_invalid],
    ]);
  });

  it("states in words, 96 as itself", () => {
    expect(stateText("19")).toBe("West Bengal (19)");
    expect(stateText("96")).toBe("96");
    expect(stateText(null)).toBe("");
  });
});

describe("periods", () => {
  it("defaults to the last complete quarter of the financial year (Q1 = April to June)", () => {
    expect(lastCompleteQuarter({ year: 2026, month: 10, day: 28 })).toEqual({
      kind: "quarter",
      fyStartYear: 2026,
      quarter: 2,
    });
    expect(lastCompleteQuarter({ year: 2026, month: 4, day: 1 })).toEqual({
      kind: "quarter",
      fyStartYear: 2025,
      quarter: 4,
    });
    expect(lastCompleteQuarter({ year: 2027, month: 2, day: 10 })).toEqual({
      kind: "quarter",
      fyStartYear: 2026,
      quarter: 3,
    });
  });

  it("works out a period's days, words and whether it has ended", () => {
    const q4 = { kind: "quarter", fyStartYear: 2026, quarter: 4 } as const;
    expect(periodDates(q4)).toEqual({
      from: { year: 2027, month: 1, day: 1 },
      to: { year: 2027, month: 3, day: 31 },
    });
    expect(periodLabel(q4)).toBe("January to March 2027");
    expect(periodDates({ kind: "month", year: 2028, month: 2 }).to.day).toBe(29);
    expect(periodOpen({ kind: "month", year: 2026, month: 10 }, { year: 2026, month: 10, day: 28 })).toBe(
      true,
    );
    expect(periodOpen({ kind: "month", year: 2026, month: 9 }, { year: 2026, month: 10, day: 1 })).toBe(
      false,
    );
    expect(previousMonth({ year: 2027, month: 1, day: 5 })).toEqual({ year: 2026, month: 12 });
  });

  it("offers this and last financial year's quarters that have begun, and round-trips a choice", () => {
    const today = { year: 2026, month: 10, day: 28 };
    const qs = periodOptions(today, "quarter");
    expect(qs.map(periodValue)).toEqual([
      "q:2026:3",
      "q:2026:2",
      "q:2026:1",
      "q:2025:4",
      "q:2025:3",
      "q:2025:2",
      "q:2025:1",
    ]);
    for (const p of [...qs, ...periodOptions(today, "month")])
      expect(periodFromValue(periodValue(p))).toEqual(p);
    expect(periodFromValue("q:2026:5")).toBeNull();
    expect(periodFromValue("x")).toBeNull();
  });

  it("a register range lies inside one financial year (07-V period_invalid)", () => {
    expect(rangeOk("2026-04-01", "2027-03-31")).toBe(true);
    expect(rangeOk("2026-03-31", "2026-04-01")).toBe(false);
    expect(rangeOk("2026-10-02", "2026-10-01")).toBe(false);
    expect(rangeOk("bad", "2026-10-01")).toBe(false);
  });

  it("a whole month or quarter is a return period; anything else isn't", () => {
    expect(wholePeriodOf("2026-07-01", "2026-09-30")).toEqual({
      kind: "quarter",
      fyStartYear: 2026,
      quarter: 2,
    });
    expect(wholePeriodOf("2027-01-01", "2027-03-31")).toEqual({
      kind: "quarter",
      fyStartYear: 2026,
      quarter: 4,
    });
    expect(wholePeriodOf("2026-10-01", "2026-10-31")).toEqual({ kind: "month", year: 2026, month: 10 });
    expect(wholePeriodOf("2026-10-02", "2026-10-31")).toBeNull();
    expect(wholePeriodOf("2026-08-01", "2026-10-31")).toBeNull();
  });
});

describe("realisation stages", () => {
  it("every stage has a 07-V label and a reserved status pill with an icon; overdue is danger, approaching warning", () => {
    for (const s of STAGE_ORDER) {
      expect(STAGE_LABELS[s].startsWith(M)).toBe(true);
      expect(STAGE_PILLS[s].icon).toBeTruthy();
    }
    expect(STAGE_PILLS.fema_overdue.tone).toBe("danger");
    expect(STAGE_PILLS.gst_overdue.tone).toBe("danger");
    expect(STAGE_PILLS.fema_approaching.tone).toBe("warning");
    expect(STAGE_PILLS.realised.tone).toBe("muted");
  });

  it("lists the most urgent first, then by the date each is due by", () => {
    const d = (day: number) => ({ year: 2027, month: 1, day });
    const rows = [
      { number: "E1", stage: "ok" as const, femaDue: d(1), gstDue: d(20) },
      { number: "E2", stage: "fema_overdue" as const, femaDue: d(9), gstDue: d(20) },
      { number: "E3", stage: "gst_overdue" as const, femaDue: d(1), gstDue: d(15) },
      { number: "E4", stage: "fema_overdue" as const, femaDue: d(5), gstDue: d(20) },
      { number: "E5", stage: "realised" as const, femaDue: d(1), gstDue: d(2) },
    ];
    expect(byUrgency(rows).map((r) => r.number)).toEqual(["E3", "E4", "E2", "E1", "E5"]);
  });
});

describe("statement words", () => {
  it("names each kind; a credit note names its invoice when the number is known, else the plain mark", () => {
    expect(statementKindText("tax_invoice")).toBe(`${M}Invoice`);
    expect(statementKindText("receipt")).toBe(`${M}Payment received`);
    expect(statementKindText("credit_note", "TH/INV/2627/0003")).toBe(
      `${M}Credit note against TH/INV/2627/0003`,
    );
    expect(statementKindText("credit_note")).toBe(`${M}Credit note`);
    expect(Object.keys(statementCsvLabels().kinds)).toHaveLength(5);
  });

  it("the Details cell of a credit note names the invoice the API sent (review 2)", () => {
    expect(statementDetailsText({ kind: "credit_note", againstNumber: "TH/INV/2627/0003" })).toBe(
      `${M}Credit note against TH/INV/2627/0003`,
    );
    expect(statementDetailsText({ kind: "credit_note", againstNumber: null })).toBe(`${M}Credit note`);
    expect(statementDetailsText({ kind: "debit_note" })).toBe(`${M}Debit note`);
  });

  it("says each refusal in 07-V's words, and keeps the server's sentence for any other", () => {
    expect(statementErrorText(new RequestError(409, "statement_too_long", "x"))).toBe(
      `${M}This range has more than 200 entries. Pick a shorter range for the PDF.`,
    );
    expect(statementErrorText(new RequestError(409, "client_anonymised", "x"))).toContain("erased");
    expect(statementErrorText(new RequestError(500, "other", "Server words"))).toBe("Server words");
  });

  it("builds the statement-v1 CSV with 07-V's words through core", () => {
    const csv = statementCsvText({
      from: "2026-04-01",
      to: "2026-10-28",
      openingMinor: 0,
      closingMinor: 1_18_000_00,
      entries: [
        {
          id: "d1",
          kind: "tax_invoice",
          date: "2026-05-02",
          number: "TH/INV/2627/0001",
          amountMinor: 1_18_000_00,
          debitMinor: 1_18_000_00,
          creditMinor: 0,
          balanceMinor: 1_18_000_00,
        },
      ],
    });
    expect(csv).not.toBeNull();
    const lines = (csv as string).trim().split(/\r?\n/);
    expect(lines[0]).toBe("Date,Document,Details,Debit,Credit,Balance");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(`${M}Opening balance`);
    expect(lines[2]).toContain("TH/INV/2627/0001");
    expect(lines[3]).toContain(`${M}Closing balance`);
  });

  it("names a credit note's invoice in the CSV; the plain mark when a note lacks it (review 2)", () => {
    const entry = (againstNumber: string | null) => ({
      id: "n1",
      kind: "credit_note" as const,
      date: "2026-06-03",
      number: "TH/CN/2627/0001",
      againstNumber,
      amountMinor: -18_000_00,
      debitMinor: 0,
      creditMinor: 18_000_00,
      balanceMinor: -18_000_00,
    });
    const csvOf = (againstNumber: string | null) =>
      (
        statementCsvText({
          from: "2026-04-01",
          to: "2026-10-28",
          openingMinor: 0,
          closingMinor: -18_000_00,
          entries: [entry(againstNumber)],
        }) as string
      )
        .trim()
        .split(/\r?\n/)[2];
    expect(csvOf("TH/INV/2627/0003")).toContain(`${M}Credit note against TH/INV/2627/0003`);
    expect(csvOf(null)).toContain(`${M}Credit note`);
    expect(csvOf(null)).not.toContain("against");
  });

  it("reads the file name the server gave the PDF", () => {
    expect(dispositionName('attachment; filename="statement-C001.pdf"', "x.pdf")).toBe("statement-C001.pdf");
    expect(dispositionName("attachment; filename*=UTF-8''statement%20A.pdf", "x.pdf")).toBe(
      "statement A.pdf",
    );
    expect(dispositionName(null, "x.pdf")).toBe("x.pdf");
  });
});

describe("bells", () => {
  it("an export stage lands on the realisation list with its invoice marked; anything else keeps its link", () => {
    expect(reportBellHref("export.fema_overdue", "/invoices/d1")).toBe("/reports/realisation?doc=d1");
    expect(reportBellHref("edf.due", "/reports/edf?month=2026-10")).toBe("/reports/edf?month=2026-10");
    expect(reportBellHref("statement.ready", "/clients/c1?tab=statement&pdf=s1")).toBe(
      "/clients/c1?tab=statement&pdf=s1",
    );
  });
});

describe("Settings › Tax round trip (early check H2)", () => {
  const stored = {
    ...SETTINGS_DEFAULTS.tax,
    b2clThresholdInrMinor: 2_00_000_00,
    realisation: { ...SETTINGS_DEFAULTS.tax.realisation, inrMonths: 18 },
  };

  it("a save of other fields keeps the stored B2CL threshold and INR realisation period", () => {
    const form = { ...taxToForm(stored), reverseChargeText: "Changed line" };
    const built = buildTax(form, { value: stored });
    expect("value" in built).toBe(true);
    if (!("value" in built)) return;
    expect(built.value.b2clThresholdInrMinor).toBe(2_00_000_00);
    expect(built.value.realisation.inrMonths).toBe(18);
    expect(built.value.reverseChargeText).toBe("Changed line");
  });

  it("the two fields save what was typed, and refuse zero or out-of-range values in 07-V's words", () => {
    const ok = buildTax({ ...taxToForm(stored), b2cl: "2,50,000", inrMonths: "24" }, { value: stored });
    expect("value" in ok && ok.value.b2clThresholdInrMinor).toBe(2_50_000_00);
    expect("value" in ok && ok.value.realisation.inrMonths).toBe(24);
    const bad = buildTax({ ...taxToForm(stored), b2cl: "0", inrMonths: "121" }, { value: stored });
    expect("errors" in bad && bad.errors["f-b2clThresholdInrMinor"]).toBe(TAX_FIELDS_COPY.b2clError);
    expect("errors" in bad && bad.errors["f-realisation-inrMonths"]).toBe(TAX_FIELDS_COPY.inrMonthsError);
  });

  it("bounds the realisation periods as the reports read them, so a save never stops the reports (review 4)", () => {
    const save = (over: Partial<ReturnType<typeof taxToForm>>) =>
      buildTax({ ...taxToForm(stored), ...over }, { value: stored });
    const top = save({
      warnMonths: "1200",
      escalateMonths: "1200",
      escalateExtraDays: "36500",
      inrMonths: "120",
    });
    expect("value" in top).toBe(true);
    if ("value" in top) expect(realisationParamsFromStoredTax(top.value).ok).toBe(true);
    const low = save({ warnMonths: "1", escalateMonths: "1", escalateExtraDays: "0", inrMonths: "1" });
    expect("value" in low && realisationParamsFromStoredTax(low.value).ok).toBe(true);
    const over = save({ warnMonths: "1201", escalateMonths: "1300", escalateExtraDays: "36501" });
    expect("errors" in over && over.errors).toMatchObject({
      "f-realisation-warnMonths": REALISATION_ERRORS.warnMonths,
      "f-realisation-escalateMonths": REALISATION_ERRORS.escalateMonths,
      "f-realisation-escalateExtraDays": REALISATION_ERRORS.escalateExtraDays,
    });
    const under = save({ warnMonths: "0", escalateMonths: "0", escalateExtraDays: "-1" });
    expect("errors" in under && Object.keys(under.errors)).toEqual(
      expect.arrayContaining([
        "f-realisation-warnMonths",
        "f-realisation-escalateMonths",
        "f-realisation-escalateExtraDays",
      ]),
    );
    expect(REALISATION_ERRORS.warnMonths).toBe(`${G}Enter the months before the warning, from 1 to 1,200.`);
  });
});

// ---- the files, through the gst core -----------------------------------------------------------------------------------------------------------

const meta: ReportMeta = {
  today: { year: 2026, month: 10, day: 28 },
  supplierStateCode: "19",
  b2clThresholdInrMinor: 1_00_000_00,
  realisation: { warnMonths: 9, inrMonths: 12, escalateMonths: 12, escalateExtraDays: 15 },
};

const row = (over: Partial<RegisterApiRow> & Pick<RegisterApiRow, "id" | "number">): RegisterApiRow => ({
  kind: "tax_invoice",
  voided: false,
  issueDate: { year: 2026, month: 8, day: 10 },
  currency: "INR",
  totalMinor: 11_800_00,
  totalInrMinor: 11_800_00,
  roundOffInrMinor: 0,
  fxRateMicros: null,
  supplyType: "intra",
  placeOfSupplyCode: "19",
  reverseCharge: false,
  recipient: {
    status: "registered",
    gstin: "19ABCDE1234F1ZX",
    name: "Sample client A (fake)",
    address: "1 Sample Road, Kolkata",
    stateCode: "19",
    countryCode: "IN",
  },
  rates: [
    {
      sac: "998314",
      rateBp: 1800,
      taxableMinor: 10_000_00,
      igstMinor: 0,
      cgstMinor: 900_00,
      sgstMinor: 900_00,
    },
  ],
  noteOf: null,
  outstandingMinor: 11_800_00,
  purposeCode: null,
  series: "invoice",
  fy: "2627",
  seq: 1,
  clientId: "c1",
  clientCode: "C001",
  ...over,
});

describe("files from register rows (core does every sum)", () => {
  const q2 = { kind: "quarter", fyStartYear: 2026, quarter: 2 } as const;

  it("a clean period gives GSTR-1, Table 13 and the 3B files, and a ZIP of them", () => {
    const r = buildGstExport([row({ id: "d1", number: "TH/INV/2627/0001" })], meta, q2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.checked).toBe(1);
    expect(r.hsnOk).toBe(true);
    expect(r.totals.b2b.documents).toBe(1);
    expect(r.files.map((f) => f.name)).toContain("b2b.csv");
    expect(r.files.at(-1)?.name).toBe("gstr3b_summary.csv");
    expect(r.table13).toHaveLength(1);
    const zip = zipOf(r.files);
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("a bad document stops every file and names the document", () => {
    const bad = row({
      id: "d2",
      number: "TH/INV/2627/0002",
      recipient: { ...row({ id: "x", number: "x" }).recipient, gstin: null },
    });
    const r = buildGstExport([bad], meta, q2);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems[0]?.doc?.number).toBe("TH/INV/2627/0002");
  });

  it("the sales register offers the 3B file only for a whole return period", () => {
    const rows = [row({ id: "d1", number: "TH/INV/2627/0001" })];
    const whole = buildSalesRegister(rows, meta, "2026-07-01", "2026-09-30");
    const part = buildSalesRegister(rows, meta, "2026-07-01", "2026-09-15");
    expect(whole.ok && whole.files.gstr3b !== null).toBe(true);
    expect(part.ok && part.files.gstr3b === null).toBe(true);
    expect(whole.ok && whole.outputTax.length).toBe(1);
  });

  it("realisation uses the stored INR period, which core's mapping leaves out (LD77)", () => {
    expect(rulesOfMeta({ ...meta, realisation: { ...meta.realisation, inrMonths: 18 } })?.femaMonthsInr).toBe(
      18,
    );
    const exp = row({
      id: "e1",
      number: "TH/EXP/2627/0001",
      kind: "export_invoice",
      series: "export",
      currency: "USD",
      totalMinor: 1_000_00,
      totalInrMinor: 83_500_00,
      fxRateMicros: 83_500_000,
      supplyType: "export_lut",
      placeOfSupplyCode: "96",
      issueDate: { year: 2026, month: 1, day: 10 },
      recipient: {
        status: "overseas",
        gstin: null,
        name: "Sample client B (fake)",
        address: null,
        stateCode: null,
        countryCode: "US",
      },
      rates: [
        { sac: "998314", rateBp: 0, taxableMinor: 83_500_00, igstMinor: 0, cgstMinor: 0, sgstMinor: 0 },
      ],
      outstandingMinor: 1_000_00,
    });
    const r = buildRealisation([exp], meta);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0]?.stage).toBe("fema_overdue");
    expect(r.rows[0]?.beforeFema).toBe(true);
    const edf = buildEdf([exp], meta, 2026, 1);
    expect(edf.ok && edf.rows.length).toBe(1);
  });
});

describe("the report index on a narrow screen (review 7)", () => {
  it("scrolls the row just enough to show the open report, and leaves it when it already shows", () => {
    expect(nearestScrollLeft(0, 300, 100, 120)).toBe(0);
    expect(nearestScrollLeft(0, 300, 420, 160)).toBe(280);
    expect(nearestScrollLeft(280, 300, 10, 120)).toBe(10);
    expect(nearestScrollLeft(50, 300, -5, 120)).toBe(0);
  });
});
