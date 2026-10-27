// `sendBatch` in chunks within the Queues limits (M5.5b; Cloudflare Queues limits, checked 2026-10-28): at most 100 messages and 256 KB in total per call, each message at most 128 KB
// (including about 100 bytes of internal metadata). A caller with more than that sends several calls, in order; a call that throws leaves the later chunks unsent and the earlier ones
// sent, which every user of this helper tolerates (its messages are idempotent: an email is claimed once by its log row, a bell is `INSERT OR IGNORE`).

/** Most messages in one `sendBatch`. */
export const SEND_BATCH_MAX_MESSAGES = 100;
/** A margin under the 256 KB total, counting each message's JSON text plus 100 bytes of metadata. */
export const SEND_BATCH_MAX_BYTES = 230_000;
const METADATA_BYTES = 100;
const encoder = new TextEncoder();

/** The chunks (arrays of bodies) a list splits into: by count and by estimated size. A single message over the byte budget goes alone (the queue refuses it if it is over 128 KB). */
export function chunksOf<T>(bodies: readonly T[]): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const body of bodies) {
    const size = encoder.encode(JSON.stringify(body)).byteLength + METADATA_BYTES;
    if (
      current.length > 0 &&
      (current.length >= SEND_BATCH_MAX_MESSAGES || bytes + size > SEND_BATCH_MAX_BYTES)
    ) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(body);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** Sends the bodies on `queue` in chunks; returns the number of `sendBatch` calls. */
export async function sendChunked(
  queue: Pick<Queue, "sendBatch">,
  bodies: readonly unknown[],
): Promise<number> {
  const chunks = chunksOf(bodies);
  for (const chunk of chunks) await queue.sendBatch(chunk.map((body) => ({ body })));
  return chunks.length;
}
