// Credit and debit notes, pure (M5.3; ADM-INV-11; Researched 2026-10-28, s.34(3) CGST Act, Rule 53 (08-C RA-22)): the reasons and limits, the stored request, the note blockers, the deadline (s.34(2)),
// the parent's ledger, `creditForGross` (with a property over random invoices and note sequences), the debit note's input, the IMS twin, and the sums of
// what the stored credit notes took.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { contentHash, contentHashInput, type DraftContent } from "../src/documents.ts";
import {
  balanceOf,
  CREDIT_REASONS,
  type CreditDeadline,
  canMoveInvoiceStatus,
  canSetImsStatus,
  creditAllowed,
  creditedSoFarOf,
  creditedSumOf,
  creditForGross,
  creditNoteAdvice,
  creditNoteDeadline,
  creditNotePeriod,
  DEBIT_REASONS,
  DISCOUNT_AFTER_SALE_FROM,
  debitNoteInput,
  GROSS_EVALUATIONS_MAX,
  GSTR1_FREQUENCIES,
  IMS_STATUSES,
  imsStatusAtIssue,
  isNoteReason,
  isNoteType,
  ledgerStatusOf,
  NOTE_BLOCKER_CODES,
  NOTE_REASON_TEXT_MAX,
  NOTES_MAX,
  type NoteFacts,
  type NoteOf,
  noteBlockers,
  noteKindOf,
  noteOfFromStored,
  noteTypeOf,
  reasonInForce,
  refundDueOf,
  takesTuples,
} from "../src/invoices.ts";
import {
  annualReturnEntry,
  resolveSetting,
  SETTINGS_DEFAULTS,
  taxSettings,
} from "../src/schemas/settings.ts";
import {
  type ComputedDocument,
  type CreditedSoFar,
  computeDocument,
  creditNote,
  type LineInput,
  roundingUnit,
} from "../src/tax/index.ts";
import {
  DATE,
  DEFAULTS,
  EXPORT_IGST,
  good,
  inrDoc,
  line,
  OVERSEAS_US,
  REG_MH,
  REG_WB,
} from "./tax/fixtures.ts";

const noteOf = (over: Partial<NoteOf> = {}): NoteOf => ({
  kind: "credit",
  parent: {
    id: "p1",
    type: "tax_invoice",
    fy: "2627",
    number: "TH/INV/2627/0001",
    issueDate: "2026-10-25",
    supplyType: "intra",
    recipientStatus: "registered",
    placeOfSupplyCode: "19",
    totalMinor: 118_000,
    totalInrMinor: null,
  },
  reason: { code: "price_correction", text: "" },
  request: { mode: "lines", takes: [{ line: 0, taxableMinor: 5_000 }] },
  ...over,
});

describe("kinds, reasons and limits", () => {
  it("the note types, their kinds and the reasons of 07-T (Q35, owner 2026-10-28: a debit note has three)", () => {
    expect(isNoteType("credit_note")).toBe(true);
    expect(isNoteType("debit_note")).toBe(true);
    expect(isNoteType("tax_invoice")).toBe(false);
    expect(noteKindOf("credit_note")).toBe("credit");
    expect(noteKindOf("debit_note")).toBe("debit");
    expect(noteTypeOf("credit")).toBe("credit_note");
    expect(noteTypeOf("debit")).toBe("debit_note");
    expect([...CREDIT_REASONS]).toEqual([
      "price_correction",
      "service_not_delivered",
      "service_deficient",
      "discount_after_sale",
      "other",
    ]);
    expect([...DEBIT_REASONS]).toEqual(["price_correction", "tax_charged_too_low", "other"]);
    expect(isNoteReason("credit", "service_deficient")).toBe(true);
    expect(isNoteReason("debit", "service_deficient")).toBe(false);
    expect(NOTE_REASON_TEXT_MAX).toBe(300);
    expect(NOTES_MAX).toBe(20);
  });

  it("a note can never be voided; the other invoice types can (while unsettled)", () => {
    for (const t of ["credit_note", "debit_note"])
      expect(canMoveInvoiceStatus(t, "issued", "void")).toBe(false);
    for (const t of ["tax_invoice", "export_invoice", "proforma"])
      expect(canMoveInvoiceStatus(t, "issued", "void")).toBe(true);
    // a note still moves through the ledger statuses and is issued from a draft
    expect(canMoveInvoiceStatus("credit_note", "draft", "issued")).toBe(true);
  });
});

describe("the stored request (header_extras.noteOf)", () => {
  it("reads back exactly what was written, in the writer's key order", () => {
    const n = noteOf({
      parent: { ...noteOf().parent, lut: { fy: "2627", arn: "AA1" } },
      request: { mode: "amount", grossMinor: 5_900, takes: [{ line: 0, taxableMinor: 5_000 }] },
      reason: { code: "other", text: "Scope reduced" },
    });
    const back = noteOfFromStored(JSON.parse(JSON.stringify(n)));
    expect(back).toEqual(n);
    expect(JSON.stringify(back)).toBe(JSON.stringify(n));
    expect(noteOfFromStored(JSON.parse(JSON.stringify(noteOf())))).toEqual(noteOf());
  });

  it("a tax-only debit request (Q35) keeps its tax amount, between the gross amount and the takes", () => {
    const n = noteOf({
      kind: "debit",
      reason: { code: "tax_charged_too_low", text: "" },
      request: { mode: "lines", taxMinor: 1_800, takes: [{ line: 0, taxableMinor: 0 }] },
    });
    const back = noteOfFromStored(JSON.parse(JSON.stringify(n)));
    expect(back).toEqual(n);
    expect(JSON.stringify(back)).toBe(JSON.stringify(n));
    expect(Object.keys((back as NoteOf).request)).toEqual(["mode", "taxMinor", "takes"]);
  });

  it("rt1 T2: a debit note's own LUT reads back last, after the request; a note without one has no key", () => {
    const n: NoteOf = {
      ...noteOf({ kind: "debit", parent: { ...noteOf().parent, lut: { fy: "2627", arn: "AA1" } } }),
      lut: { fy: "2728", arn: "AA2" },
    };
    const back = noteOfFromStored(JSON.parse(JSON.stringify(n)));
    expect(back).toEqual(n);
    expect(JSON.stringify(back)).toBe(JSON.stringify(n));
    expect(Object.keys(back as NoteOf)).toEqual(["kind", "parent", "reason", "request", "lut"]);
    expect(Object.keys(noteOfFromStored(JSON.parse(JSON.stringify(noteOf()))) as NoteOf)).not.toContain(
      "lut",
    );
  });

  it("anything damaged reads as none", () => {
    const good1 = JSON.parse(JSON.stringify(noteOf()));
    const bad: unknown[] = [
      null,
      [],
      "x",
      { ...good1, kind: "other" },
      { ...good1, parent: null },
      { ...good1, reason: [] },
      { ...good1, request: 1 },
      { ...good1, request: { ...good1.request, takes: "x" } },
      { ...good1, request: { ...good1.request, takes: [{ line: -1, taxableMinor: 1 }] } },
      { ...good1, request: { ...good1.request, takes: [{ line: 0, taxableMinor: 1.5 }] } },
      { ...good1, request: { ...good1.request, mode: "all" } },
      { ...good1, request: { ...good1.request, grossMinor: "5" } },
      { ...good1, request: { ...good1.request, taxMinor: 0 } },
      { ...good1, request: { ...good1.request, taxMinor: "5" } },
      { ...good1, reason: { code: 1, text: "" } },
      { ...good1, reason: { code: "x", text: 1 } },
      { ...good1, parent: { ...good1.parent, id: 1 } },
      { ...good1, parent: { ...good1.parent, type: "proforma" } },
      { ...good1, parent: { ...good1.parent, recipientStatus: "x" } },
      { ...good1, parent: { ...good1.parent, totalMinor: "1" } },
      { ...good1, parent: { ...good1.parent, totalInrMinor: "1" } },
      { ...good1, parent: { ...good1.parent, lut: "x" } },
      { ...good1, parent: { ...good1.parent, lut: { fy: 1, arn: "a" } } },
      { ...good1, lut: "x" },
      { ...good1, lut: { fy: "2728" } },
      { ...good1, lut: { fy: "2728", arn: 5 } },
    ];
    for (const b of bad) expect(noteOfFromStored(b), JSON.stringify(b)).toBeNull();
  });

  it("takes are [line, taxable] tuples", () => {
    expect(
      takesTuples([
        { line: 0, taxableMinor: 5 },
        { line: 3, taxableMinor: 9 },
      ]),
    ).toEqual([
      [0, 5],
      [3, 9],
    ]);
  });
});

