export function createInviteStatements(p: {
  email: string;
  role: string;
  tokenHash: string;
  now: number;
  expiresAt: number;
  auditId: string;
}): string[];
