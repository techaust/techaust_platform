// rt1 review 8 and re-check 5 [ADM-INV-11; Researched 2026-10-30, s.34(2) CGST Act; Rule 59(1)-(2) CGST Rules (IFF) (08-C RA-31, RA-03)]: the credit-note deadline's
// input is built in ONE place (`creditDeadlineOf`), for the note routes (`deadlineOf`) and the invoice's notes view (`invoiceNotesView`), so the banner and the refusal
// read the same facts: the invoice's FY and issue day, the advance's receipt day, the service completion day and the frozen recipient, whose status the builder picks
// itself (a damaged one is judged as unregistered, lead D2). Pure: no database.
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import type { InvoiceSettings } from "./invoice-model.ts";
import { creditDeadlineOf, type DeadlineSource, deadlineOf, type ParentCtx } from "./note-model.ts";

const settings = (gstr1Frequency: "quarterly" | "monthly" = "quarterly"): InvoiceSettings =>
  ({ tax: { ...SETTINGS_DEFAULTS.tax, gstr1Frequency } }) as unknown as InvoiceSettings;

type Status = "registered" | "unregistered" | "overseas";

const source = (
  o: Partial<DeadlineSource["row"]> & { extras?: DeadlineSource["extras"]; status?: Status } = {},
): DeadlineSource => ({
  row: {
    fy: o.fy ?? "2526",
    issue_date: o.issue_date ?? "2025-06-10",
    service_completed_on: o.service_completed_on,
  },
  extras: o.extras ?? {},
  recipient: { gstStatus: o.status ?? "registered" },
});

describe("creditDeadlineOf, the one builder of the deadline's input (rt1 review 8)", () => {
  it("the invoice's FY and the frozen recipient: 31 October for a registered client, 30 September for an unregistered or overseas one (quarterly)", () => {
    expect(creditDeadlineOf(source(), settings()).lastDay).toBe("2026-10-31");
    expect(creditDeadlineOf(source({ status: "unregistered" }), settings()).lastDay).toBe("2026-09-30");
    expect(creditDeadlineOf(source({ status: "overseas" }), settings()).lastDay).toBe("2026-09-30");
    expect(creditDeadlineOf(source({ status: "overseas" }), settings("monthly")).lastDay).toBe("2026-10-31");
  });

  it("rt1 re-check 5: it picks the status from the frozen recipient; a damaged one (none, no status, an unknown status) is judged as unregistered (D2)", () => {
    const unregistered = creditDeadlineOf(source({ status: "unregistered" }), settings());
    for (const recipient of [null, undefined, {}, { gstStatus: "composition" }, { gstStatus: "" }]) {
      const dl = creditDeadlineOf({ ...source(), recipient }, settings());
      expect(dl, JSON.stringify(recipient)).toEqual(unregistered);
      expect(dl.lastDay).toBe("2026-09-30");
    }
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
      recipient: { legalName: "X", country: "IN", gstStatus: "unregistered" },
      recipientStatus: "unregistered",
    } as unknown as ParentCtx;
    expect(deadlineOf(p, settings())).toEqual(
      creditDeadlineOf(source({ service_completed_on: "2025-02-01", status: "unregistered" }), settings()),
    );
    expect(deadlineOf(p, settings()).lastDay).toBe("2025-09-30");
  });
});
