// Times of day in the client's own clock (owner, 2026-11-01; run file docs/runs/portal-local-time.md) [POR-05, POR-06]: one time only, the
// zone's short name as the website writes it, the local date when it differs from India's, and the IST text on an IST clock or any failure.
import { formatIstDateTime } from "@techaust/core/dates";
import { describe, expect, it } from "vitest";
import { gmtName, localDateTime } from "./local-time.ts";

/** 25 Oct 2026, 11:42 IST = 06:12 UTC (London is back on GMT from 01:00 UTC that day; Los Angeles is still on PDT). */
const OCT25 = Date.UTC(2026, 9, 25, 6, 12);
/** 01 Jul 2026, 12:12 IST = 06:42 UTC (London on BST). */
const JUL1 = Date.UTC(2026, 6, 1, 6, 42);
/** 25 Oct 2026, 21:30 IST = 16:00 UTC: already 26 Oct in Tokyo. */
const LATE = Date.UTC(2026, 9, 25, 16, 0);

describe("localDateTime", () => {
  it("keeps the IST text on an IST clock, whatever the locale calls the zone", () => {
    expect(localDateTime(OCT25, { timeZone: "Asia/Kolkata", locale: "en-IN" })).toBe(
      "25 Oct 2026, 11:42 IST",
    );
    // en-US names Kolkata "GMT+5:30"; the text is still core's own, the PDF's wording.
    expect(localDateTime(OCT25, { timeZone: "Asia/Kolkata", locale: "en-US" })).toBe(
      formatIstDateTime(OCT25),
    );
  });

  it("writes London in winter as GMT and in summer as BST (en-GB)", () => {
    expect(localDateTime(OCT25, { timeZone: "Europe/London", locale: "en-GB" })).toBe(
      "25 Oct 2026, 06:12 GMT",
    );
    expect(localDateTime(JUL1, { timeZone: "Europe/London", locale: "en-GB" })).toBe(
      "01 Jul 2026, 07:42 BST",
    );
  });

  it("gives Los Angeles the date before India's", () => {
    expect(localDateTime(OCT25, { timeZone: "America/Los_Angeles", locale: "en-US" })).toBe(
      "24 Oct 2026, 23:12 PDT",
    );
  });

  it("gives Tokyo the date after India's, with an offset-only name as Intl gives it", () => {
    expect(localDateTime(LATE, { timeZone: "Asia/Tokyo", locale: "en-US" })).toBe("26 Oct 2026, 01:00 GMT+9");
  });

  it("names a zone the runtime can't name by its offset", () => {
    const none = () => undefined;
    expect(localDateTime(OCT25, { timeZone: "Asia/Kathmandu", zoneName: none })).toBe(
      "25 Oct 2026, 11:57 GMT+5:45",
    );
    expect(localDateTime(OCT25, { timeZone: "Europe/London", zoneName: none })).toBe(
      "25 Oct 2026, 06:12 GMT",
    );
    expect(localDateTime(OCT25, { timeZone: "America/St_Johns", zoneName: () => "" })).toBe(
      "25 Oct 2026, 03:42 GMT-2:30",
    );
  });

  it("spells Chromium's GMT+0 as GMT", () => {
    expect(localDateTime(OCT25, { timeZone: "Europe/London", zoneName: () => "GMT+0" })).toBe(
      "25 Oct 2026, 06:12 GMT",
    );
  });

  it("falls back to the IST text for an unknown zone, never a blank", () => {
    expect(localDateTime(OCT25, { timeZone: "Mars/Olympus_Mons" })).toBe("25 Oct 2026, 11:42 IST");
    expect(
      localDateTime(OCT25, {
        timeZone: "Europe/London",
        zoneName: () => {
          throw new Error("no names");
        },
      }),
    ).toBe("25 Oct 2026, 11:42 IST");
  });

  it("drops seconds without moving the minute or the IST check", () => {
    const late = OCT25 + 59_999;
    expect(localDateTime(late, { timeZone: "Asia/Kolkata" })).toBe("25 Oct 2026, 11:42 IST");
    expect(localDateTime(late, { timeZone: "Europe/London", locale: "en-GB" })).toBe(
      "25 Oct 2026, 06:12 GMT",
    );
  });

  it("uses the runtime's own clock by default", () => {
    expect(localDateTime(OCT25)).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} \S+$/);
  });
});

describe("gmtName", () => {
  it("writes offsets as Intl does", () => {
    expect([0, 60, -420, 345, -150].map(gmtName)).toEqual(["GMT", "GMT+1", "GMT-7", "GMT+5:45", "GMT-2:30"]);
  });
});
