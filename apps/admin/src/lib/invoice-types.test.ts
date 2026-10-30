// The M5.2 screens' pure rules [ADM-INV-06, -08, -10, -18, ADM-SET-02, -03]: 07-S word for word, the seven new blocker lines and where each is fixed,
// both lines when the ₹50,000 rule comes with an address blocker, the new badges, the rate as typed (core's parse), the advance checks, the LUT list
// and the purpose code. Sample data only.
import { INVOICE_CHECKLIST } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import {
  ADVANCE_FIELDS,
  advanceFocus,
  advanceLine,
  advanceLutMissing,
  arrivedEarlierMonth,
  CHECKLIST_LABELS,
  checkAdvance,
  checkFx,
  checkLut,
  checkPurposeCode,
  childLine,
  cleanArn,
  FX_SOURCE_LABELS,
  fxBody,
  fxFormOf,
  fxLine,
  fyLabel,
  HOUSE_RULE_IDS,
  INVT_COPY,
  isHouseRule,
  lutDueBanner,
  lutLine,
  lutMissingBanner,
  lutsByYear,
  proformaDraftTitle,
  proformaLockedLine,
  rateDateFollows,
  rateDayEarlier,
  splitAdvanceRefusal,
  warn25Line,
} from "./invoice-types.ts";
import { BADGE_LABELS, badgeOf, blockerLine, blockerTarget, invErrorText } from "./invoices.ts";

describe("07-S word for word", () => {
  it("keeps the FX, LUT, advance and checklist lines", () => {
    expect(INVT_COPY.fxTitle).toBe("Exchange rate for this invoice");
    expect(fxBody("27 Oct 2026")).toBe(
      "Enter the RBI or FBIL reference rate for 27 Oct 2026. If none was published that day, use the last published rate. The rate is stored with the invoice and used for its INR values in your GST return.",
    );
    expect(INVT_COPY.inrConfirm).toBe(
      "This export invoice is in INR. It counts as an export only if the payment reaches you in a way the RBI allows for exports in rupees: check with your bank. Issue it in INR anyway?",
    );
    expect(FX_SOURCE_LABELS).toEqual({
      FBIL: "FBIL reference rate",
      RBI: "RBI reference rate",
      OTHER: "Other (describe)",
    });
    expect(lutDueBanner("2027-28")).toBe(
      "File next year's LUT (FY 2027-28) before 1 April, then save its ARN here.",
    );
    expect(lutMissingBanner("2026-27")).toBe(
      "There's no LUT for FY 2026-27. Export invoices without IGST are blocked until you save its ARN.",
    );
    expect(lutLine("AD0000000000001", "2026-27")).toBe("LUT ARN: AD0000000000001 (FY 2026-27)");
    expect(fxLine("83.1234", "FBIL reference rate", "27 Oct 2026")).toBe(
      "Exchange rate: 1 USD = ₹83.1234 (FBIL reference rate, 27 Oct 2026)",
    );
    expect(childLine("TH/INV/2627/0001", "₹10,000.00", "27 Oct 2026")).toBe(
      "Tax invoice TH/INV/2627/0001 issued for ₹10,000.00 on 27 Oct 2026.",
    );
    expect(warn25Line("TH/PI/2627/0001")).toBe(
      "Proforma TH/PI/2627/0001 for delivered work has been unpaid for 25 days. Issue a tax invoice within 30 days of supply.",
    );
    expect(advanceLine("TH/PI/2627/0001", "20 Oct 2026", "27 Oct 2026")).toBe(
      "Against proforma TH/PI/2627/0001 of 20 Oct 2026, payment received on 27 Oct 2026.",
    );
    expect(INVT_COPY.advanceAction).toBe("Issue tax invoice for payment received");
    expect(INVT_COPY.checklistTitle).toBe("What every invoice must show");
  });

  it("has a 07-S §3 label for every checklist item of core, in core's order", () => {
    for (const item of INVOICE_CHECKLIST) expect(CHECKLIST_LABELS[item.id], item.id).toBeTruthy();
    expect(Object.keys(CHECKLIST_LABELS)).toEqual(INVOICE_CHECKLIST.map((i) => i.id));
    expect(INVOICE_CHECKLIST).toHaveLength(18);
  });
});

