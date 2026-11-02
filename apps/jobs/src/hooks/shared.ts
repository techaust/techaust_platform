// What every gateway webhook shares (M6.2's Razorpay hook helpers, moved here in M6.3 for the Stripe hook; JOB-HOOK-01..03): the JSON answer with no-store and
// nosniff, a secret read by name, and the body read as raw bytes from a stream cut at a cap (a declared length above it is refused before reading).

/** The body cap (run files D): a gateway's checkout events are a few KiB. */
export const HOOK_MAX_BYTES = 64 * 1024;

export const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export const refuse = (status: number, code: string) => answer(status, { error: { code } });

/** A secret by name: its text, or undefined when unset (a previous secret is optional, so it is read by name, never typed). */
export const secretOf = (env: object, name: string): string | undefined => {
  const v: unknown = Reflect.get(env, name);
  return typeof v === "string" && v !== "" ? v : undefined;
};

/** A JSON content type (any charset). */
export const isJsonType = (type: string | null): boolean => /^application\/json(\s*;|$)/i.test(type ?? "");

/** The body as raw bytes, streamed and cut at `max` (null: too large). A declared length above the cap is refused before reading. */
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? Number.NaN);
  if (declared > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
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
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** UTF-8, refusing invalid bytes (a body that isn't text is never parsed). */
export const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
