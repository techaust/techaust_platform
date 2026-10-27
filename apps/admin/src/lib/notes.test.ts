// The credit and debit note screens' pure rules [ADM-INV-11, ADM-INV-01, ADM-SET-04]: 07-T word for word, the badges, the deadline banner, the
// notes section's lines, the error and blocker sentences, the request a dialog sends, and the annual return dates of Settings › Tax.
import { CREDIT_REASONS, DEBIT_REASONS, NOTE_BLOCKER_CODES } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import { BADGE_PILLS, badgeOf } from "./invoices.ts";
import {
  ANNUAL_RETURN_ERRORS,
  annualReturnError,
  annualReturnsOf,
  annualReturnYears,
  balanceLine,
  buildNoteFields,
  closestButton,
  deadlineBanner,
  effectLine,
  emptyNoteForm,
  firstErrorKey,
  firstFilingDay,
  INV_PLACEHOLDER,
  lineHint,
  NOTE_COPY,
  noteBlockerLine,
  noteDialogTitle,
  noteErrorText,
  noteFormOf,
  noteIssuedToast,
  noteRequestRow,
  rateLine,
  reasonsOf,
  reasonText,
  refundLine,
  splitDraftLine,
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

  it("the reasons: core's codes in 07-T's words (credit five, debit two: Q35)", () => {
    expect(reasonsOf("credit").map((r) => r.code)).toEqual([...CREDIT_REASONS]);
    expect(reasonsOf("credit").map((r) => r.label)).toEqual([
      "Price correction",
      "Service not delivered",
      "Service deficient",
      "Discount after sale",
      "Other",
    ]);
    expect(reasonsOf("debit").map((r) => r.code)).toEqual([...DEBIT_REASONS]);
    expect(reasonsOf("debit").map((r) => r.label)).toEqual(["Price correction", "Other"]);
    expect(reasonText({ code: "other", text: " Duplicate charge " })).toBe("Duplicate charge");
    expect(reasonText({ code: "service_deficient", text: "" })).toBe("Service deficient");
  });

  it("the notes section's lines (the singular of one note is listed in the run file)", () => {
    expect(balanceLine("₹40,560.00", 2)).toBe("Balance due: ₹40,560.00 (after 2 notes)");
    expect(balanceLine("₹40,560.00", 1)).toBe("Balance due: ₹40,560.00 (after 1 note)");
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

describe("the deadline banner (07-T §4; VERIFY WITH CA/LEGAL)", () => {
  it("before: the last day; within 30 days: the days left too; passed: the passed line in danger", () => {
    expect(deadlineBanner(deadline({}), "2627")).toEqual({
      tone: "info",
      lines: [
        "Credit notes for this invoice must be issued by 30 Nov 2027 (30 November after its financial year, or earlier if the annual return is filed).",
      ],
    });
    const near = deadlineBanner(deadline({ daysLeft: 12 }), "2627");
    expect(near.tone).toBe("warning");
    expect(near.lines[0]).toBe("Only 12 days left to issue a credit note for this invoice.");
    expect(deadlineBanner(deadline({ daysLeft: 1 }), "2627").lines[0]).toBe(
      "Only 1 day left to issue a credit note for this invoice.",
    );
    // on the last day itself the date says it
    expect(deadlineBanner(deadline({ daysLeft: 0 }), "2627").lines).toHaveLength(1);
    const gone = deadlineBanner(deadline({ passed: true, daysLeft: -3 }), "2627");
    expect(gone).toEqual({
      tone: "danger",
      lines: [
        "The deadline for a credit note on this invoice was 30 Nov 2027. A refund now can't reduce the GST already paid. Talk to your CA.",
      ],
    });
  });

  it("an annual return filed earlier: the day before it is the date shown", () => {
    const b = deadlineBanner(
      deadline({ basis: "annual_return", filedOn: "2027-09-20", lastDay: "2027-09-19" }),
      "2627",
    );
    expect(b.lines[0]).toContain("must be issued by 19 Sep 2027");
  });

  it("a supply year earlier than the invoice's says so", () => {
    const b = deadlineBanner(deadline({ supplyFy: "2526" }), "2627");
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

  it("a line for every note blocker code (none left as a placeholder, but the debit note's fully-credited line, which is the owner's to give)", () => {
    for (const code of NOTE_BLOCKER_CODES.filter((c) => c !== "debit_parent_fully_credited"))
      expect(
        noteBlockerLine({ code, line: 0, remaining: 100, date: "2027-11-30" }, "credit", "INR"),
      ).not.toBe(INV_PLACEHOLDER);
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
    });
    const a = { ...n, request: { mode: "amount", grossMinor: 590_000, takes: [] } } as unknown as NoteOfView;
    expect(noteFormOf(a, "INR").amount).toBe("5,900");
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
