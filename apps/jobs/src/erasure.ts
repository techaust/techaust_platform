// The keyed hash of an address in the jobs Worker (M7.4 A.3, D.6, D.9, the purge's receipts; L23: the same `ERASURE_HASH_KEY` as the admin API Worker, in
// `secrets.required`). Settled by the lead on the safest reading, 2026-11-06 (08-C RB-46): what an erasure keeps is HMAC-SHA256(key, lower-cased address),
// never the address. The key is imported once per isolate (`@techaust/core/hmac`). A missing or short key throws `ErasureKeyMissing`: the message is retried
// and ends in the dead-letter queue, so no email to an erased address is ever sent for want of the key, and no receipt is stamped with a wrong hash. The
// queue consumer logs that throw as its own event, `erasure.key_missing` (early check 2, low 4). The one exception is a new website lead (`leadHashOrNull`):
// the lead is kept and its receipt waits for the nightly `consent.hash`.
import { addressHash } from "@techaust/core/hmac";

/** The error of a Worker without the key; its `name` is what the queue consumer tells apart (never the message, which a log never carries). */
export class ErasureKeyMissing extends Error {
  override name = "ErasureKeyMissing";
  constructor() {
    super("ERASURE_HASH_KEY is not set on this Worker");
  }
}

/** The secret, read by name (declared in `secrets.required`), or null when this Worker has none (or a short one). */
const keyOrNull = (env: object): string | null => {
  const v: unknown = Reflect.get(env, "ERASURE_HASH_KEY");
  return typeof v === "string" && v.length >= 32 ? v : null;
};

/** The keyed hash of `email` (64 lower-case hex characters). Throws `ErasureKeyMissing` without the key. */
export const erasureHashOf = (env: object, email: string): Promise<string> => {
  const key = keyOrNull(env);
  if (key === null) return Promise.reject(new ErasureKeyMissing());
  return addressHash(key, email);
};

/** True for the throw of a Worker without the key. */
export const isErasureKeyMissing = (e: unknown): boolean =>
  e instanceof Error && e.name === "ErasureKeyMissing";

/**
 * Early check 2, low 4: a new website lead's receipt hash, or null without the key (the receipt is written with a NULL `subject_hash`, which the nightly
 * `consent.hash` fills once the key is set; logged as `erasure.key_missing`). The lead itself is the enquiry: it is never held back for the key.
 */
export async function leadHashOrNull(env: object, email: string): Promise<string | null> {
  if (keyOrNull(env) === null) return null;
  return erasureHashOf(env, email);
}
