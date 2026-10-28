// Q37 (07-S section 9): the PDF line of a tax invoice issued with IGST for a payment received against an LUT proforma when no LUT was in place for the receipt FY.
import { describe, expect, it } from "vitest";
import { parseInvoiceEnvelope } from "../src/invoice-envelope.ts";
import { toInvoiceView } from "../src/invoice-view.ts";
import { advanceLine } from "../src/layout/copy.ts";
import { renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG } from "../src/view.ts";
import { buildInvoiceLayoutFixture } from "./fixtures/invoice-layout.ts";

describe("the Q9 line with the Q37 sentence", () => {
  it("the plain line is unchanged, and the IGST variant adds the section 9 sentence word for word", () => {
    expect(advanceLine("TH/PI/2930/0001", "20 Mar 30", "02 Apr 30")).toBe(
      "Against proforma TH/PI/2930/0001 of 20 Mar 30, payment received on 02 Apr 30.",
    );
    expect(advanceLine("TH/PI/2930/0001", "20 Mar 30", "02 Apr 30", "2030-31")).toBe(
      "Against proforma TH/PI/2930/0001 of 20 Mar 30, payment received on 02 Apr 30. Issued with IGST: no LUT was in place for FY 2030-31.",
    );
  });

  it("the frozen header carries the FY, the envelope still parses, and the rendered invoice prints the sentence", async () => {
    const { envelope, signature } = await buildInvoiceLayoutFixture("advance-export");
    const header = envelope.snapshot.header;
    if (!header.advance) throw new Error("fixture has no advance header");
    const changed = {
      ...envelope,
      snapshot: {
        ...envelope.snapshot,
        header: { ...header, advance: { ...header.advance, igstNoLutFy: "2027-28" } },
      },
    };
    expect(parseInvoiceEnvelope(JSON.stringify(changed))).not.toBeNull();
    // a header whose FY is not a string is not an envelope
    const bad = {
      ...changed,
      snapshot: {
        ...changed.snapshot,
        header: { ...header, advance: { ...header.advance, igstNoLutFy: 7 } },
      },
    };
    expect(parseInvoiceEnvelope(JSON.stringify(bad))).toBeNull();
    const view = toInvoiceView(changed, DEFAULT_VIEW_CONFIG, {
      signature,
      portalLink: "portal.example.test",
    });
    expect(view.advance?.igstNoLutFy).toBe("2027-28");
    expect(renderDocumentHtml(view)).toContain("Issued with IGST: no LUT was in place for FY 2027-28.");
    const plain = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, {
      signature,
      portalLink: "portal.example.test",
    });
    expect(plain.advance?.igstNoLutFy).toBeNull();
    expect(renderDocumentHtml(plain)).not.toContain("no LUT was in place");
  });
});
