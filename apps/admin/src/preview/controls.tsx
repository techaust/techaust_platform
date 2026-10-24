// Preview-only switches (show the loading or empty state, a long list, a GSTIN case). Visibly marked as part of the
// preview, so nobody mistakes them for the admin.
import type { ReactNode } from "react";

export function PreviewControls(props: {
  label: string;
  value?: string;
  options?: { value: string; label: string }[];
  onChange?: (v: string) => void;
  children?: ReactNode;
}) {
  return (
    <section className="pv-controls" aria-label="Preview controls">
      <p className="pv-controls__tag">Preview controls</p>
      {props.options && props.onChange ? (
        <fieldset className="pv-controls__set">
          <legend>{props.label}</legend>
          <div className="pv-controls__row">
            {props.options.map((o) => (
              <label key={o.value} className="pv-controls__opt">
                <input
                  type="radio"
                  name={`pv-${props.label}`}
                  value={o.value}
                  checked={props.value === o.value}
                  onChange={() => props.onChange?.(o.value)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <div className="pv-controls__set">
          <p className="pv-controls__legend">{props.label}</p>
          <div className="pv-controls__row">{props.children}</div>
        </div>
      )}
    </section>
  );
}
