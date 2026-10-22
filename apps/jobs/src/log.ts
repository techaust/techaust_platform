// Structured log lines for the queue consumers. Never personal data: only the event, the lead reference, counts and
// codes (no names, email addresses, messages or address hashes).
export function logEvent(
  event: string,
  fields: Record<string, string | number | boolean | undefined> = {},
): void {
  console.log(JSON.stringify({ ev: event, ...fields }));
}
