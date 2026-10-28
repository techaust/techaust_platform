import { RETENTION_FLOORS, retentionSettings } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import { buildRetention, RETENTION_ROWS, retentionRowError, retentionToForm } from "./retention-form.ts";

const good = { leadsMonths: 12, emailLogMonths: 12, securityLogMonths: 13, financialYears: 8 };

describe("Settings › Data retention (08-C RB-09; 07-W 5.10)", () => {
  it("every row's minimum is core's floor, the one the schema takes", () => {
    const floors = Object.fromEntries(RETENTION_ROWS.map((r) => [r.key, r.min]));
    expect(floors).toEqual({
      leads: RETENTION_FLOORS.leadsMonths,
      email: RETENTION_FLOORS.emailLogMonths,
      security: RETENTION_FLOORS.securityLogMonths,
      financial: RETENTION_FLOORS.financialYears,
    });
    expect(RETENTION_FLOORS.emailLogMonths).toBe(12);
  });

  it("the email logs row has 07-W 5.10's hint and error, word for word", () => {
    const row = RETENTION_ROWS.find((r) => r.key === "email");
    expect(row?.desc).toContain("Never below 12 months (DPDP Rule 8(3)).");
    expect(row?.error).toBe("Keep email logs at least 12 months (DPDP Rule 8(3)).");
  });

  it("11 months of email logs is refused by the form with the row's line, before the schema is asked", () => {
    const f = { ...retentionToForm(good), email: "11" };
    expect(buildRetention(f)).toEqual({
      errors: { "f-emailLogMonths": "Keep email logs at least 12 months (DPDP Rule 8(3))." },
    });
    expect(buildRetention({ ...f, email: "12" })).toEqual({ value: good });
    expect(retentionSettings.safeParse(good).success).toBe(true);
    expect(retentionSettings.safeParse({ ...good, emailLogMonths: 11 }).success).toBe(false);
  });

  it("a refusal of the field by the schema or the server shows the row's line, never the validator's text", () => {
    const row = RETENTION_ROWS.find((r) => r.key === "email");
    if (!row) throw new Error("no row");
    expect(retentionRowError(row, "12", "Too small: expected number to be >=12")).toBe(row.error);
    expect(retentionRowError(row, "6", undefined)).toBe(row.error);
    expect(retentionRowError(row, "12", undefined)).toBeUndefined();
    expect(retentionRowError(row, "", undefined)).toBeUndefined();
  });
});
