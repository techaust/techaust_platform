export type Forbidden = { name: string; re: RegExp };
export type Budget = {
  file: string;
  maxBytes: number;
  /** A plan line under the ceiling (M6.1 stage A): past it the build prints a note, it does not fail. */
  planBytes?: number;
  maxStartupMs: number;
  forbidden: Forbidden[];
  /** L9: the build's metafile, whose input paths are checked against `forbiddenInputs` (minify drops path comments). */
  metafile?: string;
  forbiddenInputs?: Forbidden[];
};
export const INVOICE_CODE: Forbidden;
export const BUDGETS: {
  admin: Budget;
  adminApi: Budget;
  adminFinance: Budget;
  portal: Budget;
  jobs: Budget;
};
/** The name of the start-up probe's collector in the sandbox's global scope (CPU warm-up fix round, early check 1a). */
export const STARTUP_PROBE: "__techaustStartupProbe";
/** How long the probe waits for an entry's start-up work to settle before it fails the bundle. */
export const SETTLE_LIMIT_MS: number;
/** `Date` as workerd's start-up sees it: `Date.now()` and `new Date()` read 0, `Date()` is the string of 0, `new Date(x)` unchanged (review findings 5, 6). */
export function startupDate(RealDate: DateConstructor): DateConstructor;
/** Compile + evaluation + the start-up work handed to the probe, under workerd's global-scope rules; the fastest of `runs`. */
export function measureStartup(code: string, runs?: number): Promise<number>;
export function planNote(size: number, budget: Budget): string | null;
export function checkBundle(
  bundle: { size: number; text: string; startupMs: number; inputs?: string[] },
  budget: Budget,
): string[];
