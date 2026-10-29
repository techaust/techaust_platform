// The credit and debit note screens' pure rules [ADM-INV-11, ADM-INV-01, ADM-SET-04]: 07-T word for word, the badges, the deadline banner, the
// notes section's lines, the error and blocker sentences, the request a dialog sends, and the annual return dates of Settings › Tax.
import { CREDIT_REASONS, DEBIT_REASONS, NOTE_BLOCKER_CODES } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import { APPROVED_07Y, PLACEHOLDER_MARK } from "./copy-y.ts";
import { BADGE_PILLS, badgeOf } from "./invoices.ts";
import {
  AMOUNT_TOO_SMALL,
  ANNUAL_RETURN_ERRORS,
  annualReturnError,
  annualReturnsOf,
  annualReturnYears,
  balanceLine,
  buildNoteFields,
  closestButton,
  creditNoteCount,
  DEBIT_REASON_CODES,
  deadlineBanner,
  deadlineWarnLine,
  effectLine,
  emptyNoteForm,
  firstErrorKey,
  firstFilingDay,
  isTaxOnly,
  lineHint,
  NOTE_COPY,
  noteBlockerLine,
  noteDialogTitle,
  noteErrorText,
  noteFormOf,
  noteIssuedToast,
  noteLedgerRows,
  noteRequestRow,
  rateLine,
  reasonHint,
  reasonsOf,
  reasonText,
  refundLine,
  splitDraftLine,
  taxToAddHint,
} from "./notes.ts";
import type { CreditDeadlineView, NoteOfView } from "./notes-api.ts";

const deadline = (d: Partial<CreditDeadlineView>): CreditDeadlineView => ({
  date: "2027-11-30",
  lastDay: "2027-11-30",
  basis: "cutoff",
  supplyFy: "2627",
  filedOn: null,
  daysLeft: 120,
  passed: false,
  ...d,
});

describe("07-T §3 to §6 word for word", () => {
  it("the dialog's words", () => {
    expect(noteDialogTitle("credit", "TH/INV/2627/0007")).toBe("Credit note against TH/INV/2627/0007");
    expect(noteDialogTitle("debit", "TH/INV/2627/0007")).toBe("Debit note against TH/INV/2627/0007");
    expect([NOTE_COPY.modeLines, NOTE_COPY.modeAmount, NOTE_COPY.modeFull]).toEqual([
      "Credit some lines",
      "Credit an amount",
      "Credit the whole invoice",
    ]);
    expect(lineHint("₹4,000.00")).toBe("Before GST. Up to ₹4,000.00 can still be credited on this line.");
    expect(NOTE_COPY.amountLabel).toBe("Amount to credit (GST included)");
    expect(NOTE_COPY.finalStatement).toBe("Once issued, this note can't be changed.");
    expect(noteIssuedToast("credit", "TH/CN/2627/0001")).toBe("Credit note TH/CN/2627/0001 issued.");
    expect(noteIssuedToast("debit", "TH/DN/2627/0001")).toBe("Debit note TH/DN/2627/0001 issued.");
    expect(effectLine("credit", "TH/INV/2627/0007", "₹9,440.00")).toBe(
      "This credit note reduces the amount due on invoice TH/INV/2627/0007 by ₹9,440.00.",
    );
    expect(rateLine("83.1234", "TH/INV/2627/0007")).toBe(
      "Exchange rate: 1 USD = ₹83.1234 (the rate of invoice TH/INV/2627/0007)",
    );
    expect(closestButton("₹999.99")).toBe("Use ₹999.99");
    expect(noteRequestRow("Sample Staff", "credit", "Sample Client")).toBe(
      "Sample Staff asked you to issue a credit note for Sample Client.",
    );
  });

  it("the reasons: core's codes in 07-T's words (credit five, debit three: Q35, T §9)", () => {
    expect(reasonsOf("credit").map((r) => r.code)).toEqual([...CREDIT_REASONS]);
    expect(reasonsOf("credit").map((r) => r.label)).toEqual([
      "Price correction",
      "Service not delivered",
      "Service deficient",
      "Discount after sale",
      "Other",
    ]);
    // the step 5 contract's three codes, in T §9's order; every code core has is among them
    expect(reasonsOf("debit").map((r) => r.code)).toEqual([
      "price_correction",
      "tax_charged_too_low",
      "other",
    ]);
    for (const c of DEBIT_REASONS) expect(DEBIT_REASON_CODES).toContain(c);
    expect(reasonsOf("debit").map((r) => r.label)).toEqual([
      "Price correction",
      "Tax charged too low",
      "Other",
    ]);
    expect(reasonText({ code: "tax_charged_too_low", text: "" })).toBe("Tax charged too low");
    expect(reasonText({ code: "other", text: " Duplicate charge " })).toBe("Duplicate charge");
    expect(reasonText({ code: "service_deficient", text: "" })).toBe("Service deficient");
  });

  it("the notes section's lines (the singular of one note is listed in the run file)", () => {
    // FX-4 (A5 6): the line names what it counts, credit notes only (07-Y, marked while pending)
    const y = APPROVED_07Y ? "" : `${PLACEHOLDER_MARK} `;
    expect(balanceLine("₹40,560.00", 2)).toBe(`${y}Balance due: ₹40,560.00 (after 2 credit notes)`);
    expect(balanceLine("₹40,560.00", 1)).toBe(`${y}Balance due: ₹40,560.00 (after 1 credit note)`);
    expect(refundLine("₹1,180.00")).toBe(
      "Refund due to the client: ₹1,180.00. Refunds are recorded with payments.",
    );
    expect(splitDraftLine("credit")).toEqual([
      "There's already a draft credit note for this invoice. ",
      "Open it to continue.",
    ]);
  });
});

