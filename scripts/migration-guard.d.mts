export const FIRST_CHECKED: number;
export type MigrationFile = { name: string; sql: string };
export type RebuildAllowance = { migration: string; table: string; reason: string };
export function referencedBy(migrations: MigrationFile[]): Map<string, Set<string>>;
export function findRebuildViolations(migrations: MigrationFile[], allow?: RebuildAllowance[]): string[];
export function loadMigrations(dir: string): MigrationFile[];