describe("the seven new blocker lines (07-S §3, §8)", () => {
  it("say what to fix, with the date, the FY and the days filled in", () => {
    expect(blockerLine({ code: "country_missing" }, "USD")).toBe("Add the client's country.");
    expect(blockerLine({ code: "fx_missing", date: "2026-10-27" }, "USD")).toBe(
      "Enter the exchange rate for 27 Oct 2026 before issuing a USD invoice.",
    );
    expect(blockerLine({ code: "lut_missing", fy: "2627" }, "USD")).toBe(
      "Save the LUT ARN for FY 2026-27 in Settings › Tax before issuing an export invoice under LUT. Or issue it with IGST paid.",
    );
    expect(blockerLine({ code: "unregistered_high_value" }, "INR")).toBe(
      "For an unregistered client and an invoice of ₹50,000 or more, add the client's name, address and state.",
    );
    expect(blockerLine({ code: "bank_missing" }, "INR")).toBe(
      "Add an active bank account in Settings › Bank.",
    );
    expect(blockerLine({ code: "swift_missing" }, "USD")).toBe(
      "Add the SWIFT details of a bank account in Settings › Bank for export invoices.",
    );
    expect(blockerLine({ code: "fx_date_invalid", date: "2026-10-27" }, "USD", { maxAgeDays: 4 })).toBe(
      "Use the rate published on 27 Oct 2026. If none was published that day, use the last one published before it, at most 4 days earlier.",
    );
    expect(blockerLine({ code: "fx_same_day_exists", date: "2026-10-27" }, "USD")).toBe(
      "A rate was published on 27 Oct 2026, so use that day's rate.",
    );
  });

  it("the ₹50,000 rule and the address blocker it explains are two lines, both shown (lead answer 4)", () => {
    const lines = [{ code: "recipient_address" }, { code: "unregistered_high_value" }].map((b) =>
      blockerLine(b, "INR"),
    );
    expect(lines).toEqual([
      "Add the client's billing address.",
      "For an unregistered client and an invoice of ₹50,000 or more, add the client's name, address and state.",
    ]);
    expect(new Set(lines).size).toBe(2);
  });

  it("link to where each is fixed: the client, Settings › Tax (the LUT list), Settings › Bank, or this draft's rate", () => {
    expect(blockerTarget({ code: "country_missing" }, "c1")).toEqual({ kind: "page", to: "/clients/c1" });
    expect(blockerTarget({ code: "unregistered_high_value" }, "c1")).toEqual({
      kind: "page",
      to: "/clients/c1",
    });
    expect(blockerTarget({ code: "lut_missing", fy: "2627" }, "c1")).toEqual({
      kind: "page",
      to: "/settings/tax#luts",
      place: "Settings › Tax",
    });
    expect(blockerTarget({ code: "bank_missing" }, "c1")).toEqual({
      kind: "page",
      to: "/settings/bank",
      place: "Settings › Bank",
    });
    expect(blockerTarget({ code: "swift_missing" }, "c1")).toMatchObject({ to: "/settings/bank" });
    expect(blockerTarget({ code: "fx_missing" }, "c1")).toEqual({ kind: "fx" });
    expect(blockerTarget({ code: "fx_date_invalid" }, "c1")).toEqual({ kind: "fx" });
  });

  it("an unknown FY, day or number of days is shown as missing, never guessed", () => {
    expect(blockerLine({ code: "lut_missing" }, "USD")).toContain("FY …");
    expect(blockerLine({ code: "fx_date_invalid" }, "USD")).toContain("published on …");
    expect(blockerLine({ code: "fx_date_invalid" }, "USD")).toContain("at most … days");
  });
});

describe("the API's M5.2 codes in 07-S's words", () => {
  it.each([
    ["export_currency_confirm", "Confirm that this export invoice should be in INR."],
    ["advance_reference_used", "This payment reference was already used for this proforma."],
    ["advance_exceeds_balance", "The amount can't be more than the proforma's balance."],
    ["proforma_not_issued", "Only an issued proforma can be converted."],
    ["advance_date_invalid", "The date received can't be before the proforma's date or in the future."],
    ["already_set", "The service completion date is already set and can't be changed."],
    ["service_date_future", "The service completion date can't be in the future."],
    ["export_mode_not_applicable", "This doesn't apply to this type of invoice."],
    ["export_declaration_missing", "The export note in Settings › Terms was removed. Choose again."],
    [
      "export_declaration_changed",
      "The export note in Settings › Terms changed since this draft was saved. Save the draft again.",
    ],
    [
      "export_declaration_tampered",
      "The export note in Settings › Terms doesn't match its saved copy, so the invoice wasn't issued. A developer needs to look at it.",
    ],
    ["invoice_void", "This invoice is void."],
    ["fx_not_applicable", "An exchange rate is only needed for USD invoices."],
  ])("%s", (code, line) => {
    expect(invErrorText(new RequestError(409, code, "server words"))).toBe(line);
  });
});