describe("badges (07-T §6, docs/06 §5.5)", () => {
  it("Partly credited and Credited; Overdue before Partly credited, never before Credited", () => {
    expect(badgeOf({ status: "partially_credited", overdue: false })).toBe("partly_credited");
    expect(badgeOf({ status: "partially_credited", overdue: true })).toBe("overdue");
    expect(badgeOf({ status: "credited", overdue: true })).toBe("credited");
    expect(badgeOf({ status: "paid", overdue: false })).toBe("paid");
    expect(BADGE_PILLS.partly_credited).toEqual({ tone: "warning", icon: "undo", outline: true });
    expect(BADGE_PILLS.credited).toEqual({ tone: "muted", icon: "undo" });
  });
});

describe("the deadline banner (07-T §4; Researched 2026-10-28, 08-C RA-03; the warning OPEN, RA-31)", () => {
  const BEFORE =
    "A credit note for this invoice must be reported in a GST return filed by 30 Nov 2027 (30 November after its financial year, or the day you file that year's annual return, if earlier).";
  const warnDl = (d: Partial<CreditDeadlineView>) =>
    deadline({ deadlineWarnFrom: "2027-10-01", adviseIssueBy: "2027-10-31", ...d });

  it("before: the return date; from the warning day: the days left lead, with the advice date; passed: the passed line in danger", () => {
    expect(deadlineBanner(warnDl({}), "2627", "2027-06-01")).toEqual({ tone: "info", lines: [BEFORE] });
    const near = deadlineBanner(warnDl({ daysLeft: 60 }), "2627", "2027-10-01");
    expect(near).toEqual({
      tone: "warning",
      lines: [
        "Only 60 days left for a credit note on this invoice. Issue it by 31 Oct 2027 so it goes into a return filed in time.",
        BEFORE,
      ],
    });
    // after the advice date it would come too late: the days left alone
    expect(deadlineBanner(warnDl({ daysLeft: 12 }), "2627", "2027-11-18").lines[0]).toBe(
      "Only 12 days left for a credit note on this invoice.",
    );
    expect(deadlineWarnLine(1, null)).toBe("Only 1 day left for a credit note on this invoice.");
    // an older API without the warning date: within 30 days, as before
    expect(deadlineBanner(deadline({ daysLeft: 12 }), "2627", "2027-11-18").tone).toBe("warning");
    expect(deadlineBanner(deadline({ daysLeft: 45 }), "2627", "2027-10-16").tone).toBe("info");
    // on the last day itself the date says it
    expect(deadlineBanner(warnDl({ daysLeft: 0 }), "2627", "2027-11-30").lines).toHaveLength(1);
    const gone = deadlineBanner(deadline({ passed: true, daysLeft: -3 }), "2627", "2027-12-03");
    expect(gone).toEqual({
      tone: "danger",
      lines: [
        "The deadline for a credit note on this invoice was 30 Nov 2027. A refund now can't reduce the GST already paid. Talk to your CA.",
      ],
    });
  });

  it("the advice line fills {advice date} from the server's date, whatever the month (finding 7); no date, no advice", () => {
    expect(
      deadlineBanner(
        warnDl({ daysLeft: 30, deadlineWarnFrom: "2027-05-01", adviseIssueBy: "2027-05-31" }),
        "2627",
        "2027-05-02",
      ).lines[0],
    ).toBe(
      "Only 30 days left for a credit note on this invoice. Issue it by 31 May 2027 so it goes into a return filed in time.",
    );
    // capped at the day before an annual return
    expect(
      deadlineBanner(warnDl({ daysLeft: 5, adviseIssueBy: "2027-10-14" }), "2627", "2027-10-10").lines[0],
    ).toContain("Issue it by 14 Oct 2027 so it goes");
    // on the advice day itself it is still said; the next day it is not
    expect(deadlineBanner(warnDl({ daysLeft: 30 }), "2627", "2027-10-31").lines[0]).toContain(
      "Issue it by 31 Oct 2027",
    );
    expect(deadlineBanner(warnDl({ daysLeft: 29 }), "2627", "2027-11-01").lines[0]).toBe(
      "Only 29 days left for a credit note on this invoice.",
    );
    expect(
      deadlineBanner(deadline({ deadlineWarnFrom: "2027-10-01", daysLeft: 30 }), "2627", "2027-10-31")
        .lines[0],
    ).toBe("Only 30 days left for a credit note on this invoice.");
  });

  it("an annual return filed earlier: the filing day is the date shown", () => {
    const b = deadlineBanner(
      deadline({ basis: "annual_return", filedOn: "2027-09-20", date: "2027-09-20", lastDay: "2027-09-19" }),
      "2627",
      "2027-06-01",
    );
    expect(b.lines[0]).toContain("filed by 20 Sep 2027");
  });

  it("a supply year earlier than the invoice's says so", () => {
    const b = deadlineBanner(deadline({ supplyFy: "2526" }), "2627", "2027-06-01");
    expect(b.lines.at(-1)).toBe(
      "The deadline counts from FY 2025-26, when the payment was received or the work was completed.",
    );
  });
});

