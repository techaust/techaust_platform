// Structured log lines for the queue consumers. Never personal data: only the event, the lead reference, counts and
// codes (no names, email addresses, messages or address hashes).

// A random per-isolate ID and this isolate's invocation count (CPU tuning 3), as the portal's exit line has: on staging
// they tell a cold invocation (`n: 1`) from a warm one when reading `cpuTimeMs`. Random values can't be made at module
// level in Workers, so `iso` is created at the first invocation.
let isolateId: string | undefined;
let invocations = 0;

/** Counts one queue invocation (call once at the start of each handler run). */
export function noteInvocation(): void {
  isolateId ??= [...crypto.getRandomValues(new Uint8Array(3))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  invocations++;
}

export function logEvent(
  event: string,
  fields: Record<string, string | number | boolean | undefined> = {},
): void {
  console.log(JSON.stringify({ ev: event, ...fields, iso: isolateId, n: invocations || undefined }));
}
