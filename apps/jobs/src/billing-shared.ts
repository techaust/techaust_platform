// Small reads and helpers the invoice send and the reminders share (M5.4; review L6): one copy of the settings row they read, the lenient reader of its stored value, and the portal's base URL.

/** The `payment_terms` settings row the reminder window comes from. */
export const TERMS_READ = "SELECT value FROM settings WHERE key = 'payment_terms'";

/** The row's JSON read without zod (an unreadable or missing row is `null`, which core reads as the default window). */
export const storedValue = (rows: unknown): unknown => {
  try {
    const value = (rows as { results: { value: string }[] } | undefined)?.results[0]?.value;
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

/** The portal's origin without a trailing slash (links are built on it). */
export const portalBase = (env: { PORTAL_URL?: string }): string =>
  (env.PORTAL_URL ?? "").replace(/\/+$/, "");