describe("errors and blockers (07-T §7, §8)", () => {
  const err = (code: string, extra: ConstructorParameters<typeof RequestError>[7] = {}) =>
    new RequestError(409, code, "server words", null, [], [], [], extra);

  it("by code, with the figures the 409 carries", () => {
    expect(noteErrorText(err("credit_exceeds_remaining", { remaining: 400_000 }), "credit", "INR")).toBe(
      "That's more than can still be credited on this invoice (₹4,000.00).",
    );
    // the line is the invoice's index (0-based); the sentence numbers it as the invoice does
    expect(noteErrorText(err("line_credit_exceeds", { line: 1, remaining: 300_000 }), "credit", "INR")).toBe(
      "Line 2 can only be credited up to ₹3,000.00.",
    );
    expect(noteErrorText(err("credit_amount_unfit", { closestMinor: 99_999 }), "credit", "USD")).toBe(
      "Because of rounding, the nearest amount this credit note can be is $999.99. Use that amount instead?",
    );
    expect(noteErrorText(err("note_draft_exists", { draftId: "d1" }), "debit", "INR")).toBe(
      "There's already a draft debit note for this invoice. Open it to continue.",
    );
    expect(noteErrorText(err("notes_limit"), "credit", "INR")).toBe(
      "This invoice already has 20 credit notes, the most it can have.",
    );
    expect(noteErrorText(err("parent_changed"), "credit", "INR")).toBe(
      "Another credit or debit note was issued on this invoice a moment ago. Open it again to see what's left.",
    );
    expect(noteErrorText(err("ims_not_pending"), "credit", "INR")).toBe(
      "The client's IMS response is already recorded.",
    );
    // an invoice code keeps 07-R's line
    expect(noteErrorText(err("stale_version"), "credit", "INR")).toBe(
      "Someone else changed this since you opened it. Reload to see the latest version.",
    );
  });

  it("a line for every note blocker code, none left as a placeholder (T §9 gives the debit note's fully-credited line)", () => {
    for (const code of NOTE_BLOCKER_CODES)
      expect(
        noteBlockerLine({ code, line: 0, remaining: 100, date: "2027-11-30" }, "credit", "INR"),
      ).not.toBe(code);
    expect(noteBlockerLine({ code: "debit_parent_fully_credited" }, "debit", "INR")).toBe(
      "This invoice has been credited in full, so a debit note can't be issued against it. Issue a new invoice instead.",
    );
    expect(
      noteBlockerLine({ code: "line_credit_exceeds", line: 2, remaining: 50_000 }, "credit", "INR"),
    ).toBe("Line 3 can only be credited up to ₹500.00.");
    expect(noteBlockerLine({ code: "supplier_gstin" }, "credit", "INR")).toBe(
      "Add the company's GSTIN in Settings › Company.",
    );
    expect(noteBlockerLine({ code: "notes_limit" }, "debit", "INR")).toBe(
      "This invoice already has 20 debit notes, the most it can have.",
    );
  });
});

