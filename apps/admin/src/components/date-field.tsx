// The admin's one date field (batch review M4, lead decision 2026-10-26), in place of every `<input type="date">`:
// - typed day first, DD/MM/YYYY, whatever the browser's locale (a native date input shows the locale's order, 10/26/2026);
// - the date read back under it as "26 Oct 2026", so a typed date is never ambiguous;
// - a calendar button, drawn in our tokens in both themes (the native picker's icon follows the browser, dark on dark), which
//   opens the browser's own calendar through a hidden native input (`showPicker`), so the calendar keeps its keyboard support;
//   it is named "Choose a date" and the field's label (`aria-labelledby` the button and `<id>-label`), so each one is told apart;
// - 44 px tall, like every control.
// The value in and out is ISO ("2026-10-26") or "" (cleared), exactly what the native input gave, so callers and the API don't
// change. Text that can't be read as a date is never passed on (re-check L6); the field says so one of two ways, and its props
// make every caller pick one:
// - in a form, `invalid` and `onValidity` (from `useUnreadDates`): the field reports whether its text can't be read, and the form
//   hands that to its check (`dateError`, the owner's line), which blocks the save and lists it in the error summary;
// - with `keepLastValid` (a field that saves or filters as it changes), the last valid value stays and the field shows the line
//   itself once the person leaves it, with `aria-invalid`, until the text is a full date or empty.
// A value set from outside (a reset, a reload, Clear filters), or the form dropping its mark (Discard), replaces unread text
// (`syncedText`, re-check N1); a field mounted again shows its value and reports it readable, so a form never blocks on text no
// one can see (N4).
import { useEffect, useId, useRef, useState } from "react";
import {
  anyUnread,
  DATE_FORMAT,
  DATE_INVALID,
  dateEcho,
  type FieldProps,
  fieldValue,
  isoToTyped,
  isUnread,
  settledValue,
  syncedText,
  typedToIso,
  type UnreadDates,
  withUnread,
} from "../lib/date-field.ts";
import { Calendar } from "./icons.tsx";
import { FieldError } from "./ui.tsx";

const NONE: UnreadDates<never> = {};
const iso = (v: string | undefined) => (v && typedToIso(v) === v ? v : undefined);

type Validity =
  | {
      /** Keep the last valid value while the text isn't a date (autosave, filters); the field shows the error line itself. */
      keepLastValid: true;
      invalid?: undefined;
      onValidity?: undefined;
    }
  | {
      keepLastValid?: undefined;
      /** The form holds this field's text as unread (from `useUnreadDates().bind`). */
      invalid: boolean;
      /** Told whenever the text turns unread or readable again, and on mount when the form's mark is stale. */
      onValidity: (unread: boolean) => void;
    };

export function DateField(
  props: {
    id: string;
    value: string;
    onChange: (iso: string) => void;
    min?: string | undefined;
    max?: string | undefined;
    disabled?: boolean | undefined;
    "aria-describedby"?: string | undefined;
    "aria-invalid"?: true | boolean | undefined;
  } & Validity,
) {
  const [text, setText] = useState(() => isoToTyped(props.value));
  // Left after typing: the own error line (keepLastValid) waits until the person leaves, and hides again while they retype (L1).
  const [left, setLeft] = useState(false);
  const native = useRef<HTMLInputElement>(null);
  const echoId = useId();
  const pickId = useId();
  const ownErrorId = `${props.id}-date-error`;

  // Props changed since the last render: an outside value or a dropped mark replaces unread text. Adjusted while rendering, so
  // the report below never sees the stale text.
  const marked = props.invalid === true;
  const [seen, setSeen] = useState<FieldProps>({ value: props.value, invalid: marked });
  if (seen.value !== props.value || seen.invalid !== marked) {
    const now = { value: props.value, invalid: marked };
    setSeen(now);
    const next = syncedText(text, seen, now);
    if (next !== text) {
      setText(next);
      setLeft(false);
    }
  }

  const unread = isUnread(text);
  const { onValidity } = props;
  useEffect(() => {
    if (onValidity && unread !== marked) onValidity(unread);
  }, [onValidity, unread, marked]);

  const valid = iso(props.value);
  // The read-back is of what is typed: hidden while the text isn't that date (with keepLastValid, the last valid one is kept).
  const echo = valid && fieldValue(text) === props.value ? dateEcho(valid) : "";
  const ownError = !!props.keepLastValid && left && unread;
  const invalid = ownError || !!props["aria-invalid"];
  const describedBy = [props["aria-describedby"], ownError ? ownErrorId : null, echo ? echoId : null]
    .filter(Boolean)
    .join(" ");

  function openPicker() {
    const el = native.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      // No picker in this browser (or not allowed here): typing still works.
      document.getElementById(props.id)?.focus();
    }
  }

  return (
    <div className="datefield">
      <div className="datefield__row">
        <input
          id={props.id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder={DATE_FORMAT}
          maxLength={10}
          className="datefield__input"
          value={text}
          disabled={props.disabled}
          aria-describedby={describedBy || undefined}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            setLeft(false);
            const next = settledValue(t);
            if (next !== null && next !== props.value) props.onChange(next);
          }}
          onBlur={() => {
            setLeft(true);
            // A complete date settles into the field's own order ("6/1/2026" → "06/01/2026").
            const read = typedToIso(text);
            if (read) setText(isoToTyped(read));
          }}
        />
        <button
          type="button"
          id={pickId}
          className="datefield__pick"
          onClick={openPicker}
          disabled={props.disabled}
          aria-label="Choose a date"
          aria-labelledby={`${pickId} ${props.id}-label`}
        >
          <Calendar size={20} />
        </button>
        <input
          ref={native}
          type="date"
          className="datefield__native"
          tabIndex={-1}
          aria-hidden="true"
          value={valid ?? ""}
          min={iso(props.min)}
          max={iso(props.max)}
          onChange={(e) => {
            setText(isoToTyped(e.target.value));
            setLeft(false);
            props.onChange(e.target.value);
            document.getElementById(props.id)?.focus();
          }}
        />
      </div>
      {ownError && <FieldError id={ownErrorId}>{DATE_INVALID}</FieldError>}
      {echo && (
        <p className="datefield__echo" id={echoId}>
          {echo}
        </p>
      )}
    </div>
  );
}

/**
 * A form's date fields whose text can't be read (re-check L6): `bind(key)` goes on each DateField, `unread` into the form's check
 * (a required argument), `any` into its "has changes", and `reset()` into Discard or Cancel (the fields' texts go back with it).
 */
export function useUnreadDates<K extends string>() {
  const [unread, setUnread] = useState<UnreadDates<K>>(NONE as UnreadDates<K>);
  return {
    unread,
    any: anyUnread(unread),
    bind: (key: K) => ({
      invalid: unread[key] === true,
      onValidity: (u: boolean) => setUnread((s) => withUnread(s, key, u)),
    }),
    reset: () => setUnread(NONE as UnreadDates<K>),
  };
}
