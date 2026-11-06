export function resetStatements(p: {
  email: string;
  tokenHash: string;
  now: number;
  expiresAt: number;
  auditId: string;
  alertId: string;
}): string[];

export const RESET_ROW_MARGIN_MS: number;

export function reinviteStatements(p: {
  email: string;
  tokenHash: string;
  now: number;
  expiresAt: number;
  auditId: string;
  /** M7.5 (L36): the `user.reset_2fa` row an interrupted reset never wrote, and its `alert.2fa_change`. */
  resetAuditId: string;
  alertId: string;
}): string[];

export function reinviteExpected(p: {
  found: string[];
  auditId: string;
  resetAuditId: string;
  alertId: string;
}): { expected: string[]; recordedReset: boolean };

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
