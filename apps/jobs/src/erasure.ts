// The keyed hash of an address in the jobs Worker (M7.4 A.3, D.6, D.9, the purge's receipts; L23: the same `ERASURE_HASH_KEY` as the admin API Worker, in
// `secrets.required`). Settled by the lead on the safest reading, 2026-11-06 (08-C RB-46): what an erasure keeps is HMAC-SHA256(key, lower-cased address),
// never the address. The key is imported once per isolate (`@techaust/core/hmac`). A missing or short key throws: the message is retried and ends in the
// dead-letter queue, so no email to an erased address is ever sent for want of the key, and no receipt is stamped with a wrong hash.
import { addressHash } from "@techaust/core/hmac";

/** The secret, read by name (declared in `secrets.required`). */
const keyOf = (env: object): string => {
  const v: unknown = Reflect.get(env, "ERASURE_HASH_KEY");
  if (typeof v !== "string" || v.length < 32) throw new Error("ERASURE_HASH_KEY is not set on this Worker");
  return v;
};

/** The keyed hash of `email` (64 lower-case hex characters). */
export const erasureHashOf = (env: object, email: string): Promise<string> => addressHash(keyOf(env), email);