describe("the request a dialog sends", () => {
  const lines = [
    { line: 0, position: 1, taxableLeftMinor: 2_500_000 },
    { line: 1, position: 2, taxableLeftMinor: 0 },
    { line: 2, position: 3, taxableLeftMinor: 100_000 },
  ];
  const ctx = { currency: "INR" as const, lines, totalLeftMinor: 3_000_000 };
  const f = (patch: Partial<ReturnType<typeof emptyNoteForm>>) => ({ ...emptyNoteForm(), ...patch });

  it("lines: the typed amounts parsed through core, empty and zero lines left out", () => {
    expect(
      buildNoteFields(
        "credit",
        f({ lines: { 0: "5,000", 1: "", 2: "0" }, reasonCode: "price_correction" }),
        ctx,
      ),
    ).toEqual({
      ok: true,
      fields: { mode: "lines", lines: [{ line: 0, taxableMinor: 500_000 }], reasonCode: "price_correction" },
    });
  });

  it("lines: more than is left on a line, nothing chosen, an unreadable amount", () => {
    const over = buildNoteFields(
      "credit",
      f({ lines: { 2: "1,000.01" }, reasonCode: "other", reasonText: "x" }),
      ctx,
    );
    expect(over).toEqual({ ok: false, errors: { "line-2": "Line 3 can only be credited up to ₹1,000.00." } });
    const none = buildNoteFields("credit", f({ reasonCode: "price_correction" }), ctx);
    expect(none).toEqual({
      ok: false,
      errors: { lines: "Choose at least one line or an amount above zero." },
    });
    const bad = buildNoteFields("credit", f({ lines: { 0: "abc" }, reasonCode: "price_correction" }), ctx);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors["line-0"]).toBeTruthy();
    expect(firstErrorKey({ reason: "x", "line-2": "y" }, lines)).toBe("line-2");
  });

  it("amount: GST included, not above what is left; full: neither lines nor amount", () => {
    expect(
      buildNoteFields("credit", f({ mode: "amount", amount: "5,900", reasonCode: "service_deficient" }), ctx),
    ).toEqual({
      ok: true,
      fields: { mode: "amount", grossMinor: 590_000, reasonCode: "service_deficient" },
    });
    const over = buildNoteFields(
      "credit",
      f({ mode: "amount", amount: "30,000.01", reasonCode: "other" }),
      ctx,
    );
    expect(over).toEqual({
      ok: false,
      errors: {
        amount: "That's more than can still be credited on this invoice (₹30,000.00).",
        reasonText: "Enter a reason.",
      },
    });
    expect(buildNoteFields("credit", f({ mode: "full", reasonCode: "service_not_delivered" }), ctx)).toEqual({
      ok: true,
      fields: { mode: "full", reasonCode: "service_not_delivered" },
    });
  });

  it("the reason: required; Other needs its words; another reason never sends the words of an earlier Other", () => {
    const none = buildNoteFields("credit", f({ mode: "full" }), ctx);
    expect(none).toEqual({ ok: false, errors: { reason: "Enter a reason." } });
    const other = buildNoteFields(
      "credit",
      f({ mode: "full", reasonCode: "other", reasonText: " Duplicate " }),
      ctx,
    );
    expect(other).toEqual({
      ok: true,
      fields: { mode: "full", reasonCode: "other", reasonText: "Duplicate" },
    });
    const switched = buildNoteFields(
      "credit",
      f({ mode: "full", reasonCode: "price_correction", reasonText: "left over" }),
      ctx,
    );
    expect(switched).toEqual({ ok: true, fields: { mode: "full", reasonCode: "price_correction" } });
  });

  it("a debit note is by lines only, with no cap on the screen (the server decides)", () => {
    const d = buildNoteFields(
      "debit",
      f({ mode: "amount", lines: { 1: "2,000" }, reasonCode: "price_correction" }),
      {
        currency: "INR",
        lines: lines.map((l) => ({ ...l, taxableLeftMinor: Number.MAX_SAFE_INTEGER })),
        totalLeftMinor: null,
      },
    );
    expect(d).toEqual({
      ok: true,
      fields: { mode: "lines", lines: [{ line: 1, taxableMinor: 200_000 }], reasonCode: "price_correction" },
    });
  });

  it("a saved draft's request comes back into the form", () => {
    const n = {
      kind: "credit",
      reason: { code: "other", text: "Duplicate" },
      request: { mode: "lines", takes: [{ line: 2, taxableMinor: 50_000 }] },
    } as unknown as NoteOfView;
    expect(noteFormOf(n, "INR")).toEqual({
      mode: "lines",
      lines: { 2: "500" },
      amount: "",
      reasonCode: "other",
      reasonText: "Duplicate",
      tax: "",
    });
    const a = { ...n, request: { mode: "amount", grossMinor: 590_000, takes: [] } } as unknown as NoteOfView;
    expect(noteFormOf(a, "INR").amount).toBe("5,900");
    // a tax-only debit note as the API stores it: `taxMinor`, takes of taxable 0 (builder's contract)
    const t = {
      kind: "debit",
      reason: { code: "tax_charged_too_low", text: "" },
      request: { mode: "lines", taxMinor: 180_000, takes: [{ line: 0, taxableMinor: 0 }] },
    } as unknown as NoteOfView;
    expect(noteFormOf(t, "INR")).toMatchObject({
      lines: {},
      tax: "1,800",
      reasonCode: "tax_charged_too_low",
    });
  });
});

