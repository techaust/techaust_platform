// M6.1 rules outside the ledger module: the void blockers of L17 [ADM-INV-02] and the FEMA extension of Q60 in the gst core [ADM-REP-07, L14; Researched
// 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-04); Rule 96A(1)(b) CGST Rules (08-C RA-20)].
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, type CalendarDate } from "../src/dates.ts";
import {
  addMonthsClamped,
  DEFAULT_REALISATION_RULES,
  realisationDates,
  realisationStatus,
} from "../src/gst/index.ts";
import { voidBlockers } from "../src/invoices.ts";

describe("voidBlockers: a payment waiting, an allocation, or TDS refuses a void (L17, L32)", () => {
  const base = {
    status: "issued",
    paidMinor: 0,
    creditedMinor: 0,
    hasIssuedChild: false,
    emailed: false,
    viewed: false,
    issueDate: "2026-10-05",
    today: "2026-10-31",
    tdsMinor: 0,
    paymentPending: false,
    paymentPendingGateway: false,
    paymentRecorded: false,
  };
  it("each has its code, and none when neither is there", () => {
    expect(voidBlockers(base)).toEqual([]);
    expect(voidBlockers({ ...base, paymentPending: true })).toEqual(["payment_pending"]);
    expect(voidBlockers({ ...base, paymentRecorded: true })).toEqual(["payment_recorded"]);
    // M6.2 (fix round 3 item 3): a pending Razorpay payment has its own code (it can't be rejected), a manual one keeps M6.1's
    expect(voidBlockers({ ...base, paymentPendingGateway: true })).toEqual(["payment_pending_gateway"]);
    expect(
      voidBlockers({ ...base, type: "proforma", paymentPending: true, paymentPendingGateway: true }),
    ).toEqual(["payment_pending", "payment_pending_gateway"]);
    expect(voidBlockers({ ...base, tdsMinor: 10 })).toEqual(["tds_recorded"]);
    expect(voidBlockers({ ...base, paymentPending: false, paymentRecorded: false, tdsMinor: 0 })).toEqual([]);
    // L32: a waiting payment and an allocation (one released since included) are told apart
    expect(voidBlockers({ ...base, paymentPending: true, paymentRecorded: true })).toEqual([
      "payment_pending",
      "payment_recorded",
    ]);
    expect(voidBlockers({ ...base, status: "partially_paid", tdsMinor: 10, paidMinor: 5 })).toEqual([
      "has_payment",
      "tds_recorded",
    ]);
  });
});

const d = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });

describe("realisationDates with the bank's extension (Q60)", () => {
  it("the FEMA date is the later of the standard date and the extension; the GST date follows it", () => {
    const plain = realisationDates({
      invoiceDate: d(2026, 11, 3),
      currency: "USD",
      supplyType: "export_lut",
    });
    expect(plain.ok && plain.value).toEqual({ femaDue: d(2027, 8, 3), gstDue: d(2027, 11, 18) });
    const ext = realisationDates({
      invoiceDate: d(2026, 11, 3),
      currency: "USD",
      supplyType: "export_lut",
      extendedTo: d(2028, 2, 29),
    });
    expect(ext.ok && ext.value).toEqual({ femaDue: d(2028, 2, 29), gstDue: d(2028, 3, 15) });
    // an "extension" before the standard date never shortens the period
    const early = realisationDates({
      invoiceDate: d(2026, 11, 3),
      currency: "USD",
      supplyType: "export_lut",
      extendedTo: d(2027, 1, 1),
    });
    expect(early.ok && early.value).toEqual(plain.ok && plain.value);
    const bad = realisationDates({
      invoiceDate: d(2026, 11, 3),
      currency: "USD",
      supplyType: "export_lut",
      extendedTo: d(2027, 2, 30),
    });
    expect(bad.ok).toBe(false);
  });

  it("an extension moves an overdue export back to ok (property: never earlier than without it)", () => {
    const today = d(2027, 9, 1);
    const without = realisationStatus(
      { invoiceDate: d(2026, 11, 3), currency: "USD", supplyType: "igst_paid" as never, outstandingMinor: 5 },
      today,
    );
    expect(without.ok && without.value.stage).toBe("fema_overdue");
    const withExt = realisationStatus(
      {
        invoiceDate: d(2026, 11, 3),
        currency: "USD",
        supplyType: "igst_paid" as never,
        outstandingMinor: 5,
        extendedTo: d(2028, 5, 3),
      },
      today,
    );
    expect(withExt.ok && withExt.value.stage).toBe("ok");
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1500 }), fc.integer({ min: 0, max: 1500 }), (a, b) => {
        const inv = addDays(d(2026, 1, 1), a);
        const ext = addDays(d(2026, 1, 1), b);
        const p = realisationDates({ invoiceDate: inv, currency: "INR", supplyType: "export_lut" });
        const e = realisationDates({
          invoiceDate: inv,
          currency: "INR",
          supplyType: "export_lut",
          extendedTo: ext,
        });
        if (!p.ok || !e.ok) throw new Error("dates");
        expect(p.value.femaDue).toEqual(addMonthsClamped(inv, DEFAULT_REALISATION_RULES.femaMonthsInr));
        const later = (x: CalendarDate, y: CalendarDate) =>
          x.year * 10_000 + x.month * 100 + x.day >= y.year * 10_000 + y.month * 100 + y.day ? x : y;
        expect(e.value.femaDue).toEqual(later(ext, p.value.femaDue));
      }),
    );
  });
});
