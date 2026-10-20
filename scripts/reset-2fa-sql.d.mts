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