describe("Settings › Tax: the annual return of each year (07-T §4, §8; Q33)", () => {
  it("the two last completed years and any year saved, newest first", () => {
    // 27 Oct 2026 IST: FY 2026-27 is running, so 2025-26 and 2024-25 are offered
    const now = Date.UTC(2026, 9, 27, 6);
    expect(annualReturnYears(now, [])).toEqual([
      { token: "2526", label: "2025-26" },
      { token: "2425", label: "2024-25" },
    ]);
    expect(annualReturnYears(now, [{ fy: "2223", filedOn: "2023-12-01" }]).map((y) => y.token)).toEqual([
      "2526",
      "2425",
      "2223",
    ]);
  });

  it("a date before the year ended, or in the future, is refused; empty is no return", () => {
    expect(firstFilingDay("2526")).toBe("2026-04-01");
    expect(annualReturnError("2526", "2026-03-31", "2026-10-27")).toBe(ANNUAL_RETURN_ERRORS.beforeEnd);
    expect(ANNUAL_RETURN_ERRORS.beforeEnd).toBe(
      "The filing date must be after the end of that financial year.",
    );
    expect(annualReturnError("2526", "2026-10-28", "2026-10-27")).toBe(
      "The filing date can't be in the future.",
    );
    expect(annualReturnError("2526", "2026-04-01", "2026-10-27")).toBeNull();
    expect(annualReturnError("2526", "", "2026-10-27")).toBeNull();
    expect(annualReturnError("26", "2026-05-01", "2026-10-27")).toBe("Enter the financial year.");
    expect(annualReturnsOf({ "2425": "2025-11-30", "2526": "", "2324": "2024-12-01" })).toEqual([
      { fy: "2425", filedOn: "2025-11-30" },
      { fy: "2324", filedOn: "2024-12-01" },
    ]);
  });
});

