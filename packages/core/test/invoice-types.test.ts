// M5.2: the export invoice, the proforma, the mandatory-field checklist, the exchange rate and the LUT (ADM-INV-06, -08, -10, -18; G-6, G-8, G-9, U-1).
// VERIFY WITH CA/LEGAL: every rule under test is a researched default. The two endorsement lines and the proforma notice are held here as LITERALS,
// not imported, so a change of the constant (the statutory text) fails a test until a person has looked at it.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { contentHash, contentHashInput, type DraftContent } from "../src/documents.ts";
import {
  CHECKLIST_SWITCHABLE,
  type ChecklistSettings,
  type ChecklistType,
  checklistItemOn,
  DEFAULT_CHECKLIST,
  EXPORT_ENDORSEMENT,
  exportModeFromStoredTax,
  formatFxRate,
  fxDateOk,
  fxSourceLabel,
  INVOICE_CHECKLIST,
  ISSUE_BLOCKER_CODES,
  type IssueBlockerCode,
  type IssueFacts,
  invoiceSnapshotSha256,
  isLutCheckKind,
  isLutCheckMessage,
  issueBlockers,
  LUT_CHECK_KIND,
  lutBellFor,
  lutCheckMessage,
  lutFor,
  lutReminder,
  lutsFromStoredTax,
  normaliseReference,
  PROFORMA_NOTICE,
  PURPOSE_CODE,
  parseFxRate,
  proformaWarnAt,
  proformaWarnDate,
  voidBlockers,
  weekMondayOf,
} from "../src/invoices.ts";
import {
  foldLegacyLut,
  legacyLutFate,
  resolveSetting,
  SETTINGS_DEFAULTS,
  SETTINGS_SCHEMAS,
} from "../src/schemas/settings.ts";
import { lutsOf } from "../src/tax/supply.ts";

// ---- the exchange rate --------------------------------------------------------------------------------------------------------------------

describe("parseFxRate [ADM-INV-08; Q7]", () => {
  it("reads a decimal string into whole micros, digit by digit", () => {
    expect(parseFxRate("83.1234")).toBe(83_123_400);
    expect(parseFxRate("83")).toBe(83_000_000);
    expect(parseFxRate("83.5")).toBe(83_500_000);
    expect(parseFxRate("0.0001")).toBe(100);
    expect(parseFxRate("1000")).toBe(1_000_000_000);
    expect(parseFxRate("0083.10")).toBe(83_100_000);
  });
  it("refuses everything else: five decimals, zero, a negative, an exponent, a separator, spaces, nothing", () => {
    for (const bad of [
      "83.12345",
      "0",
      "0.0000",
      "-1",
      "+83",
      "1e3",
      "83,12",
      "83.",
      ".5",
      " 83",
      "83 ",
      "",
      "abc",
      "1000.0001",
      "10000",
      "NaN",
      "Infinity",
    ])
      expect(parseFxRate(bad), JSON.stringify(bad)).toBeNull();
  });
  it("round-trips through formatFxRate with four decimals (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), (tenThousandths) => {
        const micros = tenThousandths * 100;
        const text = formatFxRate(micros);
        expect(text).toMatch(/^\d+\.\d{4}$/);
        expect(parseFxRate(text)).toBe(micros);
      }),
    );
    expect(formatFxRate(83_123_400)).toBe("83.1234");
    expect(formatFxRate(83_000_000)).toBe("83.0000");
  });
  it("never returns a non-integer or an unsafe number (property over any text)", () => {
    fc.assert(
      fc.property(fc.string(), (t) => {
        const v = parseFxRate(t);
        expect(v === null || (Number.isSafeInteger(v) && v >= 1 && v <= 1_000_000_000)).toBe(true);
      }),
    );
  });
});

describe("fxDateOk [Q24]", () => {
  it("the issue day and up to the maximum age before it; never the future", () => {
    expect(fxDateOk("2026-10-28", "2026-10-28", 4)).toBe(true);
    expect(fxDateOk("2026-10-24", "2026-10-28", 4)).toBe(true);
    expect(fxDateOk("2026-10-23", "2026-10-28", 4)).toBe(false);
    expect(fxDateOk("2026-10-29", "2026-10-28", 4)).toBe(false);
    expect(fxDateOk("2026-10-28", "2026-10-28", 0)).toBe(true);
    expect(fxDateOk("2026-10-27", "2026-10-28", 0)).toBe(false);
  });
  it("counts across a month and a year end, and refuses dates that are not dates", () => {
    expect(fxDateOk("2026-12-29", "2027-01-02", 4)).toBe(true);
    expect(fxDateOk("2026-12-28", "2027-01-02", 4)).toBe(false);
    expect(fxDateOk("2026-13-01", "2026-12-01", 4)).toBe(false);
    expect(fxDateOk("26-10-28", "2026-10-28", 4)).toBe(false);
    expect(fxDateOk("2026-10-28", "2026-10-28", -1)).toBe(false);
    expect(fxDateOk("2026-10-28", "2026-10-28", 1.5)).toBe(false);
  });
});

describe("fxSourceLabel", () => {
  it("the two fixed labels, and the person's own words (1 to 60 characters, trimmed) for Other", () => {
    expect(fxSourceLabel("FBIL", null)).toBe("FBIL reference rate");
    expect(fxSourceLabel("RBI", "ignored")).toBe("RBI reference rate");
    expect(fxSourceLabel("OTHER", "  Bank rate of the day ")).toBe("Bank rate of the day");
    expect(fxSourceLabel("OTHER", "")).toBeNull();
    expect(fxSourceLabel("OTHER", "   ")).toBeNull();
    expect(fxSourceLabel("OTHER", null)).toBeNull();
    expect(fxSourceLabel("OTHER", "x".repeat(60))).toBe("x".repeat(60));
    expect(fxSourceLabel("OTHER", "x".repeat(61))).toBeNull();
  });
});

// ---- the statutory words ------------------------------------------------------------------------------------------------------------------

describe("the export endorsement and the proforma notice [Rule 46; 07-S §1, §2; LD33]", () => {
  it("are exactly the words of the rule (literals here, VERIFY WITH CA/LEGAL)", () => {
    expect(EXPORT_ENDORSEMENT.lut).toBe(
      "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX",
    );
    expect(EXPORT_ENDORSEMENT.igst_paid).toBe(
      "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS ON PAYMENT OF INTEGRATED TAX",
    );
    expect(PROFORMA_NOTICE).toBe(
      "This is not a tax invoice. A tax invoice will be issued when payment is received.",
    );
  });
});

