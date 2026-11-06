export function splitStatements(sql: string): string[];
export function loadOrder(sql: string): { schema: string[]; data: string[]; triggers: string[] };
export function installedTriggers(statements: string[]): Set<string>;
export function numberingProblems(
  counters: { series: string; fy: string; next_no: number }[],
  numbered: { series: string; fy: string; max_no: number; distinct_no: number; min_no: number }[],
): string[];
export function migrationFiles(dir?: string): string[];