describe("step 5: the T §9 lines and the tax-only debit note [Q35]", () => {
  const ctx = {
    currency: "INR" as const,
    lines: [{ line: 0, position: 1, taxableLeftMinor: 100 }],
    totalLeftMinor: null,
  };
  const f = (patch: Partial<ReturnType<typeof emptyNoteForm>>) => ({ ...emptyNoteForm(), ...patch });

  it("the hints and labels, word for word", () => {
    expect(reasonHint("tax_charged_too_low")).toBe(
      "Adds only the missing tax. The taxable value stays as invoiced.",
    );
    expect(reasonHint("discount_after_sale")).toBe(
      "For a discount agreed after the invoice. Your GST is reduced only once a registered client reverses the matching input tax credit.",
    );
    expect(reasonHint("price_correction")).toBeUndefined();
    expect(NOTE_COPY.taxToAdd).toBe("Tax to add");
    expect(taxToAddHint("TH/INV/2627/0007")).toBe(
      "Up to the difference between the tax due and the tax on invoice TH/INV/2627/0007.",
    );
    expect(NOTE_COPY.annualReturnHint).toBe(
      "Only if you file GSTR-9 for that year: it's optional up to ₹2 crore turnover. Once you enter the date, credit notes for that year are blocked.",
    );
    expect(AMOUNT_TOO_SMALL).toBe(
      "This amount is too small to credit after rounding. Enter a larger amount.",
    );
  });

  it("asks the tax to add, no lines; sends it as `taxAmountMinor` (the contract)", () => {
    expect(isTaxOnly("debit", "tax_charged_too_low")).toBe(true);
    expect(isTaxOnly("credit", "tax_charged_too_low")).toBe(false);
    expect(buildNoteFields("debit", f({ reasonCode: "tax_charged_too_low", tax: "1,800" }), ctx)).toEqual({
      ok: true,
      fields: { mode: "lines", taxAmountMinor: 180_000, reasonCode: "tax_charged_too_low" },
    });
    expect(buildNoteFields("debit", f({ reasonCode: "tax_charged_too_low", tax: "" }), ctx)).toEqual({
      ok: false,
      errors: { tax: "Enter an amount above zero." },
    });
    expect(firstErrorKey({ tax: "x", reason: "y" }, [])).toBe("tax");
  });

  it("an odd tax on an intra-state invoice is refused before it is sent, in 07-W 5.9's line; inter-state and export amounts may be odd", () => {
    const odd = f({ reasonCode: "tax_charged_too_low", tax: "1,800.01" });
    expect(buildNoteFields("debit", odd, { ...ctx, supplyType: "intra" })).toEqual({
      ok: false,
      errors: { tax: "Enter an even amount: it is split equally between CGST and SGST." },
    });
    for (const supplyType of ["inter", "export_igst", null, undefined]) {
      const built = buildNoteFields("debit", odd, { ...ctx, supplyType });
      expect(built.ok).toBe(true);
    }
    expect(
      buildNoteFields("debit", f({ reasonCode: "tax_charged_too_low", tax: "1,800.02" }), {
        ...ctx,
        supplyType: "intra",
      }).ok,
    ).toBe(true);
  });

  it("the server's odd-amount refusal (`details.reason`) shows the same line; any other debit_tax_only_invalid keeps the plain one", () => {
    const err = (extra: ConstructorParameters<typeof RequestError>[7]) =>
      new RequestError(400, "debit_tax_only_invalid", "server words", null, [], [], [], extra);
    expect(noteErrorText(err({ reason: "odd_amount" }), "debit", "INR")).toBe(
      "Enter an even amount: it is split equally between CGST and SGST.",
    );
    expect(noteErrorText(err({}), "debit", "INR")).toBe(
      'Enter tax only: the taxable value of a "Tax charged too low" note is zero.',
    );
  });

  it('"Tax charged too low" is not offered on an invoice under LUT (it carries no tax; 07-W 5.11), and the server refuses it too', () => {
    const codes = (s?: string | null) => reasonsOf("debit", s).map((r) => r.code);
    expect(codes("export_lut")).toEqual(["price_correction", "other"]);
    for (const s of ["intra", "inter", "export_igst", null, undefined])
      expect(codes(s)).toContain("tax_charged_too_low");
    // a credit note's list never changes
    expect(reasonsOf("credit", "export_lut").map((r) => r.code)).toEqual([...CREDIT_REASONS]);
  });

  it("the new refusals in T §9's words", () => {
    const err = (code: string, extra: ConstructorParameters<typeof RequestError>[7] = {}) =>
      new RequestError(400, code, "server words", null, [], [], [], extra);
    expect(noteErrorText(err("debit_tax_only_invalid"), "debit", "INR")).toBe(
      'Enter tax only: the taxable value of a "Tax charged too low" note is zero.',
    );
    expect(noteErrorText(err("discount_reason_not_in_force"), "credit", "INR")).toBe(
      "A credit note for a discount after sale can be dated from 1 November 2026.",
    );
    expect(noteErrorText(err("content_changed"), "credit", "INR")).toBe(
      "Another note was issued on this invoice since this draft was saved. Open the draft and save it again.",
    );
    expect(noteErrorText(err("credit_amount_unfit", { closestMinor: null }), "credit", "INR")).toBe(
      AMOUNT_TOO_SMALL,
    );
  });
});

