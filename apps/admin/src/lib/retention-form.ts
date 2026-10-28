// Settings › Data retention, the rows and their words (ADM-SET-09; Researched 2026-10-28, DPDP Rule 8 and Rule 56 CGST, 08-C RB-09, RB-10, RA-25; 07-W 5.10 for the email logs).
// The minimums are core's `RETENTION_FLOORS`, the one place they live (the schema takes them too), so a floor can't differ between this screen and the API. Pure: tested without a browser.
import { RETENTION_FLOORS } from "@techaust/core/settings";
import { type FieldErrors, intIn } from "./settings-form.ts";

export type RetentionForm = { leads: string; email: string; security: string; financial: string };
export type RetentionKey = keyof RetentionForm;

export const RETENTION_ROWS = [
  {
    key: "leads",
    id: "f-leadsMonths",
    label: "Unconverted leads",
    unit: "months",
    min: RETENTION_FLOORS.leadsMonths,
    desc: "Deleted this long after their last activity. Never below 12 months (DPDP Rule 8(3)).",
    error: "Keep unconverted leads at least 12 months (DPDP Rule 8(3)).",
  },
  {
    key: "email",
    id: "f-emailLogMonths",
    label: "Email logs",
    unit: "months",
    min: RETENTION_FLOORS.emailLogMonths,
    // 07-W 5.10: the hint "Never below 12 months (DPDP Rule 8(3))." follows the screen's own description, as it does on the leads row.
    desc: "The record of each email sent: to whom, which template, delivered or not. Never below 12 months (DPDP Rule 8(3)).",
    error: "Keep email logs at least 12 months (DPDP Rule 8(3)).",
  },
  {
    key: "security",
    id: "f-securityLogMonths",
    label: "Security and access logs",
    unit: "months",
    min: RETENTION_FLOORS.securityLogMonths,
    desc: "Sign-ins and requests. Never below 13 months (DPDP Rule 6 asks for a year, CERT-In for 180 days).",
    error: "Keep security and access logs at least 13 months.",
  },
  {
    key: "financial",
    id: "f-financialYears",
    label: "Audit log and financial records",
    unit: "years",
    min: RETENTION_FLOORS.financialYears,
    desc: "Never below 8 years from the end of the financial year. Financial records are never deleted, only archived.",
    error: "Keep the audit log and financial records at least 8 years.",
  },
] as const;

export const retentionToForm = (v: {
  leadsMonths: number;
  emailLogMonths: number;
  securityLogMonths: number;
  financialYears: number;
}): RetentionForm => ({
  leads: String(v.leadsMonths),
  email: String(v.emailLogMonths),
  security: String(v.securityLogMonths),
  financial: String(v.financialYears),
});

/** The figures to save, or each row's own line for a figure that is not a whole number at its minimum or more. */
export function buildRetention(f: RetentionForm):
  | { errors: FieldErrors }
  | {
      value: {
        leadsMonths: number;
        emailLogMonths: number;
        securityLogMonths: number;
        financialYears: number;
      };
    } {
  const errors: FieldErrors = {};
  const n: Partial<Record<RetentionKey, number>> = {};
  for (const r of RETENTION_ROWS) {
    const v = intIn(f[r.key], r.min);
    if (v === null) errors[r.id] = r.error;
    else n[r.key] = v;
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    value: {
      leadsMonths: n.leads as number,
      emailLogMonths: n.email as number,
      securityLogMonths: n.security as number,
      financialYears: n.financial as number,
    },
  };
}

/**
 * The line shown under a row: its own line for any refusal of the field (the browser's check, the shared schema's or the server's), never the validator's own text
 * ("Too small: expected number to be >=12"); while typing, the line appears as soon as a whole number below the minimum is typed.
 */
export function retentionRowError(
  row: (typeof RETENTION_ROWS)[number],
  typed: string,
  refused: string | undefined,
): string | undefined {
  if (refused !== undefined) return row.error;
  const n = intIn(typed, 0);
  return n !== null && n < row.min ? row.error : undefined;
}
