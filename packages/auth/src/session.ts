// Staff sessions [ADM-AUTH-05]: a 32-byte random token in a __Host- cookie; the database keeps SHA-256(token).
import { newToken, tokenHash } from "./tokens.ts";

export const ADMIN_COOKIE = "__Host-ta_admin";
export const IDLE_MS = 12 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most this often (keeps D1 writes low on the Free plan). */
export const TOUCH_EVERY_MS = 15 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function newSession(nowMs: number) {
  const token = newToken();
  return {
    token,
    id: await tokenHash(token),
    lastSeenAt: nowMs,
    idleExpiresAt: nowMs + IDLE_MS,
    absExpiresAt: nowMs + ABSOLUTE_MS,
  };
}

export type SessionRow = {
  idleExpiresAt: number;
  absExpiresAt: number;
  revokedAt: number | null;
  lastSeenAt: number;
};

/** "valid" | "expired"; and whether last_seen_at should be refreshed now. */
export function checkSession(row: SessionRow, nowMs: number): { valid: boolean; touch: boolean } {
  const valid = row.revokedAt === null && nowMs < row.idleExpiresAt && nowMs < row.absExpiresAt;
  return { valid, touch: valid && nowMs - row.lastSeenAt >= TOUCH_EVERY_MS };
}

export const sessionCookie = (token: string, maxAgeS: number) =>
  `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeS}`;
export const clearCookie = () => `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function readCookie(header: string | null | undefined, name = ADMIN_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}