// ---- letters of undertaking ---------------------------------------------------------------------------------------------------------------

describe("lutFor and lutReminder [ADM-INV-18; Q22]", () => {
  const luts = [
    { fy: "2526", arn: "AD0000000000001" },
    { fy: "2627", arn: "AD0000000000002", filedOn: "2026-03-20" },
  ];
  it("finds the letter of one FY; a blank ARN is no letter", () => {
    expect(lutFor("2627", luts)).toEqual({ fy: "2627", arn: "AD0000000000002" });
    expect(lutFor("2728", luts)).toBeNull();
    expect(lutFor("2627", [{ fy: "2627", arn: "  " }])).toBeNull();
    expect(lutFor("2627", [])).toBeNull();
  });
  it("due from 1 to 31 March while the next FY has no letter; not in February or April", () => {
    expect(lutReminder("2027-02-28", luts)?.due).toBe(false);
    expect(lutReminder("2027-03-01", luts)).toMatchObject({
      due: true,
      nextFy: "2728",
      nextFyLabel: "2027-28",
      currentFy: "2627",
      currentFyLabel: "2026-27",
      currentMissing: false,
    });
    expect(lutReminder("2027-03-31", luts)?.due).toBe(true);
    expect(lutReminder("2027-04-01", luts)?.due).toBe(false);
  });
  it("not due once the next FY's letter is saved", () => {
    expect(lutReminder("2027-03-15", [...luts, { fy: "2728", arn: "AD0000000000003" }])?.due).toBe(false);
  });
  it("the running FY without a letter is flagged from 1 April, whatever the day", () => {
    expect(lutReminder("2027-04-01", luts)?.currentMissing).toBe(true);
    expect(lutReminder("2027-04-01", luts)?.currentFy).toBe("2728");
    expect(lutReminder("2027-09-30", luts)?.currentMissing).toBe(true);
    expect(lutReminder("2027-04-01", [...luts, { fy: "2728", arn: "A" }])?.currentMissing).toBe(false);
    // 31 March is still the old FY, so 2627 (saved) is present and 2728 is the next
    expect(lutReminder("2027-03-31", luts)?.currentMissing).toBe(false);
  });
  it("an unreadable date gives nothing", () => {
    expect(lutReminder("not a date", luts)).toBeNull();
    expect(lutReminder("2027-02-30", luts)).toBeNull();
  });
});

describe("exportModeFromStoredTax and the one rule for the legacy LUT [review 2, findings 9 and 13]", () => {
  it("reads the route without zod: igst_paid only when it says so, the LUT route otherwise, never throws", () => {
    expect(exportModeFromStoredTax({ exportMode: "igst_paid" })).toBe("igst_paid");
    expect(exportModeFromStoredTax({ exportMode: "lut" })).toBe("lut");
    for (const junk of [null, undefined, 3, "x", [], {}, { exportMode: 5 }, { exportMode: "other" }])
      expect(exportModeFromStoredTax(junk)).toBe("lut");
  });
  it("the three readers agree on every legacy shape: folded, listed, invalid (ARN or year), full, none", () => {
    const entry = (n: number) => ({ fy: `${20 + n}${21 + n}`, arn: `A${n}`, filedOn: null });
    const twenty = Array.from({ length: 20 }, (_, n) => entry(n));
    const base = { ...SETTINGS_DEFAULTS.tax, luts: [entry(0)] };
    const cases: { lut: { arn: string | null; fy: string | null }; luts?: typeof twenty }[] = [
      { lut: { arn: "ad 1", fy: "2627" } }, // folded, normalised
      { lut: { arn: "AD1", fy: "2021" } }, // listed
      { lut: { arn: "AD-1", fy: "2627" } }, // invalid ARN
      { lut: { arn: "AD1", fy: "2628" } }, // invalid year
      { lut: { arn: "AD1", fy: "2627" }, luts: twenty }, // full
      { lut: { arn: null, fy: null } }, // none
    ];
    for (const c of cases) {
      const tax = { ...base, ...(c.luts ? { luts: c.luts } : {}), lut: c.lut };
      const fate = legacyLutFate(tax);
      const expected = [
        ...tax.luts.map(({ fy, arn }) => ({ fy, arn })),
        ...(fate.fate === "folded" ? [{ fy: fate.entry.fy, arn: fate.entry.arn }] : []),
      ];
      expect(lutsOf(tax), JSON.stringify(c)).toEqual(expected);
      expect(lutsFromStoredTax(tax), JSON.stringify(c)).toEqual(expected);
      expect(
        foldLegacyLut(tax).luts.map(({ fy, arn }) => ({ fy, arn })),
        JSON.stringify(c),
      ).toEqual(expected);
    }
  });
});

describe("lutsFromStoredTax: the reader without zod [finding 7]", () => {
  it("reads the list and the one legacy letter of M3 (unless its FY is listed)", () => {
    expect(
      lutsFromStoredTax({
        luts: [{ fy: "2627", arn: "A1", filedOn: null }],
        lut: { arn: "OLD", fy: "2526" },
      }),
    ).toEqual([
      { fy: "2627", arn: "A1" },
      { fy: "2526", arn: "OLD" },
    ]);
    expect(lutsFromStoredTax({ luts: [{ fy: "2627", arn: "A1" }], lut: { arn: "OLD", fy: "2627" } })).toEqual(
      [{ fy: "2627", arn: "A1" }],
    );
  });
  it("reads a row from before M5.2 (only `lut`), and never throws on garbage", () => {
    expect(lutsFromStoredTax({ lut: { arn: "TESTARN", fy: "2627" } })).toEqual([
      { fy: "2627", arn: "TESTARN" },
    ]);
    expect(lutsFromStoredTax({ lut: { arn: null, fy: null } })).toEqual([]);
    for (const junk of [
      null,
      undefined,
      5,
      "x",
      [],
      { luts: "no" },
      { luts: [null, 3, { fy: 1 }, { fy: "26", arn: "A" }] },
      { lut: 7 },
    ])
      expect(lutsFromStoredTax(junk)).toEqual([]);
  });
  it("agrees with `lutsOf` over the parsed settings", () => {
    const tax = resolveSetting("tax", {
      ...SETTINGS_DEFAULTS.tax,
      luts: [{ fy: "2627", arn: "ad 12 34", filedOn: "2026-03-20" }],
      lut: { arn: "OLD", fy: "2526" },
    });
    expect(lutsFromStoredTax(tax)).toEqual(lutsOf(tax));
  });
});

