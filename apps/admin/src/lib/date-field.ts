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

/** The owner's line for a date that can't be read (batch review fixes, 2026-10-26), word for word. */
export const DATE_INVALID = "Enter the date as DD/MM/YYYY, for example 26/10/2026.";

/**
 * What the field gives its form while the text isn't empty and isn't a real date ("31/02/2026", "26/10/26"). Never ISO and never
 * "", so a form can't mistake it for "no date" and save "Not set": its check turns it into DATE_INVALID and blocks the save.
 */
export const INVALID_DATE = "invalid-date";

/** The field's value for what is typed: "" when empty, ISO when it's a real date, INVALID_DATE otherwise. */
export function fieldValue(typed: string): string {
  if (typed.trim() === "") return "";
  return typedToIso(typed) ?? INVALID_DATE;
}

/** A form's check for a date field: the owner's line when the text isn't a date, else null (required and ranges stay the form's). */
export function dateError(value: string): string | null {
  return value === INVALID_DATE ? DATE_INVALID : null;
}

/**
 * For a field that saves as it changes (the payment schedule's target date) or filters a list: the value to pass on, or null to
 * keep the last valid one while the text isn't a date yet. Empty passes on as "" (cleared).
 */
export function settledValue(typed: string): string | null {
  const v = fieldValue(typed);
  return v === INVALID_DATE ? null : v;
}

/** The echo under the field, "26 Oct 2026", so a typed date is read back unambiguously; "" while it isn't a date. */
export function dateEcho(iso: string): string {
  const d = parseIsoDate(iso);
  return d ? formatDate(d) : "";
}