const okFacts = (over: Partial<NoteFacts> = {}): NoteFacts => ({
  kind: "credit",
  currency: "INR",
  supplier: { legalName: "L", address: "A", gstin: "19ABCDE1234F1ZX", stateCode: "19" },
  parent: { status: "issued", totalMinor: 118_000, creditedMinor: 0 },
  issuedOfKind: 0,
  reason: { code: "price_correction", text: "" },
  request: { empty: false, exceeds: null },
  taxErrorCount: 0,
  totalMinor: 5_900,
  reverseChargeText: "Tax payable on reverse charge: No",
  deadline: { lastDay: "2027-11-30", passed: false },
  bank: { inr: true, swift: true },
  ...over,
});
const codes = (f: NoteFacts, bank = true) => noteBlockers(f, { bankDetails: bank }).map((b) => b.code);

describe("noteBlockers [LD50, Rule 53(1A)]", () => {
  it("a complete note has none", () => {
    expect(codes(okFacts())).toEqual([]);
    expect(codes(okFacts({ kind: "debit", deadline: null }))).toEqual([]);
  });

  it("the codes are their own list, separate from the invoice's (LD50)", () => {
    expect(NOTE_BLOCKER_CODES).toContain("credit_deadline_passed");
    expect(new Set(NOTE_BLOCKER_CODES).size).toBe(NOTE_BLOCKER_CODES.length);
  });

  it("'Discount after sale' is blocked for a note dated before 1 November 2026 (IST) and only then; a fact without a date is not judged (RA-02)", () => {
    expect(DISCOUNT_AFTER_SALE_FROM).toBe("2026-11-01");
    const discount = { reason: { code: "discount_after_sale", text: "" } };
    expect(codes(okFacts({ ...discount, issueDate: "2026-10-31" }))).toEqual([
      "discount_reason_not_in_force",
    ]);
    expect(codes(okFacts({ ...discount, issueDate: "2026-11-01" }))).toEqual([]);
    expect(codes(okFacts({ ...discount, issueDate: "2027-03-31" }))).toEqual([]);
    expect(codes(okFacts(discount))).toEqual([]);
    expect(codes(okFacts({ issueDate: "2026-10-31" }))).toEqual([]);
    expect(reasonInForce("discount_after_sale", "2026-10-31")).toBe(false);
    expect(reasonInForce("discount_after_sale", "2026-11-01")).toBe(true);
    expect(reasonInForce("price_correction", "2020-01-01")).toBe(true);
  });

  it("the supplier", () => {
    const f = okFacts({ supplier: { legalName: " ", address: null, gstin: "", stateCode: null } });
    expect(codes(f)).toEqual(["supplier_legal_name", "supplier_address", "supplier_gstin", "supplier_state"]);
  });

  it("the parent: void, fully credited (a credit note), a draft", () => {
    expect(codes(okFacts({ parent: { status: "void", totalMinor: 1, creditedMinor: 0 } }))).toEqual([
      "parent_void",
    ]);
    expect(codes(okFacts({ parent: { status: "draft", totalMinor: 1, creditedMinor: 0 } }))).toEqual([
      "parent_not_issued",
    ]);
    expect(codes(okFacts({ parent: { status: "credited", totalMinor: 100, creditedMinor: 100 } }))).toEqual([
      "parent_fully_credited",
    ]);
    expect(
      codes(okFacts({ parent: { status: "partially_credited", totalMinor: 100, creditedMinor: 100 } })),
    ).toEqual(["parent_fully_credited"]);
    // a debit note on a fully credited invoice has its own code (the credit note's wording would be wrong for it)
    expect(
      codes(
        okFacts({
          kind: "debit",
          deadline: null,
          parent: { status: "credited", totalMinor: 100, creditedMinor: 100 },
        }),
      ),
    ).toEqual(["debit_parent_fully_credited"]);
    expect(
      codes(
        okFacts({
          kind: "debit",
          deadline: null,
          parent: { status: "partially_credited", totalMinor: 100, creditedMinor: 100 },
        }),
      ),
    ).toEqual(["debit_parent_fully_credited"]);
    expect(
      codes(
        okFacts({
          kind: "debit",
          deadline: null,
          parent: { status: "paid", totalMinor: 100, creditedMinor: 0 },
        }),
      ),
    ).toEqual([]);
  });

  it("the request: nothing chosen, more than is left on the invoice or on a line", () => {
    expect(codes(okFacts({ request: { empty: true, exceeds: null }, totalMinor: null }))).toEqual([
      "nothing_to_credit",
    ]);
    const over = noteBlockers(
      okFacts({ request: { empty: false, exceeds: { line: null, remaining: 77 } } }),
      {
        bankDetails: true,
      },
    );
    expect(over).toEqual([{ code: "credit_exceeds_remaining", remaining: 77 }]);
    const line2 = noteBlockers(okFacts({ request: { empty: false, exceeds: { line: 2, remaining: 5 } } }), {
      bankDetails: true,
    });
    expect(line2).toEqual([{ code: "line_credit_exceeds", line: 2, remaining: 5 }]);
  });

  it("the deadline carries its date; a debit note has none", () => {
    expect(
      noteBlockers(okFacts({ deadline: { lastDay: "2027-11-30", passed: true } }), { bankDetails: true }),
    ).toEqual([{ code: "credit_deadline_passed", date: "2027-11-30" }]);
  });

  it("the reason: a code is needed, and `other` needs its words", () => {
    expect(codes(okFacts({ reason: { code: "", text: "" } }))).toEqual(["note_reason_required"]);
    expect(codes(okFacts({ reason: { code: "other", text: "  " } }))).toEqual(["note_reason_required"]);
    expect(codes(okFacts({ reason: { code: "other", text: "Scope reduced" } }))).toEqual([]);
  });

  it("the totals, the reverse-charge text and the limit", () => {
    expect(codes(okFacts({ taxErrorCount: 1, totalMinor: null }))).toEqual(["computed_errors"]);
    expect(codes(okFacts({ totalMinor: 0 }))).toEqual(["zero_total"]);
    expect(codes(okFacts({ reverseChargeText: " " }))).toEqual(["reverse_charge_text"]);
    expect(codes(okFacts({ issuedOfKind: NOTES_MAX }))).toEqual(["notes_limit"]);
    expect(codes(okFacts({ issuedOfKind: NOTES_MAX - 1 }))).toEqual([]);
  });

  it("only a debit note prints a bank block: it needs one when the checklist asks (INR account, or a SWIFT account for USD)", () => {
    const dn = (over: Partial<NoteFacts>) => okFacts({ kind: "debit", deadline: null, ...over });
    expect(codes(dn({ bank: { inr: false, swift: true } }))).toEqual(["bank_missing"]);
    expect(codes(dn({ currency: "USD", bank: { inr: true, swift: false } }))).toEqual(["swift_missing"]);
    expect(codes(dn({ bank: { inr: false, swift: false } }), false)).toEqual([]);
    // a credit note has no bank block
    expect(codes(okFacts({ bank: { inr: false, swift: false } }))).toEqual([]);
  });

  it("rt1 T2 [RA-19 Q39]: a debit note on an export under LUT needs the LUT of its own FY, last, with that FY; a credit note and a saved LUT are not judged", () => {
    expect(NOTE_BLOCKER_CODES.at(-1)).toBe("debit_lut_missing");
    expect(NOTE_BLOCKER_CODES.indexOf("notes_limit")).toBe(NOTE_BLOCKER_CODES.length - 2);
    const dn = (over: Partial<NoteFacts>) => okFacts({ kind: "debit", deadline: null, ...over });
    // no LUT (or a blank ARN, which the caller reads as not saved) for FY 2728
    expect(
      noteBlockers(dn({ lut: { needed: true, fy: "2728", saved: false } }), { bankDetails: true }),
    ).toEqual([{ code: "debit_lut_missing", fy: "2728" }]);
    // last, after the limit
    expect(codes(dn({ issuedOfKind: NOTES_MAX, lut: { needed: true, fy: "2728", saved: false } }))).toEqual([
      "notes_limit",
      "debit_lut_missing",
    ]);
    expect(codes(dn({ lut: { needed: true, fy: "2728", saved: true } }))).toEqual([]);
    // a parent that is not under LUT (igst_paid, domestic): not needed
    expect(codes(dn({ lut: { needed: false, fy: "2728", saved: false } }))).toEqual([]);
    expect(codes(dn({}))).toEqual([]);
    // a credit note is never judged on it
    expect(codes(okFacts({ lut: { needed: true, fy: "2728", saved: false } }))).toEqual([]);
  });
});