describe("badges", () => {
  it("a paid invoice reads Paid, a proforma money came in against reads Converted (unless overdue)", () => {
    expect(badgeOf({ status: "paid", overdue: false })).toBe("paid");
    expect(badgeOf({ status: "converted", overdue: false })).toBe("converted");
    expect(badgeOf({ status: "converted", overdue: true })).toBe("overdue");
    expect(BADGE_LABELS.converted).toBe("Converted");
    expect(BADGE_LABELS.paid).toBe("Paid");
  });
});

describe("the exchange rate as typed (Q7, core's parse)", () => {
  it("accepts up to 4 decimals above zero; anything else is 07-S's error", () => {
    expect(checkFx({ rate: "83.1234", date: "2026-10-27", source: "FBIL", note: "", noRate: false })).toEqual(
      {
        ok: true,
        value: { rate: "83.1234", date: "2026-10-27", source: "FBIL" },
      },
    );
    for (const bad of ["", "0", "83.12345", "-1", "1e2", "83,12"])
      expect(checkFx({ rate: bad, date: "2026-10-27", source: "RBI", note: "", noRate: false })).toEqual({
        ok: false,
        errors: { rate: INVT_COPY.fxError },
      });
  });

  it("'Other' needs its description; the stored label maps back to its code", () => {
    expect(checkFx({ rate: "83", date: "2026-10-27", source: "OTHER", note: " ", noRate: false })).toEqual({
      ok: false,
      errors: { note: "Describe where the rate comes from." },
    });
    expect(
      checkFx({ rate: "83", date: "2026-10-27", source: "OTHER", note: " Sample bank rate ", noRate: false }),
    ).toEqual({
      ok: true,
      value: { rate: "83", date: "2026-10-27", source: "OTHER", sourceNote: "Sample bank rate" },
    });
    expect(
      fxFormOf({ rate: "83.1234", date: "2026-10-26", source: "RBI reference rate" }, "2026-10-27"),
    ).toEqual({
      rate: "83.1234",
      date: "2026-10-26",
      source: "RBI",
      note: "",
      noRate: false,
    });
    expect(
      fxFormOf({ rate: "83.1", date: "2026-10-26", source: "Sample bank rate" }, "2026-10-27"),
    ).toMatchObject({
      source: "OTHER",
      note: "Sample bank rate",
    });
    expect(fxFormOf(null, "2026-10-27")).toEqual({
      rate: "",
      date: "2026-10-27",
      source: "FBIL",
      note: "",
      noRate: false,
    });
  });
});

