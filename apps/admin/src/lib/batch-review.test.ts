// The batch review fixes (2026-10-26): the 07-Q changed lines word for word, the owner's M7 and M8 lines, and the one date field's
// parsing (day first, DD/MM/YYYY, whatever the browser's locale; ISO in and out).
import { describe, expect, it } from "vitest";
import { NOT_SET } from "./catalogue.ts";
import {
  anyUnread,
  DATE_INVALID,
  dateEcho,
  dateError,
  fieldValue,
  INVALID_DATE,
  isoToTyped,
  isUnread,
  settledValue,
  syncedText,
  typedToIso,
  type UnreadDates,
  withUnread,
} from "./date-field.ts";
import { convertedToCare, DOC_PENDING, termsLine } from "./documents.ts";
import { OFFER_COPY } from "./offers.ts";
import { SIGNATURE_COPY } from "./pdf.ts";
import { COPY, detailsErrors, milestoneFormOf, milestoneInput, PENDING } from "./projects.ts";
import { TIME_PENDING } from "./time.ts";

describe("07-Q, word for word", () => {
  it("the changed lines C1, C3, C7 and C8", () => {
    expect(PENDING.clientFilterHint).toBe("Client code or name");
    expect(TIME_PENDING.noteTooLong).toBe("Keep the note to 1,000 characters or fewer.");
    expect(DOC_PENDING.customLinesHint).toBe("Custom lines don't count towards the discount limit.");
    expect(NOT_SET).toBe("Not set");
  });
  it("the decisions with words: Q3, Q6, Q7, Q12, Q13", () => {
    expect(convertedToCare("Sample Client A (sample)", "Growth")).toBe(
      "Converted to a care plan for Sample Client A (sample) (Growth).",
    );
    expect(convertedToCare("Sample Client A (sample)", null)).toBe(
      "Converted to a care plan for Sample Client A (sample).",
    );
    // FX-3 (A6 1c): the pixel limit left the line once the browser scales the image down; the fix round names the 10 MB input and the
    // 256 KB PNG (07-Y, amended by the lead)
    expect(SIGNATURE_COPY.wrongFile).toBe(
      "Use a PNG or JPEG image up to 10 MB. We store it as a PNG of up to 256 KB.",
    );
    expect(termsLine(3)).toBe("The terms below are version 3 of our terms.");
    expect(OFFER_COPY.viewedHint).toBe(
      "Viewed means the link was opened. Email security scanners can open links too.",
    );
    expect(OFFER_COPY.attachHint).toBe("Off by default: the email links to the portal.");
    expect(OFFER_COPY.attachHintOn).toBe("On for this client: the PDF goes with the email.");
  });
  it("the owner's answers M7 and M8", () => {
    expect(COPY.linkedProposal).toBe("No proposal is linked to this project.");
    expect(OFFER_COPY.noneWithPortal).toBe(
      "No contact of this client has portal access yet. Turn it on for a contact first.",
    );
  });
});

describe("the date field", () => {
  it("reads the day first, in any of the usual separators, and refuses what isn't a real date", () => {
    expect(typedToIso("26/10/2026")).toBe("2026-10-26");
    expect(typedToIso("6/1/2026")).toBe("2026-01-06");
    expect(typedToIso("26-10-2026")).toBe("2026-10-26");
    expect(typedToIso("26.10.2026")).toBe("2026-10-26");
    expect(typedToIso(" 26 10 2026 ")).toBe("2026-10-26");
    expect(typedToIso("2026-10-26")).toBe("2026-10-26");
    expect(typedToIso("31/02/2026")).toBeNull();
    expect(typedToIso("10/26/2026")).toBeNull();
    expect(typedToIso("26/10/26")).toBeNull();
    expect(typedToIso("")).toBeNull();
    expect(typedToIso("26/10/202")).toBeNull();
  });
  it("shows ISO as DD/MM/YYYY and reads it back as 26 Oct 2026", () => {
    expect(isoToTyped("2026-01-06")).toBe("06/01/2026");
    expect(isoToTyped("")).toBe("");
    expect(dateEcho("2026-10-26")).toBe("26 Oct 2026");
    expect(dateEcho("")).toBe("");
  });
});

