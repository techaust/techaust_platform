export type Advisory = {
  id: string;
  pkg: string;
  severity: string;
  title: string;
  patched: string | null;
  paths: string[];
};
export type AllowEntry = {
  advisory: string;
  package: string;
  reason: string;
  added: string;
  addedBy: string;
  expires: string;
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
export function advisoriesOf(text: string): Advisory[];
export function allowListProblems(entries: unknown): string[];
export function verdict(advisories: Advisory[], entries: AllowEntry[], today: string): Verdict;
export function report(v: Verdict, advisories: Advisory[]): { ok: boolean; lines: string[] };
