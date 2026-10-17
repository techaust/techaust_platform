// TOTP (RFC 6238: SHA-1, 6 digits, 30 s) with a replay guard [ADM-AUTH-01]. The secret is stored
// encrypted (AES-GCM with TOTP_ENC_KEY, bound to the user ID).

import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { createTOTPKeyURI, generateHOTP, verifyHOTP } from "@oslojs/otp";
import { decrypt, encrypt, randomBytes } from "./crypto.ts";

export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ISSUER = "TecHaust";

export const newTotpSecret = () => randomBytes(20);
export const currentStep = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_PERIOD_S);

export const sealTotpSecret = (key: string, userId: string, secret: Uint8Array) =>
  encrypt(key, secret, `totp:${userId}`);
export const openTotpSecret = (key: string, userId: string, sealed: string) =>
  decrypt(key, sealed, `totp:${userId}`);

export const totpUri = (account: string, secret: Uint8Array) =>
  createTOTPKeyURI(TOTP_ISSUER, account, secret, TOTP_PERIOD_S, TOTP_DIGITS);

/**
 * Accept the code for the current step or one step either side (clock drift), but only a step later than
 * the last one used, so a code can never be replayed. Returns the matched step to store.
 */
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  nowMs: number,
  lastStep: number | null,
): { ok: true; step: number } | { ok: false } {
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const now = currentStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (verifyHOTP(secret, BigInt(step), TOTP_DIGITS, code)) return { ok: true, step };
  }
  return { ok: false };
}

/** The code an authenticator app would show for `step` (tests and the CPU benchmark use this). */
export const totpCode = (secret: Uint8Array, step: number) => generateHOTP(secret, BigInt(step), TOTP_DIGITS);
export const secretFromBase32 = (s: string) => decodeBase32IgnorePadding(s);
