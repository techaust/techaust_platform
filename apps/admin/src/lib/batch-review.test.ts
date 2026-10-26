// The batch review fixes (2026-10-26): the 07-Q changed lines word for word, the owner's M7 and M8 lines, and the one date field's
// parsing (day first, DD/MM/YYYY, whatever the browser's locale; ISO in and out).
import { describe, expect, it } from "vitest";
import { NOT_SET } from "./catalogue.ts";
import { dateEcho, isoToTyped, typedToIso } from "./date-field.ts";
import { convertedToCare, DOC_PENDING, termsLine } from "./documents.ts";
import { OFFER_COPY } from "./offers.ts";
import { SIGNATURE_COPY } from "./pdf.ts";
import { COPY, PENDING } from "./projects.ts";
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
    expect(SIGNATURE_COPY.wrongFile).toBe("Use a PNG or JPEG image up to 256 KB and 2400 by 1200 pixels.");
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
