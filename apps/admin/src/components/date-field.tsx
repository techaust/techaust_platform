// The admin's one date field (batch review M4, lead decision 2026-10-26), in place of every `<input type="date">`:
// - typed day first, DD/MM/YYYY, whatever the browser's locale (a native date input shows the locale's order, 10/26/2026);
// - the date read back under it as "26 Oct 2026", so a typed date is never ambiguous;
// - a calendar button, drawn in our tokens in both themes (the native picker's icon follows the browser, dark on dark), which
//   opens the browser's own calendar through a hidden native input (`showPicker`), so the calendar keeps its keyboard support;
// - 44 px tall, like every control.
// The value in and out is ISO ("2026-10-26"), exactly what the native input gave, so callers and the API don't change. While the
// text isn't a real date the field reports "" and the form's own check says what to fix.
import { useEffect, useId, useRef, useState } from "react";
import { DATE_FORMAT, dateEcho, isoToTyped, typedToIso } from "../lib/date-field.ts";
import { Calendar } from "./icons.tsx";

export function DateField(props: {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  disabled?: boolean | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: true | boolean | undefined;
  /** The calendar button's accessible name. */
  pickLabel?: string | undefined;
}) {
  const [text, setText] = useState(() => isoToTyped(props.value));
  const native = useRef<HTMLInputElement>(null);
  const echoId = useId();

  // A value set from outside (a reset, a reload, the calendar) shows as typed text; the person's own half-typed text stays.
  useEffect(() => {
    setText((t) => ((typedToIso(t) ?? "") === props.value ? t : isoToTyped(props.value)));
  }, [props.value]);

  const echo = dateEcho(props.value);
  const describedBy = [props["aria-describedby"], echo ? echoId : null].filter(Boolean).join(" ");

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
          aria-invalid={props["aria-invalid"] || undefined}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            const iso = typedToIso(t) ?? "";
            if (iso !== props.value) props.onChange(iso);
          }}
          onBlur={() => {
            // A complete date settles into the field's own order ("6/1/2026" → "06/01/2026").
            const iso = typedToIso(text);
            if (iso) setText(isoToTyped(iso));
          }}
        />
        <button
          type="button"
          className="datefield__pick"
          onClick={openPicker}
          disabled={props.disabled}
          aria-label={props.pickLabel ?? "Choose a date"}
        >
          <Calendar size={20} />
        </button>
        <input
          ref={native}
          type="date"
          className="datefield__native"
          tabIndex={-1}
          aria-hidden="true"
          value={props.value}
          min={props.min}
          max={props.max}
          onChange={(e) => {
            setText(isoToTyped(e.target.value));
            props.onChange(e.target.value);
            document.getElementById(props.id)?.focus();
          }}
        />
      </div>
      {echo && (
        <p className="datefield__echo" id={echoId}>
          {echo}
        </p>
      )}
    </div>
  );
}