describe("the daily LUT check: the message, the week and the bell [B3, ADM-INV-18, Q22, LD27]", () => {
  const luts = (...fys: string[]) => fys.map((fy) => ({ fy, arn: `ARN${fy}` }));

  it("the message carries the IST date of the run, and only a real one is a message", () => {
    // 22:00 UTC on 9 March is 03:30 IST on 10 March
    expect(lutCheckMessage(Date.UTC(2027, 2, 9, 22, 0))).toEqual({ kind: "lut.check", asOf: "2027-03-10" });
    expect(LUT_CHECK_KIND).toBe("lut.check");
    expect(isLutCheckMessage({ kind: "lut.check", asOf: "2027-03-10" })).toBe(true);
    for (const bad of [
      null,
      undefined,
      3,
      "x",
      [],
      {},
      { kind: "lut.check" },
      { kind: "lut.check", asOf: 5 },
      { kind: "lut.check", asOf: "2027-02-30" },
      { kind: "other", asOf: "2027-03-10" },
    ])
      expect(isLutCheckMessage(bad), JSON.stringify(bad)).toBe(false);
    expect(isLutCheckKind({ kind: "lut.check", asOf: "junk" })).toBe(true);
    expect(isLutCheckKind({ kind: "other" })).toBe(false);
    expect(isLutCheckKind(null)).toBe(false);
  });

  it("weekMondayOf: Monday to Sunday, across a month and a year; a bad date has none", () => {
    expect(weekMondayOf("2027-03-08")).toBe("2027-03-08"); // a Monday
    expect(weekMondayOf("2027-03-10")).toBe("2027-03-08");
    expect(weekMondayOf("2027-03-14")).toBe("2027-03-08"); // the Sunday
    expect(weekMondayOf("2027-03-15")).toBe("2027-03-15");
    expect(weekMondayOf("2027-04-01")).toBe("2027-03-29");
    expect(weekMondayOf("2027-01-01")).toBe("2026-12-28");
    expect(weekMondayOf("2027-02-30")).toBeNull();
    expect(weekMondayOf("junk")).toBeNull();
  });

  it("lutBellFor: March with no letter for the next FY rings 'next year'; April with none for the running FY rings 'missing'; otherwise nothing", () => {
    expect(lutBellFor("2027-03-10", luts("2627"))).toEqual({
      kind: "next_fy_due",
      fy: "2728",
      fyLabel: "2027-28",
      entity: "lut:2728:2027-03-08",
    });
    expect(lutBellFor("2027-04-07", luts("2627"))).toEqual({
      kind: "current_missing",
      fy: "2728",
      fyLabel: "2027-28",
      entity: "lut:2728:2027-04-05",
    });
    expect(lutBellFor("2027-03-10", luts("2627", "2728"))).toBeNull();
    expect(lutBellFor("2027-09-01", luts("2728"))).toBeNull();
    // in March with no letter at all the 'next year' bell wins (one bell a week)
    expect(lutBellFor("2027-03-10", [])?.kind).toBe("next_fy_due");
    // a letter without an ARN does not count
    expect(lutBellFor("2027-09-01", [{ fy: "2728", arn: " " }])?.kind).toBe("current_missing");
    expect(lutBellFor("junk", [])).toBeNull();
  });
});

describe("normaliseReference, PURPOSE_CODE, proformaWarnAt", () => {
  it("one reference, one form: trimmed, upper case, spaces gone; 1 to 60 of A-Z 0-9 / -", () => {
    expect(normaliseReference("  utr 1234 abc ")).toBe("UTR1234ABC");
    expect(normaliseReference("HDFC/2026-10-28/9")).toBe("HDFC/2026-10-28/9");
    expect(normaliseReference("")).toBeNull();
    expect(normaliseReference("   ")).toBeNull();
    expect(normaliseReference("a_b")).toBeNull();
    expect(normaliseReference("a".repeat(60))).toBe("A".repeat(60));
    expect(normaliseReference("a".repeat(61))).toBeNull();
    expect(normaliseReference("UTR\tX")).toBe("UTRX");
  });
  it("the purpose code is P and four digits", () => {
    for (const ok of ["P0802", "P0807", "P1234"]) expect(PURPOSE_CODE.test(ok)).toBe(true);
    for (const bad of ["p0802", "P080", "P08022", "X0802", "", "P0802 "])
      expect(PURPOSE_CODE.test(bad)).toBe(false);
  });
  it("the 25-day warning starts at the IST midnight 25 days after the IST day of delivery", () => {
    // 2026-10-28 23:30 IST = 18:00 UTC; the IST day is the 28th, so +25 days is 2026-11-22.
    const delivered = Date.UTC(2026, 9, 28, 18, 0, 0);
    expect(proformaWarnDate(delivered, 25)).toBe("2026-11-22");
    expect(proformaWarnAt(delivered, 25)).toBe(Date.UTC(2026, 10, 21, 18, 30, 0));
    // 00:10 IST on the 29th is still the 28th UTC; the IST day is the 29th
    expect(proformaWarnDate(Date.UTC(2026, 9, 28, 18, 40, 0), 25)).toBe("2026-11-23");
  });
});

// ---- the checklist ------------------------------------------------------------------------------------------------------------------------

