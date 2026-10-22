// Lead references (docs/05 §5.2): `L-` plus 5 characters of Crockford base32 (no I, L, O, U), random, never sequential.
// Unique by a database index; the lead consumer makes a new one on the rare clash.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const LEAD_REF = /^L-[0-9A-HJKMNP-TV-Z]{5}$/;

/** A random lead reference such as `L-7K3Q9`. `random` can be injected for tests (needs 5 bytes). */
export function generateLeadRef(random: Uint8Array = crypto.getRandomValues(new Uint8Array(5))): string {
  if (random.length < 5) throw new RangeError("generateLeadRef needs 5 random bytes");
  let out = "L-";
  for (let i = 0; i < 5; i++) out += ALPHABET[(random[i] as number) & 31];
  return out;
}
