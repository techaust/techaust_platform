export function resetStatements(p: {
  email: string;
  tokenHash: string;
  now: number;
  expiresAt: number;
  auditId: string;
  alertId: string;
}): string[];

export function reinviteStatements(p: {
  email: string;
  tokenHash: string;
  now: number;
  expiresAt: number;
  auditId: string;
}): string[];

export function normaliseEmail(value: unknown): string | null;

export function breakGlassStatements(p: {
  newEmail: string;
  lostOwnerId: string;
  tokenHash: string;
  now: number;
  expiresAt: number;
  auditId: string;
}): string[];

export function auditReadBackSql(ids: string[]): string;

export function readBackProblem(p: { found: string[]; expected: string[] }): string | null;

export function checkBreakGlass(p: {
  email: string;
  newEmail: unknown;
  existing: number;
  liveInvites: number;
  staging?: boolean;
}): string;
