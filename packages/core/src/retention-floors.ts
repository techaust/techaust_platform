// The retention floors in their own module (M7.4 B2, run file J): the settings schema (`schemas/settings.ts`) re-exports them, and `./retention.ts` reads them
// from here, so the jobs Worker's clean-up never loads the settings schemas (their zod/mini building cost about 50 ms of the jobs Worker's start-up).

/**
 * The least each retention figure may be (months, but years for `financialYears`): the one place the floors live. The schema takes them as its minimums, and `resolveSetting` raises a stored
 * row that is below one to it, so a row saved before a floor existed (the email log was 1 month) reads at the floor instead of failing.
 */
export const RETENTION_FLOORS = {
  leadsMonths: 12,
  emailLogMonths: 12,
  securityLogMonths: 13,
  financialYears: 8,
  /** M7.4 (L14): closed data requests. */
  requestsMonths: 12,
  /** M7.4 (owner 2026-10-07; L29): consent receipts and the `erased` stop rows. */
  consentProofMonths: 12,
} as const;
