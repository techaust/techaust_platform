// Row IDs (docs/05 §5.1): UUIDv7 text, time-ordered so new rows land at the end of the primary-key index.
// Human references (`ref`, `code`, `number_display`) are separate columns.

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const format = (b: Uint8Array) => {
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/**
 * A UUIDv7 (RFC 9562): 48-bit Unix milliseconds, then random bits. `nowMs` and `random` can be injected
 * for tests; by default they come from the clock and Web Crypto.
 */
export function uuidv7(
  nowMs: number = Date.now(),
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(10)),
): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs >= 2 ** 48)
    throw new RangeError(`Bad timestamp: ${nowMs}`);
  if (random.length < 10) throw new RangeError("uuidv7 needs 10 random bytes");
  const b = new Uint8Array(16);
  let t = nowMs;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.trunc(t / 256);
  }
  b.set(random.subarray(0, 10), 6);
  b[6] = 0x70 | ((b[6] as number) & 0x0f); // version 7
  b[8] = 0x80 | ((b[8] as number) & 0x3f); // RFC 9562 variant
  return format(b);
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The creation time encoded in a UUIDv7. */
export function uuidv7Time(id: string): number {
  if (!UUID.test(id) || id[14] !== "7") throw new RangeError(`Not a UUIDv7: ${id}`);
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

/**
 * A deterministic UUID (version 8, RFC 9562 "custom") from a stable key, for seed rows that must keep the
 * same ID on every run. Not cryptographic: 128-bit FNV-1a over the key's UTF-8 bytes.
 */
export function stableId(key: string): string {
  const PRIME = 0x0000000001000000000000000000013bn;
  const MASK = (1n << 128n) - 1n;
  let h = 0x6c62272e07bb014262b821756295c58dn;
  for (const byte of new TextEncoder().encode(key)) {
    h ^= BigInt(byte);
    h = (h * PRIME) & MASK;
  }
  const b = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) {
    b[i] = Number(h & 0xffn);
    h >>= 8n;
  }
  b[6] = 0x80 | ((b[6] as number) & 0x0f); // version 8
  b[8] = 0x80 | ((b[8] as number) & 0x3f);
  return format(b);
}
