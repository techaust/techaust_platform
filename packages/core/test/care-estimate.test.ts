// A care plan from an accepted estimate: what the lines must be [ADM-EST-02, M4.3 item 8, analyst M5]. The tier comes from the key the
// server set on the line (the catalogue default line), never from its description.
import { describe, expect, it } from "vitest";
import { CARE_SERVICE_CODES, careFromEstimate, type EstimateCareLine } from "../src/care.ts";

const line = (over: Partial<EstimateCareLine> = {}): EstimateCareLine => ({
  code: "S16",
  catalogueLine: "Growth",
  qtyMilli: 1000,
  unit: "month",
  taxableMinor: 2_499_900,
  ...over,
});

describe("careFromEstimate", () => {
  it("names the services a plan is made from", () => {
    expect(CARE_SERVICE_CODES).toEqual({ care: "S16", aiOps: "S17", dev: "S18" });
  });

  it("one S16 line is a plan of that tier at its taxable amount; the tier is the default line's name, any case", () => {
    expect(careFromEstimate([line()])).toEqual({ tier: "growth", priceMinor: 2_499_900, aiOpsMinor: null });
    expect(careFromEstimate([line({ catalogueLine: " ESSENTIAL ", taxableMinor: 999_900 })])).toEqual({
      tier: "essential",
      priceMinor: 999_900,
      aiOpsMinor: null,
    });
    expect(careFromEstimate([line({ catalogueLine: "scale", taxableMinor: 5_999_900 })])?.tier).toBe("scale");
  });

  it("an S18 line is a dev subscription whatever its default line says", () => {
    expect(careFromEstimate([line({ code: "S18", catalogueLine: null, taxableMinor: 17_500_000 })])).toEqual({
      tier: "dev_subscription",
      priceMinor: 17_500_000,
      aiOpsMinor: null,
    });
    expect(careFromEstimate([line({ code: "S18", catalogueLine: "Essential" })])?.tier).toBe(
      "dev_subscription",
    );
  });

  it("one S17 line beside the care line is the AI Ops amount, in either order", () => {
    const ai = line({ code: "S17", catalogueLine: null, taxableMinor: 2_000_000 });
    expect(careFromEstimate([line(), ai])).toEqual({
      tier: "growth",
      priceMinor: 2_499_900,
      aiOpsMinor: 2_000_000,
    });
    expect(careFromEstimate([ai, line()])?.aiOpsMinor).toBe(2_000_000);
  });

  it("anything else is not a care estimate", () => {
    const ai = line({ code: "S17", catalogueLine: null, taxableMinor: 2_000_000 });
    expect(careFromEstimate([])).toBeNull();
    expect(careFromEstimate([ai])).toBeNull(); // AI Ops alone
    expect(careFromEstimate([line(), line({ catalogueLine: "Scale" })])).toBeNull(); // two care lines
    expect(careFromEstimate([line(), line({ code: "S18" })])).toBeNull();
    expect(careFromEstimate([line(), ai, ai])).toBeNull(); // two AI Ops lines
    expect(careFromEstimate([line(), line({ code: null, catalogueLine: null })])).toBeNull(); // a custom line
    expect(careFromEstimate([line(), line({ code: "S9", catalogueLine: null })])).toBeNull(); // another service
    expect(careFromEstimate([line({ catalogueLine: null })])).toBeNull(); // S16 with no default line behind it
    expect(careFromEstimate([line({ catalogueLine: "Platinum" })])).toBeNull();
    expect(careFromEstimate([line({ catalogueLine: "constructor" })])).toBeNull(); // not a property lookup
    expect(careFromEstimate([line({ qtyMilli: 2000 })])).toBeNull(); // two months
    expect(careFromEstimate([line({ qtyMilli: 500 })])).toBeNull();
    expect(careFromEstimate([line({ unit: "fixed" })])).toBeNull();
    expect(careFromEstimate([line(), { ...ai, qtyMilli: 2000 }])).toBeNull();
    expect(careFromEstimate([line({ taxableMinor: -1 })])).toBeNull();
    expect(careFromEstimate([line({ taxableMinor: 1.5 })])).toBeNull();
  });
});