// rt1 T1: the filing of the return a credit note goes into (Researched 2026-10-30, s.34(2) CGST Act; Rule 59(1)-(2) CGST Rules (IFF) (08-C RA-31, RA-03)).
const MONTHLY_REG = { frequency: "monthly", recipientStatus: "registered" } as const;
const MONTHLY_UNREG = { frequency: "monthly", recipientStatus: "unregistered" } as const;
const MONTHLY_OVERSEAS = { frequency: "monthly", recipientStatus: "overseas" } as const;
const QRMP_REG = { frequency: "quarterly", recipientStatus: "registered" } as const;
const QRMP_UNREG = { frequency: "quarterly", recipientStatus: "unregistered" } as const;
const QRMP_OVERSEAS = { frequency: "quarterly", recipientStatus: "overseas" } as const;
const FILINGS = [MONTHLY_REG, MONTHLY_UNREG, MONTHLY_OVERSEAS, QRMP_REG, QRMP_UNREG, QRMP_OVERSEAS];

describe("creditNoteAdvice [rt1 R2, D3; 07-ZD]: the banner's dates follow the last day", () => {
  const fy2526 = { parentFy: "2526", parentIssueDate: "2025-10-05" };
  const cutoff = SETTINGS_DEFAULTS.tax.creditNoteCutoff;

  it("a registered client (or monthly filing): warn from 1 September, advise 31 October, the last day itself", () => {
    const dl = creditNoteDeadline(fy2526, cutoff, [], QRMP_REG);
    expect(dl.lastDay).toBe("2026-10-31");
    expect(creditNoteAdvice(dl)).toEqual({ deadlineWarnFrom: "2026-09-01", adviseIssueBy: "2026-10-31" });
    expect(creditNoteAdvice(creditNoteDeadline(fy2526, cutoff, [], MONTHLY_UNREG))).toEqual({
      deadlineWarnFrom: "2026-09-01",
      adviseIssueBy: "2026-10-31",
    });
  });

  it("an unregistered or overseas client of a quarterly filer: warn from 1 August, advise 30 September", () => {
    for (const filing of [QRMP_UNREG, QRMP_OVERSEAS]) {
      const dl = creditNoteDeadline(fy2526, cutoff, [], filing);
      expect(creditNoteAdvice(dl)).toEqual({ deadlineWarnFrom: "2026-08-01", adviseIssueBy: "2026-09-30" });
    }
  });

  it("a last day in January warns from 1 December of the year before; an unreadable date gives none", () => {
    expect(creditNoteAdvice({ lastDay: "2027-01-31" })).toEqual({
      deadlineWarnFrom: "2026-12-01",
      adviseIssueBy: "2027-01-31",
    });
    expect(creditNoteAdvice({ lastDay: "2028-02-29" })).toEqual({
      deadlineWarnFrom: "2028-01-01",
      adviseIssueBy: "2028-02-29",
    });
    expect(creditNoteAdvice({ lastDay: "soon" })).toEqual({ deadlineWarnFrom: null, adviseIssueBy: null });
  });

  it("an annual return filed before the cutoff moves both dates earlier with the last day", () => {
    const dl = creditNoteDeadline(fy2526, cutoff, [{ fy: "2526", filedOn: "2026-09-15" }], QRMP_REG);
    expect(dl.lastDay).toBe("2026-08-31");
    expect(creditNoteAdvice(dl)).toEqual({ deadlineWarnFrom: "2026-07-01", adviseIssueBy: "2026-08-31" });
  });
});