describe("the mandatory-field checklist [ADM-INV-06, Q10, LD31]", () => {
  it("has the 18 lines of 07-S §3, in order", () => {
    expect(INVOICE_CHECKLIST.map((i) => i.id)).toEqual([
      "companyNames",
      "companyAddressGstin",
      "invoiceNumberDate",
      "clientNameAddress",
      "clientGstin",
      "placeOfSupply",
      "lineDetails",
      "discountTaxable",
      "taxPerType",
      "totalsWords",
      "reverseCharge",
      "signatory",
      "originalForRecipient",
      "exportDeclaration",
      "countryOfDestination",
      "bankDetails",
      "paymentLink",
      "unregisteredHighValue",
    ]);
  });
  it("everything is locked but the bank details (a switch) and the payment link (off, not available)", () => {
    for (const i of INVOICE_CHECKLIST)
      expect(i.locked, i.id).toBe(i.id !== "bankDetails" && i.id !== "paymentLink");
    expect(INVOICE_CHECKLIST.find((i) => i.id === "paymentLink")?.available).toBe(false);
    expect(INVOICE_CHECKLIST.filter((i) => i.available).length).toBe(17);
    expect([...CHECKLIST_SWITCHABLE]).toEqual(["bankDetails"]);
  });
  it("the five layout facts own no blocker; 'ORIGINAL FOR RECIPIENT' does not apply to a proforma; the export lines apply to the export invoice", () => {
    for (const id of [
      "invoiceNumberDate",
      "discountTaxable",
      "totalsWords",
      "signatory",
      "originalForRecipient",
    ])
      expect(INVOICE_CHECKLIST.find((i) => i.id === id)?.blockers, id).toEqual([]);
    expect(INVOICE_CHECKLIST.find((i) => i.id === "originalForRecipient")?.appliesTo).toEqual([
      "tax_invoice",
      "export_invoice",
    ]);
    for (const id of ["exportDeclaration", "countryOfDestination"])
      expect(INVOICE_CHECKLIST.find((i) => i.id === id)?.appliesTo, id).toEqual(["export_invoice"]);
  });
  it("every blocker code is owned by at most one item, and all but the ones no item owns are owned by one", () => {
    const owners = new Map<string, string[]>();
    for (const i of INVOICE_CHECKLIST)
      for (const c of i.blockers) owners.set(c, [...(owners.get(c) ?? []), i.id]);
    for (const [code, ids] of owners) expect(ids.length, code).toBe(1);
    const unowned = ISSUE_BLOCKER_CODES.filter((c) => !owners.has(c)).sort();
    expect(unowned).toEqual(["currency_mismatch", "fx_date_invalid", "fx_missing", "type_not_allowed"]);
  });
  it("checklistItemOn: locked items always, the bank item as stored, the payment link never", () => {
    const bank = INVOICE_CHECKLIST.find((i) => i.id === "bankDetails");
    const link = INVOICE_CHECKLIST.find((i) => i.id === "paymentLink");
    const name = INVOICE_CHECKLIST.find((i) => i.id === "companyNames");
    if (!bank || !link || !name) throw new Error("fixture");
    expect(checklistItemOn(name, { bankDetails: false, paymentLink: false })).toBe(true);
    expect(checklistItemOn(bank, { bankDetails: false, paymentLink: false })).toBe(false);
    expect(checklistItemOn(bank, DEFAULT_CHECKLIST)).toBe(true);
    expect(checklistItemOn(link, DEFAULT_CHECKLIST)).toBe(false);
  });
});

