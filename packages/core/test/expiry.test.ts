// The expiry message of proposals and estimates [JOB-CRON-01, ADM-PROP-06]: its shape, the IST date of the run, and what the queue accepts.
import { describe, expect, it } from "vitest";
import { EXPIRE_KIND, EXPIRE_PAGE, expireMessage, isExpireKind, isExpireMessage } from "../src/expiry.ts";

describe("expireMessage", () => {
  it("is for the IST date the cron runs on: 22:00 UTC is 03:30 IST of the NEXT day", () => {
    // 2026-12-01 22:00 UTC = 2026-12-02 03:30 IST: an offer valid through the 1st is over, one valid through the 2nd is not
    expect(expireMessage(Date.UTC(2026, 11, 1, 22, 0))).toEqual({ kind: EXPIRE_KIND, asOf: "2026-12-02" });
    // across a month and a year
    expect(expireMessage(Date.UTC(2026, 11, 31, 22, 0)).asOf).toBe("2027-01-01");
    // an hour before the IST date turns (18:29 UTC = 23:59 IST) it is still the same IST day
    expect(expireMessage(Date.UTC(2026, 11, 1, 18, 29)).asOf).toBe("2026-12-01");
    expect(expireMessage(Date.UTC(2026, 11, 1, 18, 30)).asOf).toBe("2026-12-02");
  });

  it("pages of fifty", () => expect(EXPIRE_PAGE).toBe(50));
});

describe("isExpireMessage", () => {
  it("accepts the cron's message and a continuation", () => {
    expect(isExpireMessage({ kind: EXPIRE_KIND, asOf: "2026-12-02" })).toBe(true);
    expect(isExpireMessage({ kind: EXPIRE_KIND, asOf: "2026-12-02", after: "doc-1" })).toBe(true);
  });

  it("refuses anything else, but the kind alone is still recognised (so the queue can skip it and never treat it as a lead)", () => {
    for (const bad of [
      null,
      "documents.expire",
      42,
      {},
      { kind: "stats.metric", asOf: "2026-12-02" },
      { kind: EXPIRE_KIND },
      { kind: EXPIRE_KIND, asOf: "tomorrow" },
      { kind: EXPIRE_KIND, asOf: "2026-02-30" },
      { kind: EXPIRE_KIND, asOf: 20261202 },
      { kind: EXPIRE_KIND, asOf: "2026-12-02", after: "" },
      { kind: EXPIRE_KIND, asOf: "2026-12-02", after: "x".repeat(65) },
      { kind: EXPIRE_KIND, asOf: "2026-12-02", after: 7 },
    ]) {
      expect(isExpireMessage(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(isExpireKind({ kind: EXPIRE_KIND, asOf: "tomorrow" })).toBe(true);
    expect(isExpireKind({ kind: "lead.purge" })).toBe(false);
    expect(isExpireKind(null)).toBe(false);
  });
});