describe("creditNoteDeadline [s.34(2); Q32, Q33; rt1 R1; Researched 2026-10-30, s.34(2) CGST Act; Rule 59(1)-(2) CGST Rules (IFF) (08-C RA-31, RA-03)]", () => {
  const cutoff = { month: 11, day: 30 };
  const base = { parentFy: "2627", parentIssueDate: "2026-10-25" };
  const fy2526 = { parentFy: "2526", parentIssueDate: "2025-10-05" };

  it("FY 2025-26, the default cutoff: 31 October for monthly filing or a registered client, 30 September for a quarterly filer's unregistered or overseas client", () => {
    for (const filing of [MONTHLY_REG, MONTHLY_UNREG, MONTHLY_OVERSEAS, QRMP_REG]) {
      const d = creditNoteDeadline(fy2526, cutoff, [], filing);
      expect(d).toEqual({
        date: "2026-11-30",
        basis: "cutoff",
        supplyFy: "2526",
        filedOn: null,
        returnBy: "2026-11-30",
        period: "month",
        lastDay: "2026-10-31",
      });
    }
    for (const filing of [QRMP_UNREG, QRMP_OVERSEAS]) {
      const d = creditNoteDeadline(fy2526, cutoff, [], filing);
      expect(d.period).toBe("quarter");
      expect(d.lastDay).toBe("2026-09-30");
      expect(d.returnBy).toBe("2026-11-30");
    }
  });

  it("creditAllowed follows the last day, not the cutoff: 31 October is allowed, 1 November is not", () => {
    const d = creditNoteDeadline(fy2526, cutoff, [], QRMP_REG);
    expect(creditAllowed("2026-10-31", d)).toBe(true);
    expect(creditAllowed("2026-11-01", d)).toBe(false);
    expect(creditAllowed("2026-11-30", d)).toBe(false);
    const u = creditNoteDeadline(fy2526, cutoff, [], QRMP_UNREG);
    expect(creditAllowed("2026-09-30", u)).toBe(true);
    expect(creditAllowed("2026-10-01", u)).toBe(false);
  });

  it("rt1 F2: a cutoff of 31 January is the one AFTER the FY ends (2027-01-31 for FY 2025-26) and gives 31 December 2026 for every filing and recipient", () => {
    for (const filing of FILINGS) {
      const d = creditNoteDeadline(fy2526, { month: 1, day: 31 }, [], filing);
      expect(d.date).toBe("2027-01-31");
      expect(d.returnBy).toBe("2027-01-31");
      expect(d.lastDay).toBe("2026-12-31");
      expect(creditAllowed("2026-12-31", d)).toBe(true);
      expect(creditAllowed("2027-01-01", d)).toBe(false);
    }
  });

  it("rt1 F2: a cutoff of 31 March (FY 2025-26) is 2027-03-31: 28 February 2027 monthly, 31 December 2026 for a quarterly filer's unregistered client", () => {
    const march = { month: 3, day: 31 };
    for (const filing of [MONTHLY_REG, MONTHLY_UNREG, MONTHLY_OVERSEAS, QRMP_REG]) {
      expect(creditNoteDeadline(fy2526, march, [], filing)).toMatchObject({
        date: "2027-03-31",
        period: "month",
        lastDay: "2027-02-28",
      });
    }
    for (const filing of [QRMP_UNREG, QRMP_OVERSEAS]) {
      expect(creditNoteDeadline(fy2526, march, [], filing)).toMatchObject({
        date: "2027-03-31",
        period: "quarter",
        lastDay: "2026-12-31",
      });
    }
    // April onwards stays in the year the FY ends
    expect(creditNoteDeadline(fy2526, { month: 4, day: 30 }, [], MONTHLY_REG).date).toBe("2026-04-30");
  });

  it("a day past the month's end is clamped (31 November is the 30th; February by the year)", () => {
    expect(creditNoteDeadline(base, { month: 11, day: 31 }, [], QRMP_REG).date).toBe("2027-11-30");
    // a February cutoff is in the year after the FY ends (rt1 F2): FY 2022-23 -> February 2024 (leap), FY 2024-25 -> February 2026
    expect(
      creditNoteDeadline(
        { ...base, parentFy: "2223", parentIssueDate: "2022-05-01" },
        { month: 2, day: 31 },
        [],
        MONTHLY_REG,
      ),
    ).toMatchObject({ date: "2024-02-29", lastDay: "2024-01-31" });
    expect(
      creditNoteDeadline(
        { ...base, parentFy: "2425", parentIssueDate: "2024-05-01" },
        { month: 2, day: 31 },
        [],
        QRMP_UNREG,
      ),
    ).toMatchObject({ date: "2026-02-28", lastDay: "2025-12-31" });
    expect(creditNoteDeadline(base, { month: 12, day: 31 }, [], QRMP_REG)).toMatchObject({
      date: "2027-12-31",
      lastDay: "2027-11-30",
    });
  });

  it("the annual return (Q33, D4): filed on 15 September, the return is due by the 14th, so 31 August monthly and 30 June for a quarterly filer's unregistered client", () => {
    const filed = [{ fy: "2526", filedOn: "2026-09-15" }];
    const monthly = creditNoteDeadline(fy2526, cutoff, filed, MONTHLY_UNREG);
    expect(monthly).toEqual({
      date: "2026-11-30",
      basis: "annual_return",
      supplyFy: "2526",
      filedOn: "2026-09-15",
      returnBy: "2026-09-14",
      period: "month",
      lastDay: "2026-08-31",
    });
    expect(creditNoteDeadline(fy2526, cutoff, filed, QRMP_REG).lastDay).toBe("2026-08-31");
    expect(creditNoteDeadline(fy2526, cutoff, filed, QRMP_UNREG).lastDay).toBe("2026-06-30");
    expect(creditAllowed("2026-08-31", monthly)).toBe(true);
    expect(creditAllowed("2026-09-01", monthly)).toBe(false);
    expect(creditAllowed("2026-09-15", monthly)).toBe(false);
    // filed on the first of a month: the return is due by the last day of the month before, so the period before that is the last one
    expect(
      creditNoteDeadline(fy2526, cutoff, [{ fy: "2526", filedOn: "2026-10-01" }], MONTHLY_REG).lastDay,
    ).toBe("2026-08-31");
    // the return of another FY does not matter
    expect(creditNoteDeadline(base, cutoff, [{ fy: "2526", filedOn: "2026-01-01" }], QRMP_REG).basis).toBe(
      "cutoff",
    );
    // a return filed after the cutoff does not move it
    const late = creditNoteDeadline(base, cutoff, [{ fy: "2627", filedOn: "2028-01-15" }], QRMP_REG);
    expect(late).toMatchObject({
      basis: "cutoff",
      filedOn: "2028-01-15",
      returnBy: "2027-11-30",
      lastDay: "2027-10-31",
    });
    expect(creditAllowed("2027-10-31", late)).toBe(true);
    expect(creditAllowed("2027-11-01", late)).toBe(false);
    // a filing day that is not a date is ignored
    const junk = creditNoteDeadline(base, cutoff, [{ fy: "2627", filedOn: "soon" }], QRMP_REG);
    expect(junk.filedOn).toBeNull();
    expect(junk.basis).toBe("cutoff");
  });

  it("property: the last day is a period end strictly before the return deadline, a quarter never later than a month, and creditAllowed is exactly `day <= lastDay`", () => {
    const monthEndOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
    fc.assert(
      fc.property(
        fc.integer({ min: 2017, max: 2090 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        fc.option(fc.integer({ min: 0, max: 800 }), { nil: null }),
        fc.constantFrom(...FILINGS),
        (startYear, month, day, filedAfter, filing) => {
          const token = `${String(startYear % 100).padStart(2, "0")}${String((startYear + 1) % 100).padStart(2, "0")}`;
          const input = { parentFy: token, parentIssueDate: `${startYear}-06-01` };
          const filedOn =
            filedAfter === null
              ? []
              : [
                  {
                    fy: token,
                    filedOn: new Date(Date.UTC(startYear + 1, 3, 1 + filedAfter)).toISOString().slice(0, 10),
                  },
                ];
          const d = creditNoteDeadline(input, { month, day }, filedOn, filing);
          // rt1 F2: the cutoff always falls after the supply FY ends (31 March of startYear + 1)
          expect(d.date > `${startYear + 1}-03-31`).toBe(true);
          expect(d.lastDay < d.returnBy).toBe(true);
          expect(d.returnBy <= d.date).toBe(true);
          if (d.filedOn !== null && d.basis === "annual_return") expect(d.returnBy < d.filedOn).toBe(true);
          const [y, m, dd] = d.lastDay.split("-").map(Number) as [number, number, number];
          expect(dd).toBe(monthEndOf(y, m));
          if (d.period === "quarter") expect(m % 3).toBe(0);
          const monthly = creditNoteDeadline(input, { month, day }, filedOn, {
            frequency: "monthly",
            recipientStatus: filing.recipientStatus,
          });
          const quarterly = creditNoteDeadline(input, { month, day }, filedOn, {
            frequency: "quarterly",
            recipientStatus: "unregistered",
          });
          expect(quarterly.lastDay <= monthly.lastDay).toBe(true);
          expect(creditAllowed(d.lastDay, d)).toBe(true);
          const next = new Date(`${d.lastDay}T00:00:00Z`);
          next.setUTCDate(next.getUTCDate() + 1);
          expect(creditAllowed(next.toISOString().slice(0, 10), d)).toBe(false);
        },
      ),
    );
  });

  it("Q32: the supply FY is the earliest of the invoice's, the advance's receipt and the service (when invoiced more than 30 days later)", () => {
    // money received 28 March 2027 (FY 2627), the invoice dated 2 April 2027 (FY 2728)
    const advance = creditNoteDeadline(
      { parentFy: "2728", parentIssueDate: "2027-04-02", advanceReceivedOn: "2027-03-28" },
      cutoff,
      [],
      QRMP_REG,
    );
    expect(advance.supplyFy).toBe("2627");
    expect(advance.date).toBe("2027-11-30");
    expect(advance.lastDay).toBe("2027-10-31");
    // the service was completed 10 February 2027 and invoiced on 20 April (more than 30 days after): FY 2627
    const late = creditNoteDeadline(
      { parentFy: "2728", parentIssueDate: "2027-04-20", serviceCompletedOn: "2027-02-10" },
      cutoff,
      [],
      QRMP_REG,
    );
    expect(late.supplyFy).toBe("2627");
    // within 30 days of the service: the invoice's FY
    const soon = creditNoteDeadline(
      { parentFy: "2728", parentIssueDate: "2027-04-20", serviceCompletedOn: "2027-03-25" },
      cutoff,
      [],
      QRMP_REG,
    );
    expect(soon.supplyFy).toBe("2728");
    expect(soon.date).toBe("2028-11-30");
    // exactly 30 days is "within"
    expect(
      creditNoteDeadline(
        { parentFy: "2728", parentIssueDate: "2027-04-24", serviceCompletedOn: "2027-03-25" },
        cutoff,
        [],
        QRMP_REG,
      ).supplyFy,
    ).toBe("2728");
    // the dates only ever move it earlier; unreadable dates are ignored
    expect(
      creditNoteDeadline(
        { ...base, advanceReceivedOn: "2027-03-28", serviceCompletedOn: "x" },
        cutoff,
        [],
        QRMP_REG,
      ).supplyFy,
    ).toBe("2627");
    expect(
      creditNoteDeadline(
        { ...base, advanceReceivedOn: "x", serviceCompletedOn: "2026-01-01", parentIssueDate: "y" },
        cutoff,
        [],
        QRMP_REG,
      ).supplyFy,
    ).toBe("2627");
  });

  it("creditAllowed is the last day and the second clause of Q33 on any deadline", () => {
    const d: CreditDeadline = {
      date: "2027-11-30",
      basis: "cutoff",
      supplyFy: "2627",
      filedOn: "2027-06-01",
      returnBy: "2027-11-30",
      period: "month",
      lastDay: "2027-10-31",
    };
    expect(creditAllowed("2027-05-31", d)).toBe(true);
    // on or after the filing day: refused even before the last day (a deadline built by hand that does not hold the rule of `creditNoteDeadline`)
    expect(creditAllowed("2027-06-01", d)).toBe(false);
    expect(creditAllowed("2027-11-01", { ...d, filedOn: null })).toBe(false);
    expect(creditAllowed("2027-10-31", { ...d, filedOn: null })).toBe(true);
  });

  it("creditNotePeriod: a month unless a quarterly filer's client is unregistered or overseas (D2)", () => {
    expect(FILINGS.map(creditNotePeriod)).toEqual(["month", "month", "month", "month", "quarter", "quarter"]);
  });

  it("the settings' list of frequencies is core's", () => {
    expect([...GSTR1_FREQUENCIES]).toEqual(["quarterly", "monthly"]);
    for (const f of GSTR1_FREQUENCIES)
      expect(taxSettings.safeParse({ ...SETTINGS_DEFAULTS.tax, gstr1Frequency: f }).success).toBe(true);
  });
});

describe("the parent's ledger", () => {
  it("the status of an issued invoice for its figures", () => {
    expect(ledgerStatusOf(1000, 0, 0)).toBe("issued");
    expect(ledgerStatusOf(1000, 0, 1)).toBe("partially_credited");
    expect(ledgerStatusOf(1000, 0, 1000)).toBe("credited");
    expect(ledgerStatusOf(1000, 1000, 0)).toBe("paid");
    expect(ledgerStatusOf(1000, 1000, 1)).toBe("paid");
    expect(ledgerStatusOf(1000, 400, 0)).toBe("partially_paid");
    expect(ledgerStatusOf(1000, 400, 600)).toBe("paid");
    expect(ledgerStatusOf(1000, 400, 1000)).toBe("credited");
    expect(ledgerStatusOf(1000, 400, 100)).toBe("partially_paid");
  });

  it("the balance is never negative; the refund due is what is paid and credited above the total", () => {
    expect(balanceOf(1000, 0, 0)).toBe(1000);
    expect(balanceOf(1000, 400, 100)).toBe(500);
    expect(balanceOf(1000, 1000, 500)).toBe(0);
    expect(refundDueOf(1000, 1000, 500)).toBe(500);
    expect(refundDueOf(1000, 400, 100)).toBe(0);
    expect(refundDueOf(1000, 0, 1000)).toBe(0);
  });
});

describe("IMS status [Q14, LD46]", () => {
  it("only NULL to pending or not_applicable at the issue of a credit note, and pending to accepted or rejected after it", () => {
    for (const from of [null, ...IMS_STATUSES]) {
      for (const to of [...IMS_STATUSES, "x"]) {
        const atIssue = from === null && (to === "pending" || to === "not_applicable");
        const after = from === "pending" && (to === "accepted" || to === "rejected");
        expect(canSetImsStatus(from, to, true), `${String(from)}>${to} at issue`).toBe(atIssue);
        expect(canSetImsStatus(from, to, false), `${String(from)}>${to} after`).toBe(after);
      }
    }
    expect(canSetImsStatus("pending", "pending", false)).toBe(false);
  });

  it("a registered client answers in the portal (pending); everyone else is not applicable", () => {
    expect(imsStatusAtIssue("registered")).toBe("pending");
    expect(imsStatusAtIssue("unregistered")).toBe("not_applicable");
    expect(imsStatusAtIssue("overseas")).toBe("not_applicable");
  });
});

// ---- creditForGross -----------------------------------------------------------------------------------------------------------------------------

const zeroLine = { taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 };
const none = (n: number, inr = false): CreditedSoFar => ({
  lines: Array.from({ length: n }, () => zeroLine),
  creditedTotalMinor: 0,
  ...(inr ? { inr: { lines: Array.from({ length: n }, () => zeroLine), totalMinor: 0 } } : {}),
});

describe("creditForGross [LD44]", () => {
  const inv = () => good(inrDoc(REG_MH, [line(1_000_000), line(500_000, { sac: "998313" })]));

  it("an amount that covers what is left gives the full note", () => {
    const o = inv();
    for (const gross of [o.totalMinor, o.totalMinor + 1]) {
      const r = creditForGross(o, none(2), gross, DEFAULTS);
      expect(r.ok && r.full).toBe(true);
      expect(r.ok && r.document.totalMinor).toBe(o.totalMinor);
    }
  });

  it("a smaller amount gives the largest note not above it, within one rupee", () => {
    const o = inv();
    for (const gross of [100, 101, 118_000, 118_050, 1_000_000, 1_769_900, 1_769_999]) {
      const r = creditForGross(o, none(2), gross, DEFAULTS);
      expect(r.ok, String(gross)).toBe(true);
      if (!r.ok) continue;
      expect(r.document.totalMinor).toBeLessThanOrEqual(gross);
      expect(gross - r.document.totalMinor).toBe(r.gapMinor);
      expect(r.gapMinor).toBeLessThanOrEqual(100);
      expect(r.evaluations).toBeLessThanOrEqual(GROSS_EVALUATIONS_MAX);
      // the stored takes, run again as a lines request, give the very same document (LD44)
      const again = good(creditNote(o, none(2), { kind: "lines", lines: [...r.takes] }, DEFAULTS));
      expect(again).toEqual(r.document);
    }
  });

  it("an amount below what one whole rupee of credit costs is nothing to credit", () => {
    const r = creditForGross(inv(), none(2), 1, DEFAULTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["empty", "bound"]).toContain(r.reason);
  });

  it("zero, negative or fractional amounts are refused; a damaged original is the engine's error", () => {
    const o = inv();
    for (const g of [0, -5, 1.5, Number.NaN]) {
      const r = creditForGross(o, none(2), g, DEFAULTS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("empty");
    }
    const r = creditForGross(o, none(1), 500, DEFAULTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("engine");
    const full = creditForGross(o, none(1), o.totalMinor, DEFAULTS);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.reason).toBe("engine");
  });

  it("nothing left gives the engine's refusal (credit_empty), never a note", () => {
    const o = inv();
    const all = good(creditNote(o, none(2), { kind: "full" }, DEFAULTS));
    const so = soFarOf(o, [all]);
    const r = creditForGross(o, so, 100, DEFAULTS);
    expect(r.ok).toBe(false);
  });
});

/** CreditedSoFar from the notes issued so far, through the very functions the Worker uses (SQL rows are `creditedSumOf` rows). */
function soFarOf(o: ComputedDocument, notes: ComputedDocument[]): CreditedSoFar {
  const s = creditedSumOf(notes);
  const out = creditedSoFarOf(o, s.rows, s.totals);
  if (!out) throw new Error("damaged");
  return out;
}

describe("creditForGross: the bound that cannot always hold [LD44]", () => {
  // Measured case (found by a search over 60,000 random invoices, then scanned request by request): USD, 8 lines at mixed rates, an amount whose neighbours
  // (T-1 is 2 cents below it, T is 1 above) skip it: the nearest note is 2 cents below the amount, more than one rounding unit.
  const rates: [number, number][] = [
    [27_137_335, 2800],
    [25_097_680, 500],
    [41_492_858, 2800],
    [463_714, 0],
    [83_237_580, 2800],
    [52_274_453, 2800],
    [50_907_227, 2800],
    [4_767_560, 1800],
  ];
  it("reports the closest note instead of guessing, and that amount then works", () => {
    const o = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          recipient: OVERSEAS_US,
          exportMode: "igst_paid",
          lines: rates.map(([r, bp]) => line(r, { gstRateBp: bp })),
          fx: { rateMicros: 35_749_108 },
        },
        EXPORT_IGST,
      ),
    );
    const so = none(8, true);
    const gross = 312_247_610;
    const r = creditForGross(o, so, gross, EXPORT_IGST);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("bound");
    expect(r.closest?.gapMinor).toBe(2);
    const closest = r.closest;
    if (!closest) return;
    // typing the total of the closest note gives exactly that note
    const again = creditForGross(o, so, closest.document.totalMinor, EXPORT_IGST);
    expect(again.ok && again.gapMinor).toBe(0);
    expect(again.ok && again.document.totalMinor).toBe(closest.document.totalMinor);
    // more runs do not find a closer one (an exhaustive scan around the answer says none exists)
    const more = creditForGross(o, so, gross, EXPORT_IGST, 10);
    expect(more.ok).toBe(false);
  });

  it("every bound case of a seeded hunt: typing the closest total works and gives exactly that note (analyst item 1)", () => {
    // A small deterministic generator (the hunt must be the same on every machine): USD invoices of 6 to 12 lines at mixed rates, many amounts each.
    let seed = 20_261_027;
    const next = (max: number): number => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed % max;
    };
    const bps = [0, 500, 1200, 1800, 2800];
    let found = 0;
    for (let inv = 0; inv < 60; inv++) {
      const n = 6 + next(7);
      const o = good(
        computeDocument(
          {
            currency: "USD",
            documentDate: DATE,
            recipient: OVERSEAS_US,
            exportMode: "igst_paid",
            lines: Array.from({ length: n }, () =>
              line(1_000 + next(90_000_000), { gstRateBp: bps[next(bps.length)] ?? 0 }),
            ),
            fx: { rateMicros: 1_000_000 + next(200_000_000) },
          },
          EXPORT_IGST,
        ),
      );
      const so = none(n, true);
      for (let a = 0; a < 400; a++) {
        const gross = 1_000 + next(Math.max(1, o.totalMinor - 2_000));
        const r = creditForGross(o, so, gross, EXPORT_IGST);
        if (r.ok || r.reason !== "bound") continue;
        found++;
        const total = r.closest?.document.totalMinor ?? 0;
        const again = creditForGross(o, so, total, EXPORT_IGST);
        expect(again.ok, `closest ${total} for G=${gross}`).toBe(true);
        if (again.ok) {
          expect(again.document.totalMinor).toBe(total);
          expect(again.gapMinor).toBe(0);
        }
      }
    }
    expect(found, "the hunt must find bound cases or it proves nothing").toBeGreaterThan(0);
  }, 60_000);

  it("with fewer runs than it needs it still refuses honestly (never a total above the amount)", () => {
    const o = good(inrDoc(REG_MH, [line(1_000_000), line(500_000, { sac: "998313" })]));
    const r = creditForGross(o, none(2), 1_769_999, DEFAULTS, 1);
    if (r.ok) expect(r.document.totalMinor).toBeLessThanOrEqual(1_769_999);
    else expect(["bound", "empty"]).toContain(r.reason);
  });
});