// Review of the fixes, finding 1, and the re-check (N1, N3, N4, L1, L6): a date that can't be read is never saved, as "Not set"
// or as the last valid date. The field keeps its reading to itself and reports only "can't be read" (`onValidity`); every form
// check takes that report as a required argument.
describe("the date field's invalid state", () => {
  it("reads text that isn't a real date as unread, and gives the owner's line for it", () => {
    expect(DATE_INVALID).toBe("Enter the date as DD/MM/YYYY, for example 26/10/2026.");
    expect(fieldValue("31/02/2026")).toBe(INVALID_DATE);
    expect(isUnread("31/02/2026")).toBe(true);
    expect(isUnread("26/10/26")).toBe(true); // a two-digit year
    expect(isUnread("26/10")).toBe(true);
    expect(isUnread("   ")).toBe(false);
    expect(isUnread("")).toBe(false);
    expect(isUnread("26/10/2026")).toBe(false);
    expect(fieldValue("26/10/2026")).toBe("2026-10-26");
    expect(dateError(true)).toBe(DATE_INVALID);
    expect(dateError(false)).toBeNull();
    expect(dateError(undefined)).toBeNull();
    expect(typedToIso(INVALID_DATE)).toBeNull();
  });

  it("passes on only what can be read: ISO or cleared, never the unread text (L6)", () => {
    expect(settledValue("31/02/2026")).toBeNull();
    expect(settledValue("2/1")).toBeNull();
    expect(settledValue("2/1/2026")).toBe("2026-01-02");
    expect(settledValue("")).toBe("");
  });

  it("keeps a form's set of unread fields, unchanged when a report repeats", () => {
    const none: UnreadDates<"startDate" | "targetDate"> = {};
    const one = withUnread(none, "startDate", true);
    expect(one).toEqual({ startDate: true });
    expect(anyUnread(one)).toBe(true);
    expect(withUnread(one, "startDate", true)).toBe(one);
    expect(withUnread(none, "startDate", false)).toBe(none);
    const back = withUnread(one, "startDate", false);
    expect(back).toEqual({});
    expect(anyUnread(back)).toBe(false);
  });

  it("blocks an optional date's save, even with a last valid date in the form: project details and a milestone", () => {
    const f = { name: "Sample project (sample)", ownerId: "", startDate: "", targetDate: "", budget: "" };
    expect(detailsErrors(f, "INR", { startDate: true })).toEqual({ startDate: DATE_INVALID });
    expect(detailsErrors({ ...f, targetDate: "2026-11-01" }, "INR", { targetDate: true })).toEqual({
      targetDate: DATE_INVALID,
    });
    // Empty is fine for an optional date; the order rule still runs on two real dates.
    expect(detailsErrors(f, "INR", {})).toEqual({});
    expect(
      detailsErrors({ ...f, startDate: "2026-10-26", targetDate: "2026-10-01" }, "INR", {}).targetDate,
    ).toBe(PENDING.datesOrder);
    const m = {
      ...milestoneFormOf(null, "INR"),
      title: "Sample milestone (sample)",
      kind: "pct" as const,
      pct: "50",
    };
    expect(milestoneInput({ ...m, dueDate: "2026-12-01" }, "INR", { dueDate: true })).toEqual({
      ok: false,
      errors: { dueDate: DATE_INVALID },
    });
    expect(milestoneInput({ ...m, dueDate: "" }, "INR", {})).toMatchObject({
      ok: true,
      body: { dueDate: null },
    });
  });
});

describe("the date field's text when its props change (re-check N1, N3, N4)", () => {
  const at = (value: string, invalid = false) => ({ value, invalid });

  it("shows a value set from outside in place of unread text (Clear filters, a reload)", () => {
    expect(syncedText("31/02/2026", at("2026-10-01"), at(""))).toBe("");
    expect(syncedText("31/11/2026", at("2026-11-15"), at("2026-11-20"))).toBe("20/11/2026");
    expect(syncedText("31/02/2026", at("", true), at("2026-10-01", true))).toBe("01/10/2026");
  });

  it("keeps the person's own text when the value is what it reads as", () => {
    expect(syncedText("6/1/2026", at(""), at("2026-01-06"))).toBe("6/1/2026");
    expect(syncedText("", at("2026-01-06"), at(""))).toBe("");
    // Unread text the form has just marked stays (the person is typing).
    expect(syncedText("31/02/2026", at(""), at("", true))).toBe("31/02/2026");
  });

  it("drops unread text when the form drops its mark (Discard, Cancel)", () => {
    expect(syncedText("31/02/2026", at("", true), at(""))).toBe("");
    expect(syncedText("31/02/2026", at("2026-10-20", true), at("2026-10-20"))).toBe("20/10/2026");
    // The person fixed the text: the mark goes and the text stays.
    expect(syncedText("26/10/2026", at("2026-10-26", true), at("2026-10-26"))).toBe("26/10/2026");
  });

  it("a field mounted again shows its value, which is always readable, so a stale mark is cleared", () => {
    for (const v of ["", "2026-10-26"]) expect(isUnread(isoToTyped(v))).toBe(false);
  });
});
