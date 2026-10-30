// rt1 review 8 [ADM-INV-11; Researched 2026-10-30, s.34(2) CGST Act; Rule 59(1)-(2) CGST Rules (IFF) (08-C RA-31, RA-03)]: the credit-note deadline's input is built in
// ONE place (`creditDeadlineOf`), for the note routes (`deadlineOf`) and the invoice's notes view (`invoiceNotesView`), so the banner and the refusal read the same facts:
// the invoice's FY and issue day, the advance's receipt day, the service completion day and the frozen recipient status. Pure: no database.
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import type { InvoiceSettings } from "./invoice-model.ts";
import { creditDeadlineOf, type DeadlineSource, deadlineOf, type ParentCtx } from "./note-model.ts";

const settings = (gstr1Frequency: "quarterly" | "monthly" = "quarterly"): InvoiceSettings =>
  ({ tax: { ...SETTINGS_DEFAULTS.tax, gstr1Frequency } }) as unknown as InvoiceSettings;

const source = (
  o: Partial<DeadlineSource["row"]> & Partial<Omit<DeadlineSource, "row">> = {},
): DeadlineSource => ({
  row: {
    fy: o.fy ?? "2526",
    issue_date: o.issue_date ?? "2025-06-10",
    service_completed_on: o.service_completed_on,
  },
  extras: o.extras ?? {},
  recipientStatus: o.recipientStatus ?? "registered",
});

describe("creditDeadlineOf, the one builder of the deadline's input (rt1 review 8)", () => {
  it("the invoice's FY and the frozen recipient: 31 October for a registered client, 30 September for an unregistered or overseas one (quarterly)", () => {
    expect(creditDeadlineOf(source(), settings()).lastDay).toBe("2026-10-31");
    expect(creditDeadlineOf(source({ recipientStatus: "unregistered" }), settings()).lastDay).toBe(
      "2026-09-30",
    );
    expect(creditDeadlineOf(source({ recipientStatus: "overseas" }), settings()).lastDay).toBe("2026-09-30");
    expect(creditDeadlineOf(source({ recipientStatus: "overseas" }), settings("monthly")).lastDay).toBe(
      "2026-10-31",
    );
  });

  it("an advance received in the FY before moves the supply FY (the header extras are read)", () => {
    const dl = creditDeadlineOf(
      source({ extras: { advance: { receivedOn: "2024-12-01" } } as DeadlineSource["extras"] }),
      settings(),
    );
    expect(dl.supplyFy).toBe("2425");
    expect(dl.lastDay).toBe("2025-10-31");
  });

  it("a service completed more than 30 days before the invoice moves it too; a missing completion day (the view's row) is none", () => {
    expect(creditDeadlineOf(source({ service_completed_on: "2025-02-01" }), settings()).supplyFy).toBe(
      "2425",
    );
    expect(creditDeadlineOf(source({ service_completed_on: undefined }), settings())).toEqual(
      creditDeadlineOf(source({ service_completed_on: null }), settings()),
    );
  });

  it("the note routes' `deadlineOf` is exactly this builder over the parent's row, extras and frozen recipient", () => {
    const p = {
      row: { fy: "2526", issue_date: "2025-06-10", service_completed_on: "2025-02-01" },
      extras: {},
      recipientStatus: "unregistered",
    } as unknown as ParentCtx;
    expect(deadlineOf(p, settings())).toEqual(
      creditDeadlineOf(
        source({ service_completed_on: "2025-02-01", recipientStatus: "unregistered" }),
        settings(),
      ),
    );
    expect(deadlineOf(p, settings()).lastDay).toBe("2025-09-30");
  });
});