describe("property: creditForGross over random invoices and note sequences (1 to 100 lines; INR intra and inter, USD LUT and IGST)", () => {
  const worst = { inr: 0, usd: 0, evals: 0 };
  let bounds = 0;
  let amounts = 0;
  const recipients = [REG_WB, REG_MH, OVERSEAS_US] as const;

  const invoiceOf = (
    which: number,
    exportMode: "lut" | "igst_paid",
    rates: { rate: number; bp: number }[],
    fx: number,
  ): ComputedDocument => {
    const lines: LineInput[] = rates.map((r) => line(r.rate, { gstRateBp: r.bp }));
    const recipient = recipients[which] as (typeof recipients)[number];
    if (recipient.gstStatus === "overseas")
      return good(
        computeDocument(
          {
            currency: "USD",
            documentDate: DATE,
            recipient,
            exportMode,
            lines,
            fx: { rateMicros: fx },
          },
          exportMode === "lut" ? { ...DEFAULTS, luts: [{ fy: "2627", arn: "A1" }] } : EXPORT_IGST,
        ),
      );
    return good(inrDoc(recipient, lines));
  };

  it("total never above the amount; within one rounding unit; the notes never exceed the invoice and the last one adds up exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 }),
        fc.constantFrom<"lut" | "igst_paid">("lut", "igst_paid"),
        fc.array(
          fc.record({
            rate: fc.integer({ min: 1_000, max: 90_000_000 }),
            bp: fc.constantFrom(0, 500, 1200, 1800, 2800),
          }),
          { minLength: 1, maxLength: 100 },
        ),
        fc.integer({ min: 1_000_000, max: 200_000_000 }),
        fc.array(fc.integer({ min: 1, max: 99 }), { minLength: 1, maxLength: 4 }),
        (which, mode, rates, fx, shares) => {
          const o = invoiceOf(which, mode, rates, fx);
          const ctx =
            o.currency === "USD"
              ? mode === "lut"
                ? { ...DEFAULTS, luts: [{ fy: "2627", arn: "A1" }] }
                : EXPORT_IGST
              : DEFAULTS;
          const unit = Number(roundingUnit(o.currency, ctx));
          const issued: ComputedDocument[] = [];
          for (const share of shares) {
            const so = soFarOf(o, issued);
            const left = o.totalMinor - so.creditedTotalMinor;
            if (left <= 0) break;
            // an amount between 1 % and 99 % of what is left
            const gross = Math.max(1, Math.trunc((left * share) / 100));
            const r = creditForGross(o, so, gross, ctx);
            amounts++;
            if (!r.ok) {
              if (r.reason === "bound") {
                // rare (about 1 in 8,000 amounts, several lines at different rates): the totals of neighbouring requests skip the amount; the closest note is reported
                bounds++;
                expect(r.closest, `G=${gross}`).toBeDefined();
                expect(r.closest?.document.totalMinor).toBeLessThanOrEqual(gross);
                expect(r.closest?.gapMinor).toBeGreaterThan(unit);
                expect(r.closest?.gapMinor).toBeLessThanOrEqual(4 * unit);
                // "Use {closest}" (the screen offers the closest amount): typing it must work and give exactly that note (analyst item 1)
                const closestTotal = r.closest?.document.totalMinor ?? 0;
                const again = creditForGross(o, so, closestTotal, ctx);
                expect(again.ok, `closest ${closestTotal} for G=${gross}`).toBe(true);
                if (again.ok) {
                  expect(again.document.totalMinor).toBe(closestTotal);
                  expect(again.gapMinor).toBe(0);
                }
              } else {
                // otherwise only an amount too small to buy any credit is refused
                expect(r.reason, `G=${gross}`).toBe("empty");
                expect(gross).toBeLessThan(1_000);
              }
              continue;
            }
            expect(r.document.totalMinor).toBeLessThanOrEqual(gross);
            expect(r.evaluations).toBeLessThanOrEqual(GROSS_EVALUATIONS_MAX);
            expect(r.gapMinor).toBeLessThanOrEqual(unit);
            worst[o.currency === "INR" ? "inr" : "usd"] = Math.max(
              worst[o.currency === "INR" ? "inr" : "usd"],
              r.gapMinor,
            );
            worst.evals = Math.max(worst.evals, r.evaluations);
            issued.push(r.document);
            // never above the original on any line, any head, or in total (INR view included)
            const after = soFarOf(o, issued);
            expect(after.creditedTotalMinor).toBeLessThanOrEqual(o.totalMinor);
            o.lines.forEach((l, i) => {
              const c = after.lines[i] as (typeof after.lines)[number];
              expect(c.taxableMinor).toBeLessThanOrEqual(l.taxableMinor);
              expect(c.cgstMinor).toBeLessThanOrEqual(l.cgstMinor);
              expect(c.sgstMinor).toBeLessThanOrEqual(l.sgstMinor);
              expect(c.igstMinor).toBeLessThanOrEqual(l.igstMinor);
            });
            if (o.inr && after.inr) expect(after.inr.totalMinor).toBeLessThanOrEqual(o.inr.totalMinor);
          }
          // the rest, in one final note: everything adds up to the invoice exactly, per line, per head and in total (and in INR)
          const so = soFarOf(o, issued);
          if (o.totalMinor - so.creditedTotalMinor > 0) {
            const finalNote = creditNote(o, so, { kind: "full" }, ctx);
            if (finalNote.ok) {
              issued.push(finalNote.value);
              const after = soFarOf(o, issued);
              expect(after.creditedTotalMinor).toBe(o.totalMinor);
              o.lines.forEach((l, i) => {
                expect(after.lines[i]).toEqual({
                  taxableMinor: l.taxableMinor,
                  cgstMinor: l.cgstMinor,
                  sgstMinor: l.sgstMinor,
                  igstMinor: l.igstMinor,
                });
              });
              if (o.inr && after.inr) expect(after.inr.totalMinor).toBe(o.inr.totalMinor);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
    // reported by the builder: the worst gaps seen (minor units) and the most engine runs one amount took
    expect(worst.inr).toBeLessThanOrEqual(100);
    expect(worst.usd).toBeLessThanOrEqual(1);
    expect(worst.evals).toBeLessThanOrEqual(GROSS_EVALUATIONS_MAX);
    expect(bounds).toBeLessThanOrEqual(Math.max(2, amounts / 100));
    console.info(
      `creditForGross worst gap: INR ${worst.inr} paise, USD ${worst.usd} cents; most runs: ${worst.evals}`,
    );
  });
});

describe("debitNoteInput [LD43, s.34(3)]", () => {
  const parent = () => good(inrDoc(REG_MH, [line(1_000_000), line(500_000, { sac: "998313" })]));

  it("a line per take at the parent line's SAC and rate, quantity one, the parent's supply, trustRates set here", () => {
    const p = parent();
    const r = debitNoteInput(
      { computed: p, recipientStatus: "registered" },
      [{ line: 1, taxableMinor: 12_300 }],
      DATE,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.trustRates).toBe(true);
    expect(r.input.supply).toEqual(p.supply);
    expect(r.input.lines).toEqual([{ sac: "998313", qtyMilli: 1000, rateMinor: 12_300, gstRateBp: 1800 }]);
    expect(r.input.fx).toBeNull();
    const doc = good(computeDocument(r.input, DEFAULTS));
    expect(doc.taxableMinor).toBe(12_300);
    expect(doc.igstMinor).toBe(2_214);
    expect(doc.supply.type).toBe("inter");
  });

  it("a USD export carries the parent's rate and route", () => {
    const p = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          recipient: OVERSEAS_US,
          exportMode: "igst_paid",
          lines: [line(10_000)],
          fx: { rateMicros: 83_000_000 },
        },
        EXPORT_IGST,
      ),
    );
    const r = debitNoteInput(
      { computed: p, recipientStatus: "overseas" },
      [{ line: 0, taxableMinor: 500 }],
      DATE,
    );
    expect(r.ok && r.input.fx).toEqual({ rateMicros: 83_000_000 });
    if (!r.ok) return;
    const doc = good(computeDocument(r.input, EXPORT_IGST));
    expect(doc.supply.type).toBe("export_igst");
    expect(doc.inr?.taxableMinor).toBe(41_500);
  });

  it("a take that names no line of the parent, twice, or not above zero is refused; nothing taken is refused", () => {
    const p = parent();
    const bad = (takes: { line: number; taxableMinor: number }[]) =>
      debitNoteInput({ computed: p, recipientStatus: "registered" }, takes, DATE);
    for (const takes of [
      [{ line: 2, taxableMinor: 5 }],
      [{ line: -1, taxableMinor: 5 }],
      [{ line: 0.5, taxableMinor: 5 }],
      [{ line: 0, taxableMinor: 0 }],
      [{ line: 0, taxableMinor: -1 }],
      [{ line: 0, taxableMinor: 1.5 }],
      [
        { line: 0, taxableMinor: 5 },
        { line: 0, taxableMinor: 6 },
      ],
    ]) {
      const r = bad(takes);
      expect(r.ok, JSON.stringify(takes)).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("credit_line_invalid");
    }
    const empty = bad([]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.map((e) => e.code)).toEqual(["credit_empty"]);
  });
});

