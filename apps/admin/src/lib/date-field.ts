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
 * The field's own reading of text that isn't empty and isn't a real date ("31/02/2026", "26/10/26"). It stays inside the field
 * (re-check L6): a form is never given it, only told through `onValidity` that its date can't be read.
 */
export const INVALID_DATE = "invalid-date";

/** The field's reading of what is typed: "" when empty, ISO when it's a real date, INVALID_DATE otherwise. */
export function fieldValue(typed: string): string {
  if (typed.trim() === "") return "";
  return typedToIso(typed) ?? INVALID_DATE;
}

/** True while the text isn't empty and can't be read as a date: what the field reports through `onValidity`. */
export function isUnread(typed: string): boolean {
  return fieldValue(typed) === INVALID_DATE;
}

/**
 * The date fields of one form whose text can't be read (re-check L6): each field reports its own through `onValidity`, the form
 * keeps them here and hands them to its check, which blocks the save. A required argument of every check, so no form forgets it.
 */
export type UnreadDates<K extends string> = Readonly<Partial<Record<K, true>>>;

/** One field's report applied to the form's set; the same object when nothing changed, so a repeated report never re-renders. */
export function withUnread<K extends string>(set: UnreadDates<K>, key: K, unread: boolean): UnreadDates<K> {
  if ((set[key] === true) === unread) return set;
  const next: Partial<Record<K, true>> = { ...set };
  if (unread) next[key] = true;
  else delete next[key];
  return next;
}

/** True when any of the form's date fields can't be read: the form has a change the person must fix or discard. */
export const anyUnread = <K extends string>(set: UnreadDates<K>): boolean => Object.keys(set).length > 0;

/** A form's check for one date field: the owner's line while its text can't be read, else null (required and ranges stay the form's). */
export function dateError(unread: boolean | undefined): string | null {
  return unread ? DATE_INVALID : null;
}

/**
 * What the field passes on for what is typed: ISO, or "" when cleared, or null (nothing passed on) while the text can't be read,
 * so the form keeps the last valid value and a half-typed or impossible date is never sent as "no date".
 */
export function settledValue(typed: string): string | null {
  const v = fieldValue(typed);
  return v === INVALID_DATE ? null : v;
}

/** What the field's props were at its last render: the value and whether its form holds it as unread. */
export type FieldProps = { value: string; invalid: boolean };

/**
 * The text the field shows once its props change (re-check N1). The field passes on only what its text reads as, never a value
 * while the text can't be read, so:
 * - a new value its text doesn't read as was set from outside (a reset, a reload, Clear filters): the text shows that value, and a
 *   stale unread text goes with its error;
 * - the form dropping its unread mark (Discard, Cancel) while the text still can't be read: the text goes back to the value.
 * Otherwise the person's own text stays.
 */
export function syncedText(text: string, prev: FieldProps, next: FieldProps): string {
  if (next.value !== prev.value && fieldValue(text) !== next.value) return isoToTyped(next.value);
  if (prev.invalid && !next.invalid && isUnread(text)) return isoToTyped(next.value);
  return text;
}

/** The echo under the field, "26 Oct 2026", so a typed date is read back unambiguously; "" while it isn't a date. */
export function dateEcho(iso: string): string {
  const d = parseIsoDate(iso);
  return d ? formatDate(d) : "";
}
