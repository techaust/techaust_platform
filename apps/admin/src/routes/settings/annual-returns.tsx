// Settings › Tax: the day the annual return (GSTR-9) of each financial year was filed (M5.3; ADM-SET-04, ADM-INV-11; 07-T §4, §8; s.34(2), Q33;
// VERIFY WITH CA/LEGAL). Once filed, credit notes for invoices of that year are blocked from that day. One date per year, no list to build: the
// two last completed years are always offered (a return is filed after its year ends), and any year already saved; an empty date is no return.
// The dates save with the rest of the tax form.
import { issueDateOf } from "@techaust/core/invoices";
import { DateField } from "../../components/date-field.tsx";
import { annualReturnYears, firstFilingDay, NOTE_COPY } from "../../lib/notes.ts";
import { RowError } from "./kit.tsx";

/** The field id of a year's date (the form's error keys and the error summary's links). */
export const annualReturnFieldId = (fy: string) => `f-annualReturnsFiled-${fy}`;

export function AnnualReturns(props: {
  /** The date typed per FY token ("2526" → "2026-06-30"); "" is no return. */
  value: Record<string, string>;
  onChange: (fy: string, filedOn: string) => void;
  error: (id: string) => string | undefined;
  readOnly: boolean;
}) {
  const today = issueDateOf(Date.now());
  // every year the form holds stays on screen, a cleared one included (the form starts with the saved years)
  const years = annualReturnYears(
    Date.now(),
    Object.keys(props.value).map((fy) => ({ fy, filedOn: "" })),
  );
  return (
    <div className="setting annual-returns">
      <div className="setting__text">
        <span id="tax-gstr9-label" className="setting__label">
          {NOTE_COPY.annualReturnLabel}
        </span>
        <p className="hint" id="tax-gstr9-desc">
          {NOTE_COPY.annualReturnHint}
        </p>
      </div>
      <fieldset
        className="setting__control annual-returns__years"
        aria-labelledby="tax-gstr9-label"
        aria-describedby="tax-gstr9-desc"
      >
        {years.map((y) => {
          const id = annualReturnFieldId(y.token);
          const err = props.error(id);
          return (
            <div key={y.token} className="field annual-returns__year">
              <label htmlFor={id} id={`${id}-label`}>
                FY {y.label}
              </label>
              <DateField
                id={id}
                keepLastValid
                value={props.value[y.token] ?? ""}
                min={firstFilingDay(y.token)}
                max={today}
                disabled={props.readOnly}
                aria-describedby={err ? `${id}-error` : undefined}
                aria-invalid={err ? true : undefined}
                onChange={(d) => props.onChange(y.token, d)}
              />
              <RowError id={id} error={err} />
            </div>
          );
        })}
      </fieldset>
    </div>
  );
}