describe("what stops each kind of issue, one blocker per field [ADM-INV-06, -08, -18; Rule 46; docs/09]", () => {
  type Kind = "tax" | "export" | "proforma" | "advance_tax" | "advance_export" | "proforma_overseas";
  const inrDomestic: IssueFacts = {
    type: "tax_invoice",
    currency: "INR",
    clientCurrency: "INR",
    supplier: {
      legalName: "Example Proprietor",
      tradeName: "Example Trade",
      address: "1 Road, Town",
      gstin: "19ABCDE1234F1Z5",
      stateCode: "19",
    },
    recipient: {
      legalName: "Client Pvt Ltd",
      addressLine1: "2 Street",
      gstStatus: "registered",
      gstin: "27ABCDE1234F1Z5",
      stateCode: "27",
      countryName: "India",
    },
    lines: [{ sac: "998314", description: "Website build" }],
    taxErrorCount: 0,
    totalMinor: 118_000,
    totalInrMinor: 118_000,
    reverseChargeText: "No",
    fx: { value: null, refDate: "2027-04-01", maxAgeDays: 4 },
    export: null,
    bank: { inr: true, swift: true },
    advance: false,
    b2cThresholdInrMinor: 5_000_000,
  };
  const overseas = {
    legalName: "Acme GmbH",
    addressLine1: "3 Strasse",
    gstStatus: "overseas" as const,
    gstin: null,
    stateCode: null,
    countryName: "Germany",
  };
  const usdFx = {
    value: { rateMicros: 83_123_400, date: "2027-04-01", source: "FBIL reference rate" },
    refDate: "2027-04-01",
    maxAgeDays: 4,
  };
  const lut2728 = { fy: "2728", arn: "AD0000000000009" };
  const base = (kind: Kind): IssueFacts => {
    switch (kind) {
      case "tax":
        return inrDomestic;
      case "advance_tax":
        return { ...inrDomestic, advance: true };
      case "proforma":
        return { ...inrDomestic, type: "proforma" };
      case "export":
        return {
          ...inrDomestic,
          type: "export_invoice",
          currency: "USD",
          clientCurrency: "USD",
          recipient: overseas,
          fx: usdFx,
          export: { mode: "lut", issueFy: "2728", luts: [lut2728] },
        };
      case "advance_export":
        return { ...base("export"), advance: true };
      case "proforma_overseas":
        return { ...base("export"), type: "proforma", fx: { ...usdFx, value: null }, export: null };
    }
  };
  const codes = (f: IssueFacts, c: ChecklistSettings = DEFAULT_CHECKLIST) =>
    issueBlockers(f, c).map((b) => b.code);

  it("nothing blocks a complete document of any kind", () => {
    for (const k of [
      "tax",
      "export",
      "proforma",
      "advance_tax",
      "advance_export",
      "proforma_overseas",
    ] as Kind[])
      expect(issueBlockers(base(k)), k).toEqual([]);
  });

  type Row = [string, Kind[], (f: IssueFacts) => IssueFacts, IssueBlockerCode, boolean];
  // [what is missing, the kinds it applies to, how to break the facts, the code, whether the switch can silence it]
  const everywhere: Kind[] = [
    "tax",
    "export",
    "proforma",
    "advance_tax",
    "advance_export",
    "proforma_overseas",
  ];
  const rows: Row[] = [
    [
      "supplier legal name",
      everywhere,
      (f) => ({ ...f, supplier: { ...f.supplier, legalName: null } }),
      "supplier_legal_name",
      false,
    ],
    [
      "supplier trade name",
      everywhere,
      (f) => ({ ...f, supplier: { ...f.supplier, tradeName: "" } }),
      "supplier_trade_name",
      false,
    ],
    [
      "supplier address",
      everywhere,
      (f) => ({ ...f, supplier: { ...f.supplier, address: null } }),
      "supplier_address",
      false,
    ],
    [
      "supplier GSTIN",
      everywhere,
      (f) => ({ ...f, supplier: { ...f.supplier, gstin: null } }),
      "supplier_gstin",
      false,
    ],
    [
      "supplier state",
      everywhere,
      (f) => ({ ...f, supplier: { ...f.supplier, stateCode: null } }),
      "supplier_state",
      false,
    ],
    [
      "client name",
      everywhere,
      (f) => ({ ...f, recipient: { ...f.recipient, legalName: null } }),
      "recipient_legal_name",
      false,
    ],
    [
      "client address",
      everywhere,
      (f) => ({ ...f, recipient: { ...f.recipient, addressLine1: " " } }),
      "recipient_address",
      false,
    ],
    ["no lines", everywhere, (f) => ({ ...f, lines: [] }), "no_lines", false],
    [
      "a line SAC (a proforma and the advance invoice need it too: the split is by SAC)",
      everywhere,
      (f) => ({ ...f, lines: [{ sac: null, description: "x" }] }),
      "line_sac_missing",
      false,
    ],
    [
      "a line description",
      everywhere,
      (f) => ({ ...f, lines: [{ sac: "998314", description: "" }] }),
      "line_description_missing",
      false,
    ],
    [
      "a computed document",
      everywhere,
      (f) => ({ ...f, taxErrorCount: 1, totalMinor: null }),
      "computed_errors",
      false,
    ],
    ["a total above zero", everywhere, (f) => ({ ...f, totalMinor: 0 }), "zero_total", false],
    [
      "the reverse-charge statement",
      everywhere,
      (f) => ({ ...f, reverseChargeText: "" }),
      "reverse_charge_text",
      false,
    ],
    [
      "the client's currency",
      everywhere,
      (f) => ({ ...f, currency: f.currency === "INR" ? "USD" : "INR" }),
      "currency_mismatch",
      false,
    ],
    [
      "the client GSTIN",
      ["tax", "advance_tax", "proforma"],
      (f) => ({ ...f, recipient: { ...f.recipient, gstin: null } }),
      "recipient_gstin",
      false,
    ],
    [
      "the client state",
      ["tax", "advance_tax", "proforma"],
      (f) => ({ ...f, recipient: { ...f.recipient, stateCode: null } }),
      "recipient_state",
      false,
    ],
    [
      "a tax invoice for an overseas client",
      ["tax"],
      (f) => ({ ...f, recipient: overseas }),
      "type_not_allowed",
      false,
    ],
    [
      "an export invoice for a client in India",
      ["export", "advance_export"],
      (f) => ({ ...f, recipient: { ...inrDomestic.recipient }, currency: "USD" }),
      "type_not_allowed",
      false,
    ],
    [
      "the country of destination",
      ["export", "advance_export"],
      (f) => ({ ...f, recipient: { ...f.recipient, countryName: null } }),
      "country_missing",
      false,
    ],
    [
      "the exchange rate",
      ["export", "advance_export"],
      (f) => ({ ...f, fx: { ...f.fx, value: null } }),
      "fx_missing",
      false,
    ],
    [
      "the LUT of the FY of issue",
      ["export", "advance_export"],
      (f) => ({ ...f, export: f.export ? { ...f.export, luts: [{ fy: "2627", arn: "OLD" }] } : null }),
      "lut_missing",
      false,
    ],
    [
      "an active INR bank account",
      ["tax", "proforma"],
      (f) => ({ ...f, bank: { inr: false, swift: true } }),
      "bank_missing",
      true,
    ],
    [
      "an active SWIFT bank account",
      ["export"],
      (f) => ({ ...f, bank: { inr: true, swift: false } }),
      "swift_missing",
      true,
    ],
  ];
  for (const [what, kinds, make, code, switchable] of rows) {
    for (const kind of kinds) {
      it(`${what}: ${kind} -> ${code}`, () => {
        expect(codes(make(base(kind))), `${kind}`).toContain(code);
        if (switchable) {
          expect(codes(make(base(kind)), { bankDetails: false, paymentLink: false })).not.toContain(code);
        } else {
          // a locked item cannot be silenced by anything the Owner can store
          expect(codes(make(base(kind)), { bankDetails: false, paymentLink: false })).toContain(code);
        }
      });
    }
  }

  it("a missing field that does not apply to a kind does not block it", () => {
    // a proforma has no exchange rate, no LUT, no country item, and may go to any client
    expect(codes({ ...base("proforma_overseas"), fx: { ...usdFx, value: null } })).toEqual([]);
    expect(
      codes({ ...base("proforma"), recipient: overseas, currency: "INR", clientCurrency: "INR" }),
    ).toEqual([]);
    expect(codes({ ...base("proforma_overseas"), recipient: { ...overseas, countryName: null } })).toEqual(
      [],
    );
    expect(
      codes({ ...base("proforma_overseas"), export: { mode: "lut", issueFy: "2728", luts: [] } }),
    ).toEqual([]);
    // the advance invoice is paid: no bank block to check
    expect(codes({ ...base("advance_tax"), bank: { inr: false, swift: false } })).toEqual([]);
    expect(codes({ ...base("advance_export"), bank: { inr: false, swift: false } })).toEqual([]);
    // the domestic tax invoice needs neither a country nor a LUT nor a rate
    expect(codes({ ...base("tax"), recipient: { ...base("tax").recipient, countryName: null } })).toEqual([]);
    // the IGST route needs no LUT
    expect(codes({ ...base("export"), export: { mode: "igst_paid", issueFy: "2728", luts: [] } })).toEqual(
      [],
    );
  });

  it("a USD domestic tax invoice needs the exchange rate; an INR one never does", () => {
    const usdTax: IssueFacts = {
      ...base("tax"),
      currency: "USD",
      clientCurrency: "USD",
      bank: { inr: false, swift: true },
      totalInrMinor: 9_000_000,
    };
    expect(issueBlockers(usdTax)).toEqual([{ code: "fx_missing", date: "2027-04-01" }]);
    expect(codes({ ...usdTax, fx: usdFx })).toEqual([]);
    expect(codes({ ...base("tax"), fx: usdFx })).toEqual([]);
  });

  it("fx_date_invalid carries the day it was judged against (future and too old are both invalid)", () => {
    const f = base("export");
    for (const date of ["2027-04-02", "2027-03-27"])
      expect(issueBlockers({ ...f, fx: { ...usdFx, value: { ...usdFx.value, date } } })).toEqual([
        { code: "fx_date_invalid", date: "2027-04-01" },
      ]);
    for (const date of ["2027-04-01", "2027-03-28"])
      expect(issueBlockers({ ...f, fx: { ...usdFx, value: { ...usdFx.value, date } } })).toEqual([]);
    // the maximum age is a setting
    expect(
      codes({ ...f, fx: { ...usdFx, maxAgeDays: 0, value: { ...usdFx.value, date: "2027-03-31" } } }),
    ).toEqual(["fx_date_invalid"]);
  });

  it("lut_missing carries the FY of issue: a draft made on 31 March and issued on 1 April needs the new year's letter", () => {
    const f = base("export");
    expect(
      issueBlockers({ ...f, export: { mode: "lut", issueFy: "2728", luts: [{ fy: "2627", arn: "A" }] } }),
    ).toEqual([{ code: "lut_missing", fy: "2728" }]);
    expect(
      issueBlockers({ ...f, export: { mode: "lut", issueFy: "2627", luts: [{ fy: "2627", arn: "A" }] } }),
    ).toEqual([]);
    // only a 2526 letter does not cover 2627 either
    expect(
      issueBlockers({ ...f, export: { mode: "lut", issueFy: "2627", luts: [{ fy: "2526", arn: "A" }] } }),
    ).toEqual([{ code: "lut_missing", fy: "2627" }]);
  });

  it("the ₹50,000 rule [Q25]: an unregistered client at or above the threshold on the total including GST", () => {
    const unreg = (over: Partial<IssueFacts["recipient"]>, total: number): IssueFacts => ({
      ...base("tax"),
      totalMinor: total,
      totalInrMinor: total,
      recipient: { ...base("tax").recipient, gstStatus: "unregistered", gstin: null, ...over },
    });
    expect(codes(unreg({ addressLine1: null }, 5_000_000))).toContain("unregistered_high_value");
    expect(codes(unreg({ stateCode: null }, 5_000_000))).toContain("unregistered_high_value");
    expect(codes(unreg({ legalName: null }, 5_000_001))).toContain("unregistered_high_value");
    // just below the threshold the new line is not raised (the always-required name, address and state still are)
    expect(codes(unreg({ addressLine1: null }, 4_999_999))).not.toContain("unregistered_high_value");
    // complete details never raise it, a registered client never does
    expect(codes(unreg({}, 9_000_000))).toEqual([]);
    expect(
      codes({
        ...base("tax"),
        recipient: { ...base("tax").recipient, addressLine1: null },
        totalInrMinor: 9_000_000,
      }),
    ).not.toContain("unregistered_high_value");
    // a proforma is not a tax invoice: the rule is not raised on it
    expect(codes({ ...unreg({ addressLine1: null }, 9_000_000), type: "proforma" })).not.toContain(
      "unregistered_high_value",
    );
  });

  it("the bank blocker follows the currency of the document, and a USD document needs the SWIFT account", () => {
    expect(codes({ ...base("tax"), bank: { inr: false, swift: true } })).toEqual(["bank_missing"]);
    expect(codes({ ...base("tax"), bank: { inr: true, swift: false } })).toEqual([]);
    expect(codes({ ...base("export"), bank: { inr: true, swift: false } })).toEqual(["swift_missing"]);
    expect(codes({ ...base("export"), bank: { inr: false, swift: true } })).toEqual([]);
  });

  it("the payment-link line never blocks: it is off and not available", () => {
    expect(codes(base("tax"), { bankDetails: true, paymentLink: false })).toEqual([]);
  });

  it("is deterministic and total over facts (no throw)", () => {
    const kinds: Kind[] = ["tax", "export", "proforma", "advance_tax", "advance_export", "proforma_overseas"];
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        fc.boolean(),
        fc.option(fc.integer({ min: -10, max: 10 }), { nil: null }),
        fc.string(),
        (kind, bankOn, total, date) => {
          const f = { ...base(kind), totalMinor: total, fx: { ...base(kind).fx, refDate: date } };
          const c = { bankDetails: bankOn, paymentLink: false } as const;
          expect(issueBlockers(f, c)).toEqual(issueBlockers(f, c));
        },
      ),
    );
  });

  it("every type of the checklist is covered by the table: the types it can be asked about", () => {
    const types: ChecklistType[] = ["tax_invoice", "export_invoice", "proforma"];
    for (const t of types) expect(INVOICE_CHECKLIST.some((i) => i.appliesTo.includes(t))).toBe(true);
  });
});

