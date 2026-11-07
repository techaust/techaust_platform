// A response body read through a byte cap (M6–M7 audit AU7 L3, AU39; AU61 review L7: one reader shared by the gateway clients, the SES client and the
// Turnstile check, each keeping its own cap and its own reading of a refusal). Pure over the web-standard `ReadableStream`: no I/O of its own, runs anywhere.

/** The part of a `Response` the reader needs (the gateways' start-up dry run passes Response-shaped answers whose headers may be absent). */
export type CappedBodySource = {
  readonly headers?: { get(name: string): string | null } | null;
  readonly body: ReadableStream<Uint8Array> | null;
};

/**
 * The body's bytes, at most `max` of them: a declared `content-length` over `max` cancels the body unread; a stream that passes `max` is cancelled at that
 * chunk. Over the cap: null. No body: no bytes. A failing stream rejects (each caller maps that as it already does).
 */
export async function readBodyCapped(res: CappedBodySource, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers?.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.byteLength;
  }
  return bytes;
}

/** The body as UTF-8 text through the same cap; over it: null. */
export async function readTextCapped(res: CappedBodySource, max: number): Promise<string | null> {
  const bytes = await readBodyCapped(res, max);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