describe("the payment received against a proforma (Q9)", () => {
  it("the amount is parsed by core, never above the balance; a reference is needed", () => {
    expect(
      checkAdvance({ amount: "10,000", date: "2026-10-27", reference: "UTR1" }, "INR", 4_720_000),
    ).toEqual({
      ok: true,
      amountMinor: 1_000_000,
    });
    expect(
      checkAdvance({ amount: "47,200.01", date: "2026-10-27", reference: "UTR1" }, "INR", 4_720_000),
    ).toEqual({
      ok: false,
      errors: { amount: INVT_COPY.exceedsBalance },
    });
    const r = checkAdvance({ amount: "", date: "2026-10-27", reference: "" }, "USD", 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.reference).toBe("Enter the payment reference.");
    const zero = checkAdvance({ amount: "0", date: "2026-10-27", reference: "UTR1" }, "INR", 100);
    expect(zero).toEqual({ ok: false, errors: { amount: "Enter an amount above zero." } });
  });

  it("the rate's date follows 'Date received' until the Owner picks its own (review 2, 1)", () => {
    const fx = { rate: "84.2", date: "2026-10-27", source: "FBIL" as const, note: "", noRate: false };
    expect(rateDateFollows(fx, false, "2026-10-20")).toEqual({ ...fx, date: "2026-10-20" });
    expect(rateDateFollows(fx, true, "2026-10-20")).toBe(fx);
    expect(rateDateFollows(fx, false, "")).toBe(fx);
  });

  it("each error has its own field and the focus goes to the first drawn (review 2, 2)", () => {
    // The rate's date error is under the rate's date, never under "Date received".
    expect(advanceFocus({ fxDate: "x" })).toBe("adv-fx-date");
    expect(advanceFocus({ fxDate: "x", date: "y" })).toBe("adv-date");
    expect(advanceFocus({ note: "x", rate: "y" })).toBe("adv-fx-rate");
    expect(advanceFocus({ reference: "x", rate: "y" })).toBe("adv-ref");
    expect(advanceFocus({})).toBeNull();
    expect(ADVANCE_FIELDS.map(([, id]) => id)).toEqual([
      "adv-amount",
      "adv-date",
      "adv-ref",
      "adv-fx-rate",
      "adv-fx-date",
      "adv-fx-note",
    ]);
  });

  it("a refused advance puts the rate's date blocker under its field and lists the rest", () => {
    const r = splitAdvanceRefusal([{ code: "fx_date_invalid" }, { code: "country_missing" }]);
    expect(r.rateDate).toEqual({ code: "fx_date_invalid" });
    expect(r.rest).toEqual([{ code: "country_missing" }]);
    expect(splitAdvanceRefusal([{ code: "lut_missing", fy: "2627" }])).toEqual({
      rateDate: null,
      rest: [{ code: "lut_missing", fy: "2627" }],
    });
    expect(blockerLine({ code: "fx_date_invalid", date: "2026-10-20" }, "USD", { maxAgeDays: 7 })).toBe(
      "Use the rate published on 20 Oct 2026. If none was published that day, use the last one published before it, at most 7 days earlier.",
    );
    // S §8: the "same day exists" refusal goes under the rate's date too
    expect(splitAdvanceRefusal([{ code: "fx_same_day_exists" }]).rateDate).toEqual({
      code: "fx_same_day_exists",
    });
  });

  it("step 5: the 'no rate that day' statement is sent only when it is said, and asked only for an earlier day (S §8)", () => {
    const base = { rate: "84.2", date: "2026-10-24", source: "FBIL" as const, note: "" };
    expect(checkFx({ ...base, noRate: true })).toEqual({
      ok: true,
      value: { rate: "84.2", date: "2026-10-24", source: "FBIL", noRateThatDay: true },
    });
    expect(checkFx({ ...base, noRate: false })).toEqual({
      ok: true,
      value: { rate: "84.2", date: "2026-10-24", source: "FBIL" },
    });
    expect(rateDayEarlier("2026-10-24", "2026-10-27")).toBe(true);
    expect(rateDayEarlier("2026-10-27", "2026-10-27")).toBe(false);
    expect(rateDayEarlier("2026-10-24", null)).toBe(false);
    expect(
      fxFormOf(
        { rate: "84.2", date: "2026-10-24", source: "FBIL reference rate", noRateThatDay: true },
        "2026-10-27",
      ),
    ).toMatchObject({ noRate: true });
    expect(INVT_COPY.fxNoRateThatDay).toBe("No rate was published that day");
  });

  it("step 5: Q37's lines (S §9) and the house rules (S §3), word for word", () => {
    expect(advanceLutMissing("2027-28")).toBe(
      "There's no LUT saved for FY 2027-28, when this payment was received, so this tax invoice can't be issued without IGST. Save that year's LUT ARN in Settings › Tax first, or issue it with IGST.",
    );
    expect(INVT_COPY.advanceRouteLegend).toBe("This payment's year has no LUT");
    expect(INVT_COPY.advanceRouteSaveLut).toBe("Save the LUT first");
    expect(INVT_COPY.advanceRouteIgst).toBe("Issue with IGST");
    expect(INVT_COPY.advanceIgstNote).toBe(
      "IGST at 18 % is charged on this payment. The proforma's other payments are not affected.",
    );
    expect(advanceLine("TH/PI/2627/0001", "1 Mar 2027", "2 Apr 2027", "2027-28")).toBe(
      "Against proforma TH/PI/2627/0001 of 1 Mar 2027, payment received on 2 Apr 2027. Issued with IGST: no LUT was in place for FY 2027-28.",
    );
    expect(blockerLine({ code: "advance_lut_missing", fy: "2728" }, "USD")).toBe(
      advanceLutMissing("2027-28"),
    );
    expect(blockerTarget({ code: "advance_lut_missing" }, "c1")).toMatchObject({ to: "/settings/tax#luts" });
    expect(
      invErrorText(new RequestError(409, "advance_lut_missing", "x", null, [], [], [], { fy: "2728" })),
    ).toBe(advanceLutMissing("2027-28"));
    expect(INVT_COPY.checklistIntro).toBe(
      'Issuing is blocked while anything ticked here is missing. The defaults follow GST Rule 46. Items marked "House rule" aren\'t required by GST law; you can turn them off.',
    );
    expect(INVT_COPY.checklistLocked).toBe("Required by GST law, so it can't be turned off.");
    expect(INVT_COPY.houseRule).toBe("House rule");
    // 07-ZC line 3 (T4, rt2)
    expect(INVT_COPY.signatoryScope).toBe(
      "This switch covers tax invoices, export invoices and proformas only.",
    );
    expect(HOUSE_RULE_IDS).toEqual(["bankDetails", "paymentLink", "signatory"]);
    expect(isHouseRule({ id: "signatory" })).toBe(true);
    expect(isHouseRule({ id: "companyNames" })).toBe(false);
    expect(isHouseRule({ id: "companyNames", houseRule: true })).toBe(true);
  });

  it("07-S §8 lines of the advance and the proforma, word for word", () => {
    expect(INVT_COPY.dateReceivedMissing).toBe("Enter the date the payment was received.");
    expect(INVT_COPY.serviceDateMissing).toBe("Enter the date the service was completed.");
    expect(INVT_COPY.fxNoteLabel).toBe("Describe the source");
    expect(INVT_COPY.routeLegend).toBe("How is GST handled on this export?");
    expect([INVT_COPY.routeLut, INVT_COPY.routeIgst]).toEqual(["Under LUT, without IGST", "With IGST paid"]);
    expect(proformaDraftTitle("Sample Client (fake)")).toBe("Draft proforma for Sample Client (fake)");
    expect(proformaLockedLine("27 Oct 2026", "Asha (fake)")).toBe(
      "Issued 27 Oct 2026 by Asha (fake). This proforma is locked. If it's wrong and it hasn't been emailed, opened by the client, paid or converted, void it and issue a new one.",
    );
    expect(invErrorText(new RequestError(409, "advance_supply_changed", "x"))).toBe(
      "The client's GST details changed after this proforma was issued, so the tax on this payment can't be worked out from it. Check the client's details with your CA before recording the payment.",
    );
  });

  it("an earlier month only warns (Q27)", () => {
    expect(arrivedEarlierMonth("2026-09-30", "2026-10-01")).toBe(true);
    expect(arrivedEarlierMonth("2026-10-01", "2026-10-31")).toBe(false);
  });
});

