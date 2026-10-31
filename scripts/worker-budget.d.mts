export type Forbidden = { name: string; re: RegExp };
export type Budget = {
  file: string;
  maxBytes: number;
  /** A plan line under the ceiling (M6.1 stage A): past it the build prints a note, it does not fail. */
  planBytes?: number;
  maxStartupMs: number;
  forbidden: Forbidden[];
};
export const INVOICE_CODE: Forbidden;
export const BUDGETS: {
  admin: Budget;
  adminApi: Budget;
  adminFinance: Budget;
  portal: Budget;
  jobs: Budget;
};
export function measureStartup(code: string, runs?: number): number;
export function planNote(size: number, budget: Budget): string | null;
export function checkBundle(
  bundle: { size: number; text: string; startupMs: number },
  budget: Budget,
): string[];
