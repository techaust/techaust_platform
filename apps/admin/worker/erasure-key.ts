// The keyed hash of an address on the admin API Worker (M7.4 A.3, A.6, C.6, C.8, C.9; L23: `ERASURE_HASH_KEY` is this Worker's ONLY secret, held in
// `secrets.required` in every scope and guarded by scripts/check-worker-config.mjs). Settled by the lead on the safest reading, 2026-11-06 (08-C RB-46):
// an erasure keeps only HMAC-SHA256(key, lower-cased address), never the address. The key is imported once per isolate (`@techaust/core/hmac`). A missing
// or short key throws, so no erasure ever runs without its stop (the route answers 500 and nothing is written).
import { addressHash } from "@techaust/core/hmac";

/** The secret, read by name (the front's generated `Env` doesn't declare this Worker's own secret). */
const keyOf = (env: object): string => {
  const v: unknown = Reflect.get(env, "ERASURE_HASH_KEY");
  if (typeof v !== "string" || v.length < 32) throw new Error("ERASURE_HASH_KEY is not set on this Worker");
  return v;
};

/** The keyed hash of `email` (64 lower-case hex characters). */
export const erasureHash = (env: object, email: string): Promise<string> => addressHash(keyOf(env), email);

/** The keyed hash of each distinct lower-cased address, as a JSON object `{address: hash}` for one bound parameter (`json_extract(?, '$."' || … || '"')`). */
export async function erasureHashMap(env: object, emails: readonly string[]): Promise<string> {
  const key = keyOf(env);
  const out: Record<string, string> = {};
  for (const e of new Set(emails.map((x) => x.trim().toLowerCase()))) out[e] = await addressHash(key, e);
  return JSON.stringify(out);
}

/**
 * The SQL that picks a lead's hash from a bound `erasureHashMap` (`?n`): its own address's, or NULL for an address the map doesn't hold, and never a second
 * hash for a lead already marked (`coalesce`: the trigger `leads_erased_hash` sets it once). `col` is the lead's address column.
 */
export const hashFromMap = (n: number, col = "contact_email") =>
  `coalesce(erased_hash, (SELECT j.value FROM json_each(?${n}) j WHERE j.key = lower(${col})))`;
