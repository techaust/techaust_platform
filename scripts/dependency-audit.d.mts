export type Advisory = {
  id: string;
  pkg: string;
  severity: string;
  title: string;
  patched: string | null;
  paths: string[];
  findings?: { version: string; paths: string[] }[];
  outside?: string[];
};
export type AllowEntry = {
  advisory: string;
  package: string;
  reason: string;
  added: string;
  addedBy: string;
  expires: string;
  versions?: string[];
  via?: string[];
};
export type Verdict = {
  blocked: Advisory[];
  expired: AllowEntry[];
  stale: AllowEntry[];
  allowed: Advisory[];
  problems: string[];
};
export const ALLOW_FILE: string;
export const GATED: string[];
export const MAX_ALLOW_DAYS: number;
export function viaMatches(pattern: string, path: string): boolean;
export function coveredBy(entry: AllowEntry, advisory: Advisory): boolean;
export function advisoriesOf(text: string): Advisory[];
export function allowListProblems(entries: unknown): string[];
export function verdict(advisories: Advisory[], entries: AllowEntry[], today: string): Verdict;
export function report(v: Verdict, advisories: Advisory[]): { ok: boolean; lines: string[] };