describe("what the stored credit notes took", () => {
  it("rows to CreditedSoFar and back; a row for a line the original does not have, or a damaged figure, is null", () => {
    const o = good(inrDoc(REG_WB, [line(1_000), line(2_000), line(3_000)]));
    const a = good(
      creditNote(o, none(3), { kind: "lines", lines: [{ line: 1, taxableMinor: 500 }] }, DEFAULTS),
    );
    const b = good(
      creditNote(
        o,
        soFarOf(o, [a]),
        {
          kind: "lines",
          lines: [
            { line: 1, taxableMinor: 700 },
            { line: 2, taxableMinor: 100 },
          ],
        },
        DEFAULTS,
      ),
    );
    const s = creditedSumOf([a, b]);
    expect(s.totals.count).toBe(2);
    expect(s.totals.total).toBe(a.totalMinor + b.totalMinor);
    expect(s.rows.map((r) => [r.idx, r.taxable])).toEqual([
      [1, 1_200],
      [2, 100],
    ]);
    const so = creditedSoFarOf(o, s.rows, s.totals);
    expect(so?.lines[0]).toEqual(zeroLine);
    expect(so?.lines[1]?.taxableMinor).toBe(1_200);
    expect(so?.inr).toBeUndefined();
    expect(creditedSoFarOf(o, [{ ...(s.rows[0] as object), idx: 9 } as never], s.totals)).toBeNull();
    expect(creditedSoFarOf(o, [{ ...(s.rows[0] as object), taxable: 1.5 } as never], s.totals)).toBeNull();
    expect(creditedSoFarOf(o, s.rows, { ...s.totals, total: Number.NaN })).toBeNull();
  });

  it("a USD invoice has its INR view summed too", () => {
    const o = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          recipient: OVERSEAS_US,
          exportMode: "igst_paid",
          lines: [line(10_000), line(5_000)],
          fx: { rateMicros: 83_000_000 },
        },
        EXPORT_IGST,
      ),
    );
    const a = good(
      creditNote(o, none(2, true), { kind: "lines", lines: [{ line: 0, taxableMinor: 4_000 }] }, EXPORT_IGST),
    );
    const s = creditedSumOf([a]);
    expect(s.totals.totalInr).toBe(a.inr?.totalMinor);
    const so = creditedSoFarOf(o, s.rows, s.totals);
    expect(so?.inr?.totalMinor).toBe(a.inr?.totalMinor);
    expect(so?.inr?.lines[0]?.taxableMinor).toBe(a.lines[0]?.inr?.taxableMinor);
    // and a second note works from it
    expect(creditNote(o, so as CreditedSoFar, { kind: "full" }, EXPORT_IGST).ok).toBe(true);
    expect(creditedSoFarOf(o, s.rows, { ...s.totals, totalInr: 0.5 })).toBeNull();
  });
});

