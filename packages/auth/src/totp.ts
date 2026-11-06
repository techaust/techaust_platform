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

/**
 * M7.5 (A1 F8, L7): a sealed secret names its key version, `v1.` then base64url(iv ‖ ciphertext ‖ tag), so a later `TOTP_ENC_KEY` rotation can tell which
 * key sealed a row (docs/runbooks/incident.md). `v1` is the current `TOTP_ENC_KEY`. A seal written before M7.5 has no prefix (base64url never holds a `.`) and
 * is opened with the same key. The prefix sits outside the ciphertext, but changing it gains nothing: only `v1` exists, and AES-GCM refuses a wrong key or AAD.
 */
export const TOTP_SEAL_VERSION = "v1";
export const sealTotpSecret = async (key: string, userId: string, secret: Uint8Array) =>
  `${TOTP_SEAL_VERSION}.${await encrypt(key, secret, `totp:${userId}`)}`;
export const openTotpSecret = (key: string, userId: string, sealed: string): Promise<Uint8Array> => {
  const dot = sealed.indexOf(".");
  // unversioned: sealed before M7.5, with the same key
  if (dot < 0) return decrypt(key, sealed, `totp:${userId}`);
  if (sealed.slice(0, dot) !== TOTP_SEAL_VERSION)
    return Promise.reject(new Error("Unknown TOTP seal version"));
  return decrypt(key, sealed.slice(dot + 1), `totp:${userId}`);
};

/** The TOTP sealing keys: `TOTP_ENC_KEY`, and during a rotation the optional `TOTP_ENC_KEY_PREVIOUS` (never in `secrets.required`). */
export type TotpKeys = { current: string; previous?: string | undefined };

/**
 * The keys of an env: the current one, plus `TOTP_ENC_KEY_PREVIOUS` only when it is set to a non-empty string (an optional secret, so absent from the
 * generated `Env` type and read by name).
 */
export const totpKeysOf = (env: { TOTP_ENC_KEY: string }): TotpKeys => {
  const previous: unknown = Reflect.get(env, "TOTP_ENC_KEY_PREVIOUS");
  return {
    current: env.TOTP_ENC_KEY,
    previous: typeof previous === "string" && previous !== "" ? previous : undefined,
  };
};

/**
 * M7.5 (R finding 1, L23): opens a stored secret with the current key, then (a rotation in progress) with the previous one. `reseal` is the same secret sealed
 * again with the CURRENT key when only the previous key opened it, for the caller to store in the batch that records a successful code check (guarded on
 * the row still holding the old seal); null when the current key opened it. Null: no key opens it (a wrong key, an unknown version, a tampered value): the
 * caller refuses, fail-closed. Rotation: set `TOTP_ENC_KEY_PREVIOUS` to the old value, put the new `TOTP_ENC_KEY`, each member signs in (or steps up) once,
 * then remove `TOTP_ENC_KEY_PREVIOUS` (docs/runbooks/incident.md).
 */
export async function openTotpSecretRotating(
  keys: TotpKeys,
  userId: string,
  sealed: string,
): Promise<{ secret: Uint8Array; reseal: string | null } | null> {
  try {
    return { secret: await openTotpSecret(keys.current, userId, sealed), reseal: null };
  } catch {
    if (!keys.previous) return null;
  }
  try {
    const secret = await openTotpSecret(keys.previous, userId, sealed);
    return { secret, reseal: await sealTotpSecret(keys.current, userId, secret) };
  } catch {
    return null;
  }
}

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