describe("the letters of undertaking", () => {
  it("one per financial year, an ARN of letters and digits (spaces dropped, upper case)", () => {
    expect(cleanArn(" ad 19 1026 ")).toBe("AD191026");
    expect(checkLut({ fy: "2627", arn: "ad 1910", filedOn: "" }, [])).toEqual({
      ok: true,
      value: { fy: "2627", arn: "AD1910", filedOn: null },
    });
    expect(
      checkLut({ fy: "2627", arn: "AD1", filedOn: "2026-03-20" }, [{ fy: "2627", arn: "X", filedOn: null }]),
    ).toEqual({
      ok: false,
      errors: { fy: INVT_COPY.lutDuplicate },
    });
    expect(checkLut({ fy: "2728", arn: "AD-1", filedOn: "" }, [])).toEqual({
      ok: false,
      errors: { arn: INVT_COPY.lutArnMissing },
    });
    expect(fyLabel("2627")).toBe("2026-27");
    expect(
      lutsByYear([
        { fy: "2526", arn: "A", filedOn: null },
        { fy: "2627", arn: "B", filedOn: null },
      ]).map((l) => l.fy),
    ).toEqual(["2627", "2526"]);
  });
});

describe("the purpose code", () => {
  it("P and four digits (core's PURPOSE_CODE), upper-cased; empty clears it", () => {
    expect(checkPurposeCode(" p0802 ")).toEqual({ ok: true, value: "P0802" });
    expect(checkPurposeCode("")).toEqual({ ok: true, value: null });
    expect(checkPurposeCode("P802").ok).toBe(false);
  });
});