describe("the content hash of a note [LD39]", () => {
  const draft = (over: Partial<DraftContent> = {}): DraftContent => ({
    type: "credit_note",
    clientId: "c1",
    contactId: null,
    title: null,
    currency: "INR",
    validityDays: null,
    termsVersionId: null,
    discountKind: null,
    discountValue: null,
    exportMode: null,
    lines: [],
    sections: [],
    schedule: [],
    ...over,
  });
  const note = {
    parentId: "p1",
    kind: "credit",
    reasonCode: "price_correction",
    reasonText: "",
    mode: "lines",
    takes: [{ line: 0, taxableMinor: 5_000 }],
  };

  it("a draft without a note hashes as before (no key); with one, the note moves the hash, and so does each part of it", async () => {
    const base = await contentHash(draft(), null);
    expect(await contentHash(draft({ note: null }), null)).toBe(base);
    expect(await contentHash(draft({ note: undefined }), null)).toBe(base);
    expect(Object.keys(contentHashInput(draft(), null))).not.toContain("note");
    const withNote = await contentHash(draft({ note }), null);
    expect(withNote).not.toBe(base);
    for (const over of [
      { parentId: "p2" },
      { kind: "debit" },
      { reasonCode: "other" },
      { reasonText: "x" },
      { mode: "full" },
      { grossMinor: 118_000 },
      { takes: [{ line: 1, taxableMinor: 5_000 }] },
      { takes: [{ line: 0, taxableMinor: 5_001 }] },
    ])
      expect(await contentHash(draft({ note: { ...note, ...over } }), null), JSON.stringify(over)).not.toBe(
        withNote,
      );
  });

  it("the note sits between the lines and the schedule, and plain JSON.stringify equals canonical JSON", () => {
    const input = contentHashInput(draft({ note }), null);
    expect(Object.keys(input)).toEqual([
      "document",
      "lineTotals",
      "lines",
      "note",
      "schedule",
      "sections",
      "supply",
      "totals",
      "v",
    ]);
    expect(input.note).toEqual(["p1", "credit", "price_correction", "", "lines", null, [[0, 5_000]]]);
    // the amount typed in amount mode is part of the tuple (review item 2)
    expect(
      contentHashInput(draft({ note: { ...note, mode: "amount", grossMinor: 118_000 } }), null).note,
    ).toEqual(["p1", "credit", "price_correction", "", "amount", 118_000, [[0, 5_000]]]);
  });
});

