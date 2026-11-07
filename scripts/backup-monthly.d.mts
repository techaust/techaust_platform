import type { DatabaseSync } from "node:sqlite";

export type BackupScopeFile = {
  format: "techaust-backup-scope/1";
  monthly: { table: string; sql: string }[];
  rollingOnly: string[];
};

export const SCOPE_FILE: string;
export const FORMAT: string;
export const UNSCOPED_TABLE: RegExp;
export class BackupError extends Error {}
export function safeMessage(e: unknown): string;
export function parseScope(text: string): BackupScopeFile;
export function readScope(path?: string): BackupScopeFile;
export function ident(name: string): string;
export function sqlLiteral(v: unknown): string;
export function loadExport(db: DatabaseSync, sqlText: string): void;
export function tablesOf(db: DatabaseSync): Map<string, string>;
export function scopeProblems(tables: Map<string, string>, scope: BackupScopeFile): string[];
export function copyTableSql(db: DatabaseSync, table: string, sql: string): string;
export function writeFinanceSql(
  db: DatabaseSync,
  scope: BackupScopeFile,
  write: (text: string) => void,
  options?: { createdAt?: string; source?: string },
): Record<string, number>;
export function buildFinanceCopy(
  exportPath: string,
  outPath: string,
  options?: { scope?: BackupScopeFile; createdAt?: string },
): { tables: number; bytes: number; counts: Record<string, number> };
export function restoreFinanceCopy(financePath: string, dbPath: string): Record<string, number>;
