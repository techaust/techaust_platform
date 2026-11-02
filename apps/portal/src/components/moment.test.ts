// The on-screen moment (run file docs/runs/portal-local-time.md) [POR-05]: two unbreakable runs in the reader's clock; the IST text, without a zone
// of its own, when the clock is on IST or can't be read; a copy line keeps its words around the moment (07-ZJ line 5).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEED_ZJ } from "../copy-zj.ts";
import type { Clock } from "../lib/local-time.ts";
import { LineWithMoment, Moment } from "./moment.tsx";

/** 03 Nov 2026, 14:05 IST = 08:35 UTC (the sample deed's eSign). */
const AT = Date.UTC(2026, 10, 3, 8, 35);
const html = (at: number, clock?: Clock) => renderToStaticMarkup(createElement(Moment, { at, clock }));

describe("Moment", () => {
  it("writes the reader's clock as a date run and a time-and-zone run", () => {
    expect(html(AT, { timeZone: "Asia/Tokyo", locale: "en-US" })).toBe(
      '<span class="nowrap">03 Nov 2026,</span> <span class="nowrap">17:35 GMT+9</span>',
    );
  });

  it("renders the IST text on an IST clock and when the zone can't be read", () => {
    const ist = '<span class="nowrap">03 Nov 2026,</span> <span class="nowrap">14:05 IST</span>';
    expect(html(AT, { timeZone: "Asia/Kolkata", locale: "en-US" })).toBe(ist);
    expect(html(AT, { timeZone: "Not/A_Zone" })).toBe(ist);
  });

  it("keeps a copy line's words around the moment", () => {
    const out = renderToStaticMarkup(
      createElement(LineWithMoment, {
        line: DEED_ZJ.signedOn,
        at: AT,
        clock: { timeZone: "Europe/London", locale: "en-GB" },
      }),
    );
    expect(out).toBe(
      'Signed with Aadhaar eSign on <span class="nowrap">03 Nov 2026,</span> <span class="nowrap">08:35 GMT</span>',
    );
  });
});