describe("the GSTR-1 filing frequency (Settings > Tax) [rt1 R3, ADM-SET-03]", () => {
  it("defaults to quarterly (QRMP, owner 2026-10-31); a stored row without it reads quarterly", () => {
    expect(SETTINGS_DEFAULTS.tax.gstr1Frequency).toBe("quarterly");
    const { gstr1Frequency: _drop, ...without } = SETTINGS_DEFAULTS.tax;
    const r = taxSettings.safeParse(without);
    expect(r.success && r.data.gstr1Frequency).toBe("quarterly");
    expect(resolveSetting("tax", without).gstr1Frequency).toBe("quarterly");
  });

  it("monthly is kept; anything else is refused", () => {
    const tax = (v: unknown) => taxSettings.safeParse({ ...SETTINGS_DEFAULTS.tax, gstr1Frequency: v });
    const monthly = tax("monthly");
    expect(monthly.success && monthly.data.gstr1Frequency).toBe("monthly");
    for (const bad of ["weekly", "Quarterly", "", null, 3]) expect(tax(bad).success, String(bad)).toBe(false);
  });
});

describe("the annual returns filed (Settings > Tax) [G-11, Q33]", () => {
  it("defaults to none; a stored row without it reads as none", () => {
    expect(SETTINGS_DEFAULTS.tax.annualReturnsFiled).toEqual([]);
    const { annualReturnsFiled: _drop, ...without } = SETTINGS_DEFAULTS.tax;
    const r = taxSettings.safeParse(without);
    expect(r.success && r.data.annualReturnsFiled).toEqual([]);
  });

  it("an entry: the FY rule of the LUT list, a real date on or after 1 April after that FY", () => {
    const ok = (e: unknown) => annualReturnEntry.safeParse(e).success;
    expect(ok({ fy: "2627", filedOn: "2027-04-01" })).toBe(true);
    expect(ok({ fy: "2627", filedOn: "2027-09-20" })).toBe(true);
    expect(ok({ fy: "2627", filedOn: "2027-03-31" })).toBe(false);
    expect(ok({ fy: "2628", filedOn: "2027-09-20" })).toBe(false);
    expect(ok({ fy: "26", filedOn: "2027-09-20" })).toBe(false);
    expect(ok({ fy: "2627", filedOn: "2027-02-31" })).toBe(false);
    expect(ok({ fy: "2627", filedOn: "soon" })).toBe(false);
    expect(ok({ fy: "2627", filedOn: "2027-09-20", extra: 1 })).toBe(false);
  });

  it("at most 20, one per FY", () => {
    const tax = (list: unknown) =>
      taxSettings.safeParse({ ...SETTINGS_DEFAULTS.tax, annualReturnsFiled: list });
    expect(
      tax([
        { fy: "2627", filedOn: "2027-09-20" },
        { fy: "2526", filedOn: "2026-09-20" },
      ]).success,
    ).toBe(true);
    const dup = tax([
      { fy: "2627", filedOn: "2027-09-20" },
      { fy: "2627", filedOn: "2027-10-20" },
    ]);
    expect(dup.success).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => ({
      fy: `${String(i).padStart(2, "0")}${String(i + 1).padStart(2, "0")}`,
      filedOn: `20${String(i + 1).padStart(2, "0")}-09-20`,
    }));
    expect(tax(many).success).toBe(false);
    expect(tax(many.slice(0, 20)).success).toBe(true);
  });
});

describe("the annual returns errors are 07-T §8's words", () => {
  const messages = (v: unknown) => {
    const r = annualReturnEntry.safeParse(v);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };
  it("a missing or odd year, a date before the year ends", () => {
    expect(messages({ fy: "", filedOn: "2027-05-01" })).toContain("Enter the financial year.");
    expect(messages({ fy: "2628", filedOn: "2027-05-01" })).toContain("Enter the financial year.");
    expect(messages({ fy: "2627", filedOn: "2027-03-31" })).toEqual([
      "The filing date must be after the end of that financial year.",
    ]);
  });
  it("a second filing for one year", () => {
    const r = taxSettings.shape.annualReturnsFiled.safeParse([
      { fy: "2627", filedOn: "2027-05-01" },
      { fy: "2627", filedOn: "2027-06-01" },
    ]);
    expect(r.success ? [] : r.error.issues.map((i) => i.message)).toContain(
      "This year already has a filing date.",
    );
  });
});
