import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { financialYear } from "../src/dates.ts";
import { gstinCheckChar } from "../src/gstin.ts";
import { formatDocumentNumber, MAX_NUMBER_LENGTH, maxNumber } from "../src/numbering.ts";
import {
  BRAND_LOGOS,
  panOf,
  resolveSetting,
  SETTINGS_DEFAULTS,
  SETTINGS_SCHEMAS,
  type SeededSettingKey,
} from "../src/schemas/settings.ts";

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

describe("company GSTIN and state code (ADM-SET-01)", () => {
  const company = (patch: Record<string, unknown>) =>
    SETTINGS_SCHEMAS.company.safeParse({ ...SETTINGS_DEFAULTS.company, ...patch });
  const first14 = "19ABCDE1234F1Z";
  const valid = `${first14}${gstinCheckChar(first14)}`;

  it("accepts a real GSTIN (normalised) or none", () => {
    expect(company({ gstin: null }).success).toBe(true);
    const parsed = company({ gstin: valid.toLowerCase(), stateCode: "19" });
    expect(parsed.success && parsed.data.gstin).toBe(valid);
  });

  it("rejects a wrong check character, a wrong length, a shapeless value and an unknown state", () => {
    const wrong = `${first14}${gstinCheckChar(first14) === "A" ? "B" : "A"}`;
    expect(company({ gstin: wrong }).success).toBe(false);
    expect(company({ gstin: valid.slice(0, 14) }).success).toBe(false);
    expect(company({ gstin: "x".repeat(15) }).success).toBe(false);
    const unknown = `39ABCDE1234F1Z`;
    expect(company({ gstin: `${unknown}${gstinCheckChar(unknown)}`, stateCode: "39" }).success).toBe(false);
  });

  it("the state code must be a real GST state code, and agree with the GSTIN", () => {
    expect(company({ stateCode: "99" }).success).toBe(false);
    expect(company({ stateCode: "1" }).success).toBe(false);
    expect(company({ gstin: valid, stateCode: "27" }).success).toBe(false);
    expect(company({ gstin: valid, stateCode: "19" }).success).toBe(true);
  });
});

describe("M3.1 settings fields", () => {
  const S = SETTINGS_SCHEMAS;
  it("the PAN comes from the GSTIN and is never a stored field", () => {
    const first14 = "19ABCDE1234F1Z";
    expect(panOf(`${first14}${gstinCheckChar(first14)}`)).toBe("ABCDE1234F");
    expect(panOf(null)).toBeNull();
    expect(Object.keys(SETTINGS_DEFAULTS.company)).not.toContain("pan");
  });

  it("logos come from the fixed brand list", () => {
    expect(S.company.safeParse({ ...SETTINGS_DEFAULTS.company, logoLight: "evil.svg" }).success).toBe(false);
    expect(BRAND_LOGOS).toContain(SETTINGS_DEFAULTS.company.logoLight);
    expect(BRAND_LOGOS).toContain(SETTINGS_DEFAULTS.company.logoDark);
  });

  it("every logo in the list is a generated brand file that exists", () => {
    for (const name of BRAND_LOGOS)
      expect(existsSync(join(import.meta.dirname, "../../ui/brand", name)), name).toBe(true);
  });

  it("flags: Cal.com is https, WhatsApp is E.164, GA4 has its shape", () => {
    const f = (patch: Record<string, unknown>) => S.flags.safeParse({ ...SETTINGS_DEFAULTS.flags, ...patch });
    expect(f({ calComUrl: "https://cal.com/techaust" }).success).toBe(true);
    expect(f({ calComUrl: "http://cal.com/techaust" }).success).toBe(false);
    expect(f({ whatsappNumber: "+919800000000" }).success).toBe(true);
    expect(f({ whatsappNumber: "9800000000" }).success).toBe(false);
    expect(f({ ga4Id: "G-ABC123XYZ9" }).success).toBe(true);
    expect(f({ ga4Id: "UA-1234-1" }).success).toBe(false);
  });

  it("gateways hold the mode only and email's templates are known ones", () => {
    const g = SETTINGS_DEFAULTS.gateways;
    expect(S.gateways.safeParse({ ...g, stripe: { mode: "live", key: "x" } }).success).toBe(false);
    expect(S.gateways.safeParse({ ...g, paypal: { mode: "sandbox" } }).success).toBe(false);
    const e = SETTINGS_DEFAULTS.email;
    expect(S.email.safeParse({ ...e, bccOwner: { "lead.alert": true } }).success).toBe(true);
    expect(S.email.safeParse({ ...e, bccOwner: { nope: true } }).success).toBe(false);
  });

  it("the liability cap default is the figure the website printed before (INR 10,000, VERIFY WITH CA/LEGAL)", () => {
    expect(SETTINGS_DEFAULTS.payment_terms.websiteLiabilityCapInrMinor).toBe(1_000_000);
    expect(SETTINGS_DEFAULTS.payment_terms.razorpayMinPartialInrMinor).toBe(1_000_000);
  });

  it("resolveSetting merges the defaults under a row stored in today's shape (before these fields existed)", () => {
    // The shapes staging holds now: the M1.3 seed is insert-only, so those rows are never updated.
    const oldCompany = {
      tradeName: "TecHaust Technologies",
      legalName: null,
      gstin: null,
      stateCode: "19",
      address: null,
      documentsEmail: "contact@techaust.com",
      documentsPhone: null,
    };
    const oldPayment = {
      dueDays: 7,
      proposalValidityDays: 15,
      buildSchedule: SETTINGS_DEFAULTS.payment_terms.buildSchedule,
      smallJobThreshold: { INR: 1_00_000_00, USD: 2_000_00 },
      reminderOffsetsDays: [-3, 0, 3, 7, 14],
      reminderWindowIst: { fromHour: 9, toHour: 19 },
    };
    const oldFlags = { dpdpReadinessPage: false, weeklyDigest: true };
    expect(S.company.safeParse(oldCompany).success).toBe(false); // the bare schema refuses the old row
    expect(resolveSetting("company", oldCompany)).toEqual(SETTINGS_DEFAULTS.company);
    expect(resolveSetting("payment_terms", oldPayment).websiteLiabilityCapInrMinor).toBe(1_000_000);
    expect(resolveSetting("flags", oldFlags)).toEqual(SETTINGS_DEFAULTS.flags);
    expect(resolveSetting("gateways", undefined)).toEqual(SETTINGS_DEFAULTS.gateways); // no row at all
    // A stored value still wins over the default, and a corrupted row throws rather than falling back.
    expect(resolveSetting("flags", { ...oldFlags, weeklyDigest: false }).weeklyDigest).toBe(false);
    expect(() => resolveSetting("retention", { leadsMonths: 3 })).toThrow();
  });

  it("resolveSetting merges nested objects too (a field added inside a nested object)", () => {
    const { fy: _fy, ...lutOld } = SETTINGS_DEFAULTS.tax.lut;
    const stored = { ...SETTINGS_DEFAULTS.tax, lut: { ...lutOld, arn: "AD1234567890123" } };
    const tax = resolveSetting("tax", stored);
    expect(tax.lut).toEqual({ arn: "AD1234567890123", fy: null });
    // an explicit stored value of the wrong type is not hidden by the default
    expect(() => resolveSetting("tax", { ...SETTINGS_DEFAULTS.tax, lut: null })).toThrow();
  });
});
