import { describe, expect, it } from "vitest";
import { financialYear } from "../src/dates.ts";
import { formatDocumentNumber, MAX_NUMBER_LENGTH, maxNumber } from "../src/numbering.ts";
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMAS, type SeededSettingKey } from "../src/schemas/settings.ts";

describe("settings defaults (docs/08 §7.1, VERIFY WITH CA)", () => {
  it.each(Object.keys(SETTINGS_SCHEMAS) as SeededSettingKey[])("%s validates against its schema", (key) => {
    expect(SETTINGS_SCHEMAS[key].parse(SETTINGS_DEFAULTS[key])).toEqual(SETTINGS_DEFAULTS[key]);
  });

  it("matches the researched defaults", () => {
    const { tax, payment_terms, retention, company, flags } = SETTINGS_DEFAULTS;
    expect(tax.defaultRateBp).toBe(1_800);
    expect(tax.exportMode).toBe("lut");
    expect(tax.eInvoicing).toBe(false);
    expect(payment_terms.dueDays).toBe(7);
    expect(payment_terms.proposalValidityDays).toBe(15);
    expect(payment_terms.buildSchedule.map((s) => s.pctBp)).toEqual([4_000, 3_000, 3_000]);
    expect(retention).toEqual({
      leadsMonths: 12,
      emailLogMonths: 13,
      securityLogMonths: 13,
      financialYears: 10,
    });
    expect(flags.dpdpReadinessPage).toBe(false);
    // Nothing identifying is committed to the public repository.
    expect([company.legalName, company.gstin, company.address, company.documentsPhone]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("every default numbering format fits GST's 16 characters", () => {
    for (const f of Object.values(SETTINGS_DEFAULTS.numbering)) {
      expect(formatDocumentNumber(f, financialYear(2026), maxNumber(f)).length).toBeLessThanOrEqual(
        MAX_NUMBER_LENGTH,
      );
    }
  });

  it("rejects unsafe changes", () => {
    const bad = { ...SETTINGS_DEFAULTS.numbering, invoice: { template: "TH/INVOICE/{FY}/{N}", padding: 4 } };
    expect(SETTINGS_SCHEMAS.numbering.safeParse(bad).success).toBe(false);
    const { invoice: _, ...missing } = SETTINGS_DEFAULTS.numbering;
    expect(SETTINGS_SCHEMAS.numbering.safeParse(missing).success).toBe(false);
    const schedule = { ...SETTINGS_DEFAULTS.payment_terms, buildSchedule: [{ label: "All", pctBp: 9_000 }] };
    expect(SETTINGS_SCHEMAS.payment_terms.safeParse(schedule).success).toBe(false);
    expect(
      SETTINGS_SCHEMAS.retention.safeParse({ ...SETTINGS_DEFAULTS.retention, leadsMonths: 6 }).success,
    ).toBe(false);
    expect(
      SETTINGS_SCHEMAS.retention.safeParse({ ...SETTINGS_DEFAULTS.retention, financialYears: 7 }).success,
    ).toBe(false);
  });
});