describe("FX-4 (A5 6): the notes ledger names each row's type, and the balance counts only credit notes", () => {
  const row = (id: string, issueDate: string, number: string, type?: "credit_note" | "debit_note") => ({
    id,
    ...(type ? { type } : {}),
    number,
    issueDate,
    totalMinor: 1_000,
    status: "issued",
    imsStatus: null,
  });
  const notes = {
    credit: [
      row("c2", "2026-11-09", "TH/CN/2627/0002", "credit_note"),
      row("c1", "2026-11-02", "TH/CN/2627/0001"),
    ],
    debit: [
      row("d1", "2026-11-05", "TH/DN/2627/0001", "debit_note"),
      row("d0", "2026-11-02", "TH/DN/2627/0000"),
    ],
  };

  it("one ledger, oldest first (date, then number), each row with its kind and its type's name; an older API's row takes its list's type", () => {
    expect(noteLedgerRows(notes).map((r) => [r.id, r.type, r.kind, r.typeText])).toEqual([
      ["c1", "credit_note", "credit", "Credit note"],
      ["d0", "debit_note", "debit", "Debit note"],
      ["d1", "debit_note", "debit", "Debit note"],
      ["c2", "credit_note", "credit", "Credit note"],
    ]);
  });

  it("the balance line's count is the credit notes alone: two debit notes do not change it", () => {
    expect(creditNoteCount(notes)).toBe(2);
    expect(creditNoteCount({ credit: [] })).toBe(0);
  });

  it("early check L4: numbers sort as integers, never as text, and one day's notes follow the instant they were issued", () => {
    const at = (r: ReturnType<typeof row>, issuedAt?: number) =>
      issuedAt === undefined ? r : { ...r, issuedAt };
    // an older API (no instant): /9 before /10 on the same day
    const plain = noteLedgerRows({
      credit: [row("c10", "2026-11-02", "TH/CN/2627/10"), row("c9", "2026-11-02", "TH/CN/2627/9")],
      debit: [],
    });
    expect(plain.map((r) => r.id)).toEqual(["c9", "c10"]);
    // the instant wins over the number across series on one day; the date wins over both
    const mixed = noteLedgerRows({
      credit: [
        at(row("c10", "2026-11-02", "TH/CN/2627/10"), 3_000),
        at(row("c9", "2026-11-02", "TH/CN/2627/9"), 2_000),
        at(row("c1", "2026-11-01", "TH/CN/2627/1"), 9_000),
      ],
      debit: [at(row("d2", "2026-11-02", "TH/DN/2627/2"), 1_000)],
    });
    expect(mixed.map((r) => r.id)).toEqual(["c1", "d2", "c9", "c10"]);
    // a row without an instant comes after those with one on the same day
    const partial = noteLedgerRows({
      credit: [row("c3", "2026-11-02", "TH/CN/2627/3"), at(row("c4", "2026-11-02", "TH/CN/2627/4"), 5)],
      debit: [],
    });
    expect(partial.map((r) => r.id)).toEqual(["c4", "c3"]);
  });
});
