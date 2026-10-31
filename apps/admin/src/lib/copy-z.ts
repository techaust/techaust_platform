// 07-Z (FX-5, docs/07-content-appendix/Z-fx5-pending.md): the lines FX-5 added that no approved 07 page holds, APPROVED by the owner on 2026-10-30. Each one shows
// the "[Placeholder] " mark before the recommended words until the owner approves the page; then `APPROVED_07Z` turns true and the marks go
// (the 07-X and 07-Y pattern, copy-x.ts and copy-y.ts). Its own module, so a screen marks its line without loading another screen's words.

import { VOID_DELIVERED_PROFORMA } from "./copy-zf.ts";

export const APPROVED_07Z = true;
export const PLACEHOLDER_MARK = "[Placeholder]";
/** A 07-Z line as the screen shows it: marked until the owner approves 07-Z. */
export const Z = (line: string): string => (APPROVED_07Z ? line : `${PLACEHOLDER_MARK} ${line}`);

/** 07-Z §1 (FX-5, owner decision 2026-10-30, 08-C RA-10): why an invoice or a proforma the client opened in the portal can't be voided. */
export const VOID_VIEWED_COPY = {
  invoice: Z(
    "The client has opened this invoice in the portal, so it can't be voided. Use a credit note instead.",
  ),
  // ADM-INV-10: 07-ZF 15 (owner 2026-10-31) replaces 07-Z §1's proforma line: a proforma the client opened is withdrawn instead.
  proforma: VOID_DELIVERED_PROFORMA.viewed,
} as const;

const daysText = (days: readonly number[]) =>
  days.map((n) => `${n} ${n === 1 ? "day" : "days"}`).join(" and ");

/**
 * 07-Z §2 (FX-5, full audit C4): the proposal terms and Settings › Payment terms disagree on the days to pay. `refused` is the terms save's
 * 400 `terms_due_days_mismatch` (its `details`); `warning` is for Settings › Payment terms while the newest terms state other days
 * (`meta.termsDueDays`).
 */
export const TERMS_DUE_DAYS_COPY = {
  refused: (stated: readonly number[], dueDays: number) =>
    Z(
      `These terms say invoices are due within ${daysText(stated)}, but Settings › Payment terms says ${daysText([dueDays])}. Change the number here, or change Payment terms first.`,
    ),
  warning: (stated: readonly number[]) =>
    Z(
      `Your proposal terms say invoices are due within ${daysText(stated)}. Save a new version in Settings › Terms so they match.`,
    ),
} as const;
