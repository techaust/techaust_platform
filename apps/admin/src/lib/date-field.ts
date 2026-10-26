// The pure side of the admin's one date field (batch review M4, lead decision 2026-10-26): people type the day first, as
// DD/MM/YYYY (the Indian order, docs/06), whatever the browser's locale; the API keeps receiving ISO "2026-10-26". Pure, so the
// parsing is tested without a browser.
import { formatDate, isValidDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";

/** The visible order of the field (also its placeholder): a format, not a sentence. */
export const DATE_FORMAT = "DD/MM/YYYY";

/** "2026-10-26" → "26/10/2026"; anything else → "". */
export function isoToTyped(iso: string): string {
  const d = parseIsoDate(iso);
  return d ? `${String(d.day).padStart(2, "0")}/${String(d.month).padStart(2, "0")}/${d.year}` : "";
}

/**
 * What a person typed → ISO, or null when it isn't a real date. Day first: "26/10/2026", "26-10-2026", "26.10.2026",
 * "26 10 2026" and "6/1/2026"; a pasted ISO date ("2026-10-26") is taken too. Two-digit years are refused (no guessing the century).
 */
export function typedToIso(typed: string): string | null {
  const t = typed.trim();
  if (t === "") return null;
  if (parseIsoDate(t)) return t;
  const m = /^(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{4})$/.exec(t);
  if (!m) return null;
  const date = { year: Number(m[3]), month: Number(m[2]), day: Number(m[1]) };
  return isValidDate(date) ? toIsoDate(date) : null;
}

/** The echo under the field, "26 Oct 2026", so a typed date is read back unambiguously; "" while it isn't a date. */
export function dateEcho(iso: string): string {
  const d = parseIsoDate(iso);
  return d ? formatDate(d) : "";
}
