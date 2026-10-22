// "Best time for a call" (07 §5.9): an IST window in the visitor's own clock. Pure, so it can be tested in Node.

/** IST is UTC+5:30 all year (no daylight saving). */
export const IST_OFFSET_MIN = 330;

/**
 * The window `from`–`to` (minutes after midnight IST) as the visitor's local times on the day of `now`, e.g.
 * "05:30–08:30" for a visitor in London in winter; null when the visitor's clock is on IST already. `offsetMin` is
 * the visitor's offset east of UTC (the negative of Date#getTimezoneOffset); `format` turns an instant into "HH:MM"
 * in the visitor's zone.
 */
export function localWindow(
  from: number,
  to: number,
  now: Date,
  offsetMin: number,
  format: (d: Date) => string,
): string | null {
  if (offsetMin === IST_OFFSET_MIN) return null;
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const at = (min: number) => format(new Date(day + (min - IST_OFFSET_MIN) * 60_000));
  return `${at(from)}–${at(to)}`;
}