describe("void: a proforma has no return period [LD28]", () => {
  const base = {
    status: "issued",
    paidMinor: 0,
    creditedMinor: 0,
    hasIssuedChild: false,
    emailed: false,
    issueDate: "2026-10-05",
    today: "2027-01-31",
  };
  it("another type is closed after the month, a proforma is not; its other rules stand", () => {
    expect(voidBlockers(base)).toEqual(["return_period_closed"]);
    expect(voidBlockers({ ...base, type: "tax_invoice" })).toEqual(["return_period_closed"]);
    expect(voidBlockers({ ...base, type: "proforma" })).toEqual([]);
    expect(voidBlockers({ ...base, type: "proforma", status: "converted" })).toEqual(["not_issued"]);
    expect(voidBlockers({ ...base, type: "proforma", hasIssuedChild: true })).toEqual(["has_child_document"]);
  });
});

// ---- the seal ----------------------------------------------------------------------------------------------------------------------------

describe("the sealed header: new keys only where they belong [LD25]", () => {
  // The fixture of an invoice sealed by M5.1. Its hash is a GOLDEN literal: if it ever moves, every issued M5.1 invoice would stop verifying.
  const m51 = {
    document: {
      type: "tax_invoice",
      clientId: "c1",
      currency: "INR",
      issueDate: "2026-10-28",
      dueDate: "2026-11-04",
      contentSha256: "a".repeat(64),
      termsRef: null,
      exportMode: null,
    },
    supply: { type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" },
    recipient: { legalName: "Client" },
    issuer: { company: { tradeName: "T" }, signature: null },
    computedSha256: "b".repeat(64),
  };
  it("an M5.1 tax-invoice header keeps its exact hash", async () => {
    expect(await invoiceSnapshotSha256(m51)).toBe(
      "9fd951e65bdd36b9dfd38ea5a3c153104648c9305cceb786096c7a79d3151227",
    );
  });
  it("each new key changes the hash, and a key left out is not the same as null", async () => {
    const h = await invoiceSnapshotSha256(m51);
    const withKey = [
      { ...m51, fx: { rateMicros: 83_123_400, date: "2026-10-28", source: "FBIL reference rate" } },
      { ...m51, proforma: { notice: PROFORMA_NOTICE } },
      {
        ...m51,
        export: {
          mode: "lut" as const,
          endorsement: EXPORT_ENDORSEMENT.lut,
          lut: { fy: "2627", arn: "A" },
          countryCode: "DE",
          countryName: "Germany",
          declarationRef: null,
        },
      },
      {
        ...m51,
        advance: {
          proformaId: "p",
          proformaNumber: "TH/PI/2627/0001",
          proformaIssueDate: "2026-10-01",
          receivedOn: "2026-10-27",
          receiptId: "r",
        },
      },
    ];
    const seen = new Set<string>([h]);
    for (const v of withKey) {
      const x = await invoiceSnapshotSha256(v);
      expect(seen.has(x)).toBe(false);
      seen.add(x);
    }
    // the rate itself is sealed
    const a = await invoiceSnapshotSha256({
      ...m51,
      fx: { rateMicros: 83_123_400, date: "2026-10-28", source: "s" },
    });
    const b = await invoiceSnapshotSha256({
      ...m51,
      fx: { rateMicros: 83_123_500, date: "2026-10-28", source: "s" },
    });
    expect(a).not.toBe(b);
  });
});

// ---- the content hash and the rate -------------------------------------------------------------------------------------------------------

describe("the content hash covers the exchange rate [LD24, finding 3]", () => {
  const draft: DraftContent = {
    type: "export_invoice",
    clientId: "c1",
    contactId: null,
    title: null,
    currency: "USD",
    validityDays: null,
    termsVersionId: null,
    discountKind: null,
    discountValue: null,
    exportMode: null,
    lines: [],
    sections: [],
    schedule: [],
  };
  it("no rate, no `fx` key (so every earlier hash stays), and null is the same as absent", async () => {
    expect(Object.keys(contentHashInput(draft, null))).not.toContain("fx");
    expect(Object.keys(contentHashInput({ ...draft, fx: null }, null))).not.toContain("fx");
    expect(await contentHash({ ...draft, fx: null }, null)).toBe(await contentHash(draft, null));
  });
  it("a rate writes `fx` between `document` and `lineTotals`, and any part of it moves the hash", async () => {
    const fx = { rateMicros: 83_123_400, date: "2026-10-28", source: "FBIL reference rate" };
    const keys = Object.keys(contentHashInput({ ...draft, fx }, null));
    expect(keys.indexOf("fx")).toBe(keys.indexOf("document") + 1);
    expect(keys.indexOf("lineTotals")).toBe(keys.indexOf("fx") + 1);
    // plain JSON.stringify equals the canonical form because the keys stay in sorted order
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    const h = await contentHash({ ...draft, fx }, null);
    expect(h).not.toBe(await contentHash(draft, null));
    for (const changed of [
      { ...fx, rateMicros: 83_123_500 },
      { ...fx, date: "2026-10-27" },
      { ...fx, source: "RBI reference rate" },
    ])
      expect(await contentHash({ ...draft, fx: changed }, null)).not.toBe(h);
  });
});

// ---- the tax settings ---------------------------------------------------------------------------------------------------------------------

describe("the tax settings of M5.2 [ADM-SET-03, LD31, Q24]", () => {
  const schema = SETTINGS_SCHEMAS.tax;
  const ok = (over: Record<string, unknown>) => schema.safeParse({ ...SETTINGS_DEFAULTS.tax, ...over });
  const messages = (over: Record<string, unknown>) =>
    ok(over).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [];

  it("the defaults: no letters, the bank details required, the payment link off, a rate may be 4 days old", () => {
    expect(SETTINGS_DEFAULTS.tax.luts).toEqual([]);
    expect(SETTINGS_DEFAULTS.tax.invoiceChecklist).toEqual({ bankDetails: true, paymentLink: false });
    expect(SETTINGS_DEFAULTS.tax.fxMaxAgeDays).toBe(4);
    expect(schema.safeParse(SETTINGS_DEFAULTS.tax).success).toBe(true);
  });
  it("a stored pre-M5.2 tax row resolves with the new keys filled in, and a saved letter is read", () => {
    const { luts: _l, invoiceChecklist: _c, fxMaxAgeDays: _f, ...old } = SETTINGS_DEFAULTS.tax;
    const stored = { ...old, lut: { arn: "AD0000000000001", fy: "2627" } };
    const tax = resolveSetting("tax", stored);
    expect(tax.luts).toEqual([]);
    expect(tax.invoiceChecklist).toEqual({ bankDetails: true, paymentLink: false });
    expect(tax.fxMaxAgeDays).toBe(4);
    expect(lutsOf(tax)).toEqual([{ fy: "2627", arn: "AD0000000000001" }]);
  });
  it("`lut` is optional on input (the old screen may omit it), and the list wins when both name one FY", () => {
    const { lut: _lut, ...noLut } = SETTINGS_DEFAULTS.tax;
    const parsed = schema.safeParse(noLut);
    expect(parsed.success).toBe(true);
    const tax = resolveSetting("tax", {
      ...SETTINGS_DEFAULTS.tax,
      luts: [{ fy: "2627", arn: "NEW1", filedOn: null }],
      lut: { arn: "OLD1", fy: "2627" },
    });
    expect(lutsOf(tax)).toEqual([{ fy: "2627", arn: "NEW1" }]);
  });
  it("`foldLegacyLut` moves the old single letter into the list (unless its FY is listed) and clears it: a deleted letter cannot come back [early check 3]", () => {
    const legacy = { ...SETTINGS_DEFAULTS.tax, lut: { arn: "OLD1", fy: "2627" } };
    const folded = foldLegacyLut(legacy);
    expect(folded.luts).toEqual([{ fy: "2627", arn: "OLD1", filedOn: null }]);
    expect(folded.lut).toEqual({ arn: null, fy: null });
    // the letters read are the same before and after (a saved letter never vanishes)
    expect(lutsOf(folded)).toEqual(lutsOf(legacy));
    // the list wins for the same FY, and the old key is dropped
    const both = foldLegacyLut({
      ...legacy,
      luts: [{ fy: "2627", arn: "NEW1", filedOn: "2026-03-20" }],
    });
    expect(both.luts).toEqual([{ fy: "2627", arn: "NEW1", filedOn: "2026-03-20" }]);
    expect(both.lut).toEqual({ arn: null, fy: null });
    // an empty old key changes nothing; the owner deleted the list entry and the old key is empty: no letter
    expect(foldLegacyLut(SETTINGS_DEFAULTS.tax).luts).toEqual([]);
    expect(lutsOf(foldLegacyLut({ ...SETTINGS_DEFAULTS.tax, luts: [] }))).toEqual([]);
    // folding twice is the same as once, and the result still parses
    expect(foldLegacyLut(folded)).toEqual(folded);
    expect(schema.safeParse(folded).success).toBe(true);
  });
  it("`foldLegacyLut` normalises the old ARN like a list entry's and drops one the list would refuse, so a Tax save never fails on it [review 8]", () => {
    const base = SETTINGS_DEFAULTS.tax;
    const fold = (lut: { arn: string | null; fy: string | null }, luts: typeof base.luts = []) =>
      foldLegacyLut({ ...base, luts, lut });
    // spaces and lower case are the list's normal form
    expect(fold({ arn: " ad 12 x ", fy: "2627" }).luts).toEqual([
      { fy: "2627", arn: "AD12X", filedOn: null },
    ]);
    // a character the list refuses, an empty-after-trim ARN, a year of two non-consecutive years: dropped, and the result always parses
    for (const lut of [
      { arn: "AD-12/3", fy: "2627" },
      { arn: "   ", fy: "2627" },
      { arn: "A".repeat(31), fy: "2627" },
      { arn: "AD123", fy: "2629" },
    ]) {
      const folded = fold(lut);
      expect(folded.luts, JSON.stringify(lut)).toEqual([]);
      expect(folded.lut).toEqual({ arn: null, fy: null });
      expect(schema.safeParse(folded).success).toBe(true);
    }
    // the fate says which case it was (the route logs it, never the ARN)
    expect(legacyLutFate({ ...base, lut: { arn: null, fy: null } })).toEqual({ fate: "none" });
    expect(legacyLutFate({ ...base, lut: { arn: "AD-1", fy: "2627" } })).toEqual({ fate: "invalid" });
    expect(
      legacyLutFate({
        ...base,
        lut: { arn: "AD1", fy: "2627" },
        luts: [{ fy: "2627", arn: "NEW", filedOn: null }],
      }),
    ).toEqual({ fate: "listed" });
    expect(legacyLutFate({ ...base, lut: { arn: "ad 1", fy: "2627" } })).toEqual({
      fate: "folded",
      entry: { fy: "2627", arn: "AD1", filedOn: null },
    });
    // a full list (20 years) takes no more: dropped, not an invalid save
    const twenty = Array.from({ length: 20 }, (_, i) => {
      const a = String(10 + i).padStart(2, "0");
      return { fy: `${a}${String(11 + i).padStart(2, "0")}`, arn: `AD${i}`, filedOn: null };
    });
    expect(legacyLutFate({ ...base, luts: twenty, lut: { arn: "AD99", fy: "3031" } })).toEqual({
      fate: "full",
    });
    expect(fold({ arn: "AD99", fy: "3031" }, twenty).luts).toHaveLength(20);
  });
  it("a letter: consecutive years, an ARN of letters and digits (spaces dropped, upper case), a real filing date or none", () => {
    const one = (over: Record<string, unknown>) =>
      ok({ luts: [{ fy: "2627", arn: "AD1234", filedOn: null, ...over }] });
    expect(one({}).success).toBe(true);
    const parsed = one({ arn: " ad 12 34", filedOn: "2026-03-20" });
    expect(parsed.success && parsed.data.luts[0]).toEqual({
      fy: "2627",
      arn: "AD1234",
      filedOn: "2026-03-20",
    });
    expect(one({ fy: "2628" }).success).toBe(false);
    expect(one({ fy: "26-27" }).success).toBe(false);
    expect(one({ fy: "9900" }).success).toBe(true);
    expect(one({ arn: "" }).success).toBe(false);
    expect(one({ arn: "A-1" }).success).toBe(false);
    expect(one({ arn: "A".repeat(31) }).success).toBe(false);
    expect(one({ arn: "A".repeat(30) }).success).toBe(true);
    expect(one({ filedOn: "2026-02-30" }).success).toBe(false);
    expect(one({ filedOn: "20/03/2026" }).success).toBe(false);
    expect(one({ extra: 1 }).success).toBe(false);
  });
  it("one letter per year (the message points at the repeated row), at most 20", () => {
    expect(
      messages({
        luts: [
          { fy: "2627", arn: "A1", filedOn: null },
          { fy: "2627", arn: "A2", filedOn: null },
        ],
      }),
    ).toEqual(["luts.1.fy: This year already has an LUT."]);
    const twenty = Array.from({ length: 20 }, (_, i) => ({
      fy: `${String(i).padStart(2, "0")}${String(i + 1).padStart(2, "0")}`,
      arn: "A",
      filedOn: null,
    }));
    expect(ok({ luts: twenty }).success).toBe(true);
    expect(ok({ luts: [...twenty, { fy: "2122", arn: "A", filedOn: null }] }).success).toBe(false);
  });
  it("the checklist: only the two switches; naming a locked item, or turning the payment link on, is refused", () => {
    expect(ok({ invoiceChecklist: { bankDetails: false, paymentLink: false } }).success).toBe(true);
    expect(ok({ invoiceChecklist: { bankDetails: true, paymentLink: true } }).success).toBe(false);
    expect(
      ok({ invoiceChecklist: { bankDetails: true, paymentLink: false, companyNames: false } }).success,
    ).toBe(false);
    expect(ok({ invoiceChecklist: { bankDetails: true } }).success).toBe(false);
    expect(ok({ invoiceChecklist: { bankDetails: "yes", paymentLink: false } }).success).toBe(false);
  });
  it("the age of the rate: a whole number of days from 0 to 7", () => {
    for (const v of [0, 4, 7]) expect(ok({ fxMaxAgeDays: v }).success).toBe(true);
    for (const v of [-1, 8, 2.5, "4", null]) expect(ok({ fxMaxAgeDays: v }).success).toBe(false);
  });
});
