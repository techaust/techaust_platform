export const ORIGINS: { local: string; staging: string };
export const MAGIC_TTL_MS: number;
export function linkUrl(origin: string, token: string): string;
export function normaliseEmail(value: unknown): string | null;
export function eligibleSql(email: string, clientCode?: string): string;
export function linkStatements(p: {
  contactId: string;
  tokenHash: string;
  now: number;
  auditId: string;
}): string[];
export const SAMPLE: {
  key: string;
  code: string;
  name: string;
  id: string;
  contacts: { kind: string; name: string; portal: number; finance: number; id: string; email: string }[];
}[];
export function sampleStatements(): string[];
