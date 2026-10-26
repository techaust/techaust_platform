// The admin's one date field (batch review M4, lead decision 2026-10-26), in place of every `<input type="date">`:
// - typed day first, DD/MM/YYYY, whatever the browser's locale (a native date input shows the locale's order, 10/26/2026);
// - the date read back under it as "26 Oct 2026", so a typed date is never ambiguous;
// - a calendar button, drawn in our tokens in both themes (the native picker's icon follows the browser, dark on dark), which
//   opens the browser's own calendar through a hidden native input (`showPicker`), so the calendar keeps its keyboard support;
//   it is named "Choose a date" and the field's label (`aria-labelledby` the button and `<id>-label`), so each one is told apart;
// - 44 px tall, like every control.
// The value in and out is ISO ("2026-10-26"), exactly what the native input gave, so callers and the API don't change. Text that
// isn't a real date (review of the fixes, finding 1) is never passed on as "":
// - in a form, the field gives INVALID_DATE; the form's check (`dateError`) shows the owner's line and blocks the save;
// - with `keepLastValid` (a field that saves or filters as it changes), the last valid value stays and the field shows the line
//   itself once the person leaves it, with `aria-invalid`, until the text is a full date or empty.
import { useEffect, useId, useRef, useState } from "react";
import {
  DATE_FORMAT,
  DATE_INVALID,
  dateEcho,
  fieldValue,
  INVALID_DATE,
  isoToTyped,
  settledValue,
  typedToIso,
} from "../lib/date-field.ts";
import { Calendar } from "./icons.tsx";
import { FieldError } from "./ui.tsx";

const iso = (v: string | undefined) => (v && typedToIso(v) === v ? v : undefined);

export function DateField(props: {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  disabled?: boolean | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: true | boolean | undefined;
  /** Keep the last valid value while the text isn't a date (autosave, filters); the field shows the error line itself. */
  keepLastValid?: boolean | undefined;
}) {
  const [text, setText] = useState(() => isoToTyped(props.value));
  const [left, setLeft] = useState(false);
  const native = useRef<HTMLInputElement>(null);
  const echoId = useId();
  const pickId = useId();
  const ownErrorId = `${props.id}-date-error`;

  // A value set from outside (a reset, a reload, the calendar) shows as typed text; the person's own text stays while it still
  // gives the same value (half typed, or not a date, in a form) or, with keepLastValid, while it isn't a date yet.
  useEffect(() => {
    setText((t) => {
      const v = fieldValue(t);
      if (v === props.value) return t;
      if (props.keepLastValid && v === INVALID_DATE) return t;
      return isoToTyped(props.value);
    });
  }, [props.value, props.keepLastValid]);

  const valid = iso(props.value);
  // The read-back is of what is typed: hidden while the text isn't that date (with keepLastValid, the last valid one is kept).
  const echo = valid && fieldValue(text) === props.value ? dateEcho(valid) : "";
  const ownError = !!props.keepLastValid && left && fieldValue(text) === INVALID_DATE;
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
            const next = props.keepLastValid ? settledValue(t) : fieldValue(t);
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
