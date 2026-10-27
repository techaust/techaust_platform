// The M5.5b report messages of the leads queue [JOB-Q-01, ADM-REP-07, Q55, Q57; LD76]: versioned, ids and dates only, and a body of the family (valid or not) is recognised so it can never
// become a lead.
import { describe, expect, it } from "vitest";
import {
  edfReminderMessage,
  isReportKind,
  REPORT_KINDS,
  realisationScanMessage,
  statementPurgeMessage,
} from "../src/schemas/messages.ts";

const id = "0198a000-0000-7000-8000-000000000001";

describe("realisation.scan", () => {
  it("is versioned and takes an optional (date, id) cursor", () => {
    expect(realisationScanMessage.safeParse({ v: 1, kind: "realisation.scan" }).success).toBe(true);
    expect(
      realisationScanMessage.parse({ v: 1, kind: "realisation.scan", after: { d: "2026-10-05", id } }),
    ).toEqual({ v: 1, kind: "realisation.scan", after: { d: "2026-10-05", id } });
    for (const bad of [
      { kind: "realisation.scan" },
      { v: 2, kind: "realisation.scan" },
      { v: 1, kind: "realisation.scan", after: { d: "5 Oct", id } },
      { v: 1, kind: "realisation.scan", after: { d: "2026-10-05", id: "" } },
      { v: 1, kind: "realisation.scan", after: { d: "2026-10-05" } },
    ])
      expect(realisationScanMessage.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("edf.reminder", () => {
  it("names the invoice month; a month outside 1 to 12 or a non-integer is refused", () => {
    expect(edfReminderMessage.safeParse({ v: 1, kind: "edf.reminder", year: 2026, month: 12 }).success).toBe(
      true,
    );
    for (const month of [0, 13, 1.5, "10"])
      expect(edfReminderMessage.safeParse({ v: 1, kind: "edf.reminder", year: 2026, month }).success).toBe(
        false,
      );
    expect(edfReminderMessage.safeParse({ v: 1, kind: "edf.reminder", year: 1999, month: 1 }).success).toBe(
      false,
    );
  });
});

describe("statement.purge", () => {
  it("carries the cron's time and an optional last id", () => {
    expect(
      statementPurgeMessage.safeParse({ v: 1, kind: "statement.purge", asOf: 1_700_000_000_000 }).success,
    ).toBe(true);
    expect(
      statementPurgeMessage.safeParse({ v: 1, kind: "statement.purge", asOf: 5, after: id }).success,
    ).toBe(true);
    for (const bad of [
      { v: 1, kind: "statement.purge" },
      { v: 1, kind: "statement.purge", asOf: -1 },
      { v: 1, kind: "statement.purge", asOf: 1.5 },
      { v: 1, kind: "statement.purge", asOf: 5, after: "" },
    ])
      expect(statementPurgeMessage.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("isReportKind", () => {
  it("recognises a body of the family, valid or not, and nothing else", () => {
    expect([...REPORT_KINDS]).toEqual(["realisation.scan", "edf.reminder", "statement.purge"]);
    for (const kind of REPORT_KINDS) {
      expect(isReportKind({ kind })).toBe(true);
      expect(isReportKind({ kind, junk: true })).toBe(true);
    }
    for (const other of [
      null,
      undefined,
      "realisation.scan",
      5,
      {},
      { kind: "contact" },
      { kind: "care.scan" },
    ])
      expect(isReportKind(other), JSON.stringify(other)).toBe(false);
  });
});
