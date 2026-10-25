export type Forbidden = { name: string; re: RegExp };
export type Budget = { file: string; maxBytes: number; maxStartupMs: number; forbidden: Forbidden[] };
export const BUDGETS: { admin: Budget; portal: Budget; jobs: Budget };
export function measureStartup(code: string, runs?: number): number;
export function checkBundle(
  bundle: { size: number; text: string; startupMs: number },
  budget: Budget,
): string[];
