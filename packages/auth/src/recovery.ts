// Recovery codes [ADM-AUTH-04]: ten single-use codes of 16 base32 characters (80 bits), shown once at enrolment.
// The database keeps only SHA-256 of each normalised code; an 80-bit random code can't be brute-forced from
// the hash, so no pepper or slow hash is needed (and a check stays cheap on the Free plan).
import { base32, enc, hex, randomBytes, sha256 } from "./crypto.ts";

export const RECOVERY_CODE_COUNT = 10;
const SHAPE = /^[A-Z2-7]{16}$/;

/** Ten new random codes, in the normalised form (16 uppercase base32 characters). */
export const newRecoveryCodes = (): string[] =>
  Array.from({ length: RECOVERY_CODE_COUNT }, () => base32(randomBytes(10)));

/** What a person may type: any case, with spaces or hyphens between the groups. */
export const normaliseRecoveryCode = (input: string) => input.toUpperCase().replace(/[\s-]/g, "");

export const isRecoveryCode = (normalised: string) => SHAPE.test(normalised);

/** `ABCD-EFGH-IJKL-MNOP`, for showing and printing. */
export const formatRecoveryCode = (code: string) => code.match(/.{4}/g)?.join("-") ?? code;

/** SHA-256 hex of the normalised code (anything typed is normalised first, so every spelling matches). */
export const recoveryCodeHash = async (input: string) =>
  hex(await sha256(enc.encode(normaliseRecoveryCode(input))));
