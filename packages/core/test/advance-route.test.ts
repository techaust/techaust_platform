// Q37 (owner 2026-10-28; Researched 2026-10-28, Rule 96A, 08-C RA-19): the route of a tax invoice for a payment received follows the FY of the receipt day.
import { describe, expect, it } from "vitest";
import { advanceRouteFor } from "../src/invoices.ts";

const luts = [{ fy: "2627", arn: "AD270126000001A" }];

describe("advanceRouteFor", () => {
  it("the LUT route needs a LUT for the FY of the receipt day, and the boundary is 31 March / 1 April", () => {
    const base = { proformaRoute: "lut" as const, luts };
    expect(advanceRouteFor({ ...base, receivedOn: "2027-03-31" })).toMatchObject({
      ok: true,
      route: "lut",
      fy: "2627",
    });
    expect(advanceRouteFor({ ...base, receivedOn: "2027-04-01" })).toEqual({
      ok: false,
      code: "advance_lut_missing",
      fy: "2728",
      fyLabel: "2027-28",
    });
    expect(advanceRouteFor({ ...base, receivedOn: "2026-04-01" })).toMatchObject({ ok: true, fy: "2627" });
    expect(advanceRouteFor({ ...base, receivedOn: "2026-03-31" })).toMatchObject({
      ok: false,
      code: "advance_lut_missing",
      fy: "2526",
    });
  });

  it("a LUT without an ARN does not count", () => {
    expect(
      advanceRouteFor({ proformaRoute: "lut", receivedOn: "2026-11-02", luts: [{ fy: "2627", arn: "  " }] }),
    ).toMatchObject({ ok: false, code: "advance_lut_missing" });
  });

  it("igst on an LUT proforma is allowed and says no LUT was in place only when none is", () => {
    expect(
      advanceRouteFor({ proformaRoute: "lut", requested: "igst", receivedOn: "2027-04-01", luts }),
    ).toEqual({
      ok: true,
      route: "igst_paid",
      fy: "2728",
      fyLabel: "2027-28",
      igstNoLut: true,
    });
    expect(
      advanceRouteFor({ proformaRoute: "lut", requested: "igst", receivedOn: "2027-03-31", luts }),
    ).toMatchObject({
      ok: true,
      route: "igst_paid",
      igstNoLut: false,
    });
  });

  it("an IGST proforma needs no LUT, never says 'no LUT', and cannot move to the LUT route", () => {
    expect(advanceRouteFor({ proformaRoute: "igst_paid", receivedOn: "2027-04-01", luts: [] })).toMatchObject(
      {
        ok: true,
        route: "igst_paid",
        igstNoLut: false,
      },
    );
    expect(
      advanceRouteFor({ proformaRoute: "igst_paid", requested: "lut", receivedOn: "2026-11-02", luts }),
    ).toEqual({
      ok: false,
      code: "advance_route_invalid",
    });
  });

  it("an omitted route is the proforma's; an unreadable date is refused", () => {
    expect(advanceRouteFor({ proformaRoute: "lut", receivedOn: "2026-11-02", luts })).toMatchObject({
      ok: true,
      route: "lut",
    });
    expect(advanceRouteFor({ proformaRoute: "lut", receivedOn: "soon", luts })).toEqual({
      ok: false,
      code: "advance_route_invalid",
    });
  });
});
